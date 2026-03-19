-- ============================================================
-- FASE 1 COMPLETA — Sellar la Base de Datos
-- Fecha: 2026-03-17
-- ============================================================
-- CONTENIDO:
--   [1] Limpiar el duplicado de Renzo Guardia
--   [2] CREATE UNIQUE INDEX en reference_code
--   [3] TRIGGER: bloquear aprobación sin voucher_url
-- ============================================================


-- ============================================================
-- PASO 1: Limpiar el duplicado histórico de Renzo Guardia
-- Renombrar el reference_code del voucher cuyos pedidos
-- quedaron cancelados, liberando el código para el legítimo.
-- ============================================================

-- Verificación previa: confirmar que el registro existe y
-- sigue en estado 'approved' antes de tocarlo
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM recharge_requests
    WHERE id = 'fab60ac1-8d3a-43e1-9552-e9a90d75766a'
    AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'PRECAUCIÓN: El registro fab60ac1 no existe o no está approved. Abortando.';
  END IF;
END $$;

-- Renombrar el reference_code del voucher con pedidos cancelados
UPDATE recharge_requests
SET
  reference_code  = '69579347-CANCELADO',
  rejection_reason = 'Voucher reemplazado automáticamente: los 20 lunch_orders asociados '
                     'quedaron con is_cancelled=true por un bug del sistema al momento '
                     'del pago original (28-Feb-2026). El padre volvió a crear los pedidos '
                     'y los pagó correctamente con el voucher f0ba3779. '
                     'Este registro se conserva como auditoría histórica.'
WHERE id = 'fab60ac1-8d3a-43e1-9552-e9a90d75766a'
  AND status = 'approved';

-- Confirmar el cambio
SELECT
  id,
  reference_code,
  status,
  rejection_reason,
  approved_at
FROM recharge_requests
WHERE id = 'fab60ac1-8d3a-43e1-9552-e9a90d75766a';

SELECT '✅ PASO 1: Duplicado de Renzo Guardia resuelto. reference_code liberado.' AS resultado;


-- ============================================================
-- PASO 2: Índice único en reference_code
-- Bloquea a nivel de BD que el mismo número de operación
-- se use para aprobar dos vouchers distintos.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_recharge_unique_ref_code
ON recharge_requests(reference_code)
WHERE status != 'rejected'
  AND reference_code IS NOT NULL
  AND TRIM(reference_code) != '';

SELECT '✅ PASO 2: idx_recharge_unique_ref_code aplicado.' AS resultado;


-- ============================================================
-- PASO 3: Trigger — bloquear aprobación sin voucher_url
-- Cierra el "Yapeo Paralelo" a nivel de base de datos.
-- Ningún cliente puede saltarse estas reglas.
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
        'ANTIFRAUDE: No se puede aprobar sin imagen de comprobante. voucher_url es obligatorio.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 2: Debe haber número de operación
    IF NEW.reference_code IS NULL OR TRIM(NEW.reference_code) = '' THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: No se puede aprobar sin número de operación. reference_code es obligatorio.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 3: Debe registrar quién aprobó
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: No se puede aprobar sin registrar el admin que aprueba. approved_by es obligatorio.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Regla 4: Quien aprueba debe tener rol de admin válido
    IF NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = NEW.approved_by
      AND role IN (
        'gestor_unidad','cajero','operador_caja',
        'supervisor_red','admin_sede',
        'admin_general','superadmin'
      )
    ) THEN
      RAISE EXCEPTION
        'ANTIFRAUDE: El usuario que aprueba no tiene rol de administrador válido.'
        USING ERRCODE = 'P0001';
    END IF;

  END IF;

  -- Regla 5: Un voucher ya procesado NO puede volver a 'pending'
  IF OLD.status IN ('approved', 'rejected') AND NEW.status = 'pending' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Un voucher ya procesado no puede volver al estado pendiente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Regla 6: Un voucher aprobado NO puede aprobarse de nuevo
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Este voucher ya fue aprobado. No se puede aprobar dos veces.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Crear el trigger (eliminar primero si ya existía)
DROP TRIGGER IF EXISTS trg_guard_voucher_approval ON recharge_requests;

CREATE TRIGGER trg_guard_voucher_approval
BEFORE UPDATE ON recharge_requests
FOR EACH ROW
EXECUTE FUNCTION fn_guard_voucher_approval();

SELECT '✅ PASO 3: trg_guard_voucher_approval activo.' AS resultado;


-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================

-- Confirmar que el índice existe
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'recharge_requests'
  AND indexname = 'idx_recharge_unique_ref_code';

-- Confirmar que el trigger existe
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'recharge_requests'
  AND trigger_name = 'trg_guard_voucher_approval';

-- Confirmar que ya no hay reference_code duplicados activos
SELECT
  reference_code,
  COUNT(*) AS veces
FROM recharge_requests
WHERE status != 'rejected'
  AND reference_code IS NOT NULL
  AND TRIM(reference_code) != ''
GROUP BY reference_code
HAVING COUNT(*) > 1;
-- Si esta consulta devuelve 0 filas → BD limpia ✅

SELECT '🛡️ FASE 1 COMPLETA: Base de datos sellada.' AS resultado_final;
