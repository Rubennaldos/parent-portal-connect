-- ═══════════════════════════════════════════════════════════════════════════
-- URGENTE: Forzar Kill Switch IA = DESACTIVADO en todos los registros
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA: La columna disable_voucher_ai puede tener FALSE en la BD
-- (ya sea porque la migración 20260404_voucher_ai_killswitch.sql no se
-- aplicó, o porque quedó con el valor por defecto incorrecto).
-- Mientras tenga FALSE, el motor IA llama a OpenAI en cada aprobación.
--
-- SOLUCIÓN INMEDIATA: Forzar TRUE en TODOS los registros.
-- Para reactivar la IA después: usar el toggle en Facturación → Config IA.
-- ═══════════════════════════════════════════════════════════════════════════

-- Paso 1: Añadir columna si no existe (idempotente)
ALTER TABLE billing_config
  ADD COLUMN IF NOT EXISTS disable_voucher_ai BOOLEAN NOT NULL DEFAULT TRUE;

-- Paso 2: Forzar TRUE en todos los registros existentes
UPDATE billing_config
SET    disable_voucher_ai = TRUE;

-- Paso 3: Verificar resultado
SELECT
  id,
  school_id,
  disable_voucher_ai,
  CASE
    WHEN disable_voucher_ai = TRUE  THEN '✅ Kill switch ACTIVO — IA desactivada'
    WHEN disable_voucher_ai = FALSE THEN '❌ Kill switch INACTIVO — IA activa'
    ELSE '⚠️ Valor nulo — check constraints'
  END AS estado
FROM billing_config
ORDER BY school_id;
