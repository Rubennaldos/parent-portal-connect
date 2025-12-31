-- =====================================================
-- LIMPIAR USUARIOS CREADOS CON GOOGLE OAUTH
-- =====================================================
-- Este script elimina COMPLETAMENTE todos los usuarios
-- que se registraron con Google OAuth para poder probar desde cero

-- =====================================================
-- PASO 1: Ver quiénes son los usuarios de Google OAuth
-- =====================================================
-- Ejecuta esto primero para ver a quiénes vas a borrar
SELECT 
  u.id,
  u.email,
  u.created_at,
  u.raw_app_meta_data->>'provider' as provider,
  p.role
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE u.raw_app_meta_data->>'provider' = 'google'
ORDER BY u.created_at DESC;

-- =====================================================
-- PASO 2: Borrar TODOS los datos relacionados
-- =====================================================

-- 2.1 Identificar los IDs de usuarios de Google
DO $$
DECLARE
  user_record RECORD;
BEGIN
  -- Recorrer todos los usuarios de Google
  FOR user_record IN 
    SELECT id, email 
    FROM auth.users 
    WHERE raw_app_meta_data->>'provider' = 'google'
  LOOP
    RAISE NOTICE 'Eliminando usuario: % (%)', user_record.email, user_record.id;
    
    -- 2.2 Borrar transacciones de estudiantes de este padre
    DELETE FROM transaction_items
    WHERE transaction_id IN (
      SELECT t.id 
      FROM transactions t
      INNER JOIN students s ON t.student_id = s.id
      WHERE s.parent_id = user_record.id
    );
    
    DELETE FROM transactions
    WHERE student_id IN (
      SELECT id FROM students WHERE parent_id = user_record.id
    );
    
    -- 2.3 Borrar estudiantes
    DELETE FROM students WHERE parent_id = user_record.id;
    
    -- 2.4 Borrar perfil de padre
    DELETE FROM parent_profiles WHERE user_id = user_record.id;
    
    -- 2.5 Borrar términos y condiciones aceptados
    DELETE FROM terms_and_conditions WHERE user_id = user_record.id;
    
    -- 2.6 Borrar perfil
    DELETE FROM profiles WHERE id = user_record.id;
    
    -- 2.7 Borrar de auth.users (esto es MUY IMPORTANTE)
    DELETE FROM auth.users WHERE id = user_record.id;
    
    RAISE NOTICE 'Usuario eliminado completamente: %', user_record.email;
  END LOOP;
END $$;

-- =====================================================
-- PASO 3: Verificar que se borraron
-- =====================================================
-- Debería devolver 0 filas
SELECT 
  u.id,
  u.email,
  u.raw_app_meta_data->>'provider' as provider
FROM auth.users u
WHERE u.raw_app_meta_data->>'provider' = 'google';

-- =====================================================
-- VERIFICACIÓN ADICIONAL
-- =====================================================
-- Ver cuántos usuarios quedan en el sistema
SELECT 
  COUNT(*) as total_usuarios,
  COUNT(CASE WHEN raw_app_meta_data->>'provider' = 'email' THEN 1 END) as email_usuarios,
  COUNT(CASE WHEN raw_app_meta_data->>'provider' = 'google' THEN 1 END) as google_usuarios
FROM auth.users;

-- Ver perfiles que quedaron
SELECT 
  p.id,
  p.email,
  p.role,
  p.created_at
FROM profiles p
ORDER BY p.created_at DESC;

-- =====================================================
-- INSTRUCCIONES DE USO
-- =====================================================
-- 1. Ejecuta PRIMERO el PASO 1 para ver qué usuarios se van a borrar
-- 2. Si estás seguro, ejecuta el PASO 2 para borrar todo
-- 3. Ejecuta el PASO 3 para verificar que se borraron correctamente
-- 
-- IMPORTANTE:
-- - Este script borra PERMANENTEMENTE los datos
-- - NO se puede deshacer
-- - Solo borra usuarios que se registraron con Google OAuth
-- - Los usuarios con email/password quedan intactos


