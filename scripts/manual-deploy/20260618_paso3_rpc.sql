-- PASO 3 — RPC create_and_deliver_lunch_order (cocina, atómica + método de pago).
-- Ejecutar solo después de que el paso 2 muestre el índice creado.

CREATE OR REPLACE FUNCTION public.create_and_deliver_lunch_order(
  p_person_type    TEXT,
  p_person_id      UUID,
  p_order_date     DATE,
  p_category_id    UUID,
  p_menu_id        UUID,
  p_school_id      UUID,
  p_price          NUMERIC,
  p_created_by     UUID,
  p_description    TEXT,
  p_category_name  TEXT DEFAULT 'Almuerzo',
  p_payment_method TEXT DEFAULT 'credit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order_id       UUID;
  v_tx_id          UUID;
  v_student_id     UUID := NULL;
  v_teacher_id     UUID := NULL;
  v_payment_status TEXT;
  v_payment_col    TEXT;
BEGIN
  IF p_person_type = 'student' THEN
    v_student_id := p_person_id;
  ELSIF p_person_type = 'teacher' THEN
    v_teacher_id := p_person_id;
  ELSE
    RAISE EXCEPTION 'CREATE_AND_DELIVER_INVALID_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  IF lower(p_payment_method) IN ('cash', 'yape') THEN
    v_payment_status := 'paid';
  ELSE
    v_payment_status := 'pending';
  END IF;

  IF lower(p_payment_method) = 'cash' THEN
    v_payment_col := 'cash';
  ELSIF lower(p_payment_method) = 'yape' THEN
    v_payment_col := 'yape';
  ELSE
    v_payment_col := NULL;
  END IF;

  BEGIN
    INSERT INTO public.lunch_orders (
      student_id, teacher_id, order_date, status,
      category_id, menu_id, school_id, quantity,
      base_price, addons_total, final_price,
      created_by, is_no_order_delivery,
      delivered_at, delivered_by
    )
    VALUES (
      v_student_id, v_teacher_id, p_order_date, 'delivered',
      p_category_id, p_menu_id, p_school_id, 1,
      p_price, 0, p_price,
      p_created_by, true,
      now(), p_created_by
    )
    RETURNING id INTO v_order_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'DELIVER_DUPLICATE: Ya existe un pedido activo para esta categoría en este día.';
  END;

  IF p_price > 0 THEN
    INSERT INTO public.transactions (
      student_id, teacher_id, type, amount, description,
      payment_status, payment_method, school_id, created_by,
      is_taxable, billing_status, metadata
    )
    VALUES (
      v_student_id, v_teacher_id, 'purchase', -ABS(p_price), p_description,
      v_payment_status, v_payment_col, p_school_id, p_created_by,
      FALSE, 'excluded',
      jsonb_build_object(
        'lunch_order_id', v_order_id,
        'source', 'delivery_no_order_rpc',
        'order_date', p_order_date::TEXT,
        'category_name', p_category_name,
        'payment_method', p_payment_method,
        'quantity', 1
      )
    )
    RETURNING id INTO v_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'lunch_order_id', v_order_id,
    'transaction_id', v_tx_id,
    'payment_status', v_payment_status
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_and_deliver_lunch_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_and_deliver_lunch_order TO authenticated;

-- Verificación (debe devolver 1 fila):
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'create_and_deliver_lunch_order';
