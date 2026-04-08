-- ============================================================
-- RPC: get_billing_payment_stats
-- ============================================================
-- PROPÓSITO:
--   Sustituye los cálculos de suma/conteo que PaymentStatistics.tsx
--   hacía en JavaScript (forEach + parseFloat + +=), que producían
--   errores de punto flotante IEEE 754 (ej. 0.1 + 0.2 ≠ 0.3).
--
-- GARANTÍAS CONTABLES:
--   - Todo monto usa ROUND(..., 2) antes de salir al cliente.
--   - Los montos se almacenan y suman como NUMERIC (no float8),
--     que es exacto hasta el número de decimales configurado.
--   - Un solo round-trip: stats + últimas 10 transacciones.
--
-- SEGURIDAD:
--   - Valida auth.uid() antes de devolver datos.
--   - Sin perfil válido → retorna ceros (seguridad por defecto).
-- ============================================================

DROP FUNCTION IF EXISTS get_billing_payment_stats(uuid, integer);

CREATE OR REPLACE FUNCTION get_billing_payment_stats(
  p_school_id uuid    DEFAULT NULL,   -- reservado para futura segmentación por sede
  p_days_ago  integer DEFAULT 7       -- rango: últimos N días desde ahora (UTC)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
  v_since       timestamptz;
  v_stats       jsonb;
  v_recent      jsonb;
BEGIN
  -- ── Bloque de seguridad ──────────────────────────────────────
  v_caller_id := auth.uid();
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'total_amount',    0,
      'total_count',     0,
      'approved_amount', 0,
      'approved_count',  0,
      'pending_amount',  0,
      'pending_count',   0,
      'rejected_amount', 0,
      'rejected_count',  0,
      'recent_transactions', '[]'::jsonb
    );
  END IF;

  -- ── Ventana de tiempo ────────────────────────────────────────
  v_since := NOW() - (p_days_ago || ' days')::interval;

  -- ── Agregados: TODO en SQL, con ROUND(…,2) ──────────────────
  -- Usamos FILTER para cada grupo de estado en un único escaneo
  -- de la tabla, evitando múltiples subqueries.
  SELECT jsonb_build_object(
    'total_amount',
      ROUND(COALESCE(SUM(ABS(amount)), 0), 2),
    'total_count',
      COUNT(*),

    -- Aprobados
    'approved_amount',
      ROUND(COALESCE(SUM(ABS(amount)) FILTER (WHERE status = 'approved'), 0), 2),
    'approved_count',
      COUNT(*) FILTER (WHERE status = 'approved'),

    -- Pendientes / procesando
    'pending_amount',
      ROUND(COALESCE(SUM(ABS(amount)) FILTER (WHERE status IN ('pending', 'processing')), 0), 2),
    'pending_count',
      COUNT(*) FILTER (WHERE status IN ('pending', 'processing')),

    -- Rechazados / cancelados
    'rejected_amount',
      ROUND(COALESCE(SUM(ABS(amount)) FILTER (WHERE status IN ('rejected', 'cancelled')), 0), 2),
    'rejected_count',
      COUNT(*) FILTER (WHERE status IN ('rejected', 'cancelled'))
  )
  INTO v_stats
  FROM payment_transactions
  WHERE created_at >= v_since;

  -- ── Últimas 10 transacciones (incluidas en el mismo response) ─
  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY (row_data->>'created_at') DESC),
    '[]'::jsonb
  )
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'id',             id::text,
      'amount',         ROUND(ABS(amount), 2),
      'status',         status,
      'payment_gateway',payment_gateway,
      'payment_method', payment_method,
      'created_at',     created_at
    ) AS row_data
    FROM payment_transactions
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  -- ── Resultado final: stats + recientes en un solo objeto ─────
  RETURN v_stats || jsonb_build_object('recent_transactions', v_recent);
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_payment_stats(uuid, integer)
  TO authenticated, service_role;


-- ── Verificación ────────────────────────────────────────────────
SELECT '✅ get_billing_payment_stats creado correctamente' AS resultado;
