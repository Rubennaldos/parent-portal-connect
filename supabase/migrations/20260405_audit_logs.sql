-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs: registro de acciones sensibles (impersonación, reseteos, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text        NOT NULL,                        -- 'impersonate_success', 'impersonate_attempt_denied', etc.
  actor_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  actor_role   text,
  target_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email text,
  target_role  text,
  target_name  text,
  details      jsonb       DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);

-- Índices para búsquedas rápidas en el panel de auditoría
CREATE INDEX IF NOT EXISTS audit_logs_action_idx      ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx    ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_target_id_idx   ON audit_logs (target_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx  ON audit_logs (created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Solo superadmin y admin_general pueden leer los logs de auditoría
DROP POLICY IF EXISTS "audit_logs_read_admins" ON audit_logs;
CREATE POLICY "audit_logs_read_admins" ON audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('superadmin', 'admin_general')
    )
  );

-- Escritura solo desde service_role (Edge Functions) — nunca desde el frontend
-- (no CREATE POLICY para INSERT — solo service_role puede insertar)

COMMENT ON TABLE audit_logs IS
  'Registro de acciones administrativas sensibles: impersonación, reseteos de contraseña, cambios masivos, etc.';
