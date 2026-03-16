-- ============================================================
-- FIX CRÍTICO v6: calculate_daily_totals + payment_method en manuales
-- ============================================================
--
-- CAMBIOS:
--   1. Agregar columna payment_method a cash_manual_entries (fix del error 400)
--   2. Actualizar calculate_daily_totals para incluir ingresos/egresos manuales
--      desglosados por medio de pago en el resumen del día
--
-- EJECUTAR EN SUPABASE SQL EDITOR (una sola vez)
-- ============================================================


-- ─── PASO 1: Agregar payment_method a cash_manual_entries ────────────────────
--   (Si ya existe, el IF NOT EXISTS evita error)

ALTER TABLE cash_manual_entries
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash', 'yape', 'plin', 'tarjeta', 'transferencia', 'otro'));

CREATE INDEX IF NOT EXISTS idx_cash_manual_entries_payment_method
  ON cash_manual_entries(payment_method);

COMMENT ON COLUMN cash_manual_entries.payment_method IS
  'Medio de pago del movimiento manual: cash, yape, plin, tarjeta, transferencia, otro';


-- ─── PASO 2: calculate_daily_totals v6 con ingresos/egresos manuales ─────────
--
-- El resultado JSON ahora incluye una clave "manual" con los totales
-- de cash_manual_entries agrupados por payment_method para la sesión del día.
--
-- ESTRUCTURA DE RETORNO:
-- {
--   "pos":    { cash, card, yape, yape_qr, mixed_cash, mixed_card, mixed_yape, credit, total },
--   "lunch":  { cash, card, yape, credit, total },
--   "manual": {
--     "income":  { cash, yape, plin, tarjeta, transferencia, otro, total },
--     "expense": { cash, yape, plin, tarjeta, transferencia, otro, total }
--   }
-- }

CREATE OR REPLACE FUNCTION calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(

    -- ── Ventas POS (kiosco) ───────────────────────────────────────────────────
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
        'plin', COALESCE(SUM(
          CASE WHEN payment_method = 'plin' AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
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
        AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL)
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
          CASE WHEN payment_method = 'yape' THEN ABS(amount) ELSE 0 END
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
        AND (is_deleted = false OR is_deleted IS NULL)
        AND (payment_status IS NULL OR payment_status != 'cancelled')
        AND metadata IS NOT NULL
        AND metadata->>'lunch_order_id' IS NOT NULL
    ),

    -- ── Ingresos y egresos manuales (NUEVO en v6) ─────────────────────────────
    -- Lee de cash_manual_entries de la sesión del día para esta sede,
    -- agrupando por payment_method. Así el dashboard puede mostrar
    -- "Total Efectivo = POS + Manuales en efectivo".
    'manual', (
      SELECT json_build_object(

        -- Ingresos manuales por medio de pago
        'income', (
          SELECT json_build_object(
            'cash',          COALESCE(SUM(CASE WHEN payment_method = 'cash'          THEN amount ELSE 0 END), 0),
            'yape',          COALESCE(SUM(CASE WHEN payment_method = 'yape'          THEN amount ELSE 0 END), 0),
            'plin',          COALESCE(SUM(CASE WHEN payment_method = 'plin'          THEN amount ELSE 0 END), 0),
            'tarjeta',       COALESCE(SUM(CASE WHEN payment_method = 'tarjeta'       THEN amount ELSE 0 END), 0),
            'transferencia', COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN amount ELSE 0 END), 0),
            'otro',          COALESCE(SUM(CASE WHEN payment_method = 'otro'          THEN amount ELSE 0 END), 0),
            'total',         COALESCE(SUM(amount), 0)
          )
          FROM cash_manual_entries cme
          INNER JOIN cash_sessions cs ON cs.id = cme.cash_session_id
          WHERE cs.school_id = p_school_id
            AND cs.session_date = p_date
            AND cme.entry_type = 'income'
        ),

        -- Egresos manuales por medio de pago
        'expense', (
          SELECT json_build_object(
            'cash',          COALESCE(SUM(CASE WHEN payment_method = 'cash'          THEN amount ELSE 0 END), 0),
            'yape',          COALESCE(SUM(CASE WHEN payment_method = 'yape'          THEN amount ELSE 0 END), 0),
            'plin',          COALESCE(SUM(CASE WHEN payment_method = 'plin'          THEN amount ELSE 0 END), 0),
            'tarjeta',       COALESCE(SUM(CASE WHEN payment_method = 'tarjeta'       THEN amount ELSE 0 END), 0),
            'transferencia', COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN amount ELSE 0 END), 0),
            'otro',          COALESCE(SUM(CASE WHEN payment_method = 'otro'          THEN amount ELSE 0 END), 0),
            'total',         COALESCE(SUM(amount), 0)
          )
          FROM cash_manual_entries cme
          INNER JOIN cash_sessions cs ON cs.id = cme.cash_session_id
          WHERE cs.school_id = p_school_id
            AND cs.session_date = p_date
            AND cme.entry_type = 'expense'
        )
      )
    )

  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION calculate_daily_totals IS
  'V6: Igual que V5 (timezone Lima) pero agrega sección "manual" con ingresos y egresos
   de cash_manual_entries desglosados por payment_method. También agrega plin y transferencia
   en la sección POS que faltaban en V5.';


-- ─── VERIFICACIÓN ─────────────────────────────────────────────────────────────
--   Ejecuta esto para confirmar que la función responde:
SELECT
  'V6 instalada correctamente' AS status,
  jsonb_pretty(
    calculate_daily_totals(
      (SELECT id FROM schools LIMIT 1),
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date
    )::jsonb
  ) AS resultado_muestra;
