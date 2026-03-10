-- =====================================================
-- DETALLE COMPLETO DE PEDIDOS POR SEDE
-- Próxima semana (Lunes a Viernes)
-- =====================================================
-- Esta consulta muestra TODOS los pedidos con información
-- completa de padres, hijos, pagos y contactos
-- =====================================================

WITH proxima_semana AS (
  SELECT 
    CASE 
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER
    END AS fecha_inicio
),
fechas_semana AS (
  SELECT fecha_inicio + (generate_series(0, 4) || ' days')::INTERVAL AS fecha
  FROM proxima_semana
),
pedidos AS (
  SELECT 
    lo.id AS order_id,
    lo.student_id,
    lo.school_id,
    lo.order_date,
    lo.final_price,
    lo.quantity,
    lo.status,
    s.name AS estudiante_nombre,
    s.parent_id,
    COALESCE(pp.full_name, p.email, 'No registrado') AS padre_nombre,
    p.email AS padre_email,
    COALESCE(pp.phone_1, pp.phone_2, 'No registrado') AS padre_telefono,
    sc.code AS sede_codigo,
    sc.name AS sede_nombre
  FROM lunch_orders lo
  INNER JOIN students s ON lo.student_id = s.id
  LEFT JOIN profiles p ON s.parent_id = p.id
  LEFT JOIN parent_profiles pp ON p.id = pp.user_id
  LEFT JOIN schools sc ON lo.school_id = sc.id
  INNER JOIN fechas_semana fs ON lo.order_date = fs.fecha::DATE
  WHERE lo.is_cancelled = false
    AND lo.status IN ('confirmed', 'pending_payment', 'delivered')
),
pagos_transaccion AS (
  SELECT DISTINCT
    (tx.metadata->>'lunch_order_id')::UUID AS order_id,
    'Transacción (Caja/POS)' AS metodo
  FROM transactions tx
  WHERE tx.type IN ('purchase', 'debit')
    AND tx.metadata->>'lunch_order_id' IS NOT NULL
),
pagos_voucher AS (
  SELECT DISTINCT
    UNNEST(rr.lunch_order_ids) AS order_id,
    'Voucher Aprobado' AS metodo
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.lunch_order_ids IS NOT NULL
),
estado_pago AS (
  SELECT 
    p.order_id,
    COALESCE(pt.order_id IS NOT NULL, false) OR COALESCE(pv.order_id IS NOT NULL, false) AS ha_pagado,
    COALESCE(pt.metodo, pv.metodo, 'Pendiente de Pago') AS metodo_pago
  FROM pedidos p
  LEFT JOIN pagos_transaccion pt ON p.order_id = pt.order_id
  LEFT JOIN pagos_voucher pv ON p.order_id = pv.order_id
)
SELECT 
  p.sede_codigo,
  p.sede_nombre,
  TO_CHAR(p.order_date, 'DD/MM/YYYY') AS fecha,
  TO_CHAR(p.order_date, 'Day') AS dia_semana,
  p.padre_nombre,
  p.estudiante_nombre,
  p.padre_email,
  p.padre_telefono,
  p.quantity AS cantidad,
  p.final_price AS precio_unitario,
  (p.final_price * p.quantity) AS monto_total,
  CASE 
    WHEN ep.ha_pagado THEN '✅ PAGADO'
    ELSE '⚠️ PENDIENTE'
  END AS estado_pago,
  ep.metodo_pago,
  p.status AS estado_pedido
FROM pedidos p
INNER JOIN estado_pago ep ON p.order_id = ep.order_id
ORDER BY 
  p.sede_codigo,
  p.order_date,
  p.padre_nombre,
  p.estudiante_nombre;
