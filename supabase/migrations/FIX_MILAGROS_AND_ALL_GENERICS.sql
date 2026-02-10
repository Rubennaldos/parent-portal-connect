-- =====================================================
-- INVESTIGAR Y ELIMINAR TRANSACCIONES DE MILAGROS
-- =====================================================

-- PASO 1: Ver todas las transacciones de Milagros
SELECT 
  '🔍 TODAS LAS TRANSACCIONES DE MILAGROS' as tipo,
  t.id,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as creado,
  COALESCE(p.full_name, '🤖 SISTEMA') as creado_por,
  t.created_by,
  t.payment_status
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
LEFT JOIN profiles p ON t.created_by = p.id
WHERE tp.full_name ILIKE '%Milagros%Vilca%'
  AND DATE(t.created_at) >= '2026-02-08'
ORDER BY t.created_at;

-- PASO 2: Identificar la transacción duplicada específica
SELECT 
  '🚨 TRANSACCIÓN DUPLICADA DE MILAGROS' as tipo,
  t.id,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as creado
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Milagros%Vilca%'
  AND t.description = 'Almuerzo - 9 de febrero'  -- Descripción genérica exacta
  AND DATE(t.created_at) >= '2026-02-08';

-- PASO 3: ELIMINAR la transacción duplicada genérica de Milagros
DELETE FROM transactions
WHERE id IN (
  SELECT t.id
  FROM transactions t
  JOIN teacher_profiles tp ON t.teacher_id = tp.id
  WHERE tp.full_name ILIKE '%Milagros%Vilca%'
    AND t.description = 'Almuerzo - 9 de febrero'
    AND DATE(t.created_at) >= '2026-02-08'
);

-- PASO 4: Verificar resultado final
SELECT 
  '✅ MILAGROS - Estado Final' as resultado,
  t.id,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as creado,
  t.payment_status
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Milagros%Vilca%'
  AND DATE(t.created_at) >= '2026-02-08'
ORDER BY t.created_at;

-- PASO 5: Buscar TODOS los profesores con transacciones genéricas "Almuerzo - X de febrero"
SELECT 
  '🔍 TODOS CON TRANSACCIONES GENÉRICAS' as tipo,
  tp.full_name as profesor,
  COUNT(*) as cantidad,
  STRING_AGG(t.description, ' | ') as descripciones
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE 
  t.description ~ '^Almuerzo - [0-9]+ de [a-z]+$'
  AND DATE(t.created_at) >= '2026-02-08'
GROUP BY tp.full_name
ORDER BY cantidad DESC;

-- PASO 6: ELIMINAR TODAS las transacciones genéricas restantes
DELETE FROM transactions
WHERE 
  description ~ '^Almuerzo - [0-9]+ de [a-z]+$'
  AND DATE(created_at) >= '2026-02-08'
  AND teacher_id IS NOT NULL;

-- PASO 7: Verificación final - NO deben quedar genéricas
SELECT 
  '✅ VERIFICACIÓN FINAL - ¿Quedan genéricas?' as resultado,
  COUNT(*) as cantidad_restante
FROM transactions
WHERE 
  description ~ '^Almuerzo - [0-9]+ de [a-z]+$'
  AND DATE(created_at) >= '2026-02-08'
  AND teacher_id IS NOT NULL;
