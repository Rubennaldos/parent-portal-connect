-- ══════════════════════════════════════════════════════════════════════════
-- RPC: get_student_pos_consumptions
-- Devuelve las transacciones POS de un alumno CON sus ítems de productos.
-- Reemplaza la query directa a `sales` (que tiene RLS restrictivo).
-- El padre puede llamarla si es parent_id del alumno.
-- ══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_student_pos_consumptions(uuid);

CREATE OR REPLACE FUNCTION get_student_pos_consumptions(p_student_id uuid)
RETURNS TABLE (
  id              uuid,
  ticket_code     text,
  amount          numeric,
  description     text,
  created_at      timestamptz,
  payment_method  text,
  payment_status  text,
  metadata        jsonb,
  sale_items      jsonb   -- array de productos del carrito (de tabla sales)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo el padre del alumno (o un admin/superadmin) puede ver estos datos
  IF NOT EXISTS (
    SELECT 1 FROM students s
    WHERE s.id = p_student_id
      AND (
        s.parent_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('admin_general', 'superadmin', 'gestor_unidad', 'supervisor_red')
        )
      )
  ) THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: no tienes permiso para ver los consumos de este alumno';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.ticket_code,
    t.amount,
    t.description,
    t.created_at,
    t.payment_method,
    t.payment_status,
    t.metadata,
    COALESCE(s.items, '[]'::jsonb)  AS sale_items
  FROM transactions t
  LEFT JOIN sales s ON s.transaction_id = t.id::text
  WHERE t.student_id  = p_student_id
    AND t.type        = 'purchase'
    AND t.is_deleted  = false
    AND (t.metadata->>'source') = 'pos'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.payment_status IN ('paid', 'pending')
  ORDER BY t.created_at DESC
  LIMIT 300;
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_pos_consumptions(uuid)
  TO authenticated;

COMMENT ON FUNCTION get_student_pos_consumptions IS
  'Devuelve transacciones POS de un alumno con sus ítems de productos (de tabla sales). '
  'Solo accesible por el padre del alumno o un admin. '
  'Reemplaza la doble query directa a transactions + sales en PosConsumptionModal.';
