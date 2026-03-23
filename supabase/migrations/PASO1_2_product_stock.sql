-- PASO 1.2 — Stock por producto y sede (después de 1.1)
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
