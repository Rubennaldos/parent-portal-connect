-- =====================================================
-- ELIMINAR TODAS LAS TRANSACCIONES DUPLICADAS GENÉRICAS
-- =====================================================

-- PASO 1: Ver cuántas transacciones se van a eliminar
SELECT 
  '🔍 VISTA PREVIA - Transacciones genéricas a eliminar' as paso,
  COUNT(*) as total_a_eliminar
FROM transactions
WHERE 
  -- Transacciones de almuerzo genéricas (sin nombre de categoría)
  (
    description ~ '^Almuerzo - [0-9]+ de [a-z]+$'  -- Formato: "Almuerzo - 9 de febrero"
    OR description ~ '^Almuerzo - [0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'  -- Formato: "Almuerzo - 09/02/2026"
  )
  AND type = 'purchase'
  AND amount < 0
  AND teacher_id IS NOT NULL
  AND DATE(created_at) >= '2026-02-08';

-- PASO 2: Ver ejemplos de lo que se va a eliminar
SELECT 
  '⚠️ EJEMPLOS de transacciones a eliminar' as tipo,
  t.id,
  tp.full_name as profesor,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as creado,
  COALESCE(p.full_name, '🤖 SISTEMA') as creado_por
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
LEFT JOIN profiles p ON t.created_by = p.id
WHERE 
  (
    description ~ '^Almuerzo - [0-9]+ de [a-z]+$'
    OR description ~ '^Almuerzo - [0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
  )
  AND t.type = 'purchase'
  AND t.amount < 0
  AND t.teacher_id IS NOT NULL
  AND DATE(t.created_at) >= '2026-02-08'
ORDER BY tp.full_name
LIMIT 10;

-- PASO 3: ELIMINAR las transacciones duplicadas genéricas
DELETE FROM transactions
WHERE 
  (
    description ~ '^Almuerzo - [0-9]+ de [a-z]+$'  -- "Almuerzo - 9 de febrero"
    OR description ~ '^Almuerzo - [0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'  -- "Almuerzo - 09/02/2026"
  )
  AND type = 'purchase'
  AND amount < 0
  AND teacher_id IS NOT NULL
  AND DATE(created_at) >= '2026-02-08';

-- PASO 4: Verificar resultado
SELECT 
  '✅ VERIFICACIÓN - Transacciones restantes de Sarina' as resultado,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as creado
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Sarina%'
  AND DATE(t.created_at) >= '2026-02-08'
ORDER BY t.created_at;

-- PASO 5: Ver cuántas transacciones correctas quedan para todos los profesores
SELECT 
  '📊 RESUMEN FINAL - Transacciones por profesor' as tipo,
  tp.full_name as profesor,
  COUNT(*) as total_transacciones,
  STRING_AGG(SUBSTRING(t.description, 1, 40), ' | ') as descripciones
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE DATE(t.created_at) >= '2026-02-08'
  AND t.type = 'purchase'
  AND t.amount < 0
GROUP BY tp.full_name
ORDER BY tp.full_name
LIMIT 15;
