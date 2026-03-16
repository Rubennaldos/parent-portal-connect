-- ============================================================
-- AUDITORÍA FORENSE DE RECARGAS vs ALMUERZOS
-- Fecha: 2026-03-15
-- Propósito: Determinar exactamente cuánto dinero de recargas
--            fue "absorbido" ilegalmente por transacciones de almuerzo
-- SOLO LECTURA — no modifica ningún dato
-- ============================================================


-- ============================================================
-- REPORTE 1: TOTAL DE RECARGAS (El dinero que entró)
-- Todas las recargas aprobadas por alumno, desde el inicio
-- ============================================================

SELECT
  s.full_name                          AS alumno,
  sc.name                              AS sede,
  COUNT(t.id)                          AS cantidad_recargas,
  SUM(t.amount)                        AS total_recargado,
  MIN(t.created_at)::date              AS primera_recarga,
  MAX(t.created_at)::date              AS ultima_recarga
FROM transactions t
JOIN students s  ON s.id = t.student_id
JOIN schools  sc ON sc.id = t.school_id
WHERE t.type = 'recharge'
  AND t.is_deleted = false
  AND t.payment_status != 'cancelled'
GROUP BY s.id, s.full_name, sc.name
ORDER BY total_recargado DESC;


-- ============================================================
-- REPORTE 2: CONSUMO REAL DE KIOSCO (Lo legal)
-- Solo compras en POS/kiosco — excluye estrictamente almuerzos
-- ============================================================

SELECT
  s.full_name                          AS alumno,
  sc.name                              AS sede,
  COUNT(t.id)                          AS cantidad_compras_kiosco,
  SUM(ABS(t.amount))                   AS total_consumido_kiosco,
  MIN(t.created_at)::date              AS primera_compra,
  MAX(t.created_at)::date              AS ultima_compra
FROM transactions t
JOIN students s  ON s.id = t.student_id
JOIN schools  sc ON sc.id = t.school_id
WHERE t.type IN ('purchase', 'charge')
  AND t.is_deleted = false
  AND t.payment_status != 'cancelled'
  -- EXCLUSIÓN ESTRICTA: ningún almuerzo, ningún lunch_order_id
  AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
GROUP BY s.id, s.full_name, sc.name
ORDER BY total_consumido_kiosco DESC;


-- ============================================================
-- REPORTE 3: EL AGUJERO NEGRO (Almuerzos que chuparon saldo)
-- Transacciones de almuerzo que tienen lunch_order_id
-- y que afectaron el balance del alumno ilegalmente
-- ============================================================

SELECT
  s.full_name                              AS alumno,
  sc.name                                  AS sede,
  t.id                                     AS transaction_id,
  t.ticket_code,
  t.amount                                 AS monto_deducido,
  t.payment_status,
  t.metadata->>'lunch_order_id'            AS lunch_order_id,
  t.description,
  t.created_at::date                       AS fecha,
  lo.order_date,
  lo.status                                AS estado_pedido,
  lc.name                                  AS categoria_almuerzo
FROM transactions t
JOIN students s     ON s.id = t.student_id
JOIN schools  sc    ON sc.id = t.school_id
LEFT JOIN lunch_orders lo
  ON lo.id = (t.metadata->>'lunch_order_id')::uuid
LEFT JOIN lunch_categories lc
  ON lc.id = lo.category_id
WHERE t.type IN ('purchase', 'charge')
  AND t.is_deleted = false
  AND t.metadata IS NOT NULL
  AND (t.metadata->>'lunch_order_id') IS NOT NULL
ORDER BY s.full_name, t.created_at;


-- ============================================================
-- REPORTE 4: EL CUADRO DE LA VERDAD (Balance Reconstruido)
-- Por cada alumno afectado muestra:
--   A = Total recargado
--   B = Consumo real kiosco
--   A-B = Saldo que debería tener
--   Actual = Saldo que tiene en sistema
--   Diferencia = Plata "robada" por almuerzos
-- ============================================================

WITH recargas AS (
  SELECT
    t.student_id,
    COALESCE(SUM(t.amount), 0) AS total_recargado
  FROM transactions t
  WHERE t.type = 'recharge'
    AND t.is_deleted = false
    AND t.payment_status != 'cancelled'
  GROUP BY t.student_id
),
kiosco AS (
  SELECT
    t.student_id,
    COALESCE(SUM(t.amount), 0) AS total_consumido_kiosco
  FROM transactions t
  WHERE t.type IN ('purchase', 'charge')
    AND t.is_deleted = false
    AND t.payment_status != 'cancelled'
    AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
  GROUP BY t.student_id
),
agujero AS (
  SELECT
    t.student_id,
    COALESCE(SUM(t.amount), 0) AS total_absorbido_almuerzos,
    COUNT(t.id)                AS num_transacciones_almuerzo
  FROM transactions t
  WHERE t.type IN ('purchase', 'charge')
    AND t.is_deleted = false
    AND t.metadata IS NOT NULL
    AND (t.metadata->>'lunch_order_id') IS NOT NULL
  GROUP BY t.student_id
)
SELECT
  s.full_name                                                AS alumno,
  sc.name                                                    AS sede,
  COALESCE(r.total_recargado,           0)                   AS "A_total_recargado",
  COALESCE(ABS(k.total_consumido_kiosco), 0)                 AS "B_consumo_real_kiosco",
  COALESCE(r.total_recargado, 0)
    + COALESCE(k.total_consumido_kiosco, 0)                  AS "C_saldo_que_deberia_tener",
  s.balance                                                  AS "D_saldo_actual_sistema",
  ROUND(
    (COALESCE(r.total_recargado, 0)
     + COALESCE(k.total_consumido_kiosco, 0))
    - s.balance
  , 2)                                                       AS "E_diferencia_a_investigar",
  COALESCE(ABS(ag.total_absorbido_almuerzos), 0)             AS "F_monto_absorbido_por_almuerzos",
  COALESCE(ag.num_transacciones_almuerzo, 0)                 AS "G_num_tx_almuerzo_ilegales",
  s.free_account                                             AS cuenta_libre,
  s.kiosk_disabled                                           AS kiosco_desactivado
FROM students s
JOIN schools sc ON sc.id = s.school_id
LEFT JOIN recargas r  ON r.student_id = s.id
LEFT JOIN kiosco   k  ON k.student_id = s.id
LEFT JOIN agujero  ag ON ag.student_id = s.id
WHERE s.is_active = true
  AND (
    -- Solo mostrar alumnos donde hay diferencia o hubo absorción de almuerzos
    ABS(
      (COALESCE(r.total_recargado, 0) + COALESCE(k.total_consumido_kiosco, 0))
      - s.balance
    ) > 0.01
    OR COALESCE(ag.num_transacciones_almuerzo, 0) > 0
  )
ORDER BY "E_diferencia_a_investigar" DESC, s.full_name;
