-- Agregar campo is_active a profiles para poder desactivar cuentas de empleados
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
