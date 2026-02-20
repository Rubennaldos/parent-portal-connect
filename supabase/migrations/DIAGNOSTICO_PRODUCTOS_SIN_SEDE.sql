-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  DIAGNÓSTICO: Productos que no aparecen en el POS           ║
-- ║  Buscar productos con school_ids mal configurados           ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- 1) ¿Cuál es el school_id del usuario matiasmc1?
SELECT p.id, p.full_name, p.email, p.school_id, s.name AS school_name
FROM profiles p
LEFT JOIN schools s ON s.id = p.school_id
WHERE p.email = 'matiasmc1@limacafe28.com';

-- 2) ¿Qué school_ids tiene "CAFE AMERICANO - 8 OZ"?
SELECT id, name, code, category, active, school_ids, price_sale, created_at
FROM products
WHERE name ILIKE '%cafe americano%'
   OR name ILIKE '%cafe expreso%'
   OR name ILIKE '%cafe con leche%';

-- 3) Todos los productos que tienen school_ids NULL o vacío (potencialmente perdidos)
SELECT id, name, school_ids, active, created_at
FROM products
WHERE school_ids IS NULL OR school_ids = '{}'
ORDER BY name;

-- 4) Productos que NO pertenecen a la sede de matiasmc1 pero existen
-- (reemplazar SCHOOL_ID_MC1 con el ID real de la sede)
-- SELECT id, name, school_ids
-- FROM products
-- WHERE NOT (school_ids @> ARRAY[(SELECT school_id FROM profiles WHERE email = 'matiasmc1@limacafe28.com')])
--   AND school_ids IS NOT NULL
--   AND school_ids != '{}'
-- ORDER BY name;

-- 5) Vista completa: ¿Cuántos productos ve cada sede?
SELECT 
  s.name AS sede,
  s.id AS school_id,
  COUNT(*) AS productos_visibles
FROM schools s
CROSS JOIN products p
WHERE p.active = true
  AND (
    p.school_ids @> ARRAY[s.id]
    OR p.school_ids = '{}'
    OR p.school_ids IS NULL
  )
GROUP BY s.id, s.name
ORDER BY s.name;
