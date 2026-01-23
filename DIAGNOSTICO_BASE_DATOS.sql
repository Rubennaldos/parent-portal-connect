-- ============================================================================
-- DIAGNÓSTICO: Verificar estado de la base de datos
-- ============================================================================

-- 1. ¿Hay estudiantes?
SELECT 
  COUNT(*) as total_estudiantes,
  COUNT(CASE WHEN is_active THEN 1 END) as activos,
  COUNT(CASE WHEN NOT is_active THEN 1 END) as inactivos
FROM students;

-- 2. Ver estudiantes (si los hay)
SELECT 
  s.id,
  s.full_name,
  s.is_active,
  s.balance,
  p.email as padre_email
FROM students s
LEFT JOIN parent_profiles pp ON pp.id = s.parent_id
LEFT JOIN profiles p ON p.id = pp.user_id
ORDER BY s.created_at DESC
LIMIT 5;

-- 3. ¿Hay padres?
SELECT 
  COUNT(*) as total_padres
FROM parent_profiles;

-- 4. Ver padres
SELECT 
  pp.id,
  p.email,
  p.full_name,
  p.created_at
FROM parent_profiles pp
JOIN profiles p ON p.id = pp.user_id
ORDER BY pp.created_at DESC
LIMIT 5;

-- 5. ¿Existe la tabla de tickets?
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'ticket_sequences'
) as tabla_tickets_existe;

-- 6. ¿Existe la función de tickets?
SELECT EXISTS (
  SELECT FROM pg_proc 
  WHERE proname = 'get_next_ticket_number'
) as funcion_tickets_existe;

-- ============================================================================
-- RESULTADO ESPERADO:
-- ============================================================================
-- Si todo está bien, deberías ver:
-- - Al menos 1 estudiante activo
-- - Al menos 1 padre
-- - tabla_tickets_existe = true
-- - funcion_tickets_existe = true
-- ============================================================================
