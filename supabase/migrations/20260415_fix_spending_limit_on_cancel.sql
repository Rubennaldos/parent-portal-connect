-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: Recalcular current_period_spent al anular una venta
-- Fecha: 2026-04-15
--
-- PROBLEMA RAÍZ (Split-Brain de contadores):
--   La columna students.current_period_spent se INCREMENTA correctamente
--   cuando se inserta una compra de kiosco (trigger trg_sync_period_spent,
--   AFTER INSERT). Pero NUNCA se recalcula cuando una compra se anula
--   (handleAnnulSale → payment_status = 'cancelled').
--
--   Resultado:
--     - DB-level guard (fn_guard_kiosk_spending_limits) calcula desde
--       transactions, excluye 'cancelled' → correcto.
--     - POS frontend lee students.current_period_spent → valor viejo (stale).
--     - El alumno ve "Tope superado" aunque el guard lo dejaría pasar.
--
-- REGLA DE ORO: "Lo que se anula no suma".
--   La fuente de verdad SIEMPRE son las transacciones. La columna
--   current_period_spent es solo una caché. Hay que mantenerla sincronizada.
--
-- SOLUCIÓN:
--   Trigger AFTER UPDATE en transactions.
--   Se activa cuando:
--     (a) payment_status cambia a 'cancelled' (anulación directa), O
--     (b) is_deleted cambia de false a true (soft-delete).
--   En ambos casos, recalcula current_period_spent sumando transacciones
--   activas del período actual (la misma lógica del trigger AFTER INSERT).
--
-- DISEÑO IDEMPOTENTE:
--   No hace decremento aritmético (que podría ir negativo con múltiples
--   anulaciones). Recalcula desde cero. Ejecutarlo N veces da el mismo
--   resultado. Coincide con la lógica del guard de seguridad.
--
-- IMPACTO:
--   Solo compras de kiosco de alumnos con tope activo. No afecta:
--     - Almuerzos (metadata->>'lunch_order_id' IS NOT NULL)
--     - Profesores o clientes genéricos (student_id IS NULL)
--     - Alumnos sin tope (limit_type = 'none' o NULL)
-- ═══════════════════════════════════════════════════════════════════════════


-- ── FUNCIÓN DEL TRIGGER ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_period_spent_after_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_type   text;
  v_period_start timestamptz;
  v_period_spent numeric;
BEGIN

  -- ── Condición de activación: solo cuando la fila "sale del cómputo" ─────
  -- Caso A: payment_status cambia a 'cancelled' (anulación de venta)
  -- Caso B: is_deleted cambia de false → true (soft-delete)
  -- Si ninguno de los dos ocurre, esta función es un no-op barato.
  IF NOT (
    (NEW.payment_status = 'cancelled' AND OLD.payment_status IS DISTINCT FROM 'cancelled')
    OR
    (COALESCE(NEW.is_deleted, false) = true AND COALESCE(OLD.is_deleted, false) = false)
  ) THEN
    RETURN NEW;
  END IF;

  -- ── Solo compras de kiosco de alumnos ───────────────────────────────────
  IF NEW.type <> 'purchase'
     OR NEW.student_id IS NULL
     OR (NEW.metadata->>'lunch_order_id') IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  -- ── Obtener tipo de tope del alumno ─────────────────────────────────────
  SELECT limit_type INTO v_limit_type
  FROM students
  WHERE id = NEW.student_id;

  IF NOT FOUND OR v_limit_type IS NULL OR v_limit_type = 'none' THEN
    RETURN NEW; -- Sin tope: no hay nada que recalcular
  END IF;

  -- ── Inicio del período actual (hora Lima) ───────────────────────────────
  CASE v_limit_type
    WHEN 'daily' THEN
      v_period_start := (timezone('America/Lima', NOW())::date)::timestamp
                          AT TIME ZONE 'America/Lima';

    WHEN 'weekly' THEN
      v_period_start := date_trunc('week', timezone('America/Lima', NOW())::timestamp)
                          AT TIME ZONE 'America/Lima';

    WHEN 'monthly' THEN
      v_period_start := date_trunc('month', timezone('America/Lima', NOW())::timestamp)
                          AT TIME ZONE 'America/Lima';

    ELSE
      RETURN NEW;
  END CASE;

  -- ── Recalcular gasto real desde la fuente de verdad ─────────────────────
  -- Exactamente la misma lógica que fn_guard_kiosk_spending_limits y
  -- fn_sync_period_spent_after_purchase: excluye cancelled + is_deleted +
  -- almuerzos. Idempotente: N ejecuciones = mismo resultado.
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
  INTO   v_period_spent
  FROM   transactions t
  WHERE  t.student_id                       = NEW.student_id
    AND  t.type                              = 'purchase'
    AND  t.is_deleted                        = false
    AND  t.payment_status                   <> 'cancelled'
    AND  (t.metadata->>'lunch_order_id')  IS NULL
    AND  t.created_at                       >= v_period_start;

  -- ── Actualizar el contador del alumno ───────────────────────────────────
  UPDATE students
  SET    current_period_spent = v_period_spent
  WHERE  id = NEW.student_id;

  RAISE NOTICE
    '[spending_limit] Anulación detectada. Alumno %. Período: %. '
    'current_period_spent recalculado: S/ %.',
    NEW.student_id, v_limit_type, round(v_period_spent, 2);

  RETURN NEW;

END;
$$;

COMMENT ON FUNCTION fn_sync_period_spent_after_cancel IS
  'Recalcula students.current_period_spent cuando una compra de kiosco '
  'cambia a cancelled o es_deleted=true. Mantiene sincronizada la caché '
  'de gasto del período con la fuente de verdad (transactions). '
  'Activado: AFTER UPDATE en transactions (trg_sync_period_spent_on_cancel). '
  'Diseño idempotente: recalcula desde cero, no hace decremento aritmético.';


-- ── TRIGGER ────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_sync_period_spent_on_cancel ON transactions;

CREATE TRIGGER trg_sync_period_spent_on_cancel
  AFTER UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_period_spent_after_cancel();

COMMENT ON TRIGGER trg_sync_period_spent_on_cancel ON transactions IS
  'Activa fn_sync_period_spent_after_cancel tras cualquier UPDATE en '
  'transactions. La función misma filtra si realmente cambió el estado '
  'relevante (payment_status → cancelled o is_deleted → true), por lo '
  'que otros UPDATEs (editar metadata, cambiar payment_method, etc.) '
  'son un no-op muy barato.';


-- ── CORRECCIÓN INMEDIATA DE ALUMNOS AFECTADOS ──────────────────────────────
-- Recalcula current_period_spent para TODOS los alumnos con tope activo.
-- Corrige de inmediato los valores corruptos causados por anulaciones previas.
-- No toca alumnos sin tope (limit_type = 'none' o NULL).

WITH period_start AS (
  SELECT
    s.id                AS student_id,
    s.limit_type,
    CASE s.limit_type
      WHEN 'daily'
        THEN (timezone('America/Lima', NOW())::date)::timestamp
               AT TIME ZONE 'America/Lima'
      WHEN 'weekly'
        THEN date_trunc('week', timezone('America/Lima', NOW())::timestamp)
               AT TIME ZONE 'America/Lima'
      WHEN 'monthly'
        THEN date_trunc('month', timezone('America/Lima', NOW())::timestamp)
               AT TIME ZONE 'America/Lima'
    END AS ps
  FROM students s
  WHERE s.limit_type IN ('daily', 'weekly', 'monthly')
),
real_spent AS (
  SELECT
    p.student_id,
    COALESCE(SUM(ABS(t.amount)), 0) AS gasto_real
  FROM period_start p
  LEFT JOIN transactions t
    ON  t.student_id                     = p.student_id
    AND t.type                            = 'purchase'
    AND t.is_deleted                      = false
    AND t.payment_status                 <> 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at                     >= p.ps
  GROUP BY p.student_id
)
UPDATE students s
SET    current_period_spent = r.gasto_real
FROM   real_spent r
WHERE  s.id                   = r.student_id
  AND  s.current_period_spent <> r.gasto_real; -- Solo actualiza si hay diferencia

-- Verificación: cuántos alumnos tenían el contador desincronizado
SELECT
  COUNT(*)           AS alumnos_corregidos,
  SUM(current_period_spent) AS gasto_total_activo_soles
FROM students
WHERE limit_type IN ('daily', 'weekly', 'monthly');

SELECT '✅ Fix spending_limit aplicado: trigger + corrección de datos históricos' AS resultado;
