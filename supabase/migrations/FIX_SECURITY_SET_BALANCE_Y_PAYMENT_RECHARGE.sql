-- ================================================================
-- FIX DE SEGURIDAD: Cierre definitivo de brechas de saldo
-- Fecha: 2026-03-15
--
-- Qué hace este script:
--   1. Revoca set_student_balance de PUBLIC (el REVOKE anterior
--      solo quitó 'authenticated' y 'anon', pero PUBLIC persiste)
--   2. Corrige apply_payment_recharge para que cuando la pasarela
--      se use en el futuro, la transacción quede bien registrada
--      (con school_id, payment_status, metadata)
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- PASO 1: Revocar set_student_balance de PUBLIC
-- ════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION set_student_balance(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;

-- Verificar que solo queda postgres y service_role
SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'set_student_balance'
ORDER BY grantee;

SELECT '✅ PASO 1: set_student_balance revocado de PUBLIC. Solo service_role y postgres pueden usarla.' AS resultado;


-- ════════════════════════════════════════════════════════════════
-- PASO 2: Corregir apply_payment_recharge
-- Problema actual: la función inserta en transactions sin
-- school_id ni payment_status, generando transacciones huérfanas.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_payment_recharge()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_school_id UUID;
BEGIN
  -- Solo actuar cuando el estado cambia a 'approved' y aún no se aplicó
  IF NEW.status = 'approved' AND NEW.recharge_applied = false AND NEW.student_id IS NOT NULL THEN

    -- Obtener el school_id del alumno para no crear transacciones huérfanas
    SELECT school_id INTO v_school_id
    FROM students
    WHERE id = NEW.student_id;

    -- Actualizar saldo del alumno de forma atómica
    UPDATE students
    SET balance = balance + NEW.amount
    WHERE id = NEW.student_id;

    -- Marcar como aplicada y registrar timestamp
    NEW.recharge_applied := true;
    NEW.approved_at := NOW();

    -- Registrar en transactions con todos los campos obligatorios
    INSERT INTO transactions (
      student_id,
      school_id,
      type,
      amount,
      payment_method,
      payment_status,
      metadata,
      notes,
      created_by
    ) VALUES (
      NEW.student_id,
      v_school_id,
      'recharge',
      NEW.amount,
      COALESCE(NEW.payment_method, 'online'),
      'paid',
      jsonb_build_object(
        'source',                'payment_gateway',
        'gateway',               NEW.payment_gateway,
        'transaction_reference', COALESCE(NEW.transaction_reference, NEW.id::text),
        'payment_transaction_id', NEW.id
      ),
      'Recarga vía pasarela ' || COALESCE(NEW.payment_gateway, 'online') ||
        ' — Ref: ' || COALESCE(NEW.transaction_reference, NEW.id::text),
      NEW.user_id
    );

  END IF;

  RETURN NEW;
END;
$function$;

SELECT '✅ PASO 2: apply_payment_recharge corregida — ya incluye school_id, payment_status y metadata.' AS resultado;


-- ════════════════════════════════════════════════════════════════
-- VERIFICACIÓN FINAL
-- ════════════════════════════════════════════════════════════════

-- Confirmar permisos de set_student_balance
SELECT
  CASE
    WHEN COUNT(*) FILTER (WHERE grantee NOT IN ('postgres', 'service_role')) = 0
    THEN '✅ set_student_balance: solo postgres y service_role pueden ejecutarla'
    ELSE '⚠️ ATENCIÓN: set_student_balance aún tiene permisos en: ' ||
         STRING_AGG(grantee, ', ') FILTER (WHERE grantee NOT IN ('postgres', 'service_role'))
  END AS estado_seguridad
FROM information_schema.routine_privileges
WHERE routine_name = 'set_student_balance';

-- Confirmar que adjust_student_balance sigue accesible para authenticated
SELECT
  CASE
    WHEN COUNT(*) FILTER (WHERE grantee = 'authenticated') > 0
    THEN '✅ adjust_student_balance: accesible para authenticated (correcto)'
    ELSE '⚠️ adjust_student_balance: NO tiene EXECUTE para authenticated — verificar'
  END AS estado_rpc_seguro
FROM information_schema.routine_privileges
WHERE routine_name = 'adjust_student_balance';
