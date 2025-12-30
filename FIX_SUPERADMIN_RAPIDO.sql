-- ⚡ ARREGLO RÁPIDO - RESTAURAR SUPERADMIN
-- Copia y pega TODO este bloque en Supabase SQL Editor

-- 1️⃣ Insertar/Actualizar el perfil (funciona siempre)
INSERT INTO public.profiles (id, email, role)
SELECT 
  au.id,
  au.email,
  'superadmin'
FROM auth.users au
WHERE au.email = 'superadmin@limacafe28.com'
ON CONFLICT (id) 
DO UPDATE SET role = 'superadmin';

-- 2️⃣ Verificar que funcionó
SELECT id, email, role FROM public.profiles WHERE email = 'superadmin@limacafe28.com';

-- Deberías ver: role = 'superadmin'
-- ✅ Si ves 'superadmin', ¡está listo!
-- ❌ Si ves otra cosa, avísame.


