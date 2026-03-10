-- =====================================================
-- RESUMEN DETALLADO DE PEDIDOS DE ALMUERZO
-- PRÓXIMA SEMANA (Lunes a Viernes)
-- Agrupado por SEDE
-- =====================================================
-- Incluye:
-- - Nombre del padre
-- - Nombre del hijo
-- - Si ha pagado o no
-- - Monto del pedido
-- - Email del padre para contacto
-- =====================================================

WITH proxima_semana AS (
  -- Calcular el próximo lunes y viernes
  SELECT 
    CASE 
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE  -- Si hoy es lunes, empezar hoy
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER  -- Próximo lunes
    END AS fecha_inicio,
    CASE 
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE + 4  -- Si hoy es lunes, viernes es +4
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER + 4  -- Próximo viernes
    END AS fecha_fin
),
fechas_semana AS (
  -- Generar todas las fechas de lunes a viernes
  SELECT fecha_inicio + (generate_series(0, 4) || ' days')::INTERVAL AS fecha
  FROM proxima_semana
),
pedidos_semana AS (
  -- Obtener todos los pedidos de la próxima semana
  SELECT 
    lo.id AS order_id,
    lo.student_id,
    lo.school_id,
    lo.order_date,
    lo.final_price,
    lo.quantity,
    lo.status,
    lo.is_cancelled,
    s.name AS estudiante_nombre,
    s.parent_id,
    COALESCE(pp.full_name, p.email, 'No registrado') AS padre_nombre,
    p.email AS padre_email,
    COALESCE(pp.phone_1, pp.phone_2, 'No registrado') AS padre_telefono,
    sc.name AS sede_nombre,
    sc.code AS sede_codigo
  FROM lunch_orders lo
  INNER JOIN students s ON lo.student_id = s.id
  LEFT JOIN profiles p ON s.parent_id = p.id
  LEFT JOIN parent_profiles pp ON p.id = pp.user_id
  LEFT JOIN schools sc ON lo.school_id = sc.id
  INNER JOIN fechas_semana fs ON lo.order_date = fs.fecha::DATE
  WHERE lo.is_cancelled = false
    AND lo.status IN ('confirmed', 'pending_payment', 'delivered')
),
pagos_por_transaccion AS (
  -- Verificar pagos mediante transacciones (pago en caja/POS)
  SELECT DISTINCT
    (tx.metadata->>'lunch_order_id')::UUID AS order_id,
    true AS pagado_por_transaccion,
    tx.id AS transaction_id,
    tx.created_at AS fecha_pago
  FROM transactions tx
  WHERE tx.type IN ('purchase', 'debit')
    AND tx.metadata IS NOT NULL
    AND tx.metadata->>'lunch_order_id' IS NOT NULL
),
pagos_por_voucher AS (
  -- Verificar pagos mediante vouchers aprobados (recharge_requests)
  SELECT DISTINCT
    UNNEST(rr.lunch_order_ids) AS order_id,
    true AS pagado_por_voucher,
    rr.id AS voucher_id,
    rr.approved_at AS fecha_pago
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.lunch_order_ids IS NOT NULL
    AND array_length(rr.lunch_order_ids, 1) > 0
),
estado_pago AS (
  -- Consolidar estado de pago
  SELECT 
    ps.order_id,
    COALESCE(pt.pagado_por_transaccion, false) OR COALESCE(pv.pagado_por_voucher, false) AS ha_pagado,
    CASE 
      WHEN pt.pagado_por_transaccion THEN 'Transacción (Caja/POS)'
      WHEN pv.pagado_por_voucher THEN 'Voucher Aprobado'
      ELSE 'Pendiente de Pago'
    END AS metodo_pago,
    COALESCE(pt.fecha_pago, pv.fecha_pago) AS fecha_pago
  FROM pedidos_semana ps
  LEFT JOIN pagos_por_transaccion pt ON ps.order_id = pt.order_id
  LEFT JOIN pagos_por_voucher pv ON ps.order_id = pv.order_id
)
-- RESULTADO FINAL: Agrupado por SEDE
SELECT 
  ps.sede_codigo,
  ps.sede_nombre,
  COUNT(DISTINCT ps.order_id) AS total_pedidos,
  COUNT(DISTINCT CASE WHEN ha_pago.ha_pagado THEN ps.order_id END) AS pedidos_pagados,
  COUNT(DISTINCT CASE WHEN NOT ha_pago.ha_pagado THEN ps.order_id END) AS pedidos_pendientes,
  SUM(ha_pago.ha_pagado::INTEGER * ps.final_price * ps.quantity) AS monto_pagado,
  SUM((NOT ha_pago.ha_pagado::BOOLEAN)::INTEGER * ps.final_price * ps.quantity) AS monto_pendiente,
  SUM(ps.final_price * ps.quantity) AS monto_total
FROM pedidos_semana ps
INNER JOIN estado_pago ha_pago ON ps.order_id = ha_pago.order_id
GROUP BY ps.sede_codigo, ps.sede_nombre
ORDER BY ps.sede_codigo;

-- =====================================================
-- DETALLE POR SEDE: Lista completa de pedidos
-- =====================================================
-- Ejecutar esta consulta para ver el detalle completo
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
pedidos_semana AS (
  SELECT 
    lo.id AS order_id,
    lo.student_id,
    lo.school_id,
    lo.order_date,
    lo.final_price,
    lo.quantity,
    lo.status,
    lo.is_cancelled,
    s.name AS estudiante_nombre,
    s.parent_id,
    p.full_name AS padre_nombre,
    p.email AS padre_email,
    p.phone_1 AS padre_telefono,
    sc.name AS sede_nombre,
    sc.code AS sede_codigo
  FROM lunch_orders lo
  INNER JOIN students s ON lo.student_id = s.id
  LEFT JOIN profiles p ON s.parent_id = p.id
  LEFT JOIN schools sc ON lo.school_id = sc.id
  INNER JOIN fechas_semana fs ON lo.order_date = fs.fecha::DATE
  WHERE lo.is_cancelled = false
    AND lo.status IN ('confirmed', 'pending_payment', 'delivered')
),
pagos_por_transaccion AS (
  SELECT DISTINCT
    (tx.metadata->>'lunch_order_id')::UUID AS order_id,
    true AS pagado_por_transaccion,
    tx.id AS transaction_id,
    tx.created_at AS fecha_pago
  FROM transactions tx
  WHERE tx.type IN ('purchase', 'debit')
    AND tx.metadata IS NOT NULL
    AND tx.metadata->>'lunch_order_id' IS NOT NULL
),
pagos_por_voucher AS (
  SELECT DISTINCT
    UNNEST(rr.lunch_order_ids) AS order_id,
    true AS pagado_por_voucher,
    rr.id AS voucher_id,
    rr.approved_at AS fecha_pago
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.lunch_order_ids IS NOT NULL
    AND array_length(rr.lunch_order_ids, 1) > 0
),
estado_pago AS (
  SELECT 
    ps.order_id,
    COALESCE(pt.pagado_por_transaccion, false) OR COALESCE(pv.pagado_por_voucher, false) AS ha_pagado,
    CASE 
      WHEN pt.pagado_por_transaccion THEN 'Transacción (Caja/POS)'
      WHEN pv.pagado_por_voucher THEN 'Voucher Aprobado'
      ELSE 'Pendiente de Pago'
    END AS metodo_pago,
    COALESCE(pt.fecha_pago, pv.fecha_pago) AS fecha_pago
  FROM pedidos_semana ps
  LEFT JOIN pagos_por_transaccion pt ON ps.order_id = pt.order_id
  LEFT JOIN pagos_por_voucher pv ON ps.order_id = pv.order_id
)
SELECT 
  ps.sede_codigo,
  ps.sede_nombre,
  ps.order_date AS fecha_pedido,
  ps.padre_nombre,
  ps.estudiante_nombre,
  ps.padre_email,
  COALESCE(ps.padre_telefono, 'No registrado') AS padre_telefono,
  ps.quantity AS cantidad,
  ps.final_price AS precio_unitario,
  (ps.final_price * ps.quantity) AS monto_total,
  ha_pago.ha_pagado,
  ha_pago.metodo_pago,
  ha_pago.fecha_pago,
  ps.status AS estado_pedido
FROM pedidos_semana ps
INNER JOIN estado_pago ha_pago ON ps.order_id = ha_pago.order_id
ORDER BY 
  ps.sede_codigo,
  ps.order_date,
  ps.padre_nombre,
  ps.estudiante_nombre;

-- =====================================================
-- RESUMEN POR PADRE (para contacto masivo)
-- =====================================================
-- Agrupa por padre para ver cuántos pedidos tiene
-- y si todos están pagados o hay pendientes
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
pedidos_semana AS (
  SELECT 
    lo.id AS order_id,
    lo.student_id,
    lo.school_id,
    lo.order_date,
    lo.final_price,
    lo.quantity,
    lo.status,
    lo.is_cancelled,
    s.name AS estudiante_nombre,
    s.parent_id,
    p.full_name AS padre_nombre,
    p.email AS padre_email,
    p.phone_1 AS padre_telefono,
    sc.name AS sede_nombre,
    sc.code AS sede_codigo
  FROM lunch_orders lo
  INNER JOIN students s ON lo.student_id = s.id
  LEFT JOIN profiles p ON s.parent_id = p.id
  LEFT JOIN schools sc ON lo.school_id = sc.id
  INNER JOIN fechas_semana fs ON lo.order_date = fs.fecha::DATE
  WHERE lo.is_cancelled = false
    AND lo.status IN ('confirmed', 'pending_payment', 'delivered')
),
pagos_por_transaccion AS (
  SELECT DISTINCT
    (tx.metadata->>'lunch_order_id')::UUID AS order_id,
    true AS pagado_por_transaccion,
    tx.id AS transaction_id,
    tx.created_at AS fecha_pago
  FROM transactions tx
  WHERE tx.type IN ('purchase', 'debit')
    AND tx.metadata IS NOT NULL
    AND tx.metadata->>'lunch_order_id' IS NOT NULL
),
pagos_por_voucher AS (
  SELECT DISTINCT
    UNNEST(rr.lunch_order_ids) AS order_id,
    true AS pagado_por_voucher,
    rr.id AS voucher_id,
    rr.approved_at AS fecha_pago
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.lunch_order_ids IS NOT NULL
    AND array_length(rr.lunch_order_ids, 1) > 0
),
estado_pago AS (
  SELECT 
    ps.order_id,
    COALESCE(pt.pagado_por_transaccion, false) OR COALESCE(pv.pagado_por_voucher, false) AS ha_pagado,
    CASE 
      WHEN pt.pagado_por_transaccion THEN 'Transacción (Caja/POS)'
      WHEN pv.pagado_por_voucher THEN 'Voucher Aprobado'
      ELSE 'Pendiente de Pago'
    END AS metodo_pago,
    COALESCE(pt.fecha_pago, pv.fecha_pago) AS fecha_pago
  FROM pedidos_semana ps
  LEFT JOIN pagos_por_transaccion pt ON ps.order_id = pt.order_id
  LEFT JOIN pagos_por_voucher pv ON ps.order_id = pv.order_id
)
SELECT 
  ps.sede_codigo,
  ps.sede_nombre,
  ps.padre_nombre,
  ps.padre_email,
  COALESCE(ps.padre_telefono, 'No registrado') AS padre_telefono,
  COUNT(DISTINCT ps.order_id) AS total_pedidos,
  COUNT(DISTINCT ps.estudiante_nombre) AS hijos_con_pedidos,
  STRING_AGG(DISTINCT ps.estudiante_nombre, ', ' ORDER BY ps.estudiante_nombre) AS nombres_hijos,
  COUNT(DISTINCT CASE WHEN ha_pago.ha_pagado THEN ps.order_id END) AS pedidos_pagados,
  COUNT(DISTINCT CASE WHEN NOT ha_pago.ha_pagado THEN ps.order_id END) AS pedidos_pendientes,
  SUM(ps.final_price * ps.quantity) AS monto_total,
  SUM(CASE WHEN ha_pago.ha_pagado THEN ps.final_price * ps.quantity ELSE 0 END) AS monto_pagado,
  SUM(CASE WHEN NOT ha_pago.ha_pagado THEN ps.final_price * ps.quantity ELSE 0 END) AS monto_pendiente,
  CASE 
    WHEN COUNT(DISTINCT CASE WHEN NOT ha_pago.ha_pagado THEN ps.order_id END) > 0 
    THEN '⚠️ TIENE PENDIENTES'
    ELSE '✅ TODO PAGADO'
  END AS estado_pago
FROM pedidos_semana ps
INNER JOIN estado_pago ha_pago ON ps.order_id = ha_pago.order_id
GROUP BY 
  ps.sede_codigo,
  ps.sede_nombre,
  ps.padre_nombre,
  ps.padre_email,
  ps.padre_telefono
ORDER BY 
  ps.sede_codigo,
  estado_pago DESC,  -- Primero los que tienen pendientes
  ps.padre_nombre;
