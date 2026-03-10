-- ============================================================
-- FIX V4: calculate_daily_totals — EXCLUIR VENTAS ANULADAS
-- ============================================================
-- BUG CORREGIDO:
--   Las transacciones con payment_status = 'cancelled' seguían
--   contándose en los totales del cierre de caja, causando
--   desfase (faltante) cuando se anulaban ventas en efectivo.
--
-- SOLUCIÓN:
--   Agregar filtro: payment_status IS NULL OR payment_status != 'cancelled'
--   en ambas sub-queries (POS y LUNCH)
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
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
        AND (payment_status IS NULL OR payment_status != 'cancelled')
        AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL)
    ),

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
        AND (payment_status IS NULL OR payment_status != 'cancelled')
        AND metadata IS NOT NULL
        AND metadata->>'lunch_order_id' IS NOT NULL
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION calculate_daily_totals IS 
  'V4: Calcula totales de ventas del día separando POS y Almuerzos. Excluye ventas anuladas (payment_status=cancelled). Usa ABS(amount).';

-- Verificación
SELECT 
  'V4 aplicada correctamente' as status,
  calculate_daily_totals(
    '8a0dbd73-0571-4db1-af5c-65f4948c4c98'::uuid,
    CURRENT_DATE
  ) as resultado;
