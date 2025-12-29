-- ============================================
-- VINCULAR ESTUDIANTES A PADRES
-- Para que el Portal de Padres funcione correctamente
-- ============================================

-- Primero, verificar que tienes usuarios padres creados
SELECT id, email, role FROM public.profiles WHERE role = 'parent';

-- Si no tienes padres, crea uno de prueba:
-- (Reemplaza 'padre@limacafe28.com' con el email real)
INSERT INTO public.profiles (id, email, role)
SELECT 
  auth.uid(),
  'padre@limacafe28.com',
  'parent'
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE email = 'padre@limacafe28.com'
);

-- ============================================
-- VINCULAR ESTUDIANTES EXISTENTES A UN PADRE
-- ============================================

-- Opción 1: Vincular TODOS los estudiantes sin padre a un padre específico
UPDATE public.students
SET parent_id = (
  SELECT id FROM public.profiles 
  WHERE email = 'padre@limacafe28.com' 
  LIMIT 1
)
WHERE parent_id IS NULL;

-- Opción 2: Vincular estudiantes específicos por nombre
UPDATE public.students
SET parent_id = (
  SELECT id FROM public.profiles 
  WHERE email = 'padre@limacafe28.com' 
  LIMIT 1
)
WHERE name IN ('Pedro García', 'María López');

-- ============================================
-- VERIFICAR VINCULACIÓN
-- ============================================

SELECT 
  s.id,
  s.name,
  s.balance,
  s.grade,
  s.section,
  p.email as padre_email,
  p.role as padre_role
FROM public.students s
LEFT JOIN public.profiles p ON s.parent_id = p.id
WHERE s.is_active = true
ORDER BY p.email, s.name;

-- ============================================
-- CREAR POLÍTICAS RLS PARA PADRES
-- ============================================

-- Política: Los padres solo pueden ver a sus propios hijos
CREATE POLICY "Parents can view their own students"
  ON public.students
  FOR SELECT
  USING (parent_id = auth.uid());

-- Política: Los padres pueden actualizar el límite diario de sus hijos
CREATE POLICY "Parents can update their students limits"
  ON public.students
  FOR UPDATE
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- Política: Los padres pueden ver las transacciones de sus hijos
CREATE POLICY "Parents can view their students transactions"
  ON public.transactions
  FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE parent_id = auth.uid()
    )
  );

-- Política: Los padres pueden crear recargas para sus hijos
CREATE POLICY "Parents can create recharges for their students"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    type = 'recharge' AND
    student_id IN (
      SELECT id FROM public.students WHERE parent_id = auth.uid()
    )
  );

-- ============================================
-- HABILITAR RLS EN LAS TABLAS
-- ============================================

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- VERIFICAR POLÍTICAS CREADAS
-- ============================================

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('students', 'transactions')
ORDER BY tablename, policyname;

