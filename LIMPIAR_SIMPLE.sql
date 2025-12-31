-- ============================================
-- SCRIPT SIMPLE PARA LIMPIAR TODO
-- ============================================

-- 1. Borrar transaction_items de estudiantes
DELETE FROM transaction_items
WHERE transaction_id IN (SELECT id FROM transactions WHERE student_id IS NOT NULL);

-- 2. Borrar transacciones de estudiantes
DELETE FROM transactions WHERE student_id IS NOT NULL;

-- 3. Borrar alergias
DELETE FROM allergies;

-- 4. Borrar relaciones familiares
DELETE FROM student_relationships;

-- 5. Borrar estudiantes
DELETE FROM students;

-- 6. Borrar términos de padres
DELETE FROM parent_terms_acceptance;

-- 7. Borrar parent_profiles
DELETE FROM parent_profiles;

-- 8. Borrar profiles de padres (IMPORTANTE: Guardar IDs primero)
-- Crear tabla temporal con los IDs
CREATE TEMP TABLE temp_parent_ids AS
SELECT id FROM profiles WHERE role = 'parent';

-- Borrar profiles
DELETE FROM profiles WHERE role = 'parent';

-- 9. Borrar usuarios de autenticación
-- NOTA: Solo funciona si tienes permisos de superadmin
DELETE FROM auth.users 
WHERE id IN (SELECT id FROM temp_parent_ids);

-- Limpiar tabla temporal
DROP TABLE temp_parent_ids;

-- ============================================
-- VERIFICAR QUE TODO SE BORRÓ
-- ============================================

SELECT 'students' as tabla, COUNT(*) as total FROM students
UNION ALL
SELECT 'parent_profiles', COUNT(*) FROM parent_profiles
UNION ALL
SELECT 'profiles (parent)', COUNT(*) FROM profiles WHERE role = 'parent'
UNION ALL
SELECT 'transactions', COUNT(*) FROM transactions WHERE student_id IS NOT NULL;

-- Todos deberían mostrar 0

