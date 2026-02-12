-- ====================================================================
-- 🧹 LIMPIEZA INTEGRAL - TODAS LAS SEDES
-- Fecha: 12 de febrero, 2026
-- Versión: v2.0
-- 
-- ⚠️ EJECUTAR PASO POR PASO, NO TODO DE UNA VEZ
-- ⚠️ Revisar resultados de cada paso antes de continuar
-- ====================================================================


-- ====================================================================
-- 📊 PASO 1: DIAGNÓSTICO COMPLETO
-- Ver cuántas virtuales materializadas hay POR SEDE
-- (las reconocemos porque created_at es a medianoche exacta 00:00:00
--  y tienen metadata con lunch_order_id)
-- ====================================================================
SELECT 
  '📊 POR SEDE' as tipo,
  s.name as sede,
  COUNT(*) as total_virtuales_materializadas,
  SUM(CASE WHEN t.payment_status = 'paid' THEN 1 ELSE 0 END) as paid,
  SUM(CASE WHEN t.payment_status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN t.payment_method IS NOT NULL THEN 1 ELSE 0 END) as con_metodo_pago,
  SUM(CASE WHEN t.payment_method IS NULL THEN 1 ELSE 0 END) as sin_metodo_pago
FROM transactions t
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.metadata->>'source' = 'lunch_order'
  AND t.created_at::time = '00:00:00'
GROUP BY s.name
ORDER BY total_virtuales_materializadas DESC;


-- ====================================================================
-- 📊 PASO 2: Listar TODAS las virtuales materializadas con su
-- lunch_order real para identificar duplicados
-- ====================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM transactions t2 
      WHERE t2.id != t.id 
        AND t2.created_at::time != '00:00:00'
        AND t2.description ILIKE '%Almuerzo%'
        AND (
          (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
          OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
        )
        AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
            CASE EXTRACT(MONTH FROM lo.order_date)
              WHEN 1 THEN 'febrero' -- Ajustar si es otro mes
              WHEN 2 THEN 'febrero'
              WHEN 3 THEN 'marzo'
              WHEN 4 THEN 'abril'
              WHEN 5 THEN 'mayo'
              WHEN 6 THEN 'junio'
              WHEN 7 THEN 'julio'
              WHEN 8 THEN 'agosto'
              WHEN 9 THEN 'septiembre'
              WHEN 10 THEN 'octubre'
              WHEN 11 THEN 'noviembre'
              WHEN 12 THEN 'diciembre'
            END || '%'
    ) THEN '🔴 DUPLICADO (tiene original)'
    ELSE '🟢 SIN ORIGINAL (mantener)'
  END as diagnostico,
  t.id as virtual_id,
  t.created_at as virtual_created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  t.teacher_id,
  COALESCE(tp.full_name, tp2.full_name, 'Sin profesor') as profesor,
  s.name as sede,
  t.metadata->>'lunch_order_id' as lunch_order_id,
  lo.order_date
FROM transactions t
LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
LEFT JOIN teacher_profiles tp2 ON lo.teacher_id = tp2.id
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.metadata->>'source' = 'lunch_order'
  AND t.created_at::time = '00:00:00'
ORDER BY diagnostico, sede, profesor;


-- ====================================================================
-- 📊 PASO 3: Para las DUPLICADAS, mostrar la pareja
-- (virtual materializada + original) para verificar antes de actuar
-- ====================================================================
WITH duplicados AS (
  SELECT 
    t.id as virtual_id,
    t.amount as virtual_amount,
    t.description as virtual_desc,
    t.payment_status as virtual_status,
    t.payment_method as virtual_method,
    t.created_by as virtual_created_by,
    lo.teacher_id as lo_teacher_id,
    lo.student_id as lo_student_id,
    lo.order_date,
    t.metadata->>'lunch_order_id' as lunch_order_id,
    t.school_id
  FROM transactions t
  LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
  WHERE t.metadata->>'source' = 'lunch_order'
    AND t.created_at::time = '00:00:00'
    AND EXISTS (
      SELECT 1 FROM transactions t2 
      WHERE t2.id != t.id 
        AND t2.created_at::time != '00:00:00'
        AND t2.description ILIKE '%Almuerzo%'
        AND (
          (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
          OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
        )
        AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
            CASE EXTRACT(MONTH FROM lo.order_date)
              WHEN 2 THEN 'febrero'
              WHEN 3 THEN 'marzo'
              WHEN 4 THEN 'abril'
              WHEN 5 THEN 'mayo'
            END || '%'
    )
)
SELECT 
  '🔴 VIRTUAL (duplicado)' as tipo,
  d.virtual_id as id,
  d.virtual_desc as description,
  d.virtual_status as status,
  d.virtual_method as method,
  d.order_date,
  COALESCE(tp.full_name, 'Sin nombre') as profesor,
  s.name as sede
FROM duplicados d
LEFT JOIN teacher_profiles tp ON d.lo_teacher_id = tp.id
LEFT JOIN schools s ON d.school_id = s.id

UNION ALL

SELECT 
  '🟢 ORIGINAL' as tipo,
  t2.id,
  t2.description,
  t2.payment_status,
  t2.payment_method,
  d.order_date,
  COALESCE(tp.full_name, 'Sin nombre') as profesor,
  s.name as sede
FROM duplicados d
JOIN transactions t2 ON t2.id != d.virtual_id 
  AND t2.created_at::time != '00:00:00'
  AND t2.description ILIKE '%Almuerzo%'
  AND (
    (d.lo_teacher_id IS NOT NULL AND t2.teacher_id = d.lo_teacher_id)
    OR (d.lo_student_id IS NOT NULL AND t2.student_id = d.lo_student_id)
  )
  AND t2.description ILIKE '%' || TRIM(TO_CHAR(d.order_date, 'DD')) || ' de ' || 
      CASE EXTRACT(MONTH FROM d.order_date)
        WHEN 2 THEN 'febrero'
        WHEN 3 THEN 'marzo'
        WHEN 4 THEN 'abril'
        WHEN 5 THEN 'mayo'
      END || '%'
LEFT JOIN teacher_profiles tp ON d.lo_teacher_id = tp.id
LEFT JOIN schools s ON d.school_id = s.id
ORDER BY profesor, order_date, tipo;


-- ====================================================================
-- 📊 PASO 4: "PAID SIN MÉTODO DE PAGO" - Transacciones que están como
-- pagadas pero NO tienen método de pago (NO son midnight)
-- ====================================================================
SELECT 
  '🚨 PAID SIN MÉTODO' as tipo,
  t.id,
  COALESCE(tp.full_name, 'Sin nombre') as profesor,
  t.created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  t.created_by,
  p.full_name as cobrado_por,
  p.role as rol_cobrador,
  s.name as sede
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
LEFT JOIN profiles p ON t.created_by = p.id
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.payment_status = 'paid'
  AND t.payment_method IS NULL
  AND t.teacher_id IS NOT NULL
  AND t.description ILIKE '%Almuerzo%'
  AND t.created_at::time != '00:00:00'  -- Solo las NO virtuales
ORDER BY t.created_at DESC;


-- ====================================================================
-- 📊 PASO 5: RESUMEN FINAL antes de actuar
-- ====================================================================
SELECT '📊 RESUMEN' as tipo, 
  'Virtuales materializadas TOTALES' as concepto, 
  COUNT(*)::text as cantidad
FROM transactions t
WHERE t.metadata->>'source' = 'lunch_order' AND t.created_at::time = '00:00:00'

UNION ALL

SELECT '📊 RESUMEN', 
  'Virtuales que SÍ son duplicados (para ELIMINAR)', 
  COUNT(*)::text
FROM transactions t
LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE t.metadata->>'source' = 'lunch_order'
  AND t.created_at::time = '00:00:00'
  AND EXISTS (
    SELECT 1 FROM transactions t2 
    WHERE t2.id != t.id 
      AND t2.created_at::time != '00:00:00'
      AND t2.description ILIKE '%Almuerzo%'
      AND (
        (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
        OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
      )
      AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
          CASE EXTRACT(MONTH FROM lo.order_date)
            WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo' 
            WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo'
          END || '%'
  )

UNION ALL

SELECT '📊 RESUMEN', 
  'Virtuales LEGÍTIMAS (mantener)', 
  COUNT(*)::text
FROM transactions t
LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE t.metadata->>'source' = 'lunch_order'
  AND t.created_at::time = '00:00:00'
  AND NOT EXISTS (
    SELECT 1 FROM transactions t2 
    WHERE t2.id != t.id 
      AND t2.created_at::time != '00:00:00'
      AND t2.description ILIKE '%Almuerzo%'
      AND (
        (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
        OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
      )
      AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
          CASE EXTRACT(MONTH FROM lo.order_date)
            WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo' 
            WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo'
          END || '%'
  )

UNION ALL

SELECT '📊 RESUMEN', 
  'PAID sin método de pago (mover a pending)', 
  COUNT(*)::text
FROM transactions t
WHERE t.payment_status = 'paid'
  AND t.payment_method IS NULL
  AND t.teacher_id IS NOT NULL
  AND t.description ILIKE '%Almuerzo%'
  AND t.created_at::time != '00:00:00';


-- ====================================================================
-- ⚠️⚠️⚠️ A PARTIR DE AQUÍ SON ACCIONES DE LIMPIEZA ⚠️⚠️⚠️
-- ⚠️ NO EJECUTAR sin antes revisar los pasos 1-5 ⚠️
-- ====================================================================


-- ====================================================================
-- 🧹 PASO 6: BACKUP antes de hacer cambios
-- ====================================================================
-- CREATE TABLE transactions_backup_20260212 AS SELECT * FROM transactions;


-- ====================================================================
-- 🧹 PASO 7: Para duplicados donde VIRTUAL=paid y ORIGINAL=pending,
-- transferir el pago a la ORIGINAL antes de eliminar
-- ====================================================================
-- Este paso actualiza las originales pendientes con los datos de pago
-- de la virtual materializada (si la virtual fue "cobrada")
WITH duplicados_paid AS (
  SELECT 
    t.id as virtual_id,
    t.payment_method as virtual_method,
    t.operation_number as virtual_operation,
    t.created_by as virtual_created_by,
    lo.teacher_id as lo_teacher_id,
    lo.student_id as lo_student_id,
    lo.order_date
  FROM transactions t
  LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
  WHERE t.metadata->>'source' = 'lunch_order'
    AND t.created_at::time = '00:00:00'
    AND t.payment_status = 'paid'
    AND t.payment_method IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM transactions t2 
      WHERE t2.id != t.id 
        AND t2.created_at::time != '00:00:00'
        AND t2.payment_status = 'pending'
        AND t2.description ILIKE '%Almuerzo%'
        AND (
          (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
          OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
        )
        AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
            CASE EXTRACT(MONTH FROM lo.order_date)
              WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo' 
              WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo'
            END || '%'
    )
),
originales_a_actualizar AS (
  SELECT DISTINCT ON (t2.id)
    t2.id as original_id,
    dp.virtual_method,
    dp.virtual_operation,
    dp.virtual_created_by
  FROM duplicados_paid dp
  JOIN transactions t2 ON t2.created_at::time != '00:00:00'
    AND t2.payment_status = 'pending'
    AND t2.description ILIKE '%Almuerzo%'
    AND (
      (dp.lo_teacher_id IS NOT NULL AND t2.teacher_id = dp.lo_teacher_id)
      OR (dp.lo_student_id IS NOT NULL AND t2.student_id = dp.lo_student_id)
    )
    AND t2.description ILIKE '%' || TRIM(TO_CHAR(dp.order_date, 'DD')) || ' de ' || 
        CASE EXTRACT(MONTH FROM dp.order_date)
          WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo' 
          WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo'
        END || '%'
)
UPDATE transactions
SET 
  payment_status = 'paid',
  payment_method = oa.virtual_method,
  operation_number = oa.virtual_operation,
  created_by = oa.virtual_created_by
FROM originales_a_actualizar oa
WHERE transactions.id = oa.original_id;
-- Debería retornar: X rows updated


-- ====================================================================
-- 🧹 PASO 8: ELIMINAR las virtuales materializadas que son DUPLICADOS
-- (que tienen una original correspondiente)
-- ====================================================================
DELETE FROM transactions
WHERE id IN (
  SELECT t.id
  FROM transactions t
  LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
  WHERE t.metadata->>'source' = 'lunch_order'
    AND t.created_at::time = '00:00:00'
    AND EXISTS (
      SELECT 1 FROM transactions t2 
      WHERE t2.id != t.id 
        AND t2.created_at::time != '00:00:00'
        AND t2.description ILIKE '%Almuerzo%'
        AND (
          (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
          OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
        )
        AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
            CASE EXTRACT(MONTH FROM lo.order_date)
              WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo' 
              WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo'
            END || '%'
    )
);
-- Debería retornar: X rows deleted


-- ====================================================================
-- 🧹 PASO 9: Mover "PAID SIN MÉTODO" a pending
-- ====================================================================
UPDATE transactions
SET payment_status = 'pending'
WHERE payment_status = 'paid'
  AND payment_method IS NULL
  AND teacher_id IS NOT NULL
  AND description ILIKE '%Almuerzo%'
  AND created_at::time != '00:00:00';
-- Debería retornar: 6 rows updated (basado en el diagnóstico)


-- ====================================================================
-- ✅ PASO 10: VERIFICACIÓN FINAL - Confirmar que la limpieza funcionó
-- ====================================================================

-- 10A: ¿Quedan virtuales materializadas duplicadas?
SELECT '10A - Duplicados restantes' as check_type, COUNT(*) as cantidad
FROM transactions t
LEFT JOIN lunch_orders lo ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE t.metadata->>'source' = 'lunch_order'
  AND t.created_at::time = '00:00:00'
  AND EXISTS (
    SELECT 1 FROM transactions t2 
    WHERE t2.id != t.id 
      AND t2.created_at::time != '00:00:00'
      AND t2.description ILIKE '%Almuerzo%'
      AND (
        (lo.teacher_id IS NOT NULL AND t2.teacher_id = lo.teacher_id)
        OR (lo.student_id IS NOT NULL AND t2.student_id = lo.student_id)
      )
      AND t2.description ILIKE '%' || TRIM(TO_CHAR(lo.order_date, 'DD')) || ' de ' || 
          CASE EXTRACT(MONTH FROM lo.order_date)
            WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo' 
            WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo'
          END || '%'
  )

UNION ALL

-- 10B: ¿Quedan PAID sin método?
SELECT '10B - Paid sin método' as check_type, COUNT(*) as cantidad
FROM transactions
WHERE payment_status = 'paid'
  AND payment_method IS NULL
  AND teacher_id IS NOT NULL
  AND description ILIKE '%Almuerzo%'

UNION ALL

-- 10C: Estado general por sede
SELECT '10C - Total pending ' || s.name, COUNT(*)::text::bigint
FROM transactions t
JOIN schools s ON t.school_id = s.id
WHERE t.payment_status = 'pending'
  AND t.description ILIKE '%Almuerzo%'
GROUP BY s.name

UNION ALL

SELECT '10C - Total paid ' || s.name, COUNT(*)::text::bigint
FROM transactions t
JOIN schools s ON t.school_id = s.id
WHERE t.payment_status = 'paid'
  AND t.description ILIKE '%Almuerzo%'
GROUP BY s.name;


-- ====================================================================
-- ✅ PASO 11: Verificar Carmen Rosa específicamente
-- ====================================================================
SELECT 
  '✅ CARMEN ROSA' as tipo,
  t.id,
  t.created_at,
  t.amount,
  t.description,
  t.payment_status,
  t.payment_method,
  CASE WHEN t.created_at::time = '00:00:00' THEN '⚠️ VIRTUAL' ELSE '✅ ORIGINAL' END as tipo_tx
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Carmen Rosa%'
  AND t.description ILIKE '%Almuerzo%'
ORDER BY t.created_at;
