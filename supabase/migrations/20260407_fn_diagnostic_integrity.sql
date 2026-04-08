-- ============================================================
-- FUNCIÓN DE DIAGNÓSTICO: fn_diagnostic_integrity()
-- Compara ventas vs pagos y reporta 5 tipos de discrepancias.
--
-- USO:
--   SELECT * FROM fn_diagnostic_integrity();          -- todos los colegios
--   SELECT * FROM fn_diagnostic_integrity('uuid-sede');  -- solo una sede
--
-- RETORNA una fila por cada problema encontrado con:
--   tipo        → categoría del problema
--   severidad   → 'CRITICO' | 'ADVERTENCIA' | 'INFO'
--   student_id  → alumno afectado (si aplica)
--   detalle     → descripción legible del problema
--   monto       → monto involucrado (si aplica)
--   referencia  → ID del registro problemático
-- ============================================================

DROP FUNCTION IF EXISTS fn_diagnostic_integrity(uuid);
DROP FUNCTION IF EXISTS fn_diagnostic_integrity();

CREATE OR REPLACE FUNCTION fn_diagnostic_integrity(
  p_school_id uuid DEFAULT NULL
)
RETURNS TABLE(
  tipo        text,
  severidad   text,
  student_id  uuid,
  detalle     text,
  monto       numeric,
  referencia  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

-- ══════════════════════════════════════════════════════════════
-- PROBLEMA #1 — SALDO FANTASMA
-- El saldo del alumno no coincide con la suma de sus transacciones.
-- Causa típica: se modificó balance directamente en lugar de usar
-- la función adjust_student_balance (viola Regla #9).
-- ══════════════════════════════════════════════════════════════
RETURN QUERY
WITH tx_balance AS (
  SELECT
    t.student_id,
    SUM(
      CASE
        WHEN t.type = 'recharge' AND t.payment_status = 'paid'   THEN  ABS(t.amount)
        WHEN t.type = 'purchase' AND t.payment_status = 'paid'   THEN -ABS(t.amount)
        WHEN t.type = 'purchase' AND t.payment_status = 'partial'THEN -ABS(t.amount)
        ELSE 0
      END
    ) AS balance_calculado
  FROM transactions t
  WHERE t.is_deleted = false
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
  GROUP BY t.student_id
)
SELECT
  'SALDO_FANTASMA'::text                                      AS tipo,
  'CRITICO'::text                                             AS severidad,
  s.id                                                        AS student_id,
  format(
    'Alumno %s: saldo en BD = S/ %s | saldo por transacciones = S/ %s | diferencia = S/ %s',
    s.full_name,
    ROUND(s.balance, 2)::text,
    ROUND(tb.balance_calculado, 2)::text,
    ROUND(ABS(s.balance - tb.balance_calculado), 2)::text
  )                                                           AS detalle,
  ROUND(ABS(s.balance - tb.balance_calculado), 2)            AS monto,
  s.id::text                                                  AS referencia
FROM students s
JOIN tx_balance tb ON tb.student_id = s.id
WHERE s.is_active = true
  AND ABS(s.balance - tb.balance_calculado) > 0.01  -- tolerancia de 1 centavo
  AND (p_school_id IS NULL OR s.school_id = p_school_id);


-- ══════════════════════════════════════════════════════════════
-- PROBLEMA #2 — PAGO APROBADO SIN EFECTO EN TRANSACCIÓN
-- Existe un recharge_request aprobado (lunch_payment / debt_payment)
-- pero las transacciones vinculadas siguen en 'pending'.
-- Causa típica: fallo a mitad del proceso de aprobación de voucher.
-- ══════════════════════════════════════════════════════════════
RETURN QUERY
SELECT
  'VOUCHER_SIN_EFECTO'::text                                  AS tipo,
  'CRITICO'::text                                             AS severidad,
  rr.student_id                                               AS student_id,
  format(
    'Voucher %s aprobado el %s pero transacción %s sigue en payment_status = ''%s''',
    rr.id::text,
    to_char(rr.approved_at, 'DD/MM/YYYY HH24:MI'),
    t.id::text,
    t.payment_status
  )                                                           AS detalle,
  ABS(t.amount)                                               AS monto,
  rr.id::text                                                 AS referencia
FROM recharge_requests rr
JOIN LATERAL unnest(rr.paid_transaction_ids) AS pid(tx_id) ON true
JOIN transactions t ON t.id = pid.tx_id
WHERE rr.status        = 'approved'
  AND rr.request_type IN ('lunch_payment', 'debt_payment')
  AND t.payment_status NOT IN ('paid', 'cancelled')
  AND t.is_deleted     = false
  AND (p_school_id IS NULL OR rr.school_id = p_school_id);


-- ══════════════════════════════════════════════════════════════
-- PROBLEMA #3 — DOBLE COBRO (TRANSACCIÓN DUPLICADA)
-- Dos o más transacciones del mismo alumno con el mismo monto,
-- descripción y fecha cercana (≤ 5 minutos entre sí).
-- Causa típica: doble clic en el POS o error de red con retry.
-- ══════════════════════════════════════════════════════════════
RETURN QUERY
SELECT
  'DOBLE_COBRO'::text                                         AS tipo,
  'ADVERTENCIA'::text                                         AS severidad,
  t1.student_id                                               AS student_id,
  format(
    'Posible duplicado: "%s" S/ %s cobrado %s veces en ≤5 min (IDs: %s ... %s)',
    t1.description,
    ROUND(ABS(t1.amount), 2)::text,
    COUNT(t2.id)::text,
    MIN(t2.id)::text,
    MAX(t2.id)::text
  )                                                           AS detalle,
  ROUND(ABS(t1.amount) * (COUNT(t2.id) - 1), 2)              AS monto,
  t1.id::text                                                 AS referencia
FROM transactions t1
JOIN transactions t2
  ON  t2.student_id   = t1.student_id
  AND t2.id           <> t1.id
  AND t2.amount        = t1.amount
  AND t2.description   = t1.description
  AND t2.type          = 'purchase'
  AND t2.is_deleted    = false
  AND ABS(EXTRACT(EPOCH FROM (t2.created_at - t1.created_at))) <= 300  -- 5 minutos
WHERE t1.type         = 'purchase'
  AND t1.is_deleted   = false
  AND t1.payment_status NOT IN ('cancelled')
  AND (p_school_id IS NULL OR t1.school_id = p_school_id)
GROUP BY t1.id, t1.student_id, t1.description, t1.amount
HAVING COUNT(t2.id) >= 1;


-- ══════════════════════════════════════════════════════════════
-- PROBLEMA #4 — ALMUERZO HUÉRFANO
-- Existe una transacción de tipo almuerzo (con lunch_order_id en
-- metadata) pero el lunch_order ya no existe o fue cancelado.
-- Causa típica: se borró o canceló el pedido después del cobro.
-- ══════════════════════════════════════════════════════════════
RETURN QUERY
SELECT
  'ALMUERZO_HUERFANO'::text                                   AS tipo,
  'ADVERTENCIA'::text                                         AS severidad,
  t.student_id                                                AS student_id,
  format(
    'Transacción %s referencia lunch_order_id = %s que %s',
    t.id::text,
    t.metadata->>'lunch_order_id',
    CASE
      WHEN lo.id IS NULL      THEN 'NO EXISTE en lunch_orders'
      WHEN lo.is_cancelled    THEN 'fue CANCELADO'
      WHEN lo.status = 'cancelled' THEN 'tiene status = cancelled'
      ELSE 'tiene un estado inconsistente'
    END
  )                                                           AS detalle,
  ABS(t.amount)                                               AS monto,
  t.id::text                                                  AS referencia
FROM transactions t
LEFT JOIN lunch_orders lo
  ON lo.id = (t.metadata->>'lunch_order_id')::uuid
WHERE t.type          = 'purchase'
  AND t.is_deleted    = false
  AND t.payment_status NOT IN ('cancelled')
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
  AND (
    lo.id IS NULL
    OR lo.is_cancelled = true
    OR lo.status = 'cancelled'
  )
  AND (p_school_id IS NULL OR t.school_id = p_school_id);


-- ══════════════════════════════════════════════════════════════
-- PROBLEMA #5 — DEUDA ANTIGUA SIN MOVIMIENTO (> 60 días)
-- Transacciones en estado 'pending' con más de 60 días de antigüedad.
-- No necesariamente un bug, pero merece revisión manual.
-- ══════════════════════════════════════════════════════════════
RETURN QUERY
SELECT
  'DEUDA_ANTIGUA'::text                                       AS tipo,
  'INFO'::text                                                AS severidad,
  t.student_id                                                AS student_id,
  format(
    'Deuda de S/ %s ("%s") lleva %s días pendiente desde %s',
    ROUND(ABS(t.amount), 2)::text,
    LEFT(t.description, 60),
    EXTRACT(DAY FROM NOW() - t.created_at)::int::text,
    to_char(t.created_at, 'DD/MM/YYYY')
  )                                                           AS detalle,
  ROUND(ABS(t.amount), 2)                                     AS monto,
  t.id::text                                                  AS referencia
FROM transactions t
WHERE t.type          = 'purchase'
  AND t.is_deleted    = false
  AND t.payment_status IN ('pending', 'partial')
  AND t.created_at    < NOW() - INTERVAL '60 days'
  AND (p_school_id IS NULL OR t.school_id = p_school_id)
ORDER BY t.created_at ASC;

END;
$$;


-- ============================================================
-- VISTA DE RESUMEN EJECUTIVO
-- Agrupa los problemas por tipo y severidad para un vistazo rápido.
-- Uso: SELECT * FROM view_integrity_summary;
-- ============================================================

CREATE OR REPLACE VIEW view_integrity_summary AS
SELECT
  tipo,
  severidad,
  COUNT(*)                      AS total_problemas,
  ROUND(SUM(monto), 2)          AS monto_total_afectado,
  COUNT(DISTINCT student_id)    AS alumnos_afectados
FROM fn_diagnostic_integrity()
GROUP BY tipo, severidad
ORDER BY
  CASE severidad
    WHEN 'CRITICO'      THEN 1
    WHEN 'ADVERTENCIA'  THEN 2
    WHEN 'INFO'         THEN 3
  END,
  total_problemas DESC;
