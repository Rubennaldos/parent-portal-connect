-- ============================================
-- VERIFICAR ESTRUCTURA DE TABLA PERMISSIONS
-- ============================================

-- Ver columnas de la tabla permissions
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'permissions' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Ver algunos registros de ejemplo
SELECT * FROM public.permissions LIMIT 5;

-- Ver permisos del módulo config_padres
SELECT * FROM public.permissions 
WHERE module = 'config_padres' 
ORDER BY action;
