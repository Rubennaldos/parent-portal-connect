-- Fecha oficial de hoy en zona horaria Perú desde la DB.
-- Uso: frontend de pedidos de almuerzo para inicializar filtros sin depender del reloj del dispositivo.

CREATE OR REPLACE FUNCTION public.get_lima_today_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (timezone('America/Lima', now()))::date;
$$;

COMMENT ON FUNCTION public.get_lima_today_date() IS
  'Devuelve la fecha actual en America/Lima usando el reloj de PostgreSQL.';

GRANT EXECUTE ON FUNCTION public.get_lima_today_date() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lima_today_date() TO service_role;

SELECT '20260511_get_lima_today_date ✅ listo' AS resultado;
