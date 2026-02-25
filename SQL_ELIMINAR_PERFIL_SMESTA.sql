-- ============================================
-- 🔍 DIAGNÓSTICO: Buscar perfil smesta@champagnat.edu.pe
-- ============================================
-- Ejecuta PASO 1 primero para ver qué encontramos

-- PASO 1: Buscar en tabla profiles
SELECT 
    'profiles' AS tabla,
    id,
    email,
    full_name,
    role,
    school_id,
    created_at,
    updated_at
FROM profiles
WHERE email = 'smesta@champagnat.edu.pe'
   OR email ILIKE '%smesta%';


-- PASO 2: Buscar en auth.users (tabla de autenticación)
SELECT 
    'auth.users' AS tabla,
    id AS auth_user_id,
    email,
    created_at,
    last_sign_in_at,
    email_confirmed_at
FROM auth.users
WHERE email = 'smesta@champagnat.edu.pe'
   OR email ILIKE '%smesta%';


-- PASO 3: Buscar referencias en otras tablas
-- Nota: Si PASO 1 y 2 no encontraron nada, este paso también debería retornar 0
SELECT 'students' AS tabla, COUNT(*) AS registros
FROM students
WHERE parent_id IN (
    SELECT id FROM profiles WHERE email = 'smesta@champagnat.edu.pe'
)
UNION ALL
SELECT 'teacher_profiles', COUNT(*)
FROM teacher_profiles
WHERE id IN (
    SELECT id FROM profiles WHERE email = 'smesta@champagnat.edu.pe'
)
UNION ALL
SELECT 'lunch_orders', COUNT(*)
FROM lunch_orders
WHERE created_by IN (
    SELECT id FROM profiles WHERE email = 'smesta@champagnat.edu.pe'
)
UNION ALL
SELECT 'transactions', COUNT(*)
FROM transactions
WHERE created_by IN (
    SELECT id FROM profiles WHERE email = 'smesta@champagnat.edu.pe'
)
UNION ALL
SELECT 'recharge_requests', COUNT(*)
FROM recharge_requests
WHERE parent_id IN (
    SELECT id FROM profiles WHERE email = 'smesta@champagnat.edu.pe'
);


-- ============================================
-- 🗑️ ELIMINACIÓN: Borrar perfil y usuario
-- ============================================
-- ⚠️ SOLO ejecutar después de revisar los resultados del diagnóstico

-- PASO 4: Obtener IDs necesarios
-- ✅ PERFIL ENCONTRADO: sandramesta17@gmail.com (Sandra Mesta)
-- ID: 96a13cd0-d1e0-498d-a257-d8c366fdef94

DO $$
DECLARE
    v_profile_id UUID := '96a13cd0-d1e0-498d-a257-d8c366fdef94';
    v_auth_user_id UUID;
BEGIN
    -- Obtener ID de auth.users
    SELECT id INTO v_auth_user_id
    FROM auth.users
    WHERE id = v_profile_id;
    
    -- Mostrar IDs encontrados
    RAISE NOTICE 'Profile ID: %', v_profile_id;
    RAISE NOTICE 'Auth User ID: %', v_auth_user_id;
    
    IF v_auth_user_id IS NULL THEN
        RAISE NOTICE '⚠️ No se encontró en auth.users';
    ELSE
        RAISE NOTICE '✅ Usuario encontrado, listo para eliminar';
    END IF;
END $$;


-- PASO 5: Verificar referencias antes de eliminar
-- Ejecuta esto primero para ver si hay datos relacionados
SELECT 
    'recharge_requests' AS tabla, COUNT(*) AS registros
FROM recharge_requests
WHERE parent_id = '96a13cd0-d1e0-498d-a257-d8c366fdef94'
UNION ALL
SELECT 'transactions', COUNT(*)
FROM transactions
WHERE created_by = '96a13cd0-d1e0-498d-a257-d8c366fdef94'
UNION ALL
SELECT 'lunch_orders', COUNT(*)
FROM lunch_orders
WHERE created_by = '96a13cd0-d1e0-498d-a257-d8c366fdef94'
UNION ALL
SELECT 'students', COUNT(*)
FROM students
WHERE parent_id = '96a13cd0-d1e0-498d-a257-d8c366fdef94'
UNION ALL
SELECT 'teacher_profiles', COUNT(*)
FROM teacher_profiles
WHERE id = '96a13cd0-d1e0-498d-a257-d8c366fdef94';


-- PASO 6: Eliminar referencias en tablas relacionadas
-- ✅ Ejecutar en este orden (hay 3 registros que eliminar)

-- 6.1: Eliminar transacciones
DELETE FROM transactions
WHERE created_by = '96a13cd0-d1e0-498d-a257-d8c366fdef94';

-- 6.2: Eliminar pedidos de almuerzo
DELETE FROM lunch_orders
WHERE created_by = '96a13cd0-d1e0-498d-a257-d8c366fdef94';

-- 6.3: Eliminar perfil de profesor
DELETE FROM teacher_profiles
WHERE id = '96a13cd0-d1e0-498d-a257-d8c366fdef94';


-- PASO 7: Eliminar de tabla profiles
DELETE FROM profiles
WHERE id = '96a13cd0-d1e0-498d-a257-d8c366fdef94';


-- PASO 8: Eliminar de auth.users
-- ⚠️ Esta operación debe hacerse desde Supabase Dashboard → Authentication → Users
-- O ejecutar con permisos de admin:
-- DELETE FROM auth.users
-- WHERE id = '96a13cd0-d1e0-498d-a257-d8c366fdef94';
