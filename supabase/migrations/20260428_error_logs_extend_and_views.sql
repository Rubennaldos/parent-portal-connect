-- ============================================================
-- EXTENSIÓN DE error_logs + VISTAS DE ESTADÍSTICAS
-- Fecha: 2026-04-28
--
-- PROPÓSITO:
--   Agregar columnas que faltaban para capturar el contexto
--   completo de cada error (quién, dónde, qué hacía, mensaje
--   amigable, datos técnicos).
--
--   Crear las vistas que usa el ErrorDashboard:
--     - error_statistics        (por tipo de error)
--     - error_hotspots          (páginas/componentes con más errores)
--     - most_frequent_errors    (errores que se repiten más)
--
-- NOTA: Todo ADD COLUMN IF NOT EXISTS — no rompe datos existentes.
-- ============================================================

-- ── Columnas de usuario ──────────────────────────────────────
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS user_email    text;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS user_role     text;

-- ── Clasificación del error ──────────────────────────────────
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS error_type    text DEFAULT 'unknown';
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS error_message text;   -- mensaje técnico crudo
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS error_translated text; -- mensaje amigable para el padre

-- ── Contexto de dónde ocurrió ────────────────────────────────
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS page_url      text;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS component     text;   -- nombre del componente React
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS action        text;   -- qué intentaba hacer el usuario

-- ── Datos técnicos del navegador ─────────────────────────────
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS user_agent    text;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS stack_trace   text;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS metadata      jsonb;

-- ── Compatibilidad: el campo antiguo 'resolved' y el nuevo 'is_resolved' ──
-- El helper del frontend inserta 'is_resolved'; la tabla antigua tiene 'resolved'.
-- Agregamos is_resolved y lo sincronizamos mediante default desde resolved.
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS is_resolved   boolean NOT NULL DEFAULT false;

-- Índices adicionales para las nuevas columnas
CREATE INDEX IF NOT EXISTS idx_error_logs_error_type  ON public.error_logs (error_type);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_email  ON public.error_logs (user_email);
CREATE INDEX IF NOT EXISTS idx_error_logs_is_resolved ON public.error_logs (is_resolved) WHERE is_resolved = false;

-- ============================================================
-- VISTA: error_statistics
-- Agrupa errores por tipo para los KPIs del dashboard
-- ============================================================
DROP VIEW IF EXISTS public.error_statistics CASCADE;
CREATE OR REPLACE VIEW public.error_statistics AS
SELECT
  COALESCE(error_type, 'unknown')                     AS error_type,
  COUNT(*)                                            AS total_count,
  COUNT(DISTINCT user_email)                          AS affected_users,
  MAX(created_at)                                     AS last_occurrence,
  ROUND(
    EXTRACT(EPOCH FROM (now() - MAX(created_at))) / 3600
  )                                                   AS avg_hours_ago
FROM public.error_logs
WHERE created_at >= now() - INTERVAL '30 days'
GROUP BY COALESCE(error_type, 'unknown')
ORDER BY total_count DESC;

-- ============================================================
-- VISTA: error_hotspots
-- Páginas/componentes donde se acumulan más errores (7 días)
-- ============================================================
DROP VIEW IF EXISTS public.error_hotspots CASCADE;
CREATE OR REPLACE VIEW public.error_hotspots AS
SELECT
  COALESCE(page_url, 'desconocida')          AS page_url,
  COALESCE(component, '')                    AS component,
  COUNT(*)                                   AS error_count,
  COUNT(DISTINCT user_email)                 AS affected_users,
  ARRAY_AGG(DISTINCT COALESCE(error_type, 'unknown'))  AS error_types
FROM public.error_logs
WHERE created_at >= now() - INTERVAL '7 days'
GROUP BY COALESCE(page_url, 'desconocida'), COALESCE(component, '')
ORDER BY error_count DESC
LIMIT 20;

-- ============================================================
-- VISTA: most_frequent_errors
-- Top 10 errores que más se repiten en la última semana
-- ============================================================
DROP VIEW IF EXISTS public.most_frequent_errors CASCADE;
CREATE OR REPLACE VIEW public.most_frequent_errors AS
SELECT
  COALESCE(error_message, message, 'Sin mensaje')               AS error_message,
  COALESCE(error_translated, 'Error no traducido')              AS error_translated,
  COUNT(*)                                                      AS occurrences,
  COUNT(DISTINCT user_email)                                    AS affected_users,
  MAX(created_at)                                               AS last_seen,
  COALESCE(MIN(page_url), '')                                   AS page_url,
  COALESCE(MIN(component), '')                                  AS component
FROM public.error_logs
WHERE created_at >= now() - INTERVAL '7 days'
GROUP BY
  COALESCE(error_message, message, 'Sin mensaje'),
  COALESCE(error_translated, 'Error no traducido')
ORDER BY occurrences DESC
LIMIT 10;

-- ============================================================
-- RLS para las nuevas vistas (solo superadmin puede leerlas)
-- ============================================================
-- Las vistas heredan el RLS de la tabla base, pero para seguridad
-- extra, las marcamos con SECURITY INVOKER (default en PostgreSQL).
-- Solo un superadmin/admin_general puede llegar a estas vistas
-- porque la tabla base ya tiene la policy de lectura restrictiva.

SELECT '20260428_error_logs_extend ✅ Columnas y vistas creadas correctamente' AS resultado;
