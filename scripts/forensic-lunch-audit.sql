-- Forensic audit: lunch order failures (read-only)
-- 1) RPCs deployed?
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('create_lunch_order_v2', 'get_next_ticket_number')
  AND pronamespace = 'public'::regnamespace
ORDER BY proname;

-- 2) Index for balance sync
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'transactions'
  AND indexname = 'idx_transactions_balance_sync_covering';

-- 3) Cancelled parent orders today with/without linked tx
WITH today_orders AS (
  SELECT lo.id, lo.student_id, lo.order_date, lo.status, lo.is_cancelled,
         lo.payment_flow_state, lo.school_id, lo.created_at AT TIME ZONE 'America/Lima' AS created_lima
  FROM lunch_orders lo
  WHERE lo.created_at >= (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima'
    AND lo.student_id IS NOT NULL
)
SELECT
  CASE WHEN lc.force_prepayment THEN 'prepago' ELSE 'normal' END AS sede_tipo,
  COUNT(*) FILTER (WHERE t.id IS NULL AND o.is_cancelled) AS cancelados_sin_deuda,
  COUNT(*) FILTER (WHERE t.id IS NOT NULL AND NOT o.is_cancelled) AS ok_con_deuda,
  COUNT(*) FILTER (WHERE t.id IS NOT NULL AND o.is_cancelled) AS cancelados_con_deuda_huérfana,
  COUNT(*) FILTER (WHERE t.id IS NULL AND NOT o.is_cancelled) AS pedidos_sin_deuda_activos
FROM today_orders o
LEFT JOIN lunch_configuration lc ON lc.school_id = o.school_id
LEFT JOIN transactions t ON (t.metadata->>'lunch_order_id') = o.id::text AND t.is_deleted IS DISTINCT FROM true
GROUP BY 1
ORDER BY 1;

-- 4) Families with multiple cancelled attempts same day (retry pattern)
SELECT s.full_name, o.order_date, COUNT(*) AS intentos,
       COUNT(*) FILTER (WHERE o.is_cancelled) AS anulados,
       MIN(o.created_lima) AS primer_intento,
       MAX(o.created_lima) AS ultimo_intento
FROM (
  SELECT lo.*, lo.created_at AT TIME ZONE 'America/Lima' AS created_lima
  FROM lunch_orders lo
  WHERE lo.created_at >= (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima'
    AND lo.student_id IS NOT NULL
) o
JOIN students s ON s.id = o.student_id
GROUP BY s.full_name, o.order_date, o.category_id
HAVING COUNT(*) > 1
ORDER BY intentos DESC
LIMIT 20;

-- 5) Hourly failure pattern today
SELECT date_trunc('hour', lo.created_at AT TIME ZONE 'America/Lima') AS hora_lima,
       COUNT(*) FILTER (WHERE lo.is_cancelled) AS anulados,
       COUNT(*) FILTER (WHERE NOT lo.is_cancelled) AS activos
FROM lunch_orders lo
WHERE lo.created_at >= (timezone('America/Lima', now())::date)::timestamp AT TIME ZONE 'America/Lima'
  AND lo.student_id IS NOT NULL
GROUP BY 1
ORDER BY 1;
