-- =====================================================
-- SCRIPT: FIX RLS TRANSACTION_ITEMS
-- Fecha: 2026-01-07
-- Descripción: Permitir a cajeros insertar items de transacciones
-- =====================================================

-- Eliminar políticas restrictivas anteriores
DROP POLICY IF EXISTS "allow_insert_transaction_items" ON transaction_items;
DROP POLICY IF EXISTS "allow_select_transaction_items" ON transaction_items;
DROP POLICY IF EXISTS "allow_update_transaction_items" ON transaction_items;
DROP POLICY IF EXISTS "allow_delete_transaction_items" ON transaction_items;

-- Crear política para INSERT (cajeros y admins)
CREATE POLICY "allow_authenticated_insert_transaction_items"
ON transaction_items
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Crear política para SELECT (todos autenticados)
CREATE POLICY "allow_authenticated_select_transaction_items"
ON transaction_items
FOR SELECT
TO authenticated
USING (true);

-- Crear política para UPDATE (solo admins)
CREATE POLICY "allow_admin_update_transaction_items"
ON transaction_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- Crear política para DELETE (solo admins)
CREATE POLICY "allow_admin_delete_transaction_items"
ON transaction_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================

