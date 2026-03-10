-- ═══════════════════════════════════════════════════════════
-- DIAGNÓSTICO: Números de Operación Bancaria
-- Busca: 06329042 y 06301604
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────
-- PASO 1: Buscar en recharge_requests (Recargas de saldo)
-- ───────────────────────────────────────────────────────────
SELECT 
  'RECARGA DE SALDO' AS tipo_registro,
  rr.id AS registro_id,
  rr.reference_code AS numero_operacion,
  rr.amount AS monto,
  rr.payment_method AS metodo_pago,
  rr.status AS estado,
  rr.created_at AS fecha_creacion,
  rr.approved_at AS fecha_aprobacion,
  rr.approved_by AS aprobado_por_id,
  -- Datos del padre
  p.full_name AS nombre_padre,
  p.email AS email_padre,
  p.role AS rol_padre,
  -- Datos del estudiante
  s.full_name AS nombre_estudiante,
  s.grade AS grado,
  s.section AS seccion,
  s.balance AS saldo_actual,
  -- Sede
  sch.name AS sede,
  -- Aprobador
  aprobador.full_name AS aprobado_por_nombre,
  -- Descripción
  rr.description AS descripcion,
  rr.notes AS notas_padre,
  -- Voucher
  CASE 
    WHEN rr.voucher_url IS NOT NULL THEN '✅ Sí'
    ELSE '❌ No'
  END AS tiene_voucher
FROM recharge_requests rr
LEFT JOIN profiles p ON p.id = rr.parent_id
LEFT JOIN students s ON s.id = rr.student_id
LEFT JOIN schools sch ON sch.id = rr.school_id
LEFT JOIN profiles aprobador ON aprobador.id = rr.approved_by
WHERE rr.reference_code IN ('06329042', '06301604')
ORDER BY rr.created_at DESC;

-- ───────────────────────────────────────────────────────────
-- PASO 2: Buscar en billing_payments (Pagos de cobranzas)
-- ───────────────────────────────────────────────────────────
SELECT 
  'PAGO DE COBRANZA' AS tipo_registro,
  bp.id AS registro_id,
  bp.operation_number AS numero_operacion,
  bp.paid_amount AS monto_pagado,
  bp.total_amount AS monto_total,
  bp.payment_method AS metodo_pago,
  bp.status AS estado,
  bp.paid_at AS fecha_pago,
  bp.created_at AS fecha_creacion,
  -- Datos del padre
  p.full_name AS nombre_padre,
  p.email AS email_padre,
  p.role AS rol_padre,
  -- Datos del estudiante
  s.full_name AS nombre_estudiante,
  s.grade AS grado,
  s.section AS seccion,
  -- Sede
  sch.name AS sede,
  -- Creador (admin que registró el pago)
  creador.full_name AS registrado_por,
  creador.email AS registrado_por_email,
  -- Observaciones
  bp.notes AS notas
FROM billing_payments bp
LEFT JOIN profiles p ON p.id = (
  SELECT user_id FROM parent_profiles WHERE user_id = bp.parent_id LIMIT 1
)
LEFT JOIN students s ON s.id = bp.student_id
LEFT JOIN schools sch ON sch.id = bp.school_id
LEFT JOIN profiles creador ON creador.id = bp.created_by
WHERE bp.operation_number IN ('06329042', '06301604')
   OR bp.operation_number LIKE '%06329042%'
   OR bp.operation_number LIKE '%06301604%'
ORDER BY bp.created_at DESC;

-- ───────────────────────────────────────────────────────────
-- PASO 3: Buscar en transactions (metadata)
-- ───────────────────────────────────────────────────────────
SELECT 
  'TRANSACCIÓN' AS tipo_registro,
  t.id AS registro_id,
  t.metadata->>'operation_number' AS numero_operacion,
  t.amount AS monto,
  t.type AS tipo_transaccion,
  t.payment_method AS metodo_pago,
  t.payment_status AS estado_pago,
  t.created_at AS fecha_creacion,
  -- Datos del estudiante
  s.full_name AS nombre_estudiante,
  s.grade AS grado,
  s.section AS seccion,
  -- Sede
  sch.name AS sede,
  -- Descripción
  t.description AS descripcion,
  t.ticket_code AS ticket,
  -- Cajero
  cajero.email AS cajero_email,
  cajero.full_name AS cajero_nombre
FROM transactions t
LEFT JOIN students s ON s.id = t.student_id
LEFT JOIN schools sch ON sch.id = s.school_id
LEFT JOIN profiles cajero ON cajero.id = t.created_by
WHERE t.metadata->>'operation_number' IN ('06329042', '06301604')
   OR t.metadata->>'operation_number' LIKE '%06329042%'
   OR t.metadata->>'operation_number' LIKE '%06301604%'
ORDER BY t.created_at DESC;

-- ───────────────────────────────────────────────────────────
-- PASO 4: RESUMEN CONSOLIDADO
-- ───────────────────────────────────────────────────────────
WITH todos_los_registros AS (
  -- Recargas
  SELECT 
    'RECARGA' AS tipo,
    rr.reference_code AS numero_operacion,
    rr.amount AS monto,
    rr.status AS estado,
    rr.created_at AS fecha,
    p.full_name AS nombre_padre,
    p.email AS email_padre,
    s.full_name AS nombre_estudiante,
    sch.name AS sede,
    rr.description AS detalle
  FROM recharge_requests rr
  LEFT JOIN profiles p ON p.id = rr.parent_id
  LEFT JOIN students s ON s.id = rr.student_id
  LEFT JOIN schools sch ON sch.id = rr.school_id
  WHERE rr.reference_code IN ('06329042', '06301604')
  
  UNION ALL
  
  -- Pagos de cobranza
  SELECT 
    'PAGO COBRANZA' AS tipo,
    bp.operation_number AS numero_operacion,
    bp.paid_amount AS monto,
    bp.status AS estado,
    bp.created_at AS fecha,
    p.full_name AS nombre_padre,
    p.email AS email_padre,
    s.full_name AS nombre_estudiante,
    sch.name AS sede,
    bp.notes AS detalle
  FROM billing_payments bp
  LEFT JOIN profiles p ON p.id = (
    SELECT user_id FROM parent_profiles WHERE user_id = bp.parent_id LIMIT 1
  )
  LEFT JOIN students s ON s.id = bp.student_id
  LEFT JOIN schools sch ON sch.id = bp.school_id
  WHERE bp.operation_number IN ('06329042', '06301604')
     OR bp.operation_number LIKE '%06329042%'
     OR bp.operation_number LIKE '%06301604%'
  
  UNION ALL
  
  -- Transacciones
  SELECT 
    'TRANSACCIÓN' AS tipo,
    t.metadata->>'operation_number' AS numero_operacion,
    ABS(t.amount) AS monto,
    t.payment_status AS estado,
    t.created_at AS fecha,
    NULL AS nombre_padre,
    NULL AS email_padre,
    s.full_name AS nombre_estudiante,
    sch.name AS sede,
    t.description AS detalle
  FROM transactions t
  LEFT JOIN students s ON s.id = t.student_id
  LEFT JOIN schools sch ON sch.id = s.school_id
  WHERE t.metadata->>'operation_number' IN ('06329042', '06301604')
     OR t.metadata->>'operation_number' LIKE '%06329042%'
     OR t.metadata->>'operation_number' LIKE '%06301604%'
)
SELECT 
  numero_operacion,
  COUNT(*) AS veces_usado,
  STRING_AGG(DISTINCT tipo, ', ') AS tipos_registro,
  SUM(monto) AS monto_total,
  STRING_AGG(DISTINCT nombre_padre, ' / ') FILTER (WHERE nombre_padre IS NOT NULL) AS padres,
  STRING_AGG(DISTINCT nombre_estudiante, ' / ') FILTER (WHERE nombre_estudiante IS NOT NULL) AS estudiantes,
  STRING_AGG(DISTINCT sede, ' / ') FILTER (WHERE sede IS NOT NULL) AS sedes,
  MIN(fecha) AS primera_vez_usado,
  MAX(fecha) AS ultima_vez_usado
FROM todos_los_registros
GROUP BY numero_operacion
ORDER BY numero_operacion;
