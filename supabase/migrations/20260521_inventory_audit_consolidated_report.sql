-- ============================================================
-- Extensión: get_inventory_movement_report
-- Agrega vista consolidada por producto + precio (GROUP BY en DB).
-- Sin cambios en filtros ni fuentes del reporte detallado.
-- ============================================================

CREATE OR REPLACE FUNCTION get_inventory_movement_report(
  p_school_id  UUID,
  p_date       DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz_start     TIMESTAMPTZ := (p_date::timestamp AT TIME ZONE 'America/Lima');
  v_tz_end       TIMESTAMPTZ := ((p_date + 1)::timestamp AT TIME ZONE 'America/Lima');
  v_movimientos  JSONB;
  v_consolidado  JSONB;
  v_resumen      JSONB;
  v_total_participacion NUMERIC;
BEGIN
  IF p_school_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: p_school_id y p_date son obligatorios';
  END IF;

  -- 1. Detalle línea a línea (sin cambios)
  SELECT jsonb_agg(
    jsonb_build_object(
      'hora_exacta',     TO_CHAR(timezone('America/Lima', t.created_at), 'HH24:MI:SS'),
      'ticket_id',       t.id,
      'ticket_code',     COALESCE(t.ticket_code, '—'),
      'categoria',       CASE
                           WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'Almuerzo'
                           ELSE 'POS / Kiosco'
                         END,
      'producto',        COALESCE(ti.product_name, '(Producto sin nombre)'),
      'vendedor',        COALESCE(pr.full_name, pr.email, 'Sistema'),
      'precio_unitario', ROUND(ti.unit_price::numeric, 2),
      'cantidad',        ti.quantity::integer,
      'monto_linea',     ROUND(ti.subtotal::numeric, 2)
    )
    ORDER BY t.created_at ASC, ti.id ASC
  )
  INTO v_movimientos
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
  LEFT JOIN profiles pr ON pr.id = t.created_by
  WHERE
    t.school_id = p_school_id
    AND t.is_deleted = false
    AND t.payment_status <> 'cancelled'
    AND t.type IN ('purchase', 'sale')
    AND t.created_at >= v_tz_start
    AND t.created_at < v_tz_end;

  -- 2. Resumen global (sin cambios)
  SELECT jsonb_build_object(
    'total_unidades', COALESCE(SUM(ti.quantity)::integer, 0),
    'valor_total',    COALESCE(ROUND(SUM(ti.subtotal)::numeric, 2), 0),
    'total_tickets',  COALESCE(COUNT(DISTINCT t.id)::integer, 0),
    'participacion_total_pct', 0
  )
  INTO v_resumen
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
  WHERE
    t.school_id = p_school_id
    AND t.is_deleted = false
    AND t.payment_status <> 'cancelled'
    AND t.type IN ('purchase', 'sale')
    AND t.created_at >= v_tz_start
    AND t.created_at < v_tz_end;

  -- 3. Consolidado por producto + precio unitario (nuevo)
  WITH lineas AS (
    SELECT
      COALESCE(ti.product_name, '(Producto sin nombre)') AS producto,
      SUM(ti.quantity)::integer                          AS cantidad_total,
      ROUND(SUM(ti.subtotal)::numeric, 2)                AS total_recaudado
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    WHERE
      t.school_id = p_school_id
      AND t.is_deleted = false
      AND t.payment_status <> 'cancelled'
      AND t.type IN ('purchase', 'sale')
      AND t.created_at >= v_tz_start
      AND t.created_at < v_tz_end
    GROUP BY COALESCE(ti.product_name, '(Producto sin nombre)')
  ),
  totales AS (
    SELECT COALESCE(SUM(total_recaudado), 0)::numeric AS valor_total
    FROM lineas
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'producto',          l.producto,
      'cantidad_total',    l.cantidad_total,
      'total_recaudado',   l.total_recaudado
    )
    ORDER BY l.cantidad_total DESC, l.total_recaudado DESC, l.producto ASC
  ), '[]'::jsonb)
  INTO v_consolidado
  FROM lineas l
  CROSS JOIN totales tot;

  SELECT COALESCE(ROUND(SUM((elem->>'participacion_pct')::numeric), 2), 0)
  INTO v_total_participacion
  FROM jsonb_array_elements(v_consolidado) AS elem;

  v_resumen := v_resumen || jsonb_build_object(
    'participacion_total_pct',
    CASE
      WHEN (v_resumen->>'valor_total')::numeric > 0 THEN v_total_participacion
      ELSE 0
    END
  );

  RETURN jsonb_build_object(
    'fecha',        p_date,
    'generado_en',  TO_CHAR(timezone('America/Lima', NOW()), 'YYYY-MM-DD HH24:MI:SS'),
    'timezone',     'America/Lima',
    'movimientos',  COALESCE(v_movimientos, '[]'::jsonb),
    'consolidado',  COALESCE(v_consolidado, '[]'::jsonb),
    'resumen',      v_resumen
  );
END;
$$;

COMMENT ON FUNCTION get_inventory_movement_report(uuid, date) IS
  'Auditoría de inventario diario: detalle cronológico, consolidado por producto/precio '
  'y resumen (unidades, valor, tickets). Cálculos 100% en PostgreSQL.';
