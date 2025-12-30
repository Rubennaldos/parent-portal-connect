-- ⚡ SCRIPT RÁPIDO: ARREGLAR ACCESO DE PADRES A ESTUDIANTES
-- Copia y pega TODO en Supabase SQL Editor

-- 1️⃣ Eliminar políticas viejas (si existen)
DROP POLICY IF EXISTS "Parents can view their own students" ON public.students;
DROP POLICY IF EXISTS "Parents can update their students limits" ON public.students;
DROP POLICY IF EXISTS "Parents can view their students transactions" ON public.transactions;
DROP POLICY IF EXISTS "Parents can create recharges for their students" ON public.transactions;
DROP POLICY IF EXISTS "parents_view_own_students" ON public.students;
DROP POLICY IF EXISTS "parents_update_own_students" ON public.students;
DROP POLICY IF EXISTS "parents_view_transactions" ON public.transactions;
DROP POLICY IF EXISTS "parents_create_recharges" ON public.transactions;
DROP POLICY IF EXISTS "staff_view_all_students" ON public.students;
DROP POLICY IF EXISTS "staff_create_transactions" ON public.transactions;
DROP POLICY IF EXISTS "staff_update_students" ON public.students;

-- 2️⃣ Crear políticas para PADRES
CREATE POLICY "padres_ven_sus_hijos"
  ON public.students FOR SELECT
  USING (parent_id = auth.uid());

CREATE POLICY "padres_actualizan_sus_hijos"
  ON public.students FOR UPDATE
  USING (parent_id = auth.uid());

CREATE POLICY "padres_ven_transacciones"
  ON public.transactions FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE parent_id = auth.uid()));

CREATE POLICY "padres_crean_recargas"
  ON public.transactions FOR INSERT
  WITH CHECK (
    type = 'recharge' AND
    student_id IN (SELECT id FROM public.students WHERE parent_id = auth.uid())
  );

-- 3️⃣ Crear políticas para STAFF (POS, Admin)
CREATE POLICY "staff_ve_todos_estudiantes"
  ON public.students FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general', 'pos', 'kitchen')
    )
  );

CREATE POLICY "staff_actualiza_estudiantes"
  ON public.students FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general', 'pos')
    )
  );

CREATE POLICY "staff_crea_ventas"
  ON public.transactions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general', 'pos')
    )
  );

-- 4️⃣ Habilitar RLS
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 5️⃣ VERIFICAR (deberías ver las 7 políticas)
SELECT tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('students', 'transactions')
ORDER BY tablename, policyname;

-- ✅ Si ves 7 políticas, está todo listo
-- Ahora cierra sesión, limpia caché e inicia sesión de nuevo


