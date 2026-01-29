-- =====================================================
-- FIX: POLÍTICAS RLS PARA teacher_profiles
-- =====================================================
-- Problema: Los profesores no pueden insertar su propio perfil durante el onboarding
-- Solución: Permitir que los profesores inserten SU PROPIO perfil (auth.uid() = id)
-- =====================================================

-- 1. Eliminar la política restrictiva de INSERT
DROP POLICY IF EXISTS "Only admins can create teachers" ON public.teacher_profiles;

-- 2. Crear nueva política que permita:
--    - A los profesores insertar SU PROPIO perfil
--    - A los admins insertar cualquier perfil
CREATE POLICY "Teachers can insert their own profile, admins can insert any"
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
      AND profiles.role IN ('superadmin', 'admin_general')
    )
  );

-- =====================================================
-- ✅ FIX APLICADO
-- =====================================================
-- Ahora los profesores pueden completar su onboarding sin errores de RLS
