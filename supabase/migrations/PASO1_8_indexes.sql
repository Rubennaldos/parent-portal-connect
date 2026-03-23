-- PASO 1.8 — Índices (opcional pero recomendado; al final del paso 1)
CREATE INDEX IF NOT EXISTS idx_product_stock_product   ON product_stock (product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_school    ON product_stock (school_id);
CREATE INDEX IF NOT EXISTS idx_purchase_entries_school ON purchase_entries (school_id);
CREATE INDEX IF NOT EXISTS idx_purchase_entries_date   ON purchase_entries (created_at DESC);
