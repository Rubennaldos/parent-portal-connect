-- ============================================
-- FIX: ASIGNAR ticket_code A TRANSACCIONES QUE NO LO TIENEN
-- ============================================
-- Problema: Las transacciones creadas antes de la mejora de ticket_code
-- (especialmente almuerzos y compras de profesores antiguas) no tienen ticket_code.
-- 
-- Solución: Generar un ticket_code retroactivo basado en la fecha de creación
-- con formato: HIST-YYYYMMDD-NNN (donde NNN es un correlativo por día)
-- ============================================

-- PASO 0: Ver cuántas transacciones NO tienen ticket_code
SELECT 
  'Transacciones SIN ticket_code' as descripcion,
  COUNT(*) as cantidad
FROM transactions 
WHERE ticket_code IS NULL 
  AND type = 'purchase'
  AND is_deleted = false;

-- Ver cuántas SÍ tienen ticket_code  
SELECT 
  'Transacciones CON ticket_code' as descripcion,
  COUNT(*) as cantidad
FROM transactions 
WHERE ticket_code IS NOT NULL 
  AND type = 'purchase'
  AND is_deleted = false;

-- ============================================
-- PASO 1: ASIGNAR ticket_code RETROACTIVO
-- Formato: HIST-YYYYMMDD-NNN
-- Cada día tiene su propio correlativo empezando desde 001
-- ============================================

WITH numbered_transactions AS (
  SELECT 
    id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY DATE(created_at AT TIME ZONE 'America/Lima')
      ORDER BY created_at ASC
    ) as daily_number
  FROM transactions
  WHERE ticket_code IS NULL
    AND type = 'purchase'
    AND is_deleted = false
)
UPDATE transactions t
SET ticket_code = 'HIST-' || 
  TO_CHAR(nt.created_at AT TIME ZONE 'America/Lima', 'YYYYMMDD') || 
  '-' || 
  LPAD(nt.daily_number::TEXT, 3, '0')
FROM numbered_transactions nt
WHERE t.id = nt.id;

-- ============================================
-- PASO 2: VERIFICAR RESULTADOS
-- ============================================

-- Verificar que ya no quedan transacciones sin ticket_code
SELECT 
  'Transacciones SIN ticket_code (después del fix)' as descripcion,
  COUNT(*) as cantidad
FROM transactions 
WHERE ticket_code IS NULL 
  AND type = 'purchase'
  AND is_deleted = false;

-- Mostrar algunos ejemplos de los tickets generados
SELECT 
  ticket_code,
  description,
  created_at AT TIME ZONE 'America/Lima' as fecha_lima,
  payment_status,
  amount
FROM transactions
WHERE ticket_code LIKE 'HIST-%'
  AND type = 'purchase'
ORDER BY created_at DESC
LIMIT 20;

-- Resumen por día
SELECT 
  DATE(created_at AT TIME ZONE 'America/Lima') as fecha,
  COUNT(*) as tickets_generados,
  MIN(ticket_code) as primer_ticket,
  MAX(ticket_code) as ultimo_ticket
FROM transactions
WHERE ticket_code LIKE 'HIST-%'
  AND type = 'purchase'
GROUP BY DATE(created_at AT TIME ZONE 'America/Lima')
ORDER BY fecha DESC;
