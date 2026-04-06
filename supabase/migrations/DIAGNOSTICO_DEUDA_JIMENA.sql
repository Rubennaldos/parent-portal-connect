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

-- ── BLOQUE 5: Estado del tope (misma idea que el POS: solo aplica si el monto > 0)
-- OJO: NO usar solo (spent >= daily_limit): si daily_limit = 0 entonces 0 >= 0
--      y el reporte mentía "TOPE ALCANZADO". En el POS la condición es
--      limitAmount > 0 AND cartTotal > available.
SELECT
  full_name,
  limit_type,
  daily_limit,
  weekly_limit,
  monthly_limit,
  current_period_spent,
  CASE limit_type
    WHEN 'daily'   THEN GREATEST(0, COALESCE(daily_limit, 0)   - COALESCE(current_period_spent, 0))
    WHEN 'weekly'  THEN GREATEST(0, COALESCE(weekly_limit, 0)  - COALESCE(current_period_spent, 0))
    WHEN 'monthly' THEN GREATEST(0, COALESCE(monthly_limit, 0) - COALESCE(current_period_spent, 0))
    ELSE NULL
  END AS disponible_para_kiosco,
  CASE
    WHEN limit_type IS NULL OR limit_type = 'none'
      THEN '⚪ Sin tope de consumo (cuenta libre de límites)'
    WHEN limit_type = 'daily' AND COALESCE(daily_limit, 0) <= 0
      THEN '⚠️ Dato inconsistente: limit_type=daily pero daily_limit es 0 — el POS NO bloquea por tope (trata como sin límite efectivo). Corregir en Topes o en BD.'
    WHEN limit_type = 'weekly' AND COALESCE(weekly_limit, 0) <= 0
      THEN '⚠️ Dato inconsistente: limit_type=weekly pero weekly_limit es 0 — revisar configuración.'
    WHEN limit_type = 'monthly' AND COALESCE(monthly_limit, 0) <= 0
      THEN '⚠️ Dato inconsistente: limit_type=monthly pero monthly_limit es 0 — revisar configuración.'
    WHEN limit_type = 'daily' AND current_period_spent >= daily_limit AND daily_limit > 0
      THEN '🔴 TOPE DIARIO ALCANZADO (el POS bloquea cafetería hasta el reinicio)'
    WHEN limit_type = 'weekly' AND current_period_spent >= weekly_limit AND weekly_limit > 0
      THEN '🔴 TOPE SEMANAL ALCANZADO'
    WHEN limit_type = 'monthly' AND current_period_spent >= monthly_limit AND monthly_limit > 0
      THEN '🔴 TOPE MENSUAL ALCANZADO'
    ELSE '🟢 Puede comprar en kiosco (dentro del tope disponible)'
  END AS estado_tope,
  next_reset_date
FROM students
WHERE full_name ILIKE '%Giribaldi%';
