-- ============================================================
-- SPRINT A — Logística: Cimientos y Trazabilidad Completa
-- ============================================================
-- Cambios:
--   1. Ampliar suppliers (contacto, condiciones de pago, notas, web)
--   2. Agregar evidencia documental a purchase_entries
--   3. Agregar campo reason a pos_stock_movements
--   4. Ampliar CHECK de movement_type para traslados (Sprint B)
--   5. Actualizar trigger de ajuste_manual para suprimir entry_rpc y transfer_rpc
--   6. Reemplazar increment_product_stock con versión auditada
-- ============================================================

-- ── 1. Ampliar tabla suppliers ──────────────────────────────────────────────

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS payment_terms  text,
  ADD COLUMN IF NOT EXISTS website        text,
  ADD COLUMN IF NOT EXISTS notes          text;

COMMENT ON COLUMN suppliers.contact_person IS 'Persona de contacto para pedidos';
COMMENT ON COLUMN suppliers.payment_terms  IS 'Condiciones de pago (ej: Contado, 30 días)';
COMMENT ON COLUMN suppliers.website        IS 'Sitio web del proveedor';
COMMENT ON COLUMN suppliers.notes          IS 'Notas internas sobre el proveedor';

SELECT 'OK: suppliers ampliado con campos de negocio' AS resultado;

-- ── 2. Evidencia documental en purchase_entries ─────────────────────────────

ALTER TABLE purchase_entries
  ADD COLUMN IF NOT EXISTS evidence_url text;

COMMENT ON COLUMN purchase_entries.evidence_url IS 'URL de foto o PDF de la factura/boleta del proveedor';

SELECT 'OK: evidence_url añadido a purchase_entries' AS resultado;

-- ── 3. Campo reason en pos_stock_movements ──────────────────────────────────

ALTER TABLE pos_stock_movements
  ADD COLUMN IF NOT EXISTS reason text;

COMMENT ON COLUMN pos_stock_movements.reason IS 'Motivo del movimiento de stock (descripción operacional)';

-- ── 4. Ampliar CHECK de movement_type (incluir traslados) ───────────────────

ALTER TABLE pos_stock_movements
  DROP CONSTRAINT IF EXISTS pos_stock_movements_movement_type_check;

ALTER TABLE pos_stock_movements
  ADD CONSTRAINT pos_stock_movements_movement_type_check
  CHECK (movement_type IN (
    'venta_pos',
    'ajuste_manual',
    'entrada_compra',
    'transfer_out',
    'transfer_in'
  ));

SELECT 'OK: CHECK movement_type actualizado con transfer_out y transfer_in' AS resultado;

-- ── 5. Actualizar trigger de ajuste_manual ──────────────────────────────────
-- Suprimir también para 'entry_rpc' y 'transfer_rpc'
-- (son flujos con Kardex propio y más detallado)

CREATE OR REPLACE FUNCTION fn_log_stock_manual_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.current_stock = NEW.current_stock THEN
    RETURN NEW;
  END IF;

  -- Si el cambio viene de un RPC con Kardex propio, no duplicar
  IF current_setting('app.kardex_source', true) IN ('pos_rpc', 'entry_rpc', 'transfer_rpc') THEN
    RETURN NEW;
  END IF;

  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    OLD.product_id, OLD.school_id,
    'ajuste_manual',
    NEW.current_stock - OLD.current_stock,
    OLD.current_stock, NEW.current_stock,
    NULL, auth.uid(),
    clock_timestamp(),
    'Ajuste manual desde interfaz de administración'
  );

  RETURN NEW;
END;
$$;

SELECT 'OK: fn_log_stock_manual_adjustment actualizado para suprimir entry_rpc y transfer_rpc' AS resultado;

-- ── 6. increment_product_stock: versión auditada con Kardex correcto ─────────
-- Agrega p_entry_id y p_reason para trazabilidad de origen

DROP FUNCTION IF EXISTS increment_product_stock(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION increment_product_stock(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,
  p_entry_id   uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_before integer := 0;
  v_stock_after  integer;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INCREMENT_STOCK: la cantidad debe ser mayor a 0';
  END IF;

  -- Stock actual antes del cambio
  SELECT COALESCE(current_stock, 0)
  INTO   v_stock_before
  FROM   product_stock
  WHERE  product_id = p_product_id
    AND  school_id  = p_school_id;

  -- Suprimir trigger genérico (registramos con más contexto abajo)
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- Upsert de stock
  INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
  VALUES (p_product_id, p_school_id, p_quantity, true, clock_timestamp())
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + p_quantity,
    last_updated  = clock_timestamp();

  -- Stock final real
  SELECT current_stock
  INTO   v_stock_after
  FROM   product_stock
  WHERE  product_id = p_product_id
    AND  school_id  = p_school_id;

  -- Registrar en Kardex con tipo correcto
  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    p_product_id, p_school_id,
    'entrada_compra',
    p_quantity,
    v_stock_before, v_stock_after,
    p_entry_id, auth.uid(),
    clock_timestamp(),
    COALESCE(p_reason, 'Entrada de compra registrada desde logística')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION increment_product_stock(uuid, uuid, integer, uuid, text)
  TO authenticated, service_role;

SELECT 'OK: increment_product_stock actualizado con Kardex entrada_compra' AS resultado;
