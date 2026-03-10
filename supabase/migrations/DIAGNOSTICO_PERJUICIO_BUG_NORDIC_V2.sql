-- ============================================================
-- DIAGNÓSTICO V2: PERJUICIO ECONÓMICO BUG VENTAS ANULADAS
-- SEDE: NORDIC  (ID: ba6219dd-05ce-43a4-b91b-47ca94744f97)
-- ============================================================
-- HALLAZGO DEL PASO 2: efectivo_anulado = 0 en todos los días
-- → El bug NO causó faltante de efectivo físico en caja
-- → Pero SÍ infló el "Total Ventas" mostrado en el dashboard
-- ============================================================


-- ============================================================
-- PASO 3 (CORREGIDO): DETALLE DE CADA VENTA ANULADA
-- ============================================================
SELECT
  DATE(t.created_at AT TIME ZONE 'America/Lima')        AS fecha,
  t.ticket_code,
  LEFT(t.description, 60)                               AS descripcion,
  ABS(t.amount)                                         AS monto,
  UPPER(COALESCE(t.payment_method, 'saldo/crédito'))    AS metodo_pago,
  t.payment_status,
  CASE 
    WHEN t.student_id IS NOT NULL 
      THEN COALESCE(st.full_name, '(alumno sin nombre)')
    WHEN t.teacher_id IS NOT NULL
      THEN COALESCE(tp.full_name, '(profesor sin nombre)')
    ELSE 'Cliente genérico'
  END                                                   AS cliente,
  COALESCE(p.full_name, p.email, 'desconocido')         AS cajero,
  COALESCE(t.metadata->>'cancelled_at', 'sin fecha')   AS fecha_anulacion,
  COALESCE(t.metadata->>'cancellation_reason', '—')    AS motivo_anulacion
FROM transactions t
LEFT JOIN students st         ON t.student_id  = st.id
LEFT JOIN teacher_profiles tp ON t.teacher_id  = tp.id
LEFT JOIN profiles p          ON t.created_by  = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
ORDER BY t.created_at DESC;


-- ============================================================
-- PASO 4: IMPACTO EN EL DASHBOARD DE VENTAS
-- Cuánto estaba inflado el "Total Ventas" por día
-- (aunque no causó faltante de efectivo, mostraba montos erróneos)
-- ============================================================
SELECT
  DATE(t.created_at AT TIME ZONE 'America/Lima')  AS fecha,
  COUNT(*)                                        AS ventas_anuladas_contadas_de_más,
  SUM(ABS(t.amount))                             AS total_ventas_inflado_por_este_monto,
  COALESCE(cc.pos_total + cc.lunch_total, 0)     AS total_ventas_registrado_en_cierre,
  COALESCE(cc.pos_total + cc.lunch_total, 0) - SUM(ABS(t.amount))
                                                  AS total_ventas_correcto_real
FROM transactions t
JOIN schools s ON t.school_id = s.id
LEFT JOIN cash_closures cc 
  ON cc.school_id = t.school_id
  AND cc.closure_date = DATE(t.created_at AT TIME ZONE 'America/Lima')
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
GROUP BY DATE(t.created_at AT TIME ZONE 'America/Lima'), cc.pos_total, cc.lunch_total
ORDER BY fecha DESC;


-- ============================================================
-- PASO 5: IDENTIFICAR TRANSACCIONES SOSPECHOSAS
-- El 5 de marzo hubo 39 anulaciones → muchas parecen de prueba
-- Ver prefijos T-PRU y T-AMP en detalle
-- ============================================================
SELECT
  t.ticket_code,
  ABS(t.amount)                                    AS monto,
  LEFT(t.description, 80)                          AS descripcion,
  t.payment_method,
  CASE 
    WHEN t.student_id IS NOT NULL THEN COALESCE(st.full_name, '(alumno)')
    WHEN t.teacher_id IS NOT NULL THEN COALESCE(tp.full_name, '(profesor)')
    ELSE 'Genérico'
  END                                              AS cliente,
  COALESCE(p.full_name, p.email)                  AS creado_por,
  t.created_at AT TIME ZONE 'America/Lima'         AS hora_creacion,
  COALESCE(t.metadata->>'cancellation_reason','—') AS motivo_anulacion,
  CASE
    WHEN t.ticket_code LIKE 'T-PRU%' THEN '🧪 PRUEBA/TEST'
    WHEN t.ticket_code LIKE 'T-AMP%' THEN '⚠️ Prefijo AMP (¿quién es?)'
    ELSE '📋 Normal'
  END                                              AS clasificacion
FROM transactions t
LEFT JOIN students st         ON t.student_id  = st.id
LEFT JOIN teacher_profiles tp ON t.teacher_id  = tp.id
LEFT JOIN profiles p          ON t.created_by  = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND DATE(t.created_at AT TIME ZONE 'America/Lima') = '2026-03-05'
ORDER BY t.ticket_code;


-- ============================================================
-- PASO 6: RESUMEN EJECUTIVO FINAL
-- ¿Cuánto dinero real fue perjudicado?
-- ============================================================
SELECT
  '🏫 NORDIC — RESUMEN DEL PERJUICIO'         AS titulo,
  COUNT(*)                                      AS total_ventas_anuladas,
  COUNT(DISTINCT DATE(t.created_at AT TIME ZONE 'America/Lima'))
                                                AS dias_afectados,
  SUM(ABS(t.amount))                           AS total_monto_anulado,

  -- Efectivo (lo único que causa faltante real en caja)
  SUM(CASE 
    WHEN t.payment_method = 'efectivo' 
         AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
      THEN ABS(t.amount) ELSE 0 
  END)                                          AS efectivo_real_afectado,

  -- Saldo de estudiantes (no afecta caja, pero infla ventas)
  SUM(CASE 
    WHEN t.payment_method IS NULL 
      OR t.payment_method = 'saldo'
      OR t.payment_method = 'credito'
      THEN ABS(t.amount) ELSE 0 
  END)                                          AS ventas_saldo_o_credito_infladas,

  -- Conclusión
  CASE
    WHEN SUM(CASE 
      WHEN t.payment_method = 'efectivo' 
           AND (t.paid_with_mixed = false OR t.paid_with_mixed IS NULL)
        THEN ABS(t.amount) ELSE 0 
    END) = 0
    THEN '✅ El bug NO causó faltante de efectivo en caja. Las ventas anuladas eran de saldo/crédito, no efectivo. El perjuicio es solo informativo (totales inflados en dashboard).'
    ELSE '❌ Sí hubo faltante de efectivo en caja por el bug.'
  END                                           AS conclusion
FROM transactions t
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL);


-- ============================================================
-- PASO 7: VER QUIÉN ANULÓ MÁS VENTAS (¿hay un patrón?)
-- ============================================================
SELECT
  COALESCE(p.full_name, p.email, 'desconocido')  AS quien_anuló,
  p.role                                          AS rol,
  COUNT(*)                                        AS ventas_anuladas,
  SUM(ABS(t.amount))                             AS monto_total_anulado,
  MIN(DATE(t.created_at AT TIME ZONE 'America/Lima')) AS primer_dia,
  MAX(DATE(t.created_at AT TIME ZONE 'America/Lima')) AS ultimo_dia
FROM transactions t
LEFT JOIN profiles p ON 
  (t.metadata->>'cancelled_by')::uuid = p.id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type = 'purchase'
  AND t.payment_status = 'cancelled'
  AND (t.is_deleted = false OR t.is_deleted IS NULL)
GROUP BY p.full_name, p.email, p.role
ORDER BY ventas_anuladas DESC;
