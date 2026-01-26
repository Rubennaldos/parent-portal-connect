-- Configurar precio y horarios de almuerzos para Jean LeBouch
-- Reemplaza 'TU_SCHOOL_ID' con el ID real de la sede

INSERT INTO lunch_configuration (
  school_id,
  lunch_price,
  order_deadline_time,
  order_deadline_days,
  cancellation_deadline_time,
  cancellation_deadline_days,
  orders_enabled
)
VALUES (
  '8a0dbd73-0571-4db1-af5c-65f4948c4c98', -- Jean LeBouch (usa el ID correcto de tu sede)
  6.50, -- Precio del almuerzo (S/ 6.50)
  '09:00:00', -- Hora límite para pedir (9:00 AM)
  1, -- Días de anticipación para pedir (1 día antes)
  '09:00:00', -- Hora límite para cancelar (9:00 AM)
  1, -- Días de anticipación para cancelar (1 día antes)
  true -- Pedidos habilitados
)
ON CONFLICT (school_id) 
DO UPDATE SET
  lunch_price = 6.50,
  order_deadline_time = '09:00:00',
  order_deadline_days = 1,
  cancellation_deadline_time = '09:00:00',
  cancellation_deadline_days = 1,
  orders_enabled = true;

-- Verificar que se creó
SELECT * FROM lunch_configuration WHERE school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98';
