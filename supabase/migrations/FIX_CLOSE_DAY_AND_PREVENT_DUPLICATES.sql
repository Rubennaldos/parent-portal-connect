-- ============================================
-- FIX: FUNCIÓN close_lunch_day + PREVENCIÓN DE DUPLICADOS
-- ============================================
-- Problemas corregidos:
-- 1. close_lunch_day solo cerraba pedidos de estudiantes, NO de profesores
-- 2. No filtraba por school_id directo del pedido
-- 3. Pedidos pagados desde Cobranzas no se marcaban como delivered
-- ============================================

BEGIN;

-- ============================================
-- PASO 1: CORREGIR close_lunch_day PARA INCLUIR PROFESORES
-- ============================================

CREATE OR REPLACE FUNCTION close_lunch_day(p_school_id UUID, p_date DATE)
RETURNS TABLE (
  updated_orders INTEGER,
  message TEXT
) AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  -- Marcar como "delivered" todos los pedidos "confirmed" del día especificado
  -- Ahora incluye TANTO estudiantes como profesores y pedidos directos
  UPDATE public.lunch_orders
  SET 
    status = 'delivered',
    delivered_at = NOW()
  WHERE 
    order_date = p_date
    AND status = 'confirmed'
    AND is_cancelled = false
    AND (
      -- Pedidos con school_id directo
      school_id = p_school_id
      -- O pedidos de estudiantes de esa sede
      OR student_id IN (
        SELECT id FROM public.students WHERE school_id = p_school_id
      )
      -- O pedidos de profesores de esa sede
      OR teacher_id IN (
        SELECT id FROM public.teacher_profiles WHERE school_id_1 = p_school_id
      )
    );
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  RETURN QUERY SELECT v_updated, 
    'Día cerrado exitosamente. ' || v_updated || ' pedidos (estudiantes + profesores) marcados como entregados.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION close_lunch_day IS 'Cierra el día de almuerzos marcando todos los pedidos "confirmed" como "delivered" (incluye estudiantes Y profesores)';
GRANT EXECUTE ON FUNCTION close_lunch_day TO authenticated;

-- ============================================
-- PASO 2: VERIFICAR QUE EL TRIGGER ANTI-DUPLICADOS EXISTE
-- ============================================

-- Recrear por seguridad (CREATE OR REPLACE)
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
      RAISE NOTICE '⚠️ BLOQUEADO: Ya existe una transacción para lunch_order_id: %. No se creará duplicado.', v_lunch_order_id;
      RETURN NULL; -- Cancelar la inserción
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recrear trigger
DROP TRIGGER IF EXISTS trigger_prevent_duplicate_lunch_transaction ON transactions;
CREATE TRIGGER trigger_prevent_duplicate_lunch_transaction
  BEFORE INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_lunch_transaction();

-- ============================================
-- PASO 3: LIMPIAR DUPLICADOS ACTUALES (SI EXISTEN)
-- ============================================

-- Mostrar duplicados actuales
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT metadata->>'lunch_order_id' as lid
    FROM transactions
    WHERE metadata->>'lunch_order_id' IS NOT NULL
      AND payment_status IN ('pending', 'paid', 'partial')
    GROUP BY metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  ) dups;
  
  RAISE NOTICE '🔍 Duplicados activos encontrados: %', v_dup_count;
END $$;

-- Cancelar duplicados (conservar la más antigua o la pagada)
WITH duplicates AS (
  SELECT 
    t.id,
    t.metadata->>'lunch_order_id' as lunch_order_id,
    t.payment_status,
    t.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY t.metadata->>'lunch_order_id' 
      ORDER BY 
        -- Priorizar transacciones PAGADAS
        CASE WHEN t.payment_status = 'paid' THEN 1 ELSE 2 END,
        -- Luego la más antigua
        t.created_at ASC
    ) as rn
  FROM transactions t
  WHERE t.metadata->>'lunch_order_id' IS NOT NULL
    AND t.payment_status IN ('pending', 'paid', 'partial')
)
UPDATE transactions t
SET payment_status = 'cancelled',
    metadata = jsonb_set(
      COALESCE(t.metadata, '{}'::jsonb),
      '{cancelled_reason}',
      '"Transacción duplicada - se conservó la original/pagada"'::jsonb
    )
FROM duplicates d
WHERE t.id = d.id
  AND d.rn > 1;

-- ============================================
-- PASO 4: MARCAR COMO DELIVERED LOS PEDIDOS QUE YA TIENEN TRANSACCIÓN PAGADA
-- ============================================

-- Pedidos que tienen transacción PAID pero siguen en 'confirmed' o 'pending'
UPDATE lunch_orders lo
SET 
  status = 'delivered',
  delivered_at = COALESCE(lo.delivered_at, NOW())
FROM transactions t
WHERE t.metadata->>'lunch_order_id' = lo.id::text
  AND t.payment_status = 'paid'
  AND lo.status IN ('pending', 'confirmed')
  AND lo.is_cancelled = false;

DO $$
DECLARE
  v_fixed INTEGER;
BEGIN
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE '✅ Pedidos con pago realizado marcados como delivered: %', v_fixed;
END $$;

-- ============================================
-- PASO 5: VERIFICACIÓN FINAL
-- ============================================

DO $$
DECLARE
  v_remaining_dups INTEGER;
  v_pending_with_paid INTEGER;
BEGIN
  -- Verificar que no quedan duplicados
  SELECT COUNT(*) INTO v_remaining_dups
  FROM (
    SELECT metadata->>'lunch_order_id'
    FROM transactions
    WHERE metadata->>'lunch_order_id' IS NOT NULL
      AND payment_status IN ('pending', 'paid', 'partial')
    GROUP BY metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  ) d;
  
  -- Verificar que no quedan pedidos "pending/confirmed" con transacciones pagadas
  SELECT COUNT(*) INTO v_pending_with_paid
  FROM lunch_orders lo
  JOIN transactions t ON t.metadata->>'lunch_order_id' = lo.id::text
  WHERE t.payment_status = 'paid'
    AND lo.status IN ('pending', 'confirmed')
    AND lo.is_cancelled = false;
  
  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ VERIFICACIÓN FINAL';
  RAISE NOTICE '   Duplicados activos restantes: %', v_remaining_dups;
  RAISE NOTICE '   Pedidos pendientes con pago: %', v_pending_with_paid;
  RAISE NOTICE '============================================';
  
  IF v_remaining_dups = 0 AND v_pending_with_paid = 0 THEN
    RAISE NOTICE '🎉 TODO LIMPIO - No hay duplicados ni inconsistencias';
  ELSE
    RAISE WARNING '⚠️ Aún hay inconsistencias por resolver';
  END IF;
END $$;

COMMIT;
