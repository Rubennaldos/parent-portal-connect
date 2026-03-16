-- =====================================================================
-- FIX CRÍTICO: Trigger contamina balance con almuerzos
-- 
-- PROBLEMA: El trigger "on_transaction_created" ejecuta
--   update students set balance = balance + new.amount
-- en CADA INSERT a transactions, incluyendo almuerzos.
-- Esto genera deuda fantasma en cientos de alumnos.
--
-- SOLUCIÓN:
--   Paso A: Modificar el trigger para que IGNORE transacciones de almuerzo
--   Paso B: Recalcular el balance correcto de TODOS los alumnos afectados
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- PASO A: CORREGIR EL TRIGGER (detener el sangrado)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_student_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- NUNCA tocar el balance por transacciones de almuerzo
  -- Los almuerzos tienen lunch_order_id en metadata
  IF NEW.metadata IS NOT NULL AND (NEW.metadata->>'lunch_order_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.students
  SET balance = balance + NEW.amount
  WHERE id = NEW.student_id;

  RETURN NEW;
END;
$$;

-- Verificar que el trigger se actualizó
SELECT 'Trigger update_student_balance actualizado — ya no toca balance por almuerzos' AS resultado;


-- ═══════════════════════════════════════════════════════════════════════
-- PASO B: RECALCULAR BALANCES DE TODOS LOS ALUMNOS AFECTADOS
-- ═══════════════════════════════════════════════════════════════════════

-- Primero: ver cuántos alumnos están afectados (solo lectura)
WITH balance_correcto AS (
  SELECT
    s.id,
    s.full_name,
    s.balance AS balance_actual,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount
        ELSE 0
      END
    ), 0) AS balance_nuevo
  FROM students s
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance
)
SELECT
  COUNT(*) FILTER (WHERE ABS(balance_actual - balance_nuevo) > 0.01) AS alumnos_a_corregir,
  SUM(ABS(balance_actual - balance_nuevo)) FILTER (WHERE ABS(balance_actual - balance_nuevo) > 0.01) AS discrepancia_total
FROM balance_correcto;


-- Aplicar la corrección masiva
-- Solo actualiza alumnos donde el balance es diferente al correcto
UPDATE students s
SET balance = bc.balance_nuevo
FROM (
  SELECT
    s2.id,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount
        ELSE 0
      END
    ), 0) AS balance_nuevo
  FROM students s2
  LEFT JOIN transactions t ON t.student_id = s2.id
  WHERE s2.is_active = true
  GROUP BY s2.id
) bc
WHERE s.id = bc.id
  AND s.is_active = true
  AND ABS(s.balance - bc.balance_nuevo) > 0.01;


-- ═══════════════════════════════════════════════════════════════════════
-- PASO C: VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════

-- Confirmar que ya no hay discrepancias
WITH verificacion AS (
  SELECT
    s.id,
    s.full_name,
    s.balance AS balance_actual,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount
        ELSE 0
      END
    ), 0) AS balance_esperado
  FROM students s
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance
  HAVING ABS(s.balance - COALESCE(SUM(
    CASE
      WHEN t.is_deleted = false
       AND t.payment_status != 'cancelled'
       AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
      THEN t.amount
      ELSE 0
    END
  ), 0)) > 0.01
)
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '✅ VERIFICACIÓN EXITOSA — Todos los balances están correctos'
    ELSE '❌ ATENCIÓN: ' || COUNT(*) || ' alumnos aún tienen discrepancia'
  END AS resultado,
  COUNT(*) AS discrepancias_restantes
FROM verificacion;


-- Muestra de los Bellido Tirado para confirmar
SELECT
  s.full_name,
  s.balance AS balance_corregido,
  s.free_account
FROM students s
WHERE s.full_name ILIKE '%Bellido%Tirado%'
ORDER BY s.full_name;
