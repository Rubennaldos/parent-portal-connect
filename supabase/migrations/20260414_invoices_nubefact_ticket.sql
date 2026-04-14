-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: invoices — columna nubefact_ticket + índices de polling
-- Fecha: 2026-04-14
--
-- PROPÓSITO:
--   Infraestructura de persistencia para el futuro poller de estado SUNAT.
--   Cuando Nubefact devuelve sunat_status='processing', guarda el ticket de
--   consulta para que el poller pueda recuperar la respuesta final de SUNAT.
--
-- CAMBIOS:
--   A. Columna nubefact_ticket (text, nullable) en invoices
--      → Almacena el identificador de ticket que devuelve Nubefact en respuestas
--        asíncronas (cuando SUNAT no confirma en la misma llamada HTTP).
--
--   B. Índice idx_invoices_nubefact_ticket
--      → Optimiza la consulta del poller: WHERE nubefact_ticket IS NOT NULL
--
--   C. Índice idx_invoices_sunat_status
--      → Optimiza el filtro principal del poller: WHERE sunat_status = 'processing'
--        Sin este índice, la tabla de miles de invoices requeriría un seq scan completo
--        en cada ciclo de polling.
--
--   D. Índice compuesto idx_invoices_pending_polling
--      → Cubre el patrón exacto de la query del poller:
--        WHERE sunat_status = 'processing' AND nubefact_ticket IS NOT NULL
--        Un solo índice parcial es más eficiente que dos índices separados.
-- ══════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE A: Columna nubefact_ticket
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS nubefact_ticket TEXT;

COMMENT ON COLUMN invoices.nubefact_ticket IS
  'Identificador de ticket devuelto por Nubefact cuando SUNAT no confirma en
   tiempo real (sunat_status = processing). El poller usa este valor para
   consultar el estado final con operacion=consultar_estado_ticket.
   NULL = no aplica (respuesta inmediata o error).';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE B: Índice en nubefact_ticket
-- Parcial: solo filas donde existe un ticket (excluye la mayoría de registros)
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_invoices_nubefact_ticket
  ON invoices (nubefact_ticket)
  WHERE nubefact_ticket IS NOT NULL;

COMMENT ON INDEX idx_invoices_nubefact_ticket IS
  'Acceso directo por ticket de Nubefact para el poller de estado.
   Parcial (nubefact_ticket IS NOT NULL) → ocupa ~0 espacio hasta que haya tickets.';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE C: Índice en sunat_status
-- Parcial: solo filas en estado transitorio que el poller debe revisar
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_invoices_sunat_status_processing
  ON invoices (sunat_status, created_at DESC)
  WHERE sunat_status = 'processing';

COMMENT ON INDEX idx_invoices_sunat_status_processing IS
  'Acelera el filtro del poller: WHERE sunat_status = processing.
   Incluye created_at DESC para recuperar primero los más recientes.
   Parcial → crece solo con registros en limbo, no con toda la tabla.';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE D: Índice compuesto para el patrón exacto del poller
-- Cubre: WHERE sunat_status = 'processing' AND nubefact_ticket IS NOT NULL
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_invoices_pending_polling
  ON invoices (school_id, created_at DESC)
  WHERE sunat_status = 'processing'
    AND nubefact_ticket IS NOT NULL;

COMMENT ON INDEX idx_invoices_pending_polling IS
  'Índice óptimo para el query del poller agrupado por sede:
   SELECT * FROM invoices
   WHERE sunat_status = processing AND nubefact_ticket IS NOT NULL
   ORDER BY school_id, created_at DESC
   El Planner usará este índice en lugar de los dos parciales por separado.';


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN: confirmar que la columna e índices existen
-- ════════════════════════════════════════════════════════════════════════════

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'invoices'
  AND column_name  = 'nubefact_ticket';

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'invoices'
  AND indexname IN (
    'idx_invoices_nubefact_ticket',
    'idx_invoices_sunat_status_processing',
    'idx_invoices_pending_polling'
  );

SELECT 'Migración 20260414_invoices_nubefact_ticket OK' AS resultado;
