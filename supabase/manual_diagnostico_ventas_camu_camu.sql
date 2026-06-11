-- ============================================================
-- DIAGNÓSTICO ventas CAMU CAMU — Supabase SQL Editor
-- Fecha HOY Lima: 2026-05-29
--
-- PASO 0: Ejecuta primero "VERIFICAR TABLAS" abajo.
-- Si products no existe → estás en el proyecto Supabase equivocado
-- o faltan migraciones del módulo POS.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASO 0 — VERIFICAR TABLAS (ejecutar esto primero)
-- ════════════════════════════════════════════════════════════
SELECT
  t.table_schema,
  t.table_name
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'products',
    'product_stock',
    'transactions',
    'transaction_items',
    'pos_stock_movements',
    'schools',
    'students'
  )
ORDER BY t.table_name;

-- Si la lista NO incluye transactions ni transaction_items,
-- este NO es el proyecto donde corre la app de caja.


-- ════════════════════════════════════════════════════════════
-- PASO 1 — VENTAS CAMU HOY (solo transactions + items)
--          NO necesita tabla products. Ejecuta este siempre.
-- ════════════════════════════════════════════════════════════
SELECT
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_hora_lima,
  t.ticket_code,
  t.payment_status,
  s.name                                   AS sede,
  ti.product_name,
  ti.quantity,
  ti.unit_price,
  ti.subtotal,
  ti.product_id
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
LEFT JOIN public.schools s ON s.id = t.school_id
WHERE ti.product_name ILIKE '%CAMU%'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= TIMESTAMPTZ '2026-05-29 00:00:00-05'
  AND t.created_at <  TIMESTAMPTZ '2026-05-30 00:00:00-05'
ORDER BY t.created_at;


-- ════════════════════════════════════════════════════════════
-- PASO 2 — RESUMEN HOY (sin products)
-- ════════════════════════════════════════════════════════════
SELECT
  COUNT(*)::integer                    AS lineas_en_tickets,
  COALESCE(SUM(ti.quantity), 0)::integer AS unidades,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending')::integer AS pendientes,
  COUNT(*) FILTER (WHERE t.payment_status IN ('paid','completed'))::integer AS pagadas
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
WHERE ti.product_name ILIKE '%CAMU%'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= TIMESTAMPTZ '2026-05-29 00:00:00-05'
  AND t.created_at <  TIMESTAMPTZ '2026-05-30 00:00:00-05';


-- ════════════════════════════════════════════════════════════
-- PASO 3 — ANULADAS HOY (sin products)
-- ════════════════════════════════════════════════════════════
SELECT
  t.ticket_code,
  t.payment_status,
  ti.product_name,
  ti.quantity,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_hora_lima,
  s.name AS sede
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
LEFT JOIN public.schools s ON s.id = t.school_id
WHERE ti.product_name ILIKE '%CAMU%'
  AND (t.payment_status = 'cancelled' OR COALESCE(t.is_deleted, false) = true)
  AND t.created_at >= TIMESTAMPTZ '2026-05-29 00:00:00-05'
  AND t.created_at <  TIMESTAMPTZ '2026-05-30 00:00:00-05'
ORDER BY t.created_at;


-- ════════════════════════════════════════════════════════════
-- PASO 4 — KARDEX (solo si PASO 0 mostró pos_stock_movements)
-- ════════════════════════════════════════════════════════════
SELECT
  psm.created_at AT TIME ZONE 'America/Lima' AS fecha_hora_lima,
  t.ticket_code,
  p.name                                   AS producto,
  ABS(psm.quantity_delta)                  AS unidades,
  psm.reason                               AS motivo,
  s.name                                   AS sede
FROM public.pos_stock_movements psm
JOIN public.products p          ON p.id = psm.product_id
LEFT JOIN public.transactions t ON t.id = psm.reference_id
JOIN public.schools s           ON s.id = psm.school_id
WHERE p.name ILIKE '%CAMU%'
  AND psm.movement_type = 'venta_pos'
  AND psm.created_at >= TIMESTAMPTZ '2026-05-29 00:00:00-05'
  AND psm.created_at <  TIMESTAMPTZ '2026-05-30 00:00:00-05'
ORDER BY psm.created_at;


-- ════════════════════════════════════════════════════════════
-- PASO 5 — CATÁLOGO + STOCK (solo si PASO 0 mostró products)
-- ════════════════════════════════════════════════════════════
SELECT
  p.id,
  p.name,
  p.category,
  p.active
FROM public.products p
WHERE p.name ILIKE '%CAMU%'
  AND p.active = true
ORDER BY p.name;

SELECT
  p.name           AS producto,
  s.name           AS sede,
  ps.current_stock,
  ps.is_enabled
FROM public.products p
JOIN public.product_stock ps ON ps.product_id = p.id
JOIN public.schools s        ON s.id = ps.school_id
WHERE p.name ILIKE '%CAMU%'
ORDER BY p.name, s.name;

-- ════════════════════════════════════════════════════════════
-- PASO 6 — ¿CUÁNTOS CAMU SE CONSUMIERON HOY? (por producto y sede)
--          Usa fecha Lima automática (no hay que cambiar la fecha).
-- ════════════════════════════════════════════════════════════
WITH hoy AS (
  SELECT
    (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima'     AS tz_start,
    ((timezone('America/Lima', now())::date + 1)::timestamp AT TIME ZONE 'America/Lima') AS tz_end
)
SELECT
  s.name                                   AS sede,
  ti.product_name                          AS producto,
  SUM(ti.quantity)::integer                AS unidades_vendidas_hoy,
  COUNT(DISTINCT t.id)::integer            AS tickets,
  STRING_AGG(DISTINCT t.ticket_code, ', ' ORDER BY t.ticket_code) AS tickets_lista
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
LEFT JOIN public.schools s ON s.id = t.school_id
CROSS JOIN hoy
WHERE ti.product_name ILIKE '%CAMU%'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= hoy.tz_start
  AND t.created_at <  hoy.tz_end
GROUP BY s.name, ti.product_name
ORDER BY unidades_vendidas_hoy DESC, sede, producto;

-- Si PASO 6 sale vacío pero el stock bajó → revisar PASO 4 (combo) o ajuste manual.

-- INTERPRETACIÓN:
-- PASO 1 vacío + PASO 4 con filas → CAMU vendido dentro de COMBO.
-- PASO 1 y 4 vacíos               → hoy no hay venta registrada de CAMU.
-- PASO 0 sin "products"           → proyecto DB incorrecto o sin migraciones POS.
-- PASO 5 (stock)                  → solo muestra cuánto QUEDA ahora, no ventas de hoy.
