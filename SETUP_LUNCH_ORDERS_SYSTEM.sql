-- ============================================
-- SETUP: Sistema Completo de Pedidos de Almuerzo
-- ============================================
-- Crea las tablas necesarias para el sistema
-- de pedidos de almuerzo (lunch orders)
-- ============================================

-- 1. Crear tabla de pedidos de almuerzo
CREATE TABLE IF NOT EXISTS public.lunch_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  order_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, cancelled
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  notes TEXT,
  UNIQUE(student_id, order_date) -- Un estudiante solo puede tener un pedido por día
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_lunch_orders_student_id ON public.lunch_orders(student_id);
CREATE INDEX IF NOT EXISTS idx_lunch_orders_date ON public.lunch_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_lunch_orders_status ON public.lunch_orders(status);

-- RLS: Habilitar Row Level Security
ALTER TABLE public.lunch_orders ENABLE ROW LEVEL SECURITY;

-- Políticas RLS: Los padres solo pueden ver los pedidos de sus hijos
DROP POLICY IF EXISTS "Parents can view their children lunch orders" ON public.lunch_orders;
CREATE POLICY "Parents can view their children lunch orders"
  ON public.lunch_orders
  FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM students WHERE parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Parents can create lunch orders for their children" ON public.lunch_orders;
CREATE POLICY "Parents can create lunch orders for their children"
  ON public.lunch_orders
  FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT id FROM students WHERE parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Parents can update their children lunch orders" ON public.lunch_orders;
CREATE POLICY "Parents can update their children lunch orders"
  ON public.lunch_orders
  FOR UPDATE
  USING (
    student_id IN (
      SELECT id FROM students WHERE parent_id = auth.uid()
    )
  )
  WITH CHECK (
    student_id IN (
      SELECT id FROM students WHERE parent_id = auth.uid()
    )
  );

-- Admins pueden ver y gestionar todos los pedidos
DROP POLICY IF EXISTS "Admins can manage all lunch orders" ON public.lunch_orders;
CREATE POLICY "Admins can manage all lunch orders"
  ON public.lunch_orders
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'admin_sede')
    )
  );

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_lunch_orders_updated_at ON public.lunch_orders;

CREATE OR REPLACE FUNCTION update_lunch_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_lunch_orders_updated_at
  BEFORE UPDATE ON public.lunch_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_lunch_orders_updated_at();

-- Recrear la función get_student_lunch_orders (ahora debería funcionar)
DROP FUNCTION IF EXISTS get_student_lunch_orders(UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_student_lunch_orders(
  p_student_id UUID,
  target_month INTEGER,
  target_year INTEGER
)
RETURNS TABLE (
  order_id UUID,
  school_id UUID,
  school_name TEXT,
  school_color TEXT,
  order_date DATE,
  starter TEXT,
  main_course TEXT,
  beverage TEXT,
  dessert TEXT,
  notes TEXT,
  is_special_day BOOLEAN,
  special_day_type TEXT,
  special_day_title TEXT,
  order_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lo.id AS order_id,
    s.id AS school_id,
    s.name AS school_name,
    s.color AS school_color,
    lo.order_date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    lm.is_special_day,
    lm.special_day_type,
    lm.special_day_title,
    lo.status AS order_status
  FROM lunch_orders lo
  INNER JOIN students st ON st.id = lo.student_id
  INNER JOIN schools s ON s.id = st.school_id
  LEFT JOIN lunch_menus lm ON lm.school_id = st.school_id AND lm.date = lo.order_date
  WHERE lo.student_id = p_student_id
    AND EXTRACT(MONTH FROM lo.order_date) = target_month
    AND EXTRACT(YEAR FROM lo.order_date) = target_year
    AND lo.status IN ('confirmed', 'pending')
  
  UNION ALL
  
  -- Agregar días especiales (feriados/no laborables) del colegio del estudiante
  SELECT 
    NULL AS order_id,
    lm.school_id,
    s.name AS school_name,
    s.color AS school_color,
    lm.date AS order_date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    lm.is_special_day,
    lm.special_day_type,
    lm.special_day_title,
    'special_day' AS order_status
  FROM lunch_menus lm
  INNER JOIN schools s ON s.id = lm.school_id
  WHERE lm.school_id = (SELECT school_id FROM students WHERE id = p_student_id LIMIT 1)
    AND lm.is_special_day = true
    AND EXTRACT(MONTH FROM lm.date) = target_month
    AND EXTRACT(YEAR FROM lm.date) = target_year
  
  ORDER BY order_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permisos
GRANT EXECUTE ON FUNCTION get_student_lunch_orders(UUID, INTEGER, INTEGER) TO authenticated;

-- Mensaje final
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Sistema de pedidos de almuerzo configurado correctamente';
  RAISE NOTICE 'Tabla lunch_orders creada con RLS';
  RAISE NOTICE 'Función get_student_lunch_orders lista para usar';
END $$;
