-- ============================================
-- ACTUALIZACIÓN: dev_backlog (solo partes nuevas)
-- Ejecutar si la tabla ya existía antes
-- ============================================

-- Nuevos índices (seguros con IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_dev_backlog_school   ON dev_backlog(reporter_school_id);
CREATE INDEX IF NOT EXISTS idx_dev_backlog_reporter ON dev_backlog(reporter_id);

-- FIX H2: Usuarios pueden leer sus propios tickets
-- (solo si no existe ya)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dev_backlog'
      AND policyname = 'users_read_own_tickets'
  ) THEN
    CREATE POLICY "users_read_own_tickets" ON dev_backlog
      FOR SELECT
      TO authenticated
      USING (reporter_id = auth.uid());
  END IF;
END $$;

-- Bucket de storage para capturas/videos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- Políticas del bucket (seguras con DO $$)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND policyname = 'users_upload_support_files'
  ) THEN
    CREATE POLICY "users_upload_support_files" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'support-attachments');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND policyname = 'public_read_support_files'
  ) THEN
    CREATE POLICY "public_read_support_files" ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'support-attachments');
  END IF;
END $$;

SELECT 'Actualización aplicada correctamente' AS resultado;
