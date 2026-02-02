-- ============================================
-- AGREGAR PERMISOS DE PROFESORES AL MÓDULO
-- "Configuración de Padres y Profesores"
-- ============================================
-- Fecha: 2026-02-01
-- Descripción: Agrega permisos para gestionar profesores
--              dentro del módulo config_padres
-- ============================================

-- 1. Insertar nuevos permisos para PROFESORES
INSERT INTO public.permissions (module, action, name, description, created_at) VALUES
  -- Permisos de visualización
  ('config_padres', 'view_teachers', 'Ver Profesores', 'Permite ver la lista de profesores', NOW()),
  ('config_padres', 'view_teacher_details', 'Ver Detalles de Profesor', 'Permite ver información detallada de profesores', NOW()),
  
  -- Permisos de creación/edición
  ('config_padres', 'create_teacher', 'Crear Profesor', 'Permite registrar nuevos profesores', NOW()),
  ('config_padres', 'edit_teacher', 'Editar Profesor', 'Permite modificar datos de profesores', NOW()),
  ('config_padres', 'delete_teacher', 'Eliminar Profesor', 'Permite eliminar profesores del sistema', NOW()),
  
  -- Permisos de exportación
  ('config_padres', 'export_teachers', 'Exportar Profesores', 'Permite exportar datos de profesores a Excel/PDF', NOW())
ON CONFLICT (module, action) DO NOTHING;

-- 2. Asignar permisos a ADMIN GENERAL (acceso total)
INSERT INTO public.role_permissions (role, permission_id, granted)
SELECT 
  'admin_general',
  id,
  true
FROM public.permissions
WHERE module = 'config_padres' 
  AND action IN ('view_teachers', 'view_teacher_details', 'create_teacher', 'edit_teacher', 'delete_teacher', 'export_teachers')
ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;

-- 3. Asignar permisos a GESTOR DE UNIDAD (solo visualización y exportación)
INSERT INTO public.role_permissions (role, permission_id, granted)
SELECT 
  'gestor_unidad',
  id,
  true
FROM public.permissions
WHERE module = 'config_padres' 
  AND action IN ('view_teachers', 'view_teacher_details', 'export_teachers')
ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;

-- 4. Asignar permisos a ADMINISTRADOR DE SEDE (visualización, edición y exportación)
INSERT INTO public.role_permissions (role, permission_id, granted)
SELECT 
  'admin_sede',
  id,
  true
FROM public.permissions
WHERE module = 'config_padres' 
  AND action IN ('view_teachers', 'view_teacher_details', 'edit_teacher', 'export_teachers')
ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;

-- ============================================
-- VERIFICACIÓN
-- ============================================

-- Ver todos los permisos del módulo config_padres
SELECT 
  p.action,
  p.name,
  p.description,
  COUNT(DISTINCT rp.role) as roles_con_acceso,
  STRING_AGG(DISTINCT rp.role, ', ') as roles
FROM public.permissions p
LEFT JOIN public.role_permissions rp ON p.id = rp.permission_id AND rp.granted = true
WHERE p.module = 'config_padres'
GROUP BY p.id, p.action, p.name, p.description
ORDER BY p.action;

-- Ver permisos específicos de cada rol
SELECT 
  rp.role,
  COUNT(*) as total_permisos,
  STRING_AGG(p.name, ', ' ORDER BY p.action) as permisos
FROM public.role_permissions rp
JOIN public.permissions p ON rp.permission_id = p.id
WHERE p.module = 'config_padres' AND rp.granted = true
GROUP BY rp.role
ORDER BY rp.role;
