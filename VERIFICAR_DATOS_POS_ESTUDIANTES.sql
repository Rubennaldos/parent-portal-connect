-- ============================================
-- VERIFICACIÓN COMPLETA DE DATOS POS Y ESTUDIANTES
-- ============================================

-- 1. VER EL USUARIO POS ACTUAL Y SUS DATOS
SELECT 
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.school_id,
  s.name as "Colegio",
  s.code as "Código Colegio",
  p.pos_number,
  p.ticket_prefix,
  p.created_at
FROM profiles p
LEFT JOIN schools s ON s.id = p.school_id
WHERE p.role = 'pos'
ORDER BY p.created_at DESC;

-- 2. VER SI EL USUARIO POS TIENE SECUENCIA DE TICKETS
SELECT 
  p.email as "Email POS",
  p.full_name as "Nombre POS",
  p.ticket_prefix as "Prefix en Profile",
  ts.prefix as "Prefix en Sequence",
  ts.current_number as "Número Actual",
  ts.last_reset_date as "Último Reset",
  ts.created_at as "Sequence Creada"
FROM profiles p
LEFT JOIN ticket_sequences ts ON ts.pos_user_id = p.id
WHERE p.role = 'pos';

-- 3. VER LOS ESTUDIANTES Y SI TIENEN COLEGIO
SELECT 
  st.id,
  st.full_name,
  st.parent_id,
  pr.email as "Email Padre",
  st.school_id,
  sc.name as "Colegio",
  sc.code as "Código Colegio",
  st.balance,
  st.is_active,
  st.created_at
FROM students st
LEFT JOIN profiles pr ON pr.id = st.parent_id
LEFT JOIN schools sc ON sc.id = st.school_id
ORDER BY st.created_at DESC;

-- 4. VER LOS PADRES Y CÓMO FUERON CREADOS
SELECT 
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.school_id,
  s.name as "Colegio",
  p.created_at,
  CASE 
    WHEN p.school_id IS NULL THEN '❌ SIN COLEGIO'
    ELSE '✅ CON COLEGIO'
  END as "Estado"
FROM profiles p
LEFT JOIN schools s ON s.id = p.school_id
WHERE p.role = 'parent'
ORDER BY p.created_at DESC;

-- 5. VER SI HAY ESTUDIANTES SIN COLEGIO (PROBLEMA DETECTADO)
SELECT 
  COUNT(*) as "Total Estudiantes",
  COUNT(school_id) as "Con Colegio",
  COUNT(*) - COUNT(school_id) as "Sin Colegio (PROBLEMA)"
FROM students;

-- 6. VER SI HAY PADRES SIN COLEGIO
SELECT 
  COUNT(*) as "Total Padres",
  COUNT(school_id) as "Con Colegio",
  COUNT(*) - COUNT(school_id) as "Sin Colegio (PROBLEMA)"
FROM profiles
WHERE role = 'parent';

-- 7. DETALLE DE ESTUDIANTES SIN COLEGIO
SELECT 
  st.id,
  st.full_name as "Estudiante",
  pr.email as "Email Padre",
  st.school_id,
  st.parent_id,
  st.balance,
  st.created_at
FROM students st
LEFT JOIN profiles pr ON pr.id = st.parent_id
WHERE st.school_id IS NULL
ORDER BY st.created_at DESC;

-- ============================================
-- ANÁLISIS: ¿QUÉ PUEDE ESTAR FALLANDO?
-- ============================================

/*
POSIBLES PROBLEMAS:

1. USUARIO POS SIN SCHOOL_ID
   - Si el POS no tiene school_id, no puede buscar estudiantes de su sede

2. USUARIO POS SIN TICKET_PREFIX O POS_NUMBER
   - Si no tiene estos datos, no se puede generar el correlativo

3. USUARIO POS SIN REGISTRO EN TICKET_SEQUENCES
   - Si no existe la secuencia, la función get_next_ticket_number falla

4. ESTUDIANTES SIN SCHOOL_ID
   - Si los estudiantes no tienen school_id, el POS no los puede filtrar por sede

5. PADRES SIN SCHOOL_ID
   - Si los padres no tienen school_id, sus hijos tampoco lo tienen

6. PADRES CREADOS MANUALMENTE (NO POR LINK)
   - Si se crearon directo en Supabase sin pasar por el flujo de registro,
     pueden faltar datos como school_id, full_name, etc.
*/

