-- ============================================
-- VERIFICAR CONFIGURACIÓN DE DELAY
-- ============================================

-- 1. Ver todas las configuraciones de delay
SELECT 
  s.name AS sede_nombre,
  pvd.delay_days AS dias_delay,
  pvd.created_at AS fecha_creacion
FROM purchase_visibility_delay pvd
LEFT JOIN schools s ON s.id = pvd.school_id
ORDER BY s.name;

-- 2. Ver sedes SIN configuración de delay
SELECT 
  id,
  name AS sede_nombre
FROM schools
WHERE id NOT IN (SELECT school_id FROM purchase_visibility_delay);

-- 3. Ver el estudiante "hijo soluciones prueba" y su sede
SELECT 
  s.id AS student_id,
  s.full_name AS nombre_estudiante,
  s.school_id,
  sch.name AS sede_nombre
FROM students s
LEFT JOIN schools sch ON sch.id = s.school_id
WHERE s.full_name ILIKE '%hijo soluciones prueba%';

-- 4. Ver las compras de este estudiante
SELECT 
  t.id,
  t.created_at AS fecha_compra,
  t.amount AS monto,
  t.description AS descripcion,
  t.payment_status AS estado_pago
FROM transactions t
WHERE t.student_id IN (
  SELECT id FROM students WHERE full_name ILIKE '%hijo soluciones prueba%'
)
AND t.type = 'purchase'
AND t.payment_status = 'pending'
ORDER BY t.created_at DESC;
