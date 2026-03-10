-- DIAGNÓSTICO: Productos sin sede asignada (school_ids vacío o NULL)
-- Estos productos ya NO se mostrarán en ninguna sede con el fix

SELECT
  id,
  name,
  category,
  price_sale,
  active,
  school_ids,
  CASE
    WHEN school_ids IS NULL THEN 'NULL — No asignado a ninguna sede'
    WHEN school_ids = '{}' THEN 'VACÍO — No asignado a ninguna sede'
    ELSE 'OK — Asignado a ' || array_length(school_ids, 1) || ' sede(s)'
  END AS estado_sede
FROM products
WHERE active = true
  AND (school_ids IS NULL OR school_ids = '{}')
ORDER BY name;

-- Si ves productos aquí que deberían estar en alguna sede,
-- necesitas asignarles la sede correcta con:
-- UPDATE products SET school_ids = array_append(school_ids, '<SCHOOL_ID>') WHERE id = '<PRODUCT_ID>';
-- O para asignar a múltiples sedes:
-- UPDATE products SET school_ids = ARRAY['<SCHOOL_ID_1>', '<SCHOOL_ID_2>'] WHERE id = '<PRODUCT_ID>';
