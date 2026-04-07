-- =============================================================================
-- Consumos de la alumna Lucía Villajulca (por el papá / cualquier medio)
-- Solo NO cancelados, hasta el día de hoy (fecha calendario Lima, Perú).
-- =============================================================================
-- Ejecuta bloque a bloque en el SQL Editor de Supabase.
-- Si el nombre en BD es distinto, cambia el patrón en :patron o en el sub-SELECT.
-- =============================================================================

-- ── 0) Ajuste opcional del nombre (ILIKE) ───────────────────────────────────
-- Ejemplos: '%Villajulca%', '%Lucía%', '%Lucia%'

-- ── 1) Identificar alumna y padre ───────────────────────────────────────────
SELECT
  st.id AS student_id,
  st.full_name,
  st.grade,
  st.section,
  sch.name AS sede,
  st.parent_id,
  pr.email AS email_padre,
  pp.full_name AS nombre_padre_en_ficha,
  pp.phone_1 AS telefono_padre
FROM students st
LEFT JOIN schools sch ON sch.id = st.school_id
LEFT JOIN profiles pr ON pr.id = st.parent_id
LEFT JOIN parent_profiles pp ON pp.user_id = st.parent_id
WHERE st.full_name ILIKE '%Villajulca%'
  AND (st.full_name ILIKE '%Lucía%' OR st.full_name ILIKE '%Lucia%')
  AND COALESCE(st.is_active, true) = true;


-- ── 2) Todas las COMPRAS registradas en `transactions` (kiosco + almuerzo)
--     Excluye: canceladas, borradas lógicamente.
--     Hasta hoy Lima: fecha local del evento <= hoy Lima.
-- ───────────────────────────────────────────────────────────────────────────
WITH alumna AS (
  SELECT id
  FROM students
  WHERE full_name ILIKE '%Villajulca%'
    AND (full_name ILIKE '%Lucía%' OR full_name ILIKE '%Lucia%')
    AND COALESCE(is_active, true) = true
  ORDER BY full_name
  LIMIT 1
),
hoy_lima AS (
  SELECT (timezone('America/Lima', now()))::date AS d
)
SELECT
  t.id AS transaction_id,
  t.created_at,
  (timezone('America/Lima', t.created_at))::date AS fecha_lima,
  ABS(t.amount)::numeric(12, 2) AS monto_soles,
  t.payment_status,
  t.payment_method,
  t.ticket_code,
  t.description,
  CASE
    WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'Almuerzo (vía transacción)'
    ELSE 'Kiosco / POS / cuenta libre'
  END AS canal,
  t.metadata->>'lunch_order_id' AS lunch_order_id_ref,
  s.name AS sede,
  p.email AS registrado_por_email
FROM transactions t
CROSS JOIN hoy_lima h
LEFT JOIN schools s ON s.id = t.school_id
LEFT JOIN profiles p ON p.id = t.created_by
WHERE t.student_id = (SELECT id FROM alumna)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (timezone('America/Lima', t.created_at))::date <= h.d
ORDER BY t.created_at DESC;


-- ── 3) Detalle por ítem (productos del ticket) para esas mismas transacciones
WITH alumna AS (
  SELECT id FROM students
  WHERE full_name ILIKE '%Villajulca%'
    AND (full_name ILIKE '%Lucía%' OR full_name ILIKE '%Lucia%')
    AND COALESCE(is_active, true) = true
  LIMIT 1
),
hoy_lima AS (
  SELECT (timezone('America/Lima', now()))::date AS d
),
tx_ids AS (
  SELECT t.id
  FROM transactions t
  CROSS JOIN hoy_lima h
  WHERE t.student_id = (SELECT id FROM alumna)
    AND t.type = 'purchase'
    AND COALESCE(t.is_deleted, false) = false
    AND COALESCE(t.payment_status, '') <> 'cancelled'
    AND (timezone('America/Lima', t.created_at))::date <= h.d
)
SELECT
  ti.transaction_id,
  ti.product_name,
  ti.quantity,
  ti.unit_price,
  ti.subtotal,
  t.created_at AS ticket_fecha,
  t.payment_status
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
WHERE ti.transaction_id IN (SELECT id FROM tx_ids)
ORDER BY t.created_at DESC, ti.transaction_id;


-- ── 4) Pedidos de almuerzo (tabla lunch_orders) no cancelados hasta hoy Lima
--     Útil si quieres ver menú/fecha aunque el cobro vaya por otro flujo.
-- ───────────────────────────────────────────────────────────────────────────
WITH alumna AS (
  SELECT id FROM students
  WHERE full_name ILIKE '%Villajulca%'
    AND (full_name ILIKE '%Lucía%' OR full_name ILIKE '%Lucia%')
    AND COALESCE(is_active, true) = true
  LIMIT 1
),
hoy_lima AS (
  SELECT (timezone('America/Lima', now()))::date AS d
)
SELECT
  lo.id AS lunch_order_id,
  lo.order_date,
  lo.status,
  lo.payment_method,
  lo.final_price,
  lo.quantity,
  lc.name AS categoria_menu,
  lo.is_cancelled,
  sch.name AS sede
FROM lunch_orders lo
CROSS JOIN hoy_lima h
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN schools sch ON sch.id = lo.school_id
WHERE lo.student_id = (SELECT id FROM alumna)
  AND COALESCE(lo.is_cancelled, false) = false
  AND COALESCE(lo.status, '') <> 'cancelled'
  AND lo.order_date::date <= h.d
ORDER BY lo.order_date DESC, lo.created_at DESC;


-- ── 5) Resumen rápido (totales hasta hoy Lima) ──────────────────────────────
WITH alumna AS (
  SELECT id FROM students
  WHERE full_name ILIKE '%Villajulca%'
    AND (full_name ILIKE '%Lucía%' OR full_name ILIKE '%Lucia%')
    AND COALESCE(is_active, true) = true
  LIMIT 1
),
hoy_lima AS (
  SELECT (timezone('America/Lima', now()))::date AS d
)
SELECT
  'transactions (no canceladas)' AS fuente,
  COUNT(*) AS lineas,
  SUM(ABS(t.amount))::numeric(12, 2) AS total_soles
FROM transactions t
CROSS JOIN hoy_lima h
WHERE t.student_id = (SELECT id FROM alumna)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (timezone('America/Lima', t.created_at))::date <= h.d
UNION ALL
SELECT
  'lunch_orders (no cancelados)',
  COUNT(*),
  SUM(ABS(COALESCE(lo.final_price, 0)))::numeric(12, 2)
FROM lunch_orders lo
CROSS JOIN hoy_lima h
WHERE lo.student_id = (SELECT id FROM alumna)
  AND COALESCE(lo.is_cancelled, false) = false
  AND COALESCE(lo.status, '') <> 'cancelled'
  AND lo.order_date::date <= h.d;


-- ── 6) TOTAL POR DÍA — Almuerzos vs Kiosco (solo `transactions`, fuente contable)
--     Almuerzo = fila con metadata.lunch_order_id NOT NULL
--     Kiosco   = compra POS / cuenta libre sin lunch_order_id
--     Misma regla que el resto del script: no canceladas, no borradas, hasta hoy Lima.
-- ───────────────────────────────────────────────────────────────────────────
WITH alumna AS (
  SELECT id FROM students
  WHERE full_name ILIKE '%Villajulca%'
    AND (full_name ILIKE '%Lucía%' OR full_name ILIKE '%Lucia%')
    AND COALESCE(is_active, true) = true
  LIMIT 1
),
hoy_lima AS (
  SELECT (timezone('America/Lima', now()))::date AS d
)
SELECT
  (timezone('America/Lima', t.created_at))::date AS dia_lima,
  to_char((timezone('America/Lima', t.created_at))::date, 'DD/MM/YYYY') AS dia_calendario,
  SUM(
    CASE WHEN (t.metadata->>'lunch_order_id') IS NOT NULL
      THEN ABS(t.amount) ELSE 0 END
  )::numeric(12, 2) AS total_almuerzos_soles,
  SUM(
    CASE WHEN (t.metadata->>'lunch_order_id') IS NULL
      THEN ABS(t.amount) ELSE 0 END
  )::numeric(12, 2) AS total_kiosco_soles,
  SUM(ABS(t.amount))::numeric(12, 2) AS total_dia_soles,
  COUNT(*) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NOT NULL) AS tickets_almuerzo,
  COUNT(*) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NULL)     AS tickets_kiosco
FROM transactions t
CROSS JOIN hoy_lima h
WHERE t.student_id = (SELECT id FROM alumna)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (timezone('America/Lima', t.created_at))::date <= h.d
GROUP BY (timezone('America/Lima', t.created_at))::date
ORDER BY dia_lima DESC;
