-- ============================================================
-- FIX: fn_guard_voucher_approval — Respetar Kill Switch IA
-- Fecha: 2026-04-06
--
-- PROBLEMA: La Regla 7 bloqueaba aprobaciones de pagos electrónicos
-- (Yape, Plin, etc.) exigiendo un registro de IA en auditoria_vouchers,
-- incluso cuando el Motor IA está DESACTIVADO globalmente
-- (billing_config.disable_voucher_ai = TRUE).
--
-- SOLUCIÓN: Antes de ejecutar la Regla 7, consultar
-- billing_config.disable_voucher_ai para la sede del voucher.
-- Si está TRUE (Modo Manual), se permite la aprobación directa
-- sin necesidad de revisión IA.
--
-- SEGURIDAD: Las Reglas 1-4 (foto, N° operación, quién aprueba,
-- rol válido) se mantienen activas SIEMPRE, sin importar el modo.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_voucher_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ia_disabled BOOLEAN;
BEGIN
  -- Solo aplica cuando el estado cambia a 'approved'
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
      SELECT 1 FROM profiles
      WHERE id = NEW.approved_by
      AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red',
                   'admin_sede','admin_general','superadmin')
    ) THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: El usuario que aprueba no tiene rol de administrador válido.'
        USING ERRCODE = 'P0001';
    END IF;

    -- ── REGLA 7 ─────────────────────────────────────────────────────────
    -- Para pagos electrónicos (yape, plin, etc.) DEBE existir un registro
    -- en auditoria_vouchers con estado_ia = VALIDO o SOSPECHOSO.
    --
    -- EXCEPCIÓN: Si billing_config.disable_voucher_ai = TRUE para esta sede,
    -- el sistema está en Modo Manual — se omite la validación IA y se
    -- permite la aprobación directa del administrador.
    --
    -- BÚSQUEDA EN DOS NIVELES:
    --   1. Por id_cobranza = NEW.id  (link directo)
    --   2. Por nro_operacion = NEW.reference_code  (fallback)
    IF NEW.request_type IN ('recharge', 'lunch_payment', 'debt_payment')
       AND LOWER(COALESCE(NEW.payment_method, '')) IN (
             'transferencia','yape','plin','lukita','bim','tunki','deposito','banktransfer'
           )
    THEN
      -- Consultar si la IA está desactivada para esta sede
      SELECT COALESCE(bc.disable_voucher_ai, TRUE)
      INTO v_ia_disabled
      FROM billing_config bc
      WHERE bc.school_id = NEW.school_id
      LIMIT 1;

      -- Si no hay fila en billing_config para esta sede, tratar como desactivada
      -- (configuración segura: nunca bloquear por falta de configuración)
      IF v_ia_disabled IS NULL THEN
        v_ia_disabled := TRUE;
      END IF;

      -- Solo bloquear si la IA está ACTIVA (disable_voucher_ai = FALSE)
      IF NOT v_ia_disabled THEN
        IF NOT EXISTS (
          SELECT 1
          FROM auditoria_vouchers av
          WHERE (
            av.id_cobranza = NEW.id
            OR (
              NEW.reference_code IS NOT NULL
              AND TRIM(NEW.reference_code) != ''
              AND av.nro_operacion = TRIM(NEW.reference_code)
            )
          )
          AND av.estado_ia IN ('VALIDO', 'SOSPECHOSO')
        ) THEN
          INSERT INTO huella_digital_logs (
            usuario_id, accion, modulo, detalles_tecnicos, contexto, school_id, creado_at
          ) VALUES (
            NEW.approved_by,
            'INTENTO_BYPASS_SIN_AUDITORIA_IA',
            'RECHARGE_REQUESTS',
            '{"origen": "trigger_bd", "alerta": "Aprobacion sin revision IA valida (IA activa)"}'::jsonb,
            jsonb_build_object(
              'recharge_request_id', NEW.id,
              'payment_method', NEW.payment_method,
              'reference_code', NEW.reference_code,
              'amount', NEW.amount,
              'approved_by', NEW.approved_by
            ),
            NEW.school_id,
            NOW()
          );

          RAISE EXCEPTION
            'ANTIFRAUDE NIVEL 5: Este pago electrónico (%) no tiene revisión de IA en auditoria_vouchers. Aprobación bloqueada a nivel de base de datos. Revisar módulo de Auditoría.',
            NEW.payment_method
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
    -- ── FIN REGLA 7 ─────────────────────────────────────────────────────

  END IF;

  -- Regla 5: Un voucher ya aprobado/rechazado NO puede volver a 'pending'
  IF OLD.status IN ('approved', 'rejected') AND NEW.status = 'pending' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Un voucher ya procesado no puede volver al estado pendiente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Regla 6: Un voucher aprobado NO puede cambiar a aprobado de nuevo
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Este voucher ya fue aprobado. No se puede aprobar dos veces.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- El trigger ya existe — solo necesitamos actualizar la función
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_voucher_approval'
  ) THEN
    CREATE TRIGGER trg_guard_voucher_approval
    BEFORE UPDATE ON recharge_requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_guard_voucher_approval();
    RAISE NOTICE 'Trigger creado: trg_guard_voucher_approval';
  ELSE
    RAISE NOTICE 'Trigger ya existía. Función actualizada con soporte Kill Switch IA.';
  END IF;
END
$$;

-- Confirmar que la función quedó con SECURITY DEFINER
SELECT
  proname AS funcion,
  prosecdef AS tiene_security_definer,
  'OK: Regla 7 ahora respeta billing_config.disable_voucher_ai' AS estado
FROM pg_proc
WHERE proname = 'fn_guard_voucher_approval';
