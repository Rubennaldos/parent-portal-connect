-- =====================================================================
-- DIAGNÓSTICO: Por qué un padre no ve la deuda del mes completo
-- =====================================================================
-- INSTRUCCIONES:
--   1. Abre el SQL Editor en Supabase Dashboard
--   2. Copia y pega CADA BLOQUE por separado
--   3. Reemplaza [PARENT_UUID] con el UUID real del padre (de la tabla profiles)
--   4. Comparte los resultados para entender el problema
-- =====================================================================


-- ── BLOQUE 0: Buscar el UUID del padre por nombre o teléfono ────────
-- Corre este primero para encontrar el UUID. Cambia el texto de búsqueda.
SELECT
  pp.user_id      AS parent_uuid,   -- ← este UUID úsalo en los bloques siguientes
  pp.full_name    AS nombre_padre,
  pp.phone_1      AS telefono,
  p.email         AS email
FROM parent_profiles pp
LEFT JOIN profiles p ON p.id = pp.user_id
WHERE pp.full_name ILIKE '%Torres%'   -- ← cambia por el nombre del padre
   OR pp.phone_1 LIKE '%999%'         -- ← o busca por teléfono
ORDER BY pp.full_name;


-- ── BLOQUE 1: ¿Quiénes son los hijos de Carla Torres? ───────────────
SELECT
  s.id              AS student_id,
  s.full_name       AS nombre,
  sc.name           AS sede,
  s.balance         AS saldo_kiosco,
  s.wallet_balance  AS saldo_billetera,
  s.is_active
FROM students s
LEFT JOIN schools sc ON sc.id = s.school_id
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15';


-- ── BLOQUE 2: Pedidos de Benjamín Torres (payment_method es clave) ──
-- Para aparecer como deuda debe ser payment_method = 'pagar_luego'
SELECT
  lo.id           AS order_id,
  lo.order_date,
  lo.status,
  lo.payment_method,
  lo.is_cancelled,
  lo.quantity,
  lc.name         AS categoria
FROM lunch_orders lo
JOIN students     s  ON s.id  = lo.student_id
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15'
  AND lo.is_cancelled = false
ORDER BY lo.order_date DESC
LIMIT 100;


-- ── BLOQUE 3: ¿Cuáles tienen transacción registrada? ────────────────
-- Si existe tx con payment_status IN ('pending','partial','paid')
-- ese pedido NO aparece como deuda virtual (ya está registrado)
SELECT
  lo.id            AS order_id,
  lo.order_date,
  lo.status        AS estado_pedido,
  lo.payment_method,
  t.id             AS tx_id,
  t.payment_status AS tx_status,
  t.amount         AS tx_monto,
  t.created_at     AS tx_fecha
FROM lunch_orders lo
JOIN students     s  ON s.id  = lo.student_id
LEFT JOIN transactions t
  ON (t.metadata->>'lunch_order_id') = lo.id::text
  AND t.is_deleted = false
  AND t.payment_status IN ('pending', 'partial', 'paid')
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15'
  AND lo.is_cancelled = false
ORDER BY lo.order_date DESC
LIMIT 100;


-- ── BLOQUE 4: ¿Qué deuda VE Carla Torres en su portal ahora? ────────
SELECT
  vsd.deuda_id,
  vsd.monto,
  vsd.descripcion,
  vsd.fuente,
  vsd.es_almuerzo,
  vsd.fecha
FROM view_student_debts vsd
JOIN students s ON s.id = vsd.student_id
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15'
ORDER BY vsd.fecha DESC;


-- ── BLOQUE 5: Resumen de deuda por alumno ───────────────────────────
SELECT
  s.full_name     AS alumno,
  SUM(CASE WHEN NOT vsd.es_almuerzo THEN vsd.monto ELSE 0 END) AS deuda_kiosco,
  SUM(CASE WHEN vsd.es_almuerzo     THEN vsd.monto ELSE 0 END) AS deuda_almuerzos,
  SUM(vsd.monto)  AS deuda_total
FROM view_student_debts vsd
JOIN students s ON s.id = vsd.student_id
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15'
GROUP BY s.full_name;


-- ── BLOQUE 6: ¿De dónde viene el S/ 182 a favor? ────────────────────
-- Revisa wallet_balance (billetera interna) y balance (saldo kiosco)
SELECT
  s.full_name         AS alumno,
  s.balance           AS saldo_kiosco,
  s.wallet_balance    AS saldo_billetera_favor,
  s.balance + s.wallet_balance AS total_a_favor
FROM students s
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15';

-- ── BLOQUE 7: Movimientos de la billetera interna (saldo a favor) ───
SELECT
  wt.id,
  wt.type,
  wt.amount,
  wt.description,
  wt.created_at,
  s.full_name AS alumno
FROM wallet_transactions wt
JOIN students s ON s.id = wt.student_id
WHERE s.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15'
ORDER BY wt.created_at DESC
LIMIT 50;

-- ── BLOQUE 8: Pagos aprobados de Carla Torres ────────────────────────
-- ¿Cuánto pagó en total y qué se aprobó?
SELECT
  rr.id,
  rr.amount,
  rr.request_type,
  rr.status,
  rr.payment_method,
  rr.reference_code,
  rr.approved_at,
  rr.description,
  s.full_name AS alumno
FROM recharge_requests rr
JOIN students s ON s.id = rr.student_id
WHERE rr.parent_id = 'b91d0674-0727-4e5e-8309-e00bd2ba6e15'
ORDER BY rr.created_at DESC
LIMIT 30;


-- ── RESUMEN DEL DIAGNÓSTICO ─────────────────────────────────────────
-- Si en BLOQUE 2 aparecen pedidos con payment_method != 'pagar_luego':
--   → No aparecen como deuda. Hay que corregir el payment_method.
--
-- Si en BLOQUE 3 aparecen transacciones para pedidos que NO deberian estar pagados:
--   → Se crearon transacciones incorrectas (falsa aprobación de pago).
--
-- Si en BLOQUE 4 no aparece ninguna deuda:
--   → Los pedidos tienen transacciones que los "cancelan" de la vista,
--     o el payment_method no es 'pagar_luego'.
-- =====================================================================
