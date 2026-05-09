-- ============================================================================
-- FIX: eliminar firma anterior de get_payments_report / count_payments_report
-- para resolver el conflicto de sobrecarga de función en PostgreSQL.
-- ============================================================================

-- Firma vieja sin p_op_number ni p_ticket_number
DROP FUNCTION IF EXISTS public.get_payments_report(
  uuid, text, text, text, text, text, integer, integer, integer
);

-- Firma vieja de count sin p_op_number ni p_ticket_number
DROP FUNCTION IF EXISTS public.count_payments_report(
  uuid, text, text, text, text, text, integer
);

SELECT 'Firmas antiguas eliminadas ✅' AS resultado;
