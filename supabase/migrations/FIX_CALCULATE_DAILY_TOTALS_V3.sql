-- ============================================================
-- 🔧 FIX V3: calculate_daily_totals — MONTOS POSITIVOS + SEPARAR POS/LUNCH
-- ============================================================
-- PROBLEMAS CORREGIDOS:
--   1. Todas las transacciones guardan amount como NEGATIVO (-total)
--      pero la función hacía SUM(amount) → totales negativos
--   2. La sección de almuerzos retornaba ceros hardcodeados
--   3. No separaba transacciones POS de transacciones de almuerzos
--
-- SOLUCIÓN:
--   - Usar ABS(amount) para convertir a positivo
--   - POS: transacciones SIN lunch_order_id en metadata
--   - LUNCH: transacciones CON lunch_order_id en metadata
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    -- ═══════════════════════════════════════════════════════
    -- POS: Transacciones de punto de venta (sin lunch_order_id)
    -- ═══════════════════════════════════════════════════════
    'pos', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(
          CASE WHEN payment_method = 'efectivo' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'card', COALESCE(SUM(
          CASE WHEN payment_method = 'tarjeta' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'yape', COALESCE(SUM(
          CASE WHEN payment_method = 'yape' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'yape_qr', COALESCE(SUM(
          CASE WHEN payment_method = 'yape_qr' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'credit', COALESCE(SUM(
          CASE WHEN payment_status IN ('credito', 'pending')
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'mixed_cash', COALESCE(SUM(
          CASE WHEN paid_with_mixed = true
          THEN ABS(COALESCE(cash_amount, 0)) ELSE 0 END
        ), 0),
        'mixed_card', COALESCE(SUM(
          CASE WHEN paid_with_mixed = true
          THEN ABS(COALESCE(card_amount, 0)) ELSE 0 END
        ), 0),
        'mixed_yape', COALESCE(SUM(
          CASE WHEN paid_with_mixed = true
          THEN ABS(COALESCE(yape_amount, 0)) ELSE 0 END
        ), 0),
        'total', COALESCE(SUM(ABS(amount)), 0)
      )
      FROM transactions
      WHERE school_id = p_school_id
        AND DATE(created_at) = p_date
        AND type = 'purchase'
        AND (is_deleted = false OR is_deleted IS NULL)
        -- Solo POS: excluir transacciones vinculadas a almuerzos
        AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL)
    ),

    -- ═══════════════════════════════════════════════════════
    -- LUNCH: Transacciones de almuerzos (con lunch_order_id)
    -- ═══════════════════════════════════════════════════════
    'lunch', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(
          CASE WHEN payment_method = 'efectivo'
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'card', COALESCE(SUM(
          CASE WHEN payment_method = 'tarjeta'
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'yape', COALESCE(SUM(
          CASE WHEN payment_method = 'yape'
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'credit', COALESCE(SUM(
          CASE WHEN payment_status = 'pending'
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'total', COALESCE(SUM(ABS(amount)), 0)
      )
      FROM transactions
      WHERE school_id = p_school_id
        AND DATE(created_at) = p_date
        AND type = 'purchase'
        AND (is_deleted = false OR is_deleted IS NULL)
        -- Solo almuerzos: transacciones con lunch_order_id
        AND metadata IS NOT NULL
        AND metadata->>'lunch_order_id' IS NOT NULL
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION calculate_daily_totals IS 
  'Calcula totales de ventas del día separando POS y Almuerzos. Usa ABS(amount) porque las transacciones guardan montos negativos.';

-- ===================================================================
-- VERIFICACIÓN: Probar que ya no sale negativo
-- ===================================================================
SELECT 
  '✅ Función V3 actualizada — Probando...' as test,
  calculate_daily_totals(
    '8a0dbd73-0571-4db1-af5c-65f4948c4c98'::uuid,  -- Jean LeBouch
    CURRENT_DATE
  ) as resultado;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  PARTE 2: CORREGIR CIERRES HISTÓRICOS CON VALORES NEGATIVOS     ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ===================================================================
-- 📋 PASO 1: VER CUÁNTOS CIERRES TIENEN VALORES NEGATIVOS (solo lectura)
-- ===================================================================
SELECT 
  '📊 Cierres con valores negativos:' as info,
  COUNT(*) as cantidad,
  STRING_AGG(DISTINCT cc.school_id::text, ', ') as sedes_afectadas
FROM cash_closures cc
WHERE cc.total_sales < 0 OR cc.pos_total < 0;

-- ===================================================================
-- 🔧 PASO 2: CORREGIR cash_closures — convertir negativos a positivos
-- ===================================================================
UPDATE cash_closures
SET
  -- Ventas POS
  pos_cash = ABS(pos_cash),
  pos_card = ABS(pos_card),
  pos_yape = ABS(pos_yape),
  pos_yape_qr = ABS(pos_yape_qr),
  pos_credit = ABS(pos_credit),
  pos_mixed_cash = ABS(pos_mixed_cash),
  pos_mixed_card = ABS(pos_mixed_card),
  pos_mixed_yape = ABS(pos_mixed_yape),
  pos_total = ABS(pos_total),
  -- Ventas Almuerzos
  lunch_cash = ABS(lunch_cash),
  lunch_credit = ABS(lunch_credit),
  lunch_card = ABS(lunch_card),
  lunch_yape = ABS(lunch_yape),
  lunch_total = ABS(lunch_total),
  -- Totales generales
  total_cash = ABS(total_cash),
  total_card = ABS(total_card),
  total_yape = ABS(total_yape),
  total_yape_qr = ABS(total_yape_qr),
  total_credit = ABS(total_credit),
  total_sales = ABS(total_sales),
  -- Recalcular caja esperada: inicial + efectivo ventas + ingresos - egresos
  expected_final = initial_amount + ABS(total_cash) + total_ingresos - total_egresos,
  -- Recalcular diferencia: real - esperado corregido
  difference = COALESCE(actual_final, 0) - (initial_amount + ABS(total_cash) + total_ingresos - total_egresos)
WHERE total_sales < 0 OR pos_total < 0 OR total_cash < 0;

-- ===================================================================
-- 🔧 PASO 3: CORREGIR cash_registers — expected y difference
-- ===================================================================
UPDATE cash_registers cr
SET
  expected_amount = cc.expected_final,
  difference = cc.difference
FROM cash_closures cc
WHERE cr.id = cc.cash_register_id
  AND cr.status = 'closed';

-- ===================================================================
-- ✅ VERIFICACIÓN FINAL: Confirmar que ya no hay negativos
-- ===================================================================
SELECT 
  '✅ RESULTADO FINAL' as info,
  COUNT(*) FILTER (WHERE total_sales < 0) as "Cierres aún negativos",
  COUNT(*) FILTER (WHERE total_sales >= 0) as "Cierres OK",
  COUNT(*) as "Total cierres"
FROM cash_closures;

-- Mostrar los cierres corregidos
SELECT 
  s.code as "Sede",
  cc.closure_date as "Fecha",
  cc.initial_amount as "Inició",
  cc.total_sales as "Vendió",
  cc.total_cash as "Efectivo",
  cc.total_yape as "Yape",
  cc.expected_final as "Esperado",
  cc.actual_final as "Real",
  cc.difference as "Diferencia"
FROM cash_closures cc
JOIN schools s ON cc.school_id = s.id
ORDER BY cc.closure_date DESC
LIMIT 20;
