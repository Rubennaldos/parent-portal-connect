-- ============================================================================
-- SOLUCIÓN ARQUITECTURAL: create_and_deliver_lunch_order
-- Fecha: 2026-06-18  (rev. 2 — correcciones v1.9.2)
--
-- PROBLEMA RESUELTO (original):
--   AddWithoutOrderModal usaba 2 pasos no-atómicos. Fallo en paso 2 → AUTO-cancel
--   → cocina veía "Anulado" durante 4 días en hora punta.
--
-- CORRECCIONES EN ESTA REVISIÓN:
--
-- 1. ÍNDICE ÚNICO PARA PROFESORES (agujero de seguridad v1.9.1)
--    El índice idx_lunch_orders_unique_active tiene:
--      WHERE status != 'cancelled' AND student_id IS NOT NULL
--    Los pedidos de profesores tienen student_id = NULL → NO estaban protegidos.
--    Doble clic bajo latencia de red = deuda duplicada al profesor.
--    Fix: nuevo índice parcial sobre (teacher_id, order_date, category_id).
--
-- 2. MÉTODO DE PAGO (agujero contable v1.9.1)
--    Forzar payment_status='pending' para todas las entregas de cocina asume
--    que TODO se cobra a crédito. Pero el cajero puede cobrar efectivo o Yape
--    en el acto. El nuevo parámetro p_payment_method permite:
--      'credit' (default) → payment_status='pending'   (deuda para cobrar)
--      'cash'             → payment_status='paid'      (ya cobrado)
--      'yape'             → payment_status='paid'      (ya cobrado)
--
-- NOTA SOBRE SALDO DE PROFESORES:
--   fn_sync_student_balance(p_student_id) retorna inmediatamente si el parámetro
--   es NULL, por diseño. Los profesores no tienen students.balance — su deuda
--   se gestiona como tab mensual con consulta directa a transactions. Esto es
--   comportamiento correcto, no un bug.
--
-- TRIGGERS QUE SIGUEN DISPARANDO (sin cambios):
--   BEFORE INSERT lunch_orders:
--     • trg_lunch_orders_prepayment        → asigna payment_flow_state
--     • trg_validate_lunch_order_deadline  → bypass para admin_sede/general/superadmin
--   AFTER  INSERT transactions:
--     • trg_transactions_balance_sync      → sincroniza saldo del alumno (NO aplica a profesores, by design)
--     • tg_enforce_spending_limit          → bypaseado por metadata.lunch_order_id
--
-- IDEMPOTENCIA:
--   Alumnos:   idx_lunch_orders_unique_active         (student_id, order_date, category_id)
--   Profesores: idx_lunch_orders_unique_teacher_active (teacher_id, order_date, category_id)
--   Ambos devuelven DELIVER_DUPLICATE ante duplicado.
-- ============================================================================

BEGIN;

-- ── PASO 0: Sanear duplicados de profesores antes de crear el índice ─────────
-- El índice único requiere que no existan filas duplicadas previas.
-- Estrategia de deduplicación: dentro de cada grupo (teacher_id, order_date,
-- category_id) se conserva UNA sola fila (la "mejor": 'delivered' primero, luego
-- la más reciente). Las demás se cancelan con trazabilidad completa.
--
-- Criterio de selección del ganador (ORDER BY):
--   1. status = 'delivered'   (ya entregado → tiene prioridad sobre pendiente)
--   2. status = 'confirmed'   (confirmado)
--   3. status = 'pending'     (pendiente)
--   4. created_at DESC        (dentro de igual status, el más reciente)
DO $$
DECLARE
  v_count INT;
BEGIN
  WITH ranked_teacher_orders AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY teacher_id, order_date, category_id
        ORDER BY
          CASE status
            WHEN 'delivered'  THEN 1
            WHEN 'confirmed'  THEN 2
            WHEN 'pending'    THEN 3
            ELSE                   4
          END ASC,
          created_at DESC
      ) AS rn
    FROM public.lunch_orders
    WHERE teacher_id     IS NOT NULL
      AND status         != 'cancelled'
      AND is_cancelled   IS NOT TRUE
  )
  UPDATE public.lunch_orders
  SET
    status              = 'cancelled',
    is_cancelled        = true,
    cancellation_reason = 'DEDUP_MIGRATION: duplicado de profesor cancelado automáticamente por idx_lunch_orders_unique_teacher_active (20260618)'
  WHERE id IN (SELECT id FROM ranked_teacher_orders WHERE rn > 1);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deduplicación de profesores: % pedido(s) duplicado(s) cancelado(s) con trazabilidad.', v_count;
END;
$$;

-- ── Índice único para PROFESORES (el que faltaba) ────────────────────────────
-- Ahora que no hay duplicados, el índice se puede crear sin errores.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lunch_orders_unique_teacher_active
  ON public.lunch_orders (teacher_id, order_date, category_id)
  WHERE status != 'cancelled'
    AND teacher_id IS NOT NULL;

COMMENT ON INDEX public.idx_lunch_orders_unique_teacher_active IS
  'Candado de idempotencia para pedidos de profesores. Espejo exacto de '
  'idx_lunch_orders_unique_active pero con teacher_id. Previene duplicados '
  'por doble clic en AddWithoutOrderModal bajo latencia de red en hora punta. '
  'Creado con deduplicación previa de registros históricos (migración 20260618).';

-- ── RPC atómica create_and_deliver_lunch_order ───────────────────────────────
CREATE OR REPLACE FUNCTION public.create_and_deliver_lunch_order(
  p_person_type    TEXT,              -- 'student' | 'teacher'
  p_person_id      UUID,
  p_order_date     DATE,
  p_category_id    UUID,
  p_menu_id        UUID,
  p_school_id      UUID,
  p_price          NUMERIC,
  p_created_by     UUID,
  p_description    TEXT,
  p_category_name  TEXT  DEFAULT 'Almuerzo',
  p_payment_method TEXT  DEFAULT 'credit'  -- 'credit' | 'cash' | 'yape'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id       UUID;
  v_tx_id          UUID;
  v_student_id     UUID   := NULL;
  v_teacher_id     UUID   := NULL;
  v_payment_status TEXT;
  v_payment_col    TEXT;
BEGIN
  -- ── Validación del tipo de persona ────────────────────────────────────────
  IF p_person_type = 'student' THEN
    v_student_id := p_person_id;
  ELSIF p_person_type = 'teacher' THEN
    v_teacher_id := p_person_id;
  ELSE
    RAISE EXCEPTION 'CREATE_AND_DELIVER_INVALID_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  -- ── Resolver payment_status según método de cobro ─────────────────────────
  -- 'cash' y 'yape' = cobrado en el acto → paid
  -- 'credit' o cualquier otro valor = a cuenta → pending
  IF lower(p_payment_method) IN ('cash', 'yape') THEN
    v_payment_status := 'paid';
  ELSE
    v_payment_status := 'pending';
  END IF;

  -- Columna payment_method en transactions: NULL si crédito (aún no cobrado)
  IF lower(p_payment_method) = 'cash' THEN
    v_payment_col := 'cash';
  ELSIF lower(p_payment_method) = 'yape' THEN
    v_payment_col := 'yape';
  ELSE
    v_payment_col := NULL;
  END IF;

  -- ── 1. Insertar pedido como ya entregado ─────────────────────────────────
  -- Ambos índices únicos (alumno + profesor) protegen contra duplicados aquí.
  BEGIN
    INSERT INTO public.lunch_orders (
      student_id,  teacher_id,
      order_date,  status,
      category_id, menu_id,
      school_id,   quantity,
      base_price,  addons_total,  final_price,
      created_by,  is_no_order_delivery,
      delivered_at, delivered_by
    )
    VALUES (
      v_student_id, v_teacher_id,
      p_order_date, 'delivered',
      p_category_id, p_menu_id,
      p_school_id,  1,
      p_price,      0,            p_price,
      p_created_by, true,
      now(),        p_created_by
    )
    RETURNING id INTO v_order_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'DELIVER_DUPLICATE: Ya existe un pedido activo para esta categoría en este día.';
  END;

  -- ── 2. Insertar transacción ───────────────────────────────────────────────
  -- payment_status depende del método de cobro elegido en la UI de cocina.
  -- Si p_price = 0 (categoría gratuita) no se genera ningún registro de deuda.
  IF p_price > 0 THEN
    INSERT INTO public.transactions (
      student_id,      teacher_id,
      type,            amount,          description,
      payment_status,  payment_method,
      school_id,       created_by,
      is_taxable,      billing_status,
      metadata
    )
    VALUES (
      v_student_id,    v_teacher_id,
      'purchase',      -ABS(p_price),   p_description,
      v_payment_status, v_payment_col,
      p_school_id,     p_created_by,
      FALSE,           'excluded',
      jsonb_build_object(
        'lunch_order_id',  v_order_id,
        'source',          'delivery_no_order_rpc',
        'order_date',      p_order_date::TEXT,
        'category_name',   p_category_name,
        'payment_method',  p_payment_method,
        'quantity',        1
      )
    )
    RETURNING id INTO v_tx_id;
  END IF;

  -- ── Resultado ─────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'lunch_order_id',  v_order_id,
    'transaction_id',  v_tx_id,
    'payment_status',  v_payment_status
  );
END;
$$;

COMMENT ON FUNCTION public.create_and_deliver_lunch_order IS
  'RPC atómica: crea un lunch_order ya entregado + transacción en una sola '
  'transacción SQL. p_payment_method controla si la deuda queda pending (crédito) '
  'o paid (efectivo/yape). Idempotente para alumnos Y profesores vía índices únicos. '
  'Ver migración 20260618 para contexto.';

REVOKE ALL    ON FUNCTION public.create_and_deliver_lunch_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_and_deliver_lunch_order TO authenticated;

COMMIT;

SELECT
  'idx_lunch_orders_unique_teacher_active ✅'  AS indice_profesores,
  'create_and_deliver_lunch_order v2 ✅'        AS rpc_cocina;
