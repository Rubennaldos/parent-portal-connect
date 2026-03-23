-- ============================================================
-- FIX MANTENIMIENTO: Poner todos en cuenta libre temporalmente
-- La tabla students no tiene metadata, así que solo cambiamos free_account
-- El valor original ya está implícito: free_account = false significa "Con Recargas"
-- Para restaurar después: UPDATE students SET free_account = false WHERE ...
-- ============================================================

-- PASO 1: Ver cuántos están bloqueados
SELECT
  COUNT(*)                    AS total_bloqueados,
  SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS con_saldo,
  SUM(CASE WHEN balance <= 0 OR balance IS NULL THEN 1 ELSE 0 END) AS sin_saldo
FROM students
WHERE free_account = false
  AND kiosk_disabled = false;

-- PASO 2: FIX — poner todos en cuenta libre
-- (sin metadata, solo cambiar el flag)
UPDATE students
SET free_account = true
WHERE free_account = false
  AND kiosk_disabled = false;

-- VERIFICACIÓN: debe devolver 0
SELECT COUNT(*) AS siguen_bloqueados
FROM students
WHERE free_account = false
  AND (balance IS NULL OR balance <= 0)
  AND kiosk_disabled = false;
