-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: Actualizar current_period_spent después de cada compra de kiosco
-- Fecha: 2026-04-06
--
-- PROBLEMA:
--   students.current_period_spent nunca se actualizaba después de una compra.
--   El trigger BEFORE INSERT (fn_guard_kiosk_spending_limits) valida el tope
--   correctamente, pero no escribe en students.current_period_spent.
--   Por eso el frontend siempre mostraba el tope completo (ej: S/ 6.00 disp.)
--   en lugar del disponible real (ej: S/ 2.00 disp. si ya se gastó S/ 4.00).
--
-- SOLUCIÓN:
--   Trigger AFTER INSERT en transactions que, para cada compra de kiosco
--   de un alumno, recalcula current_period_spent sumando TODAS las compras
--   del período actual desde las transacciones (fuente de verdad).
--   También actualiza next_reset_date si no estaba definida o ya venció.
--
-- PERÍODO ACTUAL (hora Lima, sin DST):
--   daily   → desde medianoche de hoy Lima (05:00 UTC)
--   weekly  → desde el lunes de esta semana Lima
--   monthly → desde el día 1 de este mes Lima
--
-- REGLA #1 RESPETADA: Solo aplica a compras de kiosco (lunch_order_id IS NULL)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_sync_period_spent_after_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_type    text;
  v_period_start  timestamptz;
  v_period_end    timestamptz;
  v_period_spent  numeric;
BEGIN
  -- ── Solo compras de kiosco de alumnos ──────────────────────────────────
  IF NEW.type <> 'purchase'
     OR NEW.student_id IS NULL
     OR (NEW.metadata->>'lunch_order_id') IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  -- ── Obtener el tipo de tope del alumno ─────────────────────────────────
  SELECT limit_type INTO v_limit_type
  FROM students
  WHERE id = NEW.student_id;

  IF NOT FOUND OR v_limit_type IS NULL OR v_limit_type = 'none' THEN
    RETURN NEW; -- Sin tope configurado: no actualizar
  END IF;

  -- ── Calcular inicio y fin del período actual (hora Lima) ───────────────
  CASE v_limit_type
    WHEN 'daily' THEN
      -- Medianoche de hoy Lima → mañana Lima
      v_period_start := (timezone('America/Lima', NOW())::date)::timestamp
                          AT TIME ZONE 'America/Lima';
      v_period_end   := v_period_start + INTERVAL '1 day';

    WHEN 'weekly' THEN
      -- Lunes de esta semana Lima
      v_period_start := date_trunc('week', timezone('America/Lima', NOW())::timestamp)
                          AT TIME ZONE 'America/Lima';
      v_period_end   := v_period_start + INTERVAL '7 days';

    WHEN 'monthly' THEN
      -- Día 1 de este mes Lima
      v_period_start := date_trunc('month', timezone('America/Lima', NOW())::timestamp)
                          AT TIME ZONE 'America/Lima';
      v_period_end   := v_period_start + INTERVAL '1 month';

    ELSE
      RETURN NEW;
  END CASE;

  -- ── Sumar todo lo gastado en el período actual (excluir almuerzos) ─────
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
  INTO v_period_spent
  FROM transactions t
  WHERE t.student_id     = NEW.student_id
    AND t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status <> 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at     >= v_period_start;

  -- ── Actualizar students con el gasto real del período ──────────────────
  UPDATE students
  SET
    current_period_spent = v_period_spent,
    -- Actualizar next_reset_date solo si es NULL o ya pasó
    next_reset_date = CASE
      WHEN next_reset_date IS NULL OR NOW() >= next_reset_date
      THEN v_period_end
      ELSE next_reset_date
    END
  WHERE id = NEW.student_id;

  RETURN NEW;
END;
$$;

-- Eliminar trigger previo si existe
DROP TRIGGER IF EXISTS trg_sync_period_spent ON transactions;

-- Crear trigger AFTER INSERT (se dispara cuando la compra ya está guardada)
CREATE TRIGGER trg_sync_period_spent
  AFTER INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_period_spent_after_purchase();

-- ── Recalcular current_period_spent para alumnos con tope activo ──────────
-- (Fix para los registros existentes con current_period_spent = 0)
WITH period_data AS (
  SELECT
    s.id AS student_id,
    s.limit_type,
    CASE s.limit_type
      WHEN 'daily'
        THEN (timezone('America/Lima', NOW())::date)::timestamp AT TIME ZONE 'America/Lima'
      WHEN 'weekly'
        THEN date_trunc('week', timezone('America/Lima', NOW())::timestamp) AT TIME ZONE 'America/Lima'
      WHEN 'monthly'
        THEN date_trunc('month', timezone('America/Lima', NOW())::timestamp) AT TIME ZONE 'America/Lima'
    END AS period_start
  FROM students s
  WHERE s.limit_type IN ('daily', 'weekly', 'monthly')
),
spent_data AS (
  SELECT
    pd.student_id,
    pd.limit_type,
    pd.period_start,
    COALESCE(SUM(ABS(t.amount)), 0) AS total_spent
  FROM period_data pd
  LEFT JOIN transactions t
    ON t.student_id    = pd.student_id
   AND t.type          = 'purchase'
   AND t.is_deleted    = false
   AND t.payment_status <> 'cancelled'
   AND (t.metadata->>'lunch_order_id') IS NULL
   AND t.created_at   >= pd.period_start
  GROUP BY pd.student_id, pd.limit_type, pd.period_start
)
UPDATE students s
SET
  current_period_spent = sd.total_spent,
  next_reset_date = CASE
    WHEN s.next_reset_date IS NULL OR NOW() >= s.next_reset_date THEN
      CASE sd.limit_type
        WHEN 'daily'   THEN sd.period_start + INTERVAL '1 day'
        WHEN 'weekly'  THEN sd.period_start + INTERVAL '7 days'
        WHEN 'monthly' THEN sd.period_start + INTERVAL '1 month'
      END
    ELSE s.next_reset_date
  END
FROM spent_data sd
WHERE s.id = sd.student_id;

-- Verificación
SELECT
  tgname     AS trigger,
  proname    AS funcion,
  prosecdef  AS security_definer
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgname = 'trg_sync_period_spent';

SELECT
  COUNT(*) AS alumnos_con_tope,
  SUM(current_period_spent) AS gasto_total_actualizado
FROM students
WHERE limit_type IN ('daily', 'weekly', 'monthly');

SELECT '✅ Trigger trg_sync_period_spent creado — current_period_spent se actualiza en cada compra' AS status;
