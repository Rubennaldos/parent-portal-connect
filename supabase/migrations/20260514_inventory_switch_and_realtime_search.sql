-- ============================================================
-- INVENTORY SWITCH + REALTIME SEARCH (DB-first, escalable)
-- ============================================================
-- 1) Global Kill Switch en app_config: allow_negative_sales
-- 2) Guard de stock en BD consultando el switch (sin lógica pesada en front)
-- 3) Búsqueda inteligente (normalización sin ext. unaccent + pg_trgm) para Stock Live
-- ============================================================

-- ── 1) Configuración global ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,
  value_json  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO app_config(key, value_json)
VALUES ('allow_negative_sales', '{"enabled": false}')
ON CONFLICT (key) DO NOTHING;

-- Helper de lectura (una sola fuente de verdad del switch)
CREATE OR REPLACE FUNCTION get_allow_negative_sales()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((value_json->>'enabled')::boolean, false)
  FROM app_config
  WHERE key = 'allow_negative_sales';
$$;

GRANT EXECUTE ON FUNCTION get_allow_negative_sales() TO authenticated, service_role;

-- ── 2) Guard de stock basado en switch ───────────────────────────────────────
-- Quitamos CHECK fijo para permitir comportamiento dinámico por switch.
ALTER TABLE product_stock
  DROP CONSTRAINT IF EXISTS chk_stock_non_negative;

CREATE OR REPLACE FUNCTION fn_guard_product_stock_by_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_negative boolean := false;
BEGIN
  v_allow_negative := COALESCE(get_allow_negative_sales(), false);

  -- Si el switch está OFF, nunca permitimos stock negativo.
  IF NOT v_allow_negative AND NEW.current_stock < 0 THEN
    RAISE EXCEPTION
      'INSUFFICIENT_STOCK: stock insuficiente. Disponible: %, solicitado excede el stock.',
      COALESCE(OLD.current_stock, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_product_stock_non_negative ON product_stock;
DROP TRIGGER IF EXISTS trg_guard_product_stock_by_switch ON product_stock;

CREATE TRIGGER trg_guard_product_stock_by_switch
  BEFORE INSERT OR UPDATE OF current_stock ON product_stock
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_product_stock_by_switch();

-- Índices para consultas de stock (POS/Logística)
CREATE INDEX IF NOT EXISTS idx_product_stock_product_school_enabled
  ON product_stock (product_id, school_id)
  WHERE is_enabled = true;

-- ── 3) Buscador inteligente (fuzzy) para Stock Live ─────────────────────────
-- Nota: no dependemos de la extensión "unaccent" (en muchos proyectos no está
-- habilitada o no expone unaccent(text) en el search_path). Usamos translate
-- + lower (IMMUTABLE) para acentos comunes en español / catálogo retail.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS idx_products_name_trgm_unaccent;
DROP INDEX IF EXISTS idx_products_code_trgm_unaccent;

CREATE OR REPLACE FUNCTION f_search_norm_text(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- Cada carácter en "from" debe tener exactamente un carácter en "to" (misma longitud: 102).
  SELECT lower(
    translate(
      COALESCE(t, ''),
      'ÁÀÄÂÃÅĄĆČÇĎÐÉÈËÊĚĞÍÌÏÎİĹĽŁŃÑŇÓÒÖÔÕØŔŘŚŠŞŤŨÚÙÜÛŮÝŸŹŽ'
      || 'áàäâãåąćčçďðéèëêěğíìïîıĺľłńñňóòöôõøŕřśšşťũúùüûůýÿźž',
      'AAAAAAACCCDDEEEEEGIIIIILLLNNNOOOOOORRSSSTUUUUUUYYZZ'
      || 'aaaaaaacccddeeeeegiiiiilllnnnoooooorrssstuuuuuuyyzz'
    )
  );
$$;

-- Índices GIN para búsqueda por relevancia (nombre/código normalizado)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm_norm
  ON products
  USING gin (f_search_norm_text(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_code_trgm_norm
  ON products
  USING gin (f_search_norm_text(COALESCE(code, '')) gin_trgm_ops);

-- RPC único para la consola de stock en tiempo real
CREATE OR REPLACE FUNCTION search_inventory_stock_realtime(
  p_query     text DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_limit     integer DEFAULT 1000
)
RETURNS TABLE (
  product_id    uuid,
  product_name  text,
  product_code  text,
  school_id     uuid,
  school_name   text,
  current_stock integer,
  min_stock     integer,
  relevance     real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT f_search_norm_text(trim(COALESCE(p_query, ''))) AS term
  )
  SELECT
    p.id                                    AS product_id,
    p.name                                  AS product_name,
    p.code                                  AS product_code,
    s.id                                    AS school_id,
    s.name                                  AS school_name,
    ps.current_stock,
    COALESCE(p.min_stock, 0)                AS min_stock,
    CASE
      WHEN q.term = '' THEN 1::real
      ELSE GREATEST(
        similarity(f_search_norm_text(p.name), q.term),
        similarity(f_search_norm_text(COALESCE(p.code, '')), q.term)
      )::real
    END                                      AS relevance
  FROM product_stock ps
  JOIN products p ON p.id = ps.product_id
  JOIN schools  s ON s.id = ps.school_id
  CROSS JOIN q
  WHERE p.active = true
    AND ps.is_enabled = true
    AND (p_school_id IS NULL OR ps.school_id = p_school_id)
    AND (
      q.term = ''
      OR f_search_norm_text(p.name) % q.term
      OR f_search_norm_text(COALESCE(p.code, '')) % q.term
      OR f_search_norm_text(p.name) LIKE ('%' || q.term || '%')
      OR f_search_norm_text(COALESCE(p.code, '')) LIKE ('%' || q.term || '%')
    )
  ORDER BY
    CASE WHEN q.term = '' THEN 0 ELSE 1 END DESC,
    relevance DESC,
    p.name ASC,
    s.name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
$$;

GRANT EXECUTE ON FUNCTION search_inventory_stock_realtime(text, uuid, integer)
  TO authenticated, service_role;

SELECT 'INVENTORY SWITCH + REALTIME SEARCH OK' AS resultado;
