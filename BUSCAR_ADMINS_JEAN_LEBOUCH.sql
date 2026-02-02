-- ============================================
-- BUSCAR ADMINS DE JEAN LEBOUCH
-- ============================================

-- 1. Ver la sede Jean LeBouch
SELECT 
  id,
  name,
  code,
  address
FROM public.schools
WHERE name ILIKE '%jean%' OR name ILIKE '%lebouch%';

-- 2. Ver todos los gestores/admins de Jean LeBouch
-- Usando los IDs de sede que vimos: 8a0dbd73-0571-4db1-af5c-65f4948c4c98
SELECT 
  p.id,
  p.email,
  p.role,
  p.full_name,
  p.school_id,
  s.name as school_name,
  p.created_at
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
WHERE p.school_id IN (
  '8a0dbd73-0571-4db1-af5c-65f4948c4c98',
  '14eafb90-824b-4498-b0dd-1e9d0fe26795'
)
ORDER BY p.created_at DESC;

-- 3. Ver el admin_general (puede ver todas las sedes)
SELECT 
  p.id,
  p.email,
  p.role,
  p.full_name,
  p.school_id,
  s.name as school_name
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
WHERE p.role = 'admin_general';
