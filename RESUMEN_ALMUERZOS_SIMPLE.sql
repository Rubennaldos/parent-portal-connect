-- =====================================================
-- RESUMEN SIMPLE POR SEDE
-- Próxima semana (Lunes a Viernes)
-- =====================================================
-- Ejecuta esta consulta primero para ver el resumen general
-- =====================================================

WITH proxima_semana AS (
  SELECT 
    CASE 
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER
    END AS fecha_inicio,
    CASE 
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE + 4
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER + 4
    END AS fecha_fin
),
fechas_semana AS (
  SELECT fecha_inicio + (generate_series(0, 4) || ' days')::INTERVAL AS fecha
  FROM proxima_semana
),
pedidos AS (
  SELECT 
    lo.id,
    lo.school_id,
    lo.order_date,
    lo.final_price * lo.quantity AS monto,
    s.parent_id,
    sc.code AS sede_codigo,
    sc.name AS sede_nombre
  FROM lunch_orders lo
  INNER JOIN students s ON lo.student_id = s.id
  LEFT JOIN schools sc ON lo.school_id = sc.id
  INNER JOIN fechas_semana fs ON lo.order_date = fs.fecha::DATE
  WHERE lo.is_cancelled = false
    AND lo.status IN ('confirmed', 'pending_payment', 'delivered')
),
pagos AS (
  SELECT DISTINCT
    (tx.metadata->>'lunch_order_id')::UUID AS order_id
  FROM transactions tx
  WHERE tx.type IN ('purchase', 'debit')
    AND tx.metadata->>'lunch_order_id' IS NOT NULL
  
  UNION
  
  SELECT DISTINCT UNNEST(rr.lunch_order_ids) AS order_id
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.lunch_order_ids IS NOT NULL
)
SELECT 
  p.sede_codigo,
  p.sede_nombre,
  COUNT(*) AS total_pedidos,
  COUNT(CASE WHEN pag.order_id IS NOT NULL THEN 1 END) AS pagados,
  COUNT(CASE WHEN pag.order_id IS NULL THEN 1 END) AS pendientes,
  SUM(p.monto) AS monto_total,
  SUM(CASE WHEN pag.order_id IS NOT NULL THEN p.monto ELSE 0 END) AS monto_pagado,
  SUM(CASE WHEN pag.order_id IS NULL THEN p.monto ELSE 0 END) AS monto_pendiente
FROM pedidos p
LEFT JOIN pagos pag ON p.id = pag.order_id
GROUP BY p.sede_codigo, p.sede_nombre
ORDER BY p.sede_codigo;
