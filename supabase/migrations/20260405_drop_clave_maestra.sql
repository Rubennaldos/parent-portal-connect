-- ─────────────────────────────────────────────────────────────────────────────
-- Eliminación definitiva del RPC aplicar_clave_maestra
--
-- Este RPC permitía cambiar contraseñas de usuarios usando una "clave maestra"
-- hardcodeada en VITE_MASTER_PASSWORD. Fue reemplazado por la Edge Function
-- admin-impersonate, que tiene verificación de rol, auditoría y expiración.
--
-- EJECUTAR en: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Eliminar todas las variantes posibles (con y sin parámetros tipados)
DROP FUNCTION IF EXISTS aplicar_clave_maestra(text, text);
DROP FUNCTION IF EXISTS aplicar_clave_maestra(p_email text, p_clave text);
DROP FUNCTION IF EXISTS public.aplicar_clave_maestra(text, text);
DROP FUNCTION IF EXISTS public.aplicar_clave_maestra(p_email text, p_clave text);

-- Confirmar que ya no existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'aplicar_clave_maestra'
  ) THEN
    RAISE WARNING 'ADVERTENCIA: aplicar_clave_maestra todavía existe. Revisar manualmente.';
  ELSE
    RAISE NOTICE 'OK: aplicar_clave_maestra eliminada correctamente.';
  END IF;
END $$;
