-- ============================================================================
-- FASE 1 — MODO PREPAGO: TRIGGER DE CONTROL (fn_handle_prepayment_logic)
-- Fecha: 2026-05-10
-- Ejecutar DESPUÉS de 20260510_c_prepayment_phase0_foundations.sql
--
-- Qué hace esta migración:
--   1. Crea (o reemplaza) la función fn_handle_prepayment_logic.
--      Se ejecuta BEFORE INSERT en lunch_orders y decide si el pedido
--      entra como confirmed_paid o frozen_pending_payment según la
--      configuración de la sede.
--
--   2. Crea (o reemplaza) el trigger trg_lunch_orders_prepayment
--      vinculado a esa función.
--
-- Garantías de no-regresión:
--   - Bypass total para admin_general / superadmin / admin_sede.
--   - Si no existe configuración para la sede → confirmed_paid (permisivo).
--   - Si force_prepayment = FALSE → confirmed_paid (flujo actual intacto).
--   - Si force_prepayment = TRUE  → frozen_pending_payment (standby).
--   - El campo `status` legacy NO se toca: cocina e Izipay siguen igual.
--   - Solo se escribe `payment_flow_state`, la columna nueva de Fase 0.
--
-- Orden de triggers BEFORE INSERT en lunch_orders (Postgres ejecuta
-- triggers del mismo tipo en orden alfabético de nombre):
--   1. trg_lunch_orders_prepayment   (este)  → asigna payment_flow_state
--   2. trg_validate_lunch_order_deadline     → rechaza si el plazo venció
--   El orden es correcto: primero asignamos el estado, luego validamos el horario.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FUNCIÓN: fn_handle_prepayment_logic
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_prepayment_logic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role    TEXT;
  v_school_id      UUID;
  v_force_prepay   BOOLEAN := false;
BEGIN
  -- ── Guard 1: bypass para roles administrativos ───────────────────────────
  -- Admin general, superadmin y admin_sede siempre entran como confirmed_paid.
  -- Esto permite correcciones manuales, pedidos de emergencia y gestión operativa
  -- sin que el modo prepago interfiera en la administración del día.
  SELECT role
    INTO v_caller_role
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_caller_role IN ('admin_general', 'superadmin', 'admin_sede') THEN
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
  END IF;

  -- ── Guard 2: resolver school_id ──────────────────────────────────────────
  -- Jerarquía:  NEW.school_id → students.school_id → teacher_profiles.school_id_1
  -- Si ninguno resuelve, comportamiento permisivo (confirmed_paid).
  v_school_id := NEW.school_id;

  IF v_school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id
      INTO v_school_id
      FROM public.students
     WHERE id = NEW.student_id;
  END IF;

  IF v_school_id IS NULL AND NEW.teacher_id IS NOT NULL THEN
    SELECT school_id_1
      INTO v_school_id
      FROM public.teacher_profiles
     WHERE id = NEW.teacher_id;
  END IF;

  IF v_school_id IS NULL THEN
    -- Sin sede identificable → comportamiento seguro: no congelar
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
  END IF;

  -- ── Guard 3: leer interruptor force_prepayment de la sede ────────────────
  -- Si la sede no tiene configuración → permisivo (confirmed_paid).
  SELECT COALESCE(force_prepayment, false)
    INTO v_force_prepay
    FROM public.lunch_configuration
   WHERE school_id = v_school_id
   LIMIT 1;

  IF NOT FOUND THEN
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
  END IF;

  -- ── Decisión central ─────────────────────────────────────────────────────
  IF v_force_prepay THEN
    NEW.payment_flow_state := 'frozen_pending_payment'::public.lunch_order_payment_state;
  ELSE
    -- Flujo normal: confirmado directamente (comportamiento pre-Fase 1)
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
  END IF;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- ── Fallback de seguridad ────────────────────────────────────────────────
    -- Si cualquier excepción ocurre en esta función, NO se bloquea el INSERT.
    -- El pedido entra como confirmed_paid para no romper el servicio de mañana.
    -- El error queda registrado en los logs de Postgres para diagnóstico.
    RAISE WARNING 'fn_handle_prepayment_logic: excepción capturada (%) — fallback a confirmed_paid para school_id=%',
      SQLERRM, v_school_id;
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_handle_prepayment_logic() IS
  'Trigger BEFORE INSERT en lunch_orders. Asigna payment_flow_state según force_prepayment de la sede. Admins siempre confirmed_paid. Fallback permisivo si falla.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TRIGGER: trg_lunch_orders_prepayment
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP + CREATE garantiza idempotencia (no usamos CREATE OR REPLACE en triggers).
DROP TRIGGER IF EXISTS trg_lunch_orders_prepayment ON public.lunch_orders;

CREATE TRIGGER trg_lunch_orders_prepayment
  BEFORE INSERT ON public.lunch_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_handle_prepayment_logic();

COMMENT ON TRIGGER trg_lunch_orders_prepayment ON public.lunch_orders IS
  'Fase 1 prepago: asigna payment_flow_state antes de insertar. Se ejecuta antes de trg_validate_lunch_order_deadline (orden alfabético).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFICACIÓN INTERNA (consulta de diagnóstico)
-- ─────────────────────────────────────────────────────────────────────────────
-- Muestra el estado final de ambos triggers en lunch_orders para confirmar
-- que coexisten correctamente.
SELECT
  tgname                     AS trigger_name,
  tgenabled                  AS enabled,
  CASE tgtype & 66
    WHEN 2  THEN 'BEFORE'
    WHEN 64 THEN 'INSTEAD OF'
    ELSE         'AFTER'
  END                        AS timing,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 20 THEN 'INSERT OR UPDATE'
    WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
    ELSE         'OTHER'
  END                        AS event
FROM   pg_trigger
WHERE  tgrelid = 'public.lunch_orders'::regclass
  AND  tgname IN ('trg_lunch_orders_prepayment', 'trg_validate_lunch_order_deadline')
ORDER  BY tgname;

SELECT
  '20260510_d_prepayment_phase1_trigger ✅ fn_handle_prepayment_logic + trg_lunch_orders_prepayment creados' AS resultado;
