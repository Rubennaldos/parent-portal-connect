-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN: DEUDAS FANTASMA — 49 alumnos afectados
-- Fecha: 2026-04-08
-- Autor: Cursor / Beto
--
-- INSTRUCCIONES DE EJECUCIÓN:
--   1. Lee el PASO 0 (SELECT de verificación) antes de hacer nada.
--   2. Si el conteo coincide con la tabla de diagnóstico, continúa.
--   3. Ejecuta el PASO 1 (Tipo A: balance >= 0) — los casos más claros.
--   4. Ejecuta el PASO 2 (Tipo B: balance < 0 con desfase parcial) — los más delicados.
--   5. Ejecuta el PASO 3 (verificación final) para confirmar que quedó limpio.
--
-- QUÉ HACE CADA PASO:
--   Tipo A: Marca como 'paid' TODOS los tickets POS pendientes de alumnos
--           cuyo balance ya es >= 0 (el padre ya pagó, el balance ya se restauró,
--           pero los tickets nunca se limpiaron).
--
--   Tipo B: Para alumnos con balance < 0 pero donde el total de tickets
--           pendientes supera el balance negativo real, marca como 'paid'
--           los tickets más ANTIGUOS (FIFO) hasta cubrir el exceso.
--           Deja los más recientes como 'pending' porque sí son deuda real.
--
-- QUÉ NO HACE:
--   - No toca students.balance (ya está correcto).
--   - No toca tickets de almuerzos (filtra por lunch_order_id IS NULL).
--   - No toca is_deleted = true.
--   - No genera saldo positivo artificialmente.
-- ═══════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════
-- PASO 0: VERIFICACIÓN PREVIA (ejecutar siempre primero)
-- ════════════════════════════════════════════

-- Cuántos tickets Tipo A se van a marcar paid (balance >= 0)
SELECT
  'Tipo A - balance >= 0 (todos los tickets son fantasma)' AS tipo,
  COUNT(DISTINCT t.student_id)  AS alumnos_afectados,
  COUNT(t.id)                   AS tickets_a_limpiar,
  SUM(ABS(t.amount))            AS monto_total_a_limpiar
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE t.type           = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND t.is_deleted     = false
  AND (t.metadata->>'lunch_order_id') IS NULL
  AND s.is_active      = true
  AND s.free_account   = true
  AND s.balance        >= 0;


-- Cuántos tickets Tipo B se van a marcar paid (balance < 0, desfase parcial)
WITH ranked AS (
  SELECT
    t.id,
    t.student_id,
    ABS(t.amount)   AS abs_amt,
    SUM(ABS(t.amount)) OVER (
      PARTITION BY t.student_id
      ORDER BY t.created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )               AS running_total
  FROM transactions t
  JOIN students s ON s.id = t.student_id
  WHERE t.type           = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND t.is_deleted     = false
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND s.is_active      = true
    AND s.free_account   = true
    AND s.balance        < 0
),
desfase_por_alumno AS (
  SELECT
    t2.student_id,
    SUM(ABS(t2.amount)) - ABS(s2.balance) AS monto_fantasma
  FROM transactions t2
  JOIN students s2 ON s2.id = t2.student_id
  WHERE t2.type           = 'purchase'
    AND t2.payment_status IN ('pending', 'partial')
    AND t2.is_deleted     = false
    AND (t2.metadata->>'lunch_order_id') IS NULL
    AND s2.is_active      = true
    AND s2.free_account   = true
    AND s2.balance        < 0
  GROUP BY t2.student_id, s2.balance
  HAVING SUM(ABS(t2.amount)) > ABS(s2.balance) + 0.50
)
SELECT
  'Tipo B - balance < 0 (desfase parcial, FIFO más antiguo)' AS tipo,
  COUNT(DISTINCT r.student_id)  AS alumnos_afectados,
  COUNT(r.id)                   AS tickets_a_limpiar,
  SUM(r.abs_amt)                AS monto_total_a_limpiar
FROM ranked r
JOIN desfase_por_alumno d ON d.student_id = r.student_id
WHERE r.running_total <= d.monto_fantasma + 0.10;


-- ════════════════════════════════════════════
-- PASO 1: LIMPIAR TIPO A — balance >= 0
-- (todos los tickets pending son 100% fantasma)
-- ════════════════════════════════════════════

UPDATE transactions t
SET
  payment_status = 'paid',
  payment_method = COALESCE(NULLIF(t.payment_method, ''), 'adjustment'),
  metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
    'payment_approved',     true,
    'payment_source',       'ghost_debt_cleanup_2026_04_08',
    'fix_reason',           'Balance ya restaurado (>= 0). Ticket quedó pending por error en aprobación anterior.',
    'fixed_at',             to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
FROM students s
WHERE t.student_id      = s.id
  AND t.type            = 'purchase'
  AND t.payment_status  IN ('pending', 'partial')
  AND t.is_deleted      = false
  AND (t.metadata->>'lunch_order_id') IS NULL
  AND s.is_active       = true
  AND s.free_account    = true
  AND s.balance         >= 0;

-- Verifica cuántas filas se afectaron:
-- (en Supabase SQL Editor se muestra automáticamente el número de filas)


-- ════════════════════════════════════════════
-- PASO 2: LIMPIAR TIPO B — balance < 0, desfase parcial (FIFO)
-- Marca como paid los tickets MÁS ANTIGUOS hasta cubrir el monto fantasma.
-- Deja los MÁS RECIENTES como pending (son la deuda real).
-- ════════════════════════════════════════════

WITH tickets_ordenados AS (
  -- Asignar un running total acumulado por alumno, ordenando de más antiguo a más nuevo
  SELECT
    t.id         AS tx_id,
    t.student_id,
    ABS(t.amount) AS abs_amt,
    SUM(ABS(t.amount)) OVER (
      PARTITION BY t.student_id
      ORDER BY t.created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )            AS running_total_acumulado
  FROM transactions t
  JOIN students s ON s.id = t.student_id
  WHERE t.type           = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND t.is_deleted     = false
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND s.is_active      = true
    AND s.free_account   = true
    AND s.balance        < 0
),
monto_fantasma_por_alumno AS (
  -- Cuánto hay que limpiar por alumno (total pending - deuda real)
  SELECT
    t2.student_id,
    SUM(ABS(t2.amount)) - ABS(s2.balance) AS monto_a_limpiar
  FROM transactions t2
  JOIN students s2 ON s2.id = t2.student_id
  WHERE t2.type           = 'purchase'
    AND t2.payment_status IN ('pending', 'partial')
    AND t2.is_deleted     = false
    AND (t2.metadata->>'lunch_order_id') IS NULL
    AND s2.is_active      = true
    AND s2.free_account   = true
    AND s2.balance        < 0
  GROUP BY t2.student_id, s2.balance
  HAVING SUM(ABS(t2.amount)) > ABS(s2.balance) + 0.50
),
tickets_a_marcar_paid AS (
  -- Los tickets cuyo running_total <= monto_a_limpiar son los fantasmas (los más viejos)
  SELECT to2.tx_id
  FROM tickets_ordenados   to2
  JOIN monto_fantasma_por_alumno mf ON mf.student_id = to2.student_id
  WHERE to2.running_total_acumulado <= mf.monto_a_limpiar + 0.10
)
UPDATE transactions t
SET
  payment_status = 'paid',
  payment_method = COALESCE(NULLIF(t.payment_method, ''), 'adjustment'),
  metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
    'payment_approved',     true,
    'payment_source',       'ghost_debt_cleanup_partial_2026_04_08',
    'fix_reason',           'Ticket fantasma: excede la deuda real (balance negativo). Limpieza FIFO más antiguo primero.',
    'fixed_at',             to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
FROM tickets_a_marcar_paid tp
WHERE t.id = tp.tx_id
  AND t.payment_status IN ('pending', 'partial');


-- ════════════════════════════════════════════
-- PASO 3: VERIFICACIÓN FINAL
-- Debería devolver 0 filas si la limpieza fue completa.
-- ════════════════════════════════════════════

WITH tickets_pendientes_pos AS (
  SELECT
    t.student_id,
    SUM(ABS(t.amount)) AS monto_pendiente
  FROM transactions t
  WHERE t.type           = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND t.is_deleted     = false
    AND (t.metadata->>'lunch_order_id') IS NULL
  GROUP BY t.student_id
)
SELECT
  s.full_name                                           AS alumno,
  sc.name                                               AS sede,
  COALESCE(tp.monto_pendiente, 0)                       AS deuda_en_pantalla_restante,
  CASE WHEN s.balance < 0 THEN ABS(s.balance) ELSE 0 END AS deuda_real_kiosco,
  GREATEST(0,
    COALESCE(tp.monto_pendiente, 0)
    - CASE WHEN s.balance < 0 THEN ABS(s.balance) ELSE 0 END
  )                                                     AS monto_desfasado_restante,
  s.balance                                             AS balance_actual
FROM students s
JOIN schools sc ON sc.id = s.school_id
LEFT JOIN tickets_pendientes_pos tp ON tp.student_id = s.id
WHERE s.is_active    = true
  AND s.free_account = true
  AND COALESCE(tp.monto_pendiente, 0) > 0
  AND (
    s.balance >= 0
    OR COALESCE(tp.monto_pendiente, 0) > (CASE WHEN s.balance < 0 THEN ABS(s.balance) ELSE 0 END) + 0.50
  )
ORDER BY sc.name, monto_desfasado_restante DESC;

-- Si devuelve 0 filas: ✅ Limpieza completa.
-- Si devuelve filas: revisar manualmente esos casos restantes.
