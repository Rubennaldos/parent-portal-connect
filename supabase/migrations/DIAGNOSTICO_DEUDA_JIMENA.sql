-- ============================================================================
-- DIAGNÓSTICO: Descuadre de deuda — Jimena Alexandra Giribaldi Lozano
-- Ejecutar bloque a bloque en el SQL Editor de Supabase (solo lectura).
-- ============================================================================

-- ── BLOQUE 1: Buscar al alumno ───────────────────────────────────────────────
SELECT
  id,
  full_name,
  school_id,
  balance,
  free_account,
  is_active,
  limit_type,
  daily_limit,
  weekly_limit,
  monthly_limit,
  current_period_spent,
  kiosk_disabled
FROM students
WHERE full_name ILIKE '%Giribaldi%'
ORDER BY full_name;

-- ── BLOQUE 2: TODAS las transacciones pendientes sin filtro de fechas ────────
-- Esto es lo que ve el portal del padre (calculateStudentDebts en Index.tsx)
SELECT
  t.id,
  t.created_at,
  t.amount,
  ABS(t.amount) AS monto_positivo,
  t.payment_status,
  t.description,
  t.is_deleted,
  CASE WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'almuerzo' ELSE 'kiosco/POS' END AS tipo,
  s.name AS sede,
  p.email AS cajero
FROM transactions t
LEFT JOIN schools s ON s.id = t.school_id
LEFT JOIN profiles p ON p.id = t.created_by
WHERE t.student_id = (SELECT id FROM students WHERE full_name ILIKE '%Giribaldi%' LIMIT 1)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
ORDER BY t.payment_status, t.created_at DESC;

-- ── BLOQUE 3: Solo pendientes — total por tipo (= lo que ve el padre) ────────
SELECT
  CASE WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN '🍽 almuerzo' ELSE '🛒 kiosco/POS' END AS tipo,
  COUNT(*) AS cantidad,
  SUM(ABS(t.amount)) AS total_soles
FROM transactions t
WHERE t.student_id = (SELECT id FROM students WHERE full_name ILIKE '%Giribaldi%' LIMIT 1)
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND COALESCE(t.is_deleted, false) = false
GROUP BY tipo
UNION ALL
SELECT '📊 TOTAL HISTÓRICO', COUNT(*), SUM(ABS(t.amount))
FROM transactions t
WHERE t.student_id = (SELECT id FROM students WHERE full_name ILIKE '%Giribaldi%' LIMIT 1)
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND COALESCE(t.is_deleted, false) = false;

-- ── BLOQUE 4: Todas las transacciones (cualquier estado) ─────────────────────
-- Para ver si alguna fue marcada como 'paid' pero el saldo sigue negativo
SELECT
  t.id,
  t.created_at,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.is_deleted,
  CASE WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'almuerzo' ELSE 'kiosco/POS' END AS tipo
FROM transactions t
WHERE t.student_id = (SELECT id FROM students WHERE full_name ILIKE '%Giribaldi%' LIMIT 1)
  AND t.type = 'purchase'
ORDER BY t.created_at DESC;

-- ── BLOQUE 5: Estado del tope diario ─────────────────────────────────────────
-- Si current_period_spent >= daily_limit → ESO bloquea el POS, NO la deuda
SELECT
  full_name,
  limit_type,
  daily_limit,
  current_period_spent,
  (daily_limit - current_period_spent) AS disponible,
  CASE WHEN current_period_spent >= daily_limit THEN '🔴 TOPE ALCANZADO' ELSE '🟢 Puede comprar' END AS estado_tope,
  next_reset_date
FROM students
WHERE full_name ILIKE '%Giribaldi%';
