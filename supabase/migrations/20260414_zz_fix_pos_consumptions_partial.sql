-- ══════════════════════════════════════════════════════════════════════════════
-- FIX: get_student_pos_consumptions — incluir payment_status 'partial'
--
-- MOTIVO: La RPC solo filtraba 'paid' y 'pending'. El estado 'partial' existe
--         para compras pagadas parcialmente; sin él no aparecen en el modal
--         de detalle del padre.
-- IMPACTO: Solo lectura. No modifica datos. No afecta ningún otro flujo.
-- ══════════════════════════════════════════════════════════════════════════════

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
  sale_items      jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
    COALESCE(s.items, '[]'::jsonb) AS sale_items
  FROM transactions t
  LEFT JOIN sales s ON s.transaction_id = t.id::text
  WHERE t.student_id  = p_student_id
    AND t.type        = 'purchase'
    AND t.is_deleted  = false
    AND (t.metadata->>'source') = 'pos'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.payment_status IN ('paid', 'pending', 'partial')
  ORDER BY t.created_at DESC
  LIMIT 300;
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_pos_consumptions(uuid) TO authenticated;

COMMENT ON FUNCTION get_student_pos_consumptions IS
  'Devuelve transacciones POS de un alumno con sus ítems de productos (de tabla sales). '
  'Solo accesible por el padre del alumno o un admin. '
  'Incluye payment_status: paid, pending, partial.';

SELECT 'get_student_pos_consumptions actualizado (+ partial)' AS resultado;
