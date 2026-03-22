-- ============================================================
-- calculate_daily_totals v8 — YAPE/PLIN UNIFICADOS
-- ============================================================
--
-- PROBLEMA RESUELTO:
--   La v7 solo reconocía payment_method IN ('yape', 'yape_qr', 'plin').
--   Transacciones antiguas con payment_method = 'yape_numero', 'plin_qr',
--   'plin_numero' quedaban fuera del conteo de totales digitales.
--   Esto hacía que cierres de caja de meses pasados mostraran
--   totales de Yape/Plin más bajos de lo real.
--
-- SOLUCIÓN:
--   'yape' ahora agrupa: yape, yape_qr, yape_numero
--   'plin' ahora agrupa: plin, plin_qr, plin_numero
--   Se elimina la columna 'yape_qr' separada (ya está dentro de 'yape').
--
-- RETROCOMPATIBILIDAD:
--   El frontend (CashReconciliationDialog) ya usa pos.yape + pos.plin
--   sin depender de pos.yape_qr por separado.
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(

    -- ── Ventas POS físico (kiosco) ─────────────────────────────────────────────
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
        -- yape unificado: nuevas y antiguas variantes
        'yape', COALESCE(SUM(
          CASE WHEN payment_method IN ('yape', 'yape_qr', 'yape_numero')
            AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        -- plin unificado: nuevas y antiguas variantes
        'plin', COALESCE(SUM(
          CASE WHEN payment_method IN ('plin', 'plin_qr', 'plin_numero')
            AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
          THEN ABS(amount) ELSE 0 END
        ), 0),
        'transferencia', COALESCE(SUM(
          CASE WHEN payment_method = 'transferencia' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
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
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date
        AND type = 'purchase'
        AND (is_deleted = false OR is_deleted IS NULL)
        AND (payment_status IS NULL OR payment_status != 'cancelled')
        AND metadata->>'source' = 'pos'
    ),

    -- ── Pagos de almuerzo ─────────────────────────────────────────────────────
    'lunch', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(
          CASE WHEN payment_method = 'efectivo' THEN ABS(amount) ELSE 0 END
        ), 0),
        'card', COALESCE(SUM(
          CASE WHEN payment_method = 'tarjeta' THEN ABS(amount) ELSE 0 END
        ), 0),
        'yape', COALESCE(SUM(
          CASE WHEN payment_method IN ('yape', 'yape_qr', 'yape_numero') THEN ABS(amount) ELSE 0 END
        ), 0),
        'plin', COALESCE(SUM(
          CASE WHEN payment_method IN ('plin', 'plin_qr', 'plin_numero') THEN ABS(amount) ELSE 0 END
        ), 0),
        'transferencia', COALESCE(SUM(
          CASE WHEN payment_method = 'transferencia' THEN ABS(amount) ELSE 0 END
        ), 0),
        'credit', COALESCE(SUM(
          CASE WHEN payment_status = 'pending' THEN ABS(amount) ELSE 0 END
        ), 0),
        'total', COALESCE(SUM(ABS(amount)), 0)
      )
      FROM transactions
      WHERE school_id = p_school_id
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date
        AND type = 'purchase'
        AND metadata->>'lunch_order_id' IS NOT NULL
        AND (is_deleted = false OR is_deleted IS NULL)
        AND (payment_status IS NULL OR payment_status != 'cancelled')
    ),

    -- ── Movimientos manuales (ingresos/egresos) ───────────────────────────────
    'manual', (
      SELECT json_build_object(
        'income', COALESCE(SUM(
          CASE WHEN entry_type = 'income' THEN amount ELSE 0 END
        ), 0),
        'expense', COALESCE(SUM(
          CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END
        ), 0),
        'total', COALESCE(SUM(
          CASE WHEN entry_type = 'income' THEN amount
               WHEN entry_type = 'expense' THEN -amount
               ELSE 0 END
        ), 0)
      )
      FROM cash_manual_entries
      WHERE school_id = p_school_id
        AND DATE(created_at AT TIME ZONE 'America/Lima') = p_date
    )

  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
