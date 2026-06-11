-- ============================================================
-- JLB (Jean LeBouch) — ¿Venta sin descontar stock?
-- Ejecutar UNA consulta a la vez en Supabase SQL Editor.
-- UUID sede Jean LeBouch (referencia del proyecto):
--   8a0dbd73-0571-4db1-af5c-65f4948c4c98
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- A) ¿Qué productos CAMU tienen inventario en JLB?
-- ════════════════════════════════════════════════════════════
SELECT
  p.name           AS producto,
  ps.current_stock,
  ps.is_enabled,
  p.stock_control_enabled
FROM public.products p
JOIN public.product_stock ps ON ps.product_id = p.id
JOIN public.schools s        ON s.id = ps.school_id
WHERE s.name ILIKE '%Jean LeBouch%'
  AND p.name ILIKE '%CAMU%';


-- ════════════════════════════════════════════════════════════
-- B) Ventas CAMU HOY en JLB (tickets)
--    Si vacío → el sistema NO registró venta en JLB hoy.
-- ════════════════════════════════════════════════════════════
WITH hoy AS (
  SELECT
    (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima' AS tz_start,
    ((timezone('America/Lima', now())::date + 1)::timestamp AT TIME ZONE 'America/Lima') AS tz_end
)
SELECT
  t.created_at AT TIME ZONE 'America/Lima' AS hora,
  t.ticket_code,
  t.payment_status,
  ti.product_name,
  ti.quantity,
  ti.product_id
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
JOIN public.schools s      ON s.id = t.school_id
CROSS JOIN hoy
WHERE s.name ILIKE '%Jean LeBouch%'
  AND ti.product_name ILIKE '%CAMU%'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= hoy.tz_start
  AND t.created_at <  hoy.tz_end
ORDER BY t.created_at;


-- ════════════════════════════════════════════════════════════
-- C) TODAS las ventas POS hoy en JLB (cualquier producto)
-- ════════════════════════════════════════════════════════════
WITH hoy AS (
  SELECT
    (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima' AS tz_start,
    ((timezone('America/Lima', now())::date + 1)::timestamp AT TIME ZONE 'America/Lima') AS tz_end
)
SELECT
  t.created_at AT TIME ZONE 'America/Lima' AS hora,
  t.ticket_code,
  ti.product_name,
  ti.quantity,
  ti.product_id
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
JOIN public.schools s      ON s.id = t.school_id
CROSS JOIN hoy
WHERE s.name ILIKE '%Jean LeBouch%'
  AND t.type IN ('purchase', 'sale')
  AND (t.metadata->>'lunch_order_id') IS NULL
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= hoy.tz_start
  AND t.created_at <  hoy.tz_end
ORDER BY t.created_at;


-- ════════════════════════════════════════════════════════════
-- D) PROBLEMA CLAVE: ticket SÍ existe pero stock NO bajó
--    (venta registrada sin movimiento de kardex)
-- ════════════════════════════════════════════════════════════
WITH hoy AS (
  SELECT
    (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima' AS tz_start,
    ((timezone('America/Lima', now())::date + 1)::timestamp AT TIME ZONE 'America/Lima') AS tz_end
)
SELECT
  t.ticket_code,
  ti.product_name,
  ti.quantity,
  ti.product_id,
  CASE
    WHEN ti.product_id IS NULL THEN 'Venta libre / sin product_id → NO descuenta stock'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.product_stock ps
      WHERE ps.product_id = ti.product_id
        AND ps.school_id  = t.school_id
        AND ps.is_enabled = true
    ) THEN 'Sin fila product_stock en esta sede → venta SÍ, stock NO baja'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.pos_stock_movements psm
      WHERE psm.reference_id = t.id
        AND psm.product_id   = ti.product_id
        AND psm.movement_type = 'venta_pos'
    ) THEN 'Hay inventario pero NO hay kardex → revisar bug'
    ELSE 'OK: venta y kardex coinciden'
  END AS diagnostico
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
JOIN public.schools s      ON s.id = t.school_id
CROSS JOIN hoy
WHERE s.name ILIKE '%Jean LeBouch%'
  AND ti.product_name ILIKE '%CAMU%'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= hoy.tz_start
  AND t.created_at <  hoy.tz_end;


-- ════════════════════════════════════════════════════════════
-- E) ¿Venta registrada en OTRA sede por error de cajero?
--    (cajero JLB con sesión de otra sede)
-- ════════════════════════════════════════════════════════════
WITH hoy AS (
  SELECT
    (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima' AS tz_start,
    ((timezone('America/Lima', now())::date + 1)::timestamp AT TIME ZONE 'America/Lima') AS tz_end
)
SELECT
  s.name AS sede_en_ticket,
  t.ticket_code,
  ti.product_name,
  ti.quantity,
  pr.full_name AS cajero
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
JOIN public.schools s      ON s.id = t.school_id
LEFT JOIN public.profiles pr ON pr.id = t.created_by
CROSS JOIN hoy
WHERE ti.product_name ILIKE '%CAMU%'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.created_at >= hoy.tz_start
  AND t.created_at <  hoy.tz_end
  AND pr.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'  -- cajero asignado a JLB
  AND t.school_id <> '8a0dbd73-0571-4db1-af5c-65f4948c4c98' -- ticket en otra sede
ORDER BY t.created_at;
