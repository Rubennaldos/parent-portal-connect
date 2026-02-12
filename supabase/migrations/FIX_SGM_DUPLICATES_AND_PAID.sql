-- ============================================================
-- FIX DEFINITIVO: Limpiar duplicados y transacciones incorrectas en SGM
-- Fecha: 2026-02-11
-- ============================================================

-- ============================================================
-- PASO 1: Identificar transacciones DUPLICADAS (mismo teacher/student + mismo lunch_order_id en metadata)
-- ============================================================
SELECT 
  'DUPLICADOS POR METADATA' as tipo,
  t.metadata->>'lunch_order_id' as lunch_order_id,
  COUNT(*) as cantidad,
  array_agg(t.id) as transaction_ids,
  array_agg(t.payment_status) as statuses
FROM transactions t
WHERE t.metadata->>'lunch_order_id' IS NOT NULL
  AND t.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0' -- SGM
GROUP BY t.metadata->>'lunch_order_id'
HAVING COUNT(*) > 1;

-- ============================================================
-- PASO 2: Identificar transacciones de profesores que están "paid" 
--         pero sin payment_method (fueron marcadas incorrectamente)
-- ============================================================
SELECT 
  'PAID SIN METODO DE PAGO' as tipo,
  t.id,
  tp.full_name as profesor,
  t.created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  t.created_by
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND t.payment_status = 'paid'
  AND t.payment_method IS NULL
  AND t.teacher_id IS NOT NULL
  AND t.type = 'purchase';

-- ============================================================
-- PASO 3: Encontrar transacciones "huérfanas" del created_at midnight 
--         que son duplicados virtuales materializados
-- ============================================================
SELECT 
  'VIRTUALES MATERIALIZADAS (midnight)' as tipo,
  t.id,
  tp.full_name as profesor,
  t.created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  t.metadata
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND t.created_at::time = '00:00:00'
  AND t.metadata->>'source' = 'lunch_order'
  AND t.type = 'purchase';

-- ============================================================
-- PASO 4: Para Carmen Rosa - comparar transacciones vs lunch_orders
-- ============================================================
SELECT 
  'CARMEN ROSA - TRANSACCIONES' as tipo,
  t.id,
  t.created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  t.metadata
FROM transactions t
WHERE t.teacher_id = 'e8ac1cef-3942-43e1-bc75-9c6a3c0fb738'
ORDER BY t.created_at;

-- ============================================================
-- PASO 5: Para Yvonne Aranda - verificar duplicados
-- ============================================================
SELECT 
  'YVONNE ARANDA - TRANSACCIONES' as tipo,
  t.id,
  t.created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  t.metadata
FROM transactions t
WHERE t.teacher_id = 'c2cb69f1-b363-44e9-82d9-fc9783367c8d'
ORDER BY t.created_at;

-- ============================================================
-- PASO 6: CORREGIR - Mover transacciones "paid" sin payment_method a "pending"
-- Estas fueron cobradas incorrectamente (sin método de pago = no se cobró realmente)
-- ============================================================
UPDATE transactions 
SET payment_status = 'pending'
WHERE school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND payment_status = 'paid'
  AND payment_method IS NULL
  AND teacher_id IS NOT NULL
  AND type = 'purchase';

-- ============================================================
-- PASO 7: ELIMINAR transacciones duplicadas (virtuales materializadas a midnight)
-- que ya tienen una transacción real con timestamp real
-- ============================================================

-- Primero: Para cada teacher_id + order_date, si hay una transacción "real" 
-- (created_at tiene hora real, no midnight) Y una "virtual materializada" 
-- (created_at = midnight, metadata tiene lunch_order_id), eliminar la virtual.

-- Encontrar los IDs a eliminar:
WITH real_transactions AS (
  -- Transacciones creadas con timestamp REAL (no midnight)
  SELECT 
    t.id,
    t.teacher_id,
    t.description,
    t.created_at
  FROM transactions t
  WHERE t.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
    AND t.teacher_id IS NOT NULL
    AND t.type = 'purchase'
    AND t.created_at::time != '00:00:00'
    AND t.description ILIKE '%almuerzo%'
),
virtual_materialized AS (
  -- Transacciones creadas a midnight con metadata de lunch_order
  SELECT 
    t.id,
    t.teacher_id,
    t.description,
    t.metadata->>'order_date' as order_date,
    t.metadata->>'lunch_order_id' as lunch_order_id
  FROM transactions t
  WHERE t.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
    AND t.teacher_id IS NOT NULL
    AND t.type = 'purchase'
    AND t.created_at::time = '00:00:00'
    AND t.metadata->>'source' = 'lunch_order'
),
duplicates_to_delete AS (
  SELECT vm.id as virtual_id, rt.id as real_id, vm.teacher_id, vm.description as virtual_desc, rt.description as real_desc
  FROM virtual_materialized vm
  JOIN real_transactions rt ON vm.teacher_id = rt.teacher_id
  WHERE 
    -- Mismo profesor y la descripción real contiene la misma fecha
    rt.description ILIKE '%' || REPLACE(
      TO_CHAR(vm.order_date::date, 'DD de TMMonth'), 
      ' ', '%'
    ) || '%'
)
SELECT 'DUPLICADOS A ELIMINAR' as tipo, * FROM duplicates_to_delete;

-- ============================================================
-- PASO 8: Contar totales por estado
-- ============================================================
SELECT 
  payment_status,
  COUNT(*) as total,
  SUM(ABS(amount)) as monto_total
FROM transactions
WHERE school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND type = 'purchase'
GROUP BY payment_status;
