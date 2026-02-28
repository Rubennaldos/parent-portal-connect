-- Obtener nombre del alumno + nombre del padre/madre + teléfono
-- La tabla es parent_profiles y se une por student.parent_id = parent_profiles.user_id

SELECT DISTINCT
  st.full_name                        AS alumno,
  pp.full_name                        AS padre_o_madre,
  pp.phone_1                          AS telefono_1,
  pp.phone_2                          AS telefono_2,
  lo.order_date,
  lc.name                             AS categoria,
  t.payment_status                    AS estado_pago,
  t.amount                            AS monto
FROM lunch_orders lo
JOIN lunch_menus lm          ON lo.menu_id      = lm.id
JOIN lunch_categories lc     ON lm.category_id  = lc.id
JOIN students st              ON lo.student_id   = st.id
LEFT JOIN parent_profiles pp  ON st.parent_id    = pp.user_id
LEFT JOIN transactions t      ON (t.metadata->>'lunch_order_id')::text = lo.id::text
WHERE lm.category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',  -- Almuerzo Light de Pescado
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'   -- Almuerzo Light de Pollo
)
AND lo.order_date >= '2026-03-09'
AND lo.is_cancelled = false
ORDER BY st.full_name, lo.order_date;
