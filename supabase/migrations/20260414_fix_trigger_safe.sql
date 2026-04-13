-- ══════════════════════════════════════════════════════════════════════════════
-- FIX: Trigger trg_refresh_student_balance — versión segura
-- Fecha: 2026-04-14
--
-- PROBLEMA ANTERIOR:
--   El trigger row-level llamaba a sync_student_balance(), que internamente
--   hace SELECT ... FOR UPDATE en students.
--   Si una operación de lote (batch approval) actualizaba varias transacciones
--   del mismo alumno en secuencia, múltiples instancias del trigger competían
--   por el mismo FOR UPDATE → deadlock / 504 Gateway Timeout.
--
-- SOLUCIÓN:
--   1. Eliminar el trigger anterior con FOR UPDATE.
--   2. sync_student_balance en modo trigger NO bloquea (no FOR UPDATE).
--      El FOR UPDATE solo se usa en llamadas manuales (dry_run, mantenimiento).
--   3. Condición WHEN estricta: solo se dispara si cambia amount,
--      payment_status o is_deleted — evita disparos en actualizaciones de
--      columnas irrelevantes (ej. metadata).
--   4. SECURITY INVOKER en la función del trigger (no SECURITY DEFINER)
--      para no escalar privilegios en contexto de trigger.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Paso 1: eliminar el trigger y la función anterior ────────────────────────
DROP TRIGGER  IF EXISTS trg_refresh_student_balance ON transactions;
DROP FUNCTION IF EXISTS trg_refresh_student_balance_fn();

-- ── Paso 2: función liviana para el trigger (sin FOR UPDATE) ─────────────────
CREATE OR REPLACE FUNCTION trg_refresh_student_balance_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  sid UUID;
  v_calculated NUMERIC;
BEGIN
  -- Determinar qué alumno se vio afectado
  IF TG_OP = 'DELETE' THEN
    sid := OLD.student_id;
  ELSE
    sid := NEW.student_id;
  END IF;

  -- Si el student_id cambia en un UPDATE, sincronizar también el anterior
  IF TG_OP = 'UPDATE'
     AND OLD.student_id IS NOT NULL
     AND OLD.student_id IS DISTINCT FROM NEW.student_id THEN
    SELECT COALESCE(SUM(
      CASE
        WHEN type = 'recharge' AND payment_status = 'paid'            THEN ABS(amount)
        WHEN type = 'purchase' AND payment_status IN ('paid','pending','partial')
             AND (metadata->>'lunch_order_id') IS NULL                 THEN amount
        WHEN type = 'adjustment' AND payment_status = 'paid'          THEN amount
        ELSE 0
      END
    ), 0)
    INTO v_calculated
    FROM transactions
    WHERE student_id = OLD.student_id
      AND is_deleted = false
      AND payment_status <> 'cancelled';

    UPDATE students SET balance = v_calculated WHERE id = OLD.student_id;
  END IF;

  -- Sincronizar el alumno afectado (sin FOR UPDATE → sin riesgo de deadlock)
  IF sid IS NOT NULL THEN
    SELECT COALESCE(SUM(
      CASE
        WHEN type = 'recharge' AND payment_status = 'paid'            THEN ABS(amount)
        WHEN type = 'purchase' AND payment_status IN ('paid','pending','partial')
             AND (metadata->>'lunch_order_id') IS NULL                 THEN amount
        WHEN type = 'adjustment' AND payment_status = 'paid'          THEN amount
        ELSE 0
      END
    ), 0)
    INTO v_calculated
    FROM transactions
    WHERE student_id = sid
      AND is_deleted = false
      AND payment_status <> 'cancelled';

    UPDATE students SET balance = v_calculated WHERE id = sid;
  END IF;

  RETURN NULL; -- AFTER trigger: valor ignorado por Postgres
END;
$$;

COMMENT ON FUNCTION trg_refresh_student_balance_fn IS
  'Trigger AFTER I/U/D en transactions: recalcula students.balance sin FOR UPDATE.
   WHEN condition filtra solo cambios en amount, payment_status o is_deleted.';

-- ── Paso 3: recrear el trigger con condición WHEN estricta ───────────────────
-- Solo se dispara si cambia algo que afecte al saldo:
--   · INSERT / DELETE → siempre relevante
--   · UPDATE → solo si amount, payment_status o is_deleted cambiaron
CREATE TRIGGER trg_refresh_student_balance
  AFTER INSERT OR DELETE ON transactions
  FOR EACH ROW
  EXECUTE PROCEDURE trg_refresh_student_balance_fn();

-- Trigger separado para UPDATE con condición WHEN
-- (CREATE TRIGGER ... WHEN no puede mezclar INSERT/DELETE en algunos motores)
CREATE TRIGGER trg_refresh_student_balance_upd
  AFTER UPDATE OF amount, payment_status, is_deleted ON transactions
  FOR EACH ROW
  WHEN (
    OLD.amount          IS DISTINCT FROM NEW.amount          OR
    OLD.payment_status  IS DISTINCT FROM NEW.payment_status  OR
    OLD.is_deleted      IS DISTINCT FROM NEW.is_deleted
  )
  EXECUTE PROCEDURE trg_refresh_student_balance_fn();

-- ── Paso 4: verificación rápida ───────────────────────────────────────────────
SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'transactions'
  AND trigger_name LIKE 'trg_refresh%'
ORDER BY trigger_name, event_manipulation;

SELECT 'fix_trigger_safe OK' AS resultado;
