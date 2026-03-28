-- =============================================================================
-- DIAGNÓSTICO: ¿Quién puso el tope mensual? (ej. Annia Sofía — S/ 520)
-- SOLO LECTURA — no modifica nada.
--
-- IMPORTANTE (honesto):
-- - Los topes viven en public.students (limit_type, monthly_limit, …).
-- - El padre los cambia desde la app con un UPDATE normal; el sistema NO guarda
--   automáticamente "usuario X cambió monthly_limit a las HH:MM" salvo que
--   exista un trigger específico en tu base (poco común en este proyecto).
-- - En tu base NO hay students.updated_at: solo created_at (fecha de alta del registro).
--   Eso NO sirve para saber cuándo se cambió el tope.
-- =============================================================================

-- 0) Columnas relevantes en students (confirmación)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'students'
  AND column_name IN ('created_at', 'parent_id', 'monthly_limit', 'limit_type', 'daily_limit', 'weekly_limit');

-- 1) Alumno por nombre (ajusta el ILIKE si hace falta)
SELECT
  s.id,
  s.full_name,
  s.school_id,
  s.parent_id,
  s.limit_type,
  s.daily_limit,
  s.weekly_limit,
  s.monthly_limit,
  s.free_account,
  s.kiosk_disabled,
  s.balance,
  s.created_at
FROM public.students s
WHERE s.full_name ILIKE '%Annia%Cano%'
   OR s.full_name ILIKE '%Annia Sofía%'
ORDER BY s.full_name;

-- 2) Sustituye :STUDENT_ID por el UUID del paso 1 — perfil del padre/madre vinculado
-- SELECT
--   p.id,
--   p.email,
--   p.full_name,
--   p.role,
--   p.created_at
-- FROM public.profiles p
-- WHERE p.id = (SELECT parent_id FROM public.students WHERE id = ':STUDENT_ID'::uuid);

-- 3) Versión con subconsulta (un solo bloque si el nombre es único)
SELECT
  s.id AS student_id,
  s.full_name,
  s.limit_type,
  s.monthly_limit,
  s.parent_id,
  pp.user_id AS parent_user_id,
  pr.email   AS parent_email,
  pr.full_name AS parent_nombre_en_profiles,
  pr.role    AS parent_role,
  s.created_at
FROM public.students s
LEFT JOIN public.parent_profiles pp ON pp.user_id = s.parent_id
LEFT JOIN public.profiles pr ON pr.id = s.parent_id
WHERE s.full_name ILIKE '%Annia%Cano%'
LIMIT 5;

-- 4) Buscar si algo quedó en audit_logs (suele ser vacío para cambios de tope desde el portal)
SELECT al.id, al.action, al.timestamp, al.admin_user_id, al.target_user_id, al.details
FROM public.audit_logs al
WHERE al.details ILIKE '%520%'
   OR al.details ILIKE '%monthly%'
   OR al.details ILIKE '%tope%'
   OR al.details ILIKE '%limit%'
ORDER BY al.timestamp DESC
LIMIT 50;

-- 5) Si conoces el UUID del estudiante, buscar su id en texto dentro de audit_logs
-- SELECT * FROM public.audit_logs
-- WHERE details ILIKE '%xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx%'
-- ORDER BY timestamp DESC LIMIT 30;

-- =============================================================================
-- Si después de esto NO hay prueba de "quién":
-- - Revisar en Supabase: Project Settings → si tienen Database Webhooks / triggers.
-- - Plan Pro: Logs de API pueden mostrar requests al REST (no siempre el body).
-- - Conclusión típica: si limit_type = 'monthly' y monthly_limit = 520, lo más
--   probable es que alguien con sesión de padre guardó el modal de topes; el
--   sistema no deja rastro de usuario en la fila students.
-- - Sin updated_at en students: imposible ver por SQL "última vez que cambió el tope".
-- =============================================================================
