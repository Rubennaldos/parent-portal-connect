-- ¿Por qué el padre de Renzo no aparece en el buscador?
-- Investigar el parent_id nulo en sus recharge_requests

-- ── 1. Ver los datos crudos de las dos solicitudes ───────────
SELECT
  id,
  parent_id,
  student_id,
  school_id,
  amount,
  status,
  created_at
FROM recharge_requests
WHERE id IN (
  'fab60ac1-8d3a-43e1-9552-e9a90d75766a',
  'f0ba3779-d51f-4b9a-b5c0-fc6492cb7e05'
);

-- ── 2. ¿Existe un perfil vinculado al alumno Renzo? ──────────
-- Busca si hay algún padre en profiles que tenga a Renzo
-- como hijo (por student_id o por parent_id en students)
SELECT
  p.id          AS perfil_id,
  p.full_name   AS nombre_padre,
  p.email,
  p.role,
  s.full_name   AS alumno_vinculado
FROM profiles p
JOIN students s ON s.parent_id = p.id
WHERE s.id = '48f287ce-737a-4598-a0fb-20b22d522159';

-- ── 3. ¿El alumno tiene parent_id en la tabla students? ──────
SELECT
  id,
  full_name,
  parent_id,
  school_id
FROM students
WHERE id = '48f287ce-737a-4598-a0fb-20b22d522159';
