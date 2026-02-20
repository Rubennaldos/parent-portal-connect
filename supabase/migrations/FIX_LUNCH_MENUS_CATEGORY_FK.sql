-- ============================================
-- FIX: Restaurar FK entre lunch_menus.category_id y lunch_categories.id
-- ============================================
-- El DROP TABLE lunch_categories CASCADE eliminó el FK constraint
-- de lunch_menus.category_id → lunch_categories.id
-- La columna category_id sigue existiendo pero sin FK,
-- lo que causa errores PGRST200 en PostgREST (resource embedding)
--
-- Esta migración restaura el FK para:
-- 1. Integridad referencial en la base de datos
-- 2. Permitir PostgREST resource embedding (lunch_menus → lunch_categories)

-- Eliminar cualquier FK existente (por si acaso)
ALTER TABLE lunch_menus DROP CONSTRAINT IF EXISTS lunch_menus_category_id_fkey;

-- Restaurar el FK
ALTER TABLE lunch_menus 
  ADD CONSTRAINT lunch_menus_category_id_fkey 
  FOREIGN KEY (category_id) 
  REFERENCES lunch_categories(id) 
  ON DELETE SET NULL;

-- Verificar
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'lunch_menus' 
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'category_id';
