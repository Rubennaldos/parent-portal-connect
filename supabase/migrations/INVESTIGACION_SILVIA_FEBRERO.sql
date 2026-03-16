-- INVESTIGACIÓN COMPLETA: Silvia Kcomt y febrero
-- Teacher ID: 4aac52c0-6640-4b27-a2b6-96e0ef20d57a

-- 1. TODAS las transacciones de Silvia (sin filtro de payment_status ni is_deleted)
--    Para ver si hay algo cancelado, borrado, de febrero
SELECT
  t.ticket_code,
  t.amount,
  t.payment_status,
  t.type,
  t.is_deleted,
  t.description,
  DATE(t.created_at) AS fecha
FROM transactions t
WHERE t.teacher_id = '4aac52c0-6640-4b27-a2b6-96e0ef20d57a'
ORDER BY t.created_at;

-- 2. También buscar en lunch_orders por teacher_id en febrero
SELECT
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  lc.name AS categoria
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.teacher_id = '4aac52c0-6640-4b27-a2b6-96e0ef20d57a'
ORDER BY lo.order_date;

-- 3. ¿Existe alguna transacción con su NOMBRE en description o manual_client_name?
SELECT
  t.ticket_code,
  t.amount,
  t.payment_status,
  t.is_deleted,
  t.description,
  t.manual_client_name,
  DATE(t.created_at) AS fecha
FROM transactions t
WHERE (
  LOWER(t.description) ILIKE '%kcomt%'
  OR LOWER(t.manual_client_name) ILIKE '%kcomt%'
)
ORDER BY t.created_at;


-- 4. Fecha de creación de su cuenta (teacher_profile)
SELECT
  id,
  full_name,
  created_at AS cuenta_creada_el,
  onboarding_completed
FROM teacher_profiles
WHERE id = '4aac52c0-6640-4b27-a2b6-96e0ef20d57a';


-- =============================================================================
-- CONCLUSIÓN (con resultados ejecutados)
-- =============================================================================
-- Cuenta de Silvia (teacher_profile): creada el 2026-03-03 17:53:39 UTC.
-- onboarding_completed: true.
--
-- Transacciones con su teacher_id: NO aparecen de febrero; todas son de MARZO:
--   - Almuerzos (T-SK-000001 a 007, T-AN-001275): 4 al 13 de marzo, pending.
--   - Compras profesor (T-AN-001317, T-AN-001495): 10 y 12 marzo, -7.50 y -8.50, pending.
--
-- lunch_orders: pedidos 4 al 13 de marzo (Menú del día / Menú Light), confirmed/delivered.
--
-- Conclusión: La deuda que ve Cobranzas para Silvia es de MARZO, no de febrero
-- (o la de febrero estaba en otro teacher_id / "Sin Cuenta"). Su cuenta se creó
-- el 3 de marzo; las primeras transacciones son del mismo día (almuerzos 4, 5, 6).
-- Útil para soporte: misma semana cuenta creada = primera deuda registrada.
-- =============================================================================


-- =============================================================================
-- CUENTA ANTERIOR BORRADA (mismo correo) — ¿Hay rastros de esa cuenta?
-- Si había otra cuenta con el mismo correo y se borró, el teacher_profile
-- desaparece (CASCADE) pero las transacciones y lunch_orders pueden seguir
-- con el teacher_id viejo (huérfano). Aquí buscamos eso.
-- =============================================================================

-- 5. teacher_id HUÉRFANOS: IDs que aparecen en transacciones o pedidos pero ya
--    no existen en teacher_profiles (cuentas borradas).
SELECT
  t.teacher_id AS id_cuenta_borrada,
  'transacciones' AS origen,
  COUNT(*) AS cantidad,
  MIN(DATE(t.created_at)) AS desde,
  MAX(DATE(t.created_at)) AS hasta,
  SUM(ABS(t.amount)) AS total_monto
FROM transactions t
WHERE t.teacher_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = t.teacher_id)
GROUP BY t.teacher_id
UNION ALL
SELECT
  lo.teacher_id,
  'lunch_orders',
  COUNT(*),
  MIN(lo.order_date)::date,
  MAX(lo.order_date)::date,
  SUM(lo.final_price)
FROM lunch_orders lo
WHERE lo.teacher_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = lo.teacher_id)
GROUP BY lo.teacher_id
ORDER BY hasta DESC;


-- 6. Transacciones de cuentas borradas que podrían ser Silvia (por nombre o almuerzo)
--    Revisar si algún teacher_id huérfano tiene description con "Silvia"/"kcomt"/"Almuerzo"
SELECT
  t.teacher_id AS id_cuenta_borrada,
  t.ticket_code,
  t.amount,
  t.payment_status,
  t.description,
  DATE(t.created_at) AS fecha
FROM transactions t
WHERE t.teacher_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = t.teacher_id)
  AND (
    LOWER(t.description) ILIKE '%silvia%'
    OR LOWER(t.description) ILIKE '%kcomt%'
    OR LOWER(t.description) ILIKE '%almuerzo%'
    OR LOWER(COALESCE(t.manual_client_name, '')) ILIKE '%kcomt%'
  )
ORDER BY t.created_at;


-- 7. Lunch orders de cuentas borradas (cualquier teacher_id huérfano)
--    Si la cuenta anterior de Silvia tenía almuerzos, aquí podrían salir.
SELECT
  lo.teacher_id AS id_cuenta_borrada,
  lo.id AS order_id,
  lo.order_date,
  lo.status,
  lo.final_price,
  lc.name AS categoria
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.teacher_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = lo.teacher_id)
ORDER BY lo.order_date DESC;


-- 8. (Opcional) Si sabes el correo de Silvia: buscar en auth y profiles
--    A veces el usuario se “desactiva” y no se borra. Reemplaza EL_CORREO.
-- SELECT id, email, created_at, deleted_at
-- FROM auth.users WHERE email = 'EL_CORREO@...';
-- SELECT id, email, role, full_name FROM profiles WHERE email = 'EL_CORREO@...';
