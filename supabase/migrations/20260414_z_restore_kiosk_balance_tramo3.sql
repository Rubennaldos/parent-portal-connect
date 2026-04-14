-- ══════════════════════════════════════════════════════════════════════════════
-- FIX: Restaurar TRAMO 3 (saldo_negativo) en view_student_debts
--
-- PROBLEMA:  La migración 20260414_integridad_kiosco_balance.sql eliminó el
--            Tramo 3 de la vista. Esto causó que:
--              · La pantalla de INICIO mostrara S/ X de deuda (usando un
--                fallback directo a students.balance en el código React).
--              · La pestaña de PAGOS dijera "Todo al día" (solo usa la vista).
--            El resultado: padres ven una deuda que no pueden pagar.
--
-- SOLUCIÓN:  Volver a agregar el Tramo 3.
--            El guard NOT EXISTS garantiza que NO se duplica: si ya hay
--            transacciones pending/partial de kiosco (Tramo 1 las cubre),
--            el alumno NO aparece en este tramo.
--
-- SEGURO para:
--   · get_billing_consolidated_debtors  → ya filtra WHERE fuente != 'saldo_negativo'
--   · get_parent_debts                  → devuelve todas las fuentes (correcto)
--   · ReporteDeudasCobranzas            → ya maneja fuente = 'saldo_negativo'
--   · BillingCollection                 → ya maneja metadata.is_kiosk_balance_debt
--   · PaymentsTab                       → ya tiene UI especial para kiosk_balance_ rows
-- ══════════════════════════════════════════════════════════════════════════════

-- NOTA SOBRE CASCADE:
-- DROP VIEW CASCADE elimina objetos con dependencia SQL directa (otras vistas).
-- Las funciones plpgsql (get_parent_debts, get_billing_consolidated_debtors)
-- referencian la vista por nombre en su cuerpo → NO son dropped por CASCADE.
-- Si en el futuro se agregan vistas que lean de view_student_debts, revisar aquí.
DROP VIEW IF EXISTS view_student_debts CASCADE;

CREATE VIEW view_student_debts AS

-- ── TRAMO 1: Compras registradas con pago pendiente ──────────────────────────
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

-- ── TRAMO 2: Almuerzos virtuales sin transacción registrada ──────────────────
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
  )

UNION ALL

-- ── TRAMO 3: Saldo negativo de kiosco sin transacciones pendientes ────────────
-- Solo aparece cuando students.balance < 0 Y no hay compras pending/partial.
-- Si ya hay compras pending/partial, el Tramo 1 las cubre → no se duplica.
-- El admin (get_billing_consolidated_debtors) filtra fuente != 'saldo_negativo'
-- para no mezclar con sus vistas de transacciones reales — eso no cambia.
SELECT
  ('kiosk_balance_' || s.id::text)::text                  AS deuda_id,
  s.id                                                    AS student_id,
  NULL::uuid                                              AS teacher_id,
  NULL::text                                              AS manual_client_name,
  s.school_id                                             AS school_id,
  ABS(s.balance)::numeric(10,2)                           AS monto,
  'Deuda en kiosco (saldo negativo)'::text                AS descripcion,
  NOW()                                                   AS fecha,
  'saldo_negativo'::text                                  AS fuente,
  false                                                   AS es_almuerzo,
  jsonb_build_object(
    'is_kiosk_balance_debt', true,
    'balance',               s.balance
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code

FROM students s
WHERE s.balance   < 0
  AND s.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM transactions t3
    WHERE  t3.student_id     = s.id
      AND  t3.type           = 'purchase'
      AND  t3.is_deleted     = false
      AND  t3.payment_status IN ('pending', 'partial')
      AND  (t3.metadata->>'lunch_order_id') IS NULL
  );

GRANT SELECT ON view_student_debts TO authenticated, service_role;

-- Forzar que PostgREST recargue el schema
NOTIFY pgrst, 'reload schema';

-- ── Verificaciones de integridad post-apply ────────────────────────────────
-- 1. Resumen de la vista por fuente:
-- SELECT fuente, COUNT(*), ROUND(SUM(monto),2) FROM view_student_debts GROUP BY fuente;

-- 2. Confirmar que las funciones críticas siguen existiendo (debe devolver 2 filas):
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('get_parent_debts', 'get_billing_consolidated_debtors');

-- 3. Confirmar que NO hay doble conteo para alumnos con saldo negativo:
-- SELECT s.full_name, s.balance, COUNT(vsd.*) as filas_tramo3
-- FROM students s
-- JOIN view_student_debts vsd ON vsd.student_id = s.id AND vsd.fuente = 'saldo_negativo'
-- WHERE s.balance < 0 AND s.is_active = true
-- GROUP BY s.id, s.full_name, s.balance
-- HAVING COUNT(vsd.*) > 1;  -- Debe devolver 0 filas

SELECT '20260414_z_restore_kiosk_balance_tramo3 aplicado OK' AS resultado;
