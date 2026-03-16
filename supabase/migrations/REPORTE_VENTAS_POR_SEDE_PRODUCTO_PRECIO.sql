-- ============================================================
-- REPORTE: Ventas por sede, producto, precio, vendedor, fecha y hora
-- Salida: una fila por cada ítem vendido (lista para exportar a CSV)
-- ============================================================
--
-- MEJOR OPCIÓN PARA CSV:
-- 1. Ejecuta la consulta principal (la de abajo) en Supabase → SQL Editor.
-- 2. En la pestaña "Results", usa el botón "Download" o "Export" → CSV.
-- 3. Si hay muchos registros (miles), Supabase permite exportar todo el resultado.
--    Si en algún momento el resultado es demasiado grande, agrega en el WHERE:
--    AND t.created_at >= '2026-01-01' AND t.created_at < '2026-04-01'
--    (por ejemplo, por trimestre).
--
-- OPCIÓN ALTERNATIVA (sin tocar el módulo de logística):
-- Puedes crear una vista con el mismo SELECT y luego hacer SELECT * FROM vista
-- y exportar; o filtrar por fecha desde la vista.
-- ============================================================


-- Consulta principal: una fila por producto vendido
SELECT
  s.name                    AS sede,
  (t.created_at AT TIME ZONE 'America/Lima')::date
                            AS fecha,
  TO_CHAR(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
  COALESCE(ti.product_name, p.name, 'Sin nombre')
                            AS producto,
  ti.unit_price             AS precio_unitario,
  ti.quantity               AS cantidad,
  ti.subtotal               AS subtotal,
  COALESCE(prof.full_name, 'No registrado')
                            AS vendedor,
  t.id                      AS transaction_id,
  ti.id                     AS item_id
FROM transaction_items ti
JOIN transactions t
  ON t.id = ti.transaction_id
LEFT JOIN schools s
  ON s.id = t.school_id
LEFT JOIN profiles prof
  ON prof.id = t.created_by
LEFT JOIN products p
  ON p.id = ti.product_id
WHERE (t.type = 'purchase' OR t.type = 'sale')
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
  AND (t.payment_status IS NULL OR t.payment_status != 'cancelled')
  -- Solo ventas POS (kiosco); quita la línea siguiente si quieres incluir almuerzos
  AND (t.metadata IS NULL OR t.metadata->>'lunch_order_id' IS NULL)
ORDER BY s.name, t.created_at DESC, ti.id;


-- ============================================================
-- VERSIÓN CON FILTRO POR FECHAS (descomenta y ajusta si necesitas)
-- ============================================================
/*
SELECT
  s.name                    AS sede,
  (t.created_at AT TIME ZONE 'America/Lima')::date AS fecha,
  TO_CHAR(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
  COALESCE(ti.product_name, p.name, 'Sin nombre') AS producto,
  ti.unit_price             AS precio_unitario,
  ti.quantity               AS cantidad,
  ti.subtotal               AS subtotal,
  COALESCE(prof.full_name, 'No registrado') AS vendedor,
  t.id                      AS transaction_id,
  ti.id                     AS item_id
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
LEFT JOIN schools s ON s.id = t.school_id
LEFT JOIN profiles prof ON prof.id = t.created_by
LEFT JOIN products p ON p.id = ti.product_id
WHERE (t.type = 'purchase' OR t.type = 'sale')
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
  AND (t.payment_status IS NULL OR t.payment_status != 'cancelled')
  AND (t.metadata IS NULL OR t.metadata->>'lunch_order_id' IS NULL)
  AND t.created_at >= '2026-01-01'
  AND t.created_at <  '2026-04-01'
ORDER BY s.name, t.created_at DESC, ti.id;
*/


-- ============================================================
-- OPCIONAL: Vista para reutilizar (ejecutar solo si quieres una vista)
-- ============================================================
/*
CREATE OR REPLACE VIEW reporte_ventas_por_sede_producto AS
SELECT
  s.name                    AS sede,
  (t.created_at AT TIME ZONE 'America/Lima')::date AS fecha,
  TO_CHAR(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
  COALESCE(ti.product_name, p.name, 'Sin nombre') AS producto,
  ti.unit_price             AS precio_unitario,
  ti.quantity               AS cantidad,
  ti.subtotal               AS subtotal,
  COALESCE(prof.full_name, 'No registrado') AS vendedor,
  t.id                      AS transaction_id,
  ti.id                     AS item_id
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
LEFT JOIN schools s ON s.id = t.school_id
LEFT JOIN profiles prof ON prof.id = t.created_by
LEFT JOIN products p ON p.id = ti.product_id
WHERE (t.type = 'purchase' OR t.type = 'sale')
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
  AND (t.payment_status IS NULL OR t.payment_status != 'cancelled')
  AND (t.metadata IS NULL OR t.metadata->>'lunch_order_id' IS NULL);

-- Uso: SELECT * FROM reporte_ventas_por_sede_producto WHERE fecha >= '2026-03-01' ORDER BY sede, fecha DESC;
*/
