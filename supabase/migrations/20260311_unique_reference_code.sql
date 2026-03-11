-- ============================================================
-- Índice UNIQUE parcial en reference_code
-- Evita que el mismo código de operación se use 2 veces
-- (excepto si fue rechazado)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_recharge_unique_ref_code 
ON recharge_requests(reference_code) 
WHERE status != 'rejected' AND reference_code IS NOT NULL AND reference_code != '';

SELECT 'idx_recharge_unique_ref_code creado correctamente' AS resultado;
