    -- ============================================
    -- REVERTIR PEDIDOS QUE CAMBIÉ POR ERROR
    -- ============================================
    -- Devolver Jean LeBouch a los pedidos que NO eran de Rubén
    -- ============================================

    -- PASO 1: Ver TODOS los pedidos que cambié de Jean LeBouch → Miraflores
    SELECT 
        lo.id,
        lo.order_date,
        lo.school_id,
        s.name as nombre_escuela,
        COALESCE(st.full_name, tp.full_name, lo.manual_name) as nombre,
        lo.created_at
    FROM lunch_orders lo
    LEFT JOIN schools s ON lo.school_id = s.id
    LEFT JOIN students st ON lo.student_id = st.id
    LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
    WHERE lo.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
    AND lo.order_date = '2026-02-05'
    ORDER BY lo.created_at;

    -- PASO 2: Identificar cuáles SON de Miraflores y cuáles NO
    -- (Los que tengan teacher_id con school_id_1 diferente a Miraflores deben revertirse)
    SELECT 
        lo.id,
        lo.order_date,
        lo.school_id as pedido_school_id,
        tp.school_id_1 as profesor_school_id,
        s1.name as escuela_pedido,
        s2.name as escuela_profesor,
        tp.full_name as profesor
    FROM lunch_orders lo
    LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
    LEFT JOIN schools s1 ON lo.school_id = s1.id
    LEFT JOIN schools s2 ON tp.school_id_1 = s2.id
    WHERE lo.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
    AND lo.order_date = '2026-02-05'
    AND tp.school_id_1 != '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
    ORDER BY lo.created_at;

    -- NO EJECUTAR NADA MÁS HASTA REVISAR LOS RESULTADOS
