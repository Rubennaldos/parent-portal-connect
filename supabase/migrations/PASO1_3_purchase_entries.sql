-- PASO 1.3 — Cabecera de entradas de compra (necesita suppliers de 1.1)
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
