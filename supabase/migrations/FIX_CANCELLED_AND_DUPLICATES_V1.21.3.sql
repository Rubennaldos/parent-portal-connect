-- ========================================
-- FIX PARA VERSIÓN 1.21.3
-- Corrige 2 problemas críticos:
-- 1. Transacciones de pedidos cancelados que no se cancelaron
-- 2. Transacciones duplicadas por lunch_orders_confirm
-- ========================================

BEGIN;

-- ========================================
-- PASO 0: AGREGAR 'cancelled' AL CONSTRAINT (SI NO EXISTE)
-- ========================================

DO $$
DECLARE
  v_constraint_def TEXT;
BEGIN
  -- Verificar los valores actuales permitidos
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conname = 'transactions_payment_status_check'
    AND conrelid = 'transactions'::regclass;
  
  RAISE NOTICE '📋 Constraint actual: %', COALESCE(v_constraint_def, 'No existe');
  
  -- Eliminar el constraint antiguo si existe
  IF v_constraint_def IS NOT NULL THEN
    ALTER TABLE transactions DROP CONSTRAINT transactions_payment_status_check;
    RAISE NOTICE '🗑️ Constraint antiguo eliminado';
  END IF;
  
  -- Crear el nuevo constraint con 'cancelled' incluido
  ALTER TABLE transactions 
  ADD CONSTRAINT transactions_payment_status_check 
  CHECK (payment_status IN ('pending', 'paid', 'partial', 'cancelled'));
  
  RAISE NOTICE '✅ Constraint actualizado: ahora acepta "cancelled"';
END $$;

-- ========================================
-- PASO 1: DIAGNÓSTICO INICIAL (TODAS LAS SEDES)
-- ========================================

DO $$
DECLARE
  v_cancelled_count INTEGER;
  v_duplicate_count INTEGER;
BEGIN
  -- Contar transacciones de pedidos cancelados (TODAS LAS SEDES)
  SELECT COUNT(*) INTO v_cancelled_count
  FROM lunch_orders lo
  INNER JOIN transactions t ON t.metadata->>'lunch_order_id' = lo.id::text
  WHERE lo.is_cancelled = true
    AND t.payment_status IN ('pending', 'paid', 'partial');
  
  RAISE NOTICE '🚨 TODAS LAS SEDES: Encontradas % transacciones de pedidos cancelados', v_cancelled_count;

  -- Contar transacciones duplicadas (TODAS LAS SEDES)
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT t.metadata->>'lunch_order_id' as lunch_order_id
    FROM transactions t
    WHERE t.metadata->>'lunch_order_id' IS NOT NULL
      AND t.payment_status IN ('pending', 'paid', 'partial')
    GROUP BY t.metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  ) duplicates;
  
  RAISE NOTICE '🚨 TODAS LAS SEDES: Encontrados % lunch_orders con duplicados', v_duplicate_count;
END $$;

-- ========================================
-- PASO 2: CANCELAR TRANSACCIONES DE PEDIDOS CANCELADOS (TODAS LAS SEDES)
-- ========================================

UPDATE transactions t
SET 
  payment_status = 'cancelled',
  metadata = jsonb_set(
    COALESCE(t.metadata, '{}'::jsonb),
    '{cancelled_reason}',
    '"Pedido cancelado por el usuario"'::jsonb
  )
FROM lunch_orders lo
WHERE t.metadata->>'lunch_order_id' = lo.id::text
  AND lo.is_cancelled = true
  AND t.payment_status IN ('pending', 'paid', 'partial')
  AND t.type = 'purchase';

-- Mostrar resultado
DO $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE '✅ TODAS LAS SEDES: Se cancelaron % transacciones de pedidos cancelados', v_updated_count;
END $$;

-- ========================================
-- PASO 3: ELIMINAR TRANSACCIONES DUPLICADAS (TODAS LAS SEDES)
-- ========================================

-- Estrategia: Conservar la transacción más antigua (la del profesor/padre)
-- Cancelar las transacciones de 'lunch_orders_confirm' si ya existe otra

WITH duplicates AS (
  SELECT 
    t.id,
    t.metadata->>'lunch_order_id' as lunch_order_id,
    t.metadata->>'source' as source,
    t.created_at,
    s.name as school_name,
    ROW_NUMBER() OVER (
      PARTITION BY t.metadata->>'lunch_order_id' 
      ORDER BY 
        -- Priorizar las transacciones del profesor/padre (no de confirm)
        CASE WHEN t.metadata->>'source' = 'lunch_orders_confirm' THEN 2 ELSE 1 END,
        t.created_at ASC
    ) as rn
  FROM transactions t
  LEFT JOIN schools s ON s.id = t.school_id
  WHERE t.metadata->>'lunch_order_id' IS NOT NULL
    AND t.payment_status IN ('pending', 'paid', 'partial')
)
UPDATE transactions t
SET payment_status = 'cancelled',
    metadata = jsonb_set(
      COALESCE(t.metadata, '{}'::jsonb),
      '{cancelled_reason}',
      '"Transacción duplicada - se conservó la original"'::jsonb
    )
FROM duplicates d
WHERE t.id = d.id
  AND d.rn > 1;  -- Solo cancelar las duplicadas (mantener la primera)

-- Mostrar resultado con desglose por sede
DO $$
DECLARE
  v_cancelled_duplicates INTEGER;
BEGIN
  GET DIAGNOSTICS v_cancelled_duplicates = ROW_COUNT;
  RAISE NOTICE '✅ TODAS LAS SEDES: Se cancelaron % transacciones duplicadas', v_cancelled_duplicates;
END $$;

-- Mostrar desglose por sede
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '📊 DESGLOSE POR SEDE:';
  FOR r IN (
    SELECT 
      COALESCE(s.name, 'Sin sede asignada') as sede,
      COUNT(*) as cantidad
    FROM transactions t
    LEFT JOIN schools s ON s.id = t.school_id
    WHERE t.payment_status = 'cancelled'
      AND t.metadata->>'cancelled_reason' = 'Transacción duplicada - se conservó la original'
    GROUP BY s.name
    ORDER BY cantidad DESC
  ) LOOP
    RAISE NOTICE '  - %: % duplicados cancelados', r.sede, r.cantidad;
  END LOOP;
END $$;

-- ========================================
-- PASO 4: CREAR TRIGGER PARA PREVENIR DUPLICADOS FUTUROS
-- ========================================

-- Función que previene crear transacciones duplicadas
CREATE OR REPLACE FUNCTION prevent_duplicate_lunch_transaction()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_count INTEGER;
  v_lunch_order_id TEXT;
BEGIN
  -- Solo aplicar si es una transacción de almuerzo con lunch_order_id
  IF NEW.metadata ? 'lunch_order_id' AND NEW.type = 'purchase' THEN
    v_lunch_order_id := NEW.metadata->>'lunch_order_id';
    
    -- Verificar si ya existe otra transacción para el mismo lunch_order
    SELECT COUNT(*) INTO v_existing_count
    FROM transactions
    WHERE metadata->>'lunch_order_id' = v_lunch_order_id
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND payment_status != 'cancelled';
    
    IF v_existing_count > 0 THEN
      RAISE NOTICE '⚠️ Ya existe una transacción para lunch_order_id: %. No se creará duplicado.', v_lunch_order_id;
      -- Retornar NULL para cancelar la inserción
      RETURN NULL;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger (solo en INSERT para no afectar UPDATEs legítimos)
DROP TRIGGER IF EXISTS trigger_prevent_duplicate_lunch_transaction ON transactions;
CREATE TRIGGER trigger_prevent_duplicate_lunch_transaction
  BEFORE INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_lunch_transaction();

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Trigger anti-duplicados creado correctamente';
END $$;

-- ========================================
-- PASO 5: VERIFICACIÓN FINAL (TODAS LAS SEDES)
-- ========================================

DO $$
DECLARE
  v_active_cancelled INTEGER;
  v_active_duplicates INTEGER;
  r RECORD;
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE '🔍 VERIFICACIÓN FINAL - TODAS LAS SEDES';
  RAISE NOTICE '============================================';

  -- Verificar que no queden transacciones activas de pedidos cancelados
  SELECT COUNT(*) INTO v_active_cancelled
  FROM lunch_orders lo
  INNER JOIN transactions t ON t.metadata->>'lunch_order_id' = lo.id::text
  WHERE lo.is_cancelled = true
    AND t.payment_status IN ('pending', 'paid', 'partial');
  
  IF v_active_cancelled > 0 THEN
    RAISE WARNING '⚠️ Aún quedan % transacciones activas de pedidos cancelados', v_active_cancelled;
  ELSE
    RAISE NOTICE '✅ Todas las transacciones de pedidos cancelados están corregidas';
  END IF;

  -- Verificar que no queden duplicados activos
  SELECT COUNT(*) INTO v_active_duplicates
  FROM (
    SELECT t.metadata->>'lunch_order_id' as lunch_order_id
    FROM transactions t
    WHERE t.metadata->>'lunch_order_id' IS NOT NULL
      AND t.payment_status IN ('pending', 'paid', 'partial')
    GROUP BY t.metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  ) dups;
  
  IF v_active_duplicates > 0 THEN
    RAISE WARNING '⚠️ Aún quedan % lunch_orders con duplicados activos', v_active_duplicates;
  ELSE
    RAISE NOTICE '✅ Todas las transacciones duplicadas están corregidas';
  END IF;

  -- Resumen por sede
  RAISE NOTICE '';
  RAISE NOTICE '📊 RESUMEN DE CORRECCIONES POR SEDE:';
  FOR r IN (
    SELECT 
      COALESCE(s.name, 'Sin sede') as sede,
      COUNT(*) FILTER (WHERE t.metadata->>'cancelled_reason' = 'Pedido cancelado por el usuario') as pedidos_cancelados,
      COUNT(*) FILTER (WHERE t.metadata->>'cancelled_reason' = 'Transacción duplicada - se conservó la original') as duplicados_eliminados
    FROM transactions t
    LEFT JOIN schools s ON s.id = t.school_id
    WHERE t.payment_status = 'cancelled'
      AND t.metadata ? 'cancelled_reason'
    GROUP BY s.name
    ORDER BY (COUNT(*)) DESC
  ) LOOP
    RAISE NOTICE '  📍 %:', r.sede;
    RAISE NOTICE '     - Pedidos cancelados corregidos: %', r.pedidos_cancelados;
    RAISE NOTICE '     - Duplicados eliminados: %', r.duplicados_eliminados;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ CORRECCIÓN COMPLETADA - V1.21.3';
  RAISE NOTICE '   Aplicado a TODAS LAS SEDES';
  RAISE NOTICE '============================================';
END $$;

COMMIT;
