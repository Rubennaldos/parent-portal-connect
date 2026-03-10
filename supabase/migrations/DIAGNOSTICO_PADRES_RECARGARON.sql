-- ====================================================
-- DIAGNÓSTICO: Padres que recargaron y sus hijos
-- Objetivo: Identificar quién recargó y si usó el saldo incorrectamente
-- ====================================================

-- ====================================================
-- PASO 1: LISTA COMPLETA DE PADRES QUE RECARGARON
-- ====================================================
-- Muestra todos los padres que han recargado, con datos de sus hijos
SELECT
  -- Datos del padre
  p.email AS email_padre,
  p.full_name AS nombre_padre,
  p.id AS parent_id,
  -- Datos del hijo
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.grade AS grado,
  s.section AS seccion,
  s.is_active AS hijo_activo,
  -- Datos de la recarga
  rr.id AS recharge_request_id,
  rr.amount AS monto_recargado,
  rr.status AS estado_recarga,
  rr.created_at AS fecha_recarga,
  rr.approved_at AS fecha_aprobacion,
  rr.payment_method AS metodo_pago_recarga,
  -- Saldo actual del hijo
  s.balance AS saldo_actual_hijo,
  s.free_account AS es_cuenta_libre,
  -- Colegio
  sch.name AS colegio,
  sch.code AS codigo_colegio,
  -- Diagnóstico
  CASE
    WHEN s.balance > 0 THEN '✅ Saldo disponible (se usará en kiosco)'
    WHEN s.balance = 0 THEN '⚠️ Saldo ya usado o devuelto'
    ELSE '❌ Saldo negativo (deuda)'
  END AS diagnostico_saldo
FROM recharge_requests rr
INNER JOIN students s ON rr.student_id = s.id
INNER JOIN profiles p ON s.parent_id = p.id
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE rr.status = 'approved'  -- Solo recargas aprobadas
  AND rr.created_at >= CURRENT_DATE - INTERVAL '90 days'  -- Últimos 90 días
ORDER BY rr.created_at DESC, p.email, s.full_name;

-- ====================================================
-- PASO 2: VERIFICAR SI HAY ALMUERZOS PAGADOS CON SALDO
-- ====================================================
-- Esto NO debería pasar, pero verificamos por si acaso
SELECT
  -- Datos del padre
  p.email AS email_padre,
  p.full_name AS nombre_padre,
  -- Datos del hijo
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  -- Transacción de almuerzo sospechosa
  t.id AS transaction_id,
  t.created_at AS fecha_transaccion,
  t.amount AS monto_almuerzo,
  t.payment_method AS metodo_pago,
  t.payment_status AS estado_pago,
  t.description AS descripcion,
  t.ticket_code AS ticket,
  -- Metadata del pedido
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'menu_name' AS menu_nombre,
  t.metadata->>'menu_date' AS menu_fecha,
  -- Diagnóstico
  CASE
    WHEN t.payment_method = 'saldo' THEN '🚨 PROBLEMA: Almuerzo pagado con saldo (NO debería pasar)'
    WHEN t.payment_method IN ('plin', 'yape', 'transfer') AND t.payment_status = 'paid' THEN '✅ Almuerzo pagado correctamente (no usa saldo)'
    WHEN t.payment_status = 'pending' THEN '⏳ Almuerzo pendiente de pago'
    ELSE '❓ Caso no identificado'
  END AS diagnostico
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
INNER JOIN profiles p ON s.parent_id = p.id
WHERE t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL  -- Es un almuerzo
  AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
  AND EXISTS (
    -- Solo si el padre tiene recargas aprobadas
    SELECT 1 FROM recharge_requests rr
    WHERE rr.student_id = s.id
      AND rr.status = 'approved'
      AND rr.created_at >= CURRENT_DATE - INTERVAL '90 days'
  )
ORDER BY t.created_at DESC;

-- ====================================================
-- PASO 3: RESUMEN POR PADRE (PARA DECISIONES)
-- ====================================================
-- Lista simplificada para que el admin decida quién necesita devolución
SELECT
  p.email AS email_padre,
  p.full_name AS nombre_padre,
  COUNT(DISTINCT s.id) AS num_hijos,
  STRING_AGG(s.full_name, ', ') AS nombres_hijos,
  SUM(rr.amount) AS total_recargado,
  SUM(s.balance) AS total_saldo_actual,
  MIN(rr.created_at) AS primera_recarga,
  MAX(rr.created_at) AS ultima_recarga,
  -- Verificar si hay almuerzos pagados con saldo (NO debería pasar)
  COUNT(DISTINCT CASE 
    WHEN t.payment_method = 'saldo' 
      AND t.metadata->>'lunch_order_id' IS NOT NULL 
    THEN t.id 
  END) AS almuerzos_pagados_con_saldo,
  -- Diagnóstico final
  CASE
    WHEN COUNT(DISTINCT CASE 
      WHEN t.payment_method = 'saldo' 
        AND t.metadata->>'lunch_order_id' IS NOT NULL 
      THEN t.id 
    END) > 0 THEN '🚨 URGENTE: Almuerzos pagados con saldo (devolver dinero)'
    WHEN SUM(s.balance) > 0 THEN '✅ Saldo disponible (usar en kiosco o devolver)'
    WHEN SUM(s.balance) = 0 THEN '⚠️ Saldo ya usado'
    ELSE '❓ Caso especial'
  END AS recomendacion
FROM recharge_requests rr
INNER JOIN students s ON rr.student_id = s.id
INNER JOIN profiles p ON s.parent_id = p.id
LEFT JOIN transactions t ON t.student_id = s.id 
  AND t.type = 'purchase'
  AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
WHERE rr.status = 'approved'
  AND rr.created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY p.id, p.email, p.full_name
ORDER BY 
  CASE 
    WHEN COUNT(DISTINCT CASE 
      WHEN t.payment_method = 'saldo' 
        AND t.metadata->>'lunch_order_id' IS NOT NULL 
      THEN t.id 
    END) > 0 THEN 1  -- Urgentes primero
    ELSE 2
  END,
  SUM(rr.amount) DESC;  -- Luego por monto recargado

-- ====================================================
-- PASO 4: CASOS ESPECÍFICOS QUE REQUIEREN DEVOLUCIÓN
-- ====================================================
-- Solo padres que tienen saldo Y han usado ese saldo para pagar almuerzos
-- (Esto NO debería pasar, pero si pasa, necesitan devolución)
SELECT
  p.email AS email_padre,
  p.full_name AS nombre_padre,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  t.id AS transaction_id_almuerzo,
  t.amount AS monto_almuerzo_pagado,
  t.created_at AS fecha_pago_almuerzo,
  t.ticket_code AS ticket_almuerzo,
  t.description AS descripcion_almuerzo,
  -- Recarga original
  rr.amount AS monto_recarga_original,
  rr.created_at AS fecha_recarga,
  -- Diagnóstico
  '🚨 DEVOLVER: Este padre pagó almuerzo con saldo de recarga (error del sistema)' AS accion_requerida
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
INNER JOIN profiles p ON s.parent_id = p.id
INNER JOIN recharge_requests rr ON rr.student_id = s.id
WHERE t.type = 'purchase'
  AND t.payment_method = 'saldo'  -- Pagado con saldo
  AND t.metadata->>'lunch_order_id' IS NOT NULL  -- Es un almuerzo
  AND t.payment_status = 'paid'  -- Ya pagado
  AND rr.status = 'approved'
  AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY t.created_at DESC;

-- ====================================================
-- PASO 5: SCRIPT PARA DEVOLVER SALDO (USAR CASO POR CASO)
-- ====================================================
-- ⚠️ IMPORTANTE: Ejecutar SOLO después de que el admin haya devuelto el dinero físicamente
-- Reemplaza 'PEGA-AQUI-EL-STUDENT-ID' con el ID del alumno

/*
-- Ejemplo: Devolver saldo de un alumno específico
UPDATE students
SET 
  balance = 0,
  updated_at = NOW()
WHERE id = 'PEGA-AQUI-EL-STUDENT-ID';

-- Registrar la devolución en el historial
INSERT INTO transactions (
  student_id,
  type,
  amount,
  status,
  payment_method,
  description,
  payment_status,
  created_at
)
VALUES (
  'PEGA-AQUI-EL-STUDENT-ID',
  'refund',
  60.00,  -- Monto devuelto (ajustar según el caso)
  'completed',
  'plin',  -- Método de devolución (ajustar: 'plin', 'yape', 'cash', etc.)
  'Devolución de recarga — Error de concepto (único caso)',
  'paid',
  NOW()
);
*/
