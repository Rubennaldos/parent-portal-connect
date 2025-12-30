-- ============================================
-- BACKUP MANUAL DE LA BASE DE DATOS
-- Parent Portal Connect - Lima Café 28
-- ============================================
-- Fecha: 30 Diciembre 2024
-- Instrucciones: Ejecuta cada sección en SQL Editor de Supabase
-- ============================================

-- ============================================
-- 1. EXPORTAR ESTRUCTURA DE TABLAS
-- ============================================

-- Ver todas las tablas existentes
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================
-- 2. EXPORTAR DATOS DE PROFILES
-- ============================================

-- Ver todos los perfiles de usuario
SELECT id, email, role, created_at 
FROM public.profiles 
ORDER BY created_at DESC;

-- Contar usuarios por rol
SELECT role, COUNT(*) as total
FROM public.profiles
GROUP BY role
ORDER BY total DESC;

-- ============================================
-- 3. EXPORTAR DATOS DE PARENT_PROFILES
-- ============================================

-- Ver todos los perfiles de padres
SELECT 
  pp.user_id,
  pp.full_name,
  pp.dni,
  pp.phone_1,
  pp.address,
  s.name as school_name,
  pp.onboarding_completed,
  pp.created_at
FROM public.parent_profiles pp
LEFT JOIN public.schools s ON pp.school_id = s.id
ORDER BY pp.created_at DESC;

-- ============================================
-- 4. EXPORTAR DATOS DE STUDENTS
-- ============================================

-- Ver todos los estudiantes
SELECT 
  s.id,
  s.parent_id,
  s.full_name,
  s.grade,
  s.section,
  s.balance,
  s.daily_limit,
  s.is_active,
  sc.name as school_name
FROM public.students s
LEFT JOIN public.schools sc ON s.school_id = sc.id
ORDER BY s.created_at DESC;

-- Contar estudiantes por grado
SELECT grade, COUNT(*) as total
FROM public.students
WHERE is_active = true
GROUP BY grade
ORDER BY grade;

-- ============================================
-- 5. EXPORTAR DATOS DE SCHOOLS
-- ============================================

-- Ver todos los colegios
SELECT id, name, code, address, is_active, created_at
FROM public.schools
ORDER BY name;

-- ============================================
-- 6. EXPORTAR DATOS DE PRODUCTS
-- ============================================

-- Ver todos los productos
SELECT 
  id, 
  name, 
  category, 
  price, 
  stock, 
  is_active,
  created_at
FROM public.products
ORDER BY category, name;

-- Contar productos por categoría
SELECT category, COUNT(*) as total, SUM(stock) as stock_total
FROM public.products
WHERE is_active = true
GROUP BY category
ORDER BY total DESC;

-- ============================================
-- 7. EXPORTAR DATOS DE TRANSACTIONS
-- ============================================

-- Ver últimas 50 transacciones
SELECT 
  t.id,
  t.student_id,
  s.full_name as student_name,
  t.transaction_type,
  t.amount,
  t.balance_after,
  t.created_at
FROM public.transactions t
LEFT JOIN public.students s ON t.student_id = s.id
ORDER BY t.created_at DESC
LIMIT 50;

-- Resumen de transacciones por tipo
SELECT 
  transaction_type,
  COUNT(*) as cantidad,
  SUM(amount) as total_monto
FROM public.transactions
GROUP BY transaction_type
ORDER BY total_monto DESC;

-- ============================================
-- 8. EXPORTAR DATOS DE ALLERGIES
-- ============================================

-- Ver todas las alergias registradas
SELECT 
  a.id,
  a.student_id,
  s.full_name as student_name,
  a.allergy_type,
  a.notes,
  a.created_at
FROM public.allergies a
LEFT JOIN public.students s ON a.student_id = s.id
ORDER BY a.created_at DESC;

-- ============================================
-- 9. EXPORTAR DATOS DE STUDENT_RELATIONSHIPS
-- ============================================

-- Ver todas las relaciones familiares
SELECT 
  sr.id,
  sr.student_id,
  s.full_name as student_name,
  sr.parent_id,
  pp.full_name as parent_name,
  sr.relationship,
  sr.is_primary
FROM public.student_relationships sr
LEFT JOIN public.students s ON sr.student_id = s.id
LEFT JOIN public.parent_profiles pp ON sr.parent_id = pp.user_id
ORDER BY sr.created_at DESC;

-- ============================================
-- 10. ESTADÍSTICAS GENERALES
-- ============================================

-- Resumen completo del sistema
SELECT 
  'Total Usuarios' as metrica,
  COUNT(*) as cantidad
FROM public.profiles

UNION ALL

SELECT 
  'Total Padres',
  COUNT(*)
FROM public.parent_profiles

UNION ALL

SELECT 
  'Total Estudiantes',
  COUNT(*)
FROM public.students
WHERE is_active = true

UNION ALL

SELECT 
  'Total Productos',
  COUNT(*)
FROM public.products
WHERE is_active = true

UNION ALL

SELECT 
  'Total Transacciones',
  COUNT(*)
FROM public.transactions

UNION ALL

SELECT 
  'Balance Total Estudiantes',
  ROUND(SUM(balance)::numeric, 2)
FROM public.students
WHERE is_active = true;

-- ============================================
-- FIN DEL BACKUP
-- ============================================

-- NOTA: Guarda los resultados de cada query en un archivo .csv
-- Desde Supabase SQL Editor:
-- 1. Ejecuta cada query
-- 2. Click en "Download CSV" para cada resultado
-- 3. Guarda todos los archivos en una carpeta "backup-FECHA"


