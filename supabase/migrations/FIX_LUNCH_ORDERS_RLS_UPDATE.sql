-- ========================================
-- FIX: Permitir UPDATE en lunch_orders
-- ========================================
-- Problema: Los usuarios autenticados no pueden actualizar is_cancelled
-- Solución: Agregar política RLS para permitir UPDATE

-- Paso 1: Ver las políticas actuales de lunch_orders
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'lunch_orders'
ORDER BY policyname;

-- Paso 2: Crear política para permitir UPDATE a usuarios autenticados
-- (Solo si no existe)

-- Eliminar política antigua si existe
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar pedidos" ON lunch_orders;

-- Crear nueva política para UPDATE
CREATE POLICY "Usuarios autenticados pueden actualizar pedidos"
ON lunch_orders
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Paso 3: Crear política para permitir DELETE a usuarios autenticados (por si acaso)
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar pedidos" ON lunch_orders;

CREATE POLICY "Usuarios autenticados pueden eliminar pedidos"
ON lunch_orders
FOR DELETE
TO authenticated
USING (true);

-- Paso 4: Verificar que las políticas se crearon correctamente
SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies 
WHERE tablename = 'lunch_orders'
ORDER BY policyname;

-- ========================================
-- RESULTADO ESPERADO:
-- Deberían aparecer al menos estas políticas:
-- - "Usuarios autenticados pueden ver pedidos" (SELECT)
-- - "Usuarios autenticados pueden crear pedidos" (INSERT)
-- - "Usuarios autenticados pueden actualizar pedidos" (UPDATE) ← NUEVA
-- - "Usuarios autenticados pueden eliminar pedidos" (DELETE) ← NUEVA
-- ========================================
