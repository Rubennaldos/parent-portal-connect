-- ============================================================
-- HOTFIX 2 — Resolver ambigüedad de firma increment_product_stock
-- ============================================================
-- Error observado:
--   function public.increment_product_stock(uuid, uuid, integer, uuid, text) is not unique
--
-- Causa:
--   coexistencia de firma legacy (5 args) + firma 6 args con DEFAULT
--   en el último parámetro, que permite llamadas de 5 args ambiguas.
--
-- Solución:
--   Reemplazar la firma de 6 args SIN DEFAULTS para que siempre
--   requiera 6 parámetros y no compita con la de 5 args.
-- ============================================================

DROP FUNCTION IF EXISTS public.increment_product_stock(uuid, uuid, integer, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.increment_product_stock(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,
  p_entry_id   uuid,
  p_reason     text,
  p_uom_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Compatibilidad controlada: delega en la firma legacy de 5 args.
  -- p_uom_id se ignora en entornos donde aún no existe conversión UoM.
  PERFORM public.increment_product_stock(
    p_product_id,
    p_school_id,
    p_quantity,
    p_entry_id,
    p_reason::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_product_stock(uuid, uuid, integer, uuid, text, uuid)
  TO authenticated, service_role;

SELECT 'HOTFIX 2 OK: firma 6 args sin defaults (ambigüedad resuelta)' AS resultado;
