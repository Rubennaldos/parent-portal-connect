-- =====================================================
-- LIMPIEZA: TRANSACCIONES HUÉRFANAS (SIN LUNCH ORDER)
-- =====================================================
-- Fecha: 2026-02-10
-- Propósito: Identificar y eliminar transacciones pendientes 
-- que NO tienen un lunch_order correspondiente
-- =====================================================

-- PASO 1: PRIMERO VER cuántas transacciones se van a eliminar (PREVIEW)
-- Transacciones pendientes de profesores que NO tienen lunch_order asociado
WITH teacher_transactions AS (
    SELECT 
        t.id as transaction_id,
        t.teacher_id,
        t.created_at,
        t.amount,
        t.description,
        t.created_by,
        p.full_name as profesor,
        s.name as sede
    FROM transactions t
    JOIN profiles p ON t.teacher_id = p.id
    JOIN schools s ON p.school_id = s.id
    WHERE t.payment_status = 'pending'
      AND t.type = 'purchase'
      AND t.teacher_id IS NOT NULL
),
matching_orders AS (
    -- Buscar lunch_orders que coincidan con cada transacción
    SELECT DISTINCT ON (lo.id)
        lo.id as lunch_order_id,
        lo.teacher_id,
        lo.order_date,
        lo.created_at as order_created_at
    FROM lunch_orders lo
    WHERE lo.teacher_id IS NOT NULL
      AND lo.order_date >= '2026-02-01'
)
SELECT 
    tt.profesor,
    tt.sede,
    tt.transaction_id,
    tt.created_at as fecha_transaccion,
    tt.amount as monto,
    tt.description,
    CASE 
        WHEN tt.created_by IS NULL THEN 'Sistema'
        WHEN tt.created_by = tt.teacher_id THEN 'El profesor'
        ELSE 'Otro usuario'
    END as creado_por,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM lunch_orders lo
            WHERE lo.teacher_id = tt.teacher_id
              AND lo.order_date >= '2026-02-01'
              AND tt.description ILIKE '%' || to_char(lo.order_date, 'DD') || ' de ' || 
                  CASE extract(month from lo.order_date)
                      WHEN 1 THEN 'enero' WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo'
                      WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo' WHEN 6 THEN 'junio'
                      WHEN 7 THEN 'julio' WHEN 8 THEN 'agosto' WHEN 9 THEN 'septiembre'
                      WHEN 10 THEN 'octubre' WHEN 11 THEN 'noviembre' WHEN 12 THEN 'diciembre'
                  END || '%'
        ) THEN '✅ TIENE PEDIDO'
        ELSE '❌ SIN PEDIDO (ELIMINAR)'
    END as estado
FROM teacher_transactions tt
ORDER BY tt.sede, tt.profesor, tt.created_at;

-- PASO 2: CONTAR cuántas se van a eliminar por sede
WITH orphan_transactions AS (
    SELECT 
        t.id,
        t.teacher_id,
        t.description,
        s.name as sede
    FROM transactions t
    JOIN profiles p ON t.teacher_id = p.id
    JOIN schools s ON p.school_id = s.id
    WHERE t.payment_status = 'pending'
      AND t.type = 'purchase'
      AND t.teacher_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM lunch_orders lo
          WHERE lo.teacher_id = t.teacher_id
            AND lo.order_date >= '2026-02-01'
            AND t.description ILIKE '%' || to_char(lo.order_date, 'DD') || ' de ' || 
                CASE extract(month from lo.order_date)
                    WHEN 1 THEN 'enero' WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo'
                    WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo' WHEN 6 THEN 'junio'
                    WHEN 7 THEN 'julio' WHEN 8 THEN 'agosto' WHEN 9 THEN 'septiembre'
                    WHEN 10 THEN 'octubre' WHEN 11 THEN 'noviembre' WHEN 12 THEN 'diciembre'
                END || '%'
      )
)
SELECT 
    sede,
    COUNT(*) as transacciones_a_eliminar,
    SUM(ABS((SELECT amount FROM transactions WHERE id = orphan_transactions.id))) as monto_total
FROM orphan_transactions
GROUP BY sede
ORDER BY COUNT(*) DESC;

-- =====================================================
-- ⚠️ PASO 3: ELIMINAR TRANSACCIONES HUÉRFANAS
-- ⚠️ EJECUTAR SOLO DESPUÉS DE VERIFICAR PASOS 1 Y 2
-- =====================================================
/*
DELETE FROM transactions
WHERE id IN (
    SELECT t.id
    FROM transactions t
    JOIN profiles p ON t.teacher_id = p.id
    WHERE t.payment_status = 'pending'
      AND t.type = 'purchase'
      AND t.teacher_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM lunch_orders lo
          WHERE lo.teacher_id = t.teacher_id
            AND lo.order_date >= '2026-02-01'
            AND t.description ILIKE '%' || to_char(lo.order_date, 'DD') || ' de ' || 
                CASE extract(month from lo.order_date)
                    WHEN 1 THEN 'enero' WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo'
                    WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo' WHEN 6 THEN 'junio'
                    WHEN 7 THEN 'julio' WHEN 8 THEN 'agosto' WHEN 9 THEN 'septiembre'
                    WHEN 10 THEN 'octubre' WHEN 11 THEN 'noviembre' WHEN 12 THEN 'diciembre'
                END || '%'
      )
);
*/
