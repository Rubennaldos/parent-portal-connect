-- ============================================================
-- VIEW: view_student_debts  (v2)
-- Única fuente de verdad para deudas de alumnos.
-- Cambios vs v1:
--   - fecha es TIMESTAMPTZ (conserva hora, no solo fecha)
--   - agrega columna ticket_code (para mostrar en el portal de padres)
-- ============================================================

DROP VIEW IF EXISTS view_student_debts;

CREATE OR REPLACE VIEW view_student_debts AS

-- ── TRAMO 1: Transacciones reales pendientes ─────────────────────────────────
SELECT
  t.id::text                                              AS deuda_id,
  t.student_id                                            AS student_id,
  t.school_id                                             AS school_id,
  ABS(t.amount)::numeric(10,2)                            AS monto,
  COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
  t.created_at                                            AS fecha,          -- TIMESTAMPTZ: conserva la hora
  'transaccion'::text                                     AS fuente,
  ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
  t.metadata                                              AS metadata,
  t.ticket_code                                           AS ticket_code     -- Código de ticket para mostrar al padre

FROM transactions t
WHERE t.type           = 'purchase'
  AND t.is_deleted     = false
  AND t.payment_status IN ('pending', 'partial')

UNION ALL

-- ── TRAMO 2: Almuerzos "pagar después" sin transacción registrada ─────────────
SELECT
  ('lunch_' || lo.id::text)::text                         AS deuda_id,
  lo.student_id                                           AS student_id,
  COALESCE(lo.school_id, st.school_id)                    AS school_id,
  ABS(ROUND(
    CASE
      WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
        THEN lo.final_price
      WHEN lc.price IS NOT NULL AND lc.price > 0
        THEN lc.price * COALESCE(lo.quantity, 1)
      WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
        THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
      ELSE
        7.50 * COALESCE(lo.quantity, 1)
    END, 2
  ))::numeric(10,2)                                       AS monto,
  (
    'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
    CASE
      WHEN COALESCE(lo.quantity, 1) > 1
        THEN ' (' || lo.quantity::text || 'x)'
      ELSE ''
    END ||
    ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
  )::text                                                 AS descripcion,
  -- Usamos mediodía como hora representativa del pedido de almuerzo
  (lo.order_date::date + interval '12 hours')::timestamptz AS fecha,
  'almuerzo_virtual'::text                                AS fuente,
  true                                                    AS es_almuerzo,
  jsonb_build_object(
    'lunch_order_id', lo.id::text,
    'source',         'lunch_order',
    'order_date',     lo.order_date
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code    -- Almuerzos no tienen ticket de kiosco

FROM lunch_orders lo
LEFT JOIN students            st   ON st.id  = lo.student_id
LEFT JOIN lunch_categories    lc   ON lc.id  = lo.category_id
LEFT JOIN lunch_configuration lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id)

WHERE lo.is_cancelled   = false
  AND lo.payment_method = 'pagar_luego'
  AND lo.status NOT IN ('cancelled')
  AND NOT EXISTS (
    SELECT 1
    FROM   transactions t2
    WHERE  (t2.metadata->>'lunch_order_id') = lo.id::text
      AND  t2.is_deleted     = false
      AND  t2.payment_status IN ('pending', 'partial', 'paid')
  )

UNION ALL

-- ── TRAMO 3: Saldo negativo del kiosco ───────────────────────────────────────
SELECT
  ('kiosk_balance_' || s.id::text)::text                  AS deuda_id,
  s.id                                                    AS student_id,
  s.school_id                                             AS school_id,
  ABS(s.balance)::numeric(10,2)                           AS monto,
  'Deuda en kiosco (saldo negativo)'::text                AS descripcion,
  NOW()                                                   AS fecha,         -- Momento actual como referencia
  'saldo_negativo'::text                                  AS fuente,
  false                                                   AS es_almuerzo,
  jsonb_build_object(
    'is_kiosk_balance_debt', true,
    'balance',               s.balance
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code    -- Saldo negativo no tiene ticket

FROM students s
WHERE s.balance   < 0
  AND s.is_active = true
  -- Excluir si ya hay transacciones POS pendientes (Tramo 1 ya las cubre)
  AND NOT EXISTS (
    SELECT 1
    FROM   transactions t3
    WHERE  t3.student_id     = s.id
      AND  t3.type           = 'purchase'
      AND  t3.is_deleted     = false
      AND  t3.payment_status IN ('pending', 'partial')
      AND  (t3.metadata->>'lunch_order_id') IS NULL
  );


-- ============================================================
-- FUNCIÓN RPC: get_parent_debts(p_parent_id)
-- Devuelve todas las deudas pendientes de los hijos de un padre.
-- Usada por el Portal de Padres (PaymentsTab).
-- Seguridad: solo devuelve datos si p_parent_id = auth.uid()
--            o si el caller es admin/superadmin.
-- ============================================================

DROP FUNCTION IF EXISTS get_parent_debts(uuid);

CREATE OR REPLACE FUNCTION get_parent_debts(p_parent_id uuid)
RETURNS TABLE(
  deuda_id    text,
  student_id  uuid,
  school_id   uuid,
  monto       numeric,
  descripcion text,
  fecha       timestamptz,
  fuente      text,
  es_almuerzo boolean,
  metadata    jsonb,
  ticket_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
BEGIN
  v_caller_id := auth.uid();

  -- Solo el propio padre o un admin puede consultar
  SELECT role INTO v_caller_role
  FROM profiles
  WHERE id = v_caller_id;

  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  -- Padres solo pueden consultar sus propios hijos
  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
    AND v_caller_id <> p_parent_id THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      vsd.deuda_id,
      vsd.student_id,
      vsd.school_id,
      vsd.monto,
      vsd.descripcion,
      vsd.fecha,
      vsd.fuente,
      vsd.es_almuerzo,
      vsd.metadata,
      vsd.ticket_code
    FROM view_student_debts vsd
    WHERE vsd.student_id IN (
      SELECT s.id
      FROM   students s
      WHERE  s.parent_id = p_parent_id
        AND  s.is_active = true
    )
    ORDER BY vsd.fecha DESC;
END;
$$;
