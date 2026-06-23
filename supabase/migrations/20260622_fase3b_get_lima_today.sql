-- ============================================================================
-- FASE 3B — get_lima_today()
-- Proyecto: Lima Café 28  ·  Fecha: 2026-06-22
-- ============================================================================
--
-- PROPÓSITO:
--   Expone la fecha actual en la zona horaria oficial (America/Lima) como
--   una función RPC callable desde el frontend.
--
-- REGLA QUE APLICA (Regla 11.C — El Reloj Único):
--   PROHIBIDO usar new Date() o cálculos de offset manual en JavaScript para
--   determinar la fecha de emisión de comprobantes. La fuente de verdad del
--   tiempo es PostgreSQL (now() AT TIME ZONE 'America/Lima').
--   Perú no tiene horario de verano. America/Lima = UTC-5 permanente.
--
-- USO:
--   EmitirComprobanteModal.tsx lo invoca al abrir el modal para obtener la
--   fecha de emisión correcta en Lima antes de enviarla a generate-document.
--   Sin esta función, el modal usaba hoyLima() = new Date() - 5h, que puede
--   estar manipulado o ser incorrecto si el reloj del dispositivo no es exacto.
--
-- SEGURIDAD:
--   SECURITY DEFINER + STABLE (no mutating, cacheable por sesión).
--   No accede a ninguna tabla; solo evalúa now() en la zona horaria correcta.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_lima_today()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (timezone('America/Lima', now()))::date;
$$;

COMMENT ON FUNCTION public.get_lima_today() IS
  'Devuelve la fecha actual en America/Lima (UTC-5, sin horario de verano). '
  'Usar en el frontend para emission_date de comprobantes manuales. '
  'Regla 11.C: PROHIBIDO usar new Date() para decisiones de tiempo financiero.';

GRANT EXECUTE ON FUNCTION public.get_lima_today() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lima_today() TO anon;
GRANT EXECUTE ON FUNCTION public.get_lima_today() TO service_role;

-- ============================================================================
-- VERIFICACIÓN (solo lectura)
-- ============================================================================
-- SELECT public.get_lima_today();
-- → debe devolver la fecha de hoy en Lima (formato YYYY-MM-DD)
-- ============================================================================
