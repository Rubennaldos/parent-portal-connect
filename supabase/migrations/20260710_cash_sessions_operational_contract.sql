-- =====================================================================
-- CORRECCIÓN ARQUITECTÓNICA — Contrato de cash_sessions (2026-07-10)
--
-- AUDITORÍA DE LO ANTERIOR (crítico):
--
-- FALLO 1 — Diseño frágil (20260710_cash_blind_close_authority §6):
--   GRANT SELECT por columna en la tabla base + PostgREST .select('*')
--   = query rota. Eso tumba el POS. No es un “bug del frontend”: es un
--   contrato de API incompatible con PostgREST.
--
-- FALLO 2 — Regresión de seguridad (misma migración §8):
--   Se reemplazó RLS V7.2 (rol + sede) por USING (auth.uid() IS NOT NULL).
--   Cualquier autenticado podía leer/escribir sesiones de CUALQUIER sede
--   (en columnas operativas). Eso es peor que el problema que se quería
--   resolver.
--
-- FALLO 3 — “Hotfix” 20260710_fix_pos_cash_session_guard:
--   Los RPC get_open_cash_session / ensure_cash_session_open son la
--   dirección correcta (SSOT), pero no reparaban el contrato de lectura
--   ni restauraban el RLS. Quedaban como parche encima de un diseño roto.
--
-- CONTRATO DEFINITIVO:
--   A. Tabla cash_sessions: sin SELECT amplio para authenticated.
--   B. Vista v_cash_sessions_operational: ÚNICA superficie PostgREST
--      segura (solo columnas operativas). select('*') sobre la VISTA OK.
--   C. RLS V7.2 restaurado (rol + sede).
--   D. Lectura POS / apertura: RPC atómicos (reloj Lima, FOR UPDATE).
--   E. Montos system_* / variance_*: solo vía RPC admin (ya existentes).
--
-- NO TOCA: Izipay, pasarela, fn_sync_student_balance, saldos de alumnos.
-- =====================================================================

-- ─── 0. Helpers (idempotentes si ya existen) ────────────────────────────────

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

CREATE OR REPLACE FUNCTION public.fn_cash_can_access_school(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN (
        'admin_general', 'superadmin',
        'gestor_unidad', 'cajero', 'operador_caja'
      )
      AND (
        p.role IN ('admin_general', 'superadmin')
        OR p.school_id = p_school_id
      )
  );
$$;


-- ─── 1. VISTA OPERATIVA (superficie PostgREST segura) ───────────────────────
-- security_invoker = true → aplica RLS del caller sobre cash_sessions.
-- La vista NO incluye system_* ni variance_* → select('*') sobre la vista
-- nunca filtra montos del sistema.

DROP VIEW IF EXISTS public.v_cash_sessions_operational CASCADE;

CREATE VIEW public.v_cash_sessions_operational
WITH (security_invoker = true)
AS
SELECT
  id,
  school_id,
  session_date,
  status,
  opened_by,
  opened_at,
  initial_cash,
  initial_yape,
  initial_plin,
  initial_other,
  closed_by,
  closed_at,
  cashier_name,
  cashier_dni,
  cashier_signature,
  closure_notes,
  created_at,
  updated_at,
  declared_cash,
  declared_tarjeta
FROM public.cash_sessions;

COMMENT ON VIEW public.v_cash_sessions_operational IS
  'Única superficie PostgREST para sesiones de caja. Sin system_*/variance_*.';

GRANT SELECT ON public.v_cash_sessions_operational TO authenticated;
REVOKE ALL ON public.v_cash_sessions_operational FROM PUBLIC;
REVOKE ALL ON public.v_cash_sessions_operational FROM anon;


-- ─── 2. PRIVILEGIOS EN TABLA BASE ───────────────────────────────────────────
-- authenticated NO hace SELECT * sobre la tabla.
-- Solo columnas operativas (para que security_invoker de la vista funcione).
-- Escritura de system_*/variance_* solo vía close_cash_session (DEFINER).

DO $$
BEGIN
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

  GRANT UPDATE (
    status, closed_by, closed_at,
    cashier_name, cashier_dni, cashier_signature, closure_notes,
    updated_at
  ) ON public.cash_sessions TO authenticated;
END $$;


-- ─── 3. RESTAURAR RLS V7.2 (rol + sede) — anula regresión §8 ────────────────

DROP POLICY IF EXISTS "cash_sessions_select" ON public.cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_insert" ON public.cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_update" ON public.cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_select_restricted" ON public.cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_insert_restricted" ON public.cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_update_restricted" ON public.cash_sessions;

CREATE POLICY "cash_sessions_select_restricted" ON public.cash_sessions
  FOR SELECT TO authenticated
  USING (public.fn_cash_can_access_school(school_id));

CREATE POLICY "cash_sessions_insert_restricted" ON public.cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_cash_can_access_school(school_id));

CREATE POLICY "cash_sessions_update_restricted" ON public.cash_sessions
  FOR UPDATE TO authenticated
  USING (public.fn_cash_can_access_school(school_id))
  WITH CHECK (public.fn_cash_can_access_school(school_id));


-- ─── 4. SSOT LECTURA POS ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_open_cash_session(p_school_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   DATE := (timezone('America/Lima', now()))::date;
  v_session public.cash_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: school_id requerido.';
  END IF;

  IF NOT public.fn_cash_can_access_school(p_school_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No tienes acceso a esta sede.';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE school_id = p_school_id
    AND session_date = v_today
    AND status = 'open'
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_session
    FROM public.cash_sessions
    WHERE school_id = p_school_id
      AND status = 'open'
      AND (opened_at AT TIME ZONE 'America/Lima')::date = v_today
    ORDER BY opened_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'session', NULL, 'session_date', v_today);
  END IF;

  -- Payload operativo únicamente (nunca system_* / variance_*)
  RETURN jsonb_build_object(
    'ok', true,
    'session_date', v_today,
    'session', jsonb_build_object(
      'id', v_session.id,
      'school_id', v_session.school_id,
      'session_date', v_session.session_date,
      'status', v_session.status,
      'opened_by', v_session.opened_by,
      'opened_at', v_session.opened_at,
      'closed_by', v_session.closed_by,
      'closed_at', v_session.closed_at,
      'initial_cash', v_session.initial_cash,
      'initial_yape', v_session.initial_yape,
      'initial_plin', v_session.initial_plin,
      'initial_other', v_session.initial_other,
      'cashier_name', v_session.cashier_name,
      'created_at', v_session.created_at,
      'updated_at', v_session.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_open_cash_session IS
  'SSOT: sesión abierta del día fiscal Lima. Sin montos de sistema.';

GRANT EXECUTE ON FUNCTION public.get_open_cash_session(UUID) TO authenticated;


-- ─── 5. SSOT APERTURA / RECONCILIACIÓN ──────────────────────────────────────
-- Si ya está abierta → devolver (idempotente).
-- Si está cerrada → reabrir LIMPIANDO arqueo previo (evita estado sucio).
-- Si no existe → crear. Todo con FOR UPDATE + reloj Lima.

CREATE OR REPLACE FUNCTION public.ensure_cash_session_open(p_school_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   DATE := (timezone('America/Lima', now()))::date;
  v_role    TEXT := public.fn_cash_caller_role();
  v_user    UUID := auth.uid();
  v_session public.cash_sessions%ROWTYPE;
  v_action  TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: school_id requerido.';
  END IF;

  IF NOT public.fn_cash_can_access_school(p_school_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No tienes acceso a esta sede.';
  END IF;

  IF v_role NOT IN (
    'admin_general', 'superadmin', 'gestor_unidad', 'operador_caja', 'cajero'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Tu rol (%) no puede abrir caja.', v_role;
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE school_id = p_school_id
    AND session_date = v_today
  FOR UPDATE;

  IF FOUND THEN
    IF v_session.status = 'open' THEN
      v_action := 'already_open';
    ELSE
      -- Reapertura limpia: no arrastrar arqueo del cierre anterior
      UPDATE public.cash_sessions SET
        status                 = 'open',
        closed_at              = NULL,
        closed_by              = NULL,
        declared_cash          = NULL,
        declared_tarjeta       = NULL,
        system_cash            = NULL,
        system_tarjeta         = NULL,
        variance_cash          = NULL,
        variance_tarjeta       = NULL,
        variance_total         = NULL,
        variance_justification = NULL,
        updated_at             = clock_timestamp()
      WHERE id = v_session.id
      RETURNING * INTO v_session;

      DELETE FROM public.cash_reconciliations
      WHERE cash_session_id = v_session.id;

      INSERT INTO public.huella_digital_logs (
        usuario_id, accion, modulo, school_id, contexto
      ) VALUES (
        v_user,
        'REAPERTURA_CAJA',
        'CIERRE_CAJA',
        p_school_id,
        jsonb_build_object(
          'session_id', v_session.id,
          'session_date', v_today,
          'rol', v_role,
          'motivo', 'ensure_cash_session_open'
        )
      );

      v_action := 'reopened';
    END IF;
  ELSE
    BEGIN
      INSERT INTO public.cash_sessions (
        school_id, session_date, opened_by, status,
        initial_cash, initial_yape, initial_plin, initial_other
      ) VALUES (
        p_school_id, v_today, v_user, 'open',
        0, 0, 0, 0
      )
      RETURNING * INTO v_session;
      v_action := 'created';
    EXCEPTION WHEN unique_violation THEN
      -- Carrera: otro proceso creó la fila; re-leer
      SELECT * INTO v_session
      FROM public.cash_sessions
      WHERE school_id = p_school_id
        AND session_date = v_today
      FOR UPDATE;

      IF v_session.status = 'open' THEN
        v_action := 'already_open';
      ELSE
        RAISE EXCEPTION 'SESSION_CONFLICT: Sesión del día en estado inesperado (%).', v_session.status;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'session_date', v_today,
    'session', jsonb_build_object(
      'id', v_session.id,
      'school_id', v_session.school_id,
      'session_date', v_session.session_date,
      'status', v_session.status,
      'opened_by', v_session.opened_by,
      'opened_at', v_session.opened_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.ensure_cash_session_open IS
  'SSOT apertura de caja del día (Lima). Idempotente. Reapertura limpia arqueo previo.';

GRANT EXECUTE ON FUNCTION public.ensure_cash_session_open(UUID) TO authenticated;


-- ─── 6. RLS reconciliaciones (solo admin) — reafirmar ───────────────────────

DROP POLICY IF EXISTS "cash_reconciliations_select" ON public.cash_reconciliations;
DROP POLICY IF EXISTS "cash_reconciliations_select_admin" ON public.cash_reconciliations;
DROP POLICY IF EXISTS "cash_reconciliations_insert" ON public.cash_reconciliations;

CREATE POLICY "cash_reconciliations_select_admin"
  ON public.cash_reconciliations
  FOR SELECT TO authenticated
  USING (public.fn_cash_is_admin_role(public.fn_cash_caller_role()));


SELECT '20260710_cash_sessions_operational_contract OK' AS resultado;
