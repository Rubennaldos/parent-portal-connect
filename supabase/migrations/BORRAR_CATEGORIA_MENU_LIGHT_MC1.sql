-- =====================================================================
-- ELIMINAR categorías "Menú Light" de MC1
-- Problema: cascade a lunch_menus de febrero genera conflicto de unicidad
-- SOLUCIÓN: Borrar primero los lunch_menus de febrero de esas categorías
--           (ya son historia, febrero terminó)
-- =====================================================================

-- ──────────────────────────────────────────────────────────────────────
-- OPCIÓN A (RECOMENDADA): Desactivar las categorías
-- No borra nada, solo las oculta del sistema. Sin riesgos.
-- ──────────────────────────────────────────────────────────────────────
UPDATE lunch_categories
SET is_active = false
WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND name ILIKE '%light%';

-- Verificar
SELECT id, name, is_active FROM lunch_categories
WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND name ILIKE '%light%';


-- ──────────────────────────────────────────────────────────────────────
-- OPCIÓN B: Borrado completo (más pasos, pero definitivo)
-- ──────────────────────────────────────────────────────────────────────

-- B1: Ver menús de FEBRERO de estas categorías (los que generan el conflicto)
SELECT lm.id, lm.date, lm.main_course, lc.name AS categoria
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
WHERE lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND lc.name ILIKE '%light%'
  AND lm.date BETWEEN '2026-02-01' AND '2026-02-28'
ORDER BY lm.date;

-- B2: Confirmar que esos menús de febrero NO tienen pedidos activos
SELECT COUNT(*) AS pedidos_de_febrero_debe_ser_0
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
WHERE lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND lc.name ILIKE '%light%'
  AND lm.date BETWEEN '2026-02-01' AND '2026-02-28'
  AND lo.status NOT IN ('cancelled');

-- B3: Borrar los lunch_menus de FEBRERO de esas categorías
--     (Solo ejecutar si B2 devolvió 0)
DELETE FROM lunch_menus
WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND category_id IN (
      SELECT id FROM lunch_categories
      WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
        AND name ILIKE '%light%'
  )
  AND date BETWEEN '2026-02-01' AND '2026-02-28';

-- B4: Borrar los lunch_menus de MARZO (ya los vimos: 0 pedidos)
DELETE FROM lunch_menus
WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND category_id IN (
      SELECT id FROM lunch_categories
      WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
        AND name ILIKE '%light%'
  )
  AND date BETWEEN '2026-03-01' AND '2026-03-31';

-- B5: Desvincular pedidos de febrero (category_id = NULL)
UPDATE lunch_orders
SET category_id = NULL
WHERE category_id IN (
    SELECT id FROM lunch_categories
    WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
      AND name ILIKE '%light%'
);

-- B6: Ahora sí borrar las categorías (sin conflicto de cascade)
DELETE FROM lunch_categories
WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND name ILIKE '%light%';

-- B7: Verificación final
SELECT
    (SELECT COUNT(*) FROM lunch_categories
     WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
       AND name ILIKE '%light%') AS categorias_debe_ser_0,
    (SELECT COUNT(*) FROM lunch_menus
     WHERE school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
       AND category_id IN (
           SELECT id FROM lunch_categories WHERE name ILIKE '%light%'
       )) AS menus_vinculados_debe_ser_0;
