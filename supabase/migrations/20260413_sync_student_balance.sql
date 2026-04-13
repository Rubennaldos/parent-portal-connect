-- ══════════════════════════════════════════════════════════════════════════════
-- RPC: sync_student_balance
-- Fecha: 2026-04-13
--
-- PROPÓSITO:
--   Recalcula y corrige el saldo de un alumno sumando todas las transacciones
--   reales (recargas pagadas - consumos pagados). Útil para:
--     1. Corregir discrepancias luego de anulaciones de pagos
--     2. Limpieza de "deudas fantasma" que no corresponden a transacciones reales
--     3. Auditoría y mantenimiento periódico
--
-- FUENTE DE VERDAD:
--   El saldo correcto es la suma algebraica de transactions donde:
--     - type = 'recharge', payment_status = 'paid'  → suma positiva (recarga)
--     - type = 'purchase', payment_status = 'paid'  → suma negativa (consumo)
--     - type = 'adjustment'                         → suma algebraica
--   Se EXCLUYEN:
--     - payment_status IN ('pending', 'cancelled')
--     - is_deleted = true
--     - Pagos de almuerzo (metadata->>'lunch_order_id' IS NOT NULL)
--       porque almuerzos no afectan el saldo del kiosco (Regla #1)
--
-- PARÁMETROS:
--   p_student_id  UUID del alumno a sincronizar
--   p_dry_run     Si true, solo retorna el cálculo sin modificar nada (default: false)
--
-- RETORNA: JSONB con el resultado del cálculo y la corrección aplicada
-- ══════════════════════════════════════════════════════════════════════════════

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

  -- ── Bloquear fila del alumno para evitar race conditions ──────────────────
  SELECT balance, full_name
  INTO   v_current_balance, v_student_name
  FROM   students
  WHERE  id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND: El alumno % no existe.', p_student_id;
  END IF;

  -- ── Calcular saldo correcto desde transacciones reales ────────────────────
  -- Solo transacciones de kiosco (sin lunch_order_id → Regla #1)
  -- Solo estados que realmente afectan el saldo:
  --   'paid' recargas → crédito positivo
  --   'paid' compras  → débito negativo (amount ya es negativo en BD)
  --   'paid' ajustes  → algebraico
  -- Se incluyen también payment_status='pending' de type=purchase porque
  -- representan deuda real ya consumida que el alumno debe.
  SELECT COALESCE(SUM(
    CASE
      -- Recargas pagadas → crédito al saldo
      WHEN type = 'recharge' AND payment_status = 'paid'
        THEN ABS(amount)
      -- Consumos pagados o pendientes (kiosco) → débito
      WHEN type = 'purchase'
       AND payment_status IN ('paid', 'pending')
       AND (metadata->>'lunch_order_id') IS NULL
        THEN amount   -- amount es negativo en BD para compras
      -- Ajustes → algebraico
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

  -- ── Aplicar corrección si hay diferencia y no es dry_run ─────────────────
  IF NOT p_dry_run AND ABS(v_diff) > 0.001 THEN
    UPDATE students
    SET    balance = v_calculated
    WHERE  id = p_student_id;
  END IF;

  -- ── Auditoría ─────────────────────────────────────────────────────────────
  IF NOT p_dry_run AND ABS(v_diff) > 0.001 THEN
    BEGIN
      INSERT INTO huella_digital_logs (
        usuario_id, accion, modulo, contexto, school_id, creado_at
      )
      SELECT
        p_student_id,   -- se usa student_id como actor de mantenimiento
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

GRANT EXECUTE ON FUNCTION sync_student_balance(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION sync_student_balance IS
  'Recalcula el saldo de un alumno desde sus transacciones reales.
   Excluye pagos de almuerzo (Regla #1: almuerzos no afectan balance kiosco).
   Incluye deudas de kiosco pendientes como débito.
   p_dry_run=true solo retorna el cálculo sin modificar nada.';


-- ══════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: Verificar balance de Micaela Patricia post-anulación
-- Ejecutar en Supabase Studio para confirmar que todo está correcto
-- ══════════════════════════════════════════════════════════════════════════════

-- TEST 1: Ver el saldo actual vs calculado (dry_run)
-- SELECT sync_student_balance(
--   (SELECT id FROM students WHERE full_name ILIKE '%Micaela Patricia%' LIMIT 1),
--   true   -- dry_run: solo muestra, no corrige
-- );

-- TEST 2: Ver todas las transacciones de kiosco de Micaela Patricia
-- SELECT
--   t.id,
--   t.type,
--   t.amount,
--   t.payment_status,
--   t.ticket_code,
--   t.created_at::date,
--   t.metadata->>'recharge_request_id' AS rr_id,
--   t.metadata->>'voided' AS voided
-- FROM transactions t
-- JOIN students s ON s.id = t.student_id
-- WHERE s.full_name ILIKE '%Micaela Patricia%'
--   AND t.is_deleted = false
--   AND (t.metadata->>'lunch_order_id') IS NULL
-- ORDER BY t.created_at DESC;

-- TEST 3: Deudas pendientes visibles para el padre
-- SELECT
--   deuda_id,
--   monto,
--   descripcion,
--   fuente,
--   fecha::date
-- FROM view_student_debts
-- WHERE student_id = (
--   SELECT id FROM students WHERE full_name ILIKE '%Micaela Patricia%' LIMIT 1
-- )
-- ORDER BY fecha DESC;

NOTIFY pgrst, 'reload schema';
SELECT 'sync_student_balance creado OK' AS resultado;
