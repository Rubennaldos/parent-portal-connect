-- ============================================================
-- Suministro sede: stock inmediato al registrar (sin cola Comprobantes)
-- Archivo: 20260606_branch_supply_immediate_stock.sql
--
-- Modelo nuevo (proveedor estándar):
--   • submit_branch_supply_receipt → inventario + kardex en la misma transacción
--   • status = approved, stock_applied_at = reloj servidor
--   • Costos unitarios de sede siguen en 0 (sin cálculos financieros en front)
--
-- Legacy (comprobantes pending ANTES de esta migración):
--   • approve_branch_supply_receipt sigue aplicando stock SI stock_applied_at IS NULL
--   • reject bloqueado si ya hubo stock
--
-- Candados:
--   • stock_applied_at (idempotencia operativa)
--   • Índice único kardex (reference_id + product_id + school_id)
--   • approve / reject no duplican ni revierten sin RPC dedicado
-- ============================================================

BEGIN;

-- ── 1. Columna candado ────────────────────────────────────────────────────────

ALTER TABLE public.branch_supply_receipts
  ADD COLUMN IF NOT EXISTS stock_applied_at timestamptz;

COMMENT ON COLUMN public.branch_supply_receipts.stock_applied_at IS
  'Momento en que increment_product_stock aplicó inventario para este comprobante. '
  'NULL = stock aún no aplicado (legacy pending). NOT NULL = no volver a incrementar.';

-- Comprobantes ya aprobados (ingreso rápido o approve legacy): marcar como con stock
UPDATE public.branch_supply_receipts
SET    stock_applied_at = COALESCE(reviewed_at, submitted_at)
WHERE  status = 'approved'
  AND  stock_applied_at IS NULL;

COMMENT ON TABLE public.branch_supply_receipts IS
  'Comprobantes de ingreso de suministros por sede. '
  'Desde 20260606: submit estándar aplica stock al registrar. '
  'Legacy pending sin stock_applied_at: solo approve_branch_supply_receipt mueve inventario.';

-- ── 1b. Reparación obligatoria: duplicados entrada_compra en kardex ───────────
-- Sin esto el índice único falla (ERROR 23505). Causa típica: doble apply del
-- mismo comprobante (approve reintentado, trigger + RPC, etc.).
--
-- Reglas de reparación (conservadoras):
--   • Conservar la fila MÁS ANTIGUA por (reference_id, product_id, school_id).
--   • Borrar duplicados posteriores.
--   • Restar en product_stock el exceso que esos duplicados inflaron.
--   • Desactivar SOLO durante este bloque los triggers de stock negativo
--     (la corrección puede dejar stock < 0 si ya se vendió el exceso inflado).
--   • Suprimir trigger ajuste_manual durante la corrección (app.kardex_source).
--   • Auditar en audit_logs (incl. productos que queden en negativo).

DO $$
DECLARE
  v_dup_groups      integer := 0;
  v_rows_deleted    integer := 0;
  v_units_fixed     bigint  := 0;
  v_negative_after  integer := 0;
  v_negative_detail text;
BEGIN
  SELECT COUNT(*)::integer INTO v_dup_groups
  FROM (
    SELECT 1
    FROM public.pos_stock_movements psm
    WHERE psm.reference_id IS NOT NULL
      AND psm.movement_type = 'entrada_compra'
    GROUP BY psm.reference_id, psm.product_id, psm.school_id
    HAVING COUNT(*) > 1
  ) g;

  IF v_dup_groups = 0 THEN
    RAISE NOTICE 'KARDEX_DEDUP: sin duplicados entrada_compra; índice único puede crearse.';
    RETURN;
  END IF;

  PERFORM set_config('app.kardex_source', 'pos_rpc', true);

  -- Muralla de stock negativo: desactivar solo en esta transacción de reparación.
  -- Si la migración hace ROLLBACK, los triggers vuelven a su estado anterior.
  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'product_stock'
      AND t.tgname = 'trg_guard_product_stock_negative_switch'
      AND NOT t.tgisinternal
  ) THEN
    ALTER TABLE public.product_stock DISABLE TRIGGER trg_guard_product_stock_negative_switch;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'product_stock'
      AND t.tgname = 'trg_guard_product_stock_non_negative'
      AND NOT t.tgisinternal
  ) THEN
    ALTER TABLE public.product_stock DISABLE TRIGGER trg_guard_product_stock_non_negative;
  END IF;

  CREATE TEMP TABLE _psm_dup_ranked ON COMMIT DROP AS
  SELECT
    psm.id,
    psm.reference_id,
    psm.product_id,
    psm.school_id,
    psm.quantity_delta,
    ROW_NUMBER() OVER (
      PARTITION BY psm.reference_id, psm.product_id, psm.school_id
      ORDER BY psm.created_at ASC, psm.id ASC
    ) AS rn
  FROM public.pos_stock_movements psm
  WHERE psm.reference_id IS NOT NULL
    AND psm.movement_type = 'entrada_compra';

  SELECT
    COALESCE(SUM(quantity_delta), 0),
    COUNT(*)::integer
  INTO v_units_fixed, v_rows_deleted
  FROM _psm_dup_ranked
  WHERE rn > 1;

  -- Corregir stock inflado por duplicados (solo filas con product_stock existente)
  UPDATE public.product_stock ps
  SET
    current_stock = ps.current_stock - agg.excess_qty,
    last_updated  = clock_timestamp()
  FROM (
    SELECT
      product_id,
      school_id,
      SUM(quantity_delta)::integer AS excess_qty
    FROM _psm_dup_ranked
    WHERE rn > 1
    GROUP BY product_id, school_id
  ) agg
  WHERE ps.product_id = agg.product_id
    AND ps.school_id  = agg.school_id;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'product_stock'
      AND t.tgname = 'trg_guard_product_stock_negative_switch'
      AND NOT t.tgisinternal
  ) THEN
    ALTER TABLE public.product_stock ENABLE TRIGGER trg_guard_product_stock_negative_switch;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'product_stock'
      AND t.tgname = 'trg_guard_product_stock_non_negative'
      AND NOT t.tgisinternal
  ) THEN
    ALTER TABLE public.product_stock ENABLE TRIGGER trg_guard_product_stock_non_negative;
  END IF;

  SELECT COUNT(*)::integer INTO v_negative_after
  FROM public.product_stock
  WHERE current_stock < 0;

  IF v_negative_after > 0 THEN
    SELECT string_agg(
      format('%s@%s=%s', product_id, school_id, current_stock),
      '; '
    )
    INTO v_negative_detail
    FROM (
      SELECT product_id, school_id, current_stock
      FROM public.product_stock
      WHERE current_stock < 0
      ORDER BY current_stock ASC
      LIMIT 20
    ) neg;
  END IF;

  DELETE FROM public.pos_stock_movements psm
  USING _psm_dup_ranked d
  WHERE psm.id = d.id
    AND d.rn > 1;

  INSERT INTO public.audit_logs (
    action, admin_user_id, details, "timestamp", created_at
  )
  VALUES (
    'kardex_dedup_repair_20260606',
    NULL,
    format(
      'Reparación pre-índice único: %s grupo(s) duplicados, %s fila(s) kardex eliminadas, %s unidades corregidas en product_stock. '
      'Productos con stock negativo tras corrección: %s. Detalle (máx 20): %s',
      v_dup_groups,
      v_rows_deleted,
      v_units_fixed,
      v_negative_after,
      COALESCE(v_negative_detail, 'ninguno')
    ),
    clock_timestamp(),
    clock_timestamp()
  );

  IF v_negative_after > 0 THEN
    RAISE WARNING
      'KARDEX_DEDUP: %s producto(s) quedaron con stock negativo tras quitar duplicados kardex. Revisar audit_logs.',
      v_negative_after;
  END IF;

  RAISE NOTICE
    'KARDEX_DEDUP: % grupos, % filas eliminadas, % unidades corregidas, % negativos post-repair.',
    v_dup_groups, v_rows_deleted, v_units_fixed, v_negative_after;
END;
$$;

-- Comprobantes con kardex ya aplicado pero stock_applied_at NULL (legacy inconsistente)
UPDATE public.branch_supply_receipts bsr
SET
  stock_applied_at = mov.first_at,
  status           = CASE
                       WHEN bsr.status = 'pending' THEN 'approved'
                       ELSE bsr.status
                     END,
  reviewed_at      = COALESCE(bsr.reviewed_at, mov.first_at),
  reviewed_by      = COALESCE(bsr.reviewed_by, bsr.submitted_by),
  updated_at       = clock_timestamp()
FROM (
  SELECT
    psm.reference_id AS receipt_id,
    MIN(psm.created_at) AS first_at
  FROM public.pos_stock_movements psm
  WHERE psm.reference_id IS NOT NULL
    AND psm.movement_type = 'entrada_compra'
  GROUP BY psm.reference_id
) mov
WHERE bsr.id = mov.receipt_id
  AND bsr.stock_applied_at IS NULL;

-- Verificación dura: si aún hay duplicados, abortar toda la migración
DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_remaining
  FROM (
    SELECT 1
    FROM public.pos_stock_movements psm
    WHERE psm.reference_id IS NOT NULL
      AND psm.movement_type = 'entrada_compra'
    GROUP BY psm.reference_id, psm.product_id, psm.school_id
    HAVING COUNT(*) > 1
  ) g;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'KARDEX_DEDUP_FAILED: Quedan % grupo(s) duplicados. Revisar manualmente antes del índice único.',
      v_remaining;
  END IF;
END;
$$;

-- ── 2. Índice único anti-doble kardex por comprobante ─────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_psm_entry_reference_product_school
  ON public.pos_stock_movements (reference_id, product_id, school_id)
  WHERE reference_id IS NOT NULL
    AND movement_type = 'entrada_compra';

COMMENT ON INDEX public.idx_psm_entry_reference_product_school IS
  'Muralla: una sola entrada_compra por comprobante+producto+sede. Requiere dedup previo.';

-- ── 3. submit_branch_supply_receipt — stock inmediato ─────────────────────────

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
  v_caller_id       uuid;
  v_receipt_id      uuid;
  v_receipt_number  text;
  v_lines_sum       numeric := 0;
  v_delta           numeric;
  v_matched         boolean;
  v_declared        numeric;
  v_item            jsonb;
  v_row             branch_supply_receipt_items%ROWTYPE;
  v_product_id      uuid;
  v_quantity        integer;
  v_unit_cost       numeric;
  v_uom_id          uuid;
  v_sort_order      smallint := 0;
  v_legacy_total    boolean;
  v_items_stocked   integer := 0;
  v_now             timestamptz := clock_timestamp();
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
        AND stock_applied_at IS NULL
    ) THEN
      RAISE EXCEPTION 'CORRECTION_INVALID: El comprobante a corregir no existe, no está rechazado o ya tuvo stock aplicado.';
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
    IF NOT v_matched THEN
      RAISE EXCEPTION
        'MATCH_REQUIRED: No se puede aplicar stock con descalce. '
        'Suma ítems S/ % ≠ declarado S/ %. Diferencia S/ %.',
        v_lines_sum, v_declared, ROUND(v_delta, 2);
    END IF;
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
    match_score,        status,
    reviewed_by,        reviewed_at,
    stock_applied_at,
    replaces_receipt_id,
    is_quick,
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
    jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', v_declared,
      'matched',        v_matched,
      'delta_cents',    ROUND(v_delta * 100, 2),
      'phase',          'immediate_stock_on_submit'
    ),
    'approved',
    v_caller_id,
    v_now,
    NULL,
    p_replaces_receipt_id,
    false,
    v_now,
    v_now
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

  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  FOR v_row IN
    SELECT * FROM branch_supply_receipt_items
    WHERE  receipt_id = v_receipt_id
    ORDER  BY sort_order
  LOOP
    IF EXISTS (
      SELECT 1 FROM pos_stock_movements psm
      WHERE psm.reference_id   = v_receipt_id
        AND psm.product_id     = v_row.product_id
        AND psm.school_id      = p_school_id
        AND psm.movement_type  = 'entrada_compra'
    ) THEN
      RAISE EXCEPTION
        'STOCK_ALREADY_POSTED: El producto % ya tiene entrada para el comprobante %.',
        v_row.product_id, v_receipt_number;
    END IF;

    PERFORM public.increment_product_stock(
      v_row.product_id,
      p_school_id,
      v_row.quantity,
      v_receipt_id,
      format(
        'Suministro sede — %s %s (%s)',
        p_doc_type,
        COALESCE(NULLIF(trim(COALESCE(p_doc_number, '')), ''), 'sin número'),
        v_receipt_number
      ),
      v_row.uom_id
    );

    v_items_stocked := v_items_stocked + 1;
  END LOOP;

  UPDATE branch_supply_receipts
  SET    stock_applied_at = v_now,
         updated_at       = v_now
  WHERE  id = v_receipt_id;

  INSERT INTO audit_logs (
    admin_user_id, action, details, target_user_id, "timestamp", created_at
  )
  VALUES (
    v_caller_id,
    'submit_branch_supply_receipt_immediate_stock',
    format(
      'Comprobante %s (%s) registrado con stock inmediato. Sede: %s. Ítems: %s. Proveedor: %s.',
      v_receipt_id,
      v_receipt_number,
      p_school_id,
      v_items_stocked,
      p_supplier_id
    ),
    v_caller_id,
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'ok',               true,
    'receipt_id',       v_receipt_id,
    'receipt_number',   v_receipt_number,
    'lines_sum',        v_lines_sum,
    'declared_total',   v_declared,
    'matched',          v_matched,
    'delta_cents',      ROUND(v_delta * 100, 2),
    'items_stocked',    v_items_stocked,
    'stock_applied',    true,
    'warning', CASE
      WHEN NULLIF(trim(COALESCE(p_evidence_path, '')), '') IS NULL THEN
        'SIN_EVIDENCIA: No adjuntaste foto o PDF. El comprobante quedó registrado y el stock ya subió.'
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_branch_supply_receipt(uuid,uuid,text,text,numeric,boolean,text,text,jsonb,uuid)
  TO authenticated;

-- ── 4. approve_branch_supply_receipt — solo legacy sin stock ──────────────────

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
  v_now             timestamptz := clock_timestamp();
  v_skip_stock      boolean;
BEGIN
  v_caller_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id
      AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo el Administrador General puede aprobar comprobantes.';
  END IF;

  SELECT * INTO v_receipt
  FROM   branch_supply_receipts
  WHERE  id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  IF COALESCE(v_receipt.is_quick, false) THEN
    RAISE EXCEPTION 'INVALID_FLOW: Los ingresos rápidos no se aprueban por este flujo.';
  END IF;

  v_skip_stock := v_receipt.stock_applied_at IS NOT NULL;

  IF v_receipt.status <> 'pending' THEN
    IF v_skip_stock THEN
      RAISE EXCEPTION
        'ALREADY_PROCESSED: El comprobante ya tiene stock aplicado (%). Estado: %.',
        v_receipt.stock_applied_at, v_receipt.status;
    END IF;
    RAISE EXCEPTION 'ALREADY_PROCESSED: El comprobante ya fue procesado (estado: %).', v_receipt.status;
  END IF;

  IF v_skip_stock THEN
    RAISE EXCEPTION
      'STOCK_ALREADY_POSTED: El inventario ya fue aplicado en %. No usar approve para duplicar stock.',
      v_receipt.stock_applied_at;
  END IF;

  IF p_cost_items IS NULL OR jsonb_array_length(p_cost_items) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes ingresar los costos unitarios antes de aprobar.';
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

    IF EXISTS (
      SELECT 1 FROM pos_stock_movements psm
      WHERE psm.reference_id   = p_receipt_id
        AND psm.product_id     = v_item.product_id
        AND psm.school_id      = v_receipt.school_id
        AND psm.movement_type  = 'entrada_compra'
    ) THEN
      RAISE EXCEPTION
        'STOCK_ALREADY_POSTED: El producto % ya tiene entrada para este comprobante.',
        v_item.product_id;
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
    status           = 'approved',
    declared_total   = v_final_total,
    reviewed_by      = v_caller_id,
    reviewed_at      = v_now,
    stock_applied_at = v_now,
    updated_at       = v_now,
    match_score      = jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', v_final_total,
      'matched',        true,
      'delta_cents',    0,
      'phase',          CASE WHEN v_legacy_total
                          THEN 'legacy_sede_declared_total'
                          ELSE 'auditor_line_costs'
                        END,
      'approved_at',    v_now,
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
      'Comprobante legacy %s (%s) aprobado con stock. Total auditado S/ %s. Ítems: %s.',
      p_receipt_id,
      v_receipt.receipt_number,
      v_final_total,
      v_items_count
    ),
    v_receipt.submitted_by,
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'items_approved', v_items_count,
    'lines_sum',      v_lines_sum,
    'declared_total', v_final_total,
    'stock_applied',  true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_branch_supply_receipt(uuid, jsonb, boolean)
  TO authenticated;

-- ── 5. reject_branch_supply_receipt — bloqueo si ya hubo stock ────────────────

DROP FUNCTION IF EXISTS public.reject_branch_supply_receipt(uuid, text);

CREATE OR REPLACE FUNCTION public.reject_branch_supply_receipt(
  p_receipt_id       uuid,
  p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_receipt   branch_supply_receipts%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id   = v_caller_id
      AND role IN ('admin_general','superadmin')
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo el Administrador General puede rechazar comprobantes.';
  END IF;

  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'VALIDATION: El motivo de rechazo es obligatorio.';
  END IF;

  SELECT * INTO v_receipt
  FROM   branch_supply_receipts
  WHERE  id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  IF v_receipt.stock_applied_at IS NOT NULL THEN
    RAISE EXCEPTION
      'STOCK_ALREADY_POSTED: No se puede rechazar: el inventario ya subió en %. '
      'Se requiere reversa administrativa (no implementada en este flujo).',
      v_receipt.stock_applied_at;
  END IF;

  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: El comprobante ya fue procesado (estado: %).',
      v_receipt.status;
  END IF;

  UPDATE branch_supply_receipts
  SET
    status           = 'rejected',
    reviewed_by      = v_caller_id,
    reviewed_at      = clock_timestamp(),
    rejection_reason = trim(p_rejection_reason),
    updated_at       = clock_timestamp()
  WHERE id = p_receipt_id;

  INSERT INTO audit_logs (
    admin_user_id, action, details, target_user_id, "timestamp", created_at
  )
  VALUES (
    v_caller_id,
    'reject_branch_supply_receipt',
    format(
      'Comprobante %s (%s) rechazado sin stock aplicado. Motivo: %s.',
      p_receipt_id,
      v_receipt.receipt_number,
      trim(p_rejection_reason)
    ),
    v_receipt.submitted_by,
    clock_timestamp(),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'ok',               true,
    'receipt_id',       p_receipt_id,
    'receipt_number',   v_receipt.receipt_number,
    'rejection_reason', trim(p_rejection_reason)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_branch_supply_receipt(uuid, text)
  TO authenticated;

-- ── 6. submit_quick_stock_receipt — alinear stock_applied_at ──────────────────

CREATE OR REPLACE FUNCTION public.submit_quick_stock_receipt(
  p_school_id uuid,
  p_items     jsonb,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_caller_school uuid;
  v_receipt_id    uuid;
  v_receipt_num   text;
  v_item          jsonb;
  v_product_id    uuid;
  v_quantity      integer;
  v_uom_id        uuid;
  v_product_name  text;
  v_sort          smallint := 0;
  v_now           timestamptz := clock_timestamp();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para registrar un ingreso.';
  END IF;

  SELECT school_id INTO v_caller_school
    FROM profiles WHERE id = v_caller_id;

  IF NOT (
    v_caller_school = p_school_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = v_caller_id
        AND role IN ('admin_general', 'superadmin')
    )
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo puedes registrar ingresos en tu propia sede.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Sede no especificada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school_id AND is_active = true) THEN
    RAISE EXCEPTION 'VALIDATION: La sede no existe o no está activa.';
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes incluir al menos un producto.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION: Cada ítem debe tener un producto seleccionado.';
    END IF;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: La cantidad de cada producto debe ser mayor a 0.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM products WHERE id = v_product_id AND active = true
    ) THEN
      SELECT name INTO v_product_name FROM products WHERE id = v_product_id;
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto "%" no existe o está inactivo.',
        COALESCE(v_product_name, v_product_id::text);
    END IF;
  END LOOP;

  v_receipt_num := fn_next_branch_supply_id();
  v_receipt_id  := gen_random_uuid();

  INSERT INTO branch_supply_receipts (
    id, receipt_number, school_id, supplier_id, submitted_by,
    doc_type, doc_number, declared_total, prices_include_igv,
    notes, evidence_path, match_score,
    status, reviewed_by, reviewed_at,
    stock_applied_at,
    is_quick, submitted_at, updated_at
  ) VALUES (
    v_receipt_id,
    v_receipt_num,
    p_school_id,
    NULL,
    v_caller_id,
    'interno',
    NULL,
    0,
    false,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    NULL,
    NULL,
    'approved',
    v_caller_id,
    v_now,
    NULL,
    true,
    v_now,
    v_now
  );

  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;
    v_uom_id     := NULLIF(v_item->>'uom_id', '')::uuid;

    INSERT INTO branch_supply_receipt_items (
      receipt_id, product_id, quantity, unit_cost, uom_id, sort_order
    ) VALUES (
      v_receipt_id,
      v_product_id,
      v_quantity,
      0,
      v_uom_id,
      v_sort
    );

    IF EXISTS (
      SELECT 1 FROM pos_stock_movements psm
      WHERE psm.reference_id   = v_receipt_id
        AND psm.product_id     = v_product_id
        AND psm.school_id      = p_school_id
        AND psm.movement_type  = 'entrada_compra'
    ) THEN
      RAISE EXCEPTION
        'STOCK_ALREADY_POSTED: El producto % ya tiene entrada para %.',
        v_product_id, v_receipt_num;
    END IF;

    PERFORM increment_product_stock(
      v_product_id,
      p_school_id,
      v_quantity,
      v_receipt_id,
      format('Ingreso rápido %s', v_receipt_num),
      v_uom_id
    );

    v_sort := v_sort + 1;
  END LOOP;

  UPDATE branch_supply_receipts
  SET    stock_applied_at = v_now,
         updated_at       = v_now
  WHERE  id = v_receipt_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     v_receipt_id,
    'receipt_number', v_receipt_num,
    'stock_applied',  true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_quick_stock_receipt(uuid, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_branch_supply_receipt IS
  'Registro de comprobante con proveedor: stock + kardex inmediatos (stock_applied_at). '
  'Costos de sede en 0. Transacción atómica.';

COMMENT ON FUNCTION public.approve_branch_supply_receipt IS
  'Solo comprobantes legacy pending sin stock_applied_at. Aplica stock una vez y marca stock_applied_at.';

COMMENT ON FUNCTION public.reject_branch_supply_receipt IS
  'Rechazo solo si stock_applied_at IS NULL. Con stock aplicado: STOCK_ALREADY_POSTED.';

COMMENT ON FUNCTION public.submit_quick_stock_receipt IS
  'Ingreso rápido: stock inmediato, stock_applied_at al finalizar.';

SELECT 'OK: branch_supply immediate stock (20260606)' AS resultado;

COMMIT;
