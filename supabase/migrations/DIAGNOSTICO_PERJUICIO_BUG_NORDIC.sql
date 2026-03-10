-- ============================================================
-- DIAGNÓSTICO: PERJUICIO ECONÓMICO POR BUG DE VENTAS ANULADAS
-- SEDE: NORDIC
-- ============================================================
-- El bug hacía que las transacciones con payment_status='cancelled'
-- siguieran contándose en el cierre de caja → generaba FALTANTE.
-- Esta query calcula cuánto dinero fue afectado y en qué días.
-- ============================================================


-- ============================================================
-- PASO 1: Confirmar ID de la sede Nordic
-- ============================================================
SELECT 
  id,
  name,
  code
FROM schools
WHERE name ILIKE '%nordic%'
   OR code ILIKE '%nordic%';


-- ============================================================
-- PASO 2: RESUMEN TOTAL DEL PERJUICIO POR EL BUG
-- Ventas anuladas (payment_status='cancelled') que SÍ se
-- contaron en los cierres de caja — organizadas por día
-- ============================================================
SELECT
  DATE(t.created_at AT TIME ZONE 'America/Lima')     AS fecha,
  COUNT(*)                                            AS ventas_anuladas,
  SUM(ABS(t.amount))                                 AS monto_total_afectado,
  SUM(CASE WHEN t.payment_method IN ('efectivo') 
       AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
       THEN ABS(t.amount) ELSE 0 END)                AS efectivo_anulado,
  SUM(CASE WHEN t.paid_with_mixed = true
       THEN ABS(COALESCE(t.cash_amount, 0)) ELSE 0 END) AS efectivo_mixto_anulado,
  SUM(CASE WHEN t.payment_method IN ('efectivo') 
       AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
       THEN ABS(t.amount) ELSE 0 END)
  + SUM(CASE WHEN t.paid_with_mixed = true
       THEN ABS(COALESCE(t.cash_amount, 0)) ELSE 0 END) AS total_efectivo_perdido_en_cierre,
  STRING_AGG(t.ticket_code, ', ' ORDER BY t.created_at) AS tickets_anulados
FROM transactions t
JOIN schools s ON t.school_id = s.id
WHERE s.name ILIKE '%nordic%'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
GROUP BY DATE(t.created_at AT TIME ZONE 'America/Lima')
ORDER BY fecha DESC;


-- ============================================================
-- PASO 3: DETALLE COMPLETO DE CADA VENTA ANULADA
-- Muestra qué vendió, quién anuló y cuánto era en efectivo
-- ============================================================
SELECT
  DATE(t.created_at AT TIME ZONE 'America/Lima')  AS fecha,
  t.ticket_code,
  t.description,
  ABS(t.amount)                                   AS monto,
  t.payment_method,
  t.paid_with_mixed,
  CASE 
    WHEN t.paid_with_mixed = true 
      THEN 'MIXTO (Efectivo: S/' || COALESCE(t.cash_amount::text, '0') 
           || ' + Tarjeta: S/' || COALESCE(t.card_amount::text, '0') 
           || ' + Yape: S/' || COALESCE(t.yape_amount::text, '0') || ')'
    ELSE UPPER(COALESCE(t.payment_method, 'desconocido'))
  END                                             AS metodo_pago_detalle,
  CASE
    WHEN t.payment_method = 'efectivo' 
         AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
      THEN ABS(t.amount)
    WHEN t.paid_with_mixed = true
      THEN ABS(COALESCE(t.cash_amount, 0))
    ELSE 0
  END                                             AS efectivo_que_causó_faltante,
  CASE 
    WHEN t.student_id IS NOT NULL 
      THEN COALESCE(st.full_name, '(alumno)')
    WHEN t.teacher_id IS NOT NULL
      THEN COALESCE(tp.full_name, '(profesor)')
    ELSE COALESCE(t.client_name, 'Cliente genérico')
  END                                             AS cliente,
  COALESCE(p.full_name, p.email, 'desconocido')  AS cajero_que_hizo_venta,
  (t.metadata->>'cancelled_at')                  AS fecha_anulacion,
  (t.metadata->>'cancellation_reason')           AS motivo_anulacion,
  (t.metadata->>'cancelled_from')                AS anulado_desde
FROM transactions t
JOIN schools s    ON t.school_id  = s.id
LEFT JOIN students st        ON t.student_id  = st.id
LEFT JOIN teacher_profiles tp ON t.teacher_id  = tp.id
LEFT JOIN profiles p          ON t.created_by  = p.id
WHERE s.name ILIKE '%nordic%'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
ORDER BY t.created_at DESC;


-- ============================================================
-- PASO 4: COMPARAR LOS CIERRES DE CAJA REGISTRADOS VS LO CORRECTO
-- Muestra la diferencia entre lo que el sistema mostró y lo real
-- ============================================================
SELECT
  cc.closure_date                                        AS fecha_cierre,
  cc.total_cash                                         AS efectivo_que_mostró_el_sistema,
  COALESCE(anuladas.efectivo_anulado_ese_dia, 0)       AS efectivo_de_ventas_anuladas,
  cc.total_cash - COALESCE(anuladas.efectivo_anulado_ese_dia, 0)
                                                        AS efectivo_real_correcto,
  cc.expected_final                                     AS caja_esperada_incorrecta,
  cc.expected_final - COALESCE(anuladas.efectivo_anulado_ese_dia, 0)
                                                        AS caja_esperada_correcta,
  cc.actual_final                                       AS caja_real_contada,
  cc.difference                                         AS diferencia_registrada,
  (cc.actual_final - (cc.expected_final - COALESCE(anuladas.efectivo_anulado_ese_dia, 0)))
                                                        AS diferencia_real_correcta,
  COALESCE(anuladas.efectivo_anulado_ese_dia, 0)       AS perjuicio_por_bug,
  CASE 
    WHEN COALESCE(anuladas.efectivo_anulado_ese_dia, 0) > 0 
    THEN '⚠️ Afectado por bug'
    ELSE '✅ Sin impacto'
  END                                                   AS estado
FROM cash_closures cc
JOIN schools s ON cc.school_id = s.id
LEFT JOIN (
  SELECT
    DATE(t.created_at AT TIME ZONE 'America/Lima') AS dia,
    SUM(
      CASE 
        WHEN t.payment_method = 'efectivo' 
             AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
          THEN ABS(t.amount)
        WHEN t.paid_with_mixed = true
          THEN ABS(COALESCE(t.cash_amount, 0))
        ELSE 0
      END
    ) AS efectivo_anulado_ese_dia
  FROM transactions t
  JOIN schools s2 ON t.school_id = s2.id
  WHERE s2.name ILIKE '%nordic%'
    AND t.type = 'purchase'
    AND t.payment_status = 'cancelled'
    AND (t.is_deleted = false OR t.is_deleted IS NULL)
  GROUP BY DATE(t.created_at AT TIME ZONE 'America/Lima')
) anuladas ON anuladas.dia = cc.closure_date
WHERE s.name ILIKE '%nordic%'
ORDER BY cc.closure_date DESC;


-- ============================================================
-- PASO 5: RESUMEN EJECUTIVO — 1 SOLA LÍNEA CON EL TOTAL
-- ============================================================
SELECT
  '🏫 Nordic' AS sede,
  COUNT(DISTINCT DATE(t.created_at AT TIME ZONE 'America/Lima')) AS dias_afectados,
  COUNT(*) AS total_ventas_anuladas_contadas,
  SUM(ABS(t.amount)) AS monto_total_anulado,
  SUM(
    CASE 
      WHEN t.payment_method = 'efectivo' 
           AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
        THEN ABS(t.amount)
      WHEN t.paid_with_mixed = true
        THEN ABS(COALESCE(t.cash_amount, 0))
      ELSE 0
    END
  ) AS total_efectivo_que_causó_faltante,
  CONCAT(
    'En ',
    COUNT(DISTINCT DATE(t.created_at AT TIME ZONE 'America/Lima')),
    ' días se registraron ',
    COUNT(*),
    ' ventas anuladas por un total de S/ ',
    ROUND(SUM(ABS(t.amount))::numeric, 2),
    '. De ese monto, S/ ',
    ROUND(SUM(
      CASE 
        WHEN t.payment_method = 'efectivo' 
             AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
          THEN ABS(t.amount)
        WHEN t.paid_with_mixed = true
          THEN ABS(COALESCE(t.cash_amount, 0))
        ELSE 0
      END
    )::numeric, 2),
    ' era en efectivo y causó faltante en el cierre de caja.'
  ) AS resumen
FROM transactions t
JOIN schools s ON t.school_id = s.id
WHERE s.name ILIKE '%nordic%'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL);
