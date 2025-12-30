-- ============================================
-- RESTAURAR PERFIL DE SUPERADMIN
-- ============================================

-- PASO 1: Ver qué rol tienes actualmente
SELECT id, email, role, created_at 
FROM public.profiles 
WHERE email = 'superadmin@limacafe28.com';

-- Si NO aparece nada, significa que el perfil no existe.
-- Si aparece pero el rol es incorrecto, necesitamos actualizarlo.

-- ============================================
-- PASO 2: INSERTAR o ACTUALIZAR el perfil de superadmin
-- ============================================

-- Opción A: Si el perfil NO existe (INSERT)
INSERT INTO public.profiles (id, email, role)
SELECT 
  au.id,
  au.email,
  'superadmin'
FROM auth.users au
WHERE au.email = 'superadmin@limacafe28.com'
ON CONFLICT (id) 
DO UPDATE SET role = 'superadmin';

-- La ventaja de este query es que funciona tanto si existe como si no existe el perfil.
-- Si existe, solo actualiza el rol. Si no existe, lo crea.

-- ============================================
-- PASO 3: VERIFICAR que se actualizó correctamente
-- ============================================

SELECT 
  p.id,
  p.email,
  p.role,
  p.created_at,
  au.id as auth_user_id,
  au.email as auth_email
FROM public.profiles p
INNER JOIN auth.users au ON p.id = au.id
WHERE p.email = 'superadmin@limacafe28.com';

-- Deberías ver:
-- role = 'superadmin'
-- Los IDs deben coincidir entre profiles y auth.users

-- ============================================
-- ALTERNATIVA: Si el email es diferente
-- ============================================

-- Si tu email de superadmin es otro (no superadmin@limacafe28.com),
-- reemplaza 'TU_EMAIL_AQUI' con tu email real:

/*
INSERT INTO public.profiles (id, email, role)
SELECT 
  au.id,
  au.email,
  'superadmin'
FROM auth.users au
WHERE au.email = 'TU_EMAIL_AQUI@limacafe28.com'
ON CONFLICT (id) 
DO UPDATE SET role = 'superadmin';

SELECT id, email, role FROM public.profiles WHERE email = 'TU_EMAIL_AQUI@limacafe28.com';
*/

-- ============================================
-- PASO 4: LIMPIA LA CACHÉ DEL NAVEGADOR
-- ============================================

-- Después de ejecutar este script:
-- 1. Cierra sesión en la app (botón "Salir")
-- 2. Presiona Ctrl + Shift + Delete (Chrome/Edge) o Ctrl + Shift + Supr (Firefox)
-- 3. Borra "Cookies" y "Datos de sitios"
-- 4. O usa ventana de incógnito
-- 5. Inicia sesión de nuevo como superadmin
-- 6. Selecciona "Personal Administrativo" en el login
-- 7. Deberías ir a /superadmin

-- ============================================
-- BONUS: Ver todos los usuarios y sus roles
-- ============================================

SELECT 
  p.email,
  p.role,
  au.created_at
FROM public.profiles p
INNER JOIN auth.users au ON p.id = au.id
ORDER BY p.role, p.email;


