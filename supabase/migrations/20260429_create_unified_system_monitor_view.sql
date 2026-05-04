-- ============================================================
-- Vista unificada del monitor de errores
-- Junta error_logs (legacy) + system_error_logs (nuevo en vivo)
-- ============================================================

DROP VIEW IF EXISTS public.unified_system_monitor;

CREATE OR REPLACE VIEW public.unified_system_monitor AS
SELECT
  ('legacy_' || el.id::text)                         AS id,
  el.id                                              AS source_id,
  'error_logs'::text                                 AS source_table,
  el.created_at                                      AS created_at,
  el.user_id                                         AS user_id,
  COALESCE(el.user_email, 'anónimo')                AS user_email,
  COALESCE(el.user_role, 'unknown')                 AS user_role,
  COALESCE(el.error_type, 'unknown')                AS error_type,
  COALESCE(el.error_message, el.message, 'Error sin detalle')                       AS error_message,
  COALESCE(el.error_translated, el.error_message, el.message, 'Error sin detalle') AS error_translated,
  el.stack_trace                                     AS stack_trace,
  el.component                                       AS component,
  el.page_url                                        AS page_url,
  el.action                                          AS action,
  COALESCE(el.metadata, '{}'::jsonb)                AS metadata,
  COALESCE(el.is_resolved, false)                   AS is_resolved,
  false                                              AS is_live_error
FROM public.error_logs el

UNION ALL

SELECT
  ('live_' || sl.id::text)                           AS id,
  sl.id                                              AS source_id,
  'system_error_logs'::text                          AS source_table,
  sl.created_at                                      AS created_at,
  sl.user_id                                         AS user_id,
  COALESCE(sl.metadata->>'user_email', 'anónimo')   AS user_email,
  COALESCE(sl.metadata->>'user_role', 'unknown')    AS user_role,
  'ui_runtime'::text                                 AS error_type,
  COALESCE(sl.error_message, 'Error de interfaz')   AS error_message,
  COALESCE(sl.error_message, 'Error de interfaz')   AS error_translated,
  sl.stack_trace                                     AS stack_trace,
  sl.component_name                                  AS component,
  COALESCE(sl.metadata->>'url', sl.metadata->>'path', '') AS page_url,
  NULL::text                                         AS action,
  COALESCE(sl.metadata, '{}'::jsonb)                AS metadata,
  false                                              AS is_resolved,
  true                                               AS is_live_error
FROM public.system_error_logs sl;

SELECT '20260429_unified_system_monitor ✅' AS resultado;
