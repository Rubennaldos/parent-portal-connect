-- ============================================================================
-- MIGRACIÓN SSOT v1: Prepago neto como única fuente de verdad de students.balance
-- Fecha: 2026-06-19
-- ============================================================================
--
-- DIAGNÓSTICO (RESUMEN):
--   students.balance acumuló escritores incompatibles durante meses:
--     1. fn_sync_student_balance v1  → balance += NEW.amount (incremental roto)
--     2. fn_sync_student_balance v2  → SUM(ABS(pending)) → convierte deuda en saldo falso
--     3. adjust_student_balance      → UPDATE balance += p_amount sin TX en ledger
--     4. complete_pos_sale_v2        → UPDATE balance -= v_total antes del INSERT de TX
--   Resultado: 39+ alumnos con "saldo a favor fantasma" sin recargas reales.
--
-- SOLUCIÓN (ESTA MIGRACIÓN):
--   A) fn_calculate_student_prepay_net  → fórmula canónica (recargas – consumos)
--   B) fn_sync_student_balance          → reescrita; llama A; ÚNICO UPDATE a balance
--   C) fn_get_student_spendable_prepay  → helper para POS (Fase 2)
--   D) adjust_student_balance           → NO-OP (devuelve balance actual sin mutarlo)
--   E) Saneamiento masivo               → recalcula todos los alumnos activos
--   F) ASSERT final                     → falla la migración si queda divergencia
--
-- ALCANCE EXPLÍCITO:
--   ✅ Cambia: fn_sync_student_balance, adjust_student_balance
--   ✅ Crea:   fn_calculate_student_prepay_net, fn_get_student_spendable_prepay
--   ✅ Sanea:  students.balance en todos los alumnos activos
--   ❌ NO cambia: complete_pos_sale_v2  (se comporta correctamente con nueva fórmula)
--   ❌ NO cambia: void_pos_sale_with_nc  (adjust es NO-OP, trigger ya maneja la devolución)
--   ❌ NO cambia: process_payment_collection (adjust es NO-OP, trigger recalcula al marcar paid)
--   ❌ NO cambia: izipay-webhook, apply_gateway_credit, logs_pasarela (Regla 0.A INMUTABLE)
--   ❌ NO cambia: view_recharge_ledger (Fase 2, sin impacto en esta migración)
--
-- FASE 2 (pendiente): actualizar complete_pos_sale_v2 para usar fn_get_student_spendable_prepay
--                     en lugar de leer students.balance directamente; REVOKE adjust_student_balance.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE 1: fn_calculate_student_prepay_net
--   Fórmula matemática pura:
--     + SUM de recargas aprobadas (type='recharge', status='paid', amount > 0)
--     - SUM de compras kiosco pagadas (type='purchase', status='paid', amount < 0, sin almuerzo)
--     - SUM de almuerzos pagados con saldo/balance/wallet_balance/mixto
--   Coincide con la lógica de student_consumed en view_recharge_ledger.
--   NO usa wallet_transactions (esa tabla alimenta wallet_balance, no balance).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_calculate_student_prepay_net(
  p_student_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recharged numeric := 0;
  v_consumed  numeric := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN 0;
  END IF;

  -- -----------------------------------------------------------------------
  -- Recargas aprobadas (voucher manual + IziPay → ambas generan transaction type='recharge')
  -- -----------------------------------------------------------------------
  SELECT COALESCE(SUM(t.amount), 0)
    INTO v_recharged
  FROM public.transactions t
  WHERE t.student_id     = p_student_id
    AND t.type           = 'recharge'
    AND t.payment_status = 'paid'
    AND t.amount         > 0
    AND t.is_deleted     IS NOT TRUE;

  -- -----------------------------------------------------------------------
  -- Consumo 1: compras de kiosco pagadas (excluye almuerzos)
  -- Nota: no filtramos por payment_method; cualquier compra kiosco pagada
  -- reduce el prepago (consistente con view_recharge_ledger.student_consumed).
  -- -----------------------------------------------------------------------
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_consumed
  FROM public.transactions t
  WHERE t.student_id                    = p_student_id
    AND t.type                          = 'purchase'
    AND t.payment_status                = 'paid'
    AND t.amount                        < 0
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.is_deleted                    IS NOT TRUE;

  -- -----------------------------------------------------------------------
  -- Consumo 2: almuerzos pagados con saldo
  -- Solo se restan si payment_method indica pago desde monedero.
  -- -----------------------------------------------------------------------
  SELECT v_consumed + COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_consumed
  FROM public.transactions t
  WHERE t.student_id                    = p_student_id
    AND t.type                          = 'purchase'
    AND t.payment_status                = 'paid'
    AND t.amount                        < 0
    AND (t.metadata->>'lunch_order_id') IS NOT NULL
    AND lower(trim(COALESCE(t.payment_method, ''))) IN (
          'saldo', 'balance', 'wallet_balance', 'mixto'
        )
    AND t.is_deleted                    IS NOT TRUE;

  RETURN ROUND(v_recharged - v_consumed, 2);
END;
$function$;

COMMENT ON FUNCTION public.fn_calculate_student_prepay_net(uuid) IS
  'SSOT prepago neto puro: SUM(recargas paid) - SUM(kiosco paid) - SUM(almuerzos paid saldo). '
  'Espejo exacto de view_recharge_ledger.student_consumed. '
  'NUNCA usar SUM(ABS(pending)). NUNCA calcular en el frontend.';

-- ============================================================================
-- PARTE 2: fn_sync_student_balance  ← REESCRITA
--   Única función autorizada para escribir en students.balance.
--   Fórmula: GREATEST(0, fn_calculate_student_prepay_net(p_student_id))
--   Advisory lock por alumno para serializar concurrencia.
--   Firma idéntica a versión anterior (uuid → void); el trigger no cambia.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_student_balance(
  p_student_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prepay_net numeric;
  v_lock_key   bigint;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN;
  END IF;

  -- Advisory lock transaccional: serializa recálculos para el mismo alumno.
  -- Si otra sesión ya tiene el lock para este alumno, espera.
  v_lock_key := ('x' || substr(md5(p_student_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  v_prepay_net := public.fn_calculate_student_prepay_net(p_student_id);

  -- GREATEST(0, ...) garantiza que el balance nunca sea negativo.
  -- Si no hay recargas reales: balance = 0 (no saldo fantasma).
  UPDATE public.students
  SET balance = GREATEST(0, v_prepay_net)
  WHERE id = p_student_id;
END;
$function$;

COMMENT ON FUNCTION public.fn_sync_student_balance(uuid) IS
  'SSOT: ÚNICO mecanismo autorizado de escritura a students.balance. '
  'Fórmula: GREATEST(0, fn_calculate_student_prepay_net). Advisory lock por alumno. '
  'PROHIBIDO crear triggers paralelos de saldo (Regla SSOT Contable #10).';

-- ============================================================================
-- PARTE 3: fn_get_student_spendable_prepay
--   Helper para que el POS lea el prepago disponible sin tocar students.balance.
--   Fase 2: complete_pos_sale_v2 usará esta función en lugar de v_current_balance.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_student_spendable_prepay(
  p_student_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(0, public.fn_calculate_student_prepay_net(p_student_id));
$function$;

COMMENT ON FUNCTION public.fn_get_student_spendable_prepay(uuid) IS
  'Devuelve el prepago disponible real para autorización en el POS. '
  'Fase 2: reemplazará la lectura directa de students.balance en complete_pos_sale_v2.';

-- ============================================================================
-- PARTE 4: adjust_student_balance → CONVERTIDA A NO-OP
--
--   MOTIVO:
--     Con fn_sync_student_balance corregida, todos los callers existentes de
--     adjust_student_balance son seguros como NO-OP porque el trigger ya maneja
--     el recálculo correcto:
--       - void_pos_sale_with_nc: cancela TX → trigger recalcula → adjust llama NO-OP ✓
--       - process_payment_collection: marca TX paid → trigger recalcula → adjust NO-OP ✓
--       - VoucherApproval.tsx: inserta TX recharge → trigger recalcula → adjust NO-OP ✓
--
--   Se preserva la firma exacta para compatibilidad binaria con RPCs existentes.
--   Se preserva la validación de NULL para no romper callers que pasan null.
--   NO se hace REVOKE todavía; eso es Fase 3 tras actualizar el frontend.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adjust_student_balance(
  p_student_id uuid,
  p_amount     numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_current_balance numeric;
BEGIN
  -- DEPRECADA: esta función YA NO MODIFICA students.balance.
  -- El único mecanismo autorizado es fn_sync_student_balance (via trigger).
  -- Se conserva la firma para compatibilidad con RPCs pendientes de actualización.

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'adjust_student_balance: student_id no puede ser NULL';
  END IF;

  SELECT COALESCE(balance, 0)
    INTO v_current_balance
  FROM public.students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjust_student_balance: Student % not found', p_student_id;
  END IF;

  RETURN v_current_balance;
END;
$function$;

COMMENT ON FUNCTION public.adjust_student_balance(uuid, numeric) IS
  'DEPRECADA - NO-OP desde 2026-06-19. '
  'No modifica students.balance. Devuelve balance actual para compatibilidad. '
  'Fase 3: REVOKE tras actualizar VoucherApproval.tsx y offlineStorage.ts.';

-- ============================================================================
-- PARTE 5: GRANTS
-- ============================================================================

REVOKE ALL ON FUNCTION public.fn_calculate_student_prepay_net(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_calculate_student_prepay_net(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_calculate_student_prepay_net(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_student_spendable_prepay(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_student_spendable_prepay(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_student_spendable_prepay(uuid) TO service_role;

-- fn_sync_student_balance: sin cambio de permisos (mantiene permisos existentes)

-- ============================================================================
-- PARTE 6: SANEAMIENTO MASIVO
--   Re-calcula students.balance para TODOS los alumnos activos usando la
--   nueva fórmula (fn_sync_student_balance → GREATEST(0, prepay_net)).
--   Alumnos sin recargas reales quedarán con balance = 0.
--   Alumnos con recargas reales quedarán con el saldo restante real.
-- ============================================================================

DO $$
DECLARE
  r                    RECORD;
  v_total_activos      integer := 0;
  v_phantoms_antes     integer := 0;
  v_phantoms_despues   integer := 0;
BEGIN
  -- Contar fantasmas ANTES para el log
  SELECT COUNT(*)
    INTO v_phantoms_antes
  FROM public.students s
  WHERE s.is_active = true
    AND COALESCE(s.balance, 0) > GREATEST(0, public.fn_calculate_student_prepay_net(s.id)) + 0.01;

  RAISE NOTICE 'SANEAMIENTO SSOT: Alumnos activos con saldo > prepago_neto_real (fantasmas): %', v_phantoms_antes;

  -- Recalcular todos los alumnos activos
  FOR r IN
    SELECT id FROM public.students WHERE is_active = true
  LOOP
    PERFORM public.fn_sync_student_balance(r.id);
    v_total_activos := v_total_activos + 1;
  END LOOP;

  -- Contar fantasmas DESPUÉS
  SELECT COUNT(*)
    INTO v_phantoms_despues
  FROM public.students s
  WHERE s.is_active = true
    AND COALESCE(s.balance, 0) > GREATEST(0, public.fn_calculate_student_prepay_net(s.id)) + 0.01;

  RAISE NOTICE 'SANEAMIENTO SSOT: Completado. Alumnos recalculados: %. Fantasmas eliminados: %. Restantes: %',
    v_total_activos,
    v_phantoms_antes - v_phantoms_despues,
    v_phantoms_despues;
END;
$$;

-- ============================================================================
-- PARTE 7: ASSERT FINAL
--   Verifica que TODOS los alumnos activos tengan
--     students.balance = GREATEST(0, fn_calculate_student_prepay_net(id))
--   con tolerancia de 1 centavo (redondeo numérico).
--   Si hay alguna divergencia, la migración falla y revierte.
-- ============================================================================

DO $$
DECLARE
  v_mismatch_count integer;
  v_sample         RECORD;
BEGIN
  SELECT COUNT(*)
    INTO v_mismatch_count
  FROM public.students s
  WHERE s.is_active = true
    AND ABS(
          COALESCE(s.balance, 0)
          - GREATEST(0, public.fn_calculate_student_prepay_net(s.id))
        ) > 0.01;

  IF v_mismatch_count > 0 THEN
    -- Extraer un ejemplo para el mensaje de error
    SELECT
      s.full_name,
      ROUND(COALESCE(s.balance, 0), 2)                                   AS balance_actual,
      ROUND(GREATEST(0, public.fn_calculate_student_prepay_net(s.id)), 2) AS balance_esperado
    INTO v_sample
    FROM public.students s
    WHERE s.is_active = true
      AND ABS(
            COALESCE(s.balance, 0)
            - GREATEST(0, public.fn_calculate_student_prepay_net(s.id))
          ) > 0.01
    LIMIT 1;

    RAISE EXCEPTION
      'ASSERT_FAILED: % alumno(s) activo(s) con balance divergente. '
      'Ejemplo → "%": balance=% esperado=%. '
      'Revisar: ¿existe otro trigger que escriba students.balance?',
      v_mismatch_count,
      v_sample.full_name,
      v_sample.balance_actual,
      v_sample.balance_esperado;
  END IF;

  RAISE NOTICE 'ASSERT_OK: 0 divergencias. Todos los alumnos activos tienen balance = GREATEST(0, prepay_net). Migración limpia.';
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN MANUAL (ejecutar por separado después del COMMIT para confirmar)
-- ============================================================================
--
-- SELECT
--   s.full_name,
--   ROUND(s.balance, 2)                                          AS balance_nuevo,
--   ROUND(fn_calculate_student_prepay_net(s.id), 2)             AS prepay_neto,
--   ROUND(s.balance - GREATEST(0, fn_calculate_student_prepay_net(s.id)), 2) AS delta
-- FROM students s
-- WHERE s.is_active = true
-- ORDER BY s.full_name;
--
-- ============================================================================
