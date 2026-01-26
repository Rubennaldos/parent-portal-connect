-- =============================================
-- CREAR TABLA SALES (VENTAS)
-- Para el módulo de Finanzas y Tesorería
-- =============================================

-- PASO 1: Crear la tabla
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT UNIQUE NOT NULL, -- ID único de la venta (ej: "T-SDR1-000006")
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Montos
  total NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  
  -- Método de pago
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'yape', 'plin', 'transfer', 'debt')),
  
  -- Detalles de efectivo (solo si payment_method = 'cash')
  cash_received NUMERIC,
  change_given NUMERIC,
  
  -- Productos vendidos (JSON array)
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Ejemplo: [{"product_id": "uuid", "product_name": "Coca Cola", "barcode": "123", "quantity": 2, "price": 3.50, "subtotal": 7.00}]
  
  -- Auditoría
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PASO 2: Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_sales_student_id ON public.sales(student_id);
CREATE INDEX IF NOT EXISTS idx_sales_school_id ON public.sales(school_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_id ON public.sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON public.sales(payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_transaction_id ON public.sales(transaction_id);

-- PASO 3: Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_sales_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_sales_updated_at ON public.sales;
CREATE TRIGGER trigger_update_sales_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sales_updated_at();

-- PASO 4: Habilitar RLS
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- PASO 5: Políticas RLS

-- Permitir a staff insertar ventas
CREATE POLICY "allow_staff_insert_sales"
ON public.sales
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'gestor_unidad', 'operador_caja')
  )
);

-- Permitir a admin_general y superadmin ver TODAS las ventas
CREATE POLICY "allow_admin_view_all_sales"
ON public.sales
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red')
  )
);

-- Permitir a operadores de caja ver solo las ventas de SU sede
CREATE POLICY "allow_cashier_view_school_sales"
ON public.sales
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('operador_caja', 'gestor_unidad')
    AND p.school_id = sales.school_id
  )
);

-- Permitir a admin actualizar/eliminar ventas (para anulaciones)
CREATE POLICY "allow_admin_update_sales"
ON public.sales
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red')
  )
);

CREATE POLICY "allow_admin_delete_sales"
ON public.sales
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red')
  )
);

-- PASO 6: Verificar que se creó correctamente
SELECT 
  'Tabla sales creada exitosamente' as mensaje,
  COUNT(*) as total_ventas
FROM public.sales;

-- Ver estructura de la tabla
SELECT 
  column_name, 
  data_type, 
  character_maximum_length,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'sales'
ORDER BY ordinal_position;

-- Ver políticas RLS
SELECT 
  policyname, 
  cmd,
  permissive
FROM pg_policies
WHERE tablename = 'sales';
