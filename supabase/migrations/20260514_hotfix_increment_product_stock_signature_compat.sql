-- ============================================================
-- HOTFIX — Compatibilidad de firma increment_product_stock
-- ============================================================
-- Problema:
--   process_ingress_bulk invoca increment_product_stock con 6 args
--   (incluyendo p_uom_id), pero algunos entornos solo tienen la
--   versión de 5 args.
--
-- Solución segura:
--   Crear una sobrecarga de 6 args SOLO si no existe.
--   Esta sobrecarga delega a la función legacy de 5 args.
--
-- Impacto:
--   Aditivo, reversible, no rompe lógica existente.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.increment_product_stock(uuid,uuid,integer,uuid,text,uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.increment_product_stock(
        p_product_id uuid,
        p_school_id  uuid,
        p_quantity   integer,
        p_entry_id   uuid DEFAULT NULL,
        p_reason     text DEFAULT NULL,
        p_uom_id     uuid
      )
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        -- Compatibilidad: ignoramos p_uom_id si solo existe la firma legacy.
        PERFORM public.increment_product_stock(
          p_product_id,
          p_school_id,
          p_quantity,
          p_entry_id,
          p_reason::text
        );
      END;
      $body$;
    $fn$;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_product_stock(uuid,uuid,integer,uuid,text,uuid)
  TO authenticated, service_role;

SELECT 'HOTFIX OK: compatibilidad de firma increment_product_stock (6 args)' AS resultado;
