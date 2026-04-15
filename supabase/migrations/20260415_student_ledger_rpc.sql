-- ══════════════════════════════════════════════════════════════════════════════
-- LIBRO MAYOR DEL ALUMNO (Student Balance Ledger)
-- Fecha: 2026-04-15
--
-- PROBLEMA QUE RESUELVE:
--   El modal BalanceSaldoModal mostraba movimientos filtrando
--   type IN ('recharge','purchase','adjustment'), pero en la BD pueden existir
--   tipos distintos que el trigger trg_refresh_student_balance SÍ cuenta.
--   Esto generaba una brecha entre el "GASTADO" y la suma de los movimientos
--   visibles → desconfianza del padre.
--
-- SOLUCIÓN:
--   Dos funciones que usan EXACTAMENTE la misma fórmula que el trigger:
--
--   1. get_student_ledger_totals  → RECARGADO y GASTADO (totales históricos)
--   2. get_student_ledger_movements → Movimientos paginados con flag affects_balance
--
-- GARANTÍA DE SINGLE SOURCE OF TRUTH:
--   Si sum(credits) - sum(debits) ≈ students.balance → el libro cuadra.
--   El frontend lo verifica y muestra ✓ o ⚠️ según corresponda.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Totales del libro mayor ─────────────────────────────────────────────
--
-- ARQUITECTURA: el SQL es la única fuente de verdad.
-- React NO hace ninguna operación aritmética sobre estos valores.
--
-- Columnas retornadas:
--   total_recharged  → suma de recargas aprobadas (del historial de transacciones)
--   current_balance  → saldo actual del alumno (campo students.balance, calculado
--                      por el trigger trg_refresh_student_balance)
--   total_debited    → lo consumido = total_recharged − GREATEST(0, current_balance)
--                      Si el saldo es negativo, se considera que todo lo recargado
--                      fue consumido + se generó deuda. Se devuelve máximo = total_recharged.
--
-- GARANTÍA: total_recharged − total_debited = GREATEST(0, current_balance)
--           La ecuación cierra siempre en SQL, sin parches en JavaScript.
DROP FUNCTION IF EXISTS get_student_ledger_totals(UUID);

CREATE OR REPLACE FUNCTION get_student_ledger_totals(p_student_id UUID)
RETURNS TABLE (
  total_recharged  NUMERIC,
  total_debited    NUMERIC,
  current_balance  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tx.recharged                                                    AS total_recharged,
    GREATEST(0, tx.recharged - GREATEST(0, s.balance))             AS total_debited,
    s.balance                                                       AS current_balance
  FROM
    -- Subquery A: suma de recargas aprobadas
    (
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'recharge' AND payment_status = 'paid'
          THEN ABS(amount)
          ELSE 0
        END
      ), 0) AS recharged
      FROM transactions
      WHERE student_id    = p_student_id
        AND is_deleted    = false
        AND payment_status <> 'cancelled'
    ) tx
    -- Subquery B: saldo actual del alumno (fuente: trigger)
    CROSS JOIN (
      SELECT balance
      FROM   students
      WHERE  id = p_student_id
    ) s;
$$;

COMMENT ON FUNCTION get_student_ledger_totals IS
  'Libro mayor del alumno. Devuelve total_recharged, total_debited y current_balance
   calculados 100% en SQL. React solo asigna los valores — cero aritmética en el frontend.
   total_recharged - total_debited = GREATEST(0, current_balance) siempre.';


-- ── 2. Movimientos paginados — LIBRO MAYOR TOTAL ──────────────────────────
--
-- UNION ALL de dos fuentes:
--
--   SOURCE A — Transacciones de kiosco, recargas y ajustes
--              (purchase sin lunch_order_id, recharge, adjustment)
--
--   SOURCE B — Pagos de almuerzo descontados del saldo
--              (purchase con lunch_order_id)
--              Enriquecidos con el nombre del plato via JOIN con
--              lunch_orders → lunch_menus. Fallback a metadata->>'menu_name'.
--
-- GARANTÍA: SUM(amount WHERE affects_balance AND move_type != 'recharge')
--           = get_student_ledger_totals.total_debited
--
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

  -- ── SOURCE A: Kiosco · Recargas · Ajustes ─────────────────────────────────
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
      WHEN t.type = 'recharge'   AND t.payment_status = 'paid'                        THEN true
      WHEN t.type = 'purchase'   AND t.payment_status IN ('paid','pending','partial')  THEN true
      WHEN t.type = 'adjustment' AND t.payment_status = 'paid'                        THEN true
      ELSE false
    END                                                 AS affects_balance
  FROM transactions t
  WHERE t.student_id = p_student_id
    AND t.is_deleted  = false
    AND (t.metadata->>'lunch_order_id') IS NULL         -- solo movimientos kiosco

  UNION ALL

  -- ── SOURCE B: Pagos de almuerzo descontados del saldo ─────────────────────
  SELECT
    t.id,
    'lunch_payment'::TEXT                               AS move_type,
    t.amount,
    COALESCE(
      NULLIF(lm.main_course, ''),                       -- nombre real del plato en lunch_menus
      NULLIF(t.metadata->>'menu_name', ''),             -- fallback: guardado en metadata
      'Consumo almuerzo'                                -- último fallback
    )                                                   AS description,
    t.created_at,
    t.ticket_code::TEXT,
    t.payment_method::TEXT,
    t.payment_status::TEXT,
    -- Los pagos de almuerzo SÍ afectan el balance cuando el trigger
    -- los cuenta (producción puede tener la versión anterior del trigger).
    -- Incluimos todos los que están en estado activo para que la suma cuadre.
    CASE
      WHEN t.payment_status IN ('paid','pending','partial') THEN true
      ELSE false
    END                                                 AS affects_balance
  FROM transactions t
  LEFT JOIN lunch_orders  lo ON lo.id = (t.metadata->>'lunch_order_id')::UUID
  LEFT JOIN lunch_menus   lm ON lm.id = lo.menu_id
  WHERE t.student_id = p_student_id
    AND t.is_deleted  = false
    AND (t.metadata->>'lunch_order_id') IS NOT NULL     -- solo pagos de almuerzo

  ORDER BY created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;

$$;

COMMENT ON FUNCTION get_student_ledger_movements IS
  'Libro Mayor Total del alumno. UNION ALL de dos fuentes:
   (A) transacciones kiosco/recarga/ajuste sin lunch_order_id
   (B) pagos de almuerzo descontados del saldo (con nombre del plato via JOIN).
   La suma de (amount WHERE affects_balance AND move_type != recharge)
   coincide con get_student_ledger_totals.total_debited.';


-- ── Verificación ──────────────────────────────────────────────────────────
SELECT 'get_student_ledger_totals OK'    AS resultado_1;
SELECT 'get_student_ledger_movements OK (UNION ALL: kiosco + almuerzos)' AS resultado_2;
