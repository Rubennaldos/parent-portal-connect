-- ⚡ ARREGLAR POLÍTICAS RLS - PERMITIR QUE PADRES VEAN A SUS HIJOS
-- ============================================

-- PASO 1: Verificar que los estudiantes existen
SELECT 
  s.id,
  s.full_name,
  s.balance,
  p.email as padre_email
FROM public.students s
LEFT JOIN public.profiles p ON s.parent_id = p.id
ORDER BY p.email, s.full_name;

-- Si ves estudiantes, significa que se insertaron correctamente
-- Si no ves nada, ejecuta primero el script FIX_CON_PARENT_OBLIGATORIO.sql

-- ============================================
-- PASO 2: ELIMINAR POLÍTICAS EXISTENTES (si las hay)
-- ============================================

DROP POLICY IF EXISTS "Parents can view their own students" ON public.students;
DROP POLICY IF EXISTS "Parents can update their students limits" ON public.students;
DROP POLICY IF EXISTS "Parents can view their students transactions" ON public.transactions;
DROP POLICY IF EXISTS "Parents can create recharges for their students" ON public.transactions;

-- ============================================
-- PASO 3: CREAR POLÍTICAS NUEVAS
-- ============================================

-- Política 1: Los padres pueden VER a sus propios hijos
CREATE POLICY "parents_view_own_students"
  ON public.students
  FOR SELECT
  USING (parent_id = auth.uid());

-- Política 2: Los padres pueden ACTUALIZAR el límite diario de sus hijos
CREATE POLICY "parents_update_own_students"
  ON public.students
  FOR UPDATE
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- Política 3: Los padres pueden VER transacciones de sus hijos
CREATE POLICY "parents_view_transactions"
  ON public.transactions
  FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE parent_id = auth.uid()
    )
  );

-- Política 4: Los padres pueden CREAR recargas para sus hijos
CREATE POLICY "parents_create_recharges"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    type = 'recharge' AND
    student_id IN (
      SELECT id FROM public.students WHERE parent_id = auth.uid()
    )
  );

-- Política 5: El staff (POS, admin) puede VER todos los estudiantes
CREATE POLICY "staff_view_all_students"
  ON public.students
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general', 'pos', 'kitchen')
    )
  );

-- Política 6: El staff puede CREAR transacciones (ventas)
CREATE POLICY "staff_create_transactions"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general', 'pos')
    )
  );

-- Política 7: El staff puede ACTUALIZAR saldo de estudiantes
CREATE POLICY "staff_update_students"
  ON public.students
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general', 'pos')
    )
  );

-- ============================================
-- PASO 4: HABILITAR RLS EN LAS TABLAS
-- ============================================

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PASO 5: VERIFICAR POLÍTICAS CREADAS
-- ============================================

SELECT 
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('students', 'transactions')
ORDER BY tablename, policyname;

-- ============================================
-- PASO 6: PROBAR QUE FUNCIONA (como padre)
-- ============================================

-- Simular consulta del padre (reemplaza el UUID con tu ID real)
-- Para obtener tu ID:
SELECT id, email, role FROM public.profiles WHERE email = 'prueba@limacafe28.com';

-- Luego prueba esta consulta (reemplaza 'TU-UUID-AQUI'):
/*
SET LOCAL "request.jwt.claims" = '{"sub":"TU-UUID-AQUI"}';
SELECT * FROM public.students WHERE parent_id = 'TU-UUID-AQUI';
*/

-- ✅ Si ves estudiantes, las políticas funcionan
-- ❌ Si no ves nada, revisa que el parent_id coincida


