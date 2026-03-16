-- =====================================================================
-- DIAGNÓSTICO: Silvia Kmot / Silvia kcomt — ¿Por qué no ve su deuda?
-- Cobranzas muestra S/ 129 (Profesor) + S/ 14 (Sin Cuenta). Ella no ve nada.
-- =====================================================================

-- Paso 1: Buscar perfiles de profesor con nombre parecido a Silvia
SELECT id, full_name, onboarding_completed, created_at
FROM teacher_profiles
WHERE full_name ILIKE '%Silvia%'
   OR full_name ILIKE '%kcomt%'
   OR full_name ILIKE '%kmot%'
   OR full_name ILIKE '%kcom%'
ORDER BY full_name;


-- Paso 2: Transacciones PENDIENTES con teacher_id (lo que ve cobranzas)
-- Agrupar por teacher_id para ver a qué perfil pertenece cada deuda
SELECT 
  t.teacher_id,
  tp.full_name AS nombre_perfil,
  COUNT(*) AS num_transacciones,
  SUM(ABS(t.amount)) AS total_deuda,
  MIN(t.created_at) AS primera,
  MAX(t.created_at) AS ultima
FROM transactions t
LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
WHERE t.teacher_id IS NOT NULL
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status IN ('pending', 'partial')
  AND (
    tp.full_name ILIKE '%Silvia%'
    OR t.teacher_id IN (SELECT id FROM teacher_profiles WHERE full_name ILIKE '%Silvia%' OR full_name ILIKE '%kcom%' OR full_name ILIKE '%kmot%')
  )
GROUP BY t.teacher_id, tp.full_name
ORDER BY total_deuda DESC;


-- Paso 3: Listar TODAS las transacciones pendientes de profesores llamados Silvia
SELECT 
  t.id,
  t.teacher_id,
  tp.full_name AS nombre_en_perfil,
  t.amount,
  t.description,
  t.ticket_code,
  t.created_at
FROM transactions t
LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
WHERE t.teacher_id IS NOT NULL
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status IN ('pending', 'partial')
  AND (tp.full_name ILIKE '%Silvia%' OR tp.full_name ILIKE '%kcom%' OR tp.full_name ILIKE '%kmot%')
ORDER BY t.created_at DESC;


-- Paso 4: Si existe vista/rol "Sin Cuenta", buscar cómo cobranzas agrupa
-- (solo para entender si hay otro id involucrado)
SELECT DISTINCT t.teacher_id
FROM transactions t
WHERE t.teacher_id IS NOT NULL
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status IN ('pending', 'partial')
  AND (
    EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = t.teacher_id AND (tp.full_name ILIKE '%Silvia%' OR tp.full_name ILIKE '%kcom%'))
  );
