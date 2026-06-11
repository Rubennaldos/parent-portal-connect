-- Incluye admin_general en check_is_admin() para alinear RLS con la app.
-- Sin esto, products_admin_all rechaza INSERT en products (403 RLS).
-- Reversible: volver a definir la función sin admin_general si hiciera falta.

CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin', 'admin_general')
  );
END;
$$;

COMMENT ON FUNCTION public.check_is_admin() IS
  'True si el usuario autenticado es admin de plataforma: admin, superadmin o admin_general.';
