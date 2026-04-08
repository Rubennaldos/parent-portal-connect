-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD: Topes de Consumo y Kiosco — BEFORE INSERT en transactions
-- Fecha: 2026-04-06
--
-- ARQUITECTURA:
--   En lugar de modificar la función complete_pos_sale_v2 (400+ líneas),
--   se agrega un trigger BEFORE INSERT en la tabla transactions.
--   El trigger es más seguro porque:
--   · No requiere tocar el código del POS
--   · Se dispara para CUALQUIER vía que inserte una compra de kiosco
--   · Si lanza excepción, el INSERT completo se revierte (atomicidad)
--
-- REGLA DE ORO #1 RESPETADA:
--   Los ítems de ALMUERZO están siempre exentos.
--   Un ítem es de almuerzo si metadata->>'lunch_order_id' IS NOT NULL.
--   Un ítem es de kiosco/cafetería si lunch_order_id IS NULL.
--
-- VALIDACIONES (solo para compras de kiosco de alumno):
--   1. Si kiosk_disabled = TRUE → rechaza con KIOSK_DISABLED
--   2. Si limit_type IN (daily/weekly/monthly) y el gasto del período
--      + monto actual > límite → rechaza con SPENDING_LIMIT
--
-- NOTA: El check de kiosk_disabled en complete_pos_sale_v2 (paso 2)
--   sigue activo. Este trigger agrega la capa de topes de consumo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_guard_kiosk_spending_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student      record;
  v_limit_amount numeric;
  v_period_start timestamptz;
  v_period_spent numeric;
BEGIN
  -- ── Solo aplica a compras de kiosco de alumno ──────────────────────────
  -- Condiciones para activar la validación:
  --   a) Es una compra (type = 'purchase')
  --   b) Tiene alumno vinculado (student_id IS NOT NULL)
  --   c) NO tiene lunch_order_id en metadata (es kiosco, no almuerzo)
  IF NEW.type <> 'purchase'
     OR NEW.student_id IS NULL
     OR (NEW.metadata->>'lunch_order_id') IS NOT NULL
  THEN
    RETURN NEW; -- Almuerzos, profesores, clientes genéricos: siempre pasan
  END IF;

  -- ── Cargar configuración del alumno ────────────────────────────────────
  SELECT
    s.kiosk_disabled,
    s.limit_type,
    s.daily_limit,
    s.weekly_limit,
    s.monthly_limit
  INTO v_student
  FROM students s
  WHERE s.id = NEW.student_id;

  IF NOT FOUND THEN
    RETURN NEW; -- Alumno no encontrado: el RPC ya lanzaría STUDENT_NOT_FOUND
  END IF;

  -- ── Validación 1: Kiosco desactivado ───────────────────────────────────
  IF COALESCE(v_student.kiosk_disabled, false) THEN
    RAISE EXCEPTION
      'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos desde el calendario.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Validación 2: Topes de consumo ────────────────────────────────────
  IF v_student.limit_type IN ('daily', 'weekly', 'monthly') THEN

    -- Monto límite según tipo
    v_limit_amount := CASE v_student.limit_type
      WHEN 'daily'   THEN COALESCE(v_student.daily_limit,   0)
      WHEN 'weekly'  THEN COALESCE(v_student.weekly_limit,  0)
      WHEN 'monthly' THEN COALESCE(v_student.monthly_limit, 0)
      ELSE 0
    END;

    IF v_limit_amount <= 0 THEN
      RETURN NEW; -- Límite en 0 = sin restricción efectiva
    END IF;

    -- Inicio del período actual en hora Lima (UTC-5, sin DST)
    -- Lima midnight = 05:00 UTC
    v_period_start := CASE v_student.limit_type
      WHEN 'daily'
        THEN (timezone('America/Lima', NOW())::date)::timestamp
               AT TIME ZONE 'America/Lima'

      WHEN 'weekly'
        -- date_trunc('week') da el lunes de la semana ISO
        THEN date_trunc('week', timezone('America/Lima', NOW())::timestamp)
               AT TIME ZONE 'America/Lima'

      WHEN 'monthly'
        THEN date_trunc('month', timezone('America/Lima', NOW())::timestamp)
               AT TIME ZONE 'America/Lima'
    END;

    -- Sumar gasto de kiosco del período actual (excluir almuerzos)
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_period_spent
    FROM transactions t
    WHERE t.student_id    = NEW.student_id
      AND t.type          = 'purchase'
      AND t.is_deleted    = false
      AND t.payment_status <> 'cancelled'
      AND (t.metadata->>'lunch_order_id') IS NULL   -- Solo kiosco
      AND t.created_at   >= v_period_start;

    -- Verificar si la compra actual supera el límite
    IF v_period_spent + ABS(NEW.amount) > v_limit_amount THEN
      RAISE EXCEPTION
        'SPENDING_LIMIT: Has alcanzado el límite de consumo % (S/ %). '
        'Gastado este período: S/ %. Disponible: S/ %.',
        v_student.limit_type,
        round(v_limit_amount, 2),
        round(v_period_spent, 2),
        round(GREATEST(0, v_limit_amount - v_period_spent), 2)
        USING ERRCODE = 'P0001';
    END IF;

  END IF;
  -- ── Fin validaciones ──────────────────────────────────────────────────

  RETURN NEW;
END;
$$;

-- Eliminar trigger si existe (para poder recrearlo limpio)
DROP TRIGGER IF EXISTS trg_guard_kiosk_spending_limits ON transactions;

-- Crear trigger BEFORE INSERT
-- Se dispara para CADA FILA nueva en transactions
CREATE TRIGGER trg_guard_kiosk_spending_limits
  BEFORE INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_kiosk_spending_limits();

-- Verificación
SELECT
  tgname        AS trigger,
  tgtype        AS tipo,
  proname       AS funcion,
  prosecdef     AS security_definer
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgname = 'trg_guard_kiosk_spending_limits';

SELECT 'GUARD aplicado: topes de consumo + kiosco activos en transactions' AS resultado;
