-- ============================================================================
-- 2026-04-23 — Parche v2 del auto-apply: excluir transacciones ya en SUNAT
--
-- PROBLEMA:
--   fn_prevent_modifying_sent_transactions() bloquea UPDATE en transacciones
--   que ya tienen invoice_id (informadas a SUNAT). El bloque de limpieza
--   intentaba cambiarlas y fallaba con P0001 SUNAT_INTEGRITY.
--
-- FIX:
--   Agregar a TODOS los WHERE de auto-apply:
--     AND t.billing_status NOT IN ('sent', 'invoiced', 'billed')
--     AND t.invoice_id IS NULL
--   Así solo se saldan deudas cuya boleta todavía NO fue emitida/enviada a SUNAT.
-- ============================================================================

-- ── A) Reemplazar fn_auto_apply_balance_to_pending_purchases ─────────────────

CREATE OR REPLACE FUNCTION public.fn_auto_apply_balance_to_pending_purchases(
  p_student_id         uuid,
  p_school_id          uuid,
  p_admin_id           uuid,
  p_source_request_id  uuid,
  p_payment_method     text DEFAULT 'saldo'
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance       numeric;
  v_tx            record;
  v_cleared_ids   uuid[] := '{}';
  v_lo_ids        uuid[] := '{}';
BEGIN
  SELECT balance INTO v_balance FROM public.students WHERE id = p_student_id;

  IF COALESCE(v_balance, 0) <= 0 THEN
    RETURN v_cleared_ids;
  END IF;

  FOR v_tx IN
    SELECT t.id,
           ABS(t.amount)::numeric(10,2) AS abs_amount,
           t.metadata->>'lunch_order_id' AS lunch_order_id
    FROM   public.transactions t
    WHERE  t.student_id    = p_student_id
      AND  t.is_deleted    = false
      AND  t.type          = 'purchase'
      AND  t.payment_status IN ('pending', 'partial')
      -- ← NO tocar transacciones ya informadas a SUNAT
      AND  COALESCE(t.billing_status, '') NOT IN ('sent', 'invoiced', 'billed')
      AND  t.invoice_id IS NULL
    ORDER  BY t.created_at ASC
  LOOP
    SELECT balance INTO v_balance FROM public.students WHERE id = p_student_id;
    EXIT WHEN COALESCE(v_balance, 0) <= 0;
    EXIT WHEN COALESCE(v_balance, 0) < v_tx.abs_amount * 0.99;

    UPDATE public.transactions t
    SET
      payment_status = 'paid',
      payment_method = COALESCE(NULLIF(t.payment_method, ''), p_payment_method, 'saldo'),
      metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
        'payment_approved',            true,
        'auto_applied_from_balance',   true,
        'source_recharge_request_id',  p_source_request_id::text,
        'approved_by',                 p_admin_id::text,
        'approved_at',                 to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    WHERE t.id            = v_tx.id
      AND t.is_deleted    = false
      AND t.payment_status IN ('pending', 'partial')
      AND COALESCE(t.billing_status, '') NOT IN ('sent', 'invoiced', 'billed')
      AND t.invoice_id IS NULL;

    v_cleared_ids := v_cleared_ids || v_tx.id;

    IF v_tx.lunch_order_id IS NOT NULL THEN
      v_lo_ids := v_lo_ids || v_tx.lunch_order_id::uuid;
      UPDATE public.lunch_orders
      SET    status = 'confirmed'
      WHERE  id          = v_tx.lunch_order_id::uuid
        AND  is_cancelled = false
        AND  status      <> 'cancelled';
    END IF;
  END LOOP;

  IF cardinality(v_lo_ids) > 0 AND p_source_request_id IS NOT NULL THEN
    PERFORM public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
      p_source_request_id, p_student_id, p_school_id, v_lo_ids,
      p_payment_method, p_admin_id, NULL, NULL, 'recharge', false, 'excluded'
    );
  END IF;

  RETURN v_cleared_ids;
END;
$$;

SELECT 'fn_auto_apply_balance_to_pending_purchases v2 OK (excluye SUNAT)' AS paso_a;

-- ── B) Re-ejecutar limpieza de datos existentes (con filtro SUNAT) ───────────

DO $$
DECLARE
  v_student        record;
  v_tx             record;
  v_balance        numeric;
  v_sys_admin_id   uuid;
  v_cleared_count  int := 0;
  v_total_count    int := 0;
BEGIN
  SELECT id INTO v_sys_admin_id
  FROM   public.profiles
  WHERE  role IN ('superadmin', 'admin_general')
  LIMIT  1;

  FOR v_student IN
    SELECT DISTINCT s.id AS student_id, s.balance, s.school_id
    FROM   public.students s
    WHERE  COALESCE(s.balance, 0) > 0
      AND  EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE  t.student_id    = s.id
          AND  t.is_deleted    = false
          AND  t.type          = 'purchase'
          AND  t.payment_status IN ('pending', 'partial')
          AND  COALESCE(t.billing_status, '') NOT IN ('sent', 'invoiced', 'billed')
          AND  t.invoice_id IS NULL
      )
    ORDER  BY s.id
  LOOP
    v_cleared_count := 0;

    FOR v_tx IN
      SELECT t.id,
             ABS(t.amount)::numeric(10,2)     AS abs_amount,
             t.metadata->>'lunch_order_id'     AS lunch_order_id
      FROM   public.transactions t
      WHERE  t.student_id    = v_student.student_id
        AND  t.is_deleted    = false
        AND  t.type          = 'purchase'
        AND  t.payment_status IN ('pending', 'partial')
        AND  COALESCE(t.billing_status, '') NOT IN ('sent', 'invoiced', 'billed')
        AND  t.invoice_id IS NULL
      ORDER  BY t.created_at ASC
    LOOP
      SELECT balance INTO v_balance FROM public.students WHERE id = v_student.student_id;
      EXIT WHEN COALESCE(v_balance, 0) <= 0;
      EXIT WHEN COALESCE(v_balance, 0) < v_tx.abs_amount * 0.99;

      UPDATE public.transactions t
      SET
        payment_status = 'paid',
        payment_method = COALESCE(NULLIF(t.payment_method, ''), 'saldo'),
        metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
          'payment_approved',          true,
          'auto_applied_from_balance', true,
          'cleanup_migration',         '20260423_fix_auto_apply_v2',
          'approved_by',               COALESCE(v_sys_admin_id::text, 'system'),
          'approved_at',               to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
      WHERE t.id            = v_tx.id
        AND t.is_deleted    = false
        AND t.payment_status IN ('pending', 'partial')
        AND COALESCE(t.billing_status, '') NOT IN ('sent', 'invoiced', 'billed')
        AND t.invoice_id IS NULL;

      IF v_tx.lunch_order_id IS NOT NULL THEN
        UPDATE public.lunch_orders
        SET    status = 'confirmed'
        WHERE  id          = v_tx.lunch_order_id::uuid
          AND  is_cancelled = false
          AND  status      <> 'cancelled';
      END IF;

      v_cleared_count := v_cleared_count + 1;
    END LOOP;

    IF v_cleared_count > 0 THEN
      v_total_count := v_total_count + v_cleared_count;
      RAISE NOTICE 'Alumno % — % compra(s) saldada(s) automáticamente',
        v_student.student_id, v_cleared_count;
    END IF;
  END LOOP;

  RAISE NOTICE '=== LIMPIEZA COMPLETADA: % transacción(es) saldada(s) en total ===',
    v_total_count;
END $$;

SELECT 'LIMPIEZA v2 OK: deudas huérfanas saldadas (excluyendo transacciones SUNAT)' AS paso_b;
