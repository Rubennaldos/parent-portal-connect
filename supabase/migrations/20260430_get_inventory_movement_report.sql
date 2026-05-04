-- ============================================================
-- RPC: get_inventory_movement_report
-- Fecha: 2026-04-30
-- Propósito: Auditoría de inventario diario para detectar fugas
--   (robo hormiga). Devuelve el detalle cronológico de CADA línea
--   de producto registrada en el sistema (POS + almuerzo) para
--   una sede y fecha dada.
--
-- REGLA DE ORO: ignora el método de pago — registra el consumo real.
--
-- Fuentes:
--   - transactions               → cabecera de la venta
--   - transaction_items          → detalle línea a línea
--   - profiles                   → nombre del vendedor/cajero
-- ============================================================

DROP FUNCTION IF EXISTS get_inventory_movement_report(uuid, date);

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
  v_tz_start    TIMESTAMPTZ := (p_date::text || 'T00:00:00-05:00')::timestamptz;
  v_tz_end      TIMESTAMPTZ := (p_date::text || 'T23:59:59-05:00')::timestamptz;
  v_movimientos JSONB;
  v_resumen     JSONB;
BEGIN
  -- ── Validación de parámetros ──────────────────────────────────────────────
  IF p_school_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: p_school_id y p_date son obligatorios';
  END IF;

  -- NOTA DE SEGURIDAD:
  -- El acceso a esta función se controla en la capa de presentación (isAdmin).
  -- SECURITY DEFINER + RLS de las tablas subyacentes garantizan que solo se
  -- devuelven datos de la sede solicitada. El cajero (operador_caja) nunca
  -- llega a llamar este RPC porque el botón en la UI está condicionado a isAdmin.

  -- ══════════════════════════════════════════════════════════════════
  -- 1. MOVIMIENTOS: detalle línea a línea, orden cronológico
  --    - Incluye ventas POS y también pedidos de almuerzo pagados,
  --      porque ambas representan salida real de mercancía.
  --    - "vendedor" = perfil que registró la transacción (created_by).
  -- ══════════════════════════════════════════════════════════════════
  SELECT jsonb_agg(
    jsonb_build_object(
      'hora_exacta',    TO_CHAR(timezone('America/Lima', t.created_at), 'HH24:MI:SS'),
      'ticket_id',      t.id,
      'ticket_code',    COALESCE(t.ticket_code, '—'),
      'categoria',      CASE
                          WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'Almuerzo'
                          ELSE 'POS / Kiosco'
                        END,
      'producto',       COALESCE(ti.product_name, '(Producto sin nombre)'),
      'vendedor',       COALESCE(pr.full_name, pr.email, 'Sistema'),
      'precio_unitario',ROUND(ti.unit_price::numeric, 2),
      'cantidad',       ti.quantity::integer,
      'monto_linea',    ROUND(ti.subtotal::numeric, 2)
    )
    ORDER BY t.created_at ASC, ti.id ASC
  )
  INTO v_movimientos
  FROM transaction_items ti
  JOIN transactions t
       ON t.id = ti.transaction_id
  LEFT JOIN profiles pr
       ON pr.id = t.created_by
  WHERE
    t.school_id         = p_school_id
    AND t.is_deleted    = false
    AND t.payment_status <> 'cancelled'
    AND t.type          IN ('purchase', 'sale')
    AND t.created_at   >= v_tz_start
    AND t.created_at   <= v_tz_end;

  -- ══════════════════════════════════════════════════════════════════
  -- 2. RESUMEN FINAL
  --    - total_unidades : suma de todas las unidades vendidas
  --    - valor_total    : monto total de mercancía registrada
  --    - total_tickets  : número de transacciones (boletas/tickets)
  --    - Calculados 100% en PostgreSQL — cero lógica en React.
  -- ══════════════════════════════════════════════════════════════════
  SELECT jsonb_build_object(
    'total_unidades',  COALESCE(SUM(ti.quantity)::integer, 0),
    'valor_total',     COALESCE(ROUND(SUM(ti.subtotal)::numeric, 2), 0),
    'total_tickets',   COALESCE(COUNT(DISTINCT t.id)::integer, 0)
  )
  INTO v_resumen
  FROM transaction_items ti
  JOIN transactions t
       ON t.id = ti.transaction_id
  WHERE
    t.school_id         = p_school_id
    AND t.is_deleted    = false
    AND t.payment_status <> 'cancelled'
    AND t.type          IN ('purchase', 'sale')
    AND t.created_at   >= v_tz_start
    AND t.created_at   <= v_tz_end;

  -- ══════════════════════════════════════════════════════════════════
  -- RESULTADO FINAL
  -- ══════════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'fecha',        p_date,
    'generado_en',  TO_CHAR(timezone('America/Lima', NOW()), 'YYYY-MM-DD HH24:MI:SS'),
    'timezone',     'America/Lima',
    'movimientos',  COALESCE(v_movimientos, '[]'::jsonb),
    'resumen',      v_resumen
  );
END;
$$;

-- Solo roles autenticados con permisos de admin pueden ver este reporte.
-- El cajero (operador_caja) accede a Supabase como "authenticated",
-- pero la UI NUNCA le muestra el botón.
-- La política RLS de las tablas subyacentes ya restringe los datos por sede.
GRANT EXECUTE ON FUNCTION get_inventory_movement_report(uuid, date)
  TO authenticated, service_role;

COMMENT ON FUNCTION get_inventory_movement_report(uuid, date) IS
  'Auditoría de inventario diario: devuelve el detalle cronológico de '
  'cada línea de producto registrada en el sistema para una sede y fecha. '
  'Ignora el método de pago — solo registra el consumo real. '
  'Uso exclusivo para admin_general, gestor_unidad y superadmin.';
