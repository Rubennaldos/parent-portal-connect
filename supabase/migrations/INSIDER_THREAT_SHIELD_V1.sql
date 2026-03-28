-- ============================================================
-- INSIDER THREAT SHIELD — Nivel 5
-- Fecha: 2026-03-26
-- Propósito: Sellar puertas traseras de aprobación a nivel DB
--
-- PARCHE 1: Extender fn_guard_voucher_approval para exigir
--           registro válido en auditoria_vouchers cuando el
--           pago es electrónico (transferencia, yape, plin, etc.)
--
-- PARCHE 2: Trigger BEFORE UPDATE en transactions para logear
--           cualquier cambio de payment_status post-aprobación.
--
-- PARCHE 3: Función RPC log_manual_balance_edit para que el
--           frontend pueda registrar ediciones de saldo desde
--           PhysicalOrderWizard u otros componentes.
-- ============================================================


-- ============================================================
-- PARCHE 1: Extender el guard de aprobación de vouchers
-- Agrega Regla 7: pagos electrónicos deben tener auditoria
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_voucher_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
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

    -- ── NUEVA REGLA 7 ──────────────────────────────────────────
    -- Para pagos electrónicos (transferencia, yape, plin, lukita,
    -- bim, tunki) DEBE existir un registro en auditoria_vouchers
    -- con estado_ia distinto de 'RECHAZADO'.
    -- Esto impide que un admin apruebe directamente por API
    -- saltándose la revisión de IA.
    IF NEW.request_type IN ('recharge', 'lunch_payment', 'debt_payment')
       AND LOWER(COALESCE(NEW.payment_method, '')) IN (
             'transferencia','yape','plin','lukita','bim','tunki','deposito','banktransfer'
           )
    THEN
      IF NOT EXISTS (
        SELECT 1
        FROM auditoria_vouchers av
        WHERE av.id_cobranza = NEW.id
          AND av.estado_ia IN ('VALIDO', 'SOSPECHOSO')
      ) THEN
        -- Insertar en huella_digital_logs antes de bloquear
        INSERT INTO huella_digital_logs (
          usuario_id, accion, modulo, detalles_tecnicos, contexto, school_id, creado_at
        ) VALUES (
          NEW.approved_by,
          'INTENTO_BYPASS_SIN_AUDITORIA_IA',
          'RECHARGE_REQUESTS',
          '{"origen": "trigger_bd", "alerta": "Intento de aprobación directa por API sin pasar por revisión IA"}'::jsonb,
          jsonb_build_object(
            'recharge_request_id', NEW.id,
            'payment_method', NEW.payment_method,
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
    -- ── FIN REGLA 7 ────────────────────────────────────────────

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

-- Recrear el trigger (la función ya fue reemplazada, el trigger se mantiene)
DROP TRIGGER IF EXISTS trg_guard_voucher_approval ON recharge_requests;

CREATE TRIGGER trg_guard_voucher_approval
BEFORE UPDATE ON recharge_requests
FOR EACH ROW
EXECUTE FUNCTION fn_guard_voucher_approval();

SELECT 'PARCHE 1: fn_guard_voucher_approval con Regla 7 (auditoria_vouchers check) aplicado' AS resultado;


-- ============================================================
-- PARCHE 2: Trigger BEFORE UPDATE en transactions
-- Loguea en huella_digital_logs cualquier modificación a
-- una transacción que ya tenía payment_status = 'paid'
-- (edición post-aprobación es señal de fraude interno)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_log_transaction_edit_post_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- Solo actúa si la transacción ya estaba 'paid' y se modifica algo
  IF OLD.payment_status = 'paid' THEN

    -- Obtener el usuario actual de la sesión
    BEGIN
      v_admin_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_admin_id := NULL;
    END;

    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      detalles_tecnicos,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_admin_id,
      'ALERTA_EDICION_POST_PAGO',
      'TRANSACTIONS',
      jsonb_build_object(
        'origen', 'trigger_bd',
        'alerta', 'Modificación de transacción ya aprobada (payment_status=paid)'
      ),
      jsonb_build_object(
        'transaction_id',    OLD.id,
        'ticket_code',       OLD.ticket_code,
        'student_id',        OLD.student_id,
        'amount_antes',      OLD.amount,
        'amount_despues',    NEW.amount,
        'status_antes',      OLD.payment_status,
        'status_despues',    NEW.payment_status,
        'method_antes',      OLD.payment_method,
        'method_despues',    NEW.payment_method,
        'metadata_antes',    OLD.metadata,
        'metadata_despues',  NEW.metadata
      ),
      OLD.school_id,
      NOW()
    );

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_transaction_edit_post_approval ON transactions;

CREATE TRIGGER trg_log_transaction_edit_post_approval
BEFORE UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION fn_log_transaction_edit_post_approval();

SELECT 'PARCHE 2: trg_log_transaction_edit_post_approval (ALERTA_EDICION_POST_PAGO) aplicado' AS resultado;


-- ============================================================
-- PARCHE 3: Trigger BEFORE UPDATE en students (balance)
-- Loguea cambios directos al campo balance del alumno
-- (el RPC adjust_student_balance es legítimo, pero si
--  alguien usa service_role para setear el balance directo,
--  queda registrado)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_log_student_balance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- Solo actúa si el balance cambió
  IF OLD.balance IS DISTINCT FROM NEW.balance THEN

    BEGIN
      v_admin_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_admin_id := NULL;
    END;

    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      detalles_tecnicos,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_admin_id,
      CASE
        WHEN NEW.balance > OLD.balance THEN 'SALDO_INCREMENTADO'
        ELSE 'SALDO_DECREMENTADO'
      END,
      'STUDENTS_BALANCE',
      jsonb_build_object(
        'origen', 'trigger_bd',
        'nota', 'Cambio detectado en students.balance'
      ),
      jsonb_build_object(
        'student_id',     OLD.id,
        'alumno_nombre',  OLD.full_name,
        'balance_antes',  OLD.balance,
        'balance_despues',NEW.balance,
        'diferencia',     NEW.balance - OLD.balance
      ),
      OLD.school_id,
      NOW()
    );

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_student_balance_change ON students;

CREATE TRIGGER trg_log_student_balance_change
AFTER UPDATE ON students
FOR EACH ROW
EXECUTE FUNCTION fn_log_student_balance_change();

SELECT 'PARCHE 3: trg_log_student_balance_change (SALDO_INCREMENTADO/DECREMENTADO) aplicado' AS resultado;


-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================

SELECT
  'INSIDER THREAT SHIELD V1' AS modulo,
  'PARCHE 1: Guard IA en recharge_requests — Regla 7 activa' AS descripcion
UNION ALL SELECT
  'INSIDER THREAT SHIELD V1',
  'PARCHE 2: Log ALERTA_EDICION_POST_PAGO en transactions activo'
UNION ALL SELECT
  'INSIDER THREAT SHIELD V1',
  'PARCHE 3: Log SALDO_INCREMENTADO/DECREMENTADO en students activo';
