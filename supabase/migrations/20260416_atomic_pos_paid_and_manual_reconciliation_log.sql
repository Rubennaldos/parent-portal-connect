-- ══════════════════════════════════════════════════════════════════════════════
-- POS atómico: saldo solo por compras PAID + conciliación manual auditada
-- Fecha: 2026-04-16
--
-- Objetivo:
--   1) El saldo kiosco NO debe descontar compras pending/partial.
--   2) El libro mayor del padre usa la misma regla que el saldo.
--   3) Conciliar compras POS de hoy mal nacidas como pending cuando ya eran
--      compras "Saldo", dejando huella de auditoría.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1) Fuente única de verdad para saldo kiosco ──────────────────────────────
-- Regla: solo cuentan
--   + recargas paid
--   + compras kiosco paid (sin lunch_order_id)
--   + ajustes paid
CREATE OR REPLACE FUNCTION sync_student_balance(
  p_student_id  UUID,
  p_dry_run     BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance  NUMERIC;
  v_calculated       NUMERIC;
  v_diff             NUMERIC;
  v_student_name     TEXT;
BEGIN
  SELECT balance, full_name
  INTO   v_current_balance, v_student_name
  FROM   students
  WHERE  id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND: El alumno % no existe.', p_student_id;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN type = 'recharge'
       AND payment_status = 'paid'
        THEN ABS(amount)
      WHEN type = 'purchase'
       AND payment_status = 'paid'
       AND (metadata->>'lunch_order_id') IS NULL
        THEN amount
      WHEN type = 'adjustment'
       AND payment_status = 'paid'
        THEN amount
      ELSE 0
    END
  ), 0)
  INTO v_calculated
  FROM transactions
  WHERE student_id  = p_student_id
    AND is_deleted  = false
    AND payment_status <> 'cancelled';

  v_diff := v_calculated - COALESCE(v_current_balance, 0);

  IF NOT p_dry_run AND ABS(v_diff) > 0.001 THEN
    UPDATE students
    SET    balance = v_calculated
    WHERE  id = p_student_id;
  END IF;

  RETURN jsonb_build_object(
    'student_id',        p_student_id,
    'student_name',      v_student_name,
    'balance_anterior',  v_current_balance,
    'balance_calculado', v_calculated,
    'diferencia',        v_diff,
    'corregido',         (NOT p_dry_run AND ABS(v_diff) > 0.001),
    'dry_run',           p_dry_run
  );
END;
$$;

COMMENT ON FUNCTION sync_student_balance IS
  'Recalcula students.balance con regla atómica POS: purchase paid descuenta; pending/partial no descuenta.';


-- ── 2) Libro mayor consistente con la regla del saldo ────────────────────────
DROP FUNCTION IF EXISTS get_student_ledger_movements(UUID, INT, INT);

CREATE OR REPLACE FUNCTION get_student_ledger_movements(
  p_student_id UUID,
  p_limit      INT DEFAULT 20,
  p_offset     INT DEFAULT 0
)
RETURNS TABLE (
  id              UUID,
  move_type       TEXT,
  amount          NUMERIC,
  description     TEXT,
  created_at      TIMESTAMPTZ,
  ticket_code     TEXT,
  payment_method  TEXT,
  payment_status  TEXT,
  affects_balance BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- SOURCE A: Kiosco / Recargas / Ajustes
  SELECT
    t.id,
    t.type::TEXT                                        AS move_type,
    t.amount,
    COALESCE(t.description, '')                         AS description,
    t.created_at,
    t.ticket_code::TEXT,
    t.payment_method::TEXT,
    t.payment_status::TEXT,
    CASE
      WHEN t.type = 'recharge'   AND t.payment_status = 'paid'  THEN true
      WHEN t.type = 'purchase'   AND t.payment_status = 'paid'  THEN true
      WHEN t.type = 'adjustment' AND t.payment_status = 'paid'  THEN true
      ELSE false
    END                                                 AS affects_balance
  FROM transactions t
  WHERE t.student_id = p_student_id
    AND t.is_deleted  = false
    AND (t.metadata->>'lunch_order_id') IS NULL

  UNION ALL

  -- SOURCE B: Almuerzos (se muestran en historial, no descuentan saldo kiosco)
  SELECT
    t.id,
    'lunch_payment'::TEXT                               AS move_type,
    t.amount,
    COALESCE(
      NULLIF(lm.main_course, ''),
      NULLIF(t.metadata->>'menu_name', ''),
      'Consumo almuerzo'
    )                                                   AS description,
    t.created_at,
    t.ticket_code::TEXT,
    t.payment_method::TEXT,
    t.payment_status::TEXT,
    false                                               AS affects_balance
  FROM transactions t
  LEFT JOIN lunch_orders lo ON lo.id = (t.metadata->>'lunch_order_id')::UUID
  LEFT JOIN lunch_menus  lm ON lm.id = lo.menu_id
  WHERE t.student_id = p_student_id
    AND t.is_deleted  = false
    AND (t.metadata->>'lunch_order_id') IS NOT NULL

  ORDER BY created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION get_student_ledger_movements IS
  'Libro mayor alumno: almuerzos visibles pero affects_balance=false; compras kiosco descuentan solo si payment_status=paid.';


-- ── 3) Script de conciliación manual auditada (hoy) ─────────────────────────
CREATE OR REPLACE FUNCTION reconcile_today_pending_pos_paid(
  p_target_date DATE DEFAULT (timezone('America/Lima', NOW()))::date,
  p_log_note    TEXT DEFAULT 'Conciliación manual saldo - Caso Mia/Matias - Ajuste de estado a PAID'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INT := 0;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  WITH candidates AS (
    SELECT
      t.id,
      t.student_id,
      t.school_id,
      t.amount,
      t.ticket_code
    FROM transactions t
    JOIN students s ON s.id = t.student_id
    WHERE t.type = 'purchase'
      AND t.is_deleted = false
      AND t.payment_status = 'pending'
      AND (t.metadata->>'lunch_order_id') IS NULL
      AND t.description ILIKE 'Compra POS (Saldo)%'
      AND (timezone('America/Lima', t.created_at))::date = p_target_date
      AND COALESCE(s.balance, 0) >= ABS(t.amount)
  ),
  updated AS (
    UPDATE transactions t
    SET
      payment_status = 'paid',
      payment_method = COALESCE(NULLIF(t.payment_method, ''), 'saldo'),
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'manual_reconciled', true,
        'reconciled_reason', p_log_note,
        'reconciled_at', to_char(timezone('America/Lima', NOW()), 'YYYY-MM-DD"T"HH24:MI:SS')
      )
    FROM candidates c
    WHERE t.id = c.id
    RETURNING t.id, t.student_id, t.school_id, t.amount, t.ticket_code
  )
  SELECT
    COUNT(*),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'transaction_id', id,
        'student_id', student_id,
        'ticket_code', ticket_code,
        'amount', amount
      )
    ), '[]'::jsonb)
  INTO v_updated_count, v_rows
  FROM updated;

  IF v_updated_count > 0 THEN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    )
    SELECT
      r.actor_user_id,
      'CONCILIACION_MANUAL_SALDO',
      'COBRANZAS',
      jsonb_build_object(
        'message', p_log_note,
        'target_date', p_target_date,
        'transaction_id', r.id,
        'student_id', r.student_id,
        'ticket_code', r.ticket_code,
        'amount', r.amount
      ),
      r.school_id,
      NOW()
    FROM (
      SELECT
        u.id,
        u.student_id,
        u.school_id,
        u.amount,
        u.ticket_code,
        COALESCE(
          -- Actor principal: usuario que creó la transacción (si existe en auth.users)
          (SELECT t.created_by
           FROM transactions t
           JOIN auth.users us ON us.id = t.created_by
           WHERE t.id = u.id
           LIMIT 1),
          -- Fallback: primer usuario válido del sistema para no romper FK
          (SELECT us2.id FROM auth.users us2 ORDER BY us2.created_at ASC LIMIT 1)
        ) AS actor_user_id
      FROM (
        SELECT id, student_id, school_id, amount, ticket_code
        FROM transactions
        WHERE id IN (
          SELECT (row->>'transaction_id')::uuid
          FROM jsonb_array_elements(v_rows) AS row
        )
      ) u
    ) r
    WHERE r.actor_user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'target_date', p_target_date,
    'updated_count', v_updated_count,
    'updated_rows', v_rows,
    'log_message', p_log_note
  );
END;
$$;

COMMENT ON FUNCTION reconcile_today_pending_pos_paid IS
  'Concilia compras POS de hoy mal creadas como pending (Compra POS Saldo) y deja auditoría en huella_digital_logs.';

-- Ejecutar conciliación de hoy al aplicar la migración
SELECT reconcile_today_pending_pos_paid(
  (timezone('America/Lima', NOW()))::date,
  'Conciliación manual saldo - Caso Mia/Matias - Ajuste de estado a PAID'
);

NOTIFY pgrst, 'reload schema';

