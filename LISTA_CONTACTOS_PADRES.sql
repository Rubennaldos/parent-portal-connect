-- =====================================================
-- LISTA DE CONTACTOS DE PADRES CON PEDIDOS
-- Próxima semana (Lunes a Viernes)
-- =====================================================
-- Agrupado por padre para facilitar el contacto masivo
-- Muestra si tiene pedidos pendientes de pago
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
    lo.final_price * lo.quantity AS monto,
    s.name AS estudiante_nombre,
    s.parent_id,
    p.full_name AS padre_nombre,
    p.email AS padre_email,
    COALESCE(p.phone_1, 'No registrado') AS padre_telefono,
    sc.code AS sede_codigo,
    sc.name AS sede_nombre
  FROM lunch_orders lo
  INNER JOIN students s ON lo.student_id = s.id
  LEFT JOIN profiles p ON s.parent_id = p.id
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
  p.padre_nombre,
  p.padre_email,
  p.padre_telefono,
  COUNT(DISTINCT p.order_id) AS total_pedidos,
  COUNT(DISTINCT p.estudiante_nombre) AS hijos_con_pedidos,
  STRING_AGG(DISTINCT p.estudiante_nombre, ', ' ORDER BY p.estudiante_nombre) AS nombres_hijos,
  COUNT(DISTINCT CASE WHEN pag.order_id IS NOT NULL THEN p.order_id END) AS pedidos_pagados,
  COUNT(DISTINCT CASE WHEN pag.order_id IS NULL THEN p.order_id END) AS pedidos_pendientes,
  SUM(p.monto) AS monto_total,
  SUM(CASE WHEN pag.order_id IS NOT NULL THEN p.monto ELSE 0 END) AS monto_pagado,
  SUM(CASE WHEN pag.order_id IS NULL THEN p.monto ELSE 0 END) AS monto_pendiente,
  CASE 
    WHEN COUNT(DISTINCT CASE WHEN pag.order_id IS NULL THEN p.order_id END) > 0 
    THEN '⚠️ TIENE PENDIENTES'
    ELSE '✅ TODO PAGADO'
  END AS estado_pago
FROM pedidos p
LEFT JOIN pagos pag ON p.order_id = pag.order_id
GROUP BY 
  p.sede_codigo,
  p.sede_nombre,
  p.padre_nombre,
  p.padre_email,
  p.padre_telefono
ORDER BY 
  p.sede_codigo,
  estado_pago DESC,  -- Primero los que tienen pendientes
  p.padre_nombre;
