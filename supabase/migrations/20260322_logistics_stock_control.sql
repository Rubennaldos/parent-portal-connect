-- =============================================================================
-- FASE LOGÍSTICA: Stock Control por Producto/Sede + Proveedores + Entradas
-- Versión idempotente: se puede correr múltiples veces sin error
-- =============================================================================

-- 1. PROVEEDORES (global, todas las sedes)
-- =============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,
  ruc         text        UNIQUE,
  address     text,
  phone       text,
  email       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_read_all"    ON suppliers;
DROP POLICY IF EXISTS "suppliers_write_admin" ON suppliers;

CREATE POLICY "suppliers_read_all" ON suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "suppliers_write_admin" ON suppliers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

-- 2. STOCK POR PRODUCTO/SEDE
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_stock (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  school_id       uuid        NOT NULL REFERENCES schools(id)  ON DELETE CASCADE,
  current_stock   integer     NOT NULL DEFAULT 0,
  last_updated    timestamptz DEFAULT now(),
  UNIQUE (product_id, school_id)
);

ALTER TABLE product_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_stock_read_auth"   ON product_stock;
DROP POLICY IF EXISTS "product_stock_write_admin" ON product_stock;

CREATE POLICY "product_stock_read_auth" ON product_stock
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "product_stock_write_admin" ON product_stock
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad','cajero','operador_caja')
    )
  );

-- 3. ENTRADAS DE STOCK — Cabecera (una entrada = un comprobante de compra)
-- =============================================================================
CREATE TABLE IF NOT EXISTS purchase_entries (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id   uuid        REFERENCES suppliers(id),
  school_id     uuid        NOT NULL REFERENCES schools(id),
  user_id       uuid        NOT NULL REFERENCES auth.users(id),
  doc_type      text        NOT NULL CHECK (doc_type IN ('boleta','factura','guia')),
  doc_number    text,
  total_amount  numeric(10,2) NOT NULL DEFAULT 0,
  notes         text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE purchase_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_entries_read_school" ON purchase_entries;
DROP POLICY IF EXISTS "purchase_entries_write_admin" ON purchase_entries;

CREATE POLICY "purchase_entries_read_school" ON purchase_entries
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT school_id FROM profiles WHERE id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin_general','superadmin')
    )
  );

CREATE POLICY "purchase_entries_write_admin" ON purchase_entries
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

-- 4. ENTRADAS DE STOCK — Detalle (ítems de cada entrada)
-- =============================================================================
CREATE TABLE IF NOT EXISTS purchase_entry_items (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id    uuid        NOT NULL REFERENCES purchase_entries(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL REFERENCES products(id),
  quantity    integer     NOT NULL DEFAULT 1,
  unit_cost   numeric(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE purchase_entry_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_entry_items_read_auth"   ON purchase_entry_items;
DROP POLICY IF EXISTS "purchase_entry_items_write_admin" ON purchase_entry_items;

CREATE POLICY "purchase_entry_items_read_auth" ON purchase_entry_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "purchase_entry_items_write_admin" ON purchase_entry_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

-- 5. ALTERAR TABLA PRODUCTS: columna stock_control_enabled
-- =============================================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_control_enabled boolean NOT NULL DEFAULT false;

-- 6. FUNCIÓN RPC: Decrementar stock al vender en POS (atómica)
-- =============================================================================
CREATE OR REPLACE FUNCTION deduct_product_stock(
  p_product_id  uuid,
  p_school_id   uuid,
  p_quantity    integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE product_stock
     SET current_stock = current_stock - p_quantity,
         last_updated  = now()
   WHERE product_id = p_product_id
     AND school_id  = p_school_id;
$$;

-- 7. FUNCIÓN RPC: Incrementar stock al registrar una entrada de compra
-- =============================================================================
CREATE OR REPLACE FUNCTION increment_product_stock(
  p_product_id  uuid,
  p_school_id   uuid,
  p_quantity    integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO product_stock (product_id, school_id, current_stock)
  VALUES (p_product_id, p_school_id, p_quantity)
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + p_quantity,
    last_updated  = now();
$$;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_product_stock_product   ON product_stock (product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_school    ON product_stock (school_id);
CREATE INDEX IF NOT EXISTS idx_purchase_entries_school ON purchase_entries (school_id);
CREATE INDEX IF NOT EXISTS idx_purchase_entries_date   ON purchase_entries (created_at DESC);
