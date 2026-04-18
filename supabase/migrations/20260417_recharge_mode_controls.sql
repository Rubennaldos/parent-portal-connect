-- ═══════════════════════════════════════════════════════════════════════════
-- Modo Recargas por alumno + auditoría
-- Fecha: 2026-04-17
--
-- OBJETIVO:
--   Separar dos conceptos que hoy están mezclados:
--   1) El alumno puede hacer NUEVAS recargas
--   2) El alumno aún tiene saldo de kiosco por consumir
--
-- REGLAS:
--   - free_account = true   → Cuenta Libre
--   - free_account = false  → saldo kiosco prepago / saldo a favor
--   - recharge_enabled = true  → puede crear nuevas recargas
--   - recharge_enabled = false → NO puede crear nuevas recargas
--
-- IMPORTANTE:
--   Un alumno puede tener:
--   - free_account = false
--   - recharge_enabled = false
--   - balance > 0
--   Eso significa: "Recargas desactivadas, pero sigue gastando su saldo a favor".
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS recharge_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN students.recharge_enabled IS
  'true = el alumno puede hacer nuevas recargas. '
  'false = no puede recargar, pero si free_account=false y balance>0 aún puede consumir su saldo a favor.';

-- Backfill seguro:
-- Los alumnos que ya estaban "Con Recargas" (free_account=false) arrancan habilitados.
UPDATE students
SET recharge_enabled = true
WHERE free_account = false
  AND recharge_enabled = false;

DROP FUNCTION IF EXISTS set_student_payment_mode(UUID, TEXT);

CREATE OR REPLACE FUNCTION set_student_payment_mode(
  p_student_id  UUID,
  p_target_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student                 students%ROWTYPE;
  v_actor_id                UUID := auth.uid();
  v_actor_role              TEXT;
  v_has_pending_recharge    BOOLEAN := false;
  v_has_kiosk_debt          BOOLEAN := false;
  v_prev_state              JSONB;
  v_next_state              JSONB;
  v_action                  TEXT;
BEGIN
  IF p_target_mode NOT IN ('recharge', 'recharge_paused', 'free') THEN
    RAISE EXCEPTION 'Modo inválido: %', p_target_mode;
  END IF;

  SELECT *
  INTO v_student
  FROM students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alumno no encontrado.';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  SELECT p.role
  INTO v_actor_role
  FROM profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_id <> v_student.parent_id
     AND COALESCE(v_actor_role, '') NOT IN ('admin_general', 'superadmin', 'gestor_unidad', 'admin') THEN
    RAISE EXCEPTION 'No autorizado para modificar este alumno.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM recharge_requests rr
    WHERE rr.student_id = p_student_id
      AND rr.status = 'pending'
      AND rr.request_type = 'recharge'
  )
  INTO v_has_pending_recharge;

  IF v_has_pending_recharge THEN
    RAISE EXCEPTION 'Tienes una recarga pendiente. Resuélvela antes de cambiar el modo.';
  END IF;

  v_prev_state := jsonb_build_object(
    'free_account',      v_student.free_account,
    'recharge_enabled',  v_student.recharge_enabled,
    'balance',           COALESCE(v_student.balance, 0),
    'limit_type',        COALESCE(v_student.limit_type, 'none'),
    'daily_limit',       COALESCE(v_student.daily_limit, 0),
    'weekly_limit',      COALESCE(v_student.weekly_limit, 0),
    'monthly_limit',     COALESCE(v_student.monthly_limit, 0),
    'next_reset_date',   v_student.next_reset_date
  );

  IF p_target_mode = 'recharge' THEN
    SELECT EXISTS (
      SELECT 1
      FROM view_student_debts d
      WHERE d.student_id = p_student_id
        AND COALESCE(d.es_almuerzo, false) = false
        AND COALESCE(d.monto, 0) > 0
    )
    INTO v_has_kiosk_debt;

    IF v_has_kiosk_debt THEN
      RAISE EXCEPTION 'Primero debes dejar el kiosco sin deuda para activar recargas.';
    END IF;

    IF ABS(COALESCE(v_student.balance, 0)) > 0.009 THEN
      RAISE EXCEPTION 'Para activar recargas, el saldo del kiosco debe estar en cero.';
    END IF;

    UPDATE students
    SET free_account    = false,
        recharge_enabled = true,
        limit_type      = 'none',
        daily_limit     = 0,
        weekly_limit    = 0,
        monthly_limit   = 0,
        current_period_spent = 0,
        next_reset_date = NULL
    WHERE id = p_student_id
    RETURNING * INTO v_student;

    v_action := 'ACTIVAR_RECARGAS';

  ELSIF p_target_mode = 'recharge_paused' THEN
    UPDATE students
    SET free_account     = false,
        recharge_enabled = false
    WHERE id = p_student_id
    RETURNING * INTO v_student;

    v_action := 'DESACTIVAR_RECARGAS';

  ELSE
    IF ABS(COALESCE(v_student.balance, 0)) > 0.009 THEN
      RAISE EXCEPTION 'Primero consume tu saldo a favor para volver a Cuenta Libre.';
    END IF;

    UPDATE students
    SET free_account     = true,
        recharge_enabled = false,
        limit_type       = 'none',
        daily_limit      = 0,
        weekly_limit     = 0,
        monthly_limit    = 0,
        current_period_spent = 0,
        next_reset_date  = NULL
    WHERE id = p_student_id
    RETURNING * INTO v_student;

    v_action := 'ACTIVAR_CUENTA_LIBRE';
  END IF;

  v_next_state := jsonb_build_object(
    'free_account',      v_student.free_account,
    'recharge_enabled',  v_student.recharge_enabled,
    'balance',           COALESCE(v_student.balance, 0),
    'limit_type',        COALESCE(v_student.limit_type, 'none'),
    'daily_limit',       COALESCE(v_student.daily_limit, 0),
    'weekly_limit',      COALESCE(v_student.weekly_limit, 0),
    'monthly_limit',     COALESCE(v_student.monthly_limit, 0),
    'next_reset_date',   v_student.next_reset_date
  );

  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_actor_id,
      v_action,
      'RECARGAS',
      jsonb_build_object(
        'student_id', p_student_id,
        'target_mode', p_target_mode,
        'before', v_prev_state,
        'after',  v_next_state
      ),
      v_student.school_id,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Auditoría falló en set_student_payment_mode: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'target_mode', p_target_mode,
    'free_account', v_student.free_account,
    'recharge_enabled', v_student.recharge_enabled,
    'balance', COALESCE(v_student.balance, 0)
  );
END;
$$;

COMMENT ON FUNCTION set_student_payment_mode(UUID, TEXT) IS
  'Cambia el modo de pago del alumno de forma auditable. '
  'recharge = activa recargas y apaga topes/cuenta libre; '
  'recharge_paused = desactiva nuevas recargas pero conserva saldo a favor; '
  'free = vuelve a cuenta libre solo si el saldo kiosco llegó a cero.';
