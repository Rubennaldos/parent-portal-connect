-- =============================================================================
-- REPORTE: Ventas de prueba / POS kiosco en TODAS las sedes
-- =============================================================================
-- Ejecuta UN BLOQUE a la vez en el SQL Editor de Supabase (cada bloque es
-- independiente). No modifica datos.
--
-- Kiosco/POS: type = 'purchase' y SIN lunch_order_id en metadata.
-- Almuerzos: metadata->>'lunch_order_id' IS NOT NULL (excluidos aquí).
-- Monto en listados: ABS(amount) porque el POS guarda compras en negativo.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Resumen por sede (heurística: prueba, test, demo, qa, dummy…)
-- ═══════════════════════════════════════════════════════════════════════════
WITH pos_kiosco AS (
  SELECT
    t.*,
    s.name AS sede_nombre,
    st.full_name AS alumno_nombre,
    tp.full_name AS profesor_nombre,
    p.email AS cajero_email,
    p.full_name AS cajero_nombre,
    COALESCE(
      st.full_name,
      tp.full_name,
      t.manual_client_name,
      t.invoice_client_name,
      ''
    ) AS cliente_display
  FROM transactions t
  LEFT JOIN schools s ON s.id = t.school_id
  LEFT JOIN students st ON st.id = t.student_id
  LEFT JOIN profiles tp ON tp.id = t.teacher_id
  LEFT JOIN profiles p ON p.id = t.created_by
  WHERE t.type = 'purchase'
    AND COALESCE(t.is_deleted, false) = false
    AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '')
),
marcadas_prueba AS (
  SELECT
    *,
    CASE
      WHEN cliente_display ~* '(prueba|test|demo|qa|dummy|fake|borrar|temporal|dev)'
        OR COALESCE(description, '') ~* '(prueba|test|demo)'
        OR COALESCE(ticket_code, '') ~* '(prueba|test|demo)'
        OR COALESCE(invoice_client_name, '') ~* '(prueba|test|demo)'
        OR COALESCE(manual_client_name, '') ~* '(prueba|test|demo)'
        OR COALESCE(metadata::text, '') ~* '(prueba|test|demo)'
      THEN true
      ELSE false
    END AS parece_prueba
  FROM pos_kiosco
)
SELECT
  sede_nombre,
  COUNT(*) AS tickets_prueba,
  ROUND(SUM(ABS(amount))::numeric, 2) AS total_soles_abs
FROM marcadas_prueba
WHERE parece_prueba = true
GROUP BY sede_nombre
ORDER BY tickets_prueba DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — Detalle filas que parecen prueba (todas las sedes)
-- ═══════════════════════════════════════════════════════════════════════════
WITH pos_kiosco AS (
  SELECT
    t.*,
    s.name AS sede_nombre,
    st.full_name AS alumno_nombre,
    tp.full_name AS profesor_nombre,
    p.email AS cajero_email,
    p.full_name AS cajero_nombre,
    COALESCE(
      st.full_name,
      tp.full_name,
      t.manual_client_name,
      t.invoice_client_name,
      ''
    ) AS cliente_display
  FROM transactions t
  LEFT JOIN schools s ON s.id = t.school_id
  LEFT JOIN students st ON st.id = t.student_id
  LEFT JOIN profiles tp ON tp.id = t.teacher_id
  LEFT JOIN profiles p ON p.id = t.created_by
  WHERE t.type = 'purchase'
    AND COALESCE(t.is_deleted, false) = false
    AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '')
),
marcadas_prueba AS (
  SELECT
    *,
    CASE
      WHEN cliente_display ~* '(prueba|test|demo|qa|dummy|fake|borrar|temporal|dev)'
        OR COALESCE(description, '') ~* '(prueba|test|demo)'
        OR COALESCE(ticket_code, '') ~* '(prueba|test|demo)'
        OR COALESCE(invoice_client_name, '') ~* '(prueba|test|demo)'
        OR COALESCE(manual_client_name, '') ~* '(prueba|test|demo)'
        OR COALESCE(metadata::text, '') ~* '(prueba|test|demo)'
      THEN true
      ELSE false
    END AS parece_prueba
  FROM pos_kiosco
)
SELECT
  id,
  created_at,
  sede_nombre,
  ticket_code,
  ABS(amount)::numeric(12, 2) AS monto_soles,
  payment_status,
  payment_method,
  cliente_display AS cliente,
  description,
  cajero_email,
  cajero_nombre,
  alumno_nombre,
  profesor_nombre,
  metadata
FROM marcadas_prueba
WHERE parece_prueba = true
ORDER BY created_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — Todas las ventas POS kiosco últimos 120 días (revisión manual)
--    Ajusta el intervalo o el LIMIT si necesitas más historia.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  t.id,
  t.created_at,
  s.name AS sede_nombre,
  t.ticket_code,
  ABS(t.amount)::numeric(12, 2) AS monto_soles,
  t.payment_status,
  t.payment_method,
  COALESCE(st.full_name, tp.full_name, t.manual_client_name, t.invoice_client_name, '(sin nombre)') AS cliente,
  t.description,
  p.email AS cajero_email
FROM transactions t
LEFT JOIN schools s ON s.id = t.school_id
LEFT JOIN students st ON st.id = t.student_id
LEFT JOIN profiles tp ON tp.id = t.teacher_id
LEFT JOIN profiles p ON p.id = t.created_by
WHERE t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '')
  AND t.created_at >= NOW() - INTERVAL '120 days'
ORDER BY t.created_at DESC
LIMIT 500;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — Totales globales: POS kiosco vs filas con patrón “prueba/test”
-- ═══════════════════════════════════════════════════════════════════════════
WITH pos_kiosco AS (
  SELECT
    t.*,
    COALESCE(
      st.full_name,
      tp.full_name,
      t.manual_client_name,
      t.invoice_client_name,
      ''
    ) AS cliente_display
  FROM transactions t
  LEFT JOIN students st ON st.id = t.student_id
  LEFT JOIN profiles tp ON tp.id = t.teacher_id
  WHERE t.type = 'purchase'
    AND COALESCE(t.is_deleted, false) = false
    AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '')
),
marcadas_prueba AS (
  SELECT
    *,
    CASE
      WHEN cliente_display ~* '(prueba|test|demo|qa|dummy|fake|borrar|temporal|dev)'
        OR COALESCE(description, '') ~* '(prueba|test|demo)'
        OR COALESCE(ticket_code, '') ~* '(prueba|test|demo)'
        OR COALESCE(invoice_client_name, '') ~* '(prueba|test|demo)'
        OR COALESCE(manual_client_name, '') ~* '(prueba|test|demo)'
        OR COALESCE(metadata::text, '') ~* '(prueba|test|demo)'
      THEN true
      ELSE false
    END AS parece_prueba
  FROM pos_kiosco
)
SELECT
  COUNT(*) AS total_pos_kiosco_todas_sedes,
  COUNT(*) FILTER (WHERE parece_prueba) AS con_patron_prueba_test_demo
FROM marcadas_prueba;
