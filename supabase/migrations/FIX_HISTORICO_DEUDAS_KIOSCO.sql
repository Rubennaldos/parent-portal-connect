-- =========================================================
-- FIX HISTÓRICO: Saldar deudas pendientes del kiosco
--                para alumnos que ya tienen saldo recargado
-- =========================================================
-- Lógica:
--   Si alumno tiene saldo > 0 Y tiene compras kiosco pendientes
--   → Se descuenta la deuda del saldo (de la más antigua a la más nueva)
--   → Solo se salda lo que el saldo alcance a cubrir
-- =========================================================


-- ══════════════════════════════════════════════════════════
-- PASO 1: VER QUÉ SE VA A CORREGIR (solo lectura, sin cambios)
-- ══════════════════════════════════════════════════════════
WITH deudas_por_alumno AS (
  SELECT
    s.id                        AS student_id,
    s.full_name                 AS alumno,
    sch.name                    AS colegio,
    s.balance                   AS saldo_actual,
    COUNT(t.id)                 AS num_deudas,
    SUM(ABS(t.amount))          AS total_deuda,
    -- ¿El saldo cubre todas las deudas?
    CASE
      WHEN s.balance >= SUM(ABS(t.amount)) THEN '✅ Saldo cubre todo'
      WHEN s.balance > 0                   THEN '⚠️  Cubre parcialmente'
      ELSE                                      '❌ Sin saldo'
    END AS cobertura,
    s.balance - SUM(ABS(t.amount)) AS saldo_despues_de_fix
  FROM transactions t
  INNER JOIN students s   ON t.student_id = s.id
  LEFT  JOIN schools  sch ON s.school_id  = sch.id
  WHERE t.type           = 'purchase'
    AND t.payment_status = 'pending'
    AND t.student_id     IS NOT NULL
    AND s.balance        > 0
    -- Solo kiosco (excluir almuerzos)
    AND NOT (t.metadata::jsonb ? 'lunch_order_id')
  GROUP BY s.id, s.full_name, s.balance, sch.name
)
SELECT * FROM deudas_por_alumno
ORDER BY cobertura, alumno;


-- ══════════════════════════════════════════════════════════
-- PASO 2: DETALLE de cada transacción a saldar
-- ══════════════════════════════════════════════════════════
SELECT
  s.full_name          AS alumno,
  sch.name             AS colegio,
  s.balance            AS saldo_actual,
  t.ticket_code        AS ticket,
  ABS(t.amount)        AS deuda_soles,
  t.created_at         AS fecha_compra,
  t.description        AS descripcion
FROM transactions t
INNER JOIN students s   ON t.student_id = s.id
LEFT  JOIN schools  sch ON s.school_id  = sch.id
WHERE t.type           = 'purchase'
  AND t.payment_status = 'pending'
  AND t.student_id     IS NOT NULL
  AND s.balance        > 0
  AND NOT (t.metadata::jsonb ? 'lunch_order_id')
ORDER BY s.full_name, t.created_at;


-- ══════════════════════════════════════════════════════════
-- PASO 3: APLICAR EL FIX
-- (Ejecutar SOLO después de revisar los PASOS 1 y 2)
-- ══════════════════════════════════════════════════════════

-- 3A: Identificar las transacciones que se pueden saldar
--     (en orden cronológico, respetando el límite del saldo)
WITH deudas_ordenadas AS (
  SELECT
    t.id                    AS transaction_id,
    t.student_id,
    t.ticket_code,
    ABS(t.amount)           AS deuda,
    t.created_at,
    s.balance               AS saldo_disponible,
    -- Suma acumulada de deudas por alumno (de la más antigua a la más nueva)
    SUM(ABS(t.amount)) OVER (
      PARTITION BY t.student_id
      ORDER BY t.created_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS deuda_acumulada
  FROM transactions t
  INNER JOIN students s ON t.student_id = s.id
  WHERE t.type           = 'purchase'
    AND t.payment_status = 'pending'
    AND t.student_id     IS NOT NULL
    AND s.balance        > 0
    AND NOT (t.metadata::jsonb ? 'lunch_order_id')
),
transacciones_a_saldar AS (
  SELECT transaction_id, student_id, ticket_code, deuda
  FROM deudas_ordenadas
  WHERE deuda_acumulada <= saldo_disponible  -- Solo las que caben en el saldo
)
-- 3B: Marcar esas transacciones como PAGADAS
UPDATE transactions
SET
  payment_status = 'paid',
  payment_method = 'saldo',
  description    = CONCAT(description, ' [Saldado con recarga]')
WHERE id IN (SELECT transaction_id FROM transacciones_a_saldar);


-- 3C: Descontar el monto saldado del balance de cada alumno
WITH montos_saldados AS (
  SELECT
    t.student_id,
    SUM(ABS(t.amount)) AS total_saldado
  FROM transactions t
  WHERE t.type           = 'purchase'
    AND t.payment_status = 'paid'
    AND t.payment_method = 'saldo'
    AND t.description    LIKE '%[Saldado con recarga]%'
  GROUP BY t.student_id
)
UPDATE students s
SET balance = s.balance - ms.total_saldado
FROM montos_saldados ms
WHERE s.id = ms.student_id;


-- ══════════════════════════════════════════════════════════
-- PASO 4: VERIFICAR que todo quedó correcto
-- ══════════════════════════════════════════════════════════
SELECT
  s.full_name                     AS alumno,
  sch.name                        AS colegio,
  s.balance                       AS saldo_final,
  s.free_account                  AS cuenta_libre,
  COUNT(t.id)                     AS deudas_aun_pendientes,
  COALESCE(SUM(ABS(t.amount)), 0) AS monto_pendiente_restante
FROM students s
LEFT JOIN schools      sch ON s.school_id  = sch.id
LEFT JOIN transactions t   ON t.student_id = s.id
                           AND t.type           = 'purchase'
                           AND t.payment_status = 'pending'
                           AND NOT (t.metadata::jsonb ? 'lunch_order_id')
WHERE s.id IN (
  -- Solo los alumnos que modificamos
  SELECT DISTINCT student_id FROM transactions
  WHERE description LIKE '%[Saldado con recarga]%'
)
GROUP BY s.id, s.full_name, s.balance, s.free_account, sch.name
ORDER BY s.full_name;
