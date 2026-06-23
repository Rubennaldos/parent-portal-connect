-- =============================================================================
-- INVESTIGACIÓN FORENSE — Duplicados / ráfagas / fallos almuerzo
-- Solo lectura. Ejecutar bloque por bloque en Supabase SQL Editor.
-- Zona horaria: America/Lima (UTC-5 fijo).
--
-- CÓMO USAR:
--   1) Ajustá ventana en BLOQUE 0 si querés otro rango (default: últimos 30 días).
--   2) Ejecutá cada bloque por separado.
--   3) Anotá qué bloques devuelven filas y cuántas.
--   4) Si un bloque está vacío → ese patrón NO aparece en ese rango (dato, no suposición).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 0 — Parámetros de ventana (referencia mental; no es ejecutable solo)
-- Para cambiar rango, reemplazá en cada query:
--   now() - interval '30 days'  →  now() - interval '7 days'  o una fecha fija
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1 — Inventario base del período
-- Qué mide: volumen total de pedidos y transacciones de almuerzo en el rango.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                                          AS total_lunch_orders,
  COUNT(*) FILTER (WHERE lo.is_cancelled = false)                   AS pedidos_activos,
  COUNT(*) FILTER (WHERE lo.is_cancelled = true)                    AS pedidos_cancelados,
  COUNT(*) FILTER (WHERE lo.student_id IS NOT NULL)                 AS pedidos_alumnos,
  COUNT(*) FILTER (WHERE lo.teacher_id IS NOT NULL)                 AS pedidos_profesores,
  MIN(lo.created_at AT TIME ZONE 'America/Lima')                    AS primer_pedido_lima,
  MAX(lo.created_at AT TIME ZONE 'America/Lima')                    AS ultimo_pedido_lima
FROM lunch_orders lo
WHERE lo.created_at >= now() - interval '30 days';


SELECT
  COUNT(*)                                                          AS total_tx_lunch,
  COUNT(*) FILTER (WHERE t.payment_status <> 'cancelled')           AS tx_activas,
  COUNT(*) FILTER (WHERE t.payment_status = 'cancelled')            AS tx_canceladas,
  COUNT(DISTINCT t.metadata->>'lunch_order_id')                     AS lunch_order_ids_distintos,
  MIN(t.created_at AT TIME ZONE 'America/Lima')                     AS primera_tx_lima,
  MAX(t.created_at AT TIME ZONE 'America/Lima')                     AS ultima_tx_lima
FROM transactions t
WHERE t.type = 'purchase'
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
  AND t.created_at >= now() - interval '30 days';


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2 — Transacciones duplicadas por lunch_order_id (el candado del trigger)
-- Qué mide: mismo pedido con más de 1 transacción activa.
-- Si hay filas → el trigger prevent_duplicate_lunch_transaction NO evitó duplicado.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  t.metadata->>'lunch_order_id'                                     AS lunch_order_id,
  COUNT(*)                                                          AS num_transacciones,
  ARRAY_AGG(t.id ORDER BY t.created_at)                             AS transaction_ids,
  ARRAY_AGG(t.payment_status ORDER BY t.created_at)                 AS estados_pago,
  ARRAY_AGG(ABS(t.amount) ORDER BY t.created_at)                    AS montos,
  ARRAY_AGG(t.created_at AT TIME ZONE 'America/Lima' ORDER BY t.created_at) AS creadas_lima,
  MIN(t.created_at AT TIME ZONE 'America/Lima')                     AS primera_tx,
  MAX(t.created_at AT TIME ZONE 'America/Lima')                     AS ultima_tx,
  EXTRACT(EPOCH FROM (MAX(t.created_at) - MIN(t.created_at)))       AS segundos_entre_primera_y_ultima
FROM transactions t
WHERE t.type = 'purchase'
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
  AND t.payment_status <> 'cancelled'
  AND COALESCE(t.is_deleted, false) = false
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY num_transacciones DESC, segundos_entre_primera_y_ultima ASC;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3 — Detalle fila a fila de cada duplicado (para auditoría manual)
-- Ejecutar DESPUÉS del bloque 2 si devolvió filas.
-- ─────────────────────────────────────────────────────────────────────────────
WITH dup_ids AS (
  SELECT t.metadata->>'lunch_order_id' AS lunch_order_id
  FROM transactions t
  WHERE t.type = 'purchase'
    AND (t.metadata->>'lunch_order_id') IS NOT NULL
    AND t.payment_status <> 'cancelled'
    AND COALESCE(t.is_deleted, false) = false
  GROUP BY 1
  HAVING COUNT(*) > 1
)
SELECT
  t.id                                                              AS transaction_id,
  t.metadata->>'lunch_order_id'                                     AS lunch_order_id,
  t.student_id,
  s.full_name                                                       AS alumno,
  t.teacher_id,
  t.amount,
  t.payment_status,
  t.ticket_code,
  t.metadata->>'source'                                             AS tx_source,
  t.created_by,
  t.created_at AT TIME ZONE 'America/Lima'                          AS tx_created_lima,
  lo.order_date,
  lo.status                                                         AS order_status,
  lo.is_cancelled,
  lo.cancellation_reason,
  lo.created_at AT TIME ZONE 'America/Lima'                         AS order_created_lima
FROM transactions t
JOIN dup_ids d ON d.lunch_order_id = t.metadata->>'lunch_order_id'
LEFT JOIN students s ON s.id = t.student_id
LEFT JOIN lunch_orders lo ON lo.id = (t.metadata->>'lunch_order_id')::uuid
WHERE t.type = 'purchase'
  AND t.payment_status <> 'cancelled'
  AND COALESCE(t.is_deleted, false) = false
ORDER BY t.metadata->>'lunch_order_id', t.created_at;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4 — Pedidos duplicados (mismo alumno + fecha + categoría, activos)
-- Qué mide: violación del índice idx_lunch_orders_unique_active.
-- Si hay filas → múltiples pedidos activos para el mismo día/categoría.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  lo.student_id,
  s.full_name,
  lo.order_date,
  lo.category_id,
  lc.name                                                           AS categoria,
  COUNT(*)                                                          AS num_pedidos,
  ARRAY_AGG(lo.id ORDER BY lo.created_at)                           AS order_ids,
  ARRAY_AGG(lo.status ORDER BY lo.created_at)                       AS estados,
  ARRAY_AGG(lo.created_at AT TIME ZONE 'America/Lima' ORDER BY lo.created_at) AS creados_lima,
  EXTRACT(EPOCH FROM (MAX(lo.created_at) - MIN(lo.created_at)))     AS segundos_entre_pedidos
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.is_cancelled = false
  AND lo.student_id IS NOT NULL
  AND lo.created_at >= now() - interval '30 days'
GROUP BY lo.student_id, s.full_name, lo.order_date, lo.category_id, lc.name
HAVING COUNT(*) > 1
ORDER BY num_pedidos DESC, segundos_entre_pedidos ASC;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 5 — Ráfaga por SEGUNDO (mismo alumno, pedidos activos)
-- Qué mide: varios pedidos en el mismo segundo → posible bucle/reintento automático.
-- Ventana más fina que "por minuto" (tu query anterior no devolvió filas por minuto).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  lo.student_id,
  s.full_name,
  date_trunc('second', lo.created_at AT TIME ZONE 'America/Lima')   AS segundo_lima,
  COUNT(*)                                                          AS pedidos_en_segundo,
  ARRAY_AGG(lo.id ORDER BY lo.created_at)                           AS order_ids,
  ARRAY_AGG(lo.order_date ORDER BY lo.created_at)                   AS fechas_pedido,
  ARRAY_AGG(lo.is_cancelled ORDER BY lo.created_at)                 AS cancelados
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
WHERE lo.created_at >= now() - interval '30 days'
  AND lo.student_id IS NOT NULL
GROUP BY lo.student_id, s.full_name, date_trunc('second', lo.created_at AT TIME ZONE 'America/Lima')
HAVING COUNT(*) >= 2
ORDER BY pedidos_en_segundo DESC, segundo_lima DESC
LIMIT 100;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 6 — Ráfaga por ventana de 5 segundos (captura reintentos ~300ms)
-- Qué mide: cluster de pedidos del mismo alumno en ≤5 segundos.
-- ─────────────────────────────────────────────────────────────────────────────
WITH base AS (
  SELECT
    lo.id,
    lo.student_id,
    lo.order_date,
    lo.category_id,
    lo.is_cancelled,
    lo.created_at,
    lo.created_at AT TIME ZONE 'America/Lima' AS created_lima
  FROM lunch_orders lo
  WHERE lo.created_at >= now() - interval '30 days'
    AND lo.student_id IS NOT NULL
),
paired AS (
  SELECT
    b1.student_id,
    b1.id AS order_id_1,
    b2.id AS order_id_2,
    b1.order_date,
    b1.category_id,
    b1.created_lima AS t1,
    b2.created_lima AS t2,
    EXTRACT(EPOCH FROM (b2.created_at - b1.created_at)) AS delta_segundos,
    b1.is_cancelled AS cancel_1,
    b2.is_cancelled AS cancel_2
  FROM base b1
  JOIN base b2
    ON b2.student_id = b1.student_id
   AND b2.id > b1.id
   AND b2.created_at BETWEEN b1.created_at AND b1.created_at + interval '5 seconds'
)
SELECT
  p.student_id,
  s.full_name,
  p.order_date,
  p.category_id,
  COUNT(*)                                                          AS pares_en_5s,
  MIN(p.delta_segundos)                                             AS delta_min_seg,
  MAX(p.delta_segundos)                                             AS delta_max_seg,
  ARRAY_AGG(DISTINCT p.order_id_1)                                  AS ids_muestra
FROM paired p
JOIN students s ON s.id = p.student_id
GROUP BY p.student_id, s.full_name, p.order_date, p.category_id
HAVING COUNT(*) >= 1
ORDER BY pares_en_5s DESC, delta_min_seg ASC
LIMIT 100;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 7 — Ráfaga de TRANSACCIONES (mismo alumno, ≤5 segundos)
-- Qué mide: inserts concurrentes en transactions (PostgREST directo o carrera).
-- ─────────────────────────────────────────────────────────────────────────────
WITH base AS (
  SELECT
    t.id,
    t.student_id,
    t.metadata->>'lunch_order_id' AS lunch_order_id,
    t.metadata->>'source'         AS source,
    t.created_at,
    t.created_at AT TIME ZONE 'America/Lima' AS created_lima
  FROM transactions t
  WHERE t.type = 'purchase'
    AND (t.metadata->>'lunch_order_id') IS NOT NULL
    AND t.created_at >= now() - interval '30 days'
    AND COALESCE(t.is_deleted, false) = false
),
paired AS (
  SELECT
    b1.student_id,
    b1.id AS tx_id_1,
    b2.id AS tx_id_2,
    b1.lunch_order_id AS lo_id_1,
    b2.lunch_order_id AS lo_id_2,
    b1.source AS src_1,
    b2.source AS src_2,
    EXTRACT(EPOCH FROM (b2.created_at - b1.created_at)) AS delta_segundos
  FROM base b1
  JOIN base b2
    ON b2.student_id = b1.student_id
   AND b2.id > b1.id
   AND b2.created_at BETWEEN b1.created_at AND b1.created_at + interval '5 seconds'
)
SELECT
  p.student_id,
  s.full_name,
  COUNT(*)                                                          AS pares_tx_en_5s,
  MIN(p.delta_segundos)                                             AS delta_min_seg,
  MAX(p.delta_segundos)                                             AS delta_max_seg,
  COUNT(*) FILTER (WHERE p.lo_id_1 = p.lo_id_2)                     AS mismo_lunch_order_id,
  COUNT(*) FILTER (WHERE p.lo_id_1 <> p.lo_id_2)                    AS distinto_lunch_order_id,
  ARRAY_AGG(DISTINCT p.src_1)                                       AS sources_muestra
FROM paired p
JOIN students s ON s.id = p.student_id
GROUP BY p.student_id, s.full_name
ORDER BY pares_tx_en_5s DESC
LIMIT 50;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 8 — Origen del pedido (metadata.source en transacciones)
-- Qué mide: qué flujo creó cada deuda (RPC vs legacy vs caja).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COALESCE(t.metadata->>'source', '(sin source)')                   AS origen,
  COUNT(*)                                                          AS total_tx,
  COUNT(DISTINCT t.metadata->>'lunch_order_id')                     AS pedidos_distintos,
  MIN(t.created_at AT TIME ZONE 'America/Lima')                     AS primera_lima,
  MAX(t.created_at AT TIME ZONE 'America/Lima')                     AS ultima_lima
FROM transactions t
WHERE t.type = 'purchase'
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
  AND t.created_at >= now() - interval '30 days'
  AND COALESCE(t.is_deleted, false) = false
GROUP BY 1
ORDER BY total_tx DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 9 — Pedidos SIN transacción vinculada (huérfanos)
-- Qué mide: INSERT lunch_orders OK pero INSERT transactions falló.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  lo.id                                                             AS lunch_order_id,
  s.full_name                                                       AS alumno,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.cancellation_reason,
  lo.created_at AT TIME ZONE 'America/Lima'                        AS creado_lima,
  lo.payment_flow_state
FROM lunch_orders lo
LEFT JOIN students s ON s.id = lo.student_id
WHERE lo.created_at >= now() - interval '30 days'
  AND lo.is_cancelled = false
  AND NOT EXISTS (
    SELECT 1
    FROM transactions t
    WHERE (t.metadata->>'lunch_order_id') = lo.id::text
      AND COALESCE(t.is_deleted, false) = false
      AND t.payment_status <> 'cancelled'
  )
ORDER BY lo.created_at DESC
LIMIT 200;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 10 — Transacciones SIN pedido existente (huérfanas inversas)
-- Qué mide: deuda apuntando a lunch_order_id que no existe o está cancelado.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  t.id                                                              AS transaction_id,
  t.metadata->>'lunch_order_id'                                     AS lunch_order_id,
  s.full_name                                                       AS alumno,
  t.amount,
  t.payment_status,
  t.metadata->>'source'                                             AS source,
  t.created_at AT TIME ZONE 'America/Lima'                        AS tx_lima,
  lo.id IS NULL                                                     AS pedido_no_existe,
  lo.is_cancelled                                                   AS pedido_cancelado
FROM transactions t
LEFT JOIN lunch_orders lo ON lo.id = (t.metadata->>'lunch_order_id')::uuid
LEFT JOIN students s ON s.id = t.student_id
WHERE t.type = 'purchase'
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
  AND t.created_at >= now() - interval '30 days'
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status <> 'cancelled'
  AND (lo.id IS NULL OR lo.is_cancelled = true)
ORDER BY t.created_at DESC
LIMIT 200;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 11 — Motivos de cancelación (últimos 30 días)
-- Qué mide: si hay AUTO-cancel por fallo de transacción vs anulación manual.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COALESCE(lo.cancellation_reason, '(null)')                        AS motivo,
  COUNT(*)                                                          AS total,
  MIN(lo.created_at AT TIME ZONE 'America/Lima')                   AS primer_caso_lima,
  MAX(lo.cancelled_at AT TIME ZONE 'America/Lima')                  AS ultimo_cancel_lima
FROM lunch_orders lo
WHERE lo.is_cancelled = true
  AND lo.created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY total DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 12 — Cancelaciones AUTO (texto contiene AUTO o transacción)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  lo.id,
  s.full_name,
  lo.order_date,
  lo.cancellation_reason,
  lo.created_at AT TIME ZONE 'America/Lima'                         AS pedido_creado_lima,
  lo.cancelled_at AT TIME ZONE 'America/Lima'                       AS cancelado_lima,
  EXISTS (
    SELECT 1 FROM transactions t
    WHERE (t.metadata->>'lunch_order_id') = lo.id::text
      AND COALESCE(t.is_deleted, false) = false
  )                                                                 AS tiene_transaccion
FROM lunch_orders lo
LEFT JOIN students s ON s.id = lo.student_id
WHERE lo.is_cancelled = true
  AND lo.created_at >= now() - interval '30 days'
  AND (
    lo.cancellation_reason ILIKE '%AUTO%'
    OR lo.cancellation_reason ILIKE '%transacc%'
    OR lo.cancellation_reason ILIKE '%fallid%'
  )
ORDER BY lo.cancelled_at DESC NULLS LAST
LIMIT 200;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 13 — Volumen por hora Lima (detectar hora punta 7–9 AM)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  date_trunc('hour', lo.created_at AT TIME ZONE 'America/Lima')     AS hora_lima,
  COUNT(*)                                                          AS total_pedidos,
  COUNT(*) FILTER (WHERE lo.is_cancelled)                           AS cancelados,
  COUNT(*) FILTER (WHERE NOT lo.is_cancelled)                       AS activos
FROM lunch_orders lo
WHERE lo.created_at >= now() - interval '30 days'
  AND lo.student_id IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 14 — Volumen transacciones almuerzo por hora Lima
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  date_trunc('hour', t.created_at AT TIME ZONE 'America/Lima')      AS hora_lima,
  COUNT(*)                                                          AS total_tx,
  COUNT(DISTINCT t.student_id)                                      AS alumnos_distintos,
  COUNT(DISTINCT t.metadata->>'lunch_order_id')                     AS pedidos_distintos
FROM transactions t
WHERE t.type = 'purchase'
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
  AND t.created_at >= now() - interval '30 days'
  AND COALESCE(t.is_deleted, false) = false
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 15 — Caso específico: buscar por nombre de alumno (EDITAR AQUÍ)
-- Reemplazá 'NOMBRE' por parte del nombre real.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT id, full_name, school_id FROM students
-- WHERE full_name ILIKE '%NOMBRE%';


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 16 — Timeline completo de UN alumno (EDITAR student_id)
-- Reemplazá el UUID por el id del bloque 15.
-- ─────────────────────────────────────────────────────────────────────────────
/*
WITH target AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS student_id
)
SELECT
  'lunch_order'                                                     AS tipo,
  lo.id::text                                                       AS registro_id,
  lo.order_date::text                                               AS referencia,
  lo.status                                                         AS estado,
  lo.is_cancelled::text                                             AS extra,
  lo.cancellation_reason                                            AS detalle,
  lo.created_at AT TIME ZONE 'America/Lima'                         AS evento_lima
FROM lunch_orders lo, target t
WHERE lo.student_id = t.student_id
  AND lo.created_at >= now() - interval '30 days'

UNION ALL

SELECT
  'transaction'                                                     AS tipo,
  tx.id::text,
  tx.metadata->>'lunch_order_id'                                    AS referencia,
  tx.payment_status                                                 AS estado,
  tx.amount::text                                                   AS extra,
  tx.metadata->>'source'                                            AS detalle,
  tx.created_at AT TIME ZONE 'America/Lima'                         AS evento_lima
FROM transactions tx, target t
WHERE tx.student_id = t.student_id
  AND (tx.metadata->>'lunch_order_id') IS NOT NULL
  AND tx.created_at >= now() - interval '30 days'

ORDER BY evento_lima;
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 17 — Pedidos múltiples MISMO día pero distinta categoría (¿bulk legítimo?)
-- Qué mide: alumno con N pedidos el mismo día (puede ser menú + postre, no duplicado).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  lo.student_id,
  s.full_name,
  lo.order_date,
  COUNT(*)                                                          AS pedidos_mismo_dia,
  COUNT(DISTINCT lo.category_id)                                    AS categorias_distintas,
  ARRAY_AGG(DISTINCT lc.name)                                       AS nombres_categorias,
  ARRAY_AGG(lo.id ORDER BY lo.created_at)                           AS order_ids
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.is_cancelled = false
  AND lo.created_at >= now() - interval '30 days'
  AND lo.student_id IS NOT NULL
GROUP BY lo.student_id, s.full_name, lo.order_date
HAVING COUNT(*) >= 2
ORDER BY pedidos_mismo_dia DESC
LIMIT 100;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 18 — Bulk mensual: mismo alumno, muchos días en una sesión (<10 min)
-- Qué mide: pedido de "todo el mes" legítimo (N días en pocos minutos).
-- Si pedidos_mismo_dia = 1 pero total_pedidos = 15 → 15 días distintos, NO duplicado.
-- ─────────────────────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT
    lo.student_id,
    lo.id,
    lo.order_date,
    lo.created_at,
    lo.created_at AT TIME ZONE 'America/Lima' AS created_lima,
    LAG(lo.created_at) OVER (PARTITION BY lo.student_id ORDER BY lo.created_at) AS prev_created_at
  FROM lunch_orders lo
  WHERE lo.is_cancelled = false
    AND lo.created_at >= now() - interval '30 days'
    AND lo.student_id IS NOT NULL
),
sessions AS (
  SELECT
    o.*,
    SUM(CASE
          WHEN o.prev_created_at IS NULL
            OR o.created_at - o.prev_created_at > interval '10 minutes'
          THEN 1 ELSE 0
        END) OVER (PARTITION BY o.student_id ORDER BY o.created_at) AS session_num
  FROM ordered o
)
SELECT
  ses.student_id,
  s.full_name,
  ses.session_num,
  COUNT(*)                                                          AS pedidos_en_sesion,
  COUNT(DISTINCT ses.order_date)                                    AS dias_distintos,
  MIN(ses.created_lima)                                             AS inicio_sesion_lima,
  MAX(ses.created_lima)                                             AS fin_sesion_lima,
  EXTRACT(EPOCH FROM (MAX(ses.created_at) - MIN(ses.created_at)))   AS duracion_segundos
FROM sessions ses
JOIN students s ON s.id = ses.student_id
GROUP BY ses.student_id, s.full_name, ses.session_num
HAVING COUNT(*) >= 5
ORDER BY pedidos_en_sesion DESC, duracion_segundos ASC
LIMIT 100;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 19 — Estado del trigger e índices (infraestructura)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  tgname                                                            AS trigger_name,
  pg_get_triggerdef(oid)                                            AS definicion
FROM pg_trigger
WHERE tgname = 'trigger_prevent_duplicate_lunch_transaction'
  AND NOT tgisinternal;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'transactions'
  AND (
    indexname ILIKE '%lunch%'
    OR indexname ILIKE '%balance_sync%'
  )
ORDER BY indexname;

SELECT
  proname,
  pg_get_functiondef(oid)                                           AS funcion_completa
FROM pg_proc
WHERE proname = 'prevent_duplicate_lunch_transaction'
  AND pronamespace = 'public'::regnamespace;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 20 — RPCs de almuerzo desplegadas
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  proname,
  pg_get_function_arguments(oid)                                    AS argumentos
FROM pg_proc
WHERE proname IN (
  'create_lunch_order_v2',
  'create_lunch_orders_batch_v2',
  'create_and_deliver_lunch_order',
  'check_order_eligibility'
)
AND pronamespace = 'public'::regnamespace
ORDER BY proname;
