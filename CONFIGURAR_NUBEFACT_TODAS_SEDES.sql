-- ============================================================
-- CONFIGURAR NUBEFACT PARA TODAS LAS SEDES
-- ============================================================
-- Este script configura automáticamente Nubefact para todas las sedes
-- sin necesidad de escribir UUIDs manualmente.

-- Primero, asegurarse de que las columnas existan (por si acaso)
ALTER TABLE billing_config ADD COLUMN IF NOT EXISTS nubefact_ruta    TEXT    DEFAULT '';
ALTER TABLE billing_config ADD COLUMN IF NOT EXISTS nubefact_token   TEXT    DEFAULT '';
ALTER TABLE billing_config ADD COLUMN IF NOT EXISTS serie_boleta     TEXT    DEFAULT 'B001';
ALTER TABLE billing_config ADD COLUMN IF NOT EXISTS serie_factura    TEXT    DEFAULT 'F001';
ALTER TABLE billing_config ADD COLUMN IF NOT EXISTS activo           BOOLEAN DEFAULT true;

-- Insertar configuración de Nubefact para TODAS las sedes que aún no la tienen
INSERT INTO billing_config (school_id, nubefact_ruta, nubefact_token, serie_boleta, serie_factura, activo)
SELECT 
  s.id,
  'https://api.nubefact.com/api/v1/25e0813b-ffd4-4ada-883e-0a4ec12cbb1c',
  '2ce70da1974540c4b7dd9e0598f87114a8490533d5994d0eacc4575c6130cfc8',
  'B001',
  'F001',
  true
FROM schools s
WHERE NOT EXISTS (
  SELECT 1 FROM billing_config bc WHERE bc.school_id = s.id
);

-- Si ya existen registros, actualizarlos con las credenciales de Nubefact
UPDATE billing_config 
SET 
  nubefact_ruta  = 'https://api.nubefact.com/api/v1/25e0813b-ffd4-4ada-883e-0a4ec12cbb1c',
  nubefact_token = '2ce70da1974540c4b7dd9e0598f87114a8490533d5994d0eacc4575c6130cfc8',
  activo = true
WHERE nubefact_ruta IS NULL OR nubefact_ruta = '' OR nubefact_token IS NULL OR nubefact_token = '';

-- Verificar resultado
SELECT 
  s.name AS sede,
  bc.nubefact_ruta IS NOT NULL AND bc.nubefact_ruta != '' AS tiene_ruta,
  bc.nubefact_token IS NOT NULL AND bc.nubefact_token != '' AS tiene_token,
  bc.activo AS activo
FROM schools s
LEFT JOIN billing_config bc ON bc.school_id = s.id
ORDER BY s.name;
