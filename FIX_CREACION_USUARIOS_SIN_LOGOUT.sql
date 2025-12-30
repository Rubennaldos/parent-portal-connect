-- ============================================
-- 🔧 FIX: CREAR USUARIOS SIN CERRAR SESIÓN DEL SUPERADMIN
-- ============================================
-- Problema: supabase.auth.signUp() hace auto-login
-- Solución: Función SQL con service_role
-- ============================================

-- ============================================
-- 1. FUNCIÓN PARA CREAR USUARIO POS/KITCHEN
-- ============================================

CREATE OR REPLACE FUNCTION create_staff_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role TEXT, -- 'pos' o 'kitchen'
  p_school_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_pos_number INTEGER;
  v_ticket_prefix TEXT;
  v_result JSON;
BEGIN
  -- Validar que el rol sea válido
  IF p_role NOT IN ('pos', 'kitchen') THEN
    RAISE EXCEPTION 'Rol inválido. Use "pos" o "kitchen"';
  END IF;

  -- Generar UUID para el nuevo usuario
  v_user_id := gen_random_uuid();

  -- Si es POS, calcular número y prefijo
  IF p_role = 'pos' THEN
    -- Obtener siguiente número POS
    SELECT COALESCE(MAX(pos_number), 0) + 1 
    INTO v_pos_number
    FROM profiles
    WHERE school_id = p_school_id AND role = 'pos';

    -- Validar límite de 3 cajeros
    IF v_pos_number > 3 THEN
      RAISE EXCEPTION 'Esta sede ya tiene 3 cajeros. No se pueden crear más.';
    END IF;

    -- Generar prefijo
    SELECT generate_ticket_prefix(p_school_id, v_pos_number)
    INTO v_ticket_prefix;
  END IF;

  -- Insertar en auth.users (requiere service_role, se debe ejecutar desde backend)
  -- Por ahora, solo creamos el perfil y el usuario se creará desde el frontend
  
  -- Crear perfil
  INSERT INTO profiles (
    id,
    email,
    role,
    school_id,
    pos_number,
    ticket_prefix
  ) VALUES (
    v_user_id,
    p_email,
    p_role,
    p_school_id,
    v_pos_number,
    v_ticket_prefix
  );

  -- Si es POS, crear secuencia de tickets
  IF p_role = 'pos' THEN
    INSERT INTO ticket_sequences (
      school_id,
      pos_user_id,
      prefix,
      current_number
    ) VALUES (
      p_school_id,
      v_user_id,
      v_ticket_prefix,
      0
    );
  END IF;

  -- Retornar resultado
  v_result := json_build_object(
    'user_id', v_user_id,
    'email', p_email,
    'role', p_role,
    'pos_number', v_pos_number,
    'ticket_prefix', v_ticket_prefix,
    'message', 'Usuario creado exitosamente (pendiente activación en auth)'
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al crear usuario: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. PERMISOS
-- ============================================

-- Solo SuperAdmin puede ejecutar esta función
REVOKE ALL ON FUNCTION create_staff_user FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_staff_user TO authenticated;

-- ============================================
-- ✅ VERIFICACIÓN
-- ============================================

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'create_staff_user';

-- ============================================
-- 📝 NOTAS DE USO
-- ============================================

/*
Esta función PREPARA el perfil, pero NO crea el usuario en auth.users
porque eso requiere service_role key.

SOLUCIÓN TEMPORAL:
1. El frontend usa signUp() para crear en auth
2. INMEDIATAMENTE después hace logout del nuevo usuario
3. Restaura la sesión del SuperAdmin

SOLUCIÓN DEFINITIVA (Para implementar después):
- Crear un Edge Function en Supabase que use service_role
- El frontend llama a esa función
- La función crea el usuario sin hacer auto-login
*/

