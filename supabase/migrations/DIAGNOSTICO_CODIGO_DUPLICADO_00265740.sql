-- Verificar si el código de operación 00265740 ya existe en recharge_requests
SELECT
  id,
  status,
  request_type,
  amount,
  created_at,
  reference_code,
  student_id,
  parent_id
FROM recharge_requests
WHERE reference_code = '00265740'
  AND status != 'rejected';
