-- Bypass de plazo global de pedidos de almuerzo para rol `admin` (además de los ya contemplados).
-- El trigger tg_validate_lunch_order_deadline omitía admin_general/superadmin/admin_sede pero NO `admin`,
-- provocando ORDER_DEADLINE en INSERT aunque el usuario fuera administrativo.
-- La RPC check_order_eligibility ahora ignora solo la comparación de hora/fecha para esos roles,
-- manteniendo orders_enabled por sede y el resto de reglas.

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
  SELECT
    COALESCE(global_lunch_deadline_time, '09:15:00'::TIME),
    COALESCE(global_lunch_deadline_days, 0)
  INTO v_deadline_time, v_deadline_days
  FROM public.system_status
  WHERE id = 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'can_order', true,
      'reason',    'Sin configuración global; pedido permitido por defecto.'
    );
  END IF;

  IF p_school_id IS NOT NULL THEN
    SELECT COALESCE(orders_enabled, true)
    INTO   v_orders_enabled
    FROM   public.lunch_configuration
    WHERE  school_id = p_school_id
    LIMIT  1;
  END IF;

  IF NOT v_orders_enabled THEN
    RETURN json_build_object(
      'can_order', false,
      'reason',    'El sistema de pedidos está deshabilitado para esta sede.'
    );
  END IF;

  -- Bypass solo del límite horario/fecha (no deshabilita la sede ni inventa datos)
  IF EXISTS (
    SELECT 1
    FROM   public.profiles p
    WHERE  p.id = auth.uid()
      AND  p.role IN ('admin', 'admin_general', 'superadmin', 'admin_sede')
  ) THEN
    RETURN json_build_object(
      'can_order', true,
      'reason',    'Pedido permitido (rol administrativo; sin límite de hora global).'
    );
  END IF;

  v_now_lima := NOW() AT TIME ZONE 'America/Lima';

  v_cutoff := (p_target_date - (v_deadline_days * INTERVAL '1 day'))::TIMESTAMP
              + v_deadline_time;

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
  'Devuelve {can_order, reason}. Reloj Lima + deadline global. Roles admin/admin_general/superadmin/admin_sede omiten solo el tope horario; orders_enabled por sede sigue aplicando.';

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
  SELECT role INTO v_caller_role
  FROM   public.profiles
  WHERE  id = auth.uid();

  IF v_caller_role IN ('admin', 'admin_general', 'superadmin', 'admin_sede') THEN
    RETURN NEW;
  END IF;

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

  v_eligibility := public.check_order_eligibility(NEW.order_date, v_school_id);

  IF NOT (v_eligibility->>'can_order')::BOOLEAN THEN
    RAISE EXCEPTION 'ORDER_DEADLINE: %', v_eligibility->>'reason';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_validate_lunch_order_deadline() IS
  'BEFORE INSERT lunch_orders. Rechaza si plazo global venció. Bypass: admin, admin_general, superadmin, admin_sede.';

SELECT '20260511_lunch_deadline_admin_role_bypass ✅ check_order_eligibility + tg_validate_lunch_order_deadline' AS resultado;
