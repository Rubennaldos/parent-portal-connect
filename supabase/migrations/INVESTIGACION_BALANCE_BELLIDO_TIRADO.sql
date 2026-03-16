-- =====================================================================
-- INVESTIGACIÓN PROFUNDA: ¿De dónde vienen los -188.50 y -160.00?
-- Buscar TODAS las transacciones (no solo kiosco) y cualquier
-- operación que haya tocado el balance de estos dos alumnos.
-- Solo lectura.
-- =====================================================================

-- ─── 1. TODAS las transacciones de MATEO (sin excepción) ─────────────
-- Incluye recargas, compras, refunds, almuerzos, todo.
SELECT
  t.id,
  t.type,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.description,
  t.created_at,
  t.ticket_code,
  t.is_deleted,
  t.metadata->>'lunch_order_id'   AS lunch_order_id,
  t.metadata->>'source'           AS source,
  t.metadata                      AS metadata_completa
FROM transactions t
WHERE t.student_id = '273edace-ce52-4b76-95cf-5f3492368ada'
ORDER BY t.created_at;

-- ─── 2. TODAS las transacciones de PIERO (sin excepción) ─────────────
SELECT
  t.id,
  t.type,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.description,
  t.created_at,
  t.ticket_code,
  t.is_deleted,
  t.metadata->>'lunch_order_id'   AS lunch_order_id,
  t.metadata->>'source'           AS source,
  t.metadata                      AS metadata_completa
FROM transactions t
WHERE t.student_id = 'bc6af3c3-398c-4f3f-864e-a219a74d494a'
ORDER BY t.created_at;

-- ─── 3. RECONSTRUIR el balance calculado vs el real ──────────────────
-- Si el sistema funcionara perfecto, el balance debería ser la suma
-- de todas las transacciones vigentes (no cancelled, no deleted).
-- Comparar con el balance actual para detectar la discrepancia.

-- MATEO:
SELECT
  'MATEO BENJAMIN BELLIDO TIRADO' AS alumno,
  s.balance AS balance_actual_en_db,
  -- Suma de recargas (positivas)
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status != 'cancelled' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0) AS total_recargas,
  -- Suma de compras POS kiosco (negativas) - solo las que descuentan balance
  COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount ELSE 0 END), 0) AS total_compras_kiosco,
  -- Suma de compras almuerzo (negativas) - estas NO deberían afectar balance
  COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NOT NULL THEN t.amount ELSE 0 END), 0) AS total_compras_almuerzo,
  -- Suma de refunds
  COALESCE(SUM(CASE WHEN t.type = 'refund' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0) AS total_refunds,
  -- Balance "teórico" si solo contamos kiosco + recargas + refunds
  COALESCE(SUM(CASE WHEN t.type IN ('recharge', 'refund') AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount ELSE 0 END), 0) AS balance_teorico_solo_kiosco,
  -- Balance si TAMBIÉN contamos almuerzos (erróneamente)
  COALESCE(SUM(CASE WHEN t.type IN ('recharge', 'refund') AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0) AS balance_si_contamos_todo
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
WHERE s.id = '273edace-ce52-4b76-95cf-5f3492368ada'
GROUP BY s.balance;

-- PIERO:
SELECT
  'PIERO ALESSANDRO BELLIDO TIRADO' AS alumno,
  s.balance AS balance_actual_en_db,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status != 'cancelled' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0) AS total_recargas,
  COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount ELSE 0 END), 0) AS total_compras_kiosco,
  COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NOT NULL THEN t.amount ELSE 0 END), 0) AS total_compras_almuerzo,
  COALESCE(SUM(CASE WHEN t.type = 'refund' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0) AS total_refunds,
  COALESCE(SUM(CASE WHEN t.type IN ('recharge', 'refund') AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount ELSE 0 END), 0) AS balance_teorico_solo_kiosco,
  COALESCE(SUM(CASE WHEN t.type IN ('recharge', 'refund') AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0) AS balance_si_contamos_todo
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
WHERE s.id = 'bc6af3c3-398c-4f3f-864e-a219a74d494a'
GROUP BY s.balance;

-- ─── 4. Buscar si adjust_student_balance fue llamado por almuerzos ───
-- Revisar si hay transacciones de almuerzo que tengan metadata indicando
-- que tocaron el balance (ej: balance_after, source con "pos" o "balance")
SELECT
  t.id,
  s.full_name,
  t.type,
  t.amount,
  t.payment_status,
  t.description,
  t.created_at,
  t.metadata
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE s.full_name ILIKE '%Bellido%Tirado%'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND (
    t.metadata::text ILIKE '%balance%'
    OR t.metadata::text ILIKE '%adjust%'
    OR t.metadata::text ILIKE '%pos%'
    OR t.metadata::text ILIKE '%saldo%'
  )
ORDER BY t.created_at;

-- ─── 5. Historial de cambios de balance (audit log si existe) ────────
-- Buscar en billing_audit_log si registra cambios de balance
SELECT *
FROM billing_audit_log
WHERE table_name = 'students'
  AND (record_id::text = '273edace-ce52-4b76-95cf-5f3492368ada'
    OR record_id::text = 'bc6af3c3-398c-4f3f-864e-a219a74d494a')
ORDER BY created_at DESC
LIMIT 50;

-- ─── 6. ¿Hay otros alumnos con el mismo patrón? ─────────────────────
-- Buscar alumnos cuyo balance no coincide con sus transacciones
-- (limitado a los que tienen almuerzos pagados para no ser masivo)
WITH balance_check AS (
  SELECT
    s.id,
    s.full_name,
    s.balance AS balance_actual,
    COALESCE(SUM(CASE WHEN t.type IN ('recharge', 'refund') AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount ELSE 0 END), 0) AS balance_correcto,
    COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NOT NULL THEN t.amount ELSE 0 END), 0) AS total_almuerzo_pendiente
  FROM students s
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance
)
SELECT
  full_name,
  balance_actual,
  balance_correcto,
  total_almuerzo_pendiente,
  balance_actual - balance_correcto AS discrepancia,
  CASE
    WHEN ABS(balance_actual - balance_correcto) < 0.01 THEN '✅ OK'
    WHEN ABS(balance_actual - balance_correcto - total_almuerzo_pendiente) < 0.01 THEN '🔴 BALANCE CONTAMINADO POR ALMUERZOS'
    ELSE '⚠️ DISCREPANCIA DESCONOCIDA'
  END AS diagnostico
FROM balance_check
WHERE ABS(balance_actual - balance_correcto) > 0.01
ORDER BY ABS(balance_actual - balance_correcto) DESC;
