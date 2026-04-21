-- RPC: get_student_purchase_history
-- Objetivo: el frontend SOLO renderiza datos ya clasificados desde DB
-- (sin inferencias por metadata en cliente).

DROP FUNCTION IF EXISTS public.get_student_purchase_history(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.get_student_purchase_history(
  p_student_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  amount numeric,
  description text,
  created_at timestamptz,
  ticket_code text,
  payment_status text,
  db_type text,
  is_lunch boolean,
  consumption_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Seguridad: solo el padre del alumno o roles admin pueden consultar
  IF NOT EXISTS (
    SELECT 1
    FROM students s
    WHERE s.id = p_student_id
      AND (
        s.parent_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('admin_general', 'superadmin', 'gestor_unidad', 'supervisor_red')
        )
      )
  ) THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: no tienes permiso para ver compras de este alumno';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.amount,
    COALESCE(NULLIF(trim(t.description), ''), 'Consumo') AS description,
    t.created_at,
    t.ticket_code,
    t.payment_status,
    t.type AS db_type,
    ((t.metadata->>'lunch_order_id') IS NOT NULL) AS is_lunch,
    CASE
      WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'Almuerzo escolar'
      ELSE 'Compra kiosco'
    END AS consumption_label
  FROM transactions t
  WHERE t.student_id = p_student_id
    AND t.type = 'purchase'
    AND t.is_deleted = false
    AND t.payment_status <> 'cancelled'
  ORDER BY t.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_purchase_history(uuid, integer, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_student_purchase_history(uuid, integer, integer) IS
  'Historial de compras (purchase) de un alumno para portal de padres. '
  'Incluye clasificación backend (is_lunch/consumption_label) para evitar inferencias en frontend.';

