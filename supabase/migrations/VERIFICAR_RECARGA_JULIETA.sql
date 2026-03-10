-- ═══════════════════════════════════════════════
-- VERIFICAR RECARGA: Julieta Neyra Lamas
-- Verificar si realmente abonó 50 soles y si se le descontó incorrectamente
-- ═══════════════════════════════════════════════

-- PASO 1A: Buscar por el nombre del ESTUDIANTE "Julieta Neyra Lamas"
SELECT 
  s.id AS student_id,
  s.full_name AS estudiante,
  s.parent_id AS user_id_padre,
  s.balance AS saldo_actual,
  s.school_id,
  p.full_name AS nombre_padre,
  p.email AS email_padre
FROM students s
LEFT JOIN profiles p ON p.id = s.parent_id
WHERE s.full_name ILIKE '%Julieta%Neyra%Lamas%'
   OR s.full_name ILIKE '%Julieta%Neyra%'
ORDER BY s.created_at DESC
LIMIT 5;

-- PASO 1B: Buscar por la escuela "St. George's Villa" o "Villa"
SELECT 
  p.id AS user_id,
  p.email,
  p.full_name,
  p.role,
  pp.school_id,
  s.name AS nombre_escuela
FROM profiles p
LEFT JOIN parent_profiles pp ON pp.user_id = p.id
LEFT JOIN schools s ON s.id = pp.school_id
WHERE s.name ILIKE '%St. George%'
   OR s.name ILIKE '%Villa%'
   OR s.name ILIKE '%George%'
ORDER BY p.created_at DESC
LIMIT 10;

-- ═══════════════════════════════════════════════
-- DATOS ENCONTRADOS:
-- student_id: cd5fb741-72fd-445d-9f16-1a11ba92ca88
-- user_id_padre: 69de8493-3693-4fd2-bd36-45077f2ef115
-- saldo_actual: 20.50
-- ═══════════════════════════════════════════════

-- PASO 3: Ver TODAS las recargas (recharge_requests) de Julieta
SELECT 
  'Recarga' AS tipo,
  rr.id,
  rr.amount AS monto_solicitado,
  rr.status,
  rr.payment_method,
  rr.reference_code,
  rr.created_at AS fecha_solicitud,
  rr.approved_at AS fecha_aprobacion,
  rr.approved_by
FROM recharge_requests rr
WHERE rr.parent_id = '69de8493-3693-4fd2-bd36-45077f2ef115'
ORDER BY rr.created_at DESC;

-- PASO 4: Ver TODAS las transacciones de tipo "recharge" (recargas aprobadas)
SELECT 
  'Transacción Recarga' AS tipo,
  t.id,
  t.created_at AS fecha,
  t.description,
  t.amount AS monto,
  t.payment_status,
  t.payment_method,
  t.metadata->>'recharge_request_id' AS recharge_request_id,
  t.metadata->>'reference_code' AS reference_code
FROM transactions t
WHERE t.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND t.type = 'recharge'
ORDER BY t.created_at DESC;

-- PASO 5: Ver TODAS las transacciones de tipo "purchase" (compras/almuerzos)
-- Estas NO deberían descontarse del saldo si son almuerzos
SELECT 
  'Transacción Compra' AS tipo,
  t.id,
  t.created_at AS fecha,
  t.description,
  t.amount AS monto,
  t.payment_status,
  t.metadata->>'source' AS source,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'order_date' AS order_date,
  CASE 
    WHEN (t.metadata->>'source')::text LIKE '%lunch%' 
      OR (t.metadata->>'source')::text LIKE '%almuerzo%'
      OR (t.metadata->>'source')::text LIKE '%unified_calendar%'
    THEN '❌ ALMUERZO (NO debería descontarse)'
    ELSE '✅ KIOSCO (SÍ debería descontarse)'
  END AS tipo_compra
FROM transactions t
WHERE t.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND t.type = 'purchase'
ORDER BY t.created_at DESC;

-- PASO 6: Ver el saldo ACTUAL
SELECT 
  s.id AS student_id,
  s.full_name AS estudiante,
  s.balance AS saldo_actual,
  s.free_account,
  s.kiosk_disabled
FROM students s
WHERE s.id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- PASO 7: Calcular el saldo que DEBERÍA tener (recargas - compras del kiosco, SIN almuerzos)
SELECT 
  s.full_name AS estudiante,
  s.balance AS saldo_actual,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) AS total_recargas,
  COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status = 'paid'
    AND (t.metadata->>'source')::text NOT LIKE '%lunch%'
    AND (t.metadata->>'source')::text NOT LIKE '%almuerzo%'
    AND (t.metadata->>'source')::text NOT LIKE '%unified_calendar%'
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS total_compras_kiosco,
  COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status = 'paid'
    AND ((t.metadata->>'source')::text LIKE '%lunch%'
      OR (t.metadata->>'source')::text LIKE '%almuerzo%'
      OR (t.metadata->>'source')::text LIKE '%unified_calendar%')
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS total_almuerzos_descontados_incorrectamente,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) 
  - COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status = 'paid'
    AND (t.metadata->>'source')::text NOT LIKE '%lunch%'
    AND (t.metadata->>'source')::text NOT LIKE '%almuerzo%'
    AND (t.metadata->>'source')::text NOT LIKE '%unified_calendar%'
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS saldo_que_deberia_tener,
  s.balance - (
    COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) 
    - COALESCE(SUM(CASE 
      WHEN t.type = 'purchase' 
      AND t.payment_status = 'paid'
      AND (t.metadata->>'source')::text NOT LIKE '%lunch%'
      AND (t.metadata->>'source')::text NOT LIKE '%almuerzo%'
      AND (t.metadata->>'source')::text NOT LIKE '%unified_calendar%'
      THEN ABS(t.amount) 
      ELSE 0 
    END), 0)
  ) AS diferencia_a_restaurar
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
WHERE s.id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
GROUP BY s.id, s.full_name, s.balance;
