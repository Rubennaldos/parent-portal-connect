-- Matrícula Express: provisionar vínculo padre-sede en Paso 4
-- En lugar de rechazar padres fantasma sin fila en parent_profiles,
-- se crea o vincula silenciosamente. Se mantiene fail-closed si ya
-- están vinculados a otra sede distinta (anti deuda cruzada).

CREATE OR REPLACE FUNCTION public.rpc_express_enroll_student_v1(
  p_school_id uuid,
  p_parent_user_id uuid,
  p_student_full_name text,
  p_level_id uuid,
  p_classroom_id uuid,
  p_actor_user_id uuid,
  p_account_mode text DEFAULT 'concession_only'
)
RETURNS TABLE(
  student_id uuid,
  parent_user_id uuid,
  school_id uuid,
  level_id uuid,
  classroom_id uuid,
  grade text,
  section text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_role text;
  v_grade text;
  v_section text;
  v_student_id uuid;
  v_created_at timestamptz;
  v_kiosk_disabled boolean;
  v_limit_type text;
  v_daily_limit numeric;
  v_weekly_limit numeric;
BEGIN
  -------------------------------------------------------------------------
  -- 0) VALIDACIÓN DE ACTOR (AUTORIZACIÓN INTERNA FAIL-CLOSED)
  -------------------------------------------------------------------------
  SELECT p.role
    INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = p_actor_user_id
  LIMIT 1;

  IF v_actor_role IS NULL
     OR v_actor_role NOT IN (
       'admin_general',
       'admin_sede',
       'gestor_unidad',
       'operador_caja',
       'supervisor_red',
       'superadmin'
     ) THEN
    RAISE EXCEPTION
      'ERR_EXPRESS_UNAUTHORIZED: El actor no tiene permisos para matrícula express.';
  END IF;

  -------------------------------------------------------------------------
  -- 1) VALIDACIONES BÁSICAS DE INPUT (SEPARADAS DE JERARQUÍA)
  -------------------------------------------------------------------------
  IF p_school_id IS NULL
     OR p_parent_user_id IS NULL
     OR p_student_full_name IS NULL
     OR btrim(p_student_full_name) = ''
     OR p_level_id IS NULL
     OR p_classroom_id IS NULL
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'ERR_EXPRESS_INVALID_INPUT: Parámetros obligatorios incompletos.';
  END IF;

  -------------------------------------------------------------------------
  -- 2) VALIDACIÓN JERÁRQUICA + DERIVACIÓN LEGACY (grade)
  --    level_id debe pertenecer EXACTAMENTE a school_id y estar activo
  -------------------------------------------------------------------------
  SELECT sl.name
    INTO v_grade
  FROM public.school_levels sl
  WHERE sl.id = p_level_id
    AND sl.school_id = p_school_id
    AND sl.is_active = true
  LIMIT 1;

  IF v_grade IS NULL THEN
    RAISE EXCEPTION
      'ERR_EXPRESS_INVALID_HIERARCHY: El level_id no pertenece a la sede indicada o está inactivo.';
  END IF;

  -------------------------------------------------------------------------
  -- 3) VALIDACIÓN JERÁRQUICA + DERIVACIÓN LEGACY (section)
  --    classroom_id debe pertenecer EXACTAMENTE a level_id y school_id
  -------------------------------------------------------------------------
  SELECT sc.name
    INTO v_section
  FROM public.school_classrooms sc
  JOIN public.school_levels sl
    ON sl.id = sc.level_id
  WHERE sc.id = p_classroom_id
    AND sc.level_id = p_level_id
    AND sl.school_id = p_school_id
    AND sc.is_active = true
  LIMIT 1;

  IF v_section IS NULL THEN
    RAISE EXCEPTION
      'ERR_EXPRESS_INVALID_HIERARCHY: El classroom_id no pertenece al level_id/school_id indicado o está inactivo.';
  END IF;

  -------------------------------------------------------------------------
  -- 4) CONSISTENCIA PADRE-SEDE (ANTI DEUDA CRUZADA + PROVISIÓN EXPRESS)
  -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_profiles pp
    WHERE pp.user_id = p_parent_user_id
      AND pp.school_id = p_school_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.user_id = p_parent_user_id
    ) THEN
      -- Padre fantasma nuevo: crear vínculo silencioso con la sede
      INSERT INTO public.parent_profiles (
        user_id,
        school_id,
        full_name,
        approved_by_admin,
        onboarding_completed
      )
      SELECT
        pr.id,
        p_school_id,
        COALESCE(NULLIF(btrim(pr.full_name), ''), 'Padre Express'),
        true,
        false
      FROM public.profiles pr
      WHERE pr.id = p_parent_user_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'ERR_EXPRESS_INVALID_HIERARCHY: No se encontró el perfil base del padre para vincular a la sede.';
      END IF;

    ELSIF EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.user_id = p_parent_user_id
        AND pp.school_id IS NULL
    ) THEN
      -- Perfil creado por trigger OAuth sin sede: vincular silenciosamente
      UPDATE public.parent_profiles
      SET
        school_id = p_school_id,
        updated_at = timezone('America/Lima', now())
      WHERE user_id = p_parent_user_id
        AND school_id IS NULL;

    ELSE
      -- Padre ya vinculado a otra sede: fail-closed (anti deuda cruzada)
      RAISE EXCEPTION
        'ERR_EXPRESS_INVALID_HIERARCHY: El padre ya está vinculado a otra sede distinta.';
    END IF;
  END IF;

  -------------------------------------------------------------------------
  -- 4.5) RESOLUCIÓN DE TIPO DE CUENTA
  --   concession_only → solo concesión (almuerzo), kiosco bloqueado, sin tope
  --   kiosk_free      → kiosco libre, sin tope de consumo
  -------------------------------------------------------------------------
  IF p_account_mode = 'kiosk_free' THEN
    v_kiosk_disabled := false;
    v_limit_type     := 'none';
    v_daily_limit    := NULL;
    v_weekly_limit   := NULL;
  ELSE
    -- 'concession_only' es el default seguro
    v_kiosk_disabled := true;
    v_limit_type     := 'none';
    v_daily_limit    := NULL;
    v_weekly_limit   := NULL;
  END IF;

  -------------------------------------------------------------------------
  -- 5) INSERCIÓN ATÓMICA (IDs MODERNOS + LEGACY + GUARDRAILS)
  -------------------------------------------------------------------------
  INSERT INTO public.students (
    parent_id,
    full_name,
    school_id,
    level_id,
    classroom_id,
    grade,
    section,
    balance,
    free_account,
    is_active,
    kiosk_disabled,
    limit_type,
    daily_limit,
    weekly_limit
  )
  VALUES (
    p_parent_user_id,
    btrim(p_student_full_name),
    p_school_id,
    p_level_id,
    p_classroom_id,
    v_grade,
    v_section,
    0,
    true,
    true,
    v_kiosk_disabled,
    v_limit_type,
    v_daily_limit,
    v_weekly_limit
  )
  RETURNING id, created_at
  INTO v_student_id, v_created_at;

  -------------------------------------------------------------------------
  -- 6) RETORNO ESTRUCTURADO
  -------------------------------------------------------------------------
  RETURN QUERY
  SELECT
    v_student_id,
    p_parent_user_id,
    p_school_id,
    p_level_id,
    p_classroom_id,
    v_grade,
    v_section,
    v_created_at;

EXCEPTION
  WHEN OTHERS THEN
    IF position('ERR_EXPRESS_' in SQLERRM) = 1 THEN
      RAISE;
    ELSE
      RAISE EXCEPTION
        'ERR_EXPRESS_DATABASE_ROLLBACK: Fallo inesperado en matrícula express. Detalle=%',
        SQLERRM;
    END IF;
END;
$function$;
