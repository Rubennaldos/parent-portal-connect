-- ============================================================
-- PARCHE RLS: acceso de padres a sus propias facturas (invoices)
-- Fecha: 2026-04-03
--
-- PROBLEMA:
--   La política "invoices_read_staff" solo permite acceso a roles
--   de staff (admin_general, gestor_unidad, operador_caja, contadora).
--   El rol 'parent' no tiene ninguna política en la tabla invoices.
--   → Cualquier fetch a supabase.from('invoices') con JWT de padre
--     devuelve array vacío (RLS default DENY).
--   → El botón "PDF SUNAT" en PaymentHistoryTab.tsx nunca puede
--     mostrar nada porque la query es siempre vacía.
--
-- SOLUCIÓN:
--   Política de SELECT para padres que les permite ver ÚNICAMENTE
--   las facturas vinculadas a sus propios hijos, sin exponer nada
--   de otros padres ni de otras sedes.
--
-- RUTA DE ACCESO SEGURA:
--   invoices.id  ← transactions.invoice_id
--   transactions.student_id → students.id
--   students.parent_id = auth.uid()
-- ============================================================


-- ── Parche de acceso padre → invoices ────────────────────────────────────────
DROP POLICY IF EXISTS "invoices_read_own_parent" ON public.invoices;

CREATE POLICY "invoices_read_own_parent" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    -- Solo el rol 'parent' activa esta ruta
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'parent'
    )
    AND
    -- La factura debe estar vinculada a una transacción de un hijo suyo
    EXISTS (
      SELECT 1
      FROM public.transactions t
      JOIN public.students s ON s.id = t.student_id
      WHERE t.invoice_id = invoices.id
        AND s.parent_id  = auth.uid()
    )
  );


-- ── Bonus: superadmin también puede leer invoices (brecha menor en staff) ────
-- (admin_general ya está cubierto; superadmin no aparecía en invoices_read_staff)
DROP POLICY IF EXISTS "invoices_read_staff" ON public.invoices;

CREATE POLICY "invoices_read_staff" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('superadmin', 'admin_general')
          OR (
            p.school_id = invoices.school_id
            AND p.role IN ('gestor_unidad', 'operador_caja', 'contadora', 'cajero')
          )
        )
    )
  );


-- ── transactions: cubrir superadmin en SELECT ─────────────────────────────────
-- El RECREATE_ALL_TRANSACTIONS_RLS_POLICIES no incluía superadmin.
-- Un superadmin verá 0 filas sin este parche.
DROP POLICY IF EXISTS "Superadmin puede ver todas las transacciones" ON transactions;

CREATE POLICY "Superadmin puede ver todas las transacciones"
ON transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'superadmin'
  )
);


-- ── Verificación ──────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename IN ('invoices', 'transactions', 'recharge_requests')
ORDER BY tablename, cmd, policyname;

SELECT '20260403_rls_invoices_parent_access ✅ Padres pueden leer sus propias facturas' AS resultado;
