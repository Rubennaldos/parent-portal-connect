-- ============================================================
-- 🛡️ LIMPIEZA DE TRANSACCIONES DUPLICADAS DE ALMUERZOS
-- ============================================================
-- Problema: Transacciones viejas se crearon SIN metadata.lunch_order_id
-- Cuando el admin confirmó el pedido, el anti-duplicado no las encontró
-- y se creó una SEGUNDA transacción.
--
-- Este script:
-- 1. Identifica transacciones de almuerzo SIN metadata.lunch_order_id
-- 2. Las vincula con su lunch_order correspondiente
-- 3. Identifica duplicados (mismo profesor/estudiante + misma fecha de almuerzo)
-- 4. Cancela los duplicados más nuevos, conservando los originales
-- ============================================================

-- ============================================================
-- PASO 1: DIAGNÓSTICO - Ver transacciones de almuerzo sin lunch_order_id
-- ============================================================
DO $$
DECLARE
  v_orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphan_count
  FROM transactions
  WHERE description ILIKE '%Almuerzo%'
    AND type = 'purchase'
    AND payment_status != 'cancelled'
    AND is_deleted = false
    AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL);
  
  RAISE NOTICE '📊 Transacciones de almuerzo SIN lunch_order_id: %', v_orphan_count;
END $$;

-- ============================================================
-- PASO 2: VINCULAR transacciones huérfanas con sus lunch_orders
-- Busca por teacher_id/student_id + descripción contiene la fecha del order_date
-- ============================================================
DO $$
DECLARE
  v_updated INTEGER := 0;
  v_tx RECORD;
  v_order RECORD;
  v_order_date_text TEXT;
BEGIN
  -- Iterar sobre transacciones de almuerzo sin lunch_order_id
  FOR v_tx IN 
    SELECT t.id, t.teacher_id, t.student_id, t.description, t.metadata, t.created_at
    FROM transactions t
    WHERE t.description ILIKE '%Almuerzo%'
      AND t.type = 'purchase'
      AND t.payment_status != 'cancelled'
      AND t.is_deleted = false
      AND (t.metadata IS NULL OR t.metadata->>'lunch_order_id' IS NULL)
    ORDER BY t.created_at
  LOOP
    -- Buscar lunch_order correspondiente por persona + rango de fecha
    IF v_tx.teacher_id IS NOT NULL THEN
      -- Buscar por teacher_id, intentando coincidir la fecha del pedido con la descripción
      FOR v_order IN
        SELECT lo.id, lo.order_date,
               TO_CHAR(lo.order_date, 'FMDD') || ' de ' || 
               CASE EXTRACT(MONTH FROM lo.order_date)
                 WHEN 1 THEN 'enero' WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo'
                 WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo' WHEN 6 THEN 'junio'
                 WHEN 7 THEN 'julio' WHEN 8 THEN 'agosto' WHEN 9 THEN 'septiembre'
                 WHEN 10 THEN 'octubre' WHEN 11 THEN 'noviembre' WHEN 12 THEN 'diciembre'
               END AS date_text
        FROM lunch_orders lo
        WHERE lo.teacher_id = v_tx.teacher_id
          AND lo.is_cancelled = false
        ORDER BY lo.created_at
      LOOP
        -- Si la descripción contiene la fecha formateada del pedido
        IF v_tx.description ILIKE '%' || v_order.date_text || '%' THEN
          -- Vincular
          UPDATE transactions
          SET metadata = COALESCE(metadata, '{}'::jsonb) || 
              jsonb_build_object(
                'lunch_order_id', v_order.id::text,
                'order_date', v_order.order_date::text,
                'fixed_by', 'migration_cleanup',
                'fixed_at', NOW()::text
              )
          WHERE id = v_tx.id;
          
          v_updated := v_updated + 1;
          RAISE NOTICE '✅ Vinculada tx % → lunch_order % (% / %)', v_tx.id, v_order.id, v_order.date_text, v_tx.description;
          EXIT; -- Solo vincular con la primera coincidencia
        END IF;
      END LOOP;
      
    ELSIF v_tx.student_id IS NOT NULL THEN
      -- Lo mismo para estudiantes
      FOR v_order IN
        SELECT lo.id, lo.order_date,
               TO_CHAR(lo.order_date, 'FMDD') || ' de ' || 
               CASE EXTRACT(MONTH FROM lo.order_date)
                 WHEN 1 THEN 'enero' WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo'
                 WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo' WHEN 6 THEN 'junio'
                 WHEN 7 THEN 'julio' WHEN 8 THEN 'agosto' WHEN 9 THEN 'septiembre'
                 WHEN 10 THEN 'octubre' WHEN 11 THEN 'noviembre' WHEN 12 THEN 'diciembre'
               END AS date_text
        FROM lunch_orders lo
        WHERE lo.student_id = v_tx.student_id
          AND lo.is_cancelled = false
        ORDER BY lo.created_at
      LOOP
        IF v_tx.description ILIKE '%' || v_order.date_text || '%' THEN
          UPDATE transactions
          SET metadata = COALESCE(metadata, '{}'::jsonb) || 
              jsonb_build_object(
                'lunch_order_id', v_order.id::text,
                'order_date', v_order.order_date::text,
                'fixed_by', 'migration_cleanup',
                'fixed_at', NOW()::text
              )
          WHERE id = v_tx.id;
          
          v_updated := v_updated + 1;
          RAISE NOTICE '✅ Vinculada tx % → lunch_order % (% / %)', v_tx.id, v_order.id, v_order.date_text, v_tx.description;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  
  RAISE NOTICE '📊 Total de transacciones vinculadas con lunch_order_id: %', v_updated;
END $$;

-- ============================================================
-- PASO 3: IDENTIFICAR Y CANCELAR DUPLICADOS
-- Un duplicado = mismo lunch_order_id + más de 1 transacción no-cancelada
-- Se conserva la MÁS VIEJA y se cancela la(s) más nueva(s)
-- ============================================================
DO $$
DECLARE
  v_cancelled INTEGER := 0;
  v_dup RECORD;
  v_keep_id UUID;
BEGIN
  -- Encontrar lunch_order_ids con múltiples transacciones
  FOR v_dup IN
    SELECT metadata->>'lunch_order_id' AS lunch_order_id,
           COUNT(*) AS tx_count
    FROM transactions
    WHERE metadata->>'lunch_order_id' IS NOT NULL
      AND payment_status != 'cancelled'
      AND is_deleted = false
      AND type = 'purchase'
    GROUP BY metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE '🔍 Duplicado encontrado: lunch_order_id=%, % transacciones', v_dup.lunch_order_id, v_dup.tx_count;
    
    -- Encontrar la transacción a CONSERVAR (prioridad: la más vieja, o la que tiene payment_status='paid')
    SELECT id INTO v_keep_id
    FROM transactions
    WHERE metadata->>'lunch_order_id' = v_dup.lunch_order_id
      AND payment_status != 'cancelled'
      AND is_deleted = false
    ORDER BY 
      CASE WHEN payment_status = 'paid' THEN 0 ELSE 1 END, -- Priorizar las pagadas
      created_at ASC -- Si ambas tienen el mismo status, conservar la más vieja
    LIMIT 1;
    
    RAISE NOTICE '  → Conservando: %', v_keep_id;
    
    -- Cancelar las demás
    UPDATE transactions
    SET payment_status = 'cancelled',
        metadata = COALESCE(metadata, '{}'::jsonb) || 
          jsonb_build_object(
            'cancelled_reason', 'duplicate_cleanup',
            'cancelled_at', NOW()::text,
            'kept_transaction_id', v_keep_id::text
          )
    WHERE metadata->>'lunch_order_id' = v_dup.lunch_order_id
      AND id != v_keep_id
      AND payment_status != 'cancelled'
      AND is_deleted = false;
    
    v_cancelled := v_cancelled + (v_dup.tx_count - 1);
    RAISE NOTICE '  → Canceladas: % transacciones duplicadas', v_dup.tx_count - 1;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '📊 RESUMEN:';
  RAISE NOTICE '  Duplicados encontrados y cancelados: %', v_cancelled;
  RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- PASO 4: VERIFICACIÓN FINAL
-- ============================================================
DO $$
DECLARE
  v_remaining INTEGER;
  v_orphans INTEGER;
BEGIN
  -- Verificar que ya no hay duplicados
  SELECT COUNT(*) INTO v_remaining
  FROM (
    SELECT metadata->>'lunch_order_id'
    FROM transactions
    WHERE metadata->>'lunch_order_id' IS NOT NULL
      AND payment_status != 'cancelled'
      AND is_deleted = false
      AND type = 'purchase'
    GROUP BY metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  ) sub;
  
  -- Verificar transacciones huérfanas restantes
  SELECT COUNT(*) INTO v_orphans
  FROM transactions
  WHERE description ILIKE '%Almuerzo%'
    AND type = 'purchase'
    AND payment_status != 'cancelled'
    AND is_deleted = false
    AND (metadata IS NULL OR metadata->>'lunch_order_id' IS NULL);
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ VERIFICACIÓN POST-LIMPIEZA:';
  RAISE NOTICE '  Duplicados restantes: % (debe ser 0)', v_remaining;
  RAISE NOTICE '  Transacciones huérfanas restantes: % (sin lunch_order_id)', v_orphans;
  RAISE NOTICE '========================================';
END $$;
