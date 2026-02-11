-- =====================================================
-- DETECCIÓN INTELIGENTE: TRANSACCIONES REALES vs FALSAS
-- =====================================================
-- Fecha: 2026-02-10
-- Propósito: Detectar automáticamente cuáles transacciones 
-- son reales y cuáles son errores del sistema
-- =====================================================

-- PASO 1: CLASIFICAR CADA TRANSACCIÓN PENDIENTE
-- Criterios para determinar si es REAL:
-- ✅ REAL: Tiene un lunch_order asociado (por teacher_id + fecha similar)
-- ✅ REAL: Tiene created_by (alguien la creó manualmente)
-- ✅ REAL: Es una venta manual (manual_client_name no es null)
-- ❌ FALSA: No tiene lunch_order, no tiene created_by, y es tipo "Almuerzo"
-- ❓ REVISAR: No tiene lunch_order pero tiene created_by

SELECT 
    p.full_name as profesor,
    s.name as sede,
    t.id as transaction_id,
    t.created_at as fecha_creacion,
    t.amount as monto,
    t.description,
    t.created_by,
    CASE 
        -- Tiene lunch_order que coincide
        WHEN EXISTS (
            SELECT 1 FROM lunch_orders lo
            WHERE lo.teacher_id = t.teacher_id
              AND ABS(EXTRACT(EPOCH FROM (lo.created_at - t.created_at))) < 86400 -- Dentro de 24 horas
        ) THEN '✅ REAL - Tiene pedido de almuerzo'
        
        -- Tiene lunch_order por fecha en descripción
        WHEN EXISTS (
            SELECT 1 FROM lunch_orders lo
            WHERE lo.teacher_id = t.teacher_id
              AND t.description ILIKE '%' || to_char(lo.order_date, 'DD') || '%' || 
                  CASE extract(month from lo.order_date)
                      WHEN 2 THEN 'febrero'
                  END || '%'
        ) THEN '✅ REAL - Coincide con pedido por fecha'
        
        -- Fue creado por el profesor mismo
        WHEN t.created_by = t.teacher_id THEN '✅ REAL - Creado por el profesor'
        
        -- Fue creado por un administrador/cajero (no es el profesor)
        WHEN t.created_by IS NOT NULL AND t.created_by != t.teacher_id THEN '⚠️ REVISAR - Creado por admin'
        
        -- No tiene lunch_order, no tiene created_by, pero dice "Almuerzo"
        WHEN t.created_by IS NULL AND t.description ILIKE '%almuerzo%' THEN '❌ SOSPECHOSA - Sin pedido ni creador'
        
        -- Otro caso
        ELSE '❓ DESCONOCIDA'
    END as clasificacion
FROM transactions t
JOIN profiles p ON t.teacher_id = p.id
JOIN schools s ON p.school_id = s.id
WHERE t.payment_status = 'pending'
  AND t.type = 'purchase'
  AND t.teacher_id IS NOT NULL
ORDER BY 
    CASE 
        WHEN t.created_by IS NULL AND NOT EXISTS (
            SELECT 1 FROM lunch_orders lo
            WHERE lo.teacher_id = t.teacher_id
              AND ABS(EXTRACT(EPOCH FROM (lo.created_at - t.created_at))) < 86400
        ) THEN 0  -- Sospechosas primero
        ELSE 1
    END,
    s.name, p.full_name, t.created_at;

-- PASO 2: RESUMEN POR CLASIFICACIÓN
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM lunch_orders lo
            WHERE lo.teacher_id = t.teacher_id
              AND (
                  ABS(EXTRACT(EPOCH FROM (lo.created_at - t.created_at))) < 86400
                  OR t.description ILIKE '%' || to_char(lo.order_date, 'DD') || '%febrero%'
              )
        ) THEN '✅ REAL - Tiene pedido'
        WHEN t.created_by = t.teacher_id THEN '✅ REAL - Creado por profesor'
        WHEN t.created_by IS NOT NULL AND t.created_by != t.teacher_id THEN '⚠️ REVISAR - Creado por admin'
        WHEN t.created_by IS NULL AND t.description ILIKE '%almuerzo%' THEN '❌ SOSPECHOSA'
        ELSE '❓ DESCONOCIDA'
    END as clasificacion,
    COUNT(*) as cantidad,
    SUM(ABS(t.amount)) as monto_total
FROM transactions t
WHERE t.payment_status = 'pending'
  AND t.type = 'purchase'
  AND t.teacher_id IS NOT NULL
GROUP BY 1
ORDER BY 1;

-- PASO 3: VER SOLO LAS SOSPECHOSAS (las que probablemente hay que eliminar)
-- Son transacciones que:
-- 1. No tienen created_by (nadie las creó)
-- 2. No tienen lunch_order asociado
-- 3. Dicen "Almuerzo" en la descripción
SELECT 
    p.full_name as profesor,
    s.name as sede,
    t.id as transaction_id,
    t.created_at as fecha_creacion,
    t.amount as monto,
    t.description
FROM transactions t
JOIN profiles p ON t.teacher_id = p.id
JOIN schools s ON p.school_id = s.id
WHERE t.payment_status = 'pending'
  AND t.type = 'purchase'
  AND t.teacher_id IS NOT NULL
  AND t.created_by IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM lunch_orders lo
      WHERE lo.teacher_id = t.teacher_id
        AND (
            ABS(EXTRACT(EPOCH FROM (lo.created_at - t.created_at))) < 86400
            OR t.description ILIKE '%' || to_char(lo.order_date, 'DD') || '%febrero%'
        )
  )
ORDER BY s.name, p.full_name, t.created_at;

-- PASO 4: CONTAR SOSPECHOSAS POR SEDE
  