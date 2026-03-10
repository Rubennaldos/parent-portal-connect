-- ═══════════════════════════════════════════════════════════
-- FIX: get_nfc_holder — tipos incompatibles con students
--
-- Problema: "structure of query does not match function result type"
-- Causa: students.balance es REAL/FLOAT, no NUMERIC.
-- Fix: Usar casts explícitos y tipos flexibles.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_nfc_holder(TEXT);

CREATE OR REPLACE FUNCTION get_nfc_holder(p_card_uid TEXT)
RETURNS TABLE (
  holder_type            TEXT,
  student_id             UUID,
  student_name           TEXT,
  student_grade          TEXT,
  student_section        TEXT,
  student_balance        FLOAT8,
  student_free_account   BOOLEAN,
  student_kiosk_disabled BOOLEAN,
  student_limit_type     TEXT,
  student_daily_limit    FLOAT8,
  student_weekly_limit   FLOAT8,
  student_monthly_limit  FLOAT8,
  student_school_id      UUID,
  teacher_id             UUID,
  teacher_name           TEXT,
  card_number            TEXT,
  is_active              BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.holder_type::TEXT,
    nc.student_id,
    s.full_name::TEXT           AS student_name,
    s.grade::TEXT               AS student_grade,
    s.section::TEXT             AS student_section,
    s.balance::FLOAT8           AS student_balance,
    s.free_account::BOOLEAN     AS student_free_account,
    s.kiosk_disabled::BOOLEAN   AS student_kiosk_disabled,
    s.limit_type::TEXT          AS student_limit_type,
    s.daily_limit::FLOAT8       AS student_daily_limit,
    s.weekly_limit::FLOAT8      AS student_weekly_limit,
    s.monthly_limit::FLOAT8     AS student_monthly_limit,
    s.school_id                 AS student_school_id,
    nc.teacher_id,
    p.full_name::TEXT           AS teacher_name,
    nc.card_number::TEXT,
    nc.is_active
  FROM nfc_cards nc
  LEFT JOIN students  s ON s.id = nc.student_id
  LEFT JOIN profiles  p ON p.id = nc.teacher_id
  WHERE nc.card_uid = p_card_uid
  LIMIT 1;
END;
$$;
