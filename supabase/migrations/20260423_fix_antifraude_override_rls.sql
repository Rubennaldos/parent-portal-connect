-- ============================================================================
-- FIX: fn_guard_voucher_approval — override superadmin/admin_general
--      + RLS admin_can_update_transactions cubre metadata
-- Fecha: 2026-04-23
--
-- PROBLEMA 1 — ANTIFRAUDE bloquea incluso a superadmin:
--   La Regla 7 del trigger lanza EXCEPTION para TODOS los roles cuando
--   auditoria_vouchers.estado_ia = 'RECHAZADO', incluyendo superadmin y
--   admin_general que deberían poder aprobar manualmente con auditoría.
--
-- PROBLEMA 2 — PATCH /rest/v1/transactions → 400:
--   handleReject() en VoucherApproval.tsx actualiza transactions.metadata
--   con {last_payment_rejected: true}. La política RLS admin_can_update_transactions
--   permite UPDATE en transactions pero las columnas cubiertas no incluían
--   metadata explícitamente. En Supabase el filtro de columnas en RLS
--   aplica solo al SELECT; pero la política podría estar usando USING/WITH CHECK
--   que restringe qué filas son actualizables. Recrea la política sin restricción
--   de columna para admins autenticados con rol válido.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: fn_guard_voucher_approval v3
--   Regla 7 modificada: si el aprobador es superadmin o admin_general,
--   registrar el override en huella_digital_logs y PERMITIR la aprobación.
--   Para cualquier otro rol, el bloqueo sigue activo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_voucher_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approver_role text;
BEGIN
  -- Guardia cero: si el status no cambia, no hay nada que validar.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

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
    SELECT role INTO v_approver_role
    FROM   public.profiles
    WHERE  id = NEW.approved_by
      AND  role IN ('gestor_unidad','cajero','operador_caja','supervisor_red',
                    'admin_sede','admin_general','superadmin');

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: El usuario que aprueba no tiene rol de administrador válido.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 7: Solo bloquear si la IA RECHAZÓ explícitamente el voucher.
    -- EXCEPCIÓN DELIBERADA: superadmin y admin_general pueden anular el
    -- rechazo IA con registro de auditoría obligatorio.
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

        -- Superadmin y admin_general pueden anular — registrar en huella y continuar
        IF v_approver_role IN ('superadmin', 'admin_general') THEN
          INSERT INTO public.huella_digital_logs (
            usuario_id, accion, modulo, detalles_tecnicos, contexto, school_id, creado_at
          ) VALUES (
            NEW.approved_by,
            'OVERRIDE_APROBACION_VOUCHER_RECHAZADO_IA',
            'RECHARGE_REQUESTS',
            jsonb_build_object(
              'origen',           'trigger_bd',
              'alerta',           'Superadmin/admin_general anuló el rechazo IA.',
              'rol_aprobador',    v_approver_role
            ),
            jsonb_build_object(
              'recharge_request_id', NEW.id,
              'payment_method',      NEW.payment_method,
              'amount',              NEW.amount,
              'approved_by',         NEW.approved_by
            ),
            NEW.school_id,
            NOW()
          );

          -- Marcar el registro en auditoria_vouchers como anulado
          UPDATE public.auditoria_vouchers
          SET    estado_ia   = 'ANULADO_POR_ADMIN',
                 analisis_ia = COALESCE(analisis_ia, '{}') || jsonb_build_object(
                   'override_by',     NEW.approved_by::text,
                   'override_at',     to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'override_role',   v_approver_role,
                   'estado_anterior', 'RECHAZADO'
                 )
          WHERE  id_cobranza = NEW.id
            AND  estado_ia   = 'RECHAZADO';

          -- Permitir la aprobación (no lanzar excepción)
          RETURN NEW;

        ELSE
          -- Roles menores: bloquear y registrar el intento
          INSERT INTO public.huella_digital_logs (
            usuario_id, accion, modulo, detalles_tecnicos, contexto, school_id, creado_at
          ) VALUES (
            NEW.approved_by,
            'INTENTO_APROBAR_VOUCHER_RECHAZADO_POR_IA',
            'RECHARGE_REQUESTS',
            '{"origen": "trigger_bd", "alerta": "La IA rechazó este voucher. No puede aprobarse."}'::jsonb,
            jsonb_build_object(
              'recharge_request_id', NEW.id,
              'payment_method',      NEW.payment_method,
              'amount',              NEW.amount,
              'approved_by',         NEW.approved_by
            ),
            NEW.school_id,
            NOW()
          );
          RAISE EXCEPTION
            'ANTIFRAUDE: El Auditor IA rechazó este voucher (%). No puede aprobarse sin nueva revisión. Contacta a un Superadmin para anular el rechazo.',
            NEW.payment_method
            USING ERRCODE = 'P0001';
        END IF;
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
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: Este voucher ya fue aprobado. No se puede aprobar dos veces.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_voucher_approval ON public.recharge_requests;
CREATE TRIGGER trg_guard_voucher_approval
BEFORE UPDATE ON public.recharge_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_voucher_approval();

COMMENT ON FUNCTION public.fn_guard_voucher_approval() IS
  'v3 2026-04-23 — Regla 7 modificada: superadmin/admin_general pueden anular rechazo IA '
  'con registro obligatorio en huella_digital_logs + update en auditoria_vouchers. '
  'Roles menores siguen bloqueados. Mensaje actualizado indica contactar superadmin.';

SELECT 'FIX 1 OK: fn_guard_voucher_approval v3 — override superadmin/admin_general habilitado' AS resultado;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: RLS para UPDATE de metadata en transactions por admins
-- ─────────────────────────────────────────────────────────────────────────────
-- Recrear la política sin restricción de columna para admins con rol válido.
-- Permite que handleReject() actualice transactions.metadata sin error 400.
DROP POLICY IF EXISTS admin_can_update_transactions ON public.transactions;

CREATE POLICY admin_can_update_transactions
ON public.transactions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE  p.id   = auth.uid()
      AND  p.role IN (
        'superadmin','admin_general','admin_sede',
        'gestor_unidad','cajero','operador_caja','supervisor_red'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE  p.id   = auth.uid()
      AND  p.role IN (
        'superadmin','admin_general','admin_sede',
        'gestor_unidad','cajero','operador_caja','supervisor_red'
      )
  )
);

SELECT 'FIX 2 OK: admin_can_update_transactions recreada — cubre metadata y cualquier campo' AS resultado;
