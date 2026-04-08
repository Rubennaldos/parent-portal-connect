-- ============================================================
-- REFACTOR CONTABLE: Nuevo estado 'failed' en billing_status
-- + Índice funcional para deudas de almuerzos (JSONB)
-- ============================================================
--
-- PROBLEMA RESUELTO:
--   Antes, cuando Nubefact fallaba, las transacciones se marcaban
--   como 'excluded'. Esto confundía dos conceptos distintos:
--     - 'excluded' = intencionalmente fuera de SUNAT (billetera
--       interna, efectivo sin boleta). Estado PERMANENTE.
--     - 'failed'   = Nubefact falló, necesita reintento. Estado
--       TEMPORAL hasta que el admin lo reenvíe.
--   Sin esta diferencia, CierreMensual y los reportes no podían
--   saber qué necesitaba atención y qué era correcto excluir.
--
-- ÍNDICE FUNCIONAL:
--   La subconsulta correlacionada en get_billing_consolidated_debtors
--   hace un scan secuencial de transactions por
--   metadata->>'lunch_order_id'. A escala (2000+ alumnos) esto es
--   la causa del timeout. El índice parcial elimina ese problema.
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- PARTE 1: Agregar 'failed' al CHECK constraint de billing_status
-- ════════════════════════════════════════════════════════════════

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_billing_status_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_billing_status_check
  CHECK (billing_status IN (
    'pending',      -- pendiente de enviar a SUNAT
    'processing',   -- en proceso de envío (bloqueo temporal del Cierre Mensual)
    'sent',         -- enviado y aceptado por SUNAT
    'error',        -- error técnico no catalogado (legacy)
    'excluded',     -- PERMANENTE: intencionalmente fuera de SUNAT
                    --   (efectivo sin comprobante, billetera interna,
                    --    recargas, ajustes, etc.)
    'failed'        -- TEMPORAL: Nubefact rechazó o falló en el intento
                    --   de emisión. Requiere reintento manual.
  ));

COMMENT ON COLUMN transactions.billing_status IS
  'Estado de emisión del comprobante electrónico (SUNAT/Nubefact).
   pending    = esperando ser boleteado
   processing = reservado por el Cierre Mensual (bloqueo temporal, TTL 10min)
   sent       = boleta/factura emitida y aceptada por SUNAT
   error      = error técnico genérico (legacy, no usar en código nuevo)
   excluded   = PERMANENTE: no va a SUNAT por diseño (efectivo, billetera, ajustes)
   failed     = TEMPORAL: Nubefact falló al intentar emitir; requiere reintento';


-- ════════════════════════════════════════════════════════════════
-- PARTE 2: Índice funcional para metadata->>'lunch_order_id'
-- ════════════════════════════════════════════════════════════════
-- Este índice parcial (solo filas con lunch_order_id presente)
-- elimina el scan secuencial de la subconsulta correlacionada en
-- get_billing_consolidated_debtors, que causaba timeouts a escala.
-- Tamaño estimado del índice: ~3-5% del índice completo.

CREATE INDEX IF NOT EXISTS idx_transactions_lunch_order_id
  ON transactions ((metadata->>'lunch_order_id'))
  WHERE (metadata->>'lunch_order_id') IS NOT NULL;

COMMENT ON INDEX idx_transactions_lunch_order_id IS
  'Índice parcial para acelerar la búsqueda de transacciones vinculadas
   a lunch_orders vía metadata JSONB. Elimina el scan secuencial de la
   subconsulta NOT EXISTS en get_billing_consolidated_debtors.';


-- ════════════════════════════════════════════════════════════════
-- PARTE 3: Índice de soporte en billing_status + is_taxable
-- (CierreMensual y escaneo de fallidas los usa constantemente)
-- ════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_transactions_billing_taxable
  ON transactions (billing_status, is_taxable, school_id)
  WHERE is_deleted = false;

COMMENT ON INDEX idx_transactions_billing_taxable IS
  'Índice compuesto para las consultas del Cierre Mensual y el
   escaneo de transacciones fallidas/excluidas facturables.';


-- ════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (ejecutar después para confirmar)
-- ════════════════════════════════════════════════════════════════

-- Confirmar que el constraint acepta 'failed':
-- INSERT INTO transactions (billing_status, ...) VALUES ('failed', ...) -- debe pasar
-- INSERT INTO transactions (billing_status, ...) VALUES ('fantasma', ...) -- debe fallar

-- Contar cuántas transacciones están en cada estado:
-- SELECT billing_status, COUNT(*) FROM transactions GROUP BY billing_status ORDER BY 2 DESC;

-- Contar cuántas son facturables y están 'failed' (requieren reintento):
-- SELECT COUNT(*), SUM(ABS(amount)) FROM transactions
-- WHERE billing_status = 'failed' AND is_taxable = true AND is_deleted = false;
