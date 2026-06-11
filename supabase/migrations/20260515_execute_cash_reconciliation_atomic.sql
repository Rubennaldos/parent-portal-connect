-- =====================================================================
-- execute_cash_reconciliation_atomic
--
-- Reemplaza las 3 escrituras secuenciales del frontend (huella + upsert
-- reconciliation + update session) por UNA sola transacción en BD.
--
-- GARANTÍAS:
--   • SELECT FOR UPDATE en la sesión → candado pesimista, sin doble cierre
--   • Todo-o-nada: si falla cualquier paso → rollback automático completo
--   • Prefijos de error legibles por el frontend (SESSION_NOT_FOUND,
--     SESSION_ALREADY_CLOSED) para mensajes claros al usuario
--   • Solo columnas reales confirmadas en el esquema (no inventa campos)
--
-- COLUMNAS USADAS (verificadas contra migraciones existentes):
--   cash_sessions          → 20260313_cash_register_v2.sql
--                            + 20260324_cash_sessions_arqueo_ciego.sql
--   cash_reconciliations   → 20260313_cash_register_v2.sql
--   huella_digital_logs    → CREATE_AUDITORIA_MODULE.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION execute_cash_reconciliation_atomic(
  p_session_id          UUID,
  p_reconciliation_data JSONB,
  p_user_id             UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   cash_sessions%ROWTYPE;
  v_school_id UUID;
BEGIN

  -- ── 1. CANDADO PESIMISTA ────────────────────────────────────────────────
  -- SELECT FOR UPDATE bloquea la fila hasta que esta transacción termine.
  -- Si dos pestañas intentan cerrar al mismo tiempo, la segunda espera
  -- y al leer el estado 'closed' lanza el error controlado.
  SELECT * INTO v_session
  FROM cash_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de caja con id % no existe.', p_session_id;
  END IF;

  IF v_session.status = 'closed' THEN
    RAISE EXCEPTION 'SESSION_ALREADY_CLOSED: Esta caja ya fue cerrada. Actualiza la página para ver el estado actual.';
  END IF;

  v_school_id := v_session.school_id;

  -- ── 2. UPSERT DE ARQUEO (cash_reconciliations) ──────────────────────────
  -- ON CONFLICT actúa como idempotencia extra: si por algún fallo previo
  -- ya existía un registro parcial, lo sobreescribe con los datos correctos.
  INSERT INTO cash_reconciliations (
    cash_session_id,
    school_id,
    system_cash,
    system_yape,
    system_plin,
    system_transferencia,
    system_tarjeta,
    system_mixto,
    system_total,
    physical_cash,
    physical_yape,
    physical_plin,
    physical_transferencia,
    physical_tarjeta,
    physical_mixto,
    physical_total,
    variance_cash,
    variance_yape,
    variance_plin,
    variance_transferencia,
    variance_tarjeta,
    variance_mixto,
    variance_total,
    declared_overage,
    declared_deficit,
    reconciled_by
  )
  VALUES (
    p_session_id,
    v_school_id,
    COALESCE((p_reconciliation_data->>'system_cash')::numeric,          0),
    COALESCE((p_reconciliation_data->>'system_yape')::numeric,          0),
    0,  -- system_plin (no se captura por separado en este flujo)
    COALESCE((p_reconciliation_data->>'system_transferencia')::numeric, 0),
    COALESCE((p_reconciliation_data->>'system_tarjeta')::numeric,       0),
    0,  -- system_mixto
    COALESCE((p_reconciliation_data->>'system_total')::numeric,         0),
    COALESCE((p_reconciliation_data->>'physical_cash')::numeric,        0),
    0,  -- physical_yape (no se declara físicamente en este flujo)
    0,  -- physical_plin
    0,  -- physical_transferencia
    COALESCE((p_reconciliation_data->>'physical_tarjeta')::numeric,     0),
    0,  -- physical_mixto
    COALESCE((p_reconciliation_data->>'physical_total')::numeric,       0),
    COALESCE((p_reconciliation_data->>'variance_cash')::numeric,        0),
    0,  -- variance_yape
    0,  -- variance_plin
    0,  -- variance_transferencia
    COALESCE((p_reconciliation_data->>'variance_tarjeta')::numeric,     0),
    0,  -- variance_mixto
    COALESCE((p_reconciliation_data->>'variance_total')::numeric,       0),
    COALESCE((p_reconciliation_data->>'declared_overage')::numeric,     0),
    COALESCE((p_reconciliation_data->>'declared_deficit')::numeric,     0),
    p_user_id
  )
  ON CONFLICT (cash_session_id) DO UPDATE SET
    system_cash            = EXCLUDED.system_cash,
    system_yape            = EXCLUDED.system_yape,
    system_plin            = EXCLUDED.system_plin,
    system_transferencia   = EXCLUDED.system_transferencia,
    system_tarjeta         = EXCLUDED.system_tarjeta,
    system_mixto           = EXCLUDED.system_mixto,
    system_total           = EXCLUDED.system_total,
    physical_cash          = EXCLUDED.physical_cash,
    physical_yape          = EXCLUDED.physical_yape,
    physical_plin          = EXCLUDED.physical_plin,
    physical_transferencia = EXCLUDED.physical_transferencia,
    physical_tarjeta       = EXCLUDED.physical_tarjeta,
    physical_mixto         = EXCLUDED.physical_mixto,
    physical_total         = EXCLUDED.physical_total,
    variance_cash          = EXCLUDED.variance_cash,
    variance_yape          = EXCLUDED.variance_yape,
    variance_plin          = EXCLUDED.variance_plin,
    variance_transferencia = EXCLUDED.variance_transferencia,
    variance_tarjeta       = EXCLUDED.variance_tarjeta,
    variance_mixto         = EXCLUDED.variance_mixto,
    variance_total         = EXCLUDED.variance_total,
    declared_overage       = EXCLUDED.declared_overage,
    declared_deficit       = EXCLUDED.declared_deficit,
    reconciled_by          = EXCLUDED.reconciled_by;

  -- ── 3. CIERRE DE SESIÓN (cash_sessions) ─────────────────────────────────
  -- Usa las columnas añadidas por 20260324_cash_sessions_arqueo_ciego.sql:
  --   declared_cash, declared_tarjeta, system_cash, system_tarjeta,
  --   variance_cash, variance_tarjeta, variance_total, variance_justification
  UPDATE cash_sessions SET
    status                 = 'closed',
    closed_by              = p_user_id,
    closed_at              = clock_timestamp(),
    declared_cash          = COALESCE((p_reconciliation_data->>'physical_cash')::numeric,    0),
    declared_tarjeta       = COALESCE((p_reconciliation_data->>'physical_tarjeta')::numeric, 0),
    system_cash            = COALESCE((p_reconciliation_data->>'system_cash')::numeric,      0),
    system_tarjeta         = COALESCE((p_reconciliation_data->>'system_tarjeta')::numeric,   0),
    variance_cash          = COALESCE((p_reconciliation_data->>'variance_cash')::numeric,    0),
    variance_tarjeta       = COALESCE((p_reconciliation_data->>'variance_tarjeta')::numeric, 0),
    variance_total         = COALESCE((p_reconciliation_data->>'variance_total')::numeric,   0),
    variance_justification = NULLIF(TRIM(COALESCE(p_reconciliation_data->>'variance_justification', '')), ''),
    updated_at             = clock_timestamp()
  WHERE id = p_session_id;

  -- ── 4. AUDITORÍA EN huella_digital_logs ─────────────────────────────────
  -- Columnas confirmadas: usuario_id, accion, modulo, school_id,
  --                       contexto (JSONB), creado_at (auto)
  INSERT INTO huella_digital_logs (
    usuario_id,
    accion,
    modulo,
    school_id,
    contexto
  )
  VALUES (
    p_user_id,
    CASE
      WHEN COALESCE((p_reconciliation_data->>'is_admin')::boolean, false)
        THEN 'CIERRE_CAJA_ADMIN'
      ELSE 'CIERRE_CAJA_CAJERO'
    END,
    'CIERRE_CAJA',
    v_school_id,
    jsonb_build_object(
      'session_id',         p_session_id,
      'session_date',       v_session.session_date,
      'tipo_cierre',        CASE WHEN COALESCE((p_reconciliation_data->>'is_admin')::boolean, false)
                              THEN 'con_vision_sistema' ELSE 'ciegas' END,
      'sistema_efectivo',   COALESCE((p_reconciliation_data->>'system_cash')::numeric,      0),
      'sistema_tarjeta',    COALESCE((p_reconciliation_data->>'system_tarjeta')::numeric,   0),
      'declarado_efectivo', COALESCE((p_reconciliation_data->>'physical_cash')::numeric,    0),
      'declarado_tarjeta',  COALESCE((p_reconciliation_data->>'physical_tarjeta')::numeric, 0),
      'descuadre_total',    COALESCE((p_reconciliation_data->>'variance_total')::numeric,   0),
      'justificacion',      p_reconciliation_data->>'variance_justification'
    )
  );

  -- ── 5. RESPUESTA ────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',           true,
    'session_id',   p_session_id,
    'session_date', v_session.session_date,
    'closed_at',    clock_timestamp()
  );

END;
$$;

-- Permisos: solo usuarios autenticados pueden llamar a esta función
GRANT EXECUTE ON FUNCTION execute_cash_reconciliation_atomic(UUID, JSONB, UUID)
  TO authenticated;

-- Verificación rápida post-aplicación
SELECT 'execute_cash_reconciliation_atomic instalada correctamente' AS resultado;
