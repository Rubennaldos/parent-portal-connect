-- =====================================================
-- ACTUALIZACIÓN: Agregar configuración de conexión física
-- =====================================================

-- Agregar campos para tipo de conexión
ALTER TABLE public.printer_configs
ADD COLUMN IF NOT EXISTS connection_type VARCHAR(20) DEFAULT 'usb',
ADD COLUMN IF NOT EXISTS printer_device_name TEXT,
ADD COLUMN IF NOT EXISTS network_ip VARCHAR(50),
ADD COLUMN IF NOT EXISTS network_port INTEGER DEFAULT 9100,
ADD COLUMN IF NOT EXISTS bluetooth_address VARCHAR(50),
ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(100),
ADD COLUMN IF NOT EXISTS is_thermal_printer BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS connection_timeout INTEGER DEFAULT 5000;

-- Comentarios
COMMENT ON COLUMN public.printer_configs.connection_type IS 
  'Tipo de conexión: usb, network, bluetooth, wifi';

COMMENT ON COLUMN public.printer_configs.printer_device_name IS 
  'Nombre del dispositivo de impresora (para USB/Local)';

COMMENT ON COLUMN public.printer_configs.network_ip IS 
  'Dirección IP para impresoras en red';

COMMENT ON COLUMN public.printer_configs.network_port IS 
  'Puerto de red (por defecto 9100 para impresoras térmicas)';

COMMENT ON COLUMN public.printer_configs.bluetooth_address IS 
  'Dirección MAC del dispositivo Bluetooth';

COMMENT ON COLUMN public.printer_configs.wifi_ssid IS 
  'SSID de la red WiFi para impresora inalámbrica';

COMMENT ON COLUMN public.printer_configs.is_thermal_printer IS 
  'Si es impresora térmica (ticket) o impresora normal';

COMMENT ON COLUMN public.printer_configs.connection_timeout IS 
  'Tiempo de espera para conexión en milisegundos';

-- Actualizar configuraciones existentes
UPDATE public.printer_configs
SET 
  connection_type = 'usb',
  is_thermal_printer = true,
  connection_timeout = 5000
WHERE connection_type IS NULL;

-- Verificar cambios
SELECT 
  pc.id,
  s.name AS sede,
  pc.printer_name,
  pc.connection_type,
  pc.network_ip,
  pc.network_port,
  pc.is_thermal_printer
FROM public.printer_configs pc
INNER JOIN public.schools s ON pc.school_id = s.id
ORDER BY s.name;
