-- ============================================================================
-- GUARDIAS DE SERVIDOR PARA PEDIDOS DE ALMUERZO
-- Fecha: 2026-05-10  (ejecutar DESPUÉS de 20260510_global_lunch_deadline_system_status.sql)
--
-- Este archivo crea tres piezas de backend:
--
--  1. check_order_eligibility(p_target_date, p_school_id)
--     RPC pública que el frontend llama para saber si un día es pedible.
--     Usa el reloj del SERVIDOR (NOW() AT TIME ZONE 'America/Lima') y lee
--     el deadline global de system_status (id=1).
--
--  2. tg_validate_lunch_order_deadline / trg_validate_lunch_order_deadline
--     Trigger BEFORE INSERT en lunch_orders que llama a la función anterior.
--     Si el plazo venció, el INSERT se rechaza con RAISE EXCEPTION.
--     Admins (admin_general, superadmin, admin_sede) tienen bypass explícito.
--
--  3. update_global_lunch_deadline(p_time, p_days)
--     Función SECURITY DEFINER que el frontend usa para cambiar el deadline.
--     Solo ejecuta el UPDATE si el auth.uid() es admin_general o superadmin.
--     Esto evita que nadie pueda llamar directamente a system_status UPDATE
--     sin el rol correcto.
--
-- Reglas de oro respetadas:
--   - Reloj único del servidor (#11.C): toda comparación usa NOW() AT TIME ZONE 'America/Lima'
--   - Fallback permisivo: si no existe fila en system_status → se permite el pedido
--   - No se toca lógica de cancelaciones ni de Izipay/pasarela
-- ============================================================================

-- ─── 1. FUNCIÓN RPC: check_order_eligibility ────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_order_eligibility(
  p_target_date DATE,
  p_school_id   UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deadline_time  TIME;
  v_deadline_days  INTEGER;
  v_orders_enabled BOOLEAN := true;
  v_now_lima       TIMESTAMP;
  v_cutoff         TIMESTAMP;
BEGIN
  -- ── 1. Leer deadline GLOBAL de system_status (única fuente de verdad) ────
  SELECT
    COALESCE(global_lunch_deadline_time, '09:15:00'::TIME),
    COALESCE(global_lunch_deadline_days, 0)
  INTO v_deadline_time, v_deadline_days
  FROM public.system_status
  WHERE id = 1;

  -- Si no hay fila (instalación sin datos), comportamiento permisivo
  IF NOT FOUND THEN
    RETURN json_build_object(
      'can_order', true,
      'reason',    'Sin configuración global; pedido permitido por defecto.'
    );
  END IF;

  -- ── 2. Verificar orders_enabled de la sede (si se proporciona school_id) ─
  IF p_school_id IS NOT NULL THEN
    SELECT COALESCE(orders_enabled, true)
    INTO   v_orders_enabled
    FROM   public.lunch_configuration
    WHERE  school_id = p_school_id
    LIMIT  1;
    -- Si no hay config de sede → permisivo
  END IF;

  IF NOT v_orders_enabled THEN
    RETURN json_build_object(
      'can_order', false,
      'reason',    'El sistema de pedidos está deshabilitado para esta sede.'
    );
  END IF;

  -- ── 3. Reloj único del servidor en Lima (Regla #11.C) ────────────────────
  v_now_lima := NOW() AT TIME ZONE 'America/Lima';

  -- ── 4. Calcular cutoff ────────────────────────────────────────────────────
  -- cutoff = (fecha_pedido - deadline_days) a las deadline_time
  -- Ej: pedido=12/05, days=0, time=09:15 → cutoff = 12/05 09:15
  -- Ej: pedido=12/05, days=1, time=09:15 → cutoff = 11/05 09:15
  v_cutoff := (p_target_date - (v_deadline_days * INTERVAL '1 day'))::TIMESTAMP
              + v_deadline_time;

  -- ── 5. Comparar ──────────────────────────────────────────────────────────
  IF v_now_lima > v_cutoff THEN
    RETURN json_build_object(
      'can_order', false,
      'reason',    format(
        'El plazo venció el %s a las %s (límite global del sistema).',
        TO_CHAR(v_cutoff::DATE, 'DD/MM/YYYY'),
        TO_CHAR(v_deadline_time, 'HH12:MI AM')
      )
    );
  END IF;

  RETURN json_build_object(
    'can_order', true,
    'reason',    'Pedido permitido.'
  );
END;
$$;

COMMENT ON FUNCTION public.check_order_eligibility(DATE, UUID) IS
  'Devuelve {can_order: boolean, reason: text}. Usa el reloj del servidor Lima y el deadline global de system_status(id=1). Permisivo si no hay datos.';

-- ─── 2. TRIGGER: validar deadline al insertar en lunch_orders ─────────────
CREATE OR REPLACE FUNCTION public.tg_validate_lunch_order_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_school_id    UUID;
  v_eligibility  JSON;
BEGIN
  -- ── Bypass explícito para roles administrativos ───────────────────────────
  -- admin_general / superadmin / admin_sede pueden crear pedidos fuera de plazo
  -- (correcciones, pedidos manuales, imprevistos operativos)
  SELECT role INTO v_caller_role
  FROM   public.profiles
  WHERE  id = auth.uid();

  IF v_caller_role IN ('admin_general', 'superadmin', 'admin_sede') THEN
    RETURN NEW;
  END IF;

  -- ── Resolver school_id del pedido ─────────────────────────────────────────
  v_school_id := NEW.school_id;

  IF v_school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO v_school_id
    FROM   public.students
    WHERE  id = NEW.student_id;
  END IF;

  IF v_school_id IS NULL AND NEW.teacher_id IS NOT NULL THEN
    SELECT school_id_1 INTO v_school_id
    FROM   public.teacher_profiles
    WHERE  id = NEW.teacher_id;
  END IF;

  -- ── Validar eligibilidad con reloj del servidor ───────────────────────────
  v_eligibility := public.check_order_eligibility(NEW.order_date, v_school_id);

  IF NOT (v_eligibility->>'can_order')::BOOLEAN THEN
    RAISE EXCEPTION 'ORDER_DEADLINE: %', v_eligibility->>'reason';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_validate_lunch_order_deadline() IS
  'Trigger BEFORE INSERT en lunch_orders. Rechaza el pedido si el plazo global venció. Admins tienen bypass.';

-- Registrar (o re-registrar) el trigger
DROP TRIGGER IF EXISTS trg_validate_lunch_order_deadline ON public.lunch_orders;

CREATE TRIGGER trg_validate_lunch_order_deadline
  BEFORE INSERT ON public.lunch_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_validate_lunch_order_deadline();

-- ─── 3. FUNCIÓN SEGURA: update_global_lunch_deadline ─────────────────────
-- El frontend llama a esta función en lugar de hacer UPDATE directo en system_status.
-- Solo funciona si el auth.uid() es admin_general o superadmin.
CREATE OR REPLACE FUNCTION public.update_global_lunch_deadline(
  p_deadline_time TIME,
  p_deadline_days INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- ── Guard de rol: solo admin_general y superadmin ─────────────────────────
  SELECT role INTO v_caller_role
  FROM   public.profiles
  WHERE  id = auth.uid();

  IF v_caller_role NOT IN ('admin_general', 'superadmin') THEN
    RETURN json_build_object(
      'success', false,
      'error',   'Sin permisos. Solo admin_general o superadmin pueden modificar el límite global de pedidos.'
    );
  END IF;

  -- ── Validaciones básicas de rango ─────────────────────────────────────────
  IF p_deadline_days < 0 OR p_deadline_days > 7 THEN
    RETURN json_build_object(
      'success', false,
      'error',   'Los días de anticipación deben estar entre 0 y 7.'
    );
  END IF;

  -- ── Actualizar (Realtime propagará el cambio a todos los clientes) ────────
  UPDATE public.system_status
  SET
    global_lunch_deadline_time = p_deadline_time,
    global_lunch_deadline_days = p_deadline_days,
    updated_by                 = auth.uid()
  WHERE id = 1;

  RETURN json_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.update_global_lunch_deadline(TIME, INTEGER) IS
  'Actualiza el deadline global de pedidos de almuerzo en system_status. Solo ejecutable por admin_general o superadmin. El cambio se propaga por Realtime.';

-- ─── Verificación final ──────────────────────────────────────────────────────
SELECT
  '20260510_b_lunch_order_server_guards ✅ RPC + trigger + función segura creados' AS resultado;
