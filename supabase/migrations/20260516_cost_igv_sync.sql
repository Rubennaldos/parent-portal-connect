-- ============================================================
-- COST IGV SYNC — Unificación de la Verdad del Costo
-- ============================================================
-- Objetivo:
--   1) Nuevo parámetro p_prices_include_igv BOOLEAN DEFAULT FALSE.
--   2) Si TRUE: el neto se calcula dividiendo entre la tasa IGV de billing_config
--      (fallback 18%). La matemática vive 100% en DB, nunca en React.
--   3) unit_cost neto se persiste en inventory_transaction_items y product_cost_history.
--   4) Al final de cada producto: UPDATE products.price_cost = neto  (sinc automática).
--   5) UPDATE product_school_prices.price_cost = neto en todas las filas existentes
--      para ese producto (no crea filas nuevas, solo actualiza las que hay).
--
-- Alcance: reemplaza process_ingress_bulk (versión Fase 3 / warehouse real).
-- No toca pasarela de pagos, saldos de alumnos ni transacciones financieras.
-- ============================================================

-- ── 1) Leer tasa IGV global (helper interno) ────────────────────────────────
-- Tomamos el valor máximo no-nulo de billing_config como referencia standard
-- (en Perú: 18%). Si una sede usa tasa reducida MYPE (10.5%), ese ajuste se
-- aplica a su facturación de ventas, pero el costo de compra referencia la tasa
-- del proveedor, que es siempre 18% en el régimen general.
-- Para mayor control el admin puede ajustar igv_porcentaje en billing_config.

CREATE OR REPLACE FUNCTION fn_get_global_igv_divisor()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct numeric;
BEGIN
  SELECT COALESCE(MAX(igv_porcentaje), 18)
  INTO   v_pct
  FROM   billing_config
  WHERE  igv_porcentaje IS NOT NULL
    AND  igv_porcentaje > 0;

  RETURN 1 + COALESCE(v_pct, 18) / 100;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_global_igv_divisor() TO authenticated, service_role;

SELECT 'OK: fn_get_global_igv_divisor creada' AS resultado;

-- ── 2) Reemplazar process_ingress_bulk (Fase 3 + IGV sync) ─────────────────

DROP FUNCTION IF EXISTS process_ingress_bulk(uuid, text, text, text, text, boolean, uuid, jsonb);

CREATE OR REPLACE FUNCTION process_ingress_bulk(
  p_supplier_id          uuid,
  p_vendor_doc_number    text,
  p_doc_type             text,
  p_evidence_url         text    DEFAULT NULL,
  p_notes                text    DEFAULT NULL,
  p_is_warehouse_only    boolean DEFAULT false,
  p_warehouse_school_id  uuid    DEFAULT NULL,
  p_items                jsonb   DEFAULT '[]'::jsonb,
  p_prices_include_igv   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid;
  v_tx_id            uuid;
  v_internal_id      text;
  v_total_amount     numeric(12,2) := 0;
  v_wh_location_id   uuid;
  v_item             jsonb;
  v_dist             jsonb;
  v_product_id       uuid;
  v_total_qty        integer;
  v_raw_unit_cost    numeric(12,4);   -- lo que llegó del formulario
  v_net_unit_cost    numeric(12,4);   -- siempre sin IGV (base imponible)
  v_igv_divisor      numeric(12,6);   -- e.g. 1.18
  v_sum_dist         integer;
  v_product_name     text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  -- ── Muralla: validaciones de cabecera ────────────────────────────────────

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: supplier_id es obligatorio.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'VALIDATION: El proveedor indicado no existe en el sistema.';
  END IF;

  IF p_doc_type NOT IN ('boleta', 'factura', 'guia') THEN
    RAISE EXCEPTION 'VALIDATION: doc_type debe ser boleta, factura o guia. Recibido: %', p_doc_type;
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debe incluir al menos un producto en el ingreso.';
  END IF;

  -- ── Muralla: anti-duplicado proveedor + documento ─────────────────────────
  IF p_vendor_doc_number IS NOT NULL AND trim(p_vendor_doc_number) <> '' THEN
    IF EXISTS (
      SELECT 1
      FROM inventory_transactions
      WHERE supplier_id       = p_supplier_id
        AND vendor_doc_number = trim(p_vendor_doc_number)
        AND status           <> 'cancelled'
    ) THEN
      RAISE EXCEPTION
        'DUPLICATE_DOC: El documento "%" de este proveedor ya fue registrado y está activo.',
        trim(p_vendor_doc_number);
    END IF;
  END IF;

  -- ── Tasa IGV (si aplica) ─────────────────────────────────────────────────
  IF p_prices_include_igv THEN
    v_igv_divisor := fn_get_global_igv_divisor();
  ELSE
    v_igv_divisor := 1;
  END IF;

  -- ── Almacén central ───────────────────────────────────────────────────────
  IF p_is_warehouse_only THEN
    v_wh_location_id := fn_get_primary_warehouse_location_id();
  END IF;

  -- ── Primera pasada: validaciones de ítems y cálculo de total ─────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id   := (v_item->>'product_id')::uuid;
    v_total_qty    := (v_item->>'total_quantity')::integer;
    v_raw_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_net_unit_cost := ROUND(v_raw_unit_cost / v_igv_divisor, 4);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION: product_id es obligatorio en cada ítem.';
    END IF;

    IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: total_quantity debe ser mayor a 0 para cada producto.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id AND p.active = true) THEN
      SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto "%" no existe o está inactivo.',
        COALESCE(v_product_name, v_product_id::text);
    END IF;

    IF NOT p_is_warehouse_only THEN
      IF jsonb_array_length(COALESCE(v_item->'distribution', '[]'::jsonb)) = 0 THEN
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
        RAISE EXCEPTION 'VALIDATION: El producto "%" no tiene distribución por sede.',
          COALESCE(v_product_name, v_product_id::text);
      END IF;

      SELECT COALESCE(SUM((d->>'quantity')::integer), 0)
      INTO   v_sum_dist
      FROM   jsonb_array_elements(v_item->'distribution') d;

      IF v_sum_dist <> v_total_qty THEN
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
        RAISE EXCEPTION 'DISTRIBUCION_INVALIDA: La suma de sedes (%) ≠ total (%) para "%".',
          v_sum_dist, v_total_qty, COALESCE(v_product_name, v_product_id::text);
      END IF;
    END IF;

    -- total_amount usa el neto (base imponible) × cantidad
    v_total_amount := v_total_amount + v_net_unit_cost * v_total_qty;
  END LOOP;

  -- ── Cabecera del ingreso ──────────────────────────────────────────────────
  SELECT fn_next_ingress_id() INTO v_internal_id;

  INSERT INTO inventory_transactions (
    internal_transaction_id,
    vendor_doc_number,
    doc_type,
    supplier_id,
    is_warehouse_only,
    warehouse_school_id,
    evidence_url,
    total_amount,
    notes,
    status,
    created_by,
    created_at
  ) VALUES (
    v_internal_id,
    NULLIF(trim(COALESCE(p_vendor_doc_number, '')), ''),
    p_doc_type,
    p_supplier_id,
    p_is_warehouse_only,
    NULL,
    NULLIF(trim(COALESCE(p_evidence_url, '')), ''),
    v_total_amount,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'completed',
    v_caller_id,
    clock_timestamp()
  ) RETURNING id INTO v_tx_id;

  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- ── Segunda pasada: persistencia + stock + sync costo maestro ────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id    := (v_item->>'product_id')::uuid;
    v_total_qty     := (v_item->>'total_quantity')::integer;
    v_raw_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_net_unit_cost := ROUND(v_raw_unit_cost / v_igv_divisor, 4);

    -- Detalle del ingreso (siempre neto)
    INSERT INTO inventory_transaction_items (transaction_id, product_id, total_quantity, unit_cost)
    VALUES (v_tx_id, v_product_id, v_total_qty, v_net_unit_cost);

    -- Historial de costos (solo si hay costo > 0)
    IF v_net_unit_cost > 0 THEN
      INSERT INTO product_cost_history (product_id, transaction_id, unit_cost, created_by)
      VALUES (v_product_id, v_tx_id, v_net_unit_cost, v_caller_id);

      -- ── Sincronización atómica con Maestro de Productos ──────────────────
      -- Actualiza el precio costo base del producto (lo que usa el POS y la
      -- alerta de "venta bajo costo"). Si el ingreso tiene IGV, aquí ya está
      -- el neto. Si no tiene IGV, el neto = valor ingresado.
      UPDATE products
      SET    price_cost = v_net_unit_cost
      WHERE  id = v_product_id;

      -- Actualiza también los precios por sede que ya existen (no crea filas nuevas).
      -- Así las sedes que tienen precio personalizado también ven el costo actualizado.
      UPDATE product_school_prices
      SET    price_cost = v_net_unit_cost
      WHERE  product_id = v_product_id;
    END IF;

    -- Stock: almacén central o distribución por sede
    IF p_is_warehouse_only THEN
      PERFORM fn_increment_location_stock(
        v_product_id,
        v_wh_location_id,
        v_total_qty,
        v_tx_id,
        format('Ingreso %s — %s %s → Almacén Central',
          v_internal_id, p_doc_type, COALESCE(p_vendor_doc_number, '')),
        'ingress'
      );
    ELSE
      FOR v_dist IN SELECT value FROM jsonb_array_elements(v_item->'distribution') AS value
      LOOP
        PERFORM increment_product_stock(
          v_product_id,
          (v_dist->>'school_id')::uuid,
          (v_dist->>'quantity')::integer,
          v_tx_id,
          format('Ingreso %s — %s %s → distribución multisede',
            v_internal_id, p_doc_type, COALESCE(p_vendor_doc_number, '')),
          NULL
        );
      END LOOP;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'ok',                       true,
    'transaction_id',           v_tx_id,
    'internal_transaction_id',  v_internal_id,
    'total_amount',             v_total_amount,
    'prices_include_igv',       p_prices_include_igv,
    'igv_divisor_used',         v_igv_divisor
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_ingress_bulk(uuid, text, text, text, text, boolean, uuid, jsonb, boolean)
  TO authenticated, service_role;

SELECT 'OK: process_ingress_bulk actualizado — IGV sync + Maestro de Costos' AS resultado;
