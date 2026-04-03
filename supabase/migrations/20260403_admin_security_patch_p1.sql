-- ================================================================
-- ADMIN SECURITY PATCH — FASE 1
-- Fecha: 2026-04-03
--
-- V7.2  cash_sessions: SELECT/INSERT/UPDATE restringido por rol y sede
-- V6.3  product_stock: escritura solo para admin/gestor (no cajero)
-- V6.2  product_stock: CHECK (current_stock >= 0) — prohíbe stock negativo
-- V5.1  transaction_items: RLS + trigger inmutable (DELETE bloqueado para todos)
-- ================================================================


-- ================================================================
-- V7.2 — RLS de cash_sessions: profesores y padres bloqueados
-- ================================================================
-- Política de selección reutilizable (expresión)
-- Un usuario puede ver sesiones de caja SI:
--   a) Es admin_general o superadmin  →  ve todas las sedes
--   b) Es cajero / gestor / operador  →  solo su propia sede
--   c) Cualquier otro rol (teacher, parent, etc.) → bloqueado

DROP POLICY IF EXISTS "cash_sessions_select"             ON cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_insert"             ON cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_update"             ON cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_select_restricted"  ON cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_insert_restricted"  ON cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_update_restricted"  ON cash_sessions;

-- ── SELECT ──────────────────────────────────────────────────────
CREATE POLICY "cash_sessions_select_restricted" ON cash_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin',
                       'gestor_unidad','cajero','operador_caja')
        AND (
          -- Admins globales ven todas las sedes
          p.role IN ('admin_general','superadmin')
          OR
          -- El resto solo ve su propia sede
          p.school_id = cash_sessions.school_id
        )
    )
  );

-- ── INSERT ──────────────────────────────────────────────────────
-- Solo personal autorizado puede abrir una sesión de caja,
-- y solo para su propia sede (excepto admins globales).
CREATE POLICY "cash_sessions_insert_restricted" ON cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin',
                       'gestor_unidad','cajero','operador_caja')
        AND (
          p.role IN ('admin_general','superadmin')
          OR p.school_id = cash_sessions.school_id
        )
    )
  );

-- ── UPDATE ──────────────────────────────────────────────────────
-- Solo el personal de esa sede puede cerrar / reconciliar su caja.
CREATE POLICY "cash_sessions_update_restricted" ON cash_sessions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin',
                       'gestor_unidad','cajero','operador_caja')
        AND (
          p.role IN ('admin_general','superadmin')
          OR p.school_id = cash_sessions.school_id
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin',
                       'gestor_unidad','cajero','operador_caja')
        AND (
          p.role IN ('admin_general','superadmin')
          OR p.school_id = cash_sessions.school_id
        )
    )
  );

SELECT 'V7.2 ✅ cash_sessions: RLS restringido por rol y sede' AS resultado;


-- ================================================================
-- V6.3 — product_stock: quitar escritura a cajero/operador_caja
-- ================================================================
-- Antes: cajero/operador_caja tenían FOR ALL (incluyendo UPDATE/DELETE directo).
-- Ahora: solo admin_general, superadmin y gestor_unidad pueden modificar stock.
-- cajero y operador_caja conservan solo SELECT (necesario para mostrar stock en POS).
-- Los RPCs con SECURITY DEFINER (complete_pos_sale_v2, etc.) no se ven afectados
-- porque SECURITY DEFINER bypasea RLS completamente.

DROP POLICY IF EXISTS "product_stock_write_admin"      ON product_stock;
DROP POLICY IF EXISTS "product_stock_write_admin_only" ON product_stock;

-- Mantener SELECT para todos los roles autenticados (POS necesita leer stock)
-- (La policy "product_stock_read_auth" ya existe y sigue vigente)

-- Nueva policy de escritura: solo roles con responsabilidad de inventario
CREATE POLICY "product_stock_write_admin_only" ON product_stock
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

SELECT 'V6.3 ✅ product_stock: escritura restringida a admin/gestor_unidad' AS resultado;


-- ================================================================
-- V6.2 — product_stock: CHECK (current_stock >= 0)
-- ================================================================
-- Primero corregimos cualquier valor negativo existente a 0
-- para que el constraint no falle al añadirse.
-- Registramos cuántos fueron corregidos.
DO $$
DECLARE
  v_count integer;
BEGIN
  UPDATE product_stock SET current_stock = 0 WHERE current_stock < 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE NOTICE 'CORRECCIÓN PREVIA: % fila(s) con stock negativo reseteada(s) a 0.', v_count;
  END IF;
END;
$$;

ALTER TABLE product_stock
  DROP CONSTRAINT IF EXISTS chk_stock_non_negative;

ALTER TABLE product_stock
  ADD CONSTRAINT chk_stock_non_negative
    CHECK (current_stock >= 0);

SELECT 'V6.2 ✅ product_stock: CHECK (current_stock >= 0) aplicado' AS resultado;


-- ================================================================
-- V5.1 — transaction_items: historial financiero INMUTABLE
-- ================================================================
-- Estrategia de doble cierre:
--   Capa 1 (RLS): bloquea DELETE para cualquier usuario 'authenticated'.
--   Capa 2 (Trigger BEFORE DELETE): bloquea a TODOS, incluyendo service_role
--             y cualquier acceso directo a Postgres.
--   Capa 3 (Trigger BEFORE TRUNCATE): impide vaciar la tabla en bloque.
-- Los INSERT legítimos vienen exclusivamente desde RPCs SECURITY DEFINER
-- (complete_pos_sale_v2), que bypasean RLS → no se ven afectados.

-- ── Habilitar RLS (si no estaba activado) ────────────────────────
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

-- ── Limpiar políticas anteriores si existieran ───────────────────
DROP POLICY IF EXISTS "transaction_items_select"          ON transaction_items;
DROP POLICY IF EXISTS "transaction_items_insert"          ON transaction_items;
DROP POLICY IF EXISTS "transaction_items_delete"          ON transaction_items;
DROP POLICY IF EXISTS "transaction_items_select_by_role"  ON transaction_items;
DROP POLICY IF EXISTS "transaction_items_insert_rpc_only" ON transaction_items;

-- ── SELECT: mirrors las mismas reglas que transactions ───────────
-- admin_general/superadmin → todas las sedes
-- gestor/cajero/operador   → solo items de transacciones de su sede
-- parent                   → solo items de transacciones de sus hijos
-- teacher                  → solo items de sus propias transacciones
CREATE POLICY "transaction_items_select_by_role" ON transaction_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          -- Admins globales ven todo
          p.role IN ('admin_general','superadmin')

          -- Personal de sede ve items de su sede
          OR (
            p.role IN ('gestor_unidad','cajero','operador_caja')
            AND EXISTS (
              SELECT 1 FROM transactions t
              WHERE t.id = transaction_items.transaction_id
                AND t.school_id = p.school_id
            )
          )

          -- Padre ve items de transacciones de sus hijos
          OR (
            p.role = 'parent'
            AND EXISTS (
              SELECT 1 FROM transactions t
              JOIN students s ON s.id = t.student_id
              WHERE t.id = transaction_items.transaction_id
                AND s.parent_id = p.id
            )
          )

          -- Profesor ve items de sus propias compras
          OR (
            p.role = 'teacher'
            AND EXISTS (
              SELECT 1 FROM transactions t
              WHERE t.id = transaction_items.transaction_id
                AND t.teacher_id = p.id
            )
          )
        )
    )
  );

-- ── INSERT: bloqueado para usuarios authenticated ─────────────────
-- Los únicos inserts válidos vienen de RPCs SECURITY DEFINER que
-- corren como postgres (superusuario) y bypasean RLS.
-- Si alguien intenta un INSERT directo desde el cliente, es rechazado.
CREATE POLICY "transaction_items_insert_rpc_only" ON transaction_items
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ── CAPA 2: Trigger BEFORE DELETE (nivel base de datos) ──────────
-- Este trigger se activa para CUALQUIER operación de borrado,
-- incluso desde service_role, dashboard de Supabase o conexión directa.
-- Loguea el intento en huella_digital_logs antes de bloquearlo.
CREATE OR REPLACE FUNCTION fn_block_transaction_items_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  -- Intentar capturar el uid del llamador (puede ser null con service_role)
  BEGIN
    v_caller_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := NULL;
  END;

  -- Registrar el intento en el log forense (si la tabla existe)
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      detalles_tecnicos,
      contexto,
      school_id,
      creado_at
    )
    SELECT
      v_caller_id,
      'INTENTO_DELETE_HISTORIAL_FINANCIERO',
      'TRANSACTION_ITEMS',
      jsonb_build_object(
        'origen',         'trigger_bd',
        'alerta',         'Intento de borrado de ítem de venta — BLOQUEADO',
        'criticidad',     'ALTA'
      ),
      jsonb_build_object(
        'transaction_item_id',  OLD.id,
        'transaction_id',       OLD.transaction_id,
        'product_id',           OLD.product_id,
        'product_name',         OLD.product_name,
        'quantity',             OLD.quantity,
        'unit_price',           OLD.unit_price,
        'subtotal',             OLD.subtotal
      ),
      (SELECT school_id FROM transactions WHERE id = OLD.transaction_id LIMIT 1),
      clock_timestamp()
    FROM transactions t WHERE t.id = OLD.transaction_id LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    -- Si el log falla (tabla no existe, etc.) no impedir el bloqueo
    NULL;
  END;

  RAISE EXCEPTION
    'DELETE_FORBIDDEN: El historial de ítems de venta es INMUTABLE. '
    'Para anular una venta usa una transacción inversa, nunca borra el original. '
    'Intento bloqueado y registrado en huella_digital_logs. '
    'Ítem: %, Transacción: %',
    OLD.id, OLD.transaction_id;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_transaction_items_delete ON transaction_items;
CREATE TRIGGER trg_block_transaction_items_delete
  BEFORE DELETE ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_transaction_items_delete();

-- ── CAPA 3: Trigger BEFORE TRUNCATE (bloquea borrado masivo) ─────
CREATE OR REPLACE FUNCTION fn_block_transaction_items_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'TRUNCATE_FORBIDDEN: La tabla transaction_items es inmutable por diseño. '
    'No se puede vaciar el historial de ventas.';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_transaction_items_truncate ON transaction_items;
CREATE TRIGGER trg_block_transaction_items_truncate
  BEFORE TRUNCATE ON transaction_items
  EXECUTE FUNCTION fn_block_transaction_items_truncate();

SELECT 'V5.1 ✅ transaction_items: RLS + 2 triggers INMUTABILIDAD aplicados' AS resultado;


-- ================================================================
-- VERIFICACIÓN FINAL
-- ================================================================
SELECT
  '20260403_admin_security_patch_p1' AS migracion,
  'V7.2 — cash_sessions RLS sellado (teachers/parents bloqueados)' AS parche
UNION ALL SELECT '20260403_admin_security_patch_p1',
  'V6.3 — product_stock escritura: solo admin_general / superadmin / gestor_unidad'
UNION ALL SELECT '20260403_admin_security_patch_p1',
  'V6.2 — product_stock CHECK (current_stock >= 0) activo'
UNION ALL SELECT '20260403_admin_security_patch_p1',
  'V5.1 — transaction_items INMUTABLE: RLS + trg DELETE + trg TRUNCATE';
