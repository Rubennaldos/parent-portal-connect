-- PIN de autorización por sede
-- El admin/gestor_unidad de cada sede configura este PIN.
-- Los cajeros lo ingresan para autorizar anulaciones de ventas.
-- NO es la contraseña de login — es un código corto de autorización interno.

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS manager_pin VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN schools.manager_pin
  IS 'PIN de autorización que el cajero debe ingresar para anular ventas. Lo configura el admin de la sede.';
