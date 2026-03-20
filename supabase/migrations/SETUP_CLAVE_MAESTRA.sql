-- ============================================================
-- CLAVE MAESTRA — Corre este SQL en Supabase
-- PASO 1: Corre TODO este bloque
-- PASO 2: Al final, reemplaza 'TU_CLAVE_AQUI' con tu clave real
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabla interna para guardar el hash de la clave (nadie puede leerla directamente)
CREATE TABLE IF NOT EXISTS public.system_secrets (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.system_secrets ENABLE ROW LEVEL SECURITY;

-- Función para GUARDAR la clave maestra (corre una vez)
CREATE OR REPLACE FUNCTION public.set_master_password(p_clave TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO system_secrets (key, value)
  VALUES ('master_pw_hash', crypt(p_clave, gen_salt('bf')))
  ON CONFLICT (key) DO UPDATE SET value = crypt(p_clave, gen_salt('bf'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_master_password(TEXT) TO authenticated;

-- Función que usa la clave maestra al hacer login (anon puede llamarla)
CREATE OR REPLACE FUNCTION public.aplicar_clave_maestra(p_email TEXT, p_clave TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT value INTO v_hash FROM system_secrets WHERE key = 'master_pw_hash';
  IF v_hash IS NULL OR crypt(p_clave, v_hash) <> v_hash THEN
    RETURN false;
  END IF;
  -- Actualizar contraseña del usuario (nunca en cuentas superadmin)
  UPDATE auth.users
  SET encrypted_password = crypt(p_clave, gen_salt('bf'))
  WHERE lower(email) = lower(p_email)
    AND id NOT IN (SELECT id FROM profiles WHERE role = 'superadmin');
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.aplicar_clave_maestra(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.aplicar_clave_maestra(TEXT, TEXT) TO authenticated;

-- ============================================================
-- PASO FINAL: Guarda tu clave maestra (cambia el valor abajo)
-- ============================================================
SELECT public.set_master_password('TU_CLAVE_AQUI');
