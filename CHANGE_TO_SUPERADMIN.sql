-- ============================================
-- SCRIPT: Cambiar usuario a SuperAdmin
-- ============================================
-- Objetivo: Actualizar el correo superadmin@limacafe28.com a rol 'superadmin'
-- ============================================

-- PASO 1: Verificar el usuario actual
SELECT 
    id,
    email,
    role
FROM 
    public.profiles
WHERE 
    email = 'superadmin@limacafe28.com';

-- PASO 2: Actualizar el rol a 'superadmin'
UPDATE public.profiles
SET role = 'superadmin'
WHERE email = 'superadmin@limacafe28.com';

-- PASO 3: Verificar el cambio
SELECT 
    id,
    email,
    role,
    created_at
FROM 
    public.profiles
WHERE 
    email = 'superadmin@limacafe28.com';

-- ============================================
-- INSTRUCCIONES:
-- ============================================
-- 1. Abre Supabase Dashboard
-- 2. Ve a SQL Editor
-- 3. Copia y pega este script
-- 4. Ejecuta línea por línea o todo junto
-- 5. Cierra sesión en la app
-- 6. Borra localStorage (F12 > Application > Clear)
-- 7. Vuelve a iniciar sesión como "Personal Administrativo"
-- ============================================

