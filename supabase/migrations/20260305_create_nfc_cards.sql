-- ═══════════════════════════════════════════════════════════
-- MIGRACIÓN: Tabla de Tarjetas NFC
-- Vincula tarjetas físicas NFC con estudiantes o profesores
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nfc_cards (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  card_uid      TEXT        UNIQUE NOT NULL,         -- UID del chip NFC (leído por el lector USB)
  card_number   TEXT,                                -- Número visible en la tarjeta (001, 002, ...)
  holder_type   TEXT        CHECK (holder_type IN ('student', 'teacher')),
  student_id    UUID        REFERENCES students(id)  ON DELETE SET NULL,
  teacher_id    UUID        REFERENCES profiles(id)  ON DELETE SET NULL,
  school_id     UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  notes         TEXT,
  assigned_at   TIMESTAMPTZ,
  assigned_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Solo un titular por tarjeta, coherente con el tipo
  CONSTRAINT chk_holder_consistency CHECK (
    (holder_type = 'student'  AND student_id IS NOT NULL AND teacher_id IS NULL) OR
    (holder_type = 'teacher'  AND teacher_id IS NOT NULL AND student_id IS NULL) OR
    (holder_type IS NULL      AND student_id IS NULL     AND teacher_id IS NULL)
  )
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_nfc_cards_card_uid    ON nfc_cards(card_uid);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_student_id  ON nfc_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_teacher_id  ON nfc_cards(teacher_id);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_school_id   ON nfc_cards(school_id);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_is_active   ON nfc_cards(is_active);

-- Trigger: actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_nfc_cards_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfc_cards_updated_at ON nfc_cards;
CREATE TRIGGER trg_nfc_cards_updated_at
  BEFORE UPDATE ON nfc_cards
  FOR EACH ROW EXECUTE FUNCTION update_nfc_cards_updated_at();

-- ───────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ───────────────────────────────────────────────
ALTER TABLE nfc_cards ENABLE ROW LEVEL SECURITY;

-- 1. Superadmin: acceso total
CREATE POLICY "nfc_superadmin_all" ON nfc_cards
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

-- 2. Admin General y Gestor de Unidad: gestión completa de su sede
CREATE POLICY "nfc_admin_manage" ON nfc_cards
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'gestor_unidad')
        AND p.school_id = nfc_cards.school_id
    )
  );

-- 3. Operador de Caja: solo lectura de tarjetas de su sede (para el POS)
CREATE POLICY "nfc_cajero_read" ON nfc_cards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'operador_caja'
        AND p.school_id = nfc_cards.school_id
    )
  );

-- ───────────────────────────────────────────────
-- FUNCIÓN RPC: Buscar titular por UID de tarjeta
-- Usada por el POS al escanear una tarjeta NFC
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_nfc_holder(p_card_uid TEXT)
RETURNS TABLE (
  holder_type   TEXT,
  student_id    UUID,
  student_name  TEXT,
  student_grade TEXT,
  student_section TEXT,
  student_balance NUMERIC,
  student_free_account BOOLEAN,
  student_kiosk_disabled BOOLEAN,
  student_limit_type TEXT,
  student_daily_limit NUMERIC,
  student_weekly_limit NUMERIC,
  student_monthly_limit NUMERIC,
  student_school_id UUID,
  teacher_id    UUID,
  teacher_name  TEXT,
  card_number   TEXT,
  is_active     BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.holder_type,
    nc.student_id,
    s.full_name        AS student_name,
    s.grade            AS student_grade,
    s.section          AS student_section,
    s.balance          AS student_balance,
    s.free_account     AS student_free_account,
    s.kiosk_disabled   AS student_kiosk_disabled,
    s.limit_type::TEXT AS student_limit_type,
    s.daily_limit      AS student_daily_limit,
    s.weekly_limit     AS student_weekly_limit,
    s.monthly_limit    AS student_monthly_limit,
    s.school_id        AS student_school_id,
    nc.teacher_id,
    p.full_name        AS teacher_name,
    nc.card_number,
    nc.is_active
  FROM nfc_cards nc
  LEFT JOIN students  s ON s.id = nc.student_id
  LEFT JOIN profiles  p ON p.id = nc.teacher_id
  WHERE nc.card_uid = p_card_uid
  LIMIT 1;
END;
$$;
