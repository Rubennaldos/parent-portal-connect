-- ============================================================
-- Búsqueda insensible a MAYÚSCULAS y TILDES (acentos)
-- ============================================================
-- Objetivo:
--   Un solo normalizador para toda búsqueda que use normalize_search():
--   - Forma canónica Unicode NFC (evita letras “partidas” en dos caracteres)
--   - minúsculas (lower)
--   - sin tildes / diacríticos comunes (unaccent)
--   - sin espacios extremos (btrim)
--   - NULL se trata como cadena vacía (sin STRICT: el índice y el filtro coinciden)
--
-- Afecta: search_persons_v2, search_lunch_order_ids, índices GIN que usan normalize_search().
--
-- Operación post-despliegue (recomendado si notás resultados raros tras el cambio):
--   Los índices GIN guardan el valor ya normalizado; si el cuerpo de la función
--   cambia, conviene reindexar expresiones que dependan de ella.
--   En SQL Editor (fuera de transacción larga), por ejemplo:
--     REINDEX INDEX CONCURRENTLY public.idx_students_name_trgm;
--     REINDEX INDEX CONCURRENTLY public.idx_teacher_profiles_name_trgm;
--     REINDEX INDEX CONCURRENTLY public.idx_lunch_orders_manual_name_trgm;
--     REINDEX INDEX CONCURRENTLY public.idx_students_full_name_trgm_lunch_search;
--     REINDEX INDEX CONCURRENTLY public.idx_teacher_profiles_full_name_trgm_lunch_search;
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.normalize_search(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.unaccent(
    lower(
      btrim(
        normalize(coalesce(t, '')::text, nfc)
      )
    )
  );
$$;

COMMENT ON FUNCTION public.normalize_search(text) IS
  'Texto para búsqueda: NFC + minúsculas + sin tildes (unaccent). Insensible a mayúsculas y acentos.';
