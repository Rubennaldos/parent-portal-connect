-- =====================================================
-- FIX: POLÍTICAS RLS PARA transaction_items (PROFESORES)
-- =====================================================
-- Problema: Los profesores no pueden ver los items de sus transacciones
-- Solución: Agregar política que permita ver transaction_items de SUS transacciones
-- =====================================================

-- 1. Eliminar la política si existe
DROP POLICY IF EXISTS "Teachers can view items of their own transactions" ON public.transaction_items;

-- 2. Crear política para que los PROFESORES puedan ver los items de SUS transacciones
CREATE POLICY "Teachers can view items of their own transactions"
  ON public.transaction_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_items.transaction_id
      AND t.teacher_id = auth.uid()
    )
  );

-- =====================================================
-- ✅ FIX APLICADO
-- =====================================================
-- Ahora los profesores pueden ver el historial de compras con todos los items
