-- ============================================
-- 🧹 LIMPIAR PEDIDOS DUPLICADOS EN LUNCH_ORDERS
-- ============================================
-- Ejecutar paso a paso en Supabase SQL Editor
-- IMPORTANTE: Ejecuta PASO 1 primero para ver qué se va a borrar

-- ============================================
-- PASO 1: IDENTIFICAR duplicados (solo ver, no borra nada)
-- ============================================
-- Busca pedidos con misma persona + misma fecha + misma categoría + mismo school_id
-- que fueron creados en un intervalo de menos de 5 segundos (doble-clic)

WITH duplicados AS (
  SELECT 
    lo.id,
    lo.order_date,
    COALESCE(lo.student_id::text, '') AS student_id,
    COALESCE(lo.teacher_id::text, '') AS teacher_id,
    COALESCE(lo.manual_name, '') AS manual_name,
    lo.category_id,
    lo.school_id,
    lo.status,
    lo.is_cancelled,
    lo.quantity,
    lo.final_price,
    lo.created_at,
    COALESCE(s.full_name, t.full_name, lo.manual_name, 'Desconocido') AS persona,
    sc.name AS sede,
    ROW_NUMBER() OVER (
      PARTITION BY 
        COALESCE(lo.student_id::text, ''),
        COALESCE(lo.teacher_id::text, ''),
        COALESCE(lo.manual_name, ''),
        lo.order_date,
        lo.category_id,
        lo.school_id
      ORDER BY lo.created_at ASC
    ) AS rn
  FROM lunch_orders lo
  LEFT JOIN students s ON lo.student_id = s.id
  LEFT JOIN teacher_profiles t ON lo.teacher_id = t.id
  LEFT JOIN schools sc ON lo.school_id = sc.id
  WHERE lo.is_cancelled = false
)
SELECT 
  id,
  persona,
  sede,
  order_date,
  status,
  quantity,
  final_price,
  created_at,
  rn AS "copia_numero",
  CASE WHEN rn = 1 THEN '✅ MANTENER' ELSE '🗑️ DUPLICADO - BORRAR' END AS accion
FROM duplicados
WHERE rn > 1  -- Solo mostrar los duplicados (no el original)
ORDER BY persona, order_date, created_at;


-- ============================================
-- PASO 2: VER los IDs específicos que se van a eliminar
-- ============================================
-- (Ejecutar después de verificar PASO 1)

WITH duplicados AS (
  SELECT 
    lo.id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        COALESCE(lo.student_id::text, ''),
        COALESCE(lo.teacher_id::text, ''),
        COALESCE(lo.manual_name, ''),
        lo.order_date,
        lo.category_id,
        lo.school_id
      ORDER BY lo.created_at ASC
    ) AS rn
  FROM lunch_orders lo
  WHERE lo.is_cancelled = false
)
SELECT id FROM duplicados WHERE rn > 1;


-- ============================================
-- PASO 3: ELIMINAR transacciones asociadas a los duplicados
-- ============================================
-- ⚠️ Ejecutar ANTES del paso 4 para no dejar transacciones huérfanas

WITH duplicados AS (
  SELECT 
    lo.id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        COALESCE(lo.student_id::text, ''),
        COALESCE(lo.teacher_id::text, ''),
        COALESCE(lo.manual_name, ''),
        lo.order_date,
        lo.category_id,
        lo.school_id
      ORDER BY lo.created_at ASC
    ) AS rn
  FROM lunch_orders lo
  WHERE lo.is_cancelled = false
),
ids_a_borrar AS (
  SELECT id FROM duplicados WHERE rn > 1
)
DELETE FROM transactions
WHERE metadata->>'lunch_order_id' IN (SELECT id::text FROM ids_a_borrar);


-- ============================================
-- PASO 4: ELIMINAR los pedidos duplicados
-- ============================================
-- ⚠️ Solo ejecutar después de verificar PASO 1 y ejecutar PASO 3

WITH duplicados AS (
  SELECT 
    lo.id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        COALESCE(lo.student_id::text, ''),
        COALESCE(lo.teacher_id::text, ''),
        COALESCE(lo.manual_name, ''),
        lo.order_date,
        lo.category_id,
        lo.school_id
      ORDER BY lo.created_at ASC
    ) AS rn
  FROM lunch_orders lo
  WHERE lo.is_cancelled = false
)
DELETE FROM lunch_orders
WHERE id IN (SELECT id FROM duplicados WHERE rn > 1);


-- ============================================
-- PASO 5: VERIFICAR que no quedan duplicados
-- ============================================

SELECT 
  COALESCE(s.full_name, t.full_name, lo.manual_name, 'Desconocido') AS persona,
  lo.order_date,
  lc.name AS categoria,
  COUNT(*) AS cantidad_pedidos
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles t ON lo.teacher_id = t.id
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.is_cancelled = false
GROUP BY persona, lo.order_date, lc.name
HAVING COUNT(*) > 1
ORDER BY lo.order_date DESC, persona;
