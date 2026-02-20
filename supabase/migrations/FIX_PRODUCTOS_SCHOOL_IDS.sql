-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  FIX: Reparar productos sin la sede MC1 asignada            ║
-- ║  MC1 school_id: 9963c14c-22ff-4fcb-b5cc-599596896daa       ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════
-- PASO 1: Ver TODOS los productos que NO tienen MC1
-- (para saber cuántos hay afectados)
-- ═══════════════════════════════════════════════════
SELECT id, name, category, school_ids, active
FROM products
WHERE NOT (school_ids::text[] @> ARRAY['9963c14c-22ff-4fcb-b5cc-599596896daa']::text[])
  AND active = true
ORDER BY name;

-- ═══════════════════════════════════════════════════
-- PASO 2: Agregar MC1 al CAFE AMERICANO - 8 OZ
-- (el producto que reportó el gestor)
-- ═══════════════════════════════════════════════════
UPDATE products
SET school_ids = array_append(school_ids, '9963c14c-22ff-4fcb-b5cc-599596896daa')
WHERE id = '07685b1a-2e2d-46b4-94b3-2fab56310441';

-- ═══════════════════════════════════════════════════
-- PASO 3 (OPCIONAL): Agregar MC1 a TODOS los productos
-- activos que no la tienen (para que MC1 vea todo)
-- ⚠️ EJECUTAR SOLO SI QUIERES QUE MC1 VEA TODOS
-- ═══════════════════════════════════════════════════
-- UPDATE products
-- SET school_ids = CASE
--     WHEN school_ids IS NULL THEN ARRAY['9963c14c-22ff-4fcb-b5cc-599596896daa']::text[]
--     ELSE array_append(school_ids, '9963c14c-22ff-4fcb-b5cc-599596896daa')
-- END
-- WHERE active = true
--   AND NOT (COALESCE(school_ids, '{}')::text[] @> ARRAY['9963c14c-22ff-4fcb-b5cc-599596896daa']::text[]);

-- ═══════════════════════════════════════════════════
-- PASO 4: Verificación — confirmar que ahora sí tiene MC1
-- ═══════════════════════════════════════════════════
SELECT id, name, school_ids
FROM products
WHERE id = '07685b1a-2e2d-46b4-94b3-2fab56310441';

-- ═══════════════════════════════════════════════════
-- DIAGNÓSTICO EXTRA: Cuántos productos ve cada sede
-- ═══════════════════════════════════════════════════
SELECT 
  s.name AS sede,
  s.id AS school_id,
  COUNT(*) AS productos_visibles
FROM schools s
CROSS JOIN products p
WHERE p.active = true
  AND (
    p.school_ids::text[] @> ARRAY[s.id::text]
    OR p.school_ids = '{}'
    OR p.school_ids IS NULL
  )
GROUP BY s.id, s.name
ORDER BY s.name;
