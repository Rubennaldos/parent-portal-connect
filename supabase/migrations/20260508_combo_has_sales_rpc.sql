-- ============================================================
-- Fase 6.3 soporte de trazabilidad: detectar combos con ventas
-- ============================================================
-- Permite que el frontend pregunte:
-- "¿Actualizar este combo o crear uno nuevo basado en este?"
-- cuando el combo ya fue vendido.

CREATE OR REPLACE FUNCTION public.combo_has_sales(p_combo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sales s
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.items, '[]'::jsonb)) item
    WHERE item->>'product_id' = ('combo_' || p_combo_id::text)
  );
$$;

COMMENT ON FUNCTION public.combo_has_sales(UUID) IS
'Retorna true si existe al menos una venta histórica con líneas que referencian el combo virtual combo_<uuid>.';

REVOKE ALL ON FUNCTION public.combo_has_sales(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.combo_has_sales(UUID) TO authenticated;
