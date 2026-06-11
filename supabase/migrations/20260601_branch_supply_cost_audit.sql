-- ============================================================
-- MIGRACIÓN: Branch Supply — Gestión de Costos por Auditor General
-- Archivo: 20260601_branch_supply_cost_audit.sql
-- Fecha  : 2026-06-01
--
-- PROPÓSITO:
--   Endurece el módulo branch_supply para separar responsabilidades:
--   • La sede registra cantidades y el total del comprobante físico.
--   • El Administrador General digita los costos unitarios reales
--     durante la auditoría y aprueba en una sola transacción atómica.
--
-- BLOQUES:
--   1. Extensión unaccent (idempotente)
--   2. RPC: search_suppliers_smart    (búsqueda con tildes/mayúsculas)
--   3. RPC: approve_branch_supply_receipt (versión 2 — acepta costos finales)
-- ============================================================

-- ── 1. EXTENSIÓN UNACCENT ─────────────────────────────────────────────────────
-- Requerida por search_suppliers_smart para ignorar tildes en búsquedas.
-- IF NOT EXISTS: idempotente en instalaciones que ya la tienen.

CREATE EXTENSION IF NOT EXISTS unaccent;

SELECT 'OK: unaccent disponible' AS resultado;

-- ── 2. RPC: search_suppliers_smart ────────────────────────────────────────────
-- Busca proveedores ignorando mayúsculas, minúsculas y tildes.
-- Retorna máx 10 resultados ordenados por relevancia (nombre primero, luego RUC).
-- Usada por BranchSupplyForm.tsx para reemplazar el dropdown estático.

DROP FUNCTION IF EXISTS public.search_suppliers_smart(text);

CREATE OR REPLACE FUNCTION public.search_suppliers_smart(
  p_search_text text
)
RETURNS SETOF public.suppliers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sin texto: devolver los 10 proveedores más recientes (lista inicial vacía)
  IF p_search_text IS NULL OR trim(p_search_text) = '' THEN
    RETURN QUERY
      SELECT * FROM public.suppliers ORDER BY name ASC LIMIT 10;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.*
  FROM   public.suppliers s
  WHERE  unaccent(lower(s.name)) ILIKE unaccent(lower('%' || trim(p_search_text) || '%'))
      OR unaccent(lower(COALESCE(s.ruc, ''))) ILIKE unaccent(lower('%' || trim(p_search_text) || '%'))
  ORDER BY
    -- Coincidencia exacta al inicio del nombre va primero
    CASE WHEN unaccent(lower(s.name)) ILIKE unaccent(lower(trim(p_search_text) || '%'))
         THEN 0 ELSE 1 END,
    s.name ASC
  LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_suppliers_smart(text)
  TO authenticated;

SELECT 'OK: search_suppliers_smart creado' AS resultado;

-- ── 3. RPC: approve_branch_supply_receipt (v2 con costos) ─────────────────────
--
-- FLUJO ATOMICO (BEGIN implícito en transacción):
--   a) Validar rol y status pending
--   b) Actualizar unit_cost en cada ítem con los valores del auditor
--   c) Actualizar prices_include_igv en cabecera
--   d) Recalcular match score con los costos reales
--   e) Si match falla → RAISE EXCEPTION → rollback total
--   f) Llamar increment_product_stock por cada ítem
--   g) Actualizar status = 'approved' + audit_log
--
-- GARANTÍA DE INMUTABILIDAD DEL DECLARED_TOTAL:
--   El monto declarado por la sede (declared_total) nunca cambia.
--   Es la fuente de verdad que el auditor debe cuadrar con sus costos.
--
-- PARÁMETROS:
--   p_receipt_id         : UUID del comprobante
--   p_cost_items         : JSONB array [{item_id, unit_cost}] — costos reales
--   p_prices_include_igv : Si los costos del auditor ya incluyen IGV
--
-- Firma anterior (uuid solo) se elimina; no hay código legacy que la consuma.

DROP FUNCTION IF EXISTS public.approve_branch_supply_receipt(uuid);
DROP FUNCTION IF EXISTS public.approve_branch_supply_receipt(uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.approve_branch_supply_receipt(
  p_receipt_id         uuid,
  p_cost_items         jsonb,    -- [{"item_id":"<uuid>","unit_cost":12.50}]
  p_prices_include_igv boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid;
  v_receipt      branch_supply_receipts%ROWTYPE;
  v_item         branch_supply_receipt_items%ROWTYPE;
  v_cost_row     jsonb;
  v_item_id      uuid;
  v_unit_cost    numeric;
  v_lines_sum    numeric;
  v_items_count  integer := 0;
  v_rpc_result   jsonb;
BEGIN
  v_caller_id := auth.uid();

  -- ── MURALLA: solo Admin General / Superadmin ────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id   = v_caller_id
      AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo el Administrador General puede aprobar comprobantes.';
  END IF;

  -- ── VALIDAR p_cost_items no vacío ──────────────────────────────────────────
  IF p_cost_items IS NULL OR jsonb_array_length(p_cost_items) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes ingresar los costos unitarios antes de aprobar. '
      'El formulario de la sede no registra costos; es responsabilidad del Auditor General.';
  END IF;

  -- ── CANDADO DE CONCURRENCIA ────────────────────────────────────────────────
  SELECT * INTO v_receipt
  FROM   branch_supply_receipts
  WHERE  id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: El comprobante ya fue procesado (estado: %). '
      'No se puede aprobar dos veces.', v_receipt.status;
  END IF;

  -- ── ACTUALIZAR UNIT_COST POR ÍTEM ─────────────────────────────────────────
  -- Cada costo viene del Auditor General basándose en la factura física.
  FOR v_cost_row IN SELECT * FROM jsonb_array_elements(p_cost_items) LOOP
    v_item_id   := (v_cost_row->>'item_id')::uuid;
    v_unit_cost := (v_cost_row->>'unit_cost')::numeric;

    -- El costo no puede ser negativo
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'VALIDATION: El costo unitario no puede ser negativo (ítem: %). '
        'Verifica los valores antes de aprobar.', v_item_id;
    END IF;

    UPDATE branch_supply_receipt_items
    SET    unit_cost = ROUND(v_unit_cost, 4)    -- guardar con 4 decimales de precisión
    WHERE  id         = v_item_id
      AND  receipt_id = p_receipt_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: El ítem % no pertenece al comprobante %. '
        'Posible manipulación del payload.', v_item_id, p_receipt_id;
    END IF;
  END LOOP;

  -- ── ACTUALIZAR IGV EN CABECERA ─────────────────────────────────────────────
  UPDATE branch_supply_receipts
  SET    prices_include_igv = p_prices_include_igv
  WHERE  id = p_receipt_id;

  -- ── REVALIDAR MATCH SCORE CON COSTOS ACTUALIZADOS ────────────────────────
  -- Esta suma se calcula DESPUÉS de hacer UPDATE de unit_cost,
  -- dentro de la misma transacción → lee los valores que acabamos de guardar.
  SELECT COALESCE(ROUND(SUM(quantity * unit_cost), 2), 0)
  INTO   v_lines_sum
  FROM   branch_supply_receipt_items
  WHERE  receipt_id = p_receipt_id;

  IF ROUND(v_lines_sum, 2) <> ROUND(v_receipt.declared_total, 2) THEN
    -- RAISE EXCEPTION fuerza rollback de todos los UPDATEs anteriores.
    RAISE EXCEPTION
      'MATCH_SCORE_MISMATCH: La suma de los ítems (S/ %) no coincide con el monto '
      'declarado (S/ %). Descalce de S/ %. Corrige los costos y vuelve a intentar.',
      ROUND(v_lines_sum, 2),
      ROUND(v_receipt.declared_total, 2),
      ROUND(ABS(v_lines_sum - v_receipt.declared_total), 2);
  END IF;

  -- ── LOOP DE INCREMENTO DE STOCK (motor atómico ya existente) ──────────────
  FOR v_item IN
    SELECT * FROM branch_supply_receipt_items
    WHERE  receipt_id = p_receipt_id
    ORDER  BY sort_order
  LOOP
    -- Revalidar que el producto siga activo
    IF NOT EXISTS (
      SELECT 1 FROM products WHERE id = v_item.product_id AND active = true
    ) THEN
      RAISE EXCEPTION
        'PRODUCT_INACTIVE: El producto % fue desactivado. '
        'Rechaza el comprobante y solicita a la sede que lo corrija.', v_item.product_id;
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

  -- ── ACTUALIZAR CABECERA ────────────────────────────────────────────────────
  UPDATE branch_supply_receipts
  SET
    status      = 'approved',
    reviewed_by = v_caller_id,
    reviewed_at = clock_timestamp(),
    updated_at  = clock_timestamp(),
    match_score = jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', v_receipt.declared_total,
      'matched',        true,
      'delta_cents',    0,
      'approved_at',    clock_timestamp(),
      'approved_by',    v_caller_id
    )
  WHERE id = p_receipt_id;

  -- ── AUDIT LOG ─────────────────────────────────────────────────────────────
  INSERT INTO audit_logs (
    admin_user_id, action, details, target_user_id, "timestamp", created_at
  )
  VALUES (
    v_caller_id,
    'approve_branch_supply_receipt_v2',
    format(
      'Comprobante %s (%s) aprobado con costos. Tipo: %s. Número: %s. '
      'Total: S/ %s. IGV incluido: %s. Sede: %s. Ítems: %s.',
      p_receipt_id,
      v_receipt.receipt_number,
      v_receipt.doc_type,
      COALESCE(v_receipt.doc_number, 'sin número'),
      v_receipt.declared_total,
      p_prices_include_igv::text,
      v_receipt.school_id,
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
    'declared_total', v_receipt.declared_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_branch_supply_receipt(uuid, jsonb, boolean)
  TO authenticated;

SELECT 'OK: approve_branch_supply_receipt v2 (con costos) creado' AS resultado;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────

SELECT
  proname        AS funcion,
  pg_get_function_arguments(oid) AS parametros
FROM pg_proc
WHERE proname IN ('search_suppliers_smart', 'approve_branch_supply_receipt')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

SELECT '✅ MIGRACIÓN 20260601_branch_supply_cost_audit COMPLETADA' AS resultado;
