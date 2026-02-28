-- =====================================================================
-- 🚨 URGENTE: DIAGNÓSTICO Y CORRECCIÓN DEFINITIVA
-- Erradicar TODAS las referencias a "San Jorge" en la BD
-- Nombre correcto: St. George's Miraflores / St. George's Villa
-- =====================================================================

-- ══════════════════════════════════════════════════════════════════════
-- PASO 1: ¿Cómo se llama el colegio AHORA en la tabla schools?
-- (Esto es lo MÁS importante — si aquí dice "San Jorge", todo falla)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  '🏫 TABLA SCHOOLS — FUENTE DE VERDAD' AS paso,
  id,
  name,
  code,
  is_active
FROM schools
WHERE name ILIKE '%jorge%' 
   OR name ILIKE '%george%'
   OR code ILIKE '%jorge%'
   OR code ILIKE '%george%'
   OR code ILIKE '%sgm%'
   OR code ILIKE '%sgv%'
   OR code ILIKE '%lsg%'
ORDER BY name;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 2: ¿Hay DUPLICADOS? (dos sedes diferentes para el mismo colegio)
-- Si hay más de 1 fila con variantes de jorge/george, ESE es el problema
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  '⚠️ POSIBLES DUPLICADOS' AS paso,
  COUNT(*) AS total_sedes_george_jorge
FROM schools
WHERE name ILIKE '%jorge%' OR name ILIKE '%george%';

-- ══════════════════════════════════════════════════════════════════════
-- PASO 3: ¿Dónde aparece "San Jorge" como TEXTO en la BD?
-- Buscar en TODAS las tablas posibles
-- ══════════════════════════════════════════════════════════════════════

-- 3a. En profiles (los perfiles de usuario)
SELECT 
  '👤 PROFILES con San Jorge' AS tipo,
  id,
  full_name,
  role,
  school_id,
  (SELECT name FROM schools WHERE id = profiles.school_id) AS sede_actual
FROM profiles
WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')
LIMIT 10;

-- 3b. En parent_profiles
SELECT 
  '👨‍👩‍👧 PARENT_PROFILES con San Jorge' AS tipo,
  id,
  full_name,
  phone_1,
  school_id,
  (SELECT name FROM schools WHERE id = parent_profiles.school_id) AS sede_actual
FROM parent_profiles
WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')
LIMIT 10;

-- 3c. En students
SELECT 
  '🎓 STUDENTS con San Jorge' AS tipo,
  id,
  full_name,
  grade,
  section,
  school_id,
  (SELECT name FROM schools WHERE id = students.school_id) AS sede_actual
FROM students
WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')
LIMIT 10;

-- 3d. En transactions (descripción como texto)
SELECT 
  '💰 TRANSACTIONS descripción' AS tipo,
  COUNT(*) AS cantidad
FROM transactions
WHERE description ILIKE '%san jorge%';

-- 3e. En transactions (metadata JSON)
SELECT 
  '💰 TRANSACTIONS metadata' AS tipo,
  COUNT(*) AS cantidad
FROM transactions
WHERE metadata::text ILIKE '%san jorge%';

-- 3f. En school_configs
SELECT 
  '⚙️ SCHOOL_CONFIGS' AS tipo,
  sc.id,
  sc.school_id,
  (SELECT name FROM schools WHERE id = sc.school_id) AS sede_actual,
  sc.whatsapp_message_template
FROM school_configs sc
WHERE sc.whatsapp_message_template ILIKE '%san jorge%';

-- 3g. En billing_settings (si existe)
SELECT 
  '💳 BILLING_SETTINGS' AS tipo,
  COUNT(*) AS cantidad
FROM billing_settings
WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%');

-- 3h. En lunch_categories (nombres de categorías que podrían tener el nombre viejo)
SELECT 
  '🍽️ LUNCH_CATEGORIES' AS tipo,
  lc.id,
  lc.name AS categoria,
  s.name AS sede_actual
FROM lunch_categories lc
JOIN schools s ON lc.school_id = s.id
WHERE s.name ILIKE '%san jorge%'
LIMIT 10;

-- 3i. En teacher_profiles
SELECT 
  '👨‍🏫 TEACHER_PROFILES' AS tipo,
  tp.id,
  tp.full_name,
  tp.school_id_1,
  (SELECT name FROM schools WHERE id = tp.school_id_1) AS sede_1_actual,
  tp.school_id_2,
  (SELECT name FROM schools WHERE id = tp.school_id_2) AS sede_2_actual
FROM teacher_profiles tp
WHERE tp.school_id_1 IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')
   OR tp.school_id_2 IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')
LIMIT 10;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 4: RESUMEN — ¿Cuántos registros tienen "San Jorge" como sede?
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  'RESUMEN TOTAL' AS info,
  (SELECT COUNT(*) FROM schools WHERE name ILIKE '%san jorge%') AS sedes_con_nombre_viejo,
  (SELECT COUNT(*) FROM profiles WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')) AS perfiles_afectados,
  (SELECT COUNT(*) FROM parent_profiles WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')) AS padres_afectados,
  (SELECT COUNT(*) FROM students WHERE school_id IN (SELECT id FROM schools WHERE name ILIKE '%san jorge%')) AS alumnos_afectados,
  (SELECT COUNT(*) FROM transactions WHERE description ILIKE '%san jorge%') AS transacciones_con_texto_viejo,
  (SELECT COUNT(*) FROM transactions WHERE metadata::text ILIKE '%san jorge%') AS metadata_con_texto_viejo;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 5: 🔧 CORRECCIÓN — Cambiar el nombre en la tabla schools
-- ⚠️ EJECUTAR SOLO DESPUÉS DE VERIFICAR PASO 1-4
-- ══════════════════════════════════════════════════════════════════════
/*
UPDATE schools
SET name = CASE
  WHEN name ILIKE '%little%george%' OR name ILIKE '%little%jorge%'
    THEN 'Little St. George''s'
  WHEN (name ILIKE '%george%miraflores%' OR name ILIKE '%jorge%miraflores%')
    THEN 'St. George''s Miraflores'
  WHEN (name ILIKE '%george%villa%' OR name ILIKE '%jorge%villa%')
    THEN 'St. George''s Villa'
  ELSE name
END
WHERE name ILIKE '%jorge%' OR (name ILIKE '%george%' AND name NOT ILIKE '%St. George%');
*/

-- ══════════════════════════════════════════════════════════════════════
-- PASO 6: 🔧 CORRECCIÓN — Limpiar "San Jorge" de descripciones de transacciones
-- ⚠️ EJECUTAR SOLO DESPUÉS DE VERIFICAR PASO 1-4
-- ══════════════════════════════════════════════════════════════════════
/*
UPDATE transactions
SET description = REPLACE(description, 'San Jorge Miraflores', 'St. George''s Miraflores')
WHERE description ILIKE '%san jorge miraflores%';

UPDATE transactions
SET description = REPLACE(description, 'San Jorge Villa', 'St. George''s Villa')
WHERE description ILIKE '%san jorge villa%';
*/

-- ══════════════════════════════════════════════════════════════════════
-- PASO 7: 🔧 CORRECCIÓN — Limpiar metadata de transacciones
-- ⚠️ EJECUTAR SOLO DESPUÉS DE VERIFICAR PASO 1-4
-- ══════════════════════════════════════════════════════════════════════
/*
UPDATE transactions
SET metadata = REPLACE(metadata::text, 'San Jorge Miraflores', 'St. George''s Miraflores')::jsonb
WHERE metadata::text ILIKE '%san jorge miraflores%';

UPDATE transactions
SET metadata = REPLACE(metadata::text, 'San Jorge Villa', 'St. George''s Villa')::jsonb
WHERE metadata::text ILIKE '%san jorge villa%';
*/

-- ══════════════════════════════════════════════════════════════════════
-- PASO 8: 🔧 CORRECCIÓN — Limpiar plantillas de WhatsApp
-- ══════════════════════════════════════════════════════════════════════
/*
UPDATE school_configs
SET whatsapp_message_template = REPLACE(whatsapp_message_template, 'San Jorge', 'St. George''s')
WHERE whatsapp_message_template ILIKE '%san jorge%';
*/

-- ══════════════════════════════════════════════════════════════════════
-- PASO 9: VERIFICACIÓN FINAL — No debe quedar NADA con "San Jorge"
-- ══════════════════════════════════════════════════════════════════════
/*
SELECT 
  '🎯 VERIFICACIÓN FINAL' AS paso,
  (SELECT COUNT(*) FROM schools WHERE name ILIKE '%san jorge%') AS escuelas,
  (SELECT COUNT(*) FROM transactions WHERE description ILIKE '%san jorge%') AS transacciones_desc,
  (SELECT COUNT(*) FROM transactions WHERE metadata::text ILIKE '%san jorge%') AS transacciones_meta;
*/
