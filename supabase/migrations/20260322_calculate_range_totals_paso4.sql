CREATE OR REPLACE FUNCTION calculate_range_totals(
  p_school_id  UUID,
  p_start_date DATE,
  p_end_date   DATE,
  p_school_ids UUID[] DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
AS $body$
SELECT json_build_object(
  'pos', (
    SELECT json_build_object(
      'cash', COALESCE(SUM(CASE WHEN payment_method = 'efectivo' AND (paid_with_mixed = false OR paid_with_mixed IS NULL) THEN ABS(amount) ELSE 0 END), 0),
      'card', COALESCE(SUM(CASE WHEN payment_method = 'tarjeta' AND (paid_with_mixed = false OR paid_with_mixed IS NULL) THEN ABS(amount) ELSE 0 END), 0),
      'yape', COALESCE(SUM(CASE WHEN payment_method IN ('yape','yape_qr','yape_numero') AND (paid_with_mixed = false OR paid_with_mixed IS NULL) THEN ABS(amount) ELSE 0 END), 0),
      'plin', COALESCE(SUM(CASE WHEN payment_method IN ('plin','plin_qr','plin_numero') AND (paid_with_mixed = false OR paid_with_mixed IS NULL) THEN ABS(amount) ELSE 0 END), 0),
      'transferencia', COALESCE(SUM(CASE WHEN payment_method = 'transferencia' AND (paid_with_mixed = false OR paid_with_mixed IS NULL) THEN ABS(amount) ELSE 0 END), 0),
      'credit', COALESCE(SUM(CASE WHEN payment_status IN ('credito','pending') THEN ABS(amount) ELSE 0 END), 0),
      'mixed_cash', COALESCE(SUM(CASE WHEN paid_with_mixed = true THEN ABS(COALESCE(cash_amount,0)) ELSE 0 END), 0),
      'mixed_card', COALESCE(SUM(CASE WHEN paid_with_mixed = true THEN ABS(COALESCE(card_amount,0)) ELSE 0 END), 0),
      'mixed_yape', COALESCE(SUM(CASE WHEN paid_with_mixed = true THEN ABS(COALESCE(yape_amount,0)) ELSE 0 END), 0),
      'total', COALESCE(SUM(ABS(amount)), 0)
    )
    FROM transactions
    WHERE (CASE WHEN p_school_ids IS NOT NULL THEN school_id = ANY(p_school_ids) ELSE school_id = p_school_id END)
      AND DATE(created_at AT TIME ZONE 'America/Lima') BETWEEN p_start_date AND p_end_date
      AND type = 'purchase'
      AND (is_deleted = false OR is_deleted IS NULL)
      AND (payment_status IS NULL OR payment_status != 'cancelled')
      AND metadata->>'source' = 'pos'
  ),
  'lunch', (
    SELECT json_build_object(
      'cash', COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN ABS(amount) ELSE 0 END), 0),
      'card', COALESCE(SUM(CASE WHEN payment_method = 'tarjeta' THEN ABS(amount) ELSE 0 END), 0),
      'yape', COALESCE(SUM(CASE WHEN payment_method IN ('yape','yape_qr','yape_numero') THEN ABS(amount) ELSE 0 END), 0),
      'plin', COALESCE(SUM(CASE WHEN payment_method IN ('plin','plin_qr','plin_numero') THEN ABS(amount) ELSE 0 END), 0),
      'transferencia', COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN ABS(amount) ELSE 0 END), 0),
      'credit', COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN ABS(amount) ELSE 0 END), 0),
      'total', COALESCE(SUM(ABS(amount)), 0)
    )
    FROM transactions
    WHERE (CASE WHEN p_school_ids IS NOT NULL THEN school_id = ANY(p_school_ids) ELSE school_id = p_school_id END)
      AND DATE(created_at AT TIME ZONE 'America/Lima') BETWEEN p_start_date AND p_end_date
      AND type = 'purchase'
      AND metadata->>'lunch_order_id' IS NOT NULL
      AND (is_deleted = false OR is_deleted IS NULL)
      AND (payment_status IS NULL OR payment_status != 'cancelled')
  ),
  'manual', (
    SELECT json_build_object(
      'income',  COALESCE(SUM(CASE WHEN entry_type = 'income'  THEN amount ELSE 0 END), 0),
      'expense', COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END), 0),
      'total',   COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount WHEN entry_type = 'expense' THEN -amount ELSE 0 END), 0)
    )
    FROM cash_manual_entries
    WHERE (CASE WHEN p_school_ids IS NOT NULL THEN school_id = ANY(p_school_ids) ELSE school_id = p_school_id END)
      AND DATE(created_at AT TIME ZONE 'America/Lima') BETWEEN p_start_date AND p_end_date
  )
);
$body$;
