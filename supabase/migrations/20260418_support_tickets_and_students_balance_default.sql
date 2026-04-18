-- ============================================================
-- Support tickets + students.balance DB default hardening
-- Fecha: 2026-04-18
-- ============================================================

-- 1) Garantizar default en DB para nuevos students.balance
ALTER TABLE public.students
  ALTER COLUMN balance SET DEFAULT 0.00;

UPDATE public.students
SET balance = 0.00
WHERE balance IS NULL;

-- 2) Crear soporte trazable SOLO si no existe tabla equivalente ligera
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id uuid NULL REFERENCES public.students(id) ON DELETE SET NULL,
  parent_name text NULL,
  student_name text NULL,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  source text NOT NULL DEFAULT 'parent_portal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_parent_id ON public.support_tickets(parent_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_student_id ON public.support_tickets(student_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_insert_own ON public.support_tickets;
CREATE POLICY support_tickets_insert_own
ON public.support_tickets
FOR INSERT
TO authenticated
WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS support_tickets_select_own ON public.support_tickets;
CREATE POLICY support_tickets_select_own
ON public.support_tickets
FOR SELECT
TO authenticated
USING (parent_id = auth.uid());

DROP POLICY IF EXISTS support_tickets_admin_select_all ON public.support_tickets;
CREATE POLICY support_tickets_admin_select_all
ON public.support_tickets
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin_general', 'superadmin', 'gestor_unidad')
  )
);

DROP POLICY IF EXISTS support_tickets_admin_update_all ON public.support_tickets;
CREATE POLICY support_tickets_admin_update_all
ON public.support_tickets
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin_general', 'superadmin', 'gestor_unidad')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin_general', 'superadmin', 'gestor_unidad')
  )
);

COMMENT ON TABLE public.support_tickets IS
  'Tickets de soporte del Portal de Padres con trazabilidad completa.';
