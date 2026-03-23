-- PASO 1.4 — Detalle de entradas (necesita purchase_entries de 1.3)
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
