-- ============================================
-- Permitir múltiples menús por categoría en el mismo día
-- ============================================

-- 1. Eliminar TODOS los índices únicos que limitan la creación de menús
DROP INDEX IF EXISTS lunch_menus_unique_per_category_per_day;
DROP INDEX IF EXISTS lunch_menus_unique_with_category;
DROP INDEX IF EXISTS lunch_menus_school_id_date_key;

-- 2. Ahora se pueden crear múltiples menús con la misma categoría en el mismo día
-- Ya no hay restricciones de unicidad

-- ============================================
-- RESULTADO:
-- - Ahora pueden crear INFINITOS menús para la misma categoría en el mismo día
-- - Ejemplo: "Almuerzo para Profesores" puede tener Opción 1, Opción 2, Opción 3, etc.
-- - Cada menú es independiente con sus propios platos
-- ============================================
