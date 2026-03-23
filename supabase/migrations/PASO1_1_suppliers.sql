-- PASO 1.1 — Proveedores (ejecutar primero)
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
