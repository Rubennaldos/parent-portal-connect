-- ============================================
-- VERIFICAR Y CREAR CONFIGURACIÓN DE ALMUERZOS
-- ============================================

-- 1. Verificar si existe la tabla
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'lunch_configuration'
);

-- 2. Ver configuraciones existentes
SELECT * FROM public.lunch_configuration;

-- 3. Si NO existe configuración, crear una por defecto para cada sede
INSERT INTO public.lunch_configuration (
  school_id,
  lunch_price,
  order_deadline_time,
  order_deadline_days,
  cancellation_deadline_time,
  cancellation_deadline_days,
  orders_enabled
)
SELECT 
  id as school_id,
  8.00 as lunch_price,
  '09:00:00' as order_deadline_time,
  0 as order_deadline_days,
  '09:00:00' as cancellation_deadline_time,
  0 as cancellation_deadline_days,
  true as orders_enabled
FROM public.schools
WHERE NOT EXISTS (
  SELECT 1 FROM public.lunch_configuration lc WHERE lc.school_id = schools.id
);

-- 4. Verificar que se crearon
SELECT 
  lc.*,
  s.name as school_name
FROM public.lunch_configuration lc
JOIN public.schools s ON lc.school_id = s.id;
