-- ============================================================
-- DIAGNÓSTICO: OTROS MEDIOS DE PAGO — SEDE NORDIC
-- Yape, Tarjeta, Transferencia, Mixtos
-- ============================================================
-- A diferencia del efectivo, Yape/Transferencia/Tarjeta son
-- pagos EXTERNOS al cajero (van a la cuenta del colegio).
-- Si se cancelaron → ¿se devolvió el dinero? ¿a quién?
-- ============================================================


-- ============================================================
-- PASO 1: RESUMEN — Todas las ventas por método de pago
-- Ver el total recibido vs total anulado por método
-- ============================================================
SELECT
  UPPER(COALESCE(t.payment_method, 'saldo/null'))   AS metodo_pago,
  COUNT(*) FILTER (WHERE t.payment_status != 'cancelled')  AS ventas_validas,
  SUM(ABS(t.amount)) FILTER (WHERE t.payment_status != 'cancelled') AS monto_recibido,
  COUNT(*) FILTER (WHERE t.payment_status = 'cancelled')   AS ventas_anuladas,
  SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'cancelled')  AS monto_anulado,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.payment_status = 'cancelled')
    / NULLIF(COUNT(*), 0), 1
  )                                                  AS pct_anulacion
FROM transactions t
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
GROUP BY t.payment_method
ORDER BY monto_recibido DESC NULLS LAST;


-- ============================================================
-- PASO 2: YAPE — Transacciones anuladas (dinero real recibido)
-- Estas son las más importantes: alguien pagó con Yape y
-- luego se anuló la venta. ¿Se devolvió el Yape?
-- ============================================================
SELECT
  '⚠️ YAPE CANCELADO — ¿Se devolvió el dinero?' AS alerta,
  DATE(t.created_at AT TIME ZONE 'America/Lima')   AS fecha_venta,
  t.ticket_code,
  LEFT(t.description, 60)                          AS descripcion,
  ABS(t.amount)                                    AS monto_yape,
  CASE 
    WHEN t.student_id IS NOT NULL THEN COALESCE(st.full_name, '(alumno)')
    WHEN t.teacher_id IS NOT NULL THEN COALESCE(tp.full_name, '(profesor)')
    ELSE 'Cliente genérico'
  END                                              AS cliente,
  COALESCE(p.full_name, p.email)                  AS cajero_que_cobró,
  t.metadata->>'cancelled_at'                     AS fecha_anulacion,
  t.metadata->>'cancellation_reason'              AS motivo_anulacion,
  -- ¿Existe transacción de refund vinculada?
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM transactions r
      WHERE r.type = 'refund'
        AND (r.metadata->>'original_transaction_id' = t.id::text
             OR r.metadata->>'lunch_order_id' = (t.metadata->>'lunch_order_id'))
    ) THEN '✅ Sí hay refund registrado'
    ELSE '❌ NO hay refund — dinero sin devolver?'
  END                                              AS estado_devolucion
FROM transactions t
LEFT JOIN students st         ON t.student_id  = st.id
LEFT JOIN teacher_profiles tp ON t.teacher_id  = tp.id
LEFT JOIN profiles p          ON t.created_by  = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND t.payment_method IN ('yape', 'yape_qr')
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
ORDER BY t.created_at DESC;


-- ============================================================
-- PASO 3: TRANSFERENCIA — Transacciones anuladas
-- ============================================================
SELECT
  '⚠️ TRANSFERENCIA CANCELADA — ¿Se devolvió el dinero?' AS alerta,
  DATE(t.created_at AT TIME ZONE 'America/Lima')          AS fecha_venta,
  t.ticket_code,
  LEFT(t.description, 60)                                 AS descripcion,
  ABS(t.amount)                                           AS monto_transferencia,
  CASE 
    WHEN t.student_id IS NOT NULL THEN COALESCE(st.full_name, '(alumno)')
    WHEN t.teacher_id IS NOT NULL THEN COALESCE(tp.full_name, '(profesor)')
    ELSE 'Cliente genérico'
  END                                                     AS cliente,
  COALESCE(p.full_name, p.email)                         AS cajero_que_cobró,
  t.metadata->>'cancelled_at'                            AS fecha_anulacion,
  t.metadata->>'cancellation_reason'                     AS motivo_anulacion
FROM transactions t
LEFT JOIN students st         ON t.student_id  = st.id
LEFT JOIN teacher_profiles tp ON t.teacher_id  = tp.id
LEFT JOIN profiles p          ON t.created_by  = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND t.payment_method IN ('transferencia', 'transfer', 'banco')
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
ORDER BY t.created_at DESC;


-- ============================================================
-- PASO 4: TARJETA — Transacciones anuladas
-- ============================================================
SELECT
  '⚠️ TARJETA CANCELADA' AS alerta,
  DATE(t.created_at AT TIME ZONE 'America/Lima')  AS fecha_venta,
  t.ticket_code,
  LEFT(t.description, 60)                         AS descripcion,
  ABS(t.amount)                                   AS monto_tarjeta,
  CASE 
    WHEN t.student_id IS NOT NULL THEN COALESCE(st.full_name, '(alumno)')
    WHEN t.teacher_id IS NOT NULL THEN COALESCE(tp.full_name, '(profesor)')
    ELSE 'Cliente genérico'
  END                                             AS cliente,
  COALESCE(p.full_name, p.email)                 AS cajero_que_cobró,
  t.metadata->>'cancelled_at'                    AS fecha_anulacion,
  t.metadata->>'cancellation_reason'             AS motivo_anulacion
FROM transactions t
LEFT JOIN students st         ON t.student_id  = st.id
LEFT JOIN teacher_profiles tp ON t.teacher_id  = tp.id
LEFT JOIN profiles p          ON t.created_by  = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND t.payment_method IN ('tarjeta', 'card', 'visa', 'mastercard')
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
ORDER BY t.created_at DESC;


-- ============================================================
-- PASO 5: PAGOS MIXTOS ANULADOS
-- (parte efectivo + parte Yape/tarjeta)
-- ============================================================
SELECT
  '⚠️ PAGO MIXTO CANCELADO' AS alerta,
  DATE(t.created_at AT TIME ZONE 'America/Lima')  AS fecha_venta,
  t.ticket_code,
  ABS(t.amount)                                   AS monto_total,
  t.cash_amount                                   AS parte_efectivo,
  t.card_amount                                   AS parte_tarjeta,
  t.yape_amount                                   AS parte_yape,
  CASE 
    WHEN t.student_id IS NOT NULL THEN COALESCE(st.full_name, '(alumno)')
    ELSE 'Cliente genérico'
  END                                             AS cliente,
  COALESCE(p.full_name, p.email)                 AS cajero,
  t.metadata->>'cancellation_reason'             AS motivo
FROM transactions t
LEFT JOIN students st ON t.student_id = st.id
LEFT JOIN profiles p  ON t.created_by = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND t.paid_with_mixed = true
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
ORDER BY t.created_at DESC;


-- ============================================================
-- PASO 6: PATRÓN SOSPECHOSO — Ventas en Yape/Transferencia
-- donde el MONTO es inusualmente alto o el cajero anula mucho
-- ============================================================
SELECT
  UPPER(COALESCE(t.payment_method, 'null'))       AS metodo,
  COALESCE(p.full_name, p.email, 'desconocido')  AS cajero,
  COUNT(*)                                        AS ventas_totales,
  COUNT(*) FILTER (WHERE t.payment_status = 'cancelled') AS anulaciones,
  SUM(ABS(t.amount)) FILTER (WHERE t.payment_status != 'cancelled') AS cobrado_valido,
  SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'cancelled')  AS anulado,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.payment_status = 'cancelled')
    / NULLIF(COUNT(*), 0), 1
  )                                               AS pct_anulacion,
  CASE
    WHEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE t.payment_status = 'cancelled')
      / NULLIF(COUNT(*), 0), 1
    ) > 30 THEN '🚨 ALTA TASA DE ANULACIÓN'
    WHEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE t.payment_status = 'cancelled')
      / NULLIF(COUNT(*), 0), 1
    ) > 10 THEN '⚠️ Tasa elevada'
    ELSE '✅ Normal'
  END                                             AS alerta
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_method IN ('yape', 'yape_qr', 'tarjeta', 'card', 'transferencia', 'efectivo')
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
GROUP BY t.payment_method, p.full_name, p.email
HAVING COUNT(*) >= 2
ORDER BY pct_anulacion DESC, anulado DESC;


-- ============================================================
-- PASO 7: VENTAS EN EFECTIVO — Ver si hay alguna anulada
-- (confirmación de que el efectivo está limpio)
-- ============================================================
SELECT
  COALESCE(
    (SELECT COUNT(*)::text FROM transactions
     WHERE school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
       AND type = 'purchase'
       AND payment_status = 'cancelled'
       AND payment_method = 'efectivo'
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
       AND (is_deleted = false OR is_deleted IS NULL)
    ), '0'
  ) AS ventas_efectivo_anuladas,
  COALESCE(
    (SELECT SUM(ABS(amount))::text FROM transactions
     WHERE school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
       AND type = 'purchase'
       AND payment_status = 'cancelled'
       AND payment_method = 'efectivo'
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
       AND (is_deleted = false OR is_deleted IS NULL)
    ), '0'
  ) AS monto_efectivo_anulado,
  CASE
    WHEN (SELECT COUNT(*) FROM transactions
     WHERE school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
       AND type = 'purchase'
       AND payment_status = 'cancelled'
       AND payment_method = 'efectivo'
       AND (paid_with_mixed = false OR paid_with_mixed IS NULL)
       AND (is_deleted = false OR is_deleted IS NULL)
    ) = 0
    THEN '✅ Sin ventas en efectivo anuladas — caja limpia'
    ELSE '⚠️ Hay ventas en efectivo anuladas — revisar'
  END AS conclusion;
