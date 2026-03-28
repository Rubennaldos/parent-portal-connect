-- ============================================================
-- FIX CRÍTICO: fn_guard_voucher_approval con SECURITY DEFINER
-- Fecha: 2026-03-28
--
-- PROBLEMA: La función del trigger corría con los permisos del
-- usuario que aprueba (gestor_unidad). Como auditoria_vouchers
-- tiene RLS que solo permite admin_general, el trigger no podía
-- leer los registros de auditoría aunque existieran — siempre
-- veía una tabla vacía y bloqueaba todo.
--
-- SOLUCIÓN: Agregar SECURITY DEFINER para que la función corra
-- con los permisos del dueño de la función (postgres), saltando
-- RLS y pudiendo leer auditoria_vouchers correctamente.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_voucher_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- <-- ESTA ES LA CLAVE: corre como postgres, no como gestor_unidad
SET search_path = public
AS $$
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
    -- Para pagos electrónicos DEBE existir un registro en auditoria_vouchers
    -- con estado_ia = VALIDO o SOSPECHOSO.
    -- Gracias a SECURITY DEFINER, ahora SÍ puede leer auditoria_vouchers
    -- sin importar el rol del usuario que aprueba.
    -- BÚSQUEDA EN DOS NIVELES:
    --   1. Por id_cobranza = NEW.id
    --   2. Por nro_operacion = NEW.reference_code (fallback)
    IF NEW.request_type IN ('recharge', 'lunch_payment', 'debt_payment')
       AND LOWER(COALESCE(NEW.payment_method, '')) IN (
             'transferencia','yape','plin','lukita','bim','tunki','deposito','banktransfer'
           )
    THEN
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
          '{"origen": "trigger_bd", "alerta": "Aprobacion sin revision IA valida"}'::jsonb,
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

-- Verificar que el trigger sigue activo
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_voucher_approval'
  ) THEN
    CREATE TRIGGER trg_guard_voucher_approval
    BEFORE UPDATE ON recharge_requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_guard_voucher_approval();
    RAISE NOTICE 'Trigger creado.';
  ELSE
    RAISE NOTICE 'Trigger ya existia, funcion actualizada con SECURITY DEFINER.';
  END IF;
END
$$;

-- Verificar que quedó con SECURITY DEFINER
SELECT
  proname AS funcion,
  prosecdef AS tiene_security_definer
FROM pg_proc
WHERE proname = 'fn_guard_voucher_approval';
