-- ══════════════════════════════════════════════════════════════════════════════
-- Integridad financiera kiosco: vista sin saldo_negativo, RPC deuda pendiente,
-- trigger que llama sync_student_balance tras cada cambio en transactions.
-- Fecha: 2026-04-14
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1) sync_student_balance: incluir compras kiosco con payment_status = partial
--     (misma regla que view_student_debts tramo 1)
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
      WHEN type = 'recharge' AND payment_status = 'paid'
        THEN ABS(amount)
      WHEN type = 'purchase'
       AND payment_status IN ('paid', 'pending', 'partial')
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

  IF NOT p_dry_run AND ABS(v_diff) > 0.001 THEN
    BEGIN
      INSERT INTO huella_digital_logs (
        usuario_id, accion, modulo, contexto, school_id, creado_at
      )
      SELECT
        p_student_id,
        'SYNC_BALANCE',
        'MANTENIMIENTO',
        jsonb_build_object(
          'student_id',       p_student_id,
          'student_name',     v_student_name,
          'balance_anterior', v_current_balance,
          'balance_nuevo',    v_calculated,
          'diferencia',       v_diff
        ),
        school_id,
        NOW()
      FROM students WHERE id = p_student_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sync_student_balance: auditoría falló (no crítico): %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'student_id',       p_student_id,
    'student_name',     v_student_name,
    'balance_anterior', v_current_balance,
    'balance_calculado',v_calculated,
    'diferencia',       v_diff,
    'corregido',        (NOT p_dry_run AND ABS(v_diff) > 0.001),
    'dry_run',          p_dry_run
  );

END;
$$;

-- ── 2) Suma de deuda kiosco pendiente = solo transacciones (sin almuerzos)
CREATE OR REPLACE FUNCTION get_kiosk_pending_debt_total(p_student_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_role     TEXT;
  v_parent   UUID;
BEGIN
  v_caller := auth.uid();

  IF v_caller IS NULL THEN
    RETURN 0;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  SELECT parent_id INTO v_parent FROM students WHERE id = p_student_id;

  IF v_role IS NULL THEN
    RETURN 0;
  END IF;

  IF v_role NOT IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
     AND v_caller IS DISTINCT FROM v_parent THEN
    RAISE EXCEPTION 'FORBIDDEN: No puedes consultar la deuda de este alumno.';
  END IF;

  RETURN COALESCE((
    SELECT SUM(ABS(t.amount))::NUMERIC(10,2)
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.is_deleted = false
      AND t.payment_status IN ('pending', 'partial')
      AND (t.metadata->>'lunch_order_id') IS NULL
  ), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION get_kiosk_pending_debt_total(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION get_kiosk_pending_debt_total IS
  'Suma ABS(amount) de compras kiosco pendientes/parciales (sin almuerzos). Fuente alineada con la lista de pendientes.';

-- ── 3) Trigger: tras I/U/D en transactions → sincronizar saldo del alumno
CREATE OR REPLACE FUNCTION trg_refresh_student_balance_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    sid := OLD.student_id;
  ELSE
    sid := NEW.student_id;
  END IF;

  IF sid IS NOT NULL THEN
    PERFORM sync_student_balance(sid, false);
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.student_id IS NOT NULL
     AND NEW.student_id IS NOT NULL
     AND OLD.student_id IS DISTINCT FROM NEW.student_id THEN
    PERFORM sync_student_balance(OLD.student_id, false);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_student_balance ON transactions;

CREATE TRIGGER trg_refresh_student_balance
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW
  EXECUTE PROCEDURE trg_refresh_student_balance_fn();

COMMENT ON FUNCTION trg_refresh_student_balance_fn IS
  'Mantiene students.balance alineado con el historial de transactions (vía sync_student_balance).';

-- ── 4) Vista: eliminar TRAMO 3 (saldo_negativo basado en students.balance).
--     La deuda visible = transacciones + almuerzos virtuales (Regla fuente única).
--     DROP + CREATE porque ALTER VIEW no puede cambiar tipos de columna.
DROP VIEW IF EXISTS view_student_debts CASCADE;

CREATE VIEW view_student_debts AS

SELECT
  t.id::text                                              AS deuda_id,
  t.student_id                                            AS student_id,
  t.teacher_id                                            AS teacher_id,
  t.manual_client_name::text                              AS manual_client_name,
  t.school_id                                             AS school_id,
  ABS(t.amount)::numeric(10,2)                            AS monto,
  COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
  t.created_at                                            AS fecha,
  'transaccion'::text                                     AS fuente,
  ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
  t.metadata                                              AS metadata,
  t.ticket_code                                           AS ticket_code

FROM transactions t
WHERE t.type           = 'purchase'
  AND t.is_deleted     = false
  AND t.payment_status IN ('pending', 'partial')

UNION ALL

SELECT
  ('lunch_' || lo.id::text)::text                         AS deuda_id,
  lo.student_id                                           AS student_id,
  lo.teacher_id                                           AS teacher_id,
  lo.manual_name::text                                    AS manual_client_name,
  COALESCE(lo.school_id, st.school_id, tp.school_id_1)   AS school_id,
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
  ))::numeric(10,2)                                       AS monto,
  (
    'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
    CASE WHEN COALESCE(lo.quantity, 1) > 1
      THEN ' (' || lo.quantity::text || 'x)' ELSE '' END ||
    ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
  )::text                                                 AS descripcion,
  (lo.order_date::date + interval '12 hours')::timestamptz AS fecha,
  'almuerzo_virtual'::text                                AS fuente,
  true                                                    AS es_almuerzo,
  jsonb_build_object(
    'lunch_order_id', lo.id::text,
    'source',         'lunch_order',
    'order_date',     lo.order_date
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code

FROM lunch_orders lo
LEFT JOIN students            st   ON st.id  = lo.student_id
LEFT JOIN teacher_profiles    tp   ON tp.id  = lo.teacher_id
LEFT JOIN lunch_categories    lc   ON lc.id  = lo.category_id
LEFT JOIN lunch_configuration lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)

WHERE lo.is_cancelled = false
  AND (lo.payment_method = 'pagar_luego' OR lo.payment_method IS NULL)
  AND lo.status NOT IN ('cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM transactions t2
    WHERE  (t2.metadata->>'lunch_order_id') = lo.id::text
      AND  t2.is_deleted     = false
      AND  t2.payment_status IN ('pending', 'partial', 'paid')
  );

GRANT SELECT ON view_student_debts TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- Limpieza manual (ejecutar en SQL Editor tras deploy):
--   SELECT sync_student_balance(id, false)
--   FROM students
--   WHERE full_name ILIKE '%Micaela Patricia%'
--   LIMIT 1;
-- ══════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

SELECT '20260414_integridad_kiosco_balance aplicado' AS resultado;
