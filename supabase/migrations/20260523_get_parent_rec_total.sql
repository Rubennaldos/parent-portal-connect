-- ============================================================================
-- get_parent_rec_total
-- 2026-05-23
--
-- Objetivo: reemplazar get_parent_wallet_total (suma de wallet_balance legacy)
-- en el banner del portal padre por el saldo REC real por alumno.
--
-- Fuente única: view_recharge_ledger (FIFO aprobado, mismo origen que el modal
-- "Saldo de Recargas" / REC-001). Regla 11.A: todos los cálculos en DB.
--
-- Devuelve JSONB:
--   total_remaining → suma del saldo REC disponible de todos los hijos activos
--   students        → [{ student_id, full_name, remaining }] ordenado por nombre
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_parent_rec_total(p_parent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_result    jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('total_remaining', 0, 'students', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'total_remaining', COALESCE(SUM(sub.remaining), 0),
    'students', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'student_id', sub.student_id,
          'full_name',  sub.full_name,
          'remaining',  sub.remaining
        ) ORDER BY sub.full_name
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM (
    SELECT
      s.id                                            AS student_id,
      s.full_name,
      COALESCE(
        (SELECT MAX(vrl.recharge_remaining_student)
         FROM   public.view_recharge_ledger vrl
         WHERE  vrl.student_id = s.id),
        0
      )::numeric(10,2)                                AS remaining
    FROM public.students s
    WHERE s.parent_id = p_parent_id
      AND s.is_active = true
  ) sub;

  RETURN COALESCE(v_result, jsonb_build_object('total_remaining', 0, 'students', '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.get_parent_rec_total(uuid) IS
  '2026-05-23 — Saldo REC disponible por padre: total + desglose por alumno. '
  'Fuente: view_recharge_ledger (FIFO aprobado). '
  'Reemplaza get_parent_wallet_total en el banner del portal padre. '
  'Regla 11.A: cero cálculos financieros en frontend.';

GRANT EXECUTE ON FUNCTION public.get_parent_rec_total(uuid) TO authenticated;

SELECT 'OK: get_parent_rec_total creada' AS resultado;
