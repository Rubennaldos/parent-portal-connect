-- ============================================================================
-- create_lunch_orders_batch_v2
-- Fecha: 2026-06-18
--
-- PROBLEMA RESUELTO:
--   LunchOrderCalendar.tsx enviaba N peticiones HTTP secuenciales al backend
--   (una por cada fecha seleccionada). Overhead HTTP por petición: verificación
--   JWT, routing, pool de conexiones. Con 8 fechas: 8 viajes de red.
--   Con 100 padres en simultáneo a las 8:00 AM: hasta 800 conexiones activas.
--   Aunque son secuenciales por usuario (no simultáneas), el overhead acumulado
--   satura el pool de conexiones de Supabase.
--
-- SOLUCIÓN:
--   Un solo viaje HTTP por alumno. El loop vive ahora en PostgreSQL, no en el
--   frontend. Para N fechas y 1 alumno: 1 HTTP call, N transacciones SQL internas.
--
-- DISEÑO DE IDEMPOTENCIA POR ITERACIÓN:
--   Cada fecha se procesa en un bloque BEGIN...EXCEPTION...END independiente,
--   que equivale a un SAVEPOINT de PostgreSQL. Si la fecha 3 falla (duplicate,
--   deadline, etc.), las fechas 1 y 2 ya confirmadas NO se revierten.
--   Un error en una fecha nunca cancela los pedidos exitosos anteriores.
--
-- MANEJO DE DUPLICADOS:
--   Si una fecha devuelve LUNCH_DUPLICATE (el índice único detecta que ya
--   existe el pedido), se trata como éxito (idempotente): la madre probablemente
--   está reintentando tras un error de red, y el pedido ya está registrado.
--
-- FIRMA:
--   p_date_menus JSONB — arreglo de objetos:
--     [{
--       "order_date":  "2026-06-12",
--       "category_id": "<UUID>",
--       "menu_id":     "<UUID>",
--       "description": "Almuerzo - 12 de junio"   ← opcional
--     }, ...]
--
-- RETORNO:
--   {
--     "succeeded": ["2026-06-12", "2026-06-15"],
--     "failed":    [{"date": "2026-06-13", "reason": "SPENDING_LIMIT: ..."}],
--     "total":     8
--   }
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_lunch_orders_batch_v2(
  p_person_type   TEXT,
  p_person_id     UUID,
  p_school_id     UUID,
  p_base_price    NUMERIC,
  p_final_price   NUMERIC,
  p_created_by    UUID,
  p_source        TEXT     DEFAULT 'parent_lunch_calendar',
  p_category_name TEXT     DEFAULT 'Almuerzo',
  p_date_menus    JSONB    DEFAULT '[]'::JSONB  -- [{order_date, category_id, menu_id[, description]}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_entry      JSONB;
  v_order_date DATE;
  v_cat_id     UUID;
  v_menu_id    UUID;
  v_desc       TEXT;
  v_err_msg    TEXT;
  v_succeeded  JSONB := '[]'::JSONB;
  v_failed     JSONB := '[]'::JSONB;
BEGIN
  -- Validación básica: tipo de persona
  IF p_person_type NOT IN ('student', 'teacher') THEN
    RAISE EXCEPTION 'BATCH_INVALID_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  -- Guardia para arreglo vacío
  IF p_date_menus IS NULL OR jsonb_array_length(p_date_menus) = 0 THEN
    RETURN jsonb_build_object('succeeded', '[]'::JSONB, 'failed', '[]'::JSONB, 'total', 0);
  END IF;

  -- ── Bucle interno en la base de datos ─────────────────────────────────────
  -- Cada iteración es un SAVEPOINT (BEGIN...EXCEPTION...END de PL/pgSQL).
  -- Un fallo en la iteración X revierte solo esa iteración; las anteriores
  -- exitosas permanecen confirmadas dentro de la transacción padre.
  FOR v_entry IN SELECT jsonb_array_elements(p_date_menus)
  LOOP
    v_order_date := (v_entry->>'order_date')::DATE;
    v_cat_id     := (v_entry->>'category_id')::UUID;
    v_menu_id    := (v_entry->>'menu_id')::UUID;
    v_desc       := COALESCE(
                      v_entry->>'description',
                      p_category_name || ' - ' || TO_CHAR(v_order_date, 'YYYY-MM-DD')
                    );

    BEGIN
      -- Llamada a la RPC atómica existente.
      -- Si ya existía el pedido (LUNCH_DUPLICATE), la excepción es capturada
      -- y el resultado se cuenta como éxito (comportamiento idempotente).
      PERFORM public.create_lunch_order_v2(
        p_person_type             := p_person_type,
        p_person_id               := p_person_id,
        p_order_date              := v_order_date,
        p_category_id             := v_cat_id,
        p_menu_id                 := v_menu_id,
        p_school_id               := p_school_id,
        p_quantity                := 1,
        p_base_price              := p_base_price,
        p_final_price             := p_final_price,
        p_created_by              := p_created_by,
        p_source                  := p_source,
        p_category_name           := p_category_name,
        p_description             := v_desc,
        p_selected_modifiers      := NULL,
        p_selected_garnishes      := NULL,
        p_configurable_selections := NULL,
        p_parent_notes            := NULL
      );

      v_succeeded := v_succeeded || jsonb_build_array(v_order_date::TEXT);

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;

      -- LUNCH_DUPLICATE = el pedido ya existe (retento de red del padre).
      -- Tratar como éxito para no alarmar innecesariamente.
      IF v_err_msg LIKE 'LUNCH_DUPLICATE%' THEN
        v_succeeded := v_succeeded || jsonb_build_array(v_order_date::TEXT);
      ELSE
        v_failed := v_failed || jsonb_build_object(
          'date',   v_order_date::TEXT,
          'reason', v_err_msg
        );
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'succeeded', v_succeeded,
    'failed',    v_failed,
    'total',     jsonb_array_length(p_date_menus)
  );
END;
$$;

COMMENT ON FUNCTION public.create_lunch_orders_batch_v2 IS
  'Ejecuta create_lunch_order_v2 para múltiples fechas en un solo viaje HTTP. '
  'Cada fecha es un SAVEPOINT independiente: fallos parciales no revierten '
  'los éxitos anteriores. LUNCH_DUPLICATE se trata como éxito (idempotencia). '
  'Reemplaza el loop de N llamadas HTTP desde LunchOrderCalendar.tsx. '
  'Ver migración 20260618_b para contexto.';

REVOKE ALL    ON FUNCTION public.create_lunch_orders_batch_v2 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lunch_orders_batch_v2 TO authenticated;

COMMIT;

SELECT 'create_lunch_orders_batch_v2 ✅ creado' AS resultado;
