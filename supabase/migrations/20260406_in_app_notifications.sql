-- ═══════════════════════════════════════════════════════════════════════════
-- BUZÓN DE MENSAJES IN-APP — Sistema de notificaciones para padres
-- Fecha: 2026-04-06
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tabla principal ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        REFERENCES schools(id) ON DELETE CASCADE,

  -- Si user_id es NULL → comunicado global (para todos los padres de esa sede)
  -- Si user_id tiene valor → mensaje personal a ese padre
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,

  title       varchar(255) NOT NULL,
  message     text         NOT NULL,

  -- 'info' | 'reminder' | 'alert' | 'payment'
  type        varchar(50)  NOT NULL DEFAULT 'info'
              CHECK (type IN ('info', 'reminder', 'alert', 'payment')),

  is_read     boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT NOW(),

  -- Quién envió el comunicado (admin que hizo INSERT)
  sent_by     uuid         REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_notifications_user_school
  ON in_app_notifications (user_id, school_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_global
  ON in_app_notifications (school_id, is_read, created_at DESC)
  WHERE user_id IS NULL;

COMMENT ON TABLE in_app_notifications IS
  'Buzón de mensajes in-app. user_id NULL = comunicado global para toda la sede.';

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE in_app_notifications ENABLE ROW LEVEL SECURITY;

-- Padres pueden VER sus notificaciones personales O las globales de su sede
-- La relación padre-alumno está en students.parent_id (no hay tabla intermedia)
CREATE POLICY "padres_select_notif" ON in_app_notifications
  FOR SELECT USING (
    -- El padre ve notificaciones dirigidas a él directamente
    (user_id = auth.uid())
    OR
    -- O notificaciones globales de su sede
    (user_id IS NULL AND school_id IN (
      SELECT s.school_id
      FROM students s
      WHERE s.parent_id = auth.uid()
        AND s.is_active = true
      LIMIT 1
    ))
  );

-- Padres pueden marcar sus notificaciones como leídas (UPDATE is_read)
CREATE POLICY "padres_update_notif" ON in_app_notifications
  FOR UPDATE USING (
    (user_id = auth.uid())
    OR
    (user_id IS NULL AND school_id IN (
      SELECT s.school_id
      FROM students s
      WHERE s.parent_id = auth.uid()
        AND s.is_active = true
      LIMIT 1
    ))
  )
  WITH CHECK (true);

-- Admins pueden hacer todo en su sede
CREATE POLICY "admins_all_notif" ON in_app_notifications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'superadmin', 'gestor_unidad')
        AND (
          p.role IN ('admin_general', 'superadmin')
          OR p.school_id = in_app_notifications.school_id
        )
    )
  );

-- ── Vista auxiliar: conteo de no-leídos por padre ─────────────────────────
-- Usa students.parent_id (no hay tabla intermedia en este proyecto)
CREATE OR REPLACE VIEW v_parent_unread_count AS
SELECT
  COALESCE(n.user_id, auth.uid())              AS parent_id,
  COUNT(*)                                      AS unread_count
FROM in_app_notifications n
WHERE is_read = false
  AND (
    n.user_id = auth.uid()
    OR (n.user_id IS NULL AND n.school_id IN (
      SELECT s.school_id FROM students s
      WHERE s.parent_id = auth.uid()
        AND s.is_active = true
    ))
  )
GROUP BY COALESCE(n.user_id, auth.uid());

-- ── Datos de prueba (comentados — descomentar para testing) ───────────────
-- INSERT INTO in_app_notifications (school_id, user_id, title, message, type)
-- SELECT id, NULL, '¡Bienvenido al Buzón!', 'Desde aquí recibirás comunicados del colegio.', 'info'
-- FROM schools LIMIT 1;

SELECT 'Tabla in_app_notifications creada con RLS activo' AS resultado;
