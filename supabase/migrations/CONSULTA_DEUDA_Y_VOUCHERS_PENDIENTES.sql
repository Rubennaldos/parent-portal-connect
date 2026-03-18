-- ============================================================
-- CONSULTA: ¿Cuánto me deben en total? ¿Cuánto han pagado sin cobrar (por aprobar)?
-- Ejecutar en Supabase → SQL Editor (cada bloque por separado si quieres)
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1) CUÁNTO ME DEBEN EN TOTAL
--    Deuda pendiente = transacciones con payment_status pending/partial (almuerzo + kiosco)
-- ═══════════════════════════════════════════════════════════
SELECT
  'DEUDA TOTAL (pendiente de pago)' AS concepto,
  COUNT(*) AS cantidad_registros,
  ROUND(SUM(ABS(amount))::numeric, 2) AS total_soles
FROM transactions
WHERE type = 'purchase'
  AND payment_status IN ('pending', 'partial')
  AND is_deleted = false;

-- Desglose: deuda por almuerzos vs kiosco
SELECT
  CASE
    WHEN metadata->>'lunch_order_id' IS NOT NULL AND metadata->>'lunch_order_id' != '' THEN 'Almuerzos'
    ELSE 'Kiosco'
  END AS tipo,
  COUNT(*) AS cantidad,
  ROUND(SUM(ABS(amount))::numeric, 2) AS total_soles
FROM transactions
WHERE type = 'purchase'
  AND payment_status IN ('pending', 'partial')
  AND is_deleted = false
GROUP BY 1
ORDER BY 1;


-- ═══════════════════════════════════════════════════════════
-- 2) CUÁNTO HAN PAGADO SIN COBRAR (POR APROBAR)
--    Vouchers en estado 'pending' = padres ya subieron comprobante, falta que admin apruebe
-- ═══════════════════════════════════════════════════════════
SELECT
  'VOUCHERS PENDIENTES DE APROBAR' AS concepto,
  COUNT(*) AS cantidad_vouchers,
  ROUND(SUM(amount)::numeric, 2) AS total_soles
FROM recharge_requests
WHERE status = 'pending';

-- Desglose por tipo de solicitud (recarga, pago almuerzo, pago deuda)
SELECT
  COALESCE(request_type, 'recharge') AS tipo,
  COUNT(*) AS cantidad,
  ROUND(SUM(amount)::numeric, 2) AS total_soles
FROM recharge_requests
WHERE status = 'pending'
GROUP BY request_type
ORDER BY total_soles DESC;
