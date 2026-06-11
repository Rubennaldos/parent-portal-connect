-- ============================================================================
-- Vista Unificada de Pedidos de Almuerzo
-- SSOT para: Gestión de Pedidos, Entrega de Almuerzos, Reporte de Cocina
--
-- PROBLEMA RESUELTO:
--   Las tres pantallas calculaban "activo" con criterios distintos en JS:
--   • LunchOrders:         dual-query teacher/non-teacher + merge en memoria
--   • LunchDeliveryDashboard: .neq('frozen') sin manejar NULL (bug PostgreSQL)
--   • Comedor:             sin filtro de payment_flow_state en absoluto
--
-- SOLUCIÓN:
--   1. final_target_type   — tipo real del comensal resuelto en DB
--   2. is_active_unified   — criterio único de "pedido activo"
--   3. category_*_resolved — datos de categoría sin segunda query al frontend
-- ============================================================================

DROP VIEW IF EXISTS public.v_lunch_orders_unified;

CREATE VIEW public.v_lunch_orders_unified
WITH (security_invoker = true)
AS
SELECT
  -- Todas las columnas originales del pedido (sin cambios en las FK)
  lo.*,

  -- ── Tipo real del comensal (calculado en DB, no en JS) ──────────────
  -- Orden de precedencia:
  --   1. teacher_id IS NOT NULL → siempre 'teachers'
  --   2. student_id IS NOT NULL → siempre 'students'
  --   3. Pedido manual (caja/admin sin IDs) → usar target_type
  --      de la categoría del menú; fallback seguro a 'students'
  CASE
    WHEN lo.teacher_id IS NOT NULL THEN 'teachers'::text
    WHEN lo.student_id IS NOT NULL THEN 'students'::text
    ELSE COALESCE(lc.target_type, 'students')::text
  END AS final_target_type,

  -- ── Datos de categoría resueltos ────────────────────────────────────
  -- Evita la segunda query a lunch_categories en el frontend.
  -- COALESCE: usa category_id del menú si existe; si no, el del pedido
  -- (compatible con pedidos manuales que no tienen menu_id).
  lc.name        AS category_name_resolved,
  lc.icon        AS category_icon_resolved,
  lc.color       AS category_color_resolved,
  lc.target_type AS category_target_type,

  -- ── Flag de actividad unificada ─────────────────────────────────────
  -- TRUE cuando el pedido es "activo" según criterio único:
  --   • No cancelado (COALESCE para tolerar NULL en is_cancelled)
  --   • Para profesores (teacher_id NOT NULL): bypass total del filtro
  --     de payment_flow_state (docentes no usan pasarela de pago)
  --   • Para no-profesores: excluir frozen_pending_payment, PERO
  --     permitir NULL — corrige el bug de .neq() en PostgreSQL que
  --     excluye NULLs al comparar con <> (comportamiento de SQL estándar)
  (
    COALESCE(lo.is_cancelled, false) = false
    AND (
      lo.teacher_id IS NOT NULL
      OR lo.payment_flow_state IS NULL
      OR lo.payment_flow_state <> 'frozen_pending_payment'
    )
  ) AS is_active_unified

FROM public.lunch_orders lo
LEFT JOIN public.lunch_menus      lm ON lm.id = lo.menu_id
LEFT JOIN public.lunch_categories lc ON lc.id = COALESCE(lm.category_id, lo.category_id);

-- ── Permisos ────────────────────────────────────────────────────────────
GRANT SELECT ON public.v_lunch_orders_unified TO authenticated;
GRANT SELECT ON public.v_lunch_orders_unified TO anon;

COMMENT ON VIEW public.v_lunch_orders_unified IS
  'SSOT para clasificación y conteos de almuerzos. '
  'final_target_type: tipo de comensal resuelto en DB, incluye manuales de caja '
  'via target_type de categoría. '
  'is_active_unified: criterio unificado — no cancelado + no frozen, '
  'con bypass de payment_flow_state para profesores. '
  'Consume: LunchOrders.tsx, LunchDeliveryDashboard.tsx, Comedor.tsx.';
