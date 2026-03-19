-- ============================================================
-- FICHA COMPLETA DEL CASO: Duplicado Renzo Guardia
-- Todo lo que necesita saber la dueña
-- ============================================================

-- ── 1. ¿De qué sede es el alumno? ────────────────────────────
SELECT
  s.full_name       AS alumno,
  s.grade,
  s.section,
  sc.name           AS sede,
  sc.address        AS direccion_sede
FROM students s
JOIN schools sc ON sc.id = s.school_id
WHERE s.id = '48f287ce-737a-4598-a0fb-20b22d522159';


-- ── 2. ¿Quién aprobó los dos vouchers? ───────────────────────
SELECT
  p.full_name       AS admin_que_aprobo,
  p.email           AS email_admin,
  p.role            AS rol,
  sc.name           AS sede_del_admin,
  rr.id             AS recharge_request_id,
  rr.amount,
  rr.reference_code,
  rr.created_at     AS voucher_creado,
  rr.approved_at    AS voucher_aprobado
FROM recharge_requests rr
JOIN profiles p  ON p.id  = rr.approved_by
JOIN schools  sc ON sc.id = p.school_id
WHERE rr.reference_code = '69579347'
  AND rr.status = 'approved'
ORDER BY rr.approved_at;


-- ── 3. ¿Cuántos almuerzos quedaron marcados como pagados
--       por cada voucher? ────────────────────────────────────
SELECT
  rr.id             AS recharge_request_id,
  rr.approved_at,
  COUNT(t.id)       AS almuerzos_pagados,
  SUM(ABS(t.amount)) AS total_marcado_pagado
FROM recharge_requests rr
JOIN transactions t
  ON t.metadata->>'recharge_request_id' = rr.id::text
WHERE rr.reference_code = '69579347'
  AND rr.status = 'approved'
GROUP BY rr.id, rr.approved_at
ORDER BY rr.approved_at;


-- ── 4. ¿Los almuerzos pagados por cada voucher se solapan?
--       (si aparece el mismo lunch_order_id en ambos = doble cobro)
SELECT
  t.metadata->>'lunch_order_id'  AS lunch_order_id,
  t.metadata->>'order_date'      AS fecha_almuerzo,
  t.metadata->>'recharge_request_id' AS voucher_origen,
  t.amount,
  t.payment_status
FROM transactions t
WHERE t.metadata->>'recharge_request_id' IN (
  'fab60ac1-8d3a-43e1-9552-e9a90d75766a',
  'f0ba3779-d51f-4b9a-b5c0-fc6492cb7e05'
)
ORDER BY t.metadata->>'order_date', t.metadata->>'recharge_request_id';


-- ── 5. ¿Cuánto dinero total se marcó como cobrado a este padre?
SELECT
  SUM(rr.amount)    AS total_cobrado_segun_sistema,
  COUNT(*)          AS cantidad_vouchers_aprobados
FROM recharge_requests rr
WHERE rr.reference_code = '69579347'
  AND rr.status = 'approved';
