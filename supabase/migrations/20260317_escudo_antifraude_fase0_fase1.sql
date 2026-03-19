-- ============================================================
-- ESCUDO ANTIFRAUDE — FASE 0 + FASE 1
-- Fecha: 2026-03-17
-- Ejecutar en: Supabase SQL Editor
-- ============================================================
-- CONTENIDO:
--   [FASE 0-A] RLS de recharge_requests: reemplazar política abierta
--   [FASE 0-B] REVOKE set_student_balance para rol authenticated
--   [FASE 1-A] Índice único reference_code (ya existe — incluido por
--              seguridad con IF NOT EXISTS)
--   [FASE 1-B] Trigger: bloquear aprobación sin voucher_url
-- ============================================================


-- ============================================================
-- FASE 0-A: RLS de recharge_requests
-- Antes: FOR ALL USING (true) → cualquiera ve y modifica todo
-- Ahora: políticas separadas por operación y por rol
-- ============================================================

-- Eliminar la política abierta
DROP POLICY IF EXISTS "recharge_requests_all" ON recharge_requests;

-- ────────────────────────────────────────────────────────────
-- SELECT: quién puede VER los registros
-- ────────────────────────────────────────────────────────────

-- Los padres solo ven sus propios vouchers
CREATE POLICY "rr_select_parent"
ON recharge_requests
FOR SELECT
TO authenticated
USING (
  parent_id = auth.uid()
);

-- Los admins de sede ven solo los de su sede
-- (gestor_unidad, cajero, operador_caja, supervisor_red)
CREATE POLICY "rr_select_admin_sede"
ON recharge_requests
FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid()
    AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red','admin_sede')
  )
);

-- admin_general y superadmin ven todo
CREATE POLICY "rr_select_superadmin"
ON recharge_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general','superadmin')
  )
);

-- ────────────────────────────────────────────────────────────
-- INSERT: solo los padres pueden crear solicitudes nuevas
-- (los admins no crean recharge_requests, las aprueban)
-- ────────────────────────────────────────────────────────────

CREATE POLICY "rr_insert_parent_only"
ON recharge_requests
FOR INSERT
TO authenticated
WITH CHECK (
  -- El padre solo puede crear solicitudes a nombre propio
  parent_id = auth.uid()
  AND
  -- El alumno debe pertenecerle al padre
  student_id IN (
    SELECT id FROM students
    WHERE parent_id = auth.uid()
  )
  -- El status inicial siempre debe ser 'pending' (nunca aprobado directo)
  AND status = 'pending'
);

-- ────────────────────────────────────────────────────────────
-- UPDATE: solo admins pueden aprobar/rechazar
-- El padre NO puede modificar su propio voucher una vez enviado
-- Un estado 'approved' o 'rejected' NO puede volver a 'pending'
-- ────────────────────────────────────────────────────────────

CREATE POLICY "rr_update_admin_only"
ON recharge_requests
FOR UPDATE
TO authenticated
USING (
  -- Solo admins de la sede o superadmins pueden hacer UPDATE
  (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red','admin_sede','admin_general','superadmin')
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general','superadmin')
  )
)
WITH CHECK (
  -- Verificar que el admin tiene el rol correcto (sin recurrir a la misma tabla)
  (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red','admin_sede','admin_general','superadmin')
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general','superadmin')
  )
);

-- ────────────────────────────────────────────────────────────
-- DELETE: nadie puede borrar registros de vouchers desde el cliente
-- Los vouchers son permanentes (soft delete via status='rejected')
-- ────────────────────────────────────────────────────────────

-- No se crea política de DELETE → acceso denegado por default en RLS

-- Verificación de las políticas creadas
SELECT 
  policyname, 
  cmd, 
  roles
FROM pg_policies
WHERE tablename = 'recharge_requests'
ORDER BY cmd;


-- ============================================================
-- FASE 0-B: REVOCAR set_student_balance para rol authenticated
-- Esta función permite setear saldo absoluto arbitrario.
-- Solo debe ejecutarse desde el backend (service_role).
-- ============================================================

-- Revocar ejecución desde el cliente autenticado
REVOKE EXECUTE ON FUNCTION set_student_balance(UUID, NUMERIC, BOOLEAN) 
FROM authenticated;

REVOKE EXECUTE ON FUNCTION set_student_balance(UUID, NUMERIC, BOOLEAN) 
FROM anon;

-- Nota: adjust_student_balance (el RPC seguro) conserva su acceso normal.
-- Solo bloqueamos el que permite valores absolutos arbitrarios.

SELECT 'FASE 0-B: REVOKE set_student_balance aplicado' AS resultado;


-- ============================================================
-- FASE 1-A: Índice único en reference_code
-- Ya fue creado el 2026-03-11. Se incluye con IF NOT EXISTS
-- para que el script sea idempotente (no falla si ya existe).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_recharge_unique_ref_code
ON recharge_requests(reference_code)
WHERE status != 'rejected'
  AND reference_code IS NOT NULL
  AND reference_code != '';

SELECT 'FASE 1-A: idx_recharge_unique_ref_code verificado' AS resultado;


-- ============================================================
-- FASE 1-B: Trigger — bloquear aprobación sin voucher_url
-- Si alguien intenta poner status='approved' y no hay foto
-- de comprobante, la BD rechaza la operación.
-- Esto cierra el "Yapeo Paralelo" a nivel de base de datos.
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

  END IF;

  -- Regla 5: Un voucher ya aprobado/rechazado NO puede volver a 'pending'
  IF OLD.status IN ('approved', 'rejected') AND NEW.status = 'pending' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Un voucher ya procesado no puede volver al estado pendiente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Regla 6: Un voucher aprobado NO puede cambiar a aprobado de nuevo
  -- (doble aprobación — aunque el guard del frontend ya lo previene)
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION
      'ANTIFRAUDE: Este voucher ya fue aprobado. No se puede aprobar dos veces.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Eliminar el trigger si ya existía (para poder recrearlo limpio)
DROP TRIGGER IF EXISTS trg_guard_voucher_approval ON recharge_requests;

CREATE TRIGGER trg_guard_voucher_approval
BEFORE UPDATE ON recharge_requests
FOR EACH ROW
EXECUTE FUNCTION fn_guard_voucher_approval();

SELECT 'FASE 1-B: trg_guard_voucher_approval creado correctamente' AS resultado;


-- ============================================================
-- VERIFICACIÓN FINAL — Resumen de lo aplicado
-- ============================================================

SELECT
  '✅ FASE 0-A' AS fase,
  'RLS de recharge_requests reescrita con 5 políticas granulares' AS descripcion
UNION ALL
SELECT
  '✅ FASE 0-B',
  'REVOKE set_student_balance para authenticated y anon'
UNION ALL
SELECT
  '✅ FASE 1-A',
  'idx_recharge_unique_ref_code verificado (ya existía desde 2026-03-11)'
UNION ALL
SELECT
  '✅ FASE 1-B',
  'Trigger trg_guard_voucher_approval: bloquea aprobación sin foto, sin código, sin admin válido';
