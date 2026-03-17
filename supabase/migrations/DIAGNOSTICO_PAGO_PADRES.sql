-- ============================================================
-- DIAGNÓSTICO: Por qué los padres no pueden enviar su comprobante
-- Ejecutar bloque por bloque en Supabase → SQL Editor
-- ============================================================

-- ═══════════════════════════════════════════════════
-- BLOQUE 1: ¿El bucket 'vouchers' existe y es público?
-- Si no sale ninguna fila, el bucket NO existe → los padres no pueden subir fotos
-- ═══════════════════════════════════════════════════
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets
WHERE name = 'vouchers';

-- ═══════════════════════════════════════════════════
-- BLOQUE 2: ¿El bucket tiene política para que padres puedan subir fotos?
-- Debe existir una política con cmd = 'INSERT' para usuarios autenticados
-- ═══════════════════════════════════════════════════
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
ORDER BY policyname;

-- ═══════════════════════════════════════════════════
-- BLOQUE 3: ¿Los alumnos tienen school_id? (si es null, el modal puede fallar)
-- Muestra cuántos alumnos activos NO tienen sede asignada
-- ═══════════════════════════════════════════════════
SELECT
  COUNT(*) FILTER (WHERE school_id IS NULL) AS sin_school_id,
  COUNT(*) FILTER (WHERE school_id IS NOT NULL) AS con_school_id,
  COUNT(*) AS total
FROM students
WHERE is_active = true;

-- ═══════════════════════════════════════════════════
-- BLOQUE 4: ¿billing_config está configurada para cada sede?
-- Si una sede no tiene fila aquí, el modal dice "sin métodos de pago"
-- y el botón queda deshabilitado
-- ═══════════════════════════════════════════════════
SELECT
  s.name AS sede,
  bc.yape_enabled,
  bc.yape_number,
  bc.plin_enabled,
  bc.plin_number,
  bc.transferencia_enabled,
  bc.bank_account_info
FROM schools s
LEFT JOIN billing_config bc ON bc.school_id = s.id
ORDER BY s.name;

-- ═══════════════════════════════════════════════════
-- BLOQUE 5: ¿Cuántos padres tienen vouchers BLOQUEADOS (pendientes sin aprobar)?
-- Si un padre ya tiene un voucher pending para las mismas deudas,
-- el sistema bloquea el re-envío
-- ═══════════════════════════════════════════════════
SELECT
  status,
  request_type,
  COUNT(*) AS total
FROM recharge_requests
GROUP BY status, request_type
ORDER BY status, request_type;

-- ═══════════════════════════════════════════════════
-- BLOQUE 6: ¿Hay políticas RLS en recharge_requests que bloqueen el INSERT?
-- ═══════════════════════════════════════════════════
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'recharge_requests'
ORDER BY cmd, policyname;
