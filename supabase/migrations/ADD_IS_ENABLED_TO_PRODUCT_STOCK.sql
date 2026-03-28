-- ============================================================
-- ADD is_enabled TO product_stock
-- Fecha: 2026-03-28
--
-- OBJETIVO: Permitir activar/desactivar un producto
-- específicamente en cada sede desde la vista Inventario Sedes.
--
-- SEMÁNTICA:
--   true  = el producto está disponible / activo en esa sede
--   false = el producto está desactivado para esa sede (no aparece en POS)
--
-- Los registros existentes quedan activados por defecto (true).
-- ============================================================

ALTER TABLE product_stock
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

-- Índice para consultas de activación por sede
CREATE INDEX IF NOT EXISTS idx_product_stock_enabled
  ON product_stock (school_id, is_enabled)
  WHERE is_enabled = true;

-- Comentario descriptivo
COMMENT ON COLUMN product_stock.is_enabled IS
  'Controla si el producto está activo/visible en esta sede específica. false = desactivado solo para esta sede.';

SELECT 'OK: is_enabled añadido a product_stock' AS resultado;
