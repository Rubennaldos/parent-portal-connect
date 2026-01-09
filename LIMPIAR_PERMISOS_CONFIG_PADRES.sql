-- =====================================================
-- LIMPIAR Y CORREGIR PERMISOS DE CONFIGURACIÓN DE PADRES
-- =====================================================

-- Eliminar permisos que NO se usan en el módulo
DELETE FROM role_permissions 
WHERE permission_id IN (
  SELECT id FROM permissions 
  WHERE module = 'config_padres' 
  AND action IN ('ver_dashboard', 'eliminar_padre', 'eliminar_estudiante')
);

DELETE FROM permissions 
WHERE module = 'config_padres' 
AND action IN ('ver_dashboard', 'eliminar_padre', 'eliminar_estudiante');

-- Verificar permisos restantes
SELECT 
  p.module,
  p.action,
  p.name,
  p.description
FROM permissions p
WHERE p.module = 'config_padres'
ORDER BY p.action;

-- Los permisos que DEBEN quedar son:
-- ✅ ver_modulo - Acceder al módulo
-- ✅ ver_su_sede - Ver padres de su sede
-- ✅ ver_todas_sedes - Ver padres de todas las sedes
-- ✅ ver_personalizado - Seleccionar sedes específicas
-- ✅ crear_padre - Botón "Nuevo Padre"
-- ✅ editar_padre - Botón de editar padre
-- ✅ crear_estudiante - Funcionalidad de crear estudiante (desde el módulo)
-- ✅ editar_estudiante - Funcionalidad de editar estudiante (desde el módulo)

