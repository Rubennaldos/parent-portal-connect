-- =============================================
-- SCRIPT: Actualizar constraint de roles y migrar datos
-- =============================================

-- PASO 1: Eliminar el constraint antiguo
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

-- PASO 2: Crear el constraint con TODOS los roles (antiguos y nuevos)
ALTER TABLE profiles 
ADD CONSTRAINT profiles_role_check 
CHECK (role IN (
  'parent',
  'superadmin', 
  'admin_general',
  'supervisor_red',
  'gestor_unidad',
  'operador_caja',
  'operador_cocina',
  -- Roles antiguos (por compatibilidad temporal)
  'pos',
  'comedor'
));

-- PASO 3: Ahora sí, actualizar los roles antiguos
UPDATE profiles 
SET role = 'operador_caja' 
WHERE role = 'pos';

UPDATE profiles 
SET role = 'operador_cocina' 
WHERE role = 'comedor';

-- PASO 4: Ahora que migramos todo, crear el constraint FINAL (solo roles nuevos)
ALTER TABLE profiles 
DROP CONSTRAINT profiles_role_check;

ALTER TABLE profiles 
ADD CONSTRAINT profiles_role_check 
CHECK (role IN (
  'parent',
  'superadmin', 
  'admin_general',
  'supervisor_red',
  'gestor_unidad',
  'operador_caja',
  'operador_cocina'
));

-- PASO 5: Verificar los cambios
SELECT 
  email,
  role,
  full_name,
  school_id
FROM profiles
WHERE role IN ('operador_caja', 'operador_cocina', 'admin_general')
ORDER BY role, full_name;
