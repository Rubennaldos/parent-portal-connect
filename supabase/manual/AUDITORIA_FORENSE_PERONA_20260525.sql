-- ============================================================================
-- AUDITORÍA FORENSE — Paula y Diego Perona Quispe (SOLO LECTURA)
-- Proyecto: duxqzozoahvrvqseinji (Lima Cafe 28)
-- Fecha caso: 2026-05-25
-- Referencias operativas del ticket: 00309260, 00287362
--            T-OR-000851, T-CAD-005497, T-CAD-004290, T-CAD-003655, T-KAQ-000002
--
-- ⚠️ NO ejecutar UPDATE/DELETE desde este archivo sin aprobación explícita.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) CONTEXTO FAMILIAR (padre + hijos)
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  s.id,
  s.full_name,
  s.grade,
  s.section,
  s.school_id,
  sc.name AS sede,
  s.parent_id,
  p.email AS padre_email,
  s.balance AS saldo_deuda_pendiente_ssot,
  s.wallet_balance AS billetera_virtual,
  s.is_active,
  s.created_at
FROM public.students s
LEFT JOIN public.schools sc ON sc.id = s.school_id
LEFT JOIN public.profiles p ON p.id = s.parent_id
WHERE s.full_name ILIKE '%Perona%'
ORDER BY s.full_name;

-- Si la tabla legacy alumnos existe en tu entorno, comparar (opcional):
-- SELECT id, nombres, grado, seccion, saldo_actual, padre_id
-- FROM public.alumnos WHERE nombres ILIKE '%Perona%';


-- ────────────────────────────────────────────────────────────────────────────
-- 1) IDENTIFICACIÓN Y ESTADO (equivalente al punto 1 solicitado)
-- Nota: el esquema real usa students.full_name y students.balance
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  s.id,
  s.full_name AS nombre,
  s.school_id,
  s.grade,
  s.section,
  s.balance AS current_wallet_balance_legacy_name,
  s.wallet_balance,
  s.free_account,
  s.kiosk_disabled
FROM public.students s
WHERE s.full_name ILIKE '%Perona%'
ORDER BY s.full_name;


-- ────────────────────────────────────────────────────────────────────────────
-- 2) PEDIDOS DE ALMUERZO (lunch_orders) — hoy, mañana y recientes
-- ────────────────────────────────────────────────────────────────────────────
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
)
SELECT
  lo.id,
  lo.student_id,
  s.full_name AS alumno,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  lo.quantity,
  lo.created_at,
  lc.name AS categoria,
  lm.main_course AS plato_principal,
  lo.parent_notes,
  lo.school_id
FROM public.lunch_orders lo
JOIN perona p ON p.id = lo.student_id
JOIN public.students s ON s.id = lo.student_id
LEFT JOIN public.lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lo.order_date >= (CURRENT_DATE - INTERVAL '14 days')
ORDER BY lo.order_date DESC, lo.created_at DESC;


-- Pedidos del lunes 26/05/2026 (mañana respecto al 25/05) — cocina
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
)
SELECT
  lo.id,
  s.full_name,
  lo.order_date,
  lo.status,
  lm.main_course,
  lm.starter,
  lm.beverage
FROM public.lunch_orders lo
JOIN perona p ON p.id = lo.student_id
JOIN public.students s ON s.id = lo.student_id
LEFT JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lo.order_date IN (DATE '2026-05-25', DATE '2026-05-26')
  AND lo.is_cancelled = false
ORDER BY lo.order_date, s.full_name;


-- ────────────────────────────────────────────────────────────────────────────
-- 3) TRANSACCIONES (transactions) — compras, recargas, uso billetera
-- ────────────────────────────────────────────────────────────────────────────
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
)
SELECT
  t.id AS tx_id,
  t.student_id,
  s.full_name AS alumno,
  t.type,
  t.payment_status,
  t.payment_method,
  t.amount,
  t.description,
  t.ticket_code,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'payment_source' AS payment_source,
  t.metadata->>'recharge_request_id' AS recharge_request_id,
  t.metadata->>'reference_code' AS reference_code_meta,
  t.balance_after,
  t.created_at,
  t.is_deleted
FROM public.transactions t
JOIN perona p ON p.id = t.student_id
JOIN public.students s ON s.id = t.student_id
WHERE COALESCE(t.is_deleted, false) = false
  AND t.type IN ('purchase', 'recharge', 'wallet_usage', 'charge', 'adjustment')
ORDER BY t.created_at DESC;


-- Tickets específicos del caso (captura de pantalla)
SELECT
  t.id,
  t.ticket_code,
  t.payment_status,
  t.amount,
  t.description,
  t.metadata,
  t.created_at
FROM public.transactions t
WHERE t.ticket_code IN (
  'T-OR-000851',
  'T-CAD-005497',
  'T-CAD-004290',
  'T-CAD-003655',
  'T-KAQ-000002'
)
   OR t.id IN (
     SELECT id FROM public.transactions
     WHERE student_id IN (SELECT id FROM public.students WHERE full_name ILIKE '%Perona%')
   )
ORDER BY t.ticket_code NULLS LAST, t.created_at DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- 4) VOUCHERS / COBRANZAS (recharge_requests + auditoria_vouchers)
-- ────────────────────────────────────────────────────────────────────────────
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
)
SELECT
  rr.id,
  rr.student_id,
  s.full_name,
  rr.request_type,
  rr.status,
  rr.amount,
  rr.expected_amount,
  rr.reference_code,
  rr.payment_method,
  rr.paid_transaction_ids,
  rr.lunch_order_ids,
  rr.approved_at,
  rr.approved_by,
  rr.created_at,
  rr.description
FROM public.recharge_requests rr
LEFT JOIN public.students s ON s.id = rr.student_id
WHERE rr.reference_code IN ('00309260', '00287362')
   OR rr.student_id IN (SELECT id FROM perona)
   OR rr.parent_id IN (
     SELECT parent_id FROM public.students WHERE full_name ILIKE '%Perona%' LIMIT 1
   )
ORDER BY rr.created_at DESC;


SELECT
  av.id,
  av.nro_operacion,
  av.monto_detectado,
  av.id_cobranza,
  av.estado_ia,
  av.creado_at,
  av.actualizado_at,
  av.school_id
FROM public.auditoria_vouchers av
WHERE av.nro_operacion IN ('00309260', '00287362')
ORDER BY av.creado_at DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- 5) CRUCE PEDIDO ↔ TRANSACCIÓN (¿huérfanos o pagados?)
-- ────────────────────────────────────────────────────────────────────────────
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
)
SELECT
  lo.id AS lunch_order_id,
  s.full_name,
  lo.order_date,
  lo.status AS order_status,
  lo.is_cancelled,
  t.id AS tx_id,
  t.ticket_code,
  t.payment_status,
  t.amount AS tx_amount,
  CASE
    WHEN t.id IS NULL THEN 'HUERFANO_SIN_TX'
    WHEN t.payment_status = 'paid' THEN 'CON_TX_PAGADA'
    WHEN t.payment_status IN ('pending','partial') THEN 'CON_TX_PENDIENTE'
    ELSE 'CON_TX_OTRO_ESTADO'
  END AS diagnostico
FROM public.lunch_orders lo
JOIN perona p ON p.id = lo.student_id
JOIN public.students s ON s.id = lo.student_id
LEFT JOIN public.transactions t
  ON t.is_deleted = false
 AND (t.metadata->>'lunch_order_id')::uuid = lo.id
WHERE lo.order_date >= (CURRENT_DATE - INTERVAL '30 days')
  AND lo.is_cancelled = false
ORDER BY lo.order_date DESC, s.full_name;


-- ────────────────────────────────────────────────────────────────────────────
-- 6) RECONCILIACIÓN SSOT (students.balance vs suma pending en transactions)
--    Regla: fn_sync_student_balance usa SUM(amount) pending
-- ────────────────────────────────────────────────────────────────────────────
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
),
calc AS (
  SELECT
    t.student_id,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.payment_status = 'pending' AND COALESCE(t.is_deleted,false) = false
    ), 0) AS suma_pending_calculada,
    COUNT(*) FILTER (
      WHERE t.payment_status = 'pending' AND COALESCE(t.is_deleted,false) = false
    ) AS cant_pending
  FROM public.transactions t
  WHERE t.student_id IN (SELECT id FROM perona)
  GROUP BY t.student_id
)
SELECT
  s.full_name,
  s.balance AS balance_en_students,
  c.suma_pending_calculada,
  ROUND(s.balance - c.suma_pending_calculada, 2) AS diferencia,
  c.cant_pending,
  s.wallet_balance
FROM public.students s
JOIN calc c ON c.student_id = s.id
ORDER BY s.full_name;


-- ────────────────────────────────────────────────────────────────────────────
-- 7) SIMULACIÓN get_parent_debts_v2 (lo que ve el portal padre / cobranzas)
--    Reemplaza :parent_uuid con el parent_id del paso 0
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT * FROM public.get_parent_debts_v2('PARENT_UUID_AQUI'::uuid);


-- ────────────────────────────────────────────────────────────────────────────
-- 8) SOLO DIAGNÓSTICO DE CORRECCIÓN (NO ejecutar en caliente sin "Dale")
--    Paso A: ver qué transacciones quedaron pending pese a voucher approved
-- ────────────────────────────────────────────────────────────────────────────
WITH perona AS (
  SELECT id FROM public.students WHERE full_name ILIKE '%Perona%'
)
SELECT
  t.id,
  t.ticket_code,
  t.payment_status,
  t.amount,
  t.metadata->>'recharge_request_id' AS rr_id,
  rr.status AS rr_status,
  rr.reference_code,
  rr.approved_at
FROM public.transactions t
JOIN perona p ON p.id = t.student_id
LEFT JOIN public.recharge_requests rr
  ON rr.id = (t.metadata->>'recharge_request_id')::uuid
WHERE t.payment_status IN ('pending', 'partial')
  AND COALESCE(t.is_deleted, false) = false
ORDER BY t.created_at;


-- ────────────────────────────────────────────────────────────────────────────
-- 9) PLANTILLA DE CORRECCIÓN (EJECUTAR SOLO TRAS REVISAR PASO 8 Y APROBACIÓN)
--    NO es parte de la auditoría read-only; descomentar bajo responsabilidad.
-- ────────────────────────────────────────────────────────────────────────────
/*
BEGIN;

-- 9.1 Si el voucher está approved pero la tx sigue pending, marcar paid
--     (ajustar IDs según resultado del paso 8)
UPDATE public.transactions t
SET
  payment_status = 'paid',
  payment_method = COALESCE(t.payment_method, 'transferencia'),
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'payment_approved', true,
    'payment_source', 'forensic_manual_fix',
    'fixed_at', NOW()::text
  )
WHERE t.id IN (
  -- pegar aquí los UUID de transactions que debieron saldarse
);

-- 9.2 Confirmar pedidos de almuerzo ligados
UPDATE public.lunch_orders lo
SET status = 'confirmed'
WHERE lo.id IN (
  SELECT (t.metadata->>'lunch_order_id')::uuid
  FROM public.transactions t
  WHERE t.id IN (/* mismos UUID del UPDATE anterior */)
    AND (t.metadata->>'lunch_order_id') IS NOT NULL
)
AND lo.is_cancelled = false
AND lo.status NOT IN ('cancelled');

-- 9.3 Resincronizar saldo SSOT por alumno (único camino permitido)
SELECT public.fn_sync_student_balance(s.id)
FROM public.students s
WHERE s.full_name ILIKE '%Perona%';

COMMIT;
*/
