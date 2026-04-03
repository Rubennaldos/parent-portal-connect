-- ============================================================
-- BILLING COLLECTION — 3 RPCs críticos
-- ============================================================
-- 1. get_billing_paid_transactions   → resuelve 400 en "Pagos Realizados"
-- 2. count_billing_paid_transactions → conteo paginado para la misma pestaña
-- 3. materialize_pending_lunch_debts → convierte lunch_orders sin transaction
--    en registros reales en la tabla transactions, eliminando "virtuales"
-- ============================================================

-- ============================================================
-- 1. get_billing_paid_transactions
-- ============================================================
DROP FUNCTION IF EXISTS get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,integer,integer);

CREATE OR REPLACE FUNCTION get_billing_paid_transactions(
  p_school_id     uuid        DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_search_term   text        DEFAULT NULL,
  p_offset        integer     DEFAULT 0,
  p_limit         integer     DEFAULT 30
)
RETURNS TABLE (
  id                  uuid,
  type                text,
  amount              numeric,
  payment_status      text,
  payment_method      text,
  operation_number    text,
  description         text,
  created_at          timestamptz,
  school_id           uuid,
  school_name         text,
  student_id          uuid,
  student_full_name   text,
  student_parent_id   uuid,
  teacher_id          uuid,
  teacher_full_name   text,
  manual_client_name  text,
  metadata            jsonb,
  ticket_code         text,
  created_by          uuid,
  paid_with_mixed     boolean,
  cash_amount         numeric,
  card_amount         numeric,
  yape_amount         numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.type,
    t.amount,
    t.payment_status,
    t.payment_method,
    t.operation_number,
    t.description,
    t.created_at,
    t.school_id,
    s.name          AS school_name,
    t.student_id,
    st.full_name    AS student_full_name,
    st.parent_id    AS student_parent_id,
    t.teacher_id,
    tp.full_name    AS teacher_full_name,
    t.manual_client_name,
    t.metadata,
    t.ticket_code,
    t.created_by,
    t.paid_with_mixed,
    t.cash_amount,
    t.card_amount,
    t.yape_amount
  FROM transactions t
  LEFT JOIN schools          s  ON s.id  = t.school_id
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (p_school_id  IS NULL OR t.school_id      = p_school_id)
    AND (p_status     IS NULL OR t.payment_status = p_status)
    AND (p_date_from  IS NULL OR t.created_at    >= p_date_from)
    AND (p_date_to    IS NULL OR t.created_at    <= p_date_to)
    AND (
      p_search_term IS NULL
      OR t.description        ILIKE '%' || p_search_term || '%'
      OR t.ticket_code        ILIKE '%' || p_search_term || '%'
      OR t.manual_client_name ILIKE '%' || p_search_term || '%'
      OR st.full_name         ILIKE '%' || p_search_term || '%'
      OR tp.full_name         ILIKE '%' || p_search_term || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,integer,integer)
  TO authenticated, service_role;


-- ============================================================
-- 2. count_billing_paid_transactions
-- ============================================================
DROP FUNCTION IF EXISTS count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text);

CREATE OR REPLACE FUNCTION count_billing_paid_transactions(
  p_school_id     uuid        DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_search_term   text        DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)
  FROM transactions t
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (p_school_id  IS NULL OR t.school_id      = p_school_id)
    AND (p_status     IS NULL OR t.payment_status = p_status)
    AND (p_date_from  IS NULL OR t.created_at    >= p_date_from)
    AND (p_date_to    IS NULL OR t.created_at    <= p_date_to)
    AND (
      p_search_term IS NULL
      OR t.description        ILIKE '%' || p_search_term || '%'
      OR t.ticket_code        ILIKE '%' || p_search_term || '%'
      OR t.manual_client_name ILIKE '%' || p_search_term || '%'
      OR st.full_name         ILIKE '%' || p_search_term || '%'
      OR tp.full_name         ILIKE '%' || p_search_term || '%'
    );
$$;

GRANT EXECUTE ON FUNCTION count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text)
  TO authenticated, service_role;


-- ============================================================
-- 3. materialize_pending_lunch_debts
-- ============================================================
-- Convierte lunch_orders con payment_method='pagar_luego' que NO tienen
-- una transacción real (pending/partial/paid) en registros en transactions.
-- Resultado: los "virtuales" del frontend dejan de ser necesarios.
-- Idempotente: un NOT EXISTS garantiza que nunca crea duplicados.
-- ============================================================
DROP FUNCTION IF EXISTS materialize_pending_lunch_debts(uuid);

CREATE OR REPLACE FUNCTION materialize_pending_lunch_debts(
  p_school_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec    record;
  v_price  numeric;
  v_desc   text;
  v_sid    uuid;
  v_count  integer := 0;
BEGIN
  FOR v_rec IN
    SELECT
      lo.id,
      lo.order_date,
      lo.student_id,
      lo.teacher_id,
      lo.manual_name,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1) AS effective_school_id,
      COALESCE(lo.quantity, 1)                              AS qty,
      lo.final_price,
      lo.base_price,
      lc.price  AS cat_price,
      lc.name   AS cat_name,
      lcfg.lunch_price AS cfg_price,
      lo.created_at
    FROM lunch_orders lo
    LEFT JOIN students          st   ON st.id  = lo.student_id
    LEFT JOIN teacher_profiles  tp   ON tp.id  = lo.teacher_id
    LEFT JOIN lunch_categories  lc   ON lc.id  = lo.category_id
    -- Busca la configuración de almuerzo de la sede efectiva
    LEFT JOIN lunch_configuration lcfg
           ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
    WHERE lo.is_cancelled = false
      AND lo.payment_method = 'pagar_luego'
      AND lo.status NOT IN ('cancelled')
      -- Filtro de sede (si se pasa uno)
      AND (
        p_school_id IS NULL
        OR lo.school_id     = p_school_id
        OR st.school_id     = p_school_id
        OR tp.school_id_1   = p_school_id
      )
      -- Idempotencia: solo si NO existe ya una transacción para este pedido
      AND NOT EXISTS (
        SELECT 1
        FROM transactions t
        WHERE (t.metadata->>'lunch_order_id') = lo.id::text
          AND t.is_deleted      = false
          AND t.payment_status IN ('pending', 'partial', 'paid')
      )
  LOOP
    v_sid := v_rec.effective_school_id;

    -- Prioridad de precio: final_price → cat_price*qty → base_price*qty → cfg_price*qty → 7.50*qty
    IF v_rec.final_price IS NOT NULL AND v_rec.final_price > 0 THEN
      v_price := v_rec.final_price;
    ELSIF v_rec.cat_price IS NOT NULL AND v_rec.cat_price > 0 THEN
      v_price := v_rec.cat_price * v_rec.qty;
    ELSIF v_rec.base_price IS NOT NULL AND v_rec.base_price > 0 THEN
      v_price := v_rec.base_price * v_rec.qty;
    ELSIF v_rec.cfg_price IS NOT NULL AND v_rec.cfg_price > 0 THEN
      v_price := v_rec.cfg_price * v_rec.qty;
    ELSE
      v_price := 7.50 * v_rec.qty;
    END IF;

    -- Descripción auditable con formato de fecha DD/MM/YYYY
    v_desc := 'Almuerzo - '
      || COALESCE(v_rec.cat_name, 'Menú')
      || CASE WHEN v_rec.qty > 1 THEN ' (' || v_rec.qty || 'x)' ELSE '' END
      || ' - '
      || to_char(v_rec.order_date::date, 'DD/MM/YYYY');

    INSERT INTO transactions (
      type,
      amount,
      payment_status,
      payment_method,
      description,
      student_id,
      teacher_id,
      manual_client_name,
      school_id,
      metadata,
      is_deleted,
      created_at
    ) VALUES (
      'purchase',
      -- Siempre negativo (salida de dinero del deudor) y redondeado a 2 decimales
      -ABS(ROUND(v_price, 2)),
      'pending',
      'pagar_luego',
      v_desc,
      v_rec.student_id,
      v_rec.teacher_id,
      v_rec.manual_name,
      v_sid,
      jsonb_build_object(
        'lunch_order_id', v_rec.id::text,
        'source',         'materialized',
        'order_date',     v_rec.order_date
      ),
      false,
      -- Ancla la transacción al mediodía Lima del día del pedido (= 17:00 UTC)
      -- para que aparezca en el período correcto en los reportes históricos
      (v_rec.order_date::date + interval '17 hours')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION materialize_pending_lunch_debts(uuid)
  TO authenticated, service_role;
