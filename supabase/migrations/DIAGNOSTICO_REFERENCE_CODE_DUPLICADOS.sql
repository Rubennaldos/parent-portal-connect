-- ============================================================
-- DIAGNÓSTICO: reference_code duplicados en recharge_requests
-- Ejecutar ANTES de aplicar el índice único (Fase 1-A)
-- ============================================================

-- ── BLOQUE 1: ¿Cuántos duplicados hay en total? ──────────────
SELECT 
  COUNT(*) AS total_grupos_duplicados,
  SUM(qty) AS total_registros_afectados
FROM (
  SELECT 
    reference_code,
    COUNT(*) AS qty
  FROM recharge_requests
  WHERE status != 'rejected'
    AND reference_code IS NOT NULL
    AND TRIM(reference_code) != ''
  GROUP BY reference_code
  HAVING COUNT(*) > 1
) sub;


-- ── BLOQUE 2: Detalle de cada duplicado ──────────────────────
-- Muestra cada grupo: qué código se repite, cuántas veces,
-- a qué alumnos pertenece y cuál es el estado de cada uno.
SELECT
  rr.reference_code,
  COUNT(*) OVER (PARTITION BY rr.reference_code) AS veces_repetido,
  rr.id             AS recharge_request_id,
  rr.status,
  rr.amount,
  rr.created_at,
  rr.approved_at,
  rr.request_type,
  s.full_name       AS alumno,
  p.full_name       AS padre
FROM recharge_requests rr
LEFT JOIN students  s ON s.id = rr.student_id
LEFT JOIN profiles  p ON p.id = rr.parent_id
WHERE rr.status != 'rejected'
  AND rr.reference_code IS NOT NULL
  AND TRIM(rr.reference_code) != ''
  AND rr.reference_code IN (
    SELECT reference_code
    FROM recharge_requests
    WHERE status != 'rejected'
      AND reference_code IS NOT NULL
      AND TRIM(reference_code) != ''
    GROUP BY reference_code
    HAVING COUNT(*) > 1
  )
ORDER BY rr.reference_code, rr.created_at;


-- ── BLOQUE 3: Vouchers con reference_code NULL o vacío ───────
-- Estos no bloquean el índice único, pero son un hueco de calidad.
-- Si hay muchos, conviene limpiarlos o rechazarlos también.
SELECT
  rr.id             AS recharge_request_id,
  rr.status,
  rr.amount,
  rr.created_at,
  rr.request_type,
  s.full_name       AS alumno,
  p.full_name       AS padre,
  rr.reference_code AS referencia_vacia
FROM recharge_requests rr
LEFT JOIN students  s ON s.id = rr.student_id
LEFT JOIN profiles  p ON p.id = rr.parent_id
WHERE rr.status != 'rejected'
  AND (rr.reference_code IS NULL OR TRIM(rr.reference_code) = '')
ORDER BY rr.created_at DESC;
