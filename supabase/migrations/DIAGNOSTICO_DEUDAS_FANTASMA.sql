-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: DEUDAS FANTASMA
-- Fecha: 2026-04-08
--
-- ¿Qué busca?
--   Un alumno tiene "deuda fantasma" cuando el portal del padre le muestra
--   tickets POS con payment_status = 'pending', pero el balance del alumno
--   en students.balance ya fue restaurado (≥ 0) o el monto pendiente supera
--   al saldo negativo real.
--
--   Esto ocurre cuando:
--     a) El admin aprobó una recarga de saldo (adjust_student_balance subió
--        el balance a 0), PERO los tickets individuales no se marcaron 'paid'.
--     b) El pago se procesó por un camino diferente al RPC (ej. ajuste manual).
--
-- ¿Cómo usar?
--   1. Ejecuta el BLOQUE 1 para ver el resumen de todos los afectados.
--   2. Usa el BLOQUE 2 con el student_id específico para ver los tickets exactos.
--   3. Usa el BLOQUE 3 para el UPDATE de corrección (SOLO después de confirmar).
-- ═══════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════
-- BLOQUE 1: RESUMEN DE DEUDAS FANTASMA (ejecutar primero)
-- ════════════════════════════════════════════════════════

WITH tickets_pendientes_pos AS (
  -- Suma de tickets POS pendientes por alumno (excluye almuerzos por lunch_order_id)
  SELECT
    t.student_id,
    COUNT(t.id)                  AS cant_tickets,
    SUM(ABS(t.amount))::numeric  AS monto_pendiente
  FROM   transactions t
  WHERE  t.type           = 'purchase'
    AND  t.payment_status IN ('pending', 'partial')
    AND  t.is_deleted     = false
    AND  (t.metadata->>'lunch_order_id') IS NULL  -- Solo kiosco/POS
  GROUP BY t.student_id
),

vouchers_aprobados AS (
  -- Último voucher de deuda aprobado por alumno (para confirmar que sí pagó)
  SELECT DISTINCT ON (rr.student_id)
    rr.student_id,
    rr.amount        AS monto_voucher,
    rr.status        AS estado_voucher,
    rr.approved_at,
    rr.request_type
  FROM   recharge_requests rr
  WHERE  rr.status       = 'approved'
    AND  rr.request_type IN ('debt_payment', 'recharge')
  ORDER BY rr.student_id, rr.approved_at DESC
)

SELECT
  -- Identificación
  s.full_name                                           AS alumno,
  sc.name                                               AS sede,

  -- Lo que ve el padre en pantalla (suma de tickets kiosco 'pending')
  COALESCE(tp.monto_pendiente, 0)                       AS deuda_en_pantalla,

  -- La deuda real (balance negativo del kiosco)
  CASE WHEN s.balance < 0 THEN ABS(s.balance) ELSE 0 END AS deuda_real_kiosco,

  -- El monto que está "flotando" de más (fantasma)
  GREATEST(0,
    COALESCE(tp.monto_pendiente, 0)
    - CASE WHEN s.balance < 0 THEN ABS(s.balance) ELSE 0 END
  )                                                     AS monto_desfasado,

  -- Cuántos tickets están atascados
  COALESCE(tp.cant_tickets, 0)                          AS tickets_atascados,

  -- Balance actual del alumno
  s.balance                                             AS balance_actual,

  -- Tipo de cuenta
  CASE s.free_account
    WHEN true  THEN 'Cuenta libre (sin recarga)'
    WHEN false THEN 'Con recarga (billetera)'
    ELSE            'Sin definir'
  END                                                   AS tipo_cuenta,

  -- ¿Tiene voucher aprobado reciente? (evidencia de que sí pagó)
  CASE WHEN va.student_id IS NOT NULL
    THEN 'SÍ — S/ ' || va.monto_voucher::text || ' aprobado el ' ||
         to_char(va.approved_at AT TIME ZONE 'America/Lima', 'DD/MM/YYYY')
    ELSE 'No encontrado'
  END                                                   AS tiene_voucher_aprobado,

  -- IDs para el bloque de corrección
  s.id                                                  AS student_id

FROM   students s
JOIN   schools  sc ON sc.id = s.school_id
LEFT   JOIN tickets_pendientes_pos tp ON tp.student_id = s.id
LEFT   JOIN vouchers_aprobados     va ON va.student_id = s.id

WHERE  s.is_active = true
  AND  COALESCE(tp.monto_pendiente, 0) > 0  -- Solo alumnos con tickets pendientes kiosco
  AND  (
    -- Caso A: Tiene tickets pendientes PERO balance ya es >= 0
    -- (el padre pagó y el balance se restauró, pero los tickets no se limpiaron)
    s.balance >= 0

    OR

    -- Caso B: Los tickets pendientes superan el balance negativo real (desfase > S/ 0.50)
    COALESCE(tp.monto_pendiente, 0)
      > (CASE WHEN s.balance < 0 THEN ABS(s.balance) ELSE 0 END) + 0.50
  )

ORDER BY
  sc.name,
  monto_desfasado DESC,
  s.full_name;


-- ════════════════════════════════════════════════════════════════════════
-- BLOQUE 2: VER LOS TICKETS EXACTOS DE UN ALUMNO ESPECÍFICO
-- Reemplaza 'STUDENT_UUID_AQUI' con el student_id del bloque anterior.
-- ════════════════════════════════════════════════════════════════════════

/*
SELECT
  t.id                                                  AS transaction_id,
  t.ticket_code,
  ABS(t.amount)                                         AS monto,
  t.payment_status,
  t.payment_method,
  t.description,
  to_char(t.created_at AT TIME ZONE 'America/Lima',
          'DD/MM/YYYY HH24:MI')                         AS fecha,
  t.metadata->>'recharge_request_id'                    AS voucher_vinculado,
  t.metadata->>'payment_approved'                       AS fue_aprobado
FROM   transactions t
WHERE  t.student_id     = 'STUDENT_UUID_AQUI'
  AND  t.type           = 'purchase'
  AND  t.payment_status IN ('pending', 'partial')
  AND  t.is_deleted     = false
  AND  (t.metadata->>'lunch_order_id') IS NULL
ORDER BY t.created_at ASC;
*/


-- ════════════════════════════════════════════════════════════════════════
-- BLOQUE 3: CORRECCIÓN ATÓMICA
-- ⚠️  EJECUTAR SOLO DESPUÉS DE REVISAR EL BLOQUE 1 Y CONFIRMAR CON BETO.
--
-- Marca como 'paid' todos los tickets POS pendientes de alumnos cuyo
-- balance ya es >= 0 (es decir, la deuda real ya fue saldada).
--
-- SAFETY: Solo toca alumnos donde balance >= 0 Y tienen tickets pending.
-- NO modifica students.balance (el balance ya está correcto).
-- ════════════════════════════════════════════════════════════════════════

/*
-- PASO 1: Ver exactamente qué se va a modificar (SELECT primero, siempre)
SELECT
  s.full_name,
  t.id              AS transaction_id,
  t.ticket_code,
  ABS(t.amount)     AS monto,
  t.payment_status,
  t.created_at::date AS fecha
FROM   transactions t
JOIN   students s ON s.id = t.student_id
WHERE  t.type           = 'purchase'
  AND  t.payment_status IN ('pending', 'partial')
  AND  t.is_deleted     = false
  AND  (t.metadata->>'lunch_order_id') IS NULL
  AND  s.is_active = true
  AND  s.balance >= 0   -- Solo alumnos sin deuda real activa
ORDER BY s.full_name, t.created_at;

-- PASO 2: Ejecutar la corrección (descomentar solo cuando estés listo)
-- UPDATE transactions t
-- SET
--   payment_status = 'paid',
--   metadata = COALESCE(metadata, '{}') || jsonb_build_object(
--     'payment_approved',  true,
--     'payment_source',    'manual_ghost_debt_fix',
--     'fix_date',          to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
--     'fix_reason',        'Deuda fantasma: balance ya fue restaurado, ticket no se limpio'
--   )
-- FROM students s
-- WHERE t.student_id      = s.id
--   AND t.type            = 'purchase'
--   AND t.payment_status  IN ('pending', 'partial')
--   AND t.is_deleted      = false
--   AND (t.metadata->>'lunch_order_id') IS NULL
--   AND s.is_active       = true
--   AND s.balance         >= 0;
--
-- Verificar cuántas filas se afectaron:
-- SELECT 'Filas actualizadas: ' || ROW_COUNT();
*/
