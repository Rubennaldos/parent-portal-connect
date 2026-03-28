-- ============================================================
-- FIX: calculate_daily_totals — incluir cobranzas en efectivo
-- Fecha: 2026-03-28
--
-- PROBLEMA: El admin hizo una "Cobranza en Efectivo" desde el
-- módulo de Cobranzas y el dinero no aparecía en el Cierre de
-- Caja. Los pagos de deuda/almuerzo aprobados en efectivo van
-- a recharge_requests, NO a transactions (que es lo que lee
-- calculate_daily_totals).
--
-- SOLUCIÓN: Agregar un campo "billing_cash" al resultado de la
-- función que sume los recharge_requests aprobados en efectivo
-- del día, para que el dashboard del admin y el arqueo los
-- incluyan en el total de efectivo.
-- ============================================================

-- Verificar qué valores usa payment_method en recharge_requests
-- (para asegurarnos de cubrir todas las variantes)
SELECT DISTINCT payment_method, COUNT(*) as cantidad
FROM recharge_requests
WHERE status = 'approved'
  AND payment_method ILIKE '%efect%'
  OR payment_method ILIKE '%cash%'
GROUP BY payment_method
ORDER BY cantidad DESC;

-- ─── Si quieres incluirlo también en el RPC del dashboard ───────────────
-- Copia este snippet dentro de calculate_daily_totals donde construyes
-- el JSON de respuesta. Agrega 'billing_cash' al objeto resultado:
--
-- billing_cash = (
--   SELECT COALESCE(SUM(amount), 0)
--   FROM recharge_requests
--   WHERE school_id = p_school_id
--     AND status = 'approved'
--     AND LOWER(payment_method) IN ('efectivo','cash','en efectivo')
--     AND approved_at::date = p_date::date
-- )
--
-- Nota: El frontend (CashReconciliationDialog) ya hace esta suma
-- directamente por su cuenta. Este SQL es solo para que el
-- dashboard principal también lo muestre en "Ventas POS".

SELECT '✅ Diagnóstico completado — revisa el resultado arriba para ver los valores de payment_method en cobranzas de efectivo.' AS resultado;
