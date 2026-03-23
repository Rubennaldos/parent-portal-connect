-- =============================================================================
-- FASE LOGÍSTICA PROFESIONAL: Jerarquía de Productos, UoM y Sello Verde
-- Versión idempotente (se puede correr múltiples veces)
-- =============================================================================

-- 1. FAMILIAS DE PRODUCTO
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_families (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL UNIQUE,
  description text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE product_families ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "families_read_auth"   ON product_families;
DROP POLICY IF EXISTS "families_write_admin" ON product_families;

CREATE POLICY "families_read_auth" ON product_families
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "families_write_admin" ON product_families
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

-- 2. SUBFAMILIAS DE PRODUCTO
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_subfamilies (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id   uuid        NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (family_id, name)
);

ALTER TABLE product_subfamilies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subfamilies_read_auth"   ON product_subfamilies;
DROP POLICY IF EXISTS "subfamilies_write_admin" ON product_subfamilies;

CREATE POLICY "subfamilies_read_auth" ON product_subfamilies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "subfamilies_write_admin" ON product_subfamilies
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

-- 3. EMPAQUE / UNIDADES DE MEDIDA (UoM) por PRODUCTO
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_packaging (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id              uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  uom_name                text        NOT NULL,          -- 'Caja', 'Tira', 'Display', 'Unidad'
  conversion_factor       integer     NOT NULL DEFAULT 1, -- 1 Caja = 24 Unidades
  barcode                 text,                          -- Código de barras de este empaque
  is_branch_order_allowed boolean     NOT NULL DEFAULT true, -- ¿Las sedes pueden pedir en este UoM?
  created_at              timestamptz DEFAULT now(),
  UNIQUE (product_id, uom_name)
);

ALTER TABLE product_packaging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "packaging_read_auth"   ON product_packaging;
DROP POLICY IF EXISTS "packaging_write_admin" ON product_packaging;

CREATE POLICY "packaging_read_auth" ON product_packaging
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "packaging_write_admin" ON product_packaging
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

-- 4. ALTERAR TABLA PRODUCTS: nuevas columnas
-- =============================================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_verified  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_id    uuid    REFERENCES product_families(id),
  ADD COLUMN IF NOT EXISTS subfamily_id uuid    REFERENCES product_subfamilies(id),
  ADD COLUMN IF NOT EXISTS moq          integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_stock    integer NOT NULL DEFAULT 0;

-- Índices
CREATE INDEX IF NOT EXISTS idx_products_is_verified   ON products (is_verified) WHERE is_verified = true;
CREATE INDEX IF NOT EXISTS idx_products_family        ON products (family_id);
CREATE INDEX IF NOT EXISTS idx_products_subfamily     ON products (subfamily_id);
CREATE INDEX IF NOT EXISTS idx_packaging_product      ON product_packaging (product_id);
CREATE INDEX IF NOT EXISTS idx_subfamilies_family     ON product_subfamilies (family_id);
