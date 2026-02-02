-- Migración para permitir pedidos de profesores sin student_id
-- Fecha: 2026-02-02

-- Primero, modificar la tabla para permitir NULL en student_id
ALTER TABLE public.lunch_orders 
  ALTER COLUMN student_id DROP NOT NULL;

-- Agregar un check constraint para asegurar que al menos uno exista
ALTER TABLE public.lunch_orders 
  ADD CONSTRAINT lunch_orders_requires_student_or_teacher 
  CHECK (
    (student_id IS NOT NULL AND teacher_id IS NULL) OR 
    (teacher_id IS NOT NULL AND student_id IS NULL)
  );

-- Comentarios explicativos
COMMENT ON CONSTRAINT lunch_orders_requires_student_or_teacher ON public.lunch_orders IS 
  'Asegura que cada pedido tenga exactamente un student_id O un teacher_id, pero no ambos ni ninguno';
