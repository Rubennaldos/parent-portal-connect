-- ====================================================
-- LISTA SIMPLE: Padres que recargaron (para admin)
-- ====================================================
-- Vista rápida para que el admin decida quién necesita devolución

SELECT
  ROW_NUMBER() OVER (ORDER BY rr.created_at DESC) AS numero,
  p.email AS email_padre,
  p.full_name AS nombre_padre,
  s.full_name AS nombre_hijo,
  s.grade AS grado,
  s.section AS seccion,
  rr.amount AS monto_recargado,
  s.balance AS saldo_actual,
  rr.created_at::date AS fecha_recarga,
  sch.name AS colegio,
  -- Verificar si hay almuerzos pagados con saldo (NO debería pasar)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.student_id = s.id
        AND t.type = 'purchase'
        AND t.payment_method = 'saldo'
        AND t.metadata->>'lunch_order_id' IS NOT NULL
        AND t.payment_status = 'paid'
        AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
    ) THEN '🚨 DEVOLVER (usó saldo para almuerzo)'
    WHEN s.balance > 0 THEN '✅ Saldo disponible'
    WHEN s.balance = 0 THEN '⚠️ Saldo ya usado'
    ELSE '❓ Revisar'
  END AS accion_requerida
FROM recharge_requests rr
INNER JOIN students s ON rr.student_id = s.id
INNER JOIN profiles p ON s.parent_id = p.id
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE rr.status = 'approved'
  AND rr.created_at >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY 
  CASE
    WHEN EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.student_id = s.id
        AND t.type = 'purchase'
        AND t.payment_method = 'saldo'
        AND t.metadata->>'lunch_order_id' IS NOT NULL
        AND t.payment_status = 'paid'
        AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
    ) THEN 1  -- Urgentes primero
    ELSE 2
  END,
  rr.created_at DESC;
