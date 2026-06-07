-- =============================================================================
-- Registro Express de Profesores
-- RPC atómico: auth.users + auth.identities + profiles + teacher_profiles
--
-- Blindajes heredados de 20260602_auth_login_forensic_repair:
--   - instance_id real (nunca UUID en ceros)
--   - fila obligatoria en auth.identities
-- =============================================================================

CREATE OR REPLACE FUNCTION public.insert_teacher_express(
  p_name      text,
  p_dni       text,
  p_phone     text,
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $function$
DECLARE
  v_actor_id         uuid;
  v_actor_role       text;
  v_actor_school_id  uuid;
  v_actor_email      text;
  v_name             text;
  v_dni              text;
  v_phone            text;
  v_email            text;
  v_user_id          uuid;
  v_instance_id      uuid;
  v_encrypted_pw     text;
  v_now              timestamptz := now();
  v_random_secret    text;
BEGIN
  ---------------------------------------------------------------------------
  -- 0) Actor autenticado
  ---------------------------------------------------------------------------
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'ERR_TEACHER_UNAUTHORIZED: Debes iniciar sesión para registrar profesores.';
  END IF;

  SELECT p.role, p.school_id, p.email
    INTO v_actor_role, v_actor_school_id, v_actor_email
  FROM public.profiles p
  WHERE p.id = v_actor_id
  LIMIT 1;

  IF v_actor_role IS NULL
     OR v_actor_role NOT IN ('superadmin', 'admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION
      'ERR_TEACHER_UNAUTHORIZED: No tienes permisos para registrar profesores.';
  END IF;

  ---------------------------------------------------------------------------
  -- 1) Normalización de entrada
  ---------------------------------------------------------------------------
  v_name  := btrim(COALESCE(p_name, ''));
  v_dni   := regexp_replace(COALESCE(p_dni, ''), '\D', '', 'g');
  v_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');

  IF char_length(v_name) < 3 THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: El nombre debe tener al menos 3 caracteres.';
  END IF;

  IF char_length(v_dni) <> 8 THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: El DNI debe tener exactamente 8 dígitos.';
  END IF;

  IF char_length(v_phone) < 9 OR char_length(v_phone) > 11 THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: El teléfono debe tener entre 9 y 11 dígitos.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: Debes seleccionar una sede antes de registrar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.schools s
    WHERE s.id = p_school_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: La sede indicada no existe o está inactiva.';
  END IF;

  ---------------------------------------------------------------------------
  -- 2) Alcance de sede (fail-closed para gestor de unidad)
  ---------------------------------------------------------------------------
  IF v_actor_role = 'gestor_unidad' THEN
    IF v_actor_school_id IS NULL OR v_actor_school_id <> p_school_id THEN
      RAISE EXCEPTION
        'ERR_TEACHER_SCHOOL_MISMATCH: Solo puedes registrar profesores de tu sede asignada.';
    END IF;
  END IF;

  ---------------------------------------------------------------------------
  -- 3) Unicidad de DNI (teacher_profiles + parent_profiles)
  ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM public.teacher_profiles tp
    WHERE tp.dni = v_dni
  ) THEN
    RAISE EXCEPTION
      'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.parent_profiles pp
    WHERE pp.dni = v_dni
  ) THEN
    RAISE EXCEPTION
      'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  END IF;

  v_email := format('teacher_%s@kiosco.local', v_dni);

  IF EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE lower(u.email) = lower(v_email)
  ) THEN
    RAISE EXCEPTION
      'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  END IF;

  ---------------------------------------------------------------------------
  -- 4) instance_id vivo (nunca hardcodear ceros)
  ---------------------------------------------------------------------------
  SELECT u.instance_id
    INTO v_instance_id
  FROM auth.users u
  WHERE u.instance_id IS NOT NULL
    AND u.instance_id <> '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RAISE EXCEPTION
      'ERR_TEACHER_DATABASE: No se pudo obtener instance_id del proyecto.';
  END IF;

  ---------------------------------------------------------------------------
  -- 5) Transacción atómica: auth + identities + profiles + teacher_profiles
  ---------------------------------------------------------------------------
  v_user_id := extensions.uuid_generate_v4();
  v_random_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_encrypted_pw := extensions.crypt('Px!' || v_random_secret || 'A1', extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud
  ) VALUES (
    v_user_id,
    v_instance_id,
    lower(v_email),
    v_encrypted_pw,
    v_now,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', v_name,
      'role', 'teacher',
      'dni', v_dni,
      'express_teacher', true,
      'ghost_identity', true
    ),
    v_now,
    v_now,
    'authenticated',
    'authenticated'
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(v_email)),
    'email',
    lower(v_email),
    v_now,
    v_now,
    v_now
  );

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    school_id,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    lower(v_email),
    v_name,
    'teacher',
    p_school_id,
    v_now,
    v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = 'teacher',
    school_id  = EXCLUDED.school_id,
    updated_at = v_now;

  INSERT INTO public.teacher_profiles (
    id,
    full_name,
    dni,
    phone_1,
    area,
    school_id_1,
    school_id_2,
    personal_email,
    corporate_email,
    corporate_phone,
    free_account,
    onboarding_completed,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_name,
    v_dni,
    v_phone,
    'profesor',
    p_school_id,
    NULL,
    NULL,
    NULL,
    NULL,
    true,
    true,
    v_now,
    v_now
  );

  ---------------------------------------------------------------------------
  -- 6) Auditoría
  ---------------------------------------------------------------------------
  INSERT INTO public.audit_logs (
    action,
    actor_id,
    actor_email,
    actor_role,
    target_id,
    target_email,
    target_role,
    target_name,
    details
  ) VALUES (
    'teacher_express_create',
    v_actor_id,
    v_actor_email,
    v_actor_role,
    v_user_id,
    lower(v_email),
    'teacher',
    v_name,
    jsonb_build_object(
      'dni', v_dni,
      'phone_1', v_phone,
      'school_id', p_school_id,
      'ghost_identity', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'teacher_id', v_user_id,
    'full_name', v_name,
    'dni', v_dni,
    'phone_1', v_phone,
    'school_id', p_school_id,
    'email', lower(v_email)
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION
      'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ERR_TEACHER_%' THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'ERR_TEACHER_DATABASE: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_teacher_express(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_teacher_express(text, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.insert_teacher_express(text, text, text, uuid) IS
  'Registro express de profesor: ghost auth + profiles + teacher_profiles en una transacción.';
