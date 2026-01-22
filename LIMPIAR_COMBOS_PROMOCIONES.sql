-- =============================================
-- LIMPIAR SISTEMA DE COMBOS Y PROMOCIONES
-- Ejecuta este script si necesitas empezar de cero
-- =============================================

-- 1. Eliminar triggers
DROP TRIGGER IF EXISTS trigger_update_combos_updated_at ON public.combos;
DROP TRIGGER IF EXISTS trigger_update_promotions_updated_at ON public.promotions;

-- 2. Eliminar funciones de triggers
DROP FUNCTION IF EXISTS update_combos_updated_at();
DROP FUNCTION IF EXISTS update_promotions_updated_at();

-- 3. Eliminar funciones de negocio
DROP FUNCTION IF EXISTS get_active_combos_for_school(UUID);
DROP FUNCTION IF EXISTS get_active_promotions_for_school(UUID);
DROP FUNCTION IF EXISTS calculate_discounted_price(UUID, DECIMAL, VARCHAR, UUID);

-- 4. Eliminar tablas (esto eliminará también las policies RLS automáticamente)
DROP TABLE IF EXISTS public.combo_items CASCADE;
DROP TABLE IF EXISTS public.combos CASCADE;
DROP TABLE IF EXISTS public.promotions CASCADE;

-- 5. Eliminar el módulo del sistema de permisos (solo si existen las tablas)
DO $$
BEGIN
  -- Intentar eliminar de module_permissions si existe
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'module_permissions') THEN
    DELETE FROM public.module_permissions WHERE module_id IN (
      SELECT id FROM public.modules WHERE code = 'promociones'
    );
    RAISE NOTICE '✅ Permisos del módulo eliminados';
  END IF;

  -- Intentar eliminar de modules si existe
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'modules') THEN
    DELETE FROM public.modules WHERE code = 'promociones';
    RAISE NOTICE '✅ Módulo eliminado del sistema de permisos';
  END IF;
END $$;

-- Verificación
SELECT '✅ Sistema de Combos y Promociones limpiado correctamente. Puedes ejecutar SETUP_COMBOS_PROMOCIONES.sql nuevamente.' AS status;
