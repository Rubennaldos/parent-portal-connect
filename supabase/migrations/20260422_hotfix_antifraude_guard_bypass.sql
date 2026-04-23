-- ============================================================================
-- HOTFIX: fn_guard_voucher_approval — solo actuar cuando el status CAMBIA
--         tg_enforce_spending_limit — bypass controlado para aprobaciones admin
--
-- RAÍZ DEL BUG ANTIFRAUDE:
--   VoucherApproval.tsx línea 890-897 hace un UPDATE directo a recharge_requests
--   para guardar reference_code ANTES de llamar al RPC de aprobación.
--   Si el request ya está 'approved' en la BD (dato stale en UI), el trigger
--   fn_guard_voucher_approval detecta OLD.status = 'approved' AND NEW.status = 'approved'
--   y lanza "ANTIFRAUDE: Este voucher ya fue aprobado" aunque nadie intentó re-aprobar.
--
-- SOLUCIÓN SQL:
--   1) fn_guard_voucher_approval: si el status NO cambia, retornar NEW inmediatamente.
--      El trigger solo debe intervenir en transiciones de estado, no en actualizaciones
--      de campos informativos (reference_code, notes, voucher_url, etc.).
--   2) tg_enforce_spending_limit: bypass session-variable para que las aprobaciones
--      administrativas no sean bloqueadas por el control de kiosco POS.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: fn_guard_voucher_approval — solo disparar cuando status cambia
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_voucher_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── GUARDIA CERO: Si el status no cambia, no hay nada que validar. ─────────
  -- Permite actualizar reference_code, notes, voucher_url, etc. en cualquier
  -- estado sin disparar las reglas del flujo de aprobación.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- ── Solo aplica cuando el estado cambia a 'approved' ─────────────────────
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN

    -- Regla 1: Debe haber foto del comprobante
    IF NEW.voucher_url IS NULL OR TRIM(NEW.voucher_url) = '' THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: No se puede aprobar un voucher sin imagen de comprobante. voucher_url es obligatorio.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 2: Debe haber número de operación
    IF NEW.reference_code IS NULL OR TRIM(NEW.reference_code) = '' THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: No se puede aprobar sin número de operación. reference_code es obligatorio.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 3: Debe registrar quién aprobó y cuándo
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: No se puede aprobar sin registrar el admin que aprueba. approved_by es obligatorio.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 4: La aprobación solo puede venir de un admin reconocido
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = NEW.approved_by
        AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red',
                     'admin_sede','admin_general','superadmin')
    ) THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: El usuario que aprueba no tiene rol de administrador válido.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 7: Solo bloquear si la IA RECHAZÓ explícitamente el voucher.
    -- Sin registro en auditoria_vouchers = Modo Manual activo → permitir.
    -- Con estado_ia = 'RECHAZADO' → bloquear sin excepción.
    -- Eliminada la dependencia de school_settings (tabla inexistente).
    IF NEW.request_type IN ('recharge', 'lunch_payment', 'debt_payment')
       AND LOWER(COALESCE(NEW.payment_method, '')) IN (
             'transferencia','yape','plin','lukita','bim','tunki','deposito','banktransfer'
           )
    THEN
      IF EXISTS (
        SELECT 1
        FROM   public.auditoria_vouchers av
        WHERE  av.id_cobranza = NEW.id
          AND  av.estado_ia   = 'RECHAZADO'
      ) THEN
        INSERT INTO public.huella_digital_logs (
          usuario_id, accion, modulo, detalles_tecnicos, contexto, school_id, creado_at
        ) VALUES (
          NEW.approved_by,
          'INTENTO_APROBAR_VOUCHER_RECHAZADO_POR_IA',
          'RECHARGE_REQUESTS',
          '{"origen": "trigger_bd", "alerta": "La IA rechazó este voucher. No puede aprobarse."}'::jsonb,
          jsonb_build_object(
            'recharge_request_id', NEW.id,
            'payment_method',     NEW.payment_method,
            'amount',             NEW.amount,
            'approved_by',        NEW.approved_by
          ),
          NEW.school_id,
          NOW()
        );
        RAISE EXCEPTION
          'ANTIFRAUDE: El Auditor IA rechazó este voucher (%). No puede aprobarse sin nueva revisión.',
          NEW.payment_method
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

  END IF;

  -- Regla 5: Un voucher ya aprobado/rechazado NO puede volver a 'pending'
  IF OLD.status IN ('approved', 'rejected') AND NEW.status = 'pending' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Un voucher ya procesado no puede volver al estado pendiente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Regla 6: Un voucher aprobado NO puede cambiar a aprobado de nuevo
  -- (solo aplica si REALMENTE hay un cambio de estado, que la guardia cero
  --  ya garantiza: llegamos aquí únicamente si NEW.status != OLD.status)
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Este voucher ya fue aprobado. No se puede aprobar dos veces.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Recrear trigger (la función ya fue reemplazada)
DROP TRIGGER IF EXISTS trg_guard_voucher_approval ON public.recharge_requests;
CREATE TRIGGER trg_guard_voucher_approval
BEFORE UPDATE ON public.recharge_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_voucher_approval();

COMMENT ON FUNCTION public.fn_guard_voucher_approval() IS
  'v2 hotfix 2026-04-22: Guardia anti-fraude en aprobación de vouchers. '
  'Solo actúa cuando el campo status cambia (NEW.status != OLD.status). '
  'Permite actualizaciones de campos informativos (reference_code, notes, etc.) '
  'sin disparar las reglas del flujo. '
  'Reglas activas: (1) voucher_url, (2) reference_code, (3) approved_by, '
  '(4) rol admin, (5) no revertir a pending, (6) no doble aprobación, '
  '(7) pago electrónico requiere auditoria_vouchers (bypasable con IA desactivada).';

SELECT 'FIX 1: fn_guard_voucher_approval v2 aplicado — solo actúa en cambios de status' AS resultado;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: tg_enforce_spending_limit — bypass controlado para aprobaciones admin
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student       record;
  v_school        record;
  v_weekly_spent  numeric;
  v_week_start    date;
BEGIN
  -- Bypass: las aprobaciones administrativas de voucher (process_traditional_voucher_approval,
  -- approve_split_payment_voucher) activan este flag al inicio de su transacción.
  IF current_setting('app.bypass_spending_limit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Solo aplica a compras POS (kiosco)
  IF NEW.type <> 'purchase' THEN
    RETURN NEW;
  END IF;

  -- Solo aplica a transacciones nuevas con estado 'paid' o 'pending'
  IF NEW.payment_status NOT IN ('paid', 'pending') THEN
    RETURN NEW;
  END IF;

  -- Obtener datos del alumno
  SELECT s.kiosk_disabled, s.weekly_spending_limit, s.school_id
  INTO   v_student
  FROM   public.students s
  WHERE  s.id = NEW.student_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Bloqueo 1: kiosco desactivado
  IF v_student.kiosk_disabled = true THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: El acceso al kiosco está desactivado para este alumno.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueo 2: límite semanal de gastos
  IF v_student.weekly_spending_limit IS NOT NULL AND v_student.weekly_spending_limit > 0 THEN
    v_week_start := date_trunc('week', CURRENT_DATE)::date;

    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_weekly_spent
    FROM   public.transactions t
    WHERE  t.student_id      = NEW.student_id
      AND  t.type            = 'purchase'
      AND  t.is_deleted      = false
      AND  t.payment_status  = 'paid'
      AND  t.created_at     >= v_week_start;

    IF (v_weekly_spent + ABS(NEW.amount)) > v_student.weekly_spending_limit THEN
      RAISE EXCEPTION
        'WEEKLY_LIMIT_EXCEEDED: El alumno superaría su límite semanal de S/ % (acumulado S/ %, nuevo S/ %).',
        v_student.weekly_spending_limit,
        v_weekly_spent,
        ABS(NEW.amount)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_enforce_spending_limit() IS
  'v2 hotfix 2026-04-22: Control de acceso al kiosco POS (kiosk_disabled + weekly_limit). '
  'Bypass controlado vía set_config(''app.bypass_spending_limit'', ''on'') '
  'para aprobaciones administrativas de voucher que crean/actualizan transacciones.';

SELECT 'FIX 2: tg_enforce_spending_limit v2 aplicado — bypass admin activado' AS resultado;


-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO: Ver estado actual de los vouchers atascados
-- (Ejecutar después del fix para confirmar el estado en la BD)
-- ─────────────────────────────────────────────────────────────────────────────
/*
SELECT
  rr.id,
  rr.status,
  rr.request_type,
  rr.payment_method,
  rr.amount,
  rr.reference_code,
  rr.approved_by,
  rr.approved_at,
  p.full_name   AS student_name,
  rr.created_at,
  (
    SELECT COUNT(*)
    FROM   public.transactions t
    WHERE  t.is_deleted     = false
      AND  t.payment_status = 'paid'
      AND  ((t.metadata->>'recharge_request_id') = rr.id::text
            OR (COALESCE(cardinality(rr.paid_transaction_ids), 0) > 0
                AND t.id = ANY(rr.paid_transaction_ids)))
  ) AS paid_tx_count,
  EXISTS (
    SELECT 1 FROM public.auditoria_vouchers av
    WHERE av.id_cobranza = rr.id
      AND av.estado_ia IN ('VALIDO', 'SOSPECHOSO', 'MANUAL_OVERRIDE')
  ) AS tiene_auditoria_ia
FROM   public.recharge_requests rr
JOIN   public.students s  ON s.id = rr.student_id
JOIN   public.profiles  p ON p.id = s.parent_id
WHERE  rr.status IN ('pending', 'approved')
  AND  rr.created_at >= NOW() - INTERVAL '48 hours'
ORDER  BY rr.created_at DESC
LIMIT  20;
*/
