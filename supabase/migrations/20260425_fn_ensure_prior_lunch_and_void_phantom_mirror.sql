-- ============================================================================
-- 2026-04-25 — Espejo de almuerzo: evitar duplicado tras reparación de metadata
--
-- CONTEXTO:
--   La migración 20260424_repair_tmad_plin_lunch_order_metadata.sql mueve
--   metadata.lunch_order_id de un pedido viejo al pedido correcto y deja
--   lunch_metadata_repair_prior_lunch_order_id = UUID anterior.
--   fn_ensure_paid_purchase_mirrors solo miraba lunch_order_id actual, así que
--   un voucher aprobado después podía creer que el pedido viejo "no tenía"
--   transacción e insertaba OTRO lunch_approval_mirror (fantasma pending).
--
-- QUÉ HACE:
--   1) fn_ensure: el NOT EXISTS del bucle también considera cobros paid cuyo
--      prior lunch_order_id coincide con el pedido del voucher.
--   2) Anula (is_deleted) de forma idempotente el caso conocido T-MAT4-000030
--      ligado al RR 34b9c8a0 (phantom mirror pending).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
  p_request_id         uuid,
  p_student_id         uuid,
  p_school_id          uuid,
  p_lunch_ids          uuid[],
  p_payment_method     text,
  p_admin_id           uuid,
  p_voucher_url        text,
  p_reference_code     text,
  p_request_type       text,
  p_is_taxable         boolean,
  p_billing_status     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lo_rec        record;
  v_psrc        text;
  v_tkt         text;
  n_insert      int := 0;
  v_line_amount numeric(12,2);
  v_desc        text;
BEGIN
  IF p_lunch_ids IS NULL OR cardinality(p_lunch_ids) = 0 THEN
    RETURN;
  END IF;

  v_psrc := CASE p_request_type
    WHEN 'debt_payment'  THEN 'debt_voucher_payment'
    WHEN 'lunch_payment' THEN 'lunch_voucher_payment'
    ELSE 'voucher_payment'
  END;

  UPDATE public.transactions t
  SET
    payment_status = 'paid',
    payment_method = COALESCE(NULLIF(TRIM(p_payment_method), ''), t.payment_method),
    is_taxable     = p_is_taxable,
    billing_status = p_billing_status,
    metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'payment_approved', true,
      'source_channel', 'parent_web',
      'payment_source', v_psrc,
      'recharge_request_id', p_request_id::text,
      'reference_code', p_reference_code,
      'approved_by', p_admin_id::text,
      'approved_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'voucher_url', p_voucher_url,
      'last_payment_rejected', false
    )
  WHERE t.is_deleted    = false
    AND t.type          = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND t.metadata->>'lunch_order_id' IS NOT NULL
    AND (t.metadata->>'lunch_order_id')::uuid = ANY(p_lunch_ids)
    AND (t.student_id = p_student_id OR t.student_id IS NULL);

  FOR lo_rec IN
    SELECT
      lo.id,
      lo.student_id,
      lo.teacher_id,
      lo.manual_name,
      lo.order_date,
      lo.quantity,
      lo.final_price,
      lc.name AS menu_name,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1) AS school_id,
      ABS(ROUND(
        CASE
          WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
            THEN lo.final_price
          WHEN lc.price IS NOT NULL AND lc.price > 0
            THEN lc.price * COALESCE(lo.quantity, 1)
          WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
            THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
          ELSE 7.50 * COALESCE(lo.quantity, 1)
        END, 2
      ))::numeric(10,2) AS line_amount
    FROM   public.lunch_orders       lo
    LEFT JOIN public.students            st   ON st.id  = lo.student_id
    LEFT JOIN public.teacher_profiles    tp   ON tp.id  = lo.teacher_id
    LEFT JOIN public.lunch_categories     lc   ON lc.id  = lo.category_id
    LEFT JOIN public.lunch_configuration  lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
    WHERE  lo.id = ANY(p_lunch_ids)
      AND  lo.is_cancelled = false
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.is_deleted = false
        AND t.type = 'purchase'
        AND (
          (t.metadata->>'lunch_order_id') = lo_rec.id::text
          OR (
            t.payment_status = 'paid'
            AND NULLIF(t.metadata->>'lunch_metadata_repair_prior_lunch_order_id', '')
              = lo_rec.id::text
          )
        )
    ) THEN
      CONTINUE;
    END IF;

    v_line_amount := lo_rec.line_amount;
    n_insert := n_insert + 1;
    v_desc := 'Almuerzo - ' || COALESCE(lo_rec.menu_name, 'Menú') ||
      CASE WHEN COALESCE(lo_rec.quantity, 1) > 1
        THEN ' (' || lo_rec.quantity::text || 'x)' ELSE '' END ||
      ' - ' || to_char(lo_rec.order_date::date, 'DD/MM/YYYY');

    v_tkt := NULL;
    BEGIN
      SELECT get_next_ticket_number(p_admin_id) INTO v_tkt;
    EXCEPTION WHEN OTHERS THEN
      v_tkt := 'MRR-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || n_insert::text;
    END;

    INSERT INTO public.transactions (
      type,
      amount,
      payment_status,
      payment_method,
      description,
      student_id,
      teacher_id,
      manual_client_name,
      school_id,
      created_by,
      ticket_code,
      is_taxable,
      billing_status,
      metadata
    ) VALUES (
      'purchase',
      v_line_amount,
      'paid',
      COALESCE(NULLIF(TRIM(p_payment_method), ''), 'voucher'),
      v_desc,
      lo_rec.student_id,
      lo_rec.teacher_id,
      lo_rec.manual_name,
      COALESCE(lo_rec.school_id, p_school_id),
      p_admin_id,
      v_tkt,
      p_is_taxable,
      p_billing_status,
      jsonb_build_object(
        'lunch_order_id',        lo_rec.id::text,
        'source',                'lunch_approval_mirror',
        'recharge_request_id',  p_request_id::text,
        'lunch_approval_mirror', 'true',
        'payment_approved',      true,
        'source_channel',        'parent_web',
        'payment_source',        v_psrc,
        'reference_code',       p_reference_code,
        'approved_by',          p_admin_id::text,
        'approved_at',          to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'voucher_url',          p_voucher_url
      )
    );
  END LOOP;

END;
$$;

COMMENT ON FUNCTION public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
  uuid, uuid, uuid, uuid[], text, uuid, text, text, text, boolean, text
) IS
  '2026-04-25 — Igual que 2026-04-22 pero: al decidir si insertar espejo, también '
  'considera compras paid con lunch_metadata_repair_prior_lunch_order_id = pedido. '
  '2026-04-29 — UPDATE masivo pendiente→paid añade AND (t.student_id = p_student_id OR t.student_id IS NULL) '
  'para evitar marcar pagadas compras de otro alumno si se comparte lunch_order_id por error.';

-- ── Caso documentado: espejo pending creado al aprobar RR 34b9c8a0 ───────────
UPDATE public.transactions t
SET
  is_deleted = true,
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'void_reason', 'phantom_lunch_mirror_after_prior_lunch_repair',
    'void_migration', '20260425_fn_ensure_prior_lunch_and_void_phantom_mirror'
  )
WHERE t.id = 'f33d979e-d580-434e-9d6d-e6bde4e91ed4'::uuid
  AND t.is_deleted = false
  AND t.type = 'purchase'
  AND t.payment_status = 'pending'
  AND (t.metadata->>'lunch_approval_mirror') = 'true'
  AND (t.metadata->>'recharge_request_id') = '34b9c8a0-0bbf-485a-96cb-a5de05f59c4c'
  AND (t.metadata->>'lunch_order_id') = '23305b00-a471-46f0-92c5-e67d52c6e143';

SELECT '20260425_fn_ensure_prior_lunch_and_void_phantom_mirror OK' AS resultado;
