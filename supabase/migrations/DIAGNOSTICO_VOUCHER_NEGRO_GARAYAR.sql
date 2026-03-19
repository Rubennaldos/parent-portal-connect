-- ============================================================
-- DIAGNÓSTICO: Voucher negro de Mario y Nicolás Garayar
-- Tickets T-BJU-000017 y T-BJU-000018, N° Operación 00285818
-- ============================================================

-- 1. Encontrar la recharge_request por número de operación
SELECT
  rr.id,
  rr.reference_code,
  rr.voucher_url,
  rr.status,
  rr.amount,
  rr.created_at,
  rr.parent_id,
  p.full_name   AS padre,
  p.email       AS email_padre,
  sc.name       AS sede
FROM recharge_requests rr
LEFT JOIN profiles p  ON p.id  = rr.parent_id
LEFT JOIN schools  sc ON sc.id = rr.school_id
WHERE rr.reference_code = '00285818'
ORDER BY rr.created_at DESC;

-- 2. Ver el archivo en storage.objects para ese voucher
-- (confirma si el archivo realmente existe y su tamaño)
SELECT
  name,
  bucket_id,
  metadata,
  created_at,
  updated_at,
  (metadata->>'size')::int AS size_bytes
FROM storage.objects
WHERE bucket_id = 'vouchers'
  AND created_at >= NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 10;
