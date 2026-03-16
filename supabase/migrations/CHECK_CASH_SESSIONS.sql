-- ¿Qué fechas tienen caja registrada?
SELECT
  school_id,
  session_date,
  status,
  opened_at,
  closed_at
FROM cash_sessions
ORDER BY session_date DESC
LIMIT 20;
