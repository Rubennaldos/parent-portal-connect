-- ============================================================
-- FIX: increment_product_stock debe reactivar is_enabled al sumar stock
-- ============================================================
--
-- PROBLEMA RAÍZ (confirmado en producción 2026-05-30):
--   El ON CONFLICT DO UPDATE de increment_product_stock solo actualizaba
--   current_stock y last_updated. Si la fila ya existía con is_enabled=false
--   (producto desactivado manualmente en esa sede), el ingreso sumaba las
--   unidades pero la fila quedaba oculta para POS y Stock Live.
--
-- EFECTO OBSERVABLE:
--   Logística registra entrada, kardex refleja el movimiento, pero POS
--   muestra el producto como Agotado / 0 porque get_live_stock_v2 filtra
--   WHERE ps.is_enabled = true.
--
-- CORRECCIÓN:
--   1) Datos:  reactivar las 3 filas concretas que hoy están afectadas.
--   2) Lógica: añadir is_enabled = true al ON CONFLICT DO UPDATE de
--              increment_product_stock, para que cualquier entrada de
--              mercadería reactive la visibilidad de la fila en esa sede.
--
-- RAZONAMIENTO DE NEGOCIO:
--   Recibir stock de un producto en una sede es una señal explícita de
--   intención de venta. Si el producto estaba desactivado y alguien ingresa
--   mercadería, el sistema debe reflejar ese stock en POS automáticamente.
--   Si luego el admin quiere ocultar el producto, puede volver a
--   desactivarlo desde Stock Live.
--
-- IMPACTO:
--   - Solo afecta product_stock.is_enabled.
--   - No toca saldos, transactions, ni ninguna tabla financiera.
--   - Totalmente reversible: un UPDATE SET is_enabled=false revierte.
--   - Compatible con: complete_pos_sale_v2, get_live_stock_v2,
--     cancel_pos_sale_rpc, trg_guard_product_stock_non_negative.
-- ============================================================

BEGIN;

-- ── PASO 1: Corregir las filas afectadas hoy ─────────────────────────────
-- Reactiva product_stock donde hay stock real pero la fila está apagada.
-- Solo toca productos activos con stock > 0. No inventa filas nuevas.

UPDATE public.product_stock ps
SET    is_enabled   = true,
       last_updated = clock_timestamp()
WHERE  ps.is_enabled      = false
  AND  ps.current_stock   > 0
  AND  EXISTS (
         SELECT 1
         FROM   public.products p
         WHERE  p.id     = ps.product_id
           AND  p.active = true
       );

-- ── PASO 2: Corregir la función increment_product_stock ──────────────────
-- Reemplaza únicamente el bloque DO UPDATE SET para incluir is_enabled=true.
-- El resto de la función (UoM, kardex, auditoría, guardas) queda intacto.

CREATE OR REPLACE FUNCTION public.increment_product_stock(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,
  p_entry_id   uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_uom_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_before integer;
  v_stock_after  integer;
  v_factor       integer := 1;
  v_uom_name     text;
  v_base_qty     integer;
  v_audit_reason text;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INCREMENT_STOCK: la cantidad debe ser mayor a 0';
  END IF;

  -- ── Resolución UoM: conversión ocurre en BD, nunca en el cliente ─────
  IF p_uom_id IS NOT NULL THEN
    SELECT conversion_factor, uom_name
    INTO   v_factor, v_uom_name
    FROM   product_packaging
    WHERE  id         = p_uom_id
      AND  product_id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'UOM_NOT_FOUND: El empaque no existe o no pertenece a este producto';
    END IF;

    IF v_factor IS NULL OR v_factor <= 0 THEN
      RAISE EXCEPTION 'UOM_INVALID: El factor de conversión debe ser mayor a 0';
    END IF;
  END IF;

  v_base_qty := p_quantity * COALESCE(v_factor, 1);

  -- ── Stock antes — NULL-safe ───────────────────────────────────────────
  SELECT COALESCE(
    (SELECT ps.current_stock
     FROM   product_stock ps
     WHERE  ps.product_id = p_product_id
       AND  ps.school_id  = p_school_id
     LIMIT  1),
    0
  ) INTO v_stock_before;

  -- ── Texto de auditoría ────────────────────────────────────────────────
  v_audit_reason := CASE
    WHEN p_uom_id IS NOT NULL THEN
      COALESCE(p_reason, 'Entrada de compra') ||
      format(' [Conversión: %s %s × %s un. = %s unidades base]',
        p_quantity, v_uom_name, v_factor, v_base_qty)
    ELSE
      COALESCE(p_reason, 'Entrada de compra registrada desde logística')
  END;

  -- ── Suprimir trigger genérico de ajuste_manual ───────────────────────
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- ── Upsert de stock ───────────────────────────────────────────────────
  -- FIX: is_enabled = true en DO UPDATE. Recibir mercadería en una sede
  -- es señal explícita de intención de venta; la fila debe quedar activa.
  INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
  VALUES (p_product_id, p_school_id, v_base_qty, true, clock_timestamp())
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + v_base_qty,
    is_enabled    = true,
    last_updated  = clock_timestamp();

  -- ── Stock después (leído de BD, no calculado en cliente) ──────────────
  SELECT ps.current_stock
  INTO   v_stock_after
  FROM   product_stock ps
  WHERE  ps.product_id = p_product_id
    AND  ps.school_id  = p_school_id;

  v_stock_after := COALESCE(v_stock_after, v_stock_before + v_base_qty);

  -- ── Kardex: entrada_compra con conversión documentada ─────────────────
  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    p_product_id,  p_school_id,
    'entrada_compra',
    v_base_qty,
    v_stock_before, v_stock_after,
    p_entry_id,    auth.uid(),
    clock_timestamp(),
    v_audit_reason
  );

  RETURN jsonb_build_object(
    'ok',       true,
    'base_qty', v_base_qty,
    'factor',   COALESCE(v_factor, 1),
    'uom_name', COALESCE(v_uom_name, 'unidad')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_product_stock(uuid, uuid, integer, uuid, text, uuid)
  TO authenticated, service_role;

COMMIT;

-- ── Verificación post-aplicación ─────────────────────────────────────────
-- Debe devolver 0 filas. Si devuelve algo, hay un caso nuevo que analizar.
SELECT s.name AS sede, p.name AS producto, ps.current_stock
FROM   public.product_stock ps
JOIN   public.products p ON p.id = ps.product_id
JOIN   public.schools  s ON s.id = ps.school_id
WHERE  ps.is_enabled    = false
  AND  ps.current_stock > 0
  AND  p.active         = true
ORDER  BY s.name, p.name;
