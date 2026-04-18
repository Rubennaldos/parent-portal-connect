-- ============================================================================
-- FIX: fn_sync_student_balance — corrección de polaridad (ABS)
--
-- PROBLEMA DETECTADO:
--   transactions.amount tiene signos mixtos según el origen:
--     - Compras kiosco/almuerzos automaticos → negativo (ej. -13.00)
--     - Registros manuales de prueba          → positivo (ej.  +5.00)
--   SUM(amount) con pending daba -21.00 cuando el valor real es 31.00.
--
-- SOLUCIÓN:
--   Usar SUM(ABS(amount)) para que la deuda pendiente sea siempre positiva,
--   independientemente del signo con que llegó la transacción.
--
-- REGLA DE ORO:
--   Un alumno NO puede tener deuda negativa.
--   balance = suma absoluta de sus compromisos pendientes.
--
-- SSOT: esta función es el único cerebro contable de transactions.
--       Cualquier cambio futuro se hace AQUÍ, no en funciones adicionales.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Actualizar fn_sync_student_balance con lógica ABS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_student_balance(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_total numeric := 0;
  v_lock_key      bigint;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN;
  END IF;

  -- Advisory lock por alumno: serializa recálculos concurrentes para el mismo student_id
  v_lock_key := ('x' || substr(md5(p_student_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- SUM(ABS(amount)) garantiza deuda siempre positiva, sin importar el signo
  -- con que la transacción fue registrada (kiosco, almuerzo, manual).
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_pending_total
  FROM public.transactions t
  WHERE t.student_id    = p_student_id
    AND t.is_deleted    = false
    AND t.payment_status = 'pending';

  UPDATE public.students
  SET balance = v_pending_total
  WHERE id = p_student_id;
END;
$function$;

COMMENT ON FUNCTION public.fn_sync_student_balance(uuid)
IS 'SSOT contable de transactions. Calcula deuda pendiente como SUM(ABS(amount)) para evitar polaridad mixta. Advisory lock por student_id. PROHIBIDO crear triggers paralelos de saldo.';

-- ---------------------------------------------------------------------------
-- 2) Sanación masiva: re-sincronizar TODOS los alumnos activos
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.students WHERE is_active = true
  LOOP
    PERFORM public.fn_sync_student_balance(r.id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Sanación masiva completada: % alumnos sincronizados.', v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Verificación: alumno "dddddd" debe tener balance = 31.00
-- ---------------------------------------------------------------------------
SELECT
  s.id,
  s.full_name,
  s.balance                                          AS balance_en_students,
  COALESCE((
    SELECT SUM(ABS(t.amount))
    FROM public.transactions t
    WHERE t.student_id    = s.id
      AND t.is_deleted    = false
      AND t.payment_status = 'pending'
  ), 0)                                              AS balance_calculado,
  s.balance = COALESCE((
    SELECT SUM(ABS(t.amount))
    FROM public.transactions t
    WHERE t.student_id    = s.id
      AND t.is_deleted    = false
      AND t.payment_status = 'pending'
  ), 0)                                              AS cuadra
FROM public.students s
WHERE s.full_name ILIKE '%dddddd%';

COMMIT;
