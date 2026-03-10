-- =========================================================
-- FIX: Corregir free_account de Maylén León Cuba
-- =========================================================
-- Su recarga fue aprobada el 03/03/2026 pero free_account
-- no se cambió a false automáticamente.
-- =========================================================

-- PASO 1: Verificar estado actual
SELECT
  s.id,
  s.full_name,
  s.balance,
  s.free_account,
  sch.name AS colegio
FROM students s
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.full_name ILIKE '%Maylén León Cuba%'
   OR s.full_name ILIKE '%Maylen Leon Cuba%';

-- PASO 2: Corregir free_account (ejecutar SOLO si el PASO 1 confirma que es true)
UPDATE students
SET free_account = false
WHERE full_name ILIKE '%Maylén León Cuba%'
   OR full_name ILIKE '%Maylen Leon Cuba%';

-- PASO 3: Confirmar corrección
SELECT
  s.full_name,
  s.balance,
  s.free_account,
  sch.name AS colegio
FROM students s
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.full_name ILIKE '%Maylén León Cuba%'
   OR s.full_name ILIKE '%Maylen Leon Cuba%';
