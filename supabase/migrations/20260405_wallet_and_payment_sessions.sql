-- ============================================================
-- BILLETERA INTERNA Y SESIONES DE PAGO
-- Pasos 1 y 2 de la hoja de ruta de Saldo a Favor
-- ============================================================
--
-- CONTEXTO:
--   Cuando un almuerzo ya boleteado (billing_status='sent') se
--   anula, en lugar de emitir una Nota de Crédito fiscal (que
--   cuesta dinero en Nubefact), se acredita el monto en una
--   "billetera interna" del alumno.
--
--   El padre puede usar ese saldo en su próximo pago:
--     Deuda S/ 100 − Wallet S/ 15 = S/ 85 a pagar por pasarela.
--   La boleta que va a SUNAT es por S/ 85 (el dinero real que
--   entró al colegio), no por S/ 100.
--
-- ESTE SCRIPT:
--   1. Agrega students.wallet_balance     (saldo en billetera)
--   2. Crea wallet_transactions           (trazabilidad de movimientos)
--   3. Crea payment_sessions              (contrato padre ↔ sistema)
--   4. Índices para consultas instantáneas
--   5. RLS granular para cada tabla
--   6. Protección wallet en trigger existente de INSERT de students
--
-- NO incluye RPCs (esos son los Pasos 3-5 de la hoja de ruta).
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- PASO 1 — Columna wallet_balance en students
-- ════════════════════════════════════════════════════════════════

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN students.wallet_balance IS
  'Saldo a favor acumulado por anulaciones internas de almuerzos ya '
  'boleteados. DIFERENTE de students.balance (ese es saldo de kiosco). '
  'Solo se modifica vía RPC adjust_student_wallet_balance. '
  'NUNCA tocar directamente desde el cliente.';

-- Extender el trigger existente para que también fuerce wallet_balance = 0
-- en inserts de padres autenticados (misma protección que balance).
-- Re-creamos la función para incluir el nuevo campo:
CREATE OR REPLACE FUNCTION public.force_zero_balance_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- service_role y postgres pueden insertar con cualquier valor
  -- (migraciones, correcciones admin, etc.)
  -- Los usuarios autenticados del frontend siempre arrancan en 0:
  IF current_setting('role') = 'authenticated' OR
     auth.role() = 'authenticated' THEN
    NEW.balance        := 0;
    NEW.wallet_balance := 0;   -- NUEVO: proteger también la billetera
    NEW.free_account   := true;
  END IF;
  RETURN NEW;
END;
$$;

-- El trigger ya existe (trg_force_zero_balance_on_insert), la función
-- actualizada se aplica automáticamente en el próximo INSERT.


-- ════════════════════════════════════════════════════════════════
-- PASO 2 — Tabla wallet_transactions
-- ════════════════════════════════════════════════════════════════
-- Registro INMUTABLE de cada crédito y débito de la billetera.
-- Equivalente a `transactions` pero solo para el saldo a favor.
-- Las filas de esta tabla NUNCA se borran ni se modifican
-- (misma filosofía que las transacciones fiscales).

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quién tiene el saldo ──────────────────────────────────────
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_id       UUID NOT NULL,

  -- Movimiento ─────────────────────────────────────────────────
  amount          NUMERIC(10,2) NOT NULL,
  -- Regla:
  --   amount > 0 = crédito  (anulación acreditada al padre)
  --   amount < 0 = débito   (saldo usado para pagar una deuda)

  type            TEXT NOT NULL CHECK (type IN (
                    'cancellation_credit',  -- almuerzo sent anulado → +saldo
                    'payment_debit',        -- saldo usado en cobro  → -saldo
                    'manual_adjustment'     -- corrección de admin   → ±saldo
                  )),

  -- Trazabilidad de origen del crédito ─────────────────────────
  -- (ambos NULL si es manual_adjustment)
  origin_transaction_id   UUID REFERENCES transactions(id)  ON DELETE RESTRICT,
  -- La transacción con billing_status='sent' que generó el crédito
  -- (la boleta original de ese almuerzo)

  origin_lunch_order_id   UUID REFERENCES lunch_orders(id)  ON DELETE RESTRICT,
  -- El lunch_order que fue anulado

  -- Trazabilidad de uso del débito ──────────────────────────────
  applied_to_session_id   UUID,
  -- La payment_session en la que se consumió el saldo
  -- (FK diferida — payment_sessions se crea en este mismo script)

  applied_to_tx_id        UUID REFERENCES transactions(id)  ON DELETE RESTRICT,
  -- La transaction fiscal (S/ 85) que se complementó con este saldo

  -- Contexto ───────────────────────────────────────────────────
  description     TEXT,
  -- Texto legible para el padre: "Anulación de Almuerzo - Menú del 02/04/2026"

  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- NULL = operación automática del sistema (webhook, RPC)
  -- UUID = admin que hizo el ajuste manual

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()

  -- Sin updated_at: esta tabla es append-only. Si hay un error,
  -- se corrige con un registro NUEVO de tipo 'manual_adjustment',
  -- nunca editando el original.
);

COMMENT ON TABLE wallet_transactions IS
  'Libro mayor de la billetera interna. Cada fila es un movimiento '
  'de saldo a favor del alumno. Append-only: nunca se edita ni borra. '
  'Para corregir errores: insertar un manual_adjustment con signo opuesto.';

COMMENT ON COLUMN wallet_transactions.amount IS
  'Positivo = crédito (el padre recibe saldo). '
  'Negativo = débito (el saldo se usa para pagar).';


-- ════════════════════════════════════════════════════════════════
-- PASO 3 — Tabla payment_sessions
-- ════════════════════════════════════════════════════════════════
-- El "contrato" entre el padre y el sistema de pago.
-- Se crea cuando el padre hace clic en "Pagar", capturando en
-- ese momento exacto las deudas y los montos (incluyendo el
-- wallet_balance disponible).
--
-- Esta misma tabla unifica DOS flujos de pago:
--   Flujo A (HOY):  padre sube voucher → admin aprueba
--                   gateway_name='voucher', voucher_url=<url>
--   Flujo B (futuro): padre paga por pasarela (Niubiz/Stripe)
--                   gateway_name='niubiz'|'stripe', gateway_reference=<charge_id>

CREATE TABLE IF NOT EXISTS payment_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Participantes ───────────────────────────────────────────────
  parent_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- El padre que inició el pago

  student_id      UUID NOT NULL REFERENCES students(id)   ON DELETE RESTRICT,
  -- El alumno cuya deuda se está pagando
  -- (un padre con varios hijos crea UNA sesión por hijo)

  school_id       UUID NOT NULL,

  -- Las deudas que se están intentando pagar ───────────────────
  debt_tx_ids     UUID[] NOT NULL DEFAULT '{}',
  -- Los UUIDs de las filas en `transactions` con payment_status='pending'
  -- que esta sesión intenta saldar.
  -- Se capturan y BLOQUEAN en el RPC initiate_web_payment.

  -- El split de montos calculado en el momento de crear la sesión
  total_debt_amount   NUMERIC(10,2) NOT NULL CHECK (total_debt_amount > 0),
  wallet_amount       NUMERIC(10,2) NOT NULL DEFAULT 0
                      CHECK (wallet_amount >= 0),
  gateway_amount      NUMERIC(10,2) NOT NULL CHECK (gateway_amount >= 0),
  -- Invariante: total_debt_amount = wallet_amount + gateway_amount
  -- (no lo hacemos CHECK para no bloquear correcciones de admin)

  -- Comprobante SUNAT (qué tipo quiere el padre) ────────────────
  invoice_type        TEXT CHECK (invoice_type IN ('ticket', 'boleta', 'factura')),
  invoice_client_data JSONB,
  -- { "tipo_documento": "DNI", "numero": "12345678",
  --   "nombre": "Ana García", "email": "ana@gmail.com" }
  -- Se guarda aquí porque entre la sesión y el webhook pueden
  -- pasar minutos; el modal no debe preguntarlo dos veces.

  -- ── FLUJO A: Voucher manual (hoy) ────────────────────────────
  voucher_url         TEXT,
  -- URL de la imagen subida a Supabase Storage
  -- NULL si se usa pasarela online

  admin_notes         TEXT,
  -- Notas del admin al aprobar o rechazar
  -- "Código de transferencia verificado en app del banco"

  reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Admin que aprobó o rechazó el voucher

  reviewed_at         TIMESTAMPTZ,

  -- ── FLUJO B: Pasarela online (futuro) ────────────────────────
  gateway_name        TEXT DEFAULT 'voucher',
  -- 'voucher' | 'niubiz' | 'stripe' | 'culqi'

  gateway_reference   TEXT,
  -- El charge_id / order_id de la pasarela (para idempotencia del webhook)
  -- NULL para el flujo de voucher

  gateway_payload     JSONB,
  -- Payload completo del webhook guardado para auditoría forense

  -- ── Ciclo de vida ─────────────────────────────────────────────
  status  TEXT NOT NULL DEFAULT 'initiated'
          CHECK (status IN (
            'initiated',          -- sesión creada, esperando acción
                                  -- (padre en pasarela O voucher subido esperando admin)
            'gateway_confirmed',  -- pasarela/admin confirmó el pago
                                  -- (solo para flujo online; el admin usa 'completed' directo)
            'completed',          -- BD procesada, transacciones marcadas paid, boleta generada
            'failed',             -- pago rechazado o error en procesamiento
            'expired'             -- caducó sin pago (>30 min para pasarela, >7 días para voucher)
          )),

  -- Resultado (se rellena cuando status='completed') ────────────
  fiscal_tx_id        UUID REFERENCES transactions(id) ON DELETE SET NULL,
  -- La transaction por gateway_amount que va a Nubefact
  -- NULL si gateway_amount = 0 (todo pagado con wallet)

  wallet_tx_id        UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  -- El wallet_transactions de tipo 'payment_debit' que usó el saldo
  -- NULL si wallet_amount = 0

  -- Timestamps ──────────────────────────────────────────────────
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL
                  DEFAULT now() + INTERVAL '30 minutes'
  -- Para vouchers manuales, el RPC initiate_web_payment puede sobreescribir
  -- expires_at a 7 días en lugar de 30 minutos.
);

COMMENT ON TABLE payment_sessions IS
  'Contrato padre↔sistema para cada intento de pago. '
  'Unifica el flujo actual de voucher manual y el futuro de pasarela online. '
  'Un padre con 2 hijos con deuda crea 2 sesiones separadas. '
  'La sesión "congela" el split wallet/gateway en el momento de creación '
  'para evitar race conditions entre frontend y webhook.';

-- FK diferida: ahora que payment_sessions existe, añadir la FK en wallet_transactions
ALTER TABLE wallet_transactions
  ADD CONSTRAINT fk_wallet_transactions_session
  FOREIGN KEY (applied_to_session_id)
  REFERENCES payment_sessions(id)
  ON DELETE SET NULL;

-- Constraint de unicidad para idempotencia del webhook
-- (solo aplica cuando hay referencia de pasarela real)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_sessions_gateway_ref_unique
  ON payment_sessions (gateway_reference)
  WHERE gateway_reference IS NOT NULL;


-- ════════════════════════════════════════════════════════════════
-- PASO 4 — Índices para rendimiento
-- ════════════════════════════════════════════════════════════════

-- wallet_transactions: las consultas más frecuentes son por student_id
CREATE INDEX IF NOT EXISTS idx_wallet_tx_student_id
  ON wallet_transactions (student_id, created_at DESC);
-- Cubre: "Dame el historial de la billetera del alumno X ordenado por fecha"

CREATE INDEX IF NOT EXISTS idx_wallet_tx_origin_tx
  ON wallet_transactions (origin_transaction_id)
  WHERE origin_transaction_id IS NOT NULL;
-- Cubre: "¿Esta transacción fiscal ya generó un crédito de wallet?"

CREATE INDEX IF NOT EXISTS idx_wallet_tx_origin_lunch
  ON wallet_transactions (origin_lunch_order_id)
  WHERE origin_lunch_order_id IS NOT NULL;
-- Cubre: "¿Este almuerzo ya fue anulado y se le acreditó al padre?"

CREATE INDEX IF NOT EXISTS idx_wallet_tx_session
  ON wallet_transactions (applied_to_session_id)
  WHERE applied_to_session_id IS NOT NULL;
-- Cubre: "¿Qué movimiento de wallet se usó en esta sesión de pago?"

-- payment_sessions: búsquedas por padre y por estado
CREATE INDEX IF NOT EXISTS idx_payment_sessions_parent_status
  ON payment_sessions (parent_id, status, created_at DESC);
-- Cubre: "Muéstrame las sesiones activas de este padre"

CREATE INDEX IF NOT EXISTS idx_payment_sessions_student
  ON payment_sessions (student_id, status);
-- Cubre: "¿Hay alguna sesión iniciada para este alumno?" (guard de doble pago)

CREATE INDEX IF NOT EXISTS idx_payment_sessions_expires
  ON payment_sessions (expires_at)
  WHERE status = 'initiated';
-- Cubre: el cron job que expira sesiones caducadas (Paso 6 futuro)

CREATE INDEX IF NOT EXISTS idx_payment_sessions_school_status
  ON payment_sessions (school_id, status, created_at DESC);
-- Cubre: "Admin ve todas las sesiones de voucher pendientes de su sede"


-- ════════════════════════════════════════════════════════════════
-- PASO 5 — Row Level Security
-- ════════════════════════════════════════════════════════════════

-- ── wallet_transactions ──────────────────────────────────────────

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Los padres ven SOLO la billetera de sus hijos
CREATE POLICY "wallet_tx_select_parent"
  ON wallet_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.id = wallet_transactions.student_id
        AND s.parent_id = auth.uid()
    )
  );

-- Los admins ven SOLO los movimientos de su sede
CREATE POLICY "wallet_tx_select_admin"
  ON wallet_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'gestor_unidad', 'supervisor_red',
                       'cajero', 'operador_caja', 'superadmin')
        AND (
          p.role IN ('admin_general', 'supervisor_red', 'superadmin')
          OR p.school_id = wallet_transactions.school_id
        )
    )
  );

-- INSERT y UPDATE: BLOQUEADOS para todos desde el cliente.
-- Solo los RPCs SECURITY DEFINER (adjust_student_wallet_balance,
-- cancel_lunch_order_with_wallet_credit, complete_web_payment)
-- pueden escribir en esta tabla.
-- service_role siempre puede (para migraciones y correcciones).
CREATE POLICY "wallet_tx_insert_service_only"
  ON wallet_transactions FOR INSERT
  TO authenticated
  WITH CHECK (false);
-- false = nadie autenticado puede insertar directamente.
-- Los RPCs SECURITY DEFINER corren como el owner (superuser), no como 'authenticated'.

CREATE POLICY "wallet_tx_no_update"
  ON wallet_transactions FOR UPDATE
  TO authenticated
  USING (false);
-- Esta tabla es append-only. Nadie puede editar filas.

CREATE POLICY "wallet_tx_no_delete"
  ON wallet_transactions FOR DELETE
  TO authenticated
  USING (false);
-- Esta tabla es permanente. Nadie puede borrar filas.


-- ── payment_sessions ─────────────────────────────────────────────

ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;

-- Padres: ven SOLO sus propias sesiones
CREATE POLICY "sessions_select_parent"
  ON payment_sessions FOR SELECT
  TO authenticated
  USING (parent_id = auth.uid());

-- Admins: ven todas las sesiones de su sede (para aprobar vouchers)
CREATE POLICY "sessions_select_admin"
  ON payment_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'gestor_unidad', 'supervisor_red',
                       'cajero', 'operador_caja', 'superadmin')
        AND (
          p.role IN ('admin_general', 'supervisor_red', 'superadmin')
          OR p.school_id = payment_sessions.school_id
        )
    )
  );

-- Padres: pueden CREAR sus propias sesiones (cuando hacen clic en "Pagar")
-- El RPC initiate_web_payment lo hace vía SECURITY DEFINER,
-- pero dejamos la política abierta por si el RPC delega el INSERT al cliente.
CREATE POLICY "sessions_insert_parent"
  ON payment_sessions FOR INSERT
  TO authenticated
  WITH CHECK (parent_id = auth.uid());

-- UPDATE: BLOQUEADO para el cliente.
-- Solo los RPCs (complete_web_payment, expire_payment_sessions)
-- y el admin (para aprobar/rechazar vouchers) pueden actualizar.
-- El admin solo puede actualizar su propia sede y solo campos permitidos.
CREATE POLICY "sessions_update_admin_review"
  ON payment_sessions FOR UPDATE
  TO authenticated
  USING (
    -- El admin solo puede tocar sesiones de su sede
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'gestor_unidad', 'cajero',
                       'operador_caja', 'superadmin', 'supervisor_red')
        AND (
          p.role IN ('admin_general', 'supervisor_red', 'superadmin')
          OR p.school_id = payment_sessions.school_id
        )
    )
  )
  WITH CHECK (
    -- Solo puede cambiar status a 'completed' o 'failed' (aprobar/rechazar voucher)
    -- No puede cambiar montos, deudas ni datos del padre
    status IN ('completed', 'failed')
  );

-- DELETE: nadie puede borrar sesiones (historial inmutable)
CREATE POLICY "sessions_no_delete"
  ON payment_sessions FOR DELETE
  TO authenticated
  USING (false);


-- ════════════════════════════════════════════════════════════════
-- PASO 6 — Verificación final
-- ════════════════════════════════════════════════════════════════
-- Ejecuta este SELECT después de correr el script para confirmar
-- que todo se creó correctamente:

SELECT
  'students.wallet_balance'                       AS objeto,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='students' AND column_name='wallet_balance'
  ) THEN '✅ Existe' ELSE '❌ FALTA' END          AS estado

UNION ALL SELECT
  'tabla wallet_transactions',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name='wallet_transactions'
  ) THEN '✅ Existe' ELSE '❌ FALTA' END

UNION ALL SELECT
  'tabla payment_sessions',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name='payment_sessions'
  ) THEN '✅ Existe' ELSE '❌ FALTA' END

UNION ALL SELECT
  'RLS wallet_transactions',
  CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE relname='wallet_transactions')
  THEN '✅ Activo' ELSE '❌ DESACTIVADO' END

UNION ALL SELECT
  'RLS payment_sessions',
  CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE relname='payment_sessions')
  THEN '✅ Activo' ELSE '❌ DESACTIVADO' END

UNION ALL SELECT
  'Índices wallet_transactions (esperados: 4)',
  COUNT(*)::text || ' índices creados'
  FROM pg_indexes
  WHERE tablename = 'wallet_transactions'
    AND indexname LIKE 'idx_wallet_tx%'

UNION ALL SELECT
  'Índices payment_sessions (esperados: 5)',
  COUNT(*)::text || ' índices creados'
  FROM pg_indexes
  WHERE tablename = 'payment_sessions'
    AND indexname LIKE 'idx_payment_sessions%';
