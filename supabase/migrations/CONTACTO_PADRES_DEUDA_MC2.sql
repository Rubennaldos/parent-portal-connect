-- =====================================================================
-- CONTACTO DE PADRES: Alumnos con deuda pendiente en MC2
-- Categorías: "Menú Alumnos Opción 1" y "Menú Alumno Opción 2"
-- Objetivo: Obtener datos de contacto para llamar y cobrar
-- =====================================================================

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA PRINCIPAL: Datos de contacto de padres con deuda pendiente
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  -- Información del Alumno
  st.full_name AS alumno,
  st.grade AS grado,
  st.section AS seccion,
  
  -- Información del Padre/Madre Principal
  pp.full_name AS padre_madre_principal,
  pp.phone_1 AS telefono_principal,
  pp.phone_2 AS telefono_secundario,
  pp.dni AS dni_padre,
  pp.email AS email_padre,
  
  -- Información del Segundo Responsable (si existe)
  pp.responsible_2_full_name AS segundo_responsable,
  pp.responsible_2_phone_1 AS telefono_segundo_responsable,
  pp.responsible_2_dni AS dni_segundo_responsable,
  pp.responsible_2_email AS email_segundo_responsable,
  
  -- Resumen de Deuda
  COUNT(DISTINCT lo.id) AS cantidad_pedidos_pendientes,
  SUM(lo.final_price) AS monto_total_adeudado,
  MIN(lo.order_date) AS primer_pedido,
  MAX(lo.order_date) AS ultimo_pedido,
  
  -- Categorías involucradas
  STRING_AGG(DISTINCT lc.name, ', ') AS categorias
  
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
JOIN students st ON lo.student_id = st.id
LEFT JOIN parent_profiles pp ON st.parent_id = pp.user_id
LEFT JOIN transactions t ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE 
  -- Solo categorías de Menú Alumnos en MC2
  (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
  AND s.name = 'Maristas Champagnat 2'
  -- Solo pedidos pendientes (no cancelados y sin pago)
  AND lo.status != 'cancelled'
  AND lo.is_cancelled = false
  AND (t.payment_status = 'pending' OR t.id IS NULL)
GROUP BY 
  st.id,
  st.full_name,
  st.grade,
  st.section,
  pp.full_name,
  pp.phone_1,
  pp.phone_2,
  pp.dni,
  pp.email,
  pp.responsible_2_full_name,
  pp.responsible_2_phone_1,
  pp.responsible_2_dni,
  pp.responsible_2_email
ORDER BY 
  monto_total_adeudado DESC,
  alumno;

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA ALTERNATIVA: Lista simple para WhatsApp/llamadas
-- (Solo muestra: Alumno, Padre, Teléfono principal, Deuda)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  st.full_name AS alumno,
  pp.full_name AS padre_madre,
  COALESCE(pp.phone_1, pp.responsible_2_phone_1, 'SIN TELÉFONO') AS telefono,
  COUNT(DISTINCT lo.id) AS pedidos_pendientes,
  SUM(lo.final_price) AS deuda_total
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
JOIN students st ON lo.student_id = st.id
LEFT JOIN parent_profiles pp ON st.parent_id = pp.user_id
LEFT JOIN transactions t ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE 
  (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
  AND s.name = 'Maristas Champagnat 2'
  AND lo.status != 'cancelled'
  AND lo.is_cancelled = false
  AND (t.payment_status = 'pending' OR t.id IS NULL)
GROUP BY 
  st.id,
  st.full_name,
  pp.full_name,
  pp.phone_1,
  pp.responsible_2_phone_1
ORDER BY 
  deuda_total DESC;

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA DETALLADA: Pedidos individuales con datos de contacto
-- (Para ver cada pedido pendiente con su fecha y contacto)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  lo.order_date AS fecha_pedido,
  st.full_name AS alumno,
  st.grade AS grado,
  st.section AS seccion,
  lc.name AS categoria,
  lo.final_price AS monto,
  pp.full_name AS padre_madre,
  COALESCE(pp.phone_1, pp.responsible_2_phone_1, 'SIN TELÉFONO') AS telefono,
  pp.responsible_2_full_name AS segundo_responsable,
  pp.responsible_2_phone_1 AS telefono_segundo,
  lo.id AS order_id
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
JOIN students st ON lo.student_id = st.id
LEFT JOIN parent_profiles pp ON st.parent_id = pp.user_id
LEFT JOIN transactions t ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE 
  (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
  AND s.name = 'Maristas Champagnat 2'
  AND lo.status != 'cancelled'
  AND lo.is_cancelled = false
  AND (t.payment_status = 'pending' OR t.id IS NULL)
ORDER BY 
  pp.full_name,
  lo.order_date;
