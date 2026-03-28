-- =============================================================================
-- Monto total PENDIENTE DE APROBAR por sede (vouchers / carrito de pagos)
-- Tabla: recharge_requests  |  status = 'pending'
-- Ejecutar en SQL Editor de Supabase (solo lectura).
-- =============================================================================

-- 1) Total por sede (nombre + suma + cantidad de solicitudes)
SELECT
  COALESCE(s.id::text, '(sin sede)') AS school_id,
  COALESCE(s.name, 'Sin sede asignada') AS sede,
  COUNT(*)::bigint AS solicitudes_pendientes,
  COALESCE(SUM(rr.amount), 0)::numeric(12, 2) AS monto_total_soles
FROM public.recharge_requests rr
LEFT JOIN public.schools s ON s.id = rr.school_id
WHERE rr.status = 'pending'
GROUP BY s.id, s.name
ORDER BY monto_total_soles DESC, sede;

-- 2) Total global pendiente (una sola fila)
SELECT
  COUNT(*)::bigint AS total_solicitudes,
  COALESCE(SUM(amount), 0)::numeric(12, 2) AS total_soles_pendiente_aprobar
FROM public.recharge_requests
WHERE status = 'pending';

/*
-- Opcional: desglose por tipo (solo si la columna request_type existe en recharge_requests)
SELECT
  COALESCE(s.name, 'Sin sede') AS sede,
  COALESCE(rr.request_type::text, 'recharge') AS tipo,
  COUNT(*)::bigint AS cantidad,
  COALESCE(SUM(rr.amount), 0)::numeric(12, 2) AS monto_soles
FROM public.recharge_requests rr
LEFT JOIN public.schools s ON s.id = rr.school_id
WHERE rr.status = 'pending'
GROUP BY s.name, s.id, COALESCE(rr.request_type::text, 'recharge')
ORDER BY sede, tipo;
*/
