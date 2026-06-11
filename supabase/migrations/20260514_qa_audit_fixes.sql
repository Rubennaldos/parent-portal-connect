-- ============================================================
-- QA AUDIT — Correcciones de seguridad post-revisión
-- ============================================================
-- Punto 2: Conversión Caja→Unidades en la BD, no en el navegador
-- Punto 4: Índice de rendimiento en pos_stock_movements.created_at
-- ============================================================

-- ── Punto 4: índice de rendimiento ──────────────────────────────────────────
-- Los índices compuestos existentes cubren consultas con school_id.
-- Este índice simple cubre el caso GLOBAL (p_school_id = NULL en el reporte
-- de la contadora), donde PostgreSQL necesita escanear solo por fecha.

CREATE INDEX IF NOT EXISTS idx_psm_created_at
  ON pos_stock_movements (created_at DESC);

COMMENT ON INDEX idx_psm_created_at IS
  'Reporte global por rango de fecha sin filtro de sede (report_kardex_movements).';

-- Índice adicional para filtrar por tipo de movimiento sin sede específica
CREATE INDEX IF NOT EXISTS idx_psm_movement_type_date
  ON pos_stock_movements (movement_type, created_at DESC);

SELECT 'OK: índices de rendimiento pos_stock_movements creados' AS resultado;

-- ── Punto 2: increment_product_stock con conversión UoM en la BD ─────────────
-- Si el usuario registra "2 Cajas de 30 unidades", el navegador NO multiplica:
-- solo envía p_quantity=2 y p_uom_id=<id_caja>. La BD lee conversion_factor=30
-- y calcula 2×30=60, sumando 60 unidades al stock.
-- El Kardex registra la conversión en el campo reason para auditoría completa.

DROP FUNCTION IF EXISTS increment_product_stock(uuid, uuid, integer, uuid, text);

CREATE OR REPLACE FUNCTION increment_product_stock(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,           -- cantidad en la unidad de empaque (o base si p_uom_id es NULL)
  p_entry_id   uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_uom_id     uuid DEFAULT NULL  -- si se especifica, la BD convierte a unidad base
)
RETURNS jsonb   -- devuelve { base_qty, uom_name, factor } para que el frontend confirme
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_before integer := 0;
  v_stock_after  integer;
  v_factor       integer := 1;
  v_uom_name     text;
  v_base_qty     integer;
  v_audit_reason text;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INCREMENT_STOCK: la cantidad debe ser mayor a 0';
  END IF;

  -- ── Resolución de UoM: conversión ocurre aquí, en la BD ──────────────────
  IF p_uom_id IS NOT NULL THEN
    SELECT conversion_factor, uom_name
    INTO   v_factor, v_uom_name
    FROM   product_packaging
    WHERE  id = p_uom_id
      AND  product_id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'UOM_NOT_FOUND: El empaque no existe o no pertenece a este producto';
    END IF;

    IF v_factor <= 0 THEN
      RAISE EXCEPTION
        'UOM_INVALID: El factor de conversión debe ser mayor a 0. Revisa la configuración del empaque.';
    END IF;
  END IF;

  v_base_qty := p_quantity * COALESCE(v_factor, 1);

  -- Construir reason con trazabilidad de conversión
  v_audit_reason := CASE
    WHEN p_uom_id IS NOT NULL THEN
      COALESCE(p_reason, 'Entrada de compra') ||
      format(' [Conversión: %s %s × %s un./unid. = %s unidades base]',
        p_quantity, v_uom_name, v_factor, v_base_qty)
    ELSE
      COALESCE(p_reason, 'Entrada de compra registrada desde logística')
  END;

  -- ── Stock antes del cambio ──────────────────────────────────────────────
  SELECT COALESCE(current_stock, 0)
  INTO   v_stock_before
  FROM   product_stock
  WHERE  product_id = p_product_id
    AND  school_id  = p_school_id;

  -- ── Suprimir trigger genérico ────────────────────────────────────────────
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- ── Upsert con cantidad ya convertida a unidades base ────────────────────
  INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
  VALUES (p_product_id, p_school_id, v_base_qty, true, clock_timestamp())
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + v_base_qty,
    last_updated  = clock_timestamp();

  -- ── Stock final real (leído de la BD) ────────────────────────────────────
  SELECT current_stock
  INTO   v_stock_after
  FROM   product_stock
  WHERE  product_id = p_product_id
    AND  school_id  = p_school_id;

  -- ── Kardex: entrada_compra con conversión documentada ───────────────────
  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    p_product_id, p_school_id,
    'entrada_compra',
    v_base_qty,              -- siempre en unidades base
    v_stock_before, v_stock_after,
    p_entry_id, auth.uid(),
    clock_timestamp(),
    v_audit_reason
  );

  -- Devolver resultado para confirmación en el frontend
  RETURN jsonb_build_object(
    'ok',       true,
    'base_qty', v_base_qty,
    'factor',   COALESCE(v_factor, 1),
    'uom_name', COALESCE(v_uom_name, 'unidad')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION increment_product_stock(uuid, uuid, integer, uuid, text, uuid)
  TO authenticated, service_role;

SELECT 'OK: increment_product_stock con conversión UoM en BD y retorno de confirmación' AS resultado;
