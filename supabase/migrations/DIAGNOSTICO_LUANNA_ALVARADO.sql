-- ============================================================
-- DIAGNÓSTICO: Luanna belén alvarado ampuero — saldo faltante
-- ============================================================

-- 1. Datos del alumno
SELECT id, full_name, balance, free_account, school_id
FROM students
WHERE unaccent(lower(full_name)) ILIKE '%luanna%alvarado%';

-- 2. TODAS sus transacciones de kiosco (sin filtrar por lunch_order_id)
SELECT
  id,
  amount,
  type,
  payment_status,
  created_at AT TIME ZONE 'America/Lima' AS fecha_lima,
  ticket_code,
  metadata->>'lunch_order_id' AS lunch_order_id,
  metadata->>'source'          AS fuente,
  description
FROM transactions
WHERE student_id = (
  SELECT id FROM students
  WHERE unaccent(lower(full_name)) ILIKE '%luanna%alvarado%'
  LIMIT 1
)
ORDER BY created_at DESC;

-- 3. Resumen: cuánto se descontó en total (por payment_status y si tiene lunch_order_id o no)
SELECT
  payment_status,
  CASE WHEN metadata->>'lunch_order_id' IS NOT NULL THEN 'con_lunch_id' ELSE 'solo_kiosco' END AS origen,
  COUNT(*) AS cantidad,
  SUM(amount) AS suma_amount
FROM transactions
WHERE student_id = (
  SELECT id FROM students
  WHERE unaccent(lower(full_name)) ILIKE '%luanna%alvarado%'
  LIMIT 1
)
GROUP BY 1, 2
ORDER BY 1, 2;
