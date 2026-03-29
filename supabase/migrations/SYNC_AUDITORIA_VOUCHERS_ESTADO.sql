-- ================================================================
-- SYNC_AUDITORIA_VOUCHERS_ESTADO.sql
-- Sincroniza el estado de auditoria_vouchers con recharge_requests.
--
-- Problema: cuando un voucher se aprueba desde el módulo de Cobranzas,
-- el campo auditoria_vouchers.estado_ia puede quedar en SOSPECHOSO o
-- RECHAZADO aunque la cobranza ya esté aprobada. Esto desincroniza la
-- vista de Auditoría y confunde al admin.
--
-- Este script corrige todos los registros desincronizados de una vez.
-- ================================================================

-- 1. Ver cuántos registros están desincronizados ANTES de corregir
SELECT
  av.estado_ia,
  rr.status AS estado_cobranza,
  COUNT(*) AS cantidad
FROM auditoria_vouchers av
JOIN recharge_requests rr ON rr.id = av.id_cobranza
WHERE av.estado_ia IN ('SOSPECHOSO', 'RECHAZADO')
  AND rr.status = 'approved'
GROUP BY av.estado_ia, rr.status
ORDER BY cantidad DESC;

-- 2. Actualizar auditoria_vouchers a VALIDO donde la cobranza ya fue aprobada
UPDATE auditoria_vouchers av
SET
  estado_ia = 'VALIDO',
  analisis_ia = jsonb_set(
    COALESCE(av.analisis_ia, '{}'::jsonb),
    '{motivo_sync}',
    '"[SYNC AUTOMÁTICO] Cobranza ya aprobada en módulo de Cobranzas. Estado actualizado a VALIDO."'::jsonb
  )
FROM recharge_requests rr
WHERE rr.id = av.id_cobranza
  AND av.estado_ia IN ('SOSPECHOSO', 'RECHAZADO')
  AND rr.status = 'approved';

-- 3. Verificar resultado — debe quedar 0 registros desincronizados
SELECT
  av.estado_ia,
  rr.status AS estado_cobranza,
  COUNT(*) AS cantidad_restante
FROM auditoria_vouchers av
JOIN recharge_requests rr ON rr.id = av.id_cobranza
WHERE av.estado_ia IN ('SOSPECHOSO', 'RECHAZADO')
  AND rr.status = 'approved'
GROUP BY av.estado_ia, rr.status;
