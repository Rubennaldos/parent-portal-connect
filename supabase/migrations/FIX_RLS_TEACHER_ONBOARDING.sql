-- =====================================================
-- FIX: RLS para que profesores puedan hacer su onboarding
-- =====================================================
-- PROBLEMA: Múltiples políticas RLS conflictivas impiden que
-- los profesores creen/actualicen su propio perfil durante
-- el registro (onboarding).
--
-- SOLUCIÓN: Asegurar que existan políticas que permitan:
-- 1. A los profesores INSERTAR su propio perfil (auth.uid() = id)
-- 2. A los profesores VER su propio perfil
-- 3. A los profesores ACTUALIZAR su propio perfil
-- =====================================================

-- ========================================
-- PASO 1: Limpiar TODAS las políticas existentes de teacher_profiles
-- para evitar conflictos entre múltiples sets de políticas
-- ========================================

-- Políticas del set original
DROP POLICY IF EXISTS "Admin general can view all teachers" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Gestor unidad can view teachers from their school" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Cashiers can view teachers from their school" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Teachers can view their own profile" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Admins can insert teachers" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Admins can update teachers" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Teachers can update their own profile" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Only admins can delete teachers" ON public.teacher_profiles;

-- Políticas del set REACTIVAR_RLS_PRODUCCION
DROP POLICY IF EXISTS "Authenticated users can view teachers" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Authenticated users can insert teachers" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Authenticated users can update teachers" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Authenticated users can delete teachers" ON public.teacher_profiles;

-- Políticas del set FIX_RLS_TEACHER_PROFILES
DROP POLICY IF EXISTS "Teachers can insert their own profile, admins can insert any" ON public.teacher_profiles;
DROP POLICY IF EXISTS "Only admins can create teachers" ON public.teacher_profiles;

-- Políticas adicionales posibles
DROP POLICY IF EXISTS "Admins and cashiers can view all teachers" ON public.teacher_profiles;

-- ========================================
-- PASO 2: Asegurar que RLS está activado
-- ========================================
ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY;

-- ========================================
-- PASO 3: Crear nuevas políticas CORRECTAS
-- ========================================

-- 1. SELECT: Admin general ve todos
CREATE POLICY "tp_admin_view_all"
  ON public.teacher_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red')
    )
  );

-- 2. SELECT: Gestor de unidad y cajeros ven profesores de su sede
CREATE POLICY "tp_staff_view_by_school"
  ON public.teacher_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('gestor_unidad', 'operador_caja')
        AND profiles.school_id IS NOT NULL
        AND (
          teacher_profiles.school_id_1 = profiles.school_id
          OR teacher_profiles.school_id_2 = profiles.school_id
        )
    )
  );

-- 3. SELECT: Profesores ven su propio perfil
-- NOTA: Usa role = 'teacher' (no 'profesor' que era el bug anterior)
CREATE POLICY "tp_teacher_view_own"
  ON public.teacher_profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
  );

-- 4. INSERT: Profesores pueden crear SU PROPIO perfil (para onboarding)
-- Y admins pueden crear cualquier perfil
CREATE POLICY "tp_insert_own_or_admin"
  ON public.teacher_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- El profesor puede crear su propio perfil
    auth.uid() = id
    OR
    -- O es un admin
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('superadmin', 'admin_general', 'gestor_unidad')
    )
  );

-- 5. UPDATE: Profesores pueden actualizar SU PROPIO perfil
CREATE POLICY "tp_teacher_update_own"
  ON public.teacher_profiles
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
  );

-- 6. UPDATE: Admins pueden actualizar cualquier perfil
CREATE POLICY "tp_admin_update_all"
  ON public.teacher_profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('superadmin', 'admin_general', 'gestor_unidad')
    )
  );

-- 7. DELETE: Solo admin general puede eliminar
CREATE POLICY "tp_admin_delete"
  ON public.teacher_profiles
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('superadmin', 'admin_general')
    )
  );

-- ========================================
-- PASO 4: Verificación
-- ========================================
SELECT 
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'teacher_profiles'
  AND schemaname = 'public'
ORDER BY policyname;

-- ========================================
-- NOTAS
-- ========================================
/*
CAMBIOS CLAVE:
1. Los profesores AHORA pueden INSERT su propio perfil (auth.uid() = id)
   → Esto permite el onboarding sin bloqueos de RLS
2. La política de SELECT ya NO depende de profiles.role = 'profesor'
   (el rol correcto es 'teacher', no 'profesor')
3. Se usan nombres de política únicos (prefijo tp_) para evitar
   conflictos con políticas anteriores
4. Se limpiaron TODAS las políticas viejas antes de crear las nuevas
*/
