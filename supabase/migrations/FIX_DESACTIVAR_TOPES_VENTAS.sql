-- =====================================================================
-- Desactivar el trigger de topes que puede bloquear ventas del kiosco
-- Los topes no deben interferir con ninguna venta
-- =====================================================================

-- Desactivar el trigger de validación de límite diario
DROP TRIGGER IF EXISTS trigger_validate_daily_limit ON transactions;

-- Verificar que ya no existe
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ Trigger desactivado — las ventas ya no serán bloqueadas por topes'
    ELSE '❌ El trigger aún existe'
  END AS resultado
FROM pg_trigger tg
WHERE tg.tgrelid = 'transactions'::regclass
  AND tg.tgname = 'trigger_validate_daily_limit';
