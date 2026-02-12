-- =====================================================
-- DIAGNÓSTICO PROFUNDO: DUPLICADOS EN SAINT GEORGE MIRAFLORES
-- =====================================================
-- Fecha: 2026-02-11
-- Reportado: Ventas duplicadas/triplicadas + yendo a pagados automáticamente
-- =====================================================

-- ===== PASO 1: VERIFICAR DEFAULT DE payment_status =====
-- Si esto devuelve 'paid' como default, ESE ES EL PROBLEMA PRINCIPAL
SELECT 
    column_name,
    column_default,
    is_nullable,
    data_type
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- ===== PASO 2: VERIFICAR TRIGGERS EN TRANSACTIONS =====
-- Si hay algún trigger que cambie payment_status automáticamente
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'transactions'
ORDER BY trigger_name;

-- ===== PASO 3: VERIFICAR TRIGGERS EN LUNCH_ORDERS =====
-- Si hay un trigger que cree transacciones al insertar lunch_orders
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'lunch_orders'
ORDER BY trigger_name;

-- ===== PASO 4: FUNCIONES QUE INSERTAN EN TRANSACTIONS =====
SELECT 
    routine_name,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_definition ILIKE '%INSERT INTO%transactions%'
ORDER BY routine_name;

-- ===== PASO 5: CASO CARMEN ROSA RIOS RAMAL =====
-- Ver TODAS sus transacciones (pending Y paid)
SELECT 
    t.id,
    t.created_at,
    t.amount,
    t.description,
    t.payment_status,
    t.payment_method,
    t.created_by,
    t.metadata,
    t.school_id
FROM transactions t
JOIN profiles p ON t.teacher_id = p.id
WHERE p.full_name ILIKE '%Carmen Rosa%'
ORDER BY t.created_at;

-- ===== PASO 6: LUNCH ORDERS DE CARMEN ROSA =====
SELECT 
    lo.id as lunch_order_id,
    lo.order_date,
    lo.status,
    lo.is_cancelled,
    lo.teacher_id,
    lo.created_at,
    lo.school_id
FROM lunch_orders lo
JOIN profiles p ON lo.teacher_id = p.id
WHERE p.full_name ILIKE '%Carmen Rosa%'
ORDER BY lo.order_date;

-- ===== PASO 7: TRANSACCIONES RECIENTES EN SGM CON payment_status='paid' =====
-- Las que fueron a pagadas HOY o AYER
SELECT 
    t.id,
    p.full_name as profesor,
    t.created_at,
    t.amount,
    t.description,
    t.payment_status,
    t.payment_method,
    t.created_by,
    t.metadata
FROM transactions t
LEFT JOIN profiles p ON t.teacher_id = p.id
JOIN schools s ON t.school_id = s.id
WHERE s.name ILIKE '%Saint George Miraflores%'
  AND t.payment_status = 'paid'
  AND t.created_at >= '2026-02-10 00:00:00'
ORDER BY t.created_at DESC;

-- ===== PASO 8: TRANSACCIONES CON payment_method NULL/desconocido EN SGM =====
SELECT 
    t.id,
    COALESCE(p.full_name, p2.full_name, t.manual_client_name) as cliente,
    t.created_at,
    t.amount,
    t.description,
    t.payment_status,
    t.payment_method,
    t.created_by
FROM transactions t
LEFT JOIN profiles p ON t.teacher_id = p.id
LEFT JOIN profiles p2 ON t.student_id = p2.id
JOIN schools s ON t.school_id = s.id
WHERE s.name ILIKE '%Saint George Miraflores%'
  AND t.payment_status = 'paid'
  AND (t.payment_method IS NULL OR t.payment_method = '')
ORDER BY t.created_at DESC;

-- ===== PASO 9: COMPARAR LUNCH_ORDERS vs TRANSACTIONS EN SGM =====
-- Ver cuántas transacciones tiene cada lunch_order
SELECT 
    lo.id as lunch_order_id,
    lo.order_date,
    lo.teacher_id,
    p.full_name as profesor,
    lo.status,
    COUNT(t.id) as num_transacciones,
    STRING_AGG(t.id::text, ', ') as transaction_ids,
    STRING_AGG(t.payment_status, ', ') as payment_statuses,
    STRING_AGG(t.payment_method, ', ') as payment_methods
FROM lunch_orders lo
JOIN profiles p ON lo.teacher_id = p.id
JOIN schools s ON p.school_id = s.id
LEFT JOIN transactions t ON (
    t.teacher_id = lo.teacher_id 
    AND t.type = 'purchase'
    AND (
        t.metadata->>'lunch_order_id' = lo.id::text
        OR (
            t.description ILIKE '%almuerzo%'
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - lo.created_at))) < 86400
        )
    )
)
WHERE s.name ILIKE '%Saint George Miraflores%'
  AND lo.is_cancelled = false
GROUP BY lo.id, lo.order_date, lo.teacher_id, p.full_name, lo.status
HAVING COUNT(t.id) > 1
ORDER BY COUNT(t.id) DESC, p.full_name;

-- ===== PASO 10: TODAS LAS TRANSACCIONES CREADAS HOY EN SGM =====
SELECT 
    t.id,
    COALESCE(p.full_name, t.manual_client_name, 'Sin nombre') as cliente,
    t.created_at as fecha_creacion,
    t.amount as monto,
    t.description,
    t.payment_status,
    t.payment_method,
    t.created_by,
    cb.full_name as creado_por,
    cb.role as rol_creador
FROM transactions t
LEFT JOIN profiles p ON t.teacher_id = p.id
LEFT JOIN profiles cb ON t.created_by = cb.id
JOIN schools s ON t.school_id = s.id
WHERE s.name ILIKE '%Saint George Miraflores%'
  AND t.created_at >= '2026-02-11 00:00:00'
ORDER BY t.created_at DESC;
