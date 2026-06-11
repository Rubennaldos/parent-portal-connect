-- ============================================================
-- Suministro sede: sin monto declarado por sede — aprobación por costos de línea
-- Archivo: 20260604_branch_supply_auditor_cost_only.sql
--
-- Modelo:
--   • La sede NO declara total (declared_total = 0 al enviar).
--   • El Admin General ingresa costos unitarios y aprueba.
--   • El total oficial = SUM(cantidad × costo) en SQL al aprobar.
--   • Legacy: comprobantes con declared_total > 0 siguen cotejando como antes.
--
-- RPCs tocados:
--   1. submit_branch_supply_receipt
--   2. preview_branch_supply_totals
--   3. approve_branch_supply_receipt (v2)
-- ============================================================

BEGIN;

-- ── 1. submit_branch_supply_receipt ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.submit_branch_supply_receipt(uuid,uuid,text,text,numeric,boolean,text,text,jsonb,uuid);

CREATE OR REPLACE FUNCTION public.submit_branch_supply_receipt(
  p_school_id           uuid,
  p_supplier_id         uuid,
  p_doc_type            text,
  p_doc_number          text,
  p_declared_total      numeric,
  p_prices_include_igv  boolean,
  p_notes               text,
  p_evidence_path       text,
  p_items               jsonb,
  p_replaces_receipt_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_receipt_id     uuid;
  v_receipt_number text;
  v_lines_sum      numeric := 0;
  v_delta          numeric;
  v_matched        boolean;
  v_declared       numeric;
  v_item           jsonb;
  v_product_id     uuid;
  v_quantity       integer;
  v_unit_cost      numeric;
  v_uom_id         uuid;
  v_sort_order     smallint := 0;
  v_legacy_total   boolean;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para registrar un comprobante.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: school_id es obligatorio.';
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND school_id = p_school_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND role IN ('admin_general','superadmin'))
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo puedes registrar comprobantes para tu propia sede.';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_REQUIRED: Debes seleccionar un proveedor.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND: El proveedor seleccionado no existe en el sistema.';
  END IF;

  IF p_doc_type NOT IN ('boleta','factura','guia','nota_venta') THEN
    RAISE EXCEPTION 'VALIDATION: Tipo de comprobante inválido: %.', p_doc_type;
  END IF;

  IF p_declared_total IS NULL OR p_declared_total < 0 THEN
    RAISE EXCEPTION 'VALIDATION: El monto declarado debe ser >= 0.';
  END IF;

  v_declared     := ROUND(COALESCE(p_declared_total, 0), 2);
  v_legacy_total := v_declared > 0;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes incluir al menos un producto en el comprobante.';
  END IF;

  IF p_replaces_receipt_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_supply_receipts
      WHERE id = p_replaces_receipt_id
        AND status = 'rejected'
        AND school_id = p_school_id
    ) THEN
      RAISE EXCEPTION 'CORRECTION_INVALID: El comprobante a corregir no existe o no está rechazado.';
    END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_uom_id     := NULLIF(trim(COALESCE(v_item->>'uom_id', '')), '')::uuid;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION: Todos los ítems deben tener un producto seleccionado.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id AND active = true) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto % no existe o está inactivo.', v_product_id;
    END IF;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: La cantidad de cada ítem debe ser mayor a 0.';
    END IF;

    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'VALIDATION: El costo unitario no puede ser negativo.';
    END IF;

    IF v_uom_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM product_packaging
        WHERE id = v_uom_id AND product_id = v_product_id
      ) THEN
        RAISE EXCEPTION 'UOM_INVALID: El empaque no pertenece al producto.';
      END IF;
    END IF;

    v_lines_sum := v_lines_sum + (v_quantity * v_unit_cost);
  END LOOP;

  v_lines_sum := ROUND(v_lines_sum, 2);

  IF v_legacy_total THEN
    v_delta   := ABS(v_lines_sum - v_declared);
    v_matched := v_delta = 0;
  ELSE
    v_delta   := 0;
    v_matched := false;
  END IF;

  SELECT fn_next_branch_supply_id() INTO v_receipt_number;

  INSERT INTO branch_supply_receipts (
    receipt_number,
    school_id,          supplier_id,       submitted_by,
    doc_type,           doc_number,        declared_total,
    prices_include_igv, notes,             evidence_path,
    match_score,        status,            replaces_receipt_id,
    submitted_at,       updated_at
  )
  VALUES (
    v_receipt_number,
    p_school_id,        p_supplier_id,     v_caller_id,
    p_doc_type,
    NULLIF(trim(COALESCE(p_doc_number, '')), ''),
    v_declared,
    COALESCE(p_prices_include_igv, false),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    NULLIF(trim(COALESCE(p_evidence_path, '')), ''),
    CASE
      WHEN v_legacy_total THEN
        jsonb_build_object(
          'lines_sum',      v_lines_sum,
          'declared_total', v_declared,
          'matched',        v_matched,
          'delta_cents',    ROUND(v_delta * 100, 2),
          'phase',          'legacy_sede_declared_total'
        )
      ELSE
        jsonb_build_object(
          'lines_sum',      v_lines_sum,
          'declared_total', 0,
          'matched',        false,
          'delta_cents',    0,
          'phase',          'awaiting_auditor_costs'
        )
    END,
    'pending',
    p_replaces_receipt_id,
    clock_timestamp(),  clock_timestamp()
  )
  RETURNING id INTO v_receipt_id;

  v_sort_order := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_uom_id     := NULLIF(trim(COALESCE(v_item->>'uom_id', '')), '')::uuid;

    INSERT INTO branch_supply_receipt_items (
      receipt_id, product_id, quantity, unit_cost, uom_id, sort_order
    )
    VALUES (v_receipt_id, v_product_id, v_quantity, v_unit_cost, v_uom_id, v_sort_order);

    v_sort_order := v_sort_order + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     v_receipt_id,
    'receipt_number', v_receipt_number,
    'lines_sum',      v_lines_sum,
    'declared_total', v_declared,
    'matched',        v_matched,
    'delta_cents',    ROUND(v_delta * 100, 2),
    'warning', CASE
      WHEN v_legacy_total AND NOT v_matched THEN
        format(
          'DESCALCE_FINANCIERO: Suma de ítems S/ %s ≠ total declarado S/ %s. Diferencia: S/ %s.',
          v_lines_sum, v_declared, ROUND(v_delta, 2)
        )
      WHEN NULLIF(trim(COALESCE(p_evidence_path, '')), '') IS NULL THEN
        'SIN_EVIDENCIA: No adjuntaste foto o PDF. El Administrador General lo verá al auditar.'
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_branch_supply_receipt(uuid,uuid,text,text,numeric,boolean,text,text,jsonb,uuid)
  TO authenticated;

-- ── 2. preview_branch_supply_totals ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.preview_branch_supply_totals(numeric, jsonb);

CREATE OR REPLACE FUNCTION public.preview_branch_supply_totals(
  p_declared_total numeric,
  p_items          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines_sum      numeric := 0;
  v_item           jsonb;
  v_unit_cost      numeric;
  v_delta          numeric;
  v_declared       numeric;
  v_legacy_total   boolean;
  v_item_count     integer := 0;
  v_all_costed     boolean := true;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS value
  LOOP
    v_item_count := v_item_count + 1;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);

    IF v_unit_cost < 0 THEN
      v_all_costed := false;
    END IF;

    v_lines_sum := v_lines_sum
      + GREATEST(COALESCE((v_item->>'quantity')::integer, 0), 0)
        * GREATEST(v_unit_cost, 0);
  END LOOP;

  v_lines_sum    := ROUND(v_lines_sum, 2);
  v_declared     := ROUND(COALESCE(p_declared_total, 0), 2);
  v_legacy_total := v_declared > 0;

  IF v_legacy_total THEN
    v_delta := ABS(v_lines_sum - v_declared);
    RETURN jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', v_declared,
      'matched',        v_delta = 0,
      'delta_cents',    ROUND(v_delta * 100, 2),
      'phase',          'legacy_sede_declared_total'
    );
  END IF;

  RETURN jsonb_build_object(
    'lines_sum',      v_lines_sum,
    'declared_total', v_lines_sum,
    'matched',        v_item_count > 0 AND v_all_costed AND v_lines_sum > 0,
    'delta_cents',    0,
    'phase',          'auditor_line_costs'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_branch_supply_totals(numeric, jsonb)
  TO authenticated;

-- ── 3. approve_branch_supply_receipt (v2) ─────────────────────────────────────

DROP FUNCTION IF EXISTS public.approve_branch_supply_receipt(uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.approve_branch_supply_receipt(
  p_receipt_id         uuid,
  p_cost_items         jsonb,
  p_prices_include_igv boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       uuid;
  v_receipt         branch_supply_receipts%ROWTYPE;
  v_item            branch_supply_receipt_items%ROWTYPE;
  v_cost_row        jsonb;
  v_item_id         uuid;
  v_unit_cost       numeric;
  v_lines_sum       numeric;
  v_items_count     integer := 0;
  v_db_items_count  integer := 0;
  v_rpc_result      jsonb;
  v_final_total     numeric;
  v_legacy_total    boolean;
BEGIN
  v_caller_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id
      AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo el Administrador General puede aprobar comprobantes.';
  END IF;

  IF p_cost_items IS NULL OR jsonb_array_length(p_cost_items) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes ingresar los costos unitarios antes de aprobar.';
  END IF;

  SELECT * INTO v_receipt
  FROM   branch_supply_receipts
  WHERE  id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: El comprobante ya fue procesado (estado: %).', v_receipt.status;
  END IF;

  IF COALESCE(v_receipt.is_quick, false) THEN
    RAISE EXCEPTION 'INVALID_FLOW: Los ingresos rápidos no se aprueban por este flujo.';
  END IF;

  SELECT COUNT(*)::integer INTO v_db_items_count
  FROM branch_supply_receipt_items
  WHERE receipt_id = p_receipt_id;

  IF jsonb_array_length(p_cost_items) <> v_db_items_count THEN
    RAISE EXCEPTION 'VALIDATION: Debes ingresar el costo unitario de los % ítem(s) del comprobante.',
      v_db_items_count;
  END IF;

  FOR v_cost_row IN SELECT * FROM jsonb_array_elements(p_cost_items) LOOP
    v_item_id   := (v_cost_row->>'item_id')::uuid;
    v_unit_cost := (v_cost_row->>'unit_cost')::numeric;

    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'VALIDATION: El costo unitario no puede ser negativo (ítem: %).', v_item_id;
    END IF;

    UPDATE branch_supply_receipt_items
    SET    unit_cost = ROUND(v_unit_cost, 4)
    WHERE  id         = v_item_id
      AND  receipt_id = p_receipt_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: El ítem % no pertenece al comprobante %.', v_item_id, p_receipt_id;
    END IF;
  END LOOP;

  UPDATE branch_supply_receipts
  SET    prices_include_igv = p_prices_include_igv
  WHERE  id = p_receipt_id;

  SELECT COALESCE(ROUND(SUM(quantity * unit_cost), 2), 0)
  INTO   v_lines_sum
  FROM   branch_supply_receipt_items
  WHERE  receipt_id = p_receipt_id;

  v_legacy_total := ROUND(v_receipt.declared_total, 2) > 0;

  IF v_legacy_total THEN
    IF ROUND(v_lines_sum, 2) <> ROUND(v_receipt.declared_total, 2) THEN
      RAISE EXCEPTION
        'MATCH_SCORE_MISMATCH: La suma de los ítems (S/ %) no coincide con el monto '
        'declarado por la sede (S/ %). Descalce de S/ %.',
        ROUND(v_lines_sum, 2),
        ROUND(v_receipt.declared_total, 2),
        ROUND(ABS(v_lines_sum - v_receipt.declared_total), 2);
    END IF;
    v_final_total := ROUND(v_receipt.declared_total, 2);
  ELSE
    IF v_lines_sum <= 0 THEN
      RAISE EXCEPTION
        'AUDITOR_COSTS_REQUIRED: Ingresa costos unitarios válidos. '
        'La suma del comprobante debe ser mayor a S/ 0.';
    END IF;
    v_final_total := v_lines_sum;
  END IF;

  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  FOR v_item IN
    SELECT * FROM branch_supply_receipt_items
    WHERE  receipt_id = p_receipt_id
    ORDER  BY sort_order
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM products WHERE id = v_item.product_id AND active = true
    ) THEN
      RAISE EXCEPTION 'PRODUCT_INACTIVE: El producto % fue desactivado.', v_item.product_id;
    END IF;

    SELECT public.increment_product_stock(
      v_item.product_id,
      v_receipt.school_id,
      v_item.quantity,
      p_receipt_id,
      format(
        'Suministro sede — %s %s (Aprobado: %s)',
        v_receipt.doc_type,
        COALESCE(v_receipt.doc_number, 'sin número'),
        v_receipt.receipt_number
      ),
      v_item.uom_id
    ) INTO v_rpc_result;

    v_items_count := v_items_count + 1;
  END LOOP;

  UPDATE branch_supply_receipts
  SET
    status         = 'approved',
    declared_total = v_final_total,
    reviewed_by    = v_caller_id,
    reviewed_at    = clock_timestamp(),
    updated_at     = clock_timestamp(),
    match_score    = jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', v_final_total,
      'matched',        true,
      'delta_cents',    0,
      'phase',          CASE WHEN v_legacy_total
                          THEN 'legacy_sede_declared_total'
                          ELSE 'auditor_line_costs'
                        END,
      'approved_at',    clock_timestamp(),
      'approved_by',    v_caller_id
    )
  WHERE id = p_receipt_id;

  INSERT INTO audit_logs (
    admin_user_id, action, details, target_user_id, "timestamp", created_at
  )
  VALUES (
    v_caller_id,
    'approve_branch_supply_receipt_v2',
    format(
      'Comprobante %s (%s) aprobado. Total auditado S/ %s. IGV incluido: %s. Ítems: %s.',
      p_receipt_id,
      v_receipt.receipt_number,
      v_final_total,
      p_prices_include_igv::text,
      v_items_count
    ),
    v_receipt.submitted_by,
    clock_timestamp(),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'items_approved', v_items_count,
    'lines_sum',      v_lines_sum,
    'declared_total', v_final_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_branch_supply_receipt(uuid, jsonb, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.submit_branch_supply_receipt IS
  'Registro de comprobante estándar por sede. declared_total=0: sin monto de sede; costos los fija el auditor al aprobar.';

COMMENT ON FUNCTION public.preview_branch_supply_totals IS
  'Preview de cotejo. declared_total=0: valida costos de línea del auditor (sin monto de sede).';

COMMENT ON FUNCTION public.approve_branch_supply_receipt IS
  'Aprobación con costos del auditor. Sin monto de sede: total oficial = suma de líneas en BD.';

SELECT 'OK: branch_supply auditor cost-only flow' AS resultado;

COMMIT;
