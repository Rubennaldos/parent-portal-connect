-- ============================================
-- SCRIPT PARA LIMPIAR TODOS LOS PADRES Y ESTUDIANTES
-- EMPEZAR DE CERO PARA PRUEBAS DEL FLUJO OAUTH
-- ============================================

-- IMPORTANTE: Este script borra TODOS los datos de padres y estudiantes
-- pero mantiene:
-- - Los colegios (schools)
-- - Los productos (products)
-- - Los usuarios de staff (POS, admin, superadmin)

-- ============================================
-- PASO 1: BORRAR TRANSACCIONES Y ITEMS
-- ============================================

-- Borrar items de transacciones de estudiantes
DELETE FROM transaction_items
WHERE transaction_id IN (
  SELECT id FROM transactions WHERE student_id IS NOT NULL
);

-- Borrar transacciones de estudiantes
DELETE FROM transactions
WHERE student_id IS NOT NULL;

-- ============================================
-- PASO 2: BORRAR ALERGIAS
-- ============================================

DELETE FROM allergies
WHERE student_id IN (
  SELECT id FROM students
);

-- ============================================
-- PASO 3: BORRAR RELACIONES FAMILIARES
-- ============================================

DELETE FROM student_relationships;

-- ============================================
-- PASO 4: BORRAR ESTUDIANTES
-- ============================================

DELETE FROM students;

-- ============================================
-- PASO 5: BORRAR TÉRMINOS Y CONDICIONES DE PADRES
-- ============================================

DELETE FROM parent_terms_acceptance
WHERE parent_id IN (
  SELECT user_id FROM parent_profiles
);

-- ============================================
-- PASO 6: BORRAR PARENT PROFILES
-- ============================================

DELETE FROM parent_profiles;

-- ============================================
-- PASO 7: BORRAR PROFILES DE PADRES
-- ============================================

DELETE FROM profiles
WHERE role = 'parent';

-- ============================================
-- PASO 8: BORRAR USUARIOS DE AUTENTICACIÓN (SOLO PADRES)
-- ============================================

-- Obtener todos los user_id que eran padres antes de borrar profiles
DO $$
DECLARE
  parent_user_id UUID;
BEGIN
  -- Borrar usuarios de auth que no tienen perfil (eran padres)
  FOR parent_user_id IN 
    SELECT id FROM auth.users
    WHERE id NOT IN (SELECT id FROM profiles)
  LOOP
    -- Intentar borrar el usuario
    BEGIN
      DELETE FROM auth.users WHERE id = parent_user_id;
      RAISE NOTICE 'Usuario borrado: %', parent_user_id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo borrar usuario %: %', parent_user_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ============================================
-- VERIFICACIÓN POST-LIMPIEZA
-- ============================================

SELECT 
  'students' as tabla, 
  COUNT(*) as registros 
FROM students

UNION ALL

SELECT 
  'parent_profiles' as tabla, 
  COUNT(*) as registros 
FROM parent_profiles

UNION ALL

SELECT 
  'profiles (padres)' as tabla, 
  COUNT(*) as registros 
FROM profiles 
WHERE role = 'parent'

UNION ALL

SELECT 
  'transactions (estudiantes)' as tabla, 
  COUNT(*) as registros 
FROM transactions 
WHERE student_id IS NOT NULL

UNION ALL

SELECT 
  'student_relationships' as tabla, 
  COUNT(*) as registros 
FROM student_relationships

UNION ALL

SELECT 
  'allergies' as tabla, 
  COUNT(*) as registros 
FROM allergies;

-- ============================================
-- RESULTADO ESPERADO
-- ============================================
-- Todas las tablas deberían mostrar 0 registros
-- Si alguna muestra > 0, ejecutar el script de nuevo

