-- Verificar transacciones de profesores que están marcadas como PAGADAS
SELECT 
  '🔍 Transacciones de PROFESORES marcadas como PAID' as info,
  t.id,
  t.description,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.created_at,
  tp.full_name as profesor,
  s.name as sede
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
LEFT JOIN schools s ON t.school_id = s.id
WHERE 
  t.teacher_id IS NOT NULL
  AND t.type = 'purchase'
  AND t.payment_status = 'paid'
ORDER BY t.created_at DESC;
