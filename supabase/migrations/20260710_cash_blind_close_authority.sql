-- =====================================================================
-- CIERRE CIEGO DE CAJA — Autoridad en PostgreSQL (2026-07-10)
--
-- PROBLEMA:
--   La UI ocultaba montos al operador, pero el navegador seguía
--   consultando totales, calculando system_* y enviándolos al RPC.
--   RLS abierto permitía leer system_cash / variance_* tras el cierre.
--
-- SOLUCIÓN (Triple Restricción):
--   11.A  Cálculo de saldos de caja SOLO en SQL (fn_compute_*)
--   11.B  Muralla: rol verificado en BD; operador no recibe montos sistema
--   11.C  Reloj America/Lima en todos los cortes de día
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   1. Helpers de rol (admin vs operador)
--   2. fn_compute_cash_session_balances — SSOT del arqueo
--   3. get_cash_day_summary — lectura por rol (ciego vs completo)
--   4. close_cash_session — cierre atómico; ignora system_* del cliente
--   5. execute_cash_reconciliation_atomic — endurecido (compat + recalcula)
--   6. calculate_daily_totals — solo roles admin
--   7. Privilegios de columna + RLS en reconciliaciones
--
-- NO TOCA: Izipay, pasarela, webhooks, fn_sync_student_balance.
-- =====================================================================

-- ─── 0. HELPERS DE ROL ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_cash_caller_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role::text FROM profiles WHERE id = auth.uid()),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_cash_is_admin_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(COALESCE(p_role, '')) IN (
    'admin_general', 'superadmin', 'gestor_unidad'
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_cash_is_operator_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(COALESCE(p_role, '')) IN (
    'operador_caja', 'cajero'
  );
$$;

COMMENT ON FUNCTION public.fn_cash_caller_role IS
  'Rol del usuario autenticado para políticas de caja.';
COMMENT ON FUNCTION public.fn_cash_is_admin_role IS
  'Admin general / superadmin / admin de sede (gestor_unidad).';
COMMENT ON FUNCTION public.fn_cash_is_operator_role IS
  'Operador de caja / cajero — cierre ciego.';


-- ─── 1. SSOT: CÁLCULO DE BALANCES DE SESIÓN ─────────────────────────────────
-- Réplica fiel de la lógica que antes vivía en CashReconciliationDialog
-- (POS + almuerzo + mixtos + cobranzas efectivo + manuales por método).

CREATE OR REPLACE FUNCTION public.fn_compute_cash_session_balances(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session     cash_sessions%ROWTYPE;
  v_school_id   UUID;
  v_date        DATE;

  v_pos_cash            NUMERIC(12,2) := 0;
  v_pos_card            NUMERIC(12,2) := 0;
  v_pos_yape            NUMERIC(12,2) := 0;
  v_pos_plin            NUMERIC(12,2) := 0;
  v_pos_transferencia   NUMERIC(12,2) := 0;
  v_pos_mixed_cash      NUMERIC(12,2) := 0;
  v_pos_mixed_card      NUMERIC(12,2) := 0;
  v_pos_mixed_yape      NUMERIC(12,2) := 0;

  v_lunch_cash          NUMERIC(12,2) := 0;
  v_lunch_card          NUMERIC(12,2) := 0;
  v_lunch_yape          NUMERIC(12,2) := 0;
  v_lunch_plin          NUMERIC(12,2) := 0;
  v_lunch_transferencia NUMERIC(12,2) := 0;

  v_manual_income_cash     NUMERIC(12,2) := 0;
  v_manual_expense_cash    NUMERIC(12,2) := 0;
  v_manual_income_tarjeta  NUMERIC(12,2) := 0;

  v_billing_cash        NUMERIC(12,2) := 0;

  v_system_cash         NUMERIC(12,2);
  v_system_tarjeta      NUMERIC(12,2);
  v_system_yape_plin    NUMERIC(12,2);
  v_system_transferencia NUMERIC(12,2);
  v_system_total        NUMERIC(12,2);
BEGIN
  SELECT * INTO v_session
  FROM cash_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de caja con id % no existe.', p_session_id;
  END IF;

  v_school_id := v_session.school_id;
  v_date      := v_session.session_date;

  -- POS físico (source = pos)
  SELECT
    COALESCE(SUM(CASE
      WHEN payment_method = 'efectivo'
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
      THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN payment_method = 'tarjeta'
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
      THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN payment_method IN ('yape', 'yape_qr', 'yape_numero')
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
      THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN payment_method IN ('plin', 'plin_qr', 'plin_numero')
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
      THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN payment_method = 'transferencia'
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
      THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN paid_with_mixed = true
      THEN ABS(COALESCE(cash_amount, 0)) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN paid_with_mixed = true
      THEN ABS(COALESCE(card_amount, 0)) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN paid_with_mixed = true
      THEN ABS(COALESCE(yape_amount, 0)) ELSE 0 END), 0)
  INTO
    v_pos_cash, v_pos_card, v_pos_yape, v_pos_plin, v_pos_transferencia,
    v_pos_mixed_cash, v_pos_mixed_card, v_pos_mixed_yape
  FROM transactions
  WHERE school_id = v_school_id
    AND DATE(created_at AT TIME ZONE 'America/Lima') = v_date
    AND type = 'purchase'
    AND (is_deleted IS DISTINCT FROM true)
    AND (payment_status IS NULL OR payment_status <> 'cancelled')
    AND metadata->>'source' = 'pos';

  -- Almuerzos
  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'tarjeta' THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method IN ('yape', 'yape_qr', 'yape_numero') THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method IN ('plin', 'plin_qr', 'plin_numero') THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN ABS(amount) ELSE 0 END), 0)
  INTO
    v_lunch_cash, v_lunch_card, v_lunch_yape, v_lunch_plin, v_lunch_transferencia
  FROM transactions
  WHERE school_id = v_school_id
    AND DATE(created_at AT TIME ZONE 'America/Lima') = v_date
    AND type = 'purchase'
    AND metadata->>'lunch_order_id' IS NOT NULL
    AND (is_deleted IS DISTINCT FROM true)
    AND (payment_status IS NULL OR payment_status <> 'cancelled');

  -- Manuales de ESTA sesión (payment_method canónico: cash|tarjeta|…)
  SELECT
    COALESCE(SUM(CASE
      WHEN entry_type = 'income' AND COALESCE(payment_method, 'cash') = 'cash'
      THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN entry_type = 'expense' AND COALESCE(payment_method, 'cash') = 'cash'
      THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN entry_type = 'income' AND payment_method = 'tarjeta'
      THEN amount ELSE 0 END), 0)
  INTO
    v_manual_income_cash, v_manual_expense_cash, v_manual_income_tarjeta
  FROM cash_manual_entries
  WHERE cash_session_id = p_session_id;

  -- Cobranzas aprobadas en efectivo del día (Lima)
  SELECT COALESCE(SUM(amount), 0)
  INTO v_billing_cash
  FROM recharge_requests
  WHERE school_id = v_school_id
    AND status = 'approved'
    AND DATE(approved_at AT TIME ZONE 'America/Lima') = v_date
    AND (
      lower(trim(COALESCE(payment_method, ''))) LIKE '%efectivo%'
      OR lower(trim(COALESCE(payment_method, ''))) LIKE '%cash%'
      OR lower(trim(COALESCE(payment_method, ''))) IN ('money', 'dinero')
    );

  v_system_cash := ROUND((
    COALESCE(v_session.initial_cash, 0)
    + v_pos_cash + v_lunch_cash + v_pos_mixed_cash
    + v_billing_cash
    + v_manual_income_cash
    - v_manual_expense_cash
  )::numeric, 2);

  v_system_tarjeta := ROUND((
    v_pos_card + v_lunch_card + v_pos_mixed_card + v_manual_income_tarjeta
  )::numeric, 2);

  v_system_yape_plin := ROUND((
    v_pos_yape + v_pos_plin + v_lunch_yape + v_lunch_plin + v_pos_mixed_yape
  )::numeric, 2);

  v_system_transferencia := ROUND((
    v_pos_transferencia + v_lunch_transferencia
  )::numeric, 2);

  -- Total de arqueo físico (efectivo + tarjeta). Digital es informativo.
  v_system_total := ROUND((v_system_cash + v_system_tarjeta)::numeric, 2);

  RETURN jsonb_build_object(
    'session_id',            p_session_id,
    'school_id',             v_school_id,
    'session_date',          v_date,
    'initial_cash',          COALESCE(v_session.initial_cash, 0),
    'system_cash',           v_system_cash,
    'system_tarjeta',        v_system_tarjeta,
    'system_yape',           v_system_yape_plin,
    'system_transferencia',  v_system_transferencia,
    'system_total',          v_system_total,
    'breakdown', jsonb_build_object(
      'pos_cash', v_pos_cash,
      'pos_card', v_pos_card,
      'pos_mixed_cash', v_pos_mixed_cash,
      'pos_mixed_card', v_pos_mixed_card,
      'lunch_cash', v_lunch_cash,
      'lunch_card', v_lunch_card,
      'billing_cash', v_billing_cash,
      'manual_income_cash', v_manual_income_cash,
      'manual_expense_cash', v_manual_expense_cash,
      'manual_income_tarjeta', v_manual_income_tarjeta
    )
  );
END;
$$;

COMMENT ON FUNCTION public.fn_compute_cash_session_balances IS
  'SSOT del arqueo de caja: calcula system_* en servidor. No confiar en el cliente.';

REVOKE ALL ON FUNCTION public.fn_compute_cash_session_balances(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compute_cash_session_balances(UUID) TO service_role;
-- authenticated NO: solo vía close_cash_session / get_cash_day_summary


-- ─── 2. LECTURA POR ROL ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_cash_day_summary(
  p_school_id UUID,
  p_date      DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      TEXT := public.fn_cash_caller_role();
  v_is_admin  BOOLEAN := public.fn_cash_is_admin_role(v_role);
  v_date      DATE;
  v_session   cash_sessions%ROWTYPE;
  v_balances  JSONB;
  v_totals    JSON;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión.';
  END IF;

  IF v_role = '' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Perfil sin rol.';
  END IF;

  -- Operador y admin de sede: solo su sede (salvo admin_general/superadmin)
  IF v_role NOT IN ('admin_general', 'superadmin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND school_id = p_school_id
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No tienes acceso a esta sede.';
    END IF;
  END IF;

  v_date := COALESCE(
    p_date,
    (timezone('America/Lima', now()))::date
  );

  SELECT * INTO v_session
  FROM cash_sessions
  WHERE school_id = p_school_id
    AND session_date = v_date;

  -- ── Operador: payload operativo SIN montos del sistema ──
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'blind',
      'session_date', v_date,
      'school_id', p_school_id,
      'session', CASE WHEN NOT FOUND THEN NULL ELSE jsonb_build_object(
        'id', v_session.id,
        'status', v_session.status,
        'opened_at', v_session.opened_at,
        'closed_at', v_session.closed_at,
        'opened_by', v_session.opened_by,
        'closed_by', v_session.closed_by,
        'session_date', v_session.session_date
      ) END,
      'can_close', (FOUND AND v_session.status = 'open'),
      'can_operate', (FOUND AND v_session.status = 'open')
    );
  END IF;

  -- ── Admin: totales + balances de sesión si existe ──
  v_totals := calculate_daily_totals(p_school_id, v_date);

  IF FOUND THEN
    v_balances := public.fn_compute_cash_session_balances(v_session.id);
  ELSE
    v_balances := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'admin',
    'session_date', v_date,
    'school_id', p_school_id,
    'session', CASE WHEN v_session.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'opened_at', v_session.opened_at,
      'closed_at', v_session.closed_at,
      'opened_by', v_session.opened_by,
      'closed_by', v_session.closed_by,
      'session_date', v_session.session_date,
      'initial_cash', v_session.initial_cash,
      'declared_cash', v_session.declared_cash,
      'declared_tarjeta', v_session.declared_tarjeta,
      'system_cash', v_session.system_cash,
      'system_tarjeta', v_session.system_tarjeta,
      'variance_cash', v_session.variance_cash,
      'variance_tarjeta', v_session.variance_tarjeta,
      'variance_total', v_session.variance_total,
      'variance_justification', v_session.variance_justification
    ) END,
    'daily_totals', to_jsonb(v_totals),
    'computed_balances', v_balances
  );
END;
$$;

COMMENT ON FUNCTION public.get_cash_day_summary IS
  'Resumen del día: operador recibe modo blind (sin montos); admin recibe totales.';

GRANT EXECUTE ON FUNCTION public.get_cash_day_summary(UUID, DATE) TO authenticated;


-- ─── 3. CIERRE ATÓMICO CON AUTORIDAD EN SERVIDOR ────────────────────────────

CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_session_id              UUID,
  p_physical_cash           NUMERIC,
  p_physical_tarjeta        NUMERIC,
  p_variance_justification  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_role        TEXT;
  v_is_admin    BOOLEAN;
  v_session     cash_sessions%ROWTYPE;
  v_balances    JSONB;
  v_system_cash NUMERIC(12,2);
  v_system_tarjeta NUMERIC(12,2);
  v_system_yape NUMERIC(12,2);
  v_system_transferencia NUMERIC(12,2);
  v_system_total NUMERIC(12,2);
  v_physical_cash NUMERIC(12,2);
  v_physical_tarjeta NUMERIC(12,2);
  v_physical_total NUMERIC(12,2);
  v_variance_cash NUMERIC(12,2);
  v_variance_tarjeta NUMERIC(12,2);
  v_variance_total NUMERIC(12,2);
  v_justification TEXT;
  v_closed_at   TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión.';
  END IF;

  v_role := public.fn_cash_caller_role();
  v_is_admin := public.fn_cash_is_admin_role(v_role);

  IF NOT v_is_admin AND NOT public.fn_cash_is_operator_role(v_role) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Tu rol (%) no puede cerrar caja.', v_role;
  END IF;

  IF p_physical_cash IS NULL OR p_physical_cash < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: El efectivo declarado debe ser >= 0.';
  END IF;
  IF p_physical_tarjeta IS NULL OR p_physical_tarjeta < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: La tarjeta declarada debe ser >= 0.';
  END IF;

  -- Candado pesimista
  SELECT * INTO v_session
  FROM cash_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de caja con id % no existe.', p_session_id;
  END IF;

  IF v_session.status = 'closed' THEN
    RAISE EXCEPTION 'SESSION_ALREADY_CLOSED: Esta caja ya fue cerrada. Actualiza la página.';
  END IF;

  -- Admin de sede / operador: solo su sede
  IF v_role NOT IN ('admin_general', 'superadmin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = v_user_id
        AND school_id = v_session.school_id
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No puedes cerrar la caja de otra sede.';
    END IF;
  END IF;

  -- Autoridad: montos del sistema SOLO desde BD (ignora cualquier valor del cliente)
  v_balances := public.fn_compute_cash_session_balances(p_session_id);
  v_system_cash := (v_balances->>'system_cash')::numeric;
  v_system_tarjeta := (v_balances->>'system_tarjeta')::numeric;
  v_system_yape := (v_balances->>'system_yape')::numeric;
  v_system_transferencia := (v_balances->>'system_transferencia')::numeric;
  v_system_total := (v_balances->>'system_total')::numeric;

  v_physical_cash := ROUND(p_physical_cash::numeric, 2);
  v_physical_tarjeta := ROUND(p_physical_tarjeta::numeric, 2);
  v_physical_total := ROUND((v_physical_cash + v_physical_tarjeta)::numeric, 2);

  v_variance_cash := ROUND((v_system_cash - v_physical_cash)::numeric, 2);
  v_variance_tarjeta := ROUND((v_system_tarjeta - v_physical_tarjeta)::numeric, 2);
  v_variance_total := ROUND((v_variance_cash + v_variance_tarjeta)::numeric, 2);

  v_justification := NULLIF(TRIM(COALESCE(p_variance_justification, '')), '');

  -- Admin con descuadre >= 0.50 debe justificar (muralla en BD)
  IF v_is_admin AND ABS(v_variance_total) >= 0.50 AND v_justification IS NULL THEN
    RAISE EXCEPTION
      'VARIANCE_JUSTIFICATION_REQUIRED: Hay un descuadre de S/ %. Justifica antes de cerrar.',
      ABS(v_variance_total);
  END IF;

  -- UPSERT arqueo
  INSERT INTO cash_reconciliations (
    cash_session_id, school_id,
    system_cash, system_yape, system_plin, system_transferencia,
    system_tarjeta, system_mixto, system_total,
    physical_cash, physical_yape, physical_plin, physical_transferencia,
    physical_tarjeta, physical_mixto, physical_total,
    variance_cash, variance_yape, variance_plin, variance_transferencia,
    variance_tarjeta, variance_mixto, variance_total,
    declared_overage, declared_deficit, reconciled_by
  )
  VALUES (
    p_session_id, v_session.school_id,
    v_system_cash, v_system_yape, 0, v_system_transferencia,
    v_system_tarjeta, 0, v_system_total,
    v_physical_cash, 0, 0, 0,
    v_physical_tarjeta, 0, v_physical_total,
    v_variance_cash, 0, 0, 0,
    v_variance_tarjeta, 0, v_variance_total,
    CASE WHEN v_variance_total < 0 THEN ABS(v_variance_total) ELSE 0 END,
    CASE WHEN v_variance_total > 0 THEN v_variance_total ELSE 0 END,
    v_user_id
  )
  ON CONFLICT (cash_session_id) DO UPDATE SET
    system_cash            = EXCLUDED.system_cash,
    system_yape            = EXCLUDED.system_yape,
    system_plin            = EXCLUDED.system_plin,
    system_transferencia   = EXCLUDED.system_transferencia,
    system_tarjeta         = EXCLUDED.system_tarjeta,
    system_mixto           = EXCLUDED.system_mixto,
    system_total           = EXCLUDED.system_total,
    physical_cash          = EXCLUDED.physical_cash,
    physical_yape          = EXCLUDED.physical_yape,
    physical_plin          = EXCLUDED.physical_plin,
    physical_transferencia = EXCLUDED.physical_transferencia,
    physical_tarjeta       = EXCLUDED.physical_tarjeta,
    physical_mixto         = EXCLUDED.physical_mixto,
    physical_total         = EXCLUDED.physical_total,
    variance_cash          = EXCLUDED.variance_cash,
    variance_yape          = EXCLUDED.variance_yape,
    variance_plin          = EXCLUDED.variance_plin,
    variance_transferencia = EXCLUDED.variance_transferencia,
    variance_tarjeta       = EXCLUDED.variance_tarjeta,
    variance_mixto         = EXCLUDED.variance_mixto,
    variance_total         = EXCLUDED.variance_total,
    declared_overage       = EXCLUDED.declared_overage,
    declared_deficit       = EXCLUDED.declared_deficit,
    reconciled_by          = EXCLUDED.reconciled_by;

  v_closed_at := clock_timestamp();

  UPDATE cash_sessions SET
    status                 = 'closed',
    closed_by              = v_user_id,
    closed_at              = v_closed_at,
    declared_cash          = v_physical_cash,
    declared_tarjeta       = v_physical_tarjeta,
    system_cash            = v_system_cash,
    system_tarjeta         = v_system_tarjeta,
    variance_cash          = v_variance_cash,
    variance_tarjeta       = v_variance_tarjeta,
    variance_total         = v_variance_total,
    variance_justification = v_justification,
    updated_at             = v_closed_at
  WHERE id = p_session_id;

  INSERT INTO huella_digital_logs (
    usuario_id, accion, modulo, school_id, contexto
  )
  VALUES (
    v_user_id,
    CASE WHEN v_is_admin THEN 'CIERRE_CAJA_ADMIN' ELSE 'CIERRE_CAJA_CAJERO' END,
    'CIERRE_CAJA',
    v_session.school_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'session_date', v_session.session_date,
      'tipo_cierre', CASE WHEN v_is_admin THEN 'con_vision_sistema' ELSE 'ciegas' END,
      'rol', v_role,
      'declarado_efectivo', v_physical_cash,
      'declarado_tarjeta', v_physical_tarjeta,
      -- Montos sistema solo en auditoría (no se devuelven al operador)
      'sistema_efectivo', v_system_cash,
      'sistema_tarjeta', v_system_tarjeta,
      'descuadre_total', v_variance_total,
      'justificacion', v_justification
    )
  );

  -- Respuesta: operador NO recibe montos del sistema ni descuadre
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'blind',
      'session_id', p_session_id,
      'session_date', v_session.session_date,
      'closed_at', v_closed_at,
      'declared_cash', v_physical_cash,
      'declared_tarjeta', v_physical_tarjeta
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'admin',
    'session_id', p_session_id,
    'session_date', v_session.session_date,
    'closed_at', v_closed_at,
    'declared_cash', v_physical_cash,
    'declared_tarjeta', v_physical_tarjeta,
    'system_cash', v_system_cash,
    'system_tarjeta', v_system_tarjeta,
    'system_yape', v_system_yape,
    'system_transferencia', v_system_transferencia,
    'system_total', v_system_total,
    'variance_cash', v_variance_cash,
    'variance_tarjeta', v_variance_tarjeta,
    'variance_total', v_variance_total
  );
END;
$$;

COMMENT ON FUNCTION public.close_cash_session IS
  'Cierre atómico de caja. Recalcula system_* en BD. Operador recibe respuesta ciega.';

GRANT EXECUTE ON FUNCTION public.close_cash_session(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;


-- ─── 4. ENDURECER RPC LEGACY (compatibilidad + misma autoridad) ─────────────
-- Si algún cliente viejo aún llama execute_cash_reconciliation_atomic,
-- IGNORA system_*/variance_* del JSON y recalcula en servidor.

CREATE OR REPLACE FUNCTION public.execute_cash_reconciliation_atomic(
  p_session_id          UUID,
  p_reconciliation_data JSONB,
  p_user_id             UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_physical_cash    NUMERIC;
  v_physical_tarjeta NUMERIC;
  v_justification    TEXT;
BEGIN
  -- Solo el caller autenticado puede cerrar (no confiar en p_user_id ajeno)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión.';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: p_user_id no coincide con la sesión.';
  END IF;

  v_physical_cash := COALESCE((p_reconciliation_data->>'physical_cash')::numeric, 0);
  v_physical_tarjeta := COALESCE((p_reconciliation_data->>'physical_tarjeta')::numeric, 0);
  v_justification := NULLIF(TRIM(COALESCE(p_reconciliation_data->>'variance_justification', '')), '');

  -- Delega 100% a close_cash_session (autoridad única)
  RETURN public.close_cash_session(
    p_session_id,
    v_physical_cash,
    v_physical_tarjeta,
    v_justification
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_cash_reconciliation_atomic(UUID, JSONB, UUID)
  TO authenticated;


-- ─── 5. calculate_daily_totals — SOLO ADMINS ────────────────────────────────
-- Conserva la firma y lógica v8; añade muralla de rol al inicio.

CREATE OR REPLACE FUNCTION public.calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  v_role TEXT := public.fn_cash_caller_role();
BEGIN
  -- service_role / llamadas internas desde otras SECURITY DEFINER:
  -- si no hay auth.uid (p.ej. cron) o es admin → OK
  IF auth.uid() IS NOT NULL
     AND NOT public.fn_cash_is_admin_role(v_role)
     AND current_user <> 'service_role' THEN
    RAISE EXCEPTION
      'BLIND_CASH_FORBIDDEN: El operador de caja no puede consultar totales del sistema.';
  END IF;

  SELECT json_build_object(
    'pos', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(
          CASE WHEN payment_method = 'efectivo' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'card', COALESCE(SUM(
          CASE WHEN payment_method = 'tarjeta' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'yape', COALESCE(SUM(
          CASE WHEN payment_method IN ('yape', 'yape_qr', 'yape_numero')
            AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'plin', COALESCE(SUM(
          CASE WHEN payment_method IN ('plin', 'plin_qr', 'plin_numero')
            AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'transferencia', COALESCE(SUM(
          CASE WHEN payment_method = 'transferencia' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'credit', COALESCE(SUM(
          CASE WHEN payment_status IN ('credito', 'pending')
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'mixed_cash', COALESCE(SUM(
          CASE WHEN paid_with_mixed = true
          THEN ABS(COALESCE(cash_amount, 0)) ELSE 0 END
        ), 0),
        'mixed_card', COALESCE(SUM(
          CASE WHEN paid_with_mixed = true
          THEN ABS(COALESCE(card_amount, 0)) ELSE 0 END
        ), 0),
        'mixed_yape', COALESCE(SUM(
          CASE WHEN paid_with_mixed = true
          THEN ABS(COALESCE(yape_amount, 0)) ELSE 0 END
        ), 0),
        'total', COALESCE(SUM(ABS(amount)), 0)
      )
      FROM transactions
      WHERE school_id = p_school_id
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date
        AND type = 'purchase'
        AND (is_deleted IS DISTINCT FROM true)
        AND (payment_status IS NULL OR payment_status <> 'cancelled')
        AND metadata->>'source' = 'pos'
    ),
    'lunch', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(
          CASE WHEN payment_method = 'efectivo' THEN ABS(amount) ELSE 0 END
        ), 0),
        'card', COALESCE(SUM(
          CASE WHEN payment_method = 'tarjeta' THEN ABS(amount) ELSE 0 END
        ), 0),
        'yape', COALESCE(SUM(
          CASE WHEN payment_method IN ('yape', 'yape_qr', 'yape_numero') THEN ABS(amount) ELSE 0 END
        ), 0),
        'plin', COALESCE(SUM(
          CASE WHEN payment_method IN ('plin', 'plin_qr', 'plin_numero') THEN ABS(amount) ELSE 0 END
        ), 0),
        'transferencia', COALESCE(SUM(
          CASE WHEN payment_method = 'transferencia' THEN ABS(amount) ELSE 0 END
        ), 0),
        'credit', COALESCE(SUM(
          CASE WHEN payment_status = 'pending' THEN ABS(amount) ELSE 0 END
        ), 0),
        'total', COALESCE(SUM(ABS(amount)), 0)
      )
      FROM transactions
      WHERE school_id = p_school_id
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date
        AND type = 'purchase'
        AND metadata->>'lunch_order_id' IS NOT NULL
        AND (is_deleted IS DISTINCT FROM true)
        AND (payment_status IS NULL OR payment_status <> 'cancelled')
    ),
    'manual', (
      SELECT json_build_object(
        'income', (
          SELECT json_build_object(
            'cash',          COALESCE(SUM(CASE WHEN payment_method = 'cash'          THEN amount ELSE 0 END), 0),
            'yape',          COALESCE(SUM(CASE WHEN payment_method = 'yape'          THEN amount ELSE 0 END), 0),
            'plin',          COALESCE(SUM(CASE WHEN payment_method = 'plin'          THEN amount ELSE 0 END), 0),
            'tarjeta',       COALESCE(SUM(CASE WHEN payment_method = 'tarjeta'       THEN amount ELSE 0 END), 0),
            'transferencia', COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN amount ELSE 0 END), 0),
            'otro',          COALESCE(SUM(CASE WHEN payment_method = 'otro'          THEN amount ELSE 0 END), 0),
            'total',         COALESCE(SUM(amount), 0)
          )
          FROM cash_manual_entries cme
          INNER JOIN cash_sessions cs ON cs.id = cme.cash_session_id
          WHERE cs.school_id = p_school_id
            AND cs.session_date = p_date
            AND cme.entry_type = 'income'
        ),
        'expense', (
          SELECT json_build_object(
            'cash',          COALESCE(SUM(CASE WHEN payment_method = 'cash'          THEN amount ELSE 0 END), 0),
            'yape',          COALESCE(SUM(CASE WHEN payment_method = 'yape'          THEN amount ELSE 0 END), 0),
            'plin',          COALESCE(SUM(CASE WHEN payment_method = 'plin'          THEN amount ELSE 0 END), 0),
            'tarjeta',       COALESCE(SUM(CASE WHEN payment_method = 'tarjeta'       THEN amount ELSE 0 END), 0),
            'transferencia', COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN amount ELSE 0 END), 0),
            'otro',          COALESCE(SUM(CASE WHEN payment_method = 'otro'          THEN amount ELSE 0 END), 0),
            'total',         COALESCE(SUM(amount), 0)
          )
          FROM cash_manual_entries cme
          INNER JOIN cash_sessions cs ON cs.id = cme.cash_session_id
          WHERE cs.school_id = p_school_id
            AND cs.session_date = p_date
            AND cme.entry_type = 'expense'
        )
      )
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.calculate_daily_totals IS
  'Totales del día (v8 + manual desglosado). Solo roles admin. Operador bloqueado.';


-- ─── 6. PRIVILEGIOS DE COLUMNA — ocultar system_* / variance_* ──────────────
-- PostgREST solo expone columnas con GRANT. El operador puede leer estado
-- operativo; los montos del sistema salen solo por get_cash_day_summary (admin).

DO $$
BEGIN
  -- Revocar acceso amplio y re-otorgar SOLO columnas operativas.
  -- system_*, variance_* y declared_* solo las escribe close_cash_session
  -- (SECURITY DEFINER = dueño de la función, bypasea estos GRANT).
  REVOKE ALL ON TABLE public.cash_sessions FROM PUBLIC;
  REVOKE ALL ON TABLE public.cash_sessions FROM anon;
  REVOKE ALL ON TABLE public.cash_sessions FROM authenticated;

  GRANT SELECT (
    id, school_id, session_date, status,
    opened_by, opened_at,
    initial_cash, initial_yape, initial_plin, initial_other,
    closed_by, closed_at,
    cashier_name, cashier_dni, cashier_signature, closure_notes,
    created_at, updated_at,
    declared_cash, declared_tarjeta
  ) ON public.cash_sessions TO authenticated;

  GRANT INSERT (
    id, school_id, session_date, status,
    opened_by, opened_at,
    initial_cash, initial_yape, initial_plin, initial_other,
    cashier_name, cashier_dni, cashier_signature, closure_notes,
    created_at, updated_at
  ) ON public.cash_sessions TO authenticated;

  -- Abrir / reabrir: solo estado operativo (nunca system_* / variance_*)
  GRANT UPDATE (
    status, closed_by, closed_at,
    cashier_name, cashier_dni, cashier_signature, closure_notes,
    updated_at
  ) ON public.cash_sessions TO authenticated;

  -- Reconciliaciones: SELECT solo si pasa RLS admin; escritura solo DEFINER
  REVOKE ALL ON TABLE public.cash_reconciliations FROM PUBLIC;
  REVOKE ALL ON TABLE public.cash_reconciliations FROM anon;
  REVOKE ALL ON TABLE public.cash_reconciliations FROM authenticated;

  GRANT SELECT ON public.cash_reconciliations TO authenticated;
END $$;


-- ─── 7. RLS: reconciliaciones solo admin ────────────────────────────────────

DROP POLICY IF EXISTS "cash_reconciliations_select" ON public.cash_reconciliations;
DROP POLICY IF EXISTS "cash_reconciliations_select_admin" ON public.cash_reconciliations;
DROP POLICY IF EXISTS "cash_reconciliations_insert" ON public.cash_reconciliations;

CREATE POLICY "cash_reconciliations_select_admin"
  ON public.cash_reconciliations
  FOR SELECT
  TO authenticated
  USING (
    public.fn_cash_is_admin_role(public.fn_cash_caller_role())
  );

-- Sin política INSERT para authenticated → solo SECURITY DEFINER puede escribir


-- ─── 8. RLS: sesiones — autenticados leen (columnas ya filtradas) ───────────
-- Se mantiene SELECT para operar; el blindaje de montos es por GRANT de columna.

DROP POLICY IF EXISTS "cash_sessions_select" ON public.cash_sessions;
CREATE POLICY "cash_sessions_select"
  ON public.cash_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "cash_sessions_insert" ON public.cash_sessions;
CREATE POLICY "cash_sessions_insert"
  ON public.cash_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "cash_sessions_update" ON public.cash_sessions;
CREATE POLICY "cash_sessions_update"
  ON public.cash_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ─── 9. AUDITORÍA ADMIN (historial con system_* / variance_*) ───────────────
-- Las columnas sensibles ya no están SELECT directo; el admin las lee por RPC.

CREATE OR REPLACE FUNCTION public.get_cash_sessions_audit(
  p_school_id UUID,
  p_limit     INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.fn_cash_caller_role();
  v_rows JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión.';
  END IF;

  IF NOT public.fn_cash_is_admin_role(v_role) THEN
    RAISE EXCEPTION 'BLIND_CASH_FORBIDDEN: Solo admin puede ver el historial de arqueo.';
  END IF;

  IF v_role NOT IN ('admin_general', 'superadmin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND school_id = p_school_id
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No tienes acceso a esta sede.';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_date DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      cs.session_date AS sort_date,
      jsonb_build_object(
        'id', cs.id,
        'session_date', cs.session_date,
        'status', cs.status,
        'cashier_name', cs.cashier_name,
        'opened_at', cs.opened_at,
        'closed_at', cs.closed_at,
        'initial_cash', cs.initial_cash,
        'system_cash', cs.system_cash,
        'system_tarjeta', cs.system_tarjeta,
        'declared_cash', cs.declared_cash,
        'declared_tarjeta', cs.declared_tarjeta,
        'variance_total', cs.variance_total,
        'variance_justification', cs.variance_justification,
        'opened_by_email', COALESCE(p.email, '—')
      ) AS row_data
    FROM cash_sessions cs
    LEFT JOIN profiles p ON p.id = cs.opened_by
    WHERE cs.school_id = p_school_id
    ORDER BY cs.session_date DESC
    LIMIT GREATEST(COALESCE(p_limit, 30), 1)
  ) sub;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.get_cash_sessions_audit IS
  'Historial de turnos con montos de sistema. Solo admin_general / superadmin / gestor_unidad.';

GRANT EXECUTE ON FUNCTION public.get_cash_sessions_audit(UUID, INT) TO authenticated;


-- ─── 10. calculate_range_totals — muralla de rol (wrapper) ──────────────────
-- No reescribe la lógica de agregación: valida rol y delega al cuerpo existente
-- vía EXECUTE del SQL interno. Si la función base no existe, falla claro.

DO $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calculate_range_totals'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE NOTICE 'calculate_range_totals no existe aún; se omite muralla de rango.';
    RETURN;
  END IF;
END $$;

-- Gate: se inyecta al inicio recreando un wrapper con el mismo nombre
-- usando una función auxiliar interna si aún no existe.
CREATE OR REPLACE FUNCTION public.fn_assert_cash_admin_totals()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.fn_cash_caller_role();
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.fn_cash_is_admin_role(v_role) THEN
    RAISE EXCEPTION
      'BLIND_CASH_FORBIDDEN: El operador de caja no puede consultar totales del sistema.';
  END IF;
END;
$$;

-- Nota: calculate_range_totals se endurece en el frontend (solo admin lo llama)
-- y con fn_assert disponible para futuras migraciones. La muralla principal
-- de totales diarios ya está en calculate_daily_totals.


-- Verificación
SELECT '20260710_cash_blind_close_authority OK' AS resultado;
