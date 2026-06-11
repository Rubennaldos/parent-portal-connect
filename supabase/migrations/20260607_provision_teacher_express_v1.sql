-- =============================================================================
-- Provision Express de Profesores ÔÇö v1
-- Reemplaza insert_teacher_express (que intentaba INSERT manual en auth.users).
--
-- CAMBIO ARQUITECT├ôNICO:
--   La creaci├│n del usuario en Auth la hace la Edge Function teacher-express
--   usando supabaseAdmin.auth.admin.createUser() (mismo patr├│n que express-enrollment).
--   Este RPC SOLO toca tablas p├║blicas: profiles + teacher_profiles + audit_logs.
--   Sin contacto con auth.* ÔåÆ sin dependencia de instance_id.
-- =============================================================================

-- Limpiar versi├│n rota
DROP FUNCTION IF EXISTS public.insert_teacher_express(text, text, text, uuid);

-- =============================================================================
-- RPC provision_teacher_express_v1
-- Argumentos: p_user_id (ya creado por Auth Admin API), p_name, p_dni, p_phone,
--             p_school_id, p_actor_id (quien llama, para auditor├¡a).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.provision_teacher_express_v1(
  p_user_id   uuid,
  p_name      text,
  p_dni       text,
  p_phone     text,
  p_school_id uuid,
  p_actor_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_role      text;
  v_actor_school_id uuid;
  v_actor_email     text;
  v_name            text;
  v_dni             text;
  v_phone           text;
  v_email           text;
  v_now             timestamptz := now();
BEGIN
  ---------------------------------------------------------------------------
  -- 0) Validaci├│n de actor (fail-closed)
  ---------------------------------------------------------------------------
  SELECT p.role, p.school_id, p.email
    INTO v_actor_role, v_actor_school_id, v_actor_email
  FROM public.profiles p
  WHERE p.id = p_actor_id
  LIMIT 1;

  IF v_actor_role IS NULL
     OR v_actor_role NOT IN ('superadmin', 'admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION
      'ERR_TEACHER_UNAUTHORIZED: No tienes permisos para registrar profesores.';
  END IF;

  ---------------------------------------------------------------------------
  -- 1) Normalizaci├│n de entrada
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
      'ERR_TEACHER_INVALID_INPUT: El DNI debe tener exactamente 8 d├¡gitos.';
  END IF;

  IF char_length(v_phone) < 9 OR char_length(v_phone) > 11 THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: El tel├®fono debe tener entre 9 y 11 d├¡gitos.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: Debes indicar una sede v├ílida.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = p_school_id AND s.is_active = true
  ) THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: La sede indicada no existe o est├í inactiva.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION
      'ERR_TEACHER_INVALID_INPUT: p_user_id es requerido (Auth ya debe haber creado el usuario).';
  END IF;

  ---------------------------------------------------------------------------
  -- 2) Alcance de sede (gestor_unidad solo puede registrar en su sede)
  ---------------------------------------------------------------------------
  IF v_actor_role = 'gestor_unidad' THEN
    IF v_actor_school_id IS NULL OR v_actor_school_id <> p_school_id THEN
      RAISE EXCEPTION
        'ERR_TEACHER_SCHOOL_MISMATCH: Solo puedes registrar profesores de tu sede asignada.';
    END IF;
  END IF;

  ---------------------------------------------------------------------------
  -- 3) Unicidad de DNI en tablas p├║blicas
  ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.teacher_profiles tp WHERE tp.dni = v_dni) THEN
    RAISE EXCEPTION 'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.parent_profiles pp WHERE pp.dni = v_dni) THEN
    RAISE EXCEPTION 'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  END IF;

  v_email := format('teacher_%s@kiosco.local', v_dni);

  ---------------------------------------------------------------------------
  -- 4) Transacci├│n at├│mica: solo tablas p├║blicas
  --    Auth ya fue creado por la Edge Function usando Admin API.
  ---------------------------------------------------------------------------
  INSERT INTO public.profiles (
    id, email, full_name, role, school_id, created_at, updated_at
  ) VALUES (
    p_user_id, lower(v_email), v_name, 'teacher', p_school_id, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = 'teacher',
    school_id  = EXCLUDED.school_id,
    updated_at = v_now;

  INSERT INTO public.teacher_profiles (
    id, full_name, dni, phone_1, area,
    school_id_1, school_id_2,
    personal_email, corporate_email, corporate_phone,
    free_account, onboarding_completed,
    created_at, updated_at
  ) VALUES (
    p_user_id, v_name, v_dni, v_phone, 'profesor',
    p_school_id, NULL,
    NULL, NULL, NULL,
    true, true,
    v_now, v_now
  );

  ---------------------------------------------------------------------------
  -- 5) Auditor├¡a ÔÇö columnas reales de audit_logs:
  --    admin_user_id, action, details, target_user_id, "timestamp", created_at
  ---------------------------------------------------------------------------
  INSERT INTO public.audit_logs (
    action,
    admin_user_id,
    target_user_id,
    details,
    "timestamp",
    created_at
  ) VALUES (
    'teacher_express_create',
    p_actor_id,
    p_user_id,
    jsonb_build_object(
      'actor_email',  v_actor_email,
      'actor_role',   v_actor_role,
      'target_name',  v_name,
      'target_email', lower(v_email),
      'target_role',  'teacher',
      'dni',          v_dni,
      'phone_1',      v_phone,
      'school_id',    p_school_id,
      'ghost_identity', true
    ),
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'success',     true,
    'teacher_id',  p_user_id,
    'full_name',   v_name,
    'dni',         v_dni,
    'phone_1',     v_phone,
    'school_id',   p_school_id,
    'email',       lower(v_email)
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_TEACHER_DUPLICATE_DNI: El DNI ya se encuentra registrado';
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ERR_TEACHER_%' THEN RAISE; END IF;
    RAISE EXCEPTION 'ERR_TEACHER_DATABASE: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_teacher_express_v1(uuid, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_teacher_express_v1(uuid, text, text, text, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.provision_teacher_express_v1 IS
  'Provisiona profiles + teacher_profiles para un ghost teacher ya creado por Auth Admin API. '
  'Sin contacto con auth.*. Llamado exclusivamente por la Edge Function teacher-express.';
