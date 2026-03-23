-- PASO 1.5 — Columna en products para control de stock en POS
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_control_enabled boolean NOT NULL DEFAULT false;
