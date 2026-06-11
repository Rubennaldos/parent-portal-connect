-- ============================================================
-- INVENTORY GUARDRAILS LOCKDOWN
-- ============================================================
-- Objetivo:
-- 1) Permitir movimiento kardex: ajuste_inicial
-- 2) Crear RPC para stock inicial al crear producto
-- 3) Bloquear técnicamente cualquier intento de stock negativo
-- 4) Reforzar índices de product_stock para lecturas POS rápidas
-- ============================================================

-- ── 1) Kardex: incluir ajuste_inicial en movement_type ──────────────────────
ALTER TABLE pos_stock_movements
  DROP CONSTRAINT IF EXISTS pos_stock_movements_movement_type_check;

ALTER TABLE pos_stock_movements
  ADD CONSTRAINT pos_stock_movements_movement_type_check
  CHECK (movement_type IN (
    'venta_pos',
    'ajuste_manual',
    'entrada_compra',
    'transfer_out',
    'transfer_in',
    'ajuste_inicial'
  ));

-- ── 2) RPC: aplicar stock inicial al crear producto ─────────────────────────
CREATE OR REPLACE FUNCTION apply_initial_stock_adjustment(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,
  p_reason     text DEFAULT 'Stock inicial al crear producto'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_before integer := 0;
  v_stock_after  integer;
  v_product_name text;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad inicial debe ser mayor a 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = p_product_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: producto no existe (%)', p_product_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = p_school_id) THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: sede no existe (%)', p_school_id;
  END IF;

  SELECT p.name INTO v_product_name
  FROM products p
  WHERE p.id = p_product_id;

  -- leer stock previo
  SELECT COALESCE(ps.current_stock, 0)
  INTO   v_stock_before
  FROM   product_stock ps
  WHERE  ps.product_id = p_product_id
    AND  ps.school_id  = p_school_id;

  -- Suprimir trigger genérico de ajuste_manual: registramos con tipo específico.
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- upsert de stock
  INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
  VALUES (p_product_id, p_school_id, p_quantity, true, clock_timestamp())
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + p_quantity,
    last_updated  = clock_timestamp();

  SELECT current_stock
  INTO   v_stock_after
  FROM   product_stock
  WHERE  product_id = p_product_id
    AND  school_id  = p_school_id;

  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    p_product_id, p_school_id,
    'ajuste_inicial', p_quantity,
    v_stock_before, v_stock_after,
    NULL, auth.uid(),
    clock_timestamp(),
    COALESCE(p_reason, format('Ajuste inicial para producto %s', v_product_name))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'school_id', p_school_id,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after
  );
END;
$$;

GRANT EXECUTE ON FUNCTION apply_initial_stock_adjustment(uuid, uuid, integer, text)
  TO authenticated, service_role;

-- ── 3) Restricción técnica: jamás permitir stock negativo ───────────────────
-- El CHECK ya existe, pero este trigger devuelve error de negocio consistente
-- antes de llegar al mensaje técnico del constraint.
CREATE OR REPLACE FUNCTION fn_guard_product_stock_non_negative()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_stock < 0 THEN
    RAISE EXCEPTION
      'INSUFFICIENT_STOCK: stock insuficiente para completar la operación. Disponible: %, solicitado excede el stock.',
      OLD.current_stock;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_product_stock_non_negative ON product_stock;
CREATE TRIGGER trg_guard_product_stock_non_negative
  BEFORE UPDATE OF current_stock ON product_stock
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_product_stock_non_negative();

-- ── 4) Índices para consultas de stock (POS/Logística) ─────────────────────
CREATE INDEX IF NOT EXISTS idx_product_stock_product
  ON product_stock (product_id);

CREATE INDEX IF NOT EXISTS idx_product_stock_school
  ON product_stock (school_id);

CREATE INDEX IF NOT EXISTS idx_product_stock_product_school_enabled
  ON product_stock (product_id, school_id)
  WHERE is_enabled = true;

SELECT 'INVENTORY GUARDRAILS OK: ajuste_inicial + rpc inicial + guard no negativo + índices stock' AS resultado;
