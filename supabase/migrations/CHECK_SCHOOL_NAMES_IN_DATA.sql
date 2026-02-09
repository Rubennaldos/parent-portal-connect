-- =====================================================
-- BUSCAR "SAN JORGE" EN TODAS LAS TABLAS
-- =====================================================

-- 1. Verificar en transacciones
SELECT 
  '🔍 TRANSACCIONES CON SAN JORGE' as tipo,
  COUNT(*) as cantidad
FROM transactions
WHERE description ILIKE '%san jorge%';

-- 2. Verificar en órdenes de almuerzo
SELECT 
  '🔍 ORDENES DE ALMUERZO' as tipo,
  COUNT(*) as cantidad
FROM lunch_orders lo
JOIN schools s ON lo.school_id = s.id
WHERE s.name ILIKE '%san jorge%';

-- 3. Verificar en menús de almuerzo
SELECT 
  '🔍 MENUS DE ALMUERZO' as tipo,
  COUNT(*) as cantidad
FROM lunch_menus lm
JOIN schools s ON lm.school_id = s.id
WHERE s.name ILIKE '%san jorge%';

-- 4. Verificar en profiles de administradores
SELECT 
  '🔍 ADMIN PROFILES' as tipo,
  email,
  role,
  school_id,
  (SELECT name FROM schools WHERE id = admin_profiles.school_id) as school_name
FROM admin_profiles
WHERE school_id IN (
  SELECT id FROM schools WHERE name ILIKE '%saint%' OR name ILIKE '%george%'
);

-- 5. Ver si hay datos con nombres de escuelas mal escritos en metadata
SELECT 
  '🔍 TRANSACTIONS METADATA' as tipo,
  id,
  description,
  metadata,
  created_at
FROM transactions
WHERE metadata::text ILIKE '%san jorge%'
   OR metadata::text ILIKE '%san_jorge%'
LIMIT 10;

-- 6. Verificar school_configs
SELECT 
  '🔍 SCHOOL CONFIGS' as tipo,
  sc.id,
  s.name as school_name,
  sc.lunch_price,
  sc.updated_at
FROM school_configs sc
JOIN schools s ON sc.school_id = s.id
WHERE s.name ILIKE '%saint%' OR s.name ILIKE '%george%';
