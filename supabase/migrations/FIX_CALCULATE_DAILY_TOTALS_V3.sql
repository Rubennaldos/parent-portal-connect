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
