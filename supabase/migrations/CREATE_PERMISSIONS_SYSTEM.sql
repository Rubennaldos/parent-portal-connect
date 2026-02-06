-- 🔐 SISTEMA COMPLETO DE PERMISOS DINÁMICOS
-- Crea todas las tablas necesarias para el control de accesos granular

-- ============================================
-- 1. TABLA: modules
-- ============================================
CREATE TABLE IF NOT EXISTS modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(50),
  route VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'functional' CHECK (status IN ('functional', 'coming_soon')),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_modules_code ON modules(code);
CREATE INDEX IF NOT EXISTS idx_modules_is_active ON modules(is_active);
CREATE INDEX IF NOT EXISTS idx_modules_display_order ON modules(display_order);

COMMENT ON TABLE modules IS 'Módulos del sistema disponibles';

-- ============================================
-- 2. TABLA: module_actions
-- ============================================
CREATE TABLE IF NOT EXISTS module_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code VARCHAR(50) NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  action_code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(module_code, action_code)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_module_actions_module ON module_actions(module_code);
CREATE INDEX IF NOT EXISTS idx_module_actions_code ON module_actions(action_code);

COMMENT ON TABLE module_actions IS 'Acciones específicas disponibles por módulo';

-- ============================================
-- 3. TABLA: role_permissions
-- ============================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(50) NOT NULL,
  module_code VARCHAR(50) NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  action_code VARCHAR(50) NOT NULL,
  can_access BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(role, module_code, action_code),
  FOREIGN KEY (module_code, action_code) REFERENCES module_actions(module_code, action_code) ON DELETE CASCADE
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_module ON role_permissions(module_code);
CREATE INDEX IF NOT EXISTS idx_role_permissions_access ON role_permissions(can_access);

COMMENT ON TABLE role_permissions IS 'Permisos asignados a cada rol por módulo y acción';

-- ============================================
-- 4. TABLA: user_custom_permissions (opcional)
-- ============================================
CREATE TABLE IF NOT EXISTS user_custom_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_code VARCHAR(50) NOT NULL REFERENCES modules(code) ON DELETE CASCADE,
  action_code VARCHAR(50) NOT NULL,
  can_access BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, module_code, action_code),
  FOREIGN KEY (module_code, action_code) REFERENCES module_actions(module_code, action_code) ON DELETE CASCADE
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_custom_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_module ON user_custom_permissions(module_code);

COMMENT ON TABLE user_custom_permissions IS 'Permisos personalizados por usuario (sobrescriben los del rol)';

-- ============================================
-- 5. FUNCIÓN: check_user_permission
-- ============================================
CREATE OR REPLACE FUNCTION check_user_permission(
  p_user_id UUID,
  p_module VARCHAR(50),
  p_action VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
  v_role VARCHAR(50);
  v_has_permission BOOLEAN;
BEGIN
  -- Obtener el rol del usuario
  SELECT role INTO v_role
  FROM profiles
  WHERE id = p_user_id;
  
  -- Admin General tiene acceso a TODO
  IF v_role = 'admin_general' THEN
    RETURN TRUE;
  END IF;
  
  -- Verificar si hay permiso personalizado del usuario (prioridad 1)
  SELECT can_access INTO v_has_permission
  FROM user_custom_permissions
  WHERE user_id = p_user_id
    AND module_code = p_module
    AND action_code = p_action;
  
  IF FOUND THEN
    RETURN v_has_permission;
  END IF;
  
  -- Si no hay permiso personalizado, verificar permiso del rol (prioridad 2)
  SELECT can_access INTO v_has_permission
  FROM role_permissions
  WHERE role = v_role
    AND module_code = p_module
    AND action_code = p_action;
  
  IF FOUND THEN
    RETURN v_has_permission;
  END IF;
  
  -- Por defecto, sin acceso
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_user_permission IS 'Verifica si un usuario tiene permiso para una acción específica';

-- ============================================
-- 6. FUNCIÓN: get_user_modules
-- ============================================
CREATE OR REPLACE FUNCTION get_user_modules(p_user_id UUID)
RETURNS TABLE (
  module_code VARCHAR(50),
  module_name VARCHAR(100),
  module_description TEXT,
  module_icon VARCHAR(50),
  module_color VARCHAR(50),
  module_route VARCHAR(100),
  module_status VARCHAR(20),
  has_access BOOLEAN
) AS $$
DECLARE
  v_role VARCHAR(50);
BEGIN
  -- Obtener el rol del usuario
  SELECT role INTO v_role
  FROM profiles
  WHERE id = p_user_id;
  
  -- Admin General ve TODO
  IF v_role = 'admin_general' THEN
    RETURN QUERY
    SELECT 
      m.code,
      m.name,
      m.description,
      m.icon,
      m.color,
      m.route,
      m.status,
      TRUE as has_access
    FROM modules m
    WHERE m.is_active = true
    ORDER BY m.display_order, m.name;
    RETURN;
  END IF;
  
  -- Para otros roles, verificar permisos
  RETURN QUERY
  SELECT DISTINCT
    m.code,
    m.name,
    m.description,
    m.icon,
    m.color,
    m.route,
    m.status,
    COALESCE(
      (SELECT can_access 
       FROM user_custom_permissions ucp 
       WHERE ucp.user_id = p_user_id 
         AND ucp.module_code = m.code 
         AND ucp.action_code = 'ver_modulo'
       LIMIT 1),
      (SELECT can_access 
       FROM role_permissions rp 
       WHERE rp.role = v_role 
         AND rp.module_code = m.code 
         AND rp.action_code = 'ver_modulo'
       LIMIT 1),
      FALSE
    ) as has_access
  FROM modules m
  WHERE m.is_active = true
  ORDER BY m.display_order, m.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_user_modules IS 'Obtiene todos los módulos disponibles con indicador de acceso para el usuario';

-- ============================================
-- 7. RLS POLICIES
-- ============================================

-- modules
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos pueden ver módulos activos"
ON modules FOR SELECT
TO authenticated
USING (is_active = true);

CREATE POLICY "Solo admin_general puede modificar módulos"
ON modules FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin_general'
  )
);

-- module_actions
ALTER TABLE module_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos pueden ver acciones"
ON module_actions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Solo admin_general puede modificar acciones"
ON module_actions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin_general'
  )
);

-- role_permissions
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios pueden ver permisos de su rol"
ON role_permissions FOR SELECT
TO authenticated
USING (
  role = (SELECT role FROM profiles WHERE id = auth.uid())
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin_general'
  )
);

CREATE POLICY "Solo admin_general puede modificar permisos"
ON role_permissions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin_general'
  )
);

-- user_custom_permissions
ALTER TABLE user_custom_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios pueden ver sus permisos personalizados"
ON user_custom_permissions FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin_general'
  )
);

CREATE POLICY "Solo admin_general puede modificar permisos personalizados"
ON user_custom_permissions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin_general'
  )
);

-- ============================================
-- 8. TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_permissions()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_modules_updated_at
BEFORE UPDATE ON modules
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_permissions();

CREATE TRIGGER update_role_permissions_updated_at
BEFORE UPDATE ON role_permissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_permissions();

CREATE TRIGGER update_user_permissions_updated_at
BEFORE UPDATE ON user_custom_permissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_permissions();

-- ============================================
-- ✅ SISTEMA DE PERMISOS CREADO
-- ============================================
SELECT 'Sistema de permisos dinámicos creado exitosamente' as message;
