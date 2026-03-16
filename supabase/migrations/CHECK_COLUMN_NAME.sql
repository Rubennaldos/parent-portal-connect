-- Todas las transacciones PENDIENTES de Silvia kcomt desglosadas por mes
SELECT 
  to_char(t.created_at, 'YYYY-MM') AS mes,
  COUNT(*) AS num_transacciones,
  SUM(ABS(t.amount)) AS total,
  string_agg(t.ticket_code, ', ' ORDER BY t.created_at) AS tickets
FROM transactions t
WHERE t.teacher_id = '4aac52c0-6640-4b27-a2b6-96e0ef20d57a'
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status IN ('pending', 'partial')
GROUP BY to_char(t.created_at, 'YYYY-MM')
ORDER BY mes;
