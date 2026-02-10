-- =====================================================
-- VERIFICAR TRANSACCIONES DE SARINA DESPUÉS DE LA LIMPIEZA
-- =====================================================

SELECT 
  '✅ SARINA - Estado Final' as resultado,
  t.id,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as creado,
  t.payment_status
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Sarina%'
  AND DATE(t.created_at) >= '2026-02-08'
ORDER BY t.created_at;
