-- =====================================================
-- AGREGAR SOPORTE DE PROFESORES EN LUNCH_ORDERS
-- =====================================================

-- 1. Agregar columna teacher_id
ALTER TABLE public.lunch_orders 
ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.teacher_profiles(id) ON DELETE CASCADE;

-- 2. Crear índice para mejorar consultas
CREATE INDEX IF NOT EXISTS idx_lunch_orders_teacher_id ON public.lunch_orders(teacher_id);

-- 3. Comentario
COMMENT ON COLUMN public.lunch_orders.teacher_id IS 'ID del profesor (si el pedido fue hecho por un profesor)';

-- 4. Modificar el constraint para permitir student_id O teacher_id (no ambos)
-- Eliminar constraint viejo si existe
ALTER TABLE public.lunch_orders DROP CONSTRAINT IF EXISTS lunch_orders_student_or_teacher_check;

-- Crear nuevo constraint: debe tener student_id O teacher_id, pero no ambos
ALTER TABLE public.lunch_orders 
ADD CONSTRAINT lunch_orders_student_or_teacher_check 
CHECK (
  (student_id IS NOT NULL AND teacher_id IS NULL) OR
  (student_id IS NULL AND teacher_id IS NOT NULL)
);

-- 5. Actualizar políticas RLS para profesores

-- Política: Profesores pueden ver sus propios pedidos
DROP POLICY IF EXISTS "Teachers can view their own lunch orders" ON public.lunch_orders;
CREATE POLICY "Teachers can view their own lunch orders"
  ON public.lunch_orders
  FOR SELECT
  TO authenticated
  USING (teacher_id = auth.uid());

-- Política: Profesores pueden crear sus propios pedidos
DROP POLICY IF EXISTS "Teachers can create their own lunch orders" ON public.lunch_orders;
CREATE POLICY "Teachers can create their own lunch orders"
  ON public.lunch_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (teacher_id = auth.uid());

-- Política: Profesores pueden actualizar sus propios pedidos
DROP POLICY IF EXISTS "Teachers can update their own lunch orders" ON public.lunch_orders;
CREATE POLICY "Teachers can update their own lunch orders"
  ON public.lunch_orders
  FOR UPDATE
  TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- Política: Profesores pueden eliminar sus propios pedidos
DROP POLICY IF EXISTS "Teachers can delete their own lunch orders" ON public.lunch_orders;
CREATE POLICY "Teachers can delete their own lunch orders"
  ON public.lunch_orders
  FOR DELETE
  TO authenticated
  USING (teacher_id = auth.uid());

-- =====================================================
-- ✅ TABLA ACTUALIZADA
-- =====================================================

COMMENT ON TABLE public.lunch_orders IS 
'Tabla de pedidos de almuerzo que ahora soporta estudiantes y profesores.
- student_id: Para pedidos de estudiantes (hecho por padres)
- teacher_id: Para pedidos de profesores
Solo uno de los dos debe estar presente, no ambos.';
