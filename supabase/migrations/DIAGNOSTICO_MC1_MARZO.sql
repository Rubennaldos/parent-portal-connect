-- =====================================================================
-- DIAGNÓSTICO: Maristas Champagnat 1 (MC1) — TODO MARZO 2026
-- school_id = 9963c14c-22ff-4fcb-b5cc-599596896daa
-- =====================================================================

-- ──────────────────────────────────────────────────────────────────────
-- CONSULTA 1: Menús de marzo creados para MC1
-- ──────────────────────────────────────────────────────────────────────
SELECT 
    lm.id          AS menu_id,
    lm.date,
    lm.starter     AS entrada,
    lm.main_course AS segundo,
    lm.dessert     AS postre,
    lm.beverage    AS bebida,
    lm.notes,
    COALESCE(lc.name, 'Sin categoría') AS categoria
FROM lunch_menus lm
LEFT JOIN lunch_categories lc ON lm.category_id = lc.id
WHERE lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND lm.date BETWEEN '2026-03-01' AND '2026-03-31'
ORDER BY lm.date, lc.name;

-- ──────────────────────────────────────────────────────────────────────
-- CONSULTA 2: Pedidos de MC1 en todo marzo
-- ──────────────────────────────────────────────────────────────────────
SELECT 
    lo.id           AS order_id,
    lo.order_date,
    lo.status       AS estado_pedido,
    lo.quantity,
    lo.final_price,
    COALESCE(st.full_name, tp.full_name, lo.manual_name) AS cliente,
    CASE 
        WHEN lo.student_id IS NOT NULL THEN 'Alumno'
        WHEN lo.teacher_id IS NOT NULL THEN 'Profesor'
        ELSE 'Manual'
    END              AS tipo_cliente,
    COALESCE(lc.name, 'Sin categoría') AS categoria,
    lm.main_course   AS segundo_del_menu
FROM lunch_orders lo
JOIN lunch_menus lm            ON lo.menu_id     = lm.id
LEFT JOIN lunch_categories lc  ON lm.category_id = lc.id
LEFT JOIN students st          ON lo.student_id  = st.id
LEFT JOIN teacher_profiles tp  ON lo.teacher_id  = tp.id
WHERE lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND lo.order_date BETWEEN '2026-03-01' AND '2026-03-31'
ORDER BY lo.order_date, cliente;

-- ──────────────────────────────────────────────────────────────────────
-- CONSULTA 3: Estado de pago de cada pedido
-- ──────────────────────────────────────────────────────────────────────
SELECT 
    lo.id            AS order_id,
    lo.order_date,
    COALESCE(st.full_name, tp.full_name, lo.manual_name) AS cliente,
    COALESCE(lc.name, 'Sin categoría') AS categoria,
    lo.status        AS estado_pedido,
    t.payment_status AS estado_pago,
    t.amount         AS monto,
    t.payment_method AS metodo_pago,
    t.ticket_code    AS ticket,
    CASE
        WHEN t.payment_status = 'paid'    THEN '✅ PAGADO'
        WHEN t.payment_status = 'pending' THEN '⏳ PENDIENTE'
        ELSE '❌ SIN TRANSACCIÓN'
    END AS resumen_pago
FROM lunch_orders lo
JOIN lunch_menus lm            ON lo.menu_id     = lm.id
LEFT JOIN lunch_categories lc  ON lm.category_id = lc.id
LEFT JOIN students st          ON lo.student_id  = st.id
LEFT JOIN teacher_profiles tp  ON lo.teacher_id  = tp.id
LEFT JOIN transactions t       ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND lo.order_date BETWEEN '2026-03-01' AND '2026-03-31'
ORDER BY lo.order_date, cliente;

-- ──────────────────────────────────────────────────────────────────────
-- CONSULTA 4: TOTALES del mes por categoría
-- ──────────────────────────────────────────────────────────────────────
SELECT 
    COALESCE(lc.name, 'Sin categoría')                              AS categoria,
    COUNT(DISTINCT lm.id)                                           AS menus_creados,
    COUNT(DISTINCT lo.id)                                           AS total_pedidos,
    COUNT(DISTINCT CASE WHEN t.payment_status = 'paid'    THEN lo.id END) AS pagados,
    COUNT(DISTINCT CASE WHEN t.payment_status = 'pending' THEN lo.id END) AS pendientes,
    COUNT(DISTINCT CASE WHEN t.id IS NULL                 THEN lo.id END) AS sin_transaccion,
    COALESCE(SUM(ABS(t.amount)), 0)                                 AS monto_total_S
FROM lunch_menus lm
LEFT JOIN lunch_categories lc  ON lm.category_id = lc.id
LEFT JOIN lunch_orders lo      ON lo.menu_id    = lm.id
                               AND lo.order_date BETWEEN '2026-03-01' AND '2026-03-31'
LEFT JOIN transactions t       ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND lm.date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY lc.name
ORDER BY total_pedidos DESC;
