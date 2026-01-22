-- =============================================
-- AGREGAR MÓDULO DE COMBOS Y PROMOCIONES
-- AL SISTEMA DE PERMISOS DINÁMICOS
-- =============================================

-- NOTA: Este script solo funcionará si ya tienes el sistema de permisos dinámicos configurado
-- Si no tienes las tablas 'modules' y 'module_permissions', primero ejecuta el script de configuración del sistema de permisos

DO $$
BEGIN
  -- Verificar si existen las tablas necesarias
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'modules') THEN
    RAISE NOTICE '⚠️  ADVERTENCIA: La tabla "modules" no existe. Este script requiere el sistema de permisos dinámicos.';
    RAISE NOTICE '⚠️  Por favor, ejecuta primero el script de configuración del sistema de permisos.';
    RAISE NOTICE '⚠️  El módulo de Combos y Promociones funcionará, pero no aparecerá en el Dashboard.';
    RETURN;
  END IF;

  -- Insertar el módulo en la tabla modules
  INSERT INTO public.modules (code, name, description, icon, color, route, is_active)
  VALUES (
    'promociones',
    'Combos y Promociones',
    'Crea combos especiales y descuentos',
    'TrendingUp',
    'pink',
    '/combos-promotions',
    true
  )
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    route = EXCLUDED.route,
    is_active = EXCLUDED.is_active;

  RAISE NOTICE '✅ Módulo "promociones" creado/actualizado correctamente';
END $$;

-- Asignar permisos por defecto a los roles
DO $$
DECLARE
  v_module_id UUID;
BEGIN
  -- Verificar si existe la tabla de permisos
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'module_permissions') THEN
    RAISE NOTICE '⚠️  ADVERTENCIA: La tabla "module_permissions" no existe.';
    RETURN;
  END IF;

  -- Obtener el ID del módulo recién creado
  SELECT id INTO v_module_id FROM public.modules WHERE code = 'promociones';

  IF v_module_id IS NULL THEN
    RAISE NOTICE '⚠️  No se pudo obtener el ID del módulo';
    RETURN;
  END IF;

  -- admin_general: Acceso TOTAL
  INSERT INTO public.module_permissions (role, module_id, can_read, can_write, can_delete)
  VALUES ('admin_general', v_module_id, true, true, true)
  ON CONFLICT (role, module_id) DO UPDATE SET
    can_read = true,
    can_write = true,
    can_delete = true;

  -- supervisor_red: Acceso TOTAL (para gestionar promociones en todas las sedes)
  INSERT INTO public.module_permissions (role, module_id, can_read, can_write, can_delete)
  VALUES ('supervisor_red', v_module_id, true, true, true)
  ON CONFLICT (role, module_id) DO UPDATE SET
    can_read = true,
    can_write = true,
    can_delete = true;

  -- gestor_unidad: Solo lectura (puede VER combos/promociones pero no crear/editar)
  INSERT INTO public.module_permissions (role, module_id, can_read, can_write, can_delete)
  VALUES ('gestor_unidad', v_module_id, true, false, false)
  ON CONFLICT (role, module_id) DO UPDATE SET
    can_read = true,
    can_write = false,
    can_delete = false;

  -- operador_caja: Solo lectura (para aplicar combos/promociones en el POS)
  INSERT INTO public.module_permissions (role, module_id, can_read, can_write, can_delete)
  VALUES ('operador_caja', v_module_id, true, false, false)
  ON CONFLICT (role, module_id) DO UPDATE SET
    can_read = true,
    can_write = false,
    can_delete = false;

  -- operador_cocina: Sin acceso (no necesita ver promociones)
  INSERT INTO public.module_permissions (role, module_id, can_read, can_write, can_delete)
  VALUES ('operador_cocina', v_module_id, false, false, false)
  ON CONFLICT (role, module_id) DO UPDATE SET
    can_read = false,
    can_write = false,
    can_delete = false;

  RAISE NOTICE '✅ Permisos asignados correctamente para todos los roles';
END $$;

-- Verificar que se creó correctamente
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'modules') THEN
    PERFORM * FROM public.modules m
    LEFT JOIN public.module_permissions mp ON mp.module_id = m.id
    WHERE m.code = 'promociones';
    
    RAISE NOTICE '✅ Módulo de Combos y Promociones configurado correctamente';
    RAISE NOTICE 'ℹ️  Ejecuta la siguiente query para ver los permisos:';
    RAISE NOTICE 'SELECT m.name AS modulo, mp.role AS rol, mp.can_read, mp.can_write, mp.can_delete FROM modules m LEFT JOIN module_permissions mp ON mp.module_id = m.id WHERE m.code = ''promociones'';';
  END IF;
END $$;
