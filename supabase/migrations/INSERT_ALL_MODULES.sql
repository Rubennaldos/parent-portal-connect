-- 📦 INSERTAR TODOS LOS MÓDULOS DEL SISTEMA
-- Este script debe ejecutarse DESPUÉS de CREATE_PERMISSIONS_SYSTEM.sql

-- ============================================
-- MÓDULOS PRINCIPALES
-- ============================================

-- 1. Punto de Venta (POS)
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('pos', 'Punto de Venta', 'Sistema de cobro y ventas', 'ShoppingCart', 'blue', '/pos', true, 'functional', 1)
ON CONFLICT (code) DO NOTHING;

-- Acciones POS
INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('pos', 'ver_modulo', 'Ver módulo', 'Acceder al punto de venta'),
  ('pos', 'realizar_venta', 'Realizar venta', 'Procesar ventas y cobros'),
  ('pos', 'aplicar_descuento', 'Aplicar descuento', 'Aplicar descuentos a productos'),
  ('pos', 'anular_venta', 'Anular venta', 'Cancelar ventas realizadas'),
  ('pos', 'ver_historial', 'Ver historial', 'Ver historial de ventas')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 2. Lista de Ventas
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('ventas', 'Lista de Ventas', 'Historial y reportes de ventas', 'FileSearch', 'purple', '/sales', true, 'functional', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('ventas', 'ver_modulo', 'Ver módulo', 'Acceder a lista de ventas'),
  ('ventas', 'ver_ventas', 'Ver ventas', 'Ver lista completa de ventas'),
  ('ventas', 'eliminar_venta', 'Eliminar venta', 'Eliminar registros de ventas')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 3. Cobranzas
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('cobranzas', 'Cobranzas', 'Gestión de cuentas por cobrar', 'DollarSign', 'red', '/cobranzas', true, 'functional', 3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('cobranzas', 'ver_modulo', 'Ver módulo', 'Acceder a cobranzas'),
  ('cobranzas', 'ver_deudas', 'Ver deudas', 'Ver cuentas por cobrar'),
  ('cobranzas', 'registrar_pago', 'Registrar pago', 'Registrar pagos de deudas')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 4. Comedor / Almuerzos
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('almuerzos', 'Comedor', 'Gestión de almuerzos escolares', 'UtensilsCrossed', 'yellow', '/comedor', true, 'functional', 4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('almuerzos', 'ver_modulo', 'Ver módulo', 'Acceder al módulo de comedor'),
  ('almuerzos', 'registrar_almuerzo', 'Registrar almuerzo', 'Registrar consumo de almuerzos'),
  ('almuerzos', 'ver_calendario', 'Ver calendario', 'Ver calendario de menús')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 5. Productos
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('productos', 'Productos', 'Catálogo de productos y precios', 'Package', 'indigo', '/products', true, 'functional', 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('productos', 'ver_modulo', 'Ver módulo', 'Acceder a productos'),
  ('productos', 'crear_producto', 'Crear producto', 'Agregar nuevos productos'),
  ('productos', 'editar_producto', 'Editar producto', 'Modificar productos existentes'),
  ('productos', 'eliminar_producto', 'Eliminar producto', 'Eliminar productos')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 6. Administración de Sede
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('admin_sede', 'Administración de Sede', 'Gestión completa de la sede', 'ShieldCheck', 'orange', '/school-admin', true, 'functional', 6)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('admin_sede', 'ver_modulo', 'Ver módulo', 'Acceder a admin de sede'),
  ('admin_sede', 'gestionar_usuarios', 'Gestionar usuarios', 'Administrar usuarios de la sede'),
  ('admin_sede', 'configurar_sede', 'Configurar sede', 'Cambiar configuración')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 7. Finanzas y Tesorería
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('finanzas', 'Finanzas y Tesorería', 'Efectivo por sede, auditoría de caja y ventas', 'LineChart', 'emerald', '/finanzas', true, 'functional', 7)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('finanzas', 'ver_modulo', 'Ver módulo', 'Acceder a finanzas'),
  ('finanzas', 'ver_reportes', 'Ver reportes', 'Ver reportes financieros'),
  ('finanzas', 'exportar_datos', 'Exportar datos', 'Exportar información financiera')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 8. Cierre de Caja
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('cierre_caja', 'Cierre de Caja', 'Gestión de caja, ingresos, egresos y cierre diario', 'DollarSign', 'green', '/cash-register', true, 'functional', 8)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('cierre_caja', 'ver_modulo', 'Ver módulo', 'Permite ver el módulo de cierre de caja'),
  ('cierre_caja', 'abrir_caja', 'Abrir caja', 'Permite abrir la caja del día'),
  ('cierre_caja', 'ver_dashboard', 'Ver dashboard', 'Ver resumen de ventas y movimientos'),
  ('cierre_caja', 'registrar_ingreso', 'Registrar ingreso', 'Registrar ingresos de efectivo'),
  ('cierre_caja', 'registrar_egreso', 'Registrar egreso', 'Registrar egresos de efectivo'),
  ('cierre_caja', 'cerrar_caja', 'Cerrar caja', 'Realizar el cierre de caja del día'),
  ('cierre_caja', 'ver_historial', 'Ver historial', 'Consultar cierres anteriores'),
  ('cierre_caja', 'imprimir', 'Imprimir reportes', 'Imprimir comprobantes y reportes'),
  ('cierre_caja', 'exportar', 'Exportar datos', 'Exportar a Excel/CSV'),
  ('cierre_caja', 'configurar', 'Configurar módulo', 'Cambiar configuración del sistema de caja')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 9. Configuración de Padres
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('config_padres', 'Configuración Padres', 'Gestión de acceso y configuración para padres', 'Users', 'pink', '/parents', true, 'functional', 9)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('config_padres', 'ver_modulo', 'Ver módulo', 'Acceder a configuración de padres'),
  ('config_padres', 'gestionar_padres', 'Gestionar padres', 'Administrar cuentas de padres')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 10. Combos y Promociones
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('promociones', 'Combos y Promociones', 'Gestión de combos y ofertas especiales', 'TrendingUp', 'red', '/combos-promotions', true, 'functional', 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('promociones', 'ver_modulo', 'Ver módulo', 'Acceder a combos y promociones'),
  ('promociones', 'crear_combo', 'Crear combo', 'Crear nuevos combos'),
  ('promociones', 'editar_combo', 'Editar combo', 'Modificar combos existentes'),
  ('promociones', 'eliminar_combo', 'Eliminar combo', 'Eliminar combos')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- 11. Logística (Coming Soon)
INSERT INTO modules (code, name, description, icon, color, route, is_active, status, display_order)
VALUES ('logistica', 'Logística', 'Inventario y compras', 'Package', 'orange', '/logistics', true, 'coming_soon', 11)
ON CONFLICT (code) DO NOTHING;

INSERT INTO module_actions (module_code, action_code, name, description) VALUES
  ('logistica', 'ver_modulo', 'Ver módulo', 'Acceder a logística')
ON CONFLICT (module_code, action_code) DO NOTHING;

-- ============================================
-- ✅ MÓDULOS INSERTADOS
-- ============================================
SELECT 
  COUNT(*) as total_modulos,
  COUNT(*) FILTER (WHERE status = 'functional') as funcionales,
  COUNT(*) FILTER (WHERE status = 'coming_soon') as proximamente
FROM modules;

SELECT 'Módulos insertados exitosamente' as message;
