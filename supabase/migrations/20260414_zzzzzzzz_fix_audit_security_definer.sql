-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: fix_audit_security_definer
-- Fecha    : 2026-04-14
--
-- PROBLEMA RAÍZ:
--   El trigger trg_audit_recharge_requests llama a log_billing_audit_event().
--   Esa función hacía un INSERT en audit_billing_logs, pero la tabla tiene una
--   RLS policy (audit_billing_logs_no_insert con with_check = false) que bloquea
--   INSERTs a todos los usuarios. Como la función corría con los permisos del
--   usuario autenticado (padre), el INSERT de auditoría era bloqueado por RLS y
--   reventaba TODO el INSERT del recharge_request → banner rojo genérico.
--
-- SOLUCIÓN:
--   Declarar la función con SECURITY DEFINER (corre con permisos del owner de
--   la función, normalmente postgres/service_role, que sí puede insertar en
--   audit_billing_logs) y envolver el INSERT de auditoría en un bloque
--   EXCEPTION para que si falla la auditoría, NO bloquee el pago real.
--
-- IMPACTO:
--   - Los pagos de los padres ya no reciben el banner rojo genérico.
--   - La auditoría se sigue registrando correctamente.
--   - Si por alguna razón extrema la auditoría falla, se emite un WARNING
--     en los logs de Supabase pero el pago se guarda igual.
--
-- RIESGO:
--   - BAJO. Solo modifica la función de auditoría, no la lógica de negocio.
--   - REVERSIBLE: DROP FUNCTION + recrear sin SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_billing_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id  UUID;
  v_old_data   JSONB;
  v_new_data   JSONB;
  v_school_id  UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_old_data  := to_jsonb(OLD);
    v_new_data  := NULL;
    BEGIN v_school_id := OLD.school_id; EXCEPTION WHEN undefined_column THEN v_school_id := NULL; END;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := NEW.id;
    v_old_data  := NULL;
    v_new_data  := to_jsonb(NEW);
    BEGIN v_school_id := NEW.school_id; EXCEPTION WHEN undefined_column THEN v_school_id := NULL; END;
  ELSE
    v_record_id := NEW.id;
    v_old_data  := to_jsonb(OLD);
    v_new_data  := to_jsonb(NEW);
    BEGIN v_school_id := NEW.school_id; EXCEPTION WHEN undefined_column THEN v_school_id := NULL; END;
  END IF;

  -- Envuelto en EXCEPTION: si la auditoría falla, el pago real NO se bloquea.
  BEGIN
    INSERT INTO public.audit_billing_logs (
      table_name,
      record_id,
      action_type,
      old_data,
      new_data,
      changed_by_user_id,
      school_id
    ) VALUES (
      TG_TABLE_NAME,
      v_record_id,
      TG_OP,
      v_old_data,
      v_new_data,
      auth.uid(),
      v_school_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_billing_audit_event falló (no bloquea la operación): % — tabla: % op: %',
      SQLERRM, TG_TABLE_NAME, TG_OP;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

SELECT '✅ log_billing_audit_event actualizada con SECURITY DEFINER + EXCEPTION guard.' AS status;
