-- ============================================
-- VERIFICAR Y ARREGLAR RLS DE LUNCH_CONFIGURATION
-- ============================================

-- 1. Ver las políticas actuales
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'lunch_configuration'
ORDER BY cmd, policyname;

-- 2. Verificar si RLS está habilitado
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'lunch_configuration';

-- 3. Intentar actualizar directamente (para verificar permisos)
SELECT 
  id,
  school_id,
  delivery_start_time,
  delivery_end_time,
  auto_close_day,
  auto_mark_as_delivered
FROM public.lunch_configuration
LIMIT 5;
