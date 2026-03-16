-- FIX: Cerrar todas las cajas legacy abiertas en cash_registers
UPDATE cash_registers
SET
  status = 'closed',
  closed_at = NOW(),
  actual_amount = COALESCE(initial_amount, 0),
  expected_amount = COALESCE(initial_amount, 0),
  difference = 0,
  notes = COALESCE(notes, '') || ' [Cerrado automáticamente - migración a sistema V2]'
WHERE status = 'open';

-- Verificar que ya no queden abiertas
SELECT COUNT(*) AS cajas_abiertas_restantes FROM cash_registers WHERE status = 'open';
