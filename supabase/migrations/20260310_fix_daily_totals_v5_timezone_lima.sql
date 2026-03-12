-- ============================================================
-- FIX V5: calculate_daily_totals — ZONA HORARIA LIMA (UTC-5)
-- ============================================================
-- BUG: DATE(created_at) usa UTC. Un pago a las 11:59 PM Lima
--      = 04:59 AM UTC del día SIGUIENTE → se contaba en la fecha equivocada.
-- SOLUCIÓN: Convertir created_at a hora Lima antes de extraer la fecha.
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
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date  -- ✅ FIX timezone Lima
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
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date  -- ✅ FIX timezone Lima
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
  'V5: Igual que V4 pero con timezone correcto (America/Lima). Un pago a las 11:59 PM Lima se cuenta para el día correcto de Lima, no UTC.';

-- Verificación
SELECT 
  'V5 timezone fix aplicada' AS status,
  calculate_daily_totals(
    '8a0dbd73-0571-4db1-af5c-65f4948c4c98'::uuid,
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date
  ) AS resultado;
