-- ============================================================
-- calculate_daily_totals v7 — FILTRO ESTRICTO source='pos'
-- ============================================================
--
-- PROBLEMA RESUELTO:
--   La v6 sumaba TODAS las transactions con type='purchase' sin lunch_order_id,
--   lo que incluía cobros de la pantalla de Cobranzas y pagos de vouchers de padres.
--   Eso inflaba el "Balance Sistema" de las cajeras con dinero que ellas nunca cobraron.
--
-- SOLUCIÓN:
--   La sección "pos" ahora exige metadata->>'source' = 'pos'.
--   Solo las ventas hechas desde el POS físico tienen ese tag.
--
-- QUIÉN TIENE source='pos':
--   ✅ POS - Compra de alumno     (POS.tsx línea 1616)
--   ✅ POS - Compra de cliente    (POS.tsx línea 1819)
--   ✅ POS - Compra de profesor   (POS.tsx línea 1754 — agregado en v7)
--
-- QUIÉN NO TIENE source='pos' (y queda excluido del cálculo):
--   ❌ Cobro de admin (BillingCollection)   → source ausente o 'billing_collection'
--   ❌ Voucher de padre aprobado            → source='voucher_recharge' o ausente
--   ❌ Transacciones de almuerzo            → tienen lunch_order_id (sección lunch)
--
-- BACKFILL (al final de este archivo):
--   UPDATE para etiquetar transacciones POS de hoy que no tienen source todavía.
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(

    -- ── Ventas POS físico (kiosco) ─────────────────────────────────────────────
    -- SOLO transacciones con metadata->>'source' = 'pos'
    -- Esto excluye cobros de Cobranzas, pagos de vouchers de padres, etc.
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
        AND metadata->>'source' = 'pos'         -- ★ FILTRO NUEVO: solo ventas físicas de POS
    ),

    -- ── Pagos de almuerzo ─────────────────────────────────────────────────────
    -- Sin cambios respecto a v6. Los almuerzos se identifican por lunch_order_id.
    -- Los pagos de almuerzo cobrados en físico también tendrán source='billing_collection',
    -- pero siguen siendo de almuerzo, así que van aquí.
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
        'plin', COALESCE(SUM(
          CASE WHEN payment_method = 'plin' THEN ABS(amount) ELSE 0 END
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
        AND (is_deleted = false OR is_deleted IS NULL)
        AND (payment_status IS NULL OR payment_status != 'cancelled')
        AND metadata IS NOT NULL
        AND metadata->>'lunch_order_id' IS NOT NULL
    ),

    -- ── Ingresos y egresos manuales (igual que v6) ────────────────────────────
    'manual', (
      SELECT json_build_object(
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
  'V7: Igual que V6 pero la sección "pos" ahora filtra ESTRICTAMENTE por metadata->>source = ''pos''.
   Esto excluye cobros de Cobranzas/admin y pagos de vouchers de padres que antes inflaban el Balance Sistema.
   Requiere que las ventas del POS incluyan metadata: { source: ''pos'' } (ya presente en POS.tsx desde siempre,
   y agregado para compras de profesores en el mismo commit de esta migración).';


-- ============================================================
-- BACKFILL: Etiquetar transacciones POS sin source (datos históricos)
-- ============================================================
--
-- CRITERIO PARA IDENTIFICAR VENTAS POS HISTÓRICAS:
--   - type = 'purchase'
--   - sin lunch_order_id en metadata (no son almuerzos)
--   - sin source en metadata (no están etiquetadas aún)
--   - payment_status != 'cancelled'
--   - metadata NO tiene 'voucher_recharge' ni 'billing_collection' (no son pagos admin)
--
-- SEGURO: Solo afecta transacciones que no tienen source todavía.
-- Si hay dudas, ejecutar primero el SELECT de verificación.
-- ============================================================

-- PASO 1: Ver cuántas transacciones históricas se van a etiquetar (solo diagnóstico)
SELECT
  COUNT(*) AS tx_sin_source,
  MIN(DATE(created_at AT TIME ZONE 'America/Lima')) AS fecha_mas_antigua,
  MAX(DATE(created_at AT TIME ZONE 'America/Lima')) AS fecha_mas_reciente
FROM transactions
WHERE type = 'purchase'
  AND (is_deleted = false OR is_deleted IS NULL)
  AND (payment_status IS NULL OR payment_status != 'cancelled')
  AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL)
  AND (metadata IS NULL OR metadata->>'source' IS NULL)
  AND (metadata IS NULL OR metadata->>'voucher_url' IS NULL);

-- PASO 2: Aplicar el backfill (ejecutar después de revisar PASO 1)
-- UPDATE transactions
-- SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"source": "pos"}'::jsonb
-- WHERE type = 'purchase'
--   AND (is_deleted = false OR is_deleted IS NULL)
--   AND (payment_status IS NULL OR payment_status != 'cancelled')
--   AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL)
--   AND (metadata IS NULL OR metadata->>'source' IS NULL)
--   AND (metadata IS NULL OR metadata->>'voucher_url' IS NULL);
