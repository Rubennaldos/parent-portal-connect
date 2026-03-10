-- ============================================================
-- PASO 0: Ejecuta esto primero para encontrar el schema correcto
-- ============================================================
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN ('transactions', 'lunch_orders', 'schools', 'students')
ORDER BY table_schema, table_name;

-- ============================================================
-- Si el resultado muestra schema = "public", usa las queries de abajo.
-- Si muestra otro schema (ej: "app"), reemplaza public. por ese schema.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PARTE 1: Resumen general de transacciones ocultas
-- ─────────────────────────────────────────────────────────────
WITH ranked_transactions AS (
  SELECT
    t.amount,
    t.school_id,
    ROW_NUMBER() OVER (ORDER BY t.created_at DESC) AS rn
  FROM transactions t
  WHERE t.type = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND (t.is_deleted IS NULL OR t.is_deleted = false)
)
SELECT
  COUNT(*) FILTER (WHERE rn <= 1000)  AS visibles_antes,
  COUNT(*) FILTER (WHERE rn > 1000)   AS ocultas_antes,
  COUNT(*)                             AS total_ahora,
  ROUND(SUM(amount) FILTER (WHERE rn > 1000)::numeric, 2) AS monto_oculto_soles,
  COUNT(DISTINCT school_id) FILTER (WHERE rn > 1000) AS sedes_afectadas
FROM ranked_transactions;

-- ─────────────────────────────────────────────────────────────
-- PARTE 2: Por sede — cuánto dinero estaba oculto
-- ─────────────────────────────────────────────────────────────
WITH ranked_transactions AS (
  SELECT
    t.amount,
    t.school_id,
    s.name AS school_name,
    ROW_NUMBER() OVER (ORDER BY t.created_at DESC) AS rn
  FROM transactions t
  LEFT JOIN schools s ON s.id = t.school_id
  WHERE t.type = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND (t.is_deleted IS NULL OR t.is_deleted = false)
)
SELECT
  COALESCE(school_name, 'Sin sede') AS sede,
  COUNT(*) FILTER (WHERE rn > 1000) AS transacciones_ocultas,
  ROUND(SUM(amount) FILTER (WHERE rn > 1000)::numeric, 2) AS monto_oculto_soles
FROM ranked_transactions
WHERE rn > 1000
GROUP BY school_name
ORDER BY monto_oculto_soles DESC NULLS LAST;

-- ─────────────────────────────────────────────────────────────
-- PARTE 3: Pedidos de almuerzo invisibles
-- ─────────────────────────────────────────────────────────────
WITH ranked_orders AS (
  SELECT
    lo.final_price,
    lo.base_price,
    lo.school_id,
    s.name AS school_name,
    ROW_NUMBER() OVER (ORDER BY lo.created_at DESC) AS rn
  FROM lunch_orders lo
  LEFT JOIN schools s ON s.id = lo.school_id
  WHERE lo.status IN ('confirmed', 'delivered')
    AND lo.is_cancelled = false
)
SELECT
  COUNT(*) FILTER (WHERE rn <= 1000)  AS visibles_antes,
  COUNT(*) FILTER (WHERE rn > 1000)   AS ocultos_antes,
  COUNT(*)                             AS total_ahora,
  ROUND(SUM(COALESCE(final_price, base_price, 0)) FILTER (WHERE rn > 1000)::numeric, 2) AS monto_oculto_soles
FROM ranked_orders;

-- ─────────────────────────────────────────────────────────────
-- PARTE 4: Top 20 estudiantes con más deuda oculta
-- ─────────────────────────────────────────────────────────────
WITH ranked_transactions AS (
  SELECT
    t.student_id,
    t.amount,
    st.full_name AS student_name,
    s.name AS school_name,
    ROW_NUMBER() OVER (ORDER BY t.created_at DESC) AS rn
  FROM transactions t
  LEFT JOIN students st ON st.id = t.student_id
  LEFT JOIN schools s ON s.id = t.school_id
  WHERE t.type = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND (t.is_deleted IS NULL OR t.is_deleted = false)
    AND t.student_id IS NOT NULL
)
SELECT
  student_name,
  school_name,
  COUNT(*) AS transacciones_ocultas,
  ROUND(SUM(amount)::numeric, 2) AS monto_oculto_soles
FROM ranked_transactions
WHERE rn > 1000
GROUP BY student_name, school_name
ORDER BY monto_oculto_soles DESC
LIMIT 20;
