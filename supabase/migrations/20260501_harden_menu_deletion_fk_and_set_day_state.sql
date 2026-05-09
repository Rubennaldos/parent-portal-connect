-- ============================================================================
-- 2026-05-01 — Hardening crítico: prevenir borrado masivo de pedidos por menú
--
-- INCIDENTE:
--   lunch_orders.menu_id tenía ON DELETE CASCADE hacia lunch_menus(id).
--   Al borrar un menú, se podían borrar pedidos relacionados en cascada.
--
-- OBJETIVOS:
--   1) Cambiar FK a ON DELETE RESTRICT (bloquea borrado de menú con pedidos).
--   2) Blindar set_day_state para evitar sin_menu global accidental.
--   3) Bloquear sin_menu cuando ya existen pedidos activos en la(s) sede(s).
--   4) Auditar INSERT/UPDATE/DELETE de lunch_menus en audit_billing_logs.
-- ============================================================================

BEGIN;

-- 1) Blindaje de integridad referencial: nunca borrar pedidos por cascada.
ALTER TABLE public.lunch_orders
  DROP CONSTRAINT IF EXISTS lunch_orders_menu_id_fkey;

ALTER TABLE public.lunch_orders
  ADD CONSTRAINT lunch_orders_menu_id_fkey
  FOREIGN KEY (menu_id)
  REFERENCES public.lunch_menus(id)
  ON DELETE RESTRICT;

-- Índice recomendado para validar/restringir DELETE rápido por menu_id.
CREATE INDEX IF NOT EXISTS idx_lunch_orders_menu_id
  ON public.lunch_orders(menu_id);

-- 2) Auditoría completa sobre lunch_menus (incluye DELETE).
DROP TRIGGER IF EXISTS trg_audit_lunch_menus ON public.lunch_menus;
CREATE TRIGGER trg_audit_lunch_menus
AFTER INSERT OR UPDATE OR DELETE ON public.lunch_menus
FOR EACH ROW EXECUTE FUNCTION public.log_billing_audit_event();

-- 3) set_day_state endurecida: sin_menu requiere sedes explícitas
--    y falla si hay pedidos activos en esa fecha/sede.
CREATE OR REPLACE FUNCTION public.set_day_state(
  p_date DATE,
  p_type TEXT, -- 'feriado', 'no_laborable', 'sin_menu', 'con_menu'
  p_school_ids UUID[] DEFAULT NULL, -- NULL = todas las sedes (solo permitido para feriado/no_laborable)
  p_title TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
  v_has_active_orders BOOLEAN := FALSE;
BEGIN
  -- A) BORRADO DE MENÚS: bloqueado global y con guard de pedidos.
  IF p_type = 'sin_menu' THEN
    -- Nunca permitir borrado global accidental.
    IF p_school_ids IS NULL OR cardinality(p_school_ids) = 0 THEN
      RAISE EXCEPTION
        'SIN_MENU_GLOBAL_BLOCKED: Debe seleccionar al menos una sede para aplicar "sin_menu".';
    END IF;

    -- Si ya hay pedidos activos, no permitir borrar menús.
    SELECT EXISTS (
      SELECT 1
      FROM public.lunch_orders lo
      WHERE lo.order_date = p_date
        AND lo.school_id = ANY(p_school_ids)
        AND COALESCE(lo.is_cancelled, false) = false
        AND lo.status <> 'cancelled'
    )
    INTO v_has_active_orders;

    IF v_has_active_orders THEN
      RAISE EXCEPTION
        'CANNOT_DELETE_MENU_WITH_ORDERS: Existen pedidos activos para esta fecha/sede. Cancele/regularice pedidos antes de borrar menús.';
    END IF;

    DELETE FROM public.lunch_menus
    WHERE date = p_date
      AND school_id = ANY(p_school_ids);

    DELETE FROM public.special_days
    WHERE date = p_date
      AND (school_id = ANY(p_school_ids) OR school_id IS NULL);

    RETURN;
  END IF;

  -- B) RESTAURAR DÍA "CON MENÚ": limpia marca especial sin tocar menús.
  IF p_type = 'con_menu' THEN
    IF p_school_ids IS NULL OR cardinality(p_school_ids) = 0 THEN
      DELETE FROM public.special_days WHERE date = p_date;
    ELSE
      DELETE FROM public.special_days
      WHERE date = p_date
        AND (school_id = ANY(p_school_ids) OR school_id IS NULL);
    END IF;
    RETURN;
  END IF;

  -- C) Días especiales: se mantiene comportamiento existente.
  IF p_type IN ('feriado', 'no_laborable') THEN
    IF p_school_ids IS NULL OR cardinality(p_school_ids) = 0 THEN
      INSERT INTO public.special_days (date, type, title, school_id)
      VALUES (
        p_date,
        p_type,
        COALESCE(p_title, CASE WHEN p_type = 'feriado' THEN 'Feriado' ELSE 'No Laborable' END),
        NULL
      )
      ON CONFLICT (date, school_id)
      DO UPDATE SET
        type = EXCLUDED.type,
        title = EXCLUDED.title;
    ELSE
      FOREACH v_school_id IN ARRAY p_school_ids LOOP
        INSERT INTO public.special_days (date, type, title, school_id)
        VALUES (
          p_date,
          p_type,
          COALESCE(p_title, CASE WHEN p_type = 'feriado' THEN 'Feriado' ELSE 'No Laborable' END),
          v_school_id
        )
        ON CONFLICT (date, school_id)
        DO UPDATE SET
          type = EXCLUDED.type,
          title = EXCLUDED.title;
      END LOOP;
    END IF;
    RETURN;
  END IF;

  -- D) Tipo inválido.
  RAISE EXCEPTION
    'INVALID_DAY_STATE_TYPE: p_type "%" no es válido. Use feriado/no_laborable/sin_menu/con_menu.',
    p_type;
END;
$$;

COMMENT ON FUNCTION public.set_day_state(date, text, uuid[], text) IS
'Versión endurecida: bloquea sin_menu global accidental y evita borrar menús si existen pedidos activos.';

COMMIT;
