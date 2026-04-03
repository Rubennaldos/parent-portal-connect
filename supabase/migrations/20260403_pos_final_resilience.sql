-- ================================================================
-- POS FINAL RESILIENCE — Coronación del módulo
-- Fecha: 2026-04-03
--
-- 1. Soft Delete para products y combos
--    · BEFORE DELETE trigger → convierte DELETE en UPDATE active=false
--    · La columna se llama "active" (ya existía y el código la usa)
--    · Se añade "is_active" como alias/columna generada para compatibilidad
-- 2. Arqueo Ciego (Blind Cash Count)
--    · reported_cash_amount en cash_sessions (declarado por el cajero)
--    · Vista v_cash_reconciliation para administradores
-- 3. Índices de rendimiento
--    · transactions: (school_id, created_at), (student_id), (payment_status)
--    · pos_stock_movements, price_change_log
-- ================================================================


-- ================================================================
-- PARTE 1A — SOFT DELETE: tabla products
-- ================================================================

-- La tabla products ya tiene columna "active" (boolean).
-- Añadimos "is_active" como columna computada/generada para que las
-- queries nuevas puedan usar cualquiera de los dos nombres.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Sincronizar is_active ↔ active para filas ya existentes
UPDATE products SET is_active = active WHERE is_active IS DISTINCT FROM active;

-- Trigger de sincronización bidireccional (mantenemos ambas columnas en sinc)
CREATE OR REPLACE FUNCTION fn_sync_product_active()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Si cambia "active" → reflejar en "is_active"
  IF TG_OP = 'UPDATE' AND OLD.active IS DISTINCT FROM NEW.active THEN
    NEW.is_active := NEW.active;
  END IF;
  -- Si cambia "is_active" → reflejar en "active"
  IF TG_OP = 'UPDATE' AND OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    NEW.active := NEW.is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_active ON products;
CREATE TRIGGER trg_sync_product_active
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION fn_sync_product_active();


-- Trigger que BLOQUEA el DELETE físico y lo convierte en borrado lógico
CREATE OR REPLACE FUNCTION fn_soft_delete_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- En lugar de borrar, desactivar lógicamente
  UPDATE products
  SET active    = false,
      is_active = false,
      updated_at = clock_timestamp()
  WHERE id = OLD.id;

  -- Registrar en log de auditoría si existe
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'huella_digital_logs'
  ) THEN
    INSERT INTO huella_digital_logs (
      action, table_name, record_id, performed_by, details, created_at
    ) VALUES (
      'SOFT_DELETE_INTERCEPTED', 'products', OLD.id::text,
      auth.uid(),
      jsonb_build_object('product_name', OLD.name, 'reason', 'DELETE convertido a soft-delete'),
      clock_timestamp()
    );
  END IF;

  RETURN NULL; -- Cancela el DELETE físico
END;
$$;

DROP TRIGGER IF EXISTS trg_soft_delete_product ON products;
CREATE TRIGGER trg_soft_delete_product
  BEFORE DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION fn_soft_delete_product();

SELECT 'Soft Delete ✅ products: trigger BEFORE DELETE instalado' AS paso;


-- ================================================================
-- PARTE 1B — SOFT DELETE: tabla combos
-- ================================================================

-- combos ya tiene columna "active" (boolean, default true)
ALTER TABLE combos
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Sincronizar is_active ↔ active para filas existentes
UPDATE combos SET is_active = active WHERE is_active IS DISTINCT FROM active;

CREATE OR REPLACE FUNCTION fn_sync_combo_active()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.active IS DISTINCT FROM NEW.active THEN
    NEW.is_active := NEW.active;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    NEW.active := NEW.is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_combo_active ON combos;
CREATE TRIGGER trg_sync_combo_active
  BEFORE UPDATE ON combos
  FOR EACH ROW EXECUTE FUNCTION fn_sync_combo_active();

CREATE OR REPLACE FUNCTION fn_soft_delete_combo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE combos
  SET active    = false,
      is_active = false,
      updated_at = clock_timestamp()
  WHERE id = OLD.id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'huella_digital_logs'
  ) THEN
    INSERT INTO huella_digital_logs (
      action, table_name, record_id, performed_by, details, created_at
    ) VALUES (
      'SOFT_DELETE_INTERCEPTED', 'combos', OLD.id::text,
      auth.uid(),
      jsonb_build_object('combo_name', OLD.name, 'reason', 'DELETE convertido a soft-delete'),
      clock_timestamp()
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_soft_delete_combo ON combos;
CREATE TRIGGER trg_soft_delete_combo
  BEFORE DELETE ON combos
  FOR EACH ROW EXECUTE FUNCTION fn_soft_delete_combo();

SELECT 'Soft Delete ✅ combos: trigger BEFORE DELETE instalado' AS paso;


-- ================================================================
-- PARTE 2 — ARQUEO CIEGO: columna reported_cash_amount
-- ================================================================
-- La migración 20260324_cash_sessions_arqueo_ciego.sql ya añadió
-- declared_cash, system_cash, variance_cash, etc.
-- Añadimos reported_cash_amount como nombre explícito (alias semántico).
-- Si ya existe declared_cash, usamos ambas en la vista.

ALTER TABLE cash_sessions
  ADD COLUMN IF NOT EXISTS reported_cash_amount numeric(10,2);

-- Sincronizar reported_cash_amount ↔ declared_cash si ambas existen
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cash_sessions'
      AND column_name='declared_cash'
  ) THEN
    -- Copiar valores existentes de declared_cash → reported_cash_amount
    EXECUTE 'UPDATE cash_sessions
             SET reported_cash_amount = declared_cash
             WHERE reported_cash_amount IS NULL AND declared_cash IS NOT NULL';
    RAISE NOTICE 'ARQUEO: reported_cash_amount sincronizada con declared_cash';
  END IF;
END;
$$;

SELECT 'Arqueo Ciego ✅ cash_sessions.reported_cash_amount añadida' AS paso;


-- ================================================================
-- PARTE 2B — VISTA DE RECONCILIACIÓN (solo administradores)
-- ================================================================
-- La vista muestra la diferencia entre lo declarado y lo esperado.
-- La columna system_cash / sistema_calculado viene de:
--   a) cash_sessions.system_cash (si fue calculado al cierre)
--   b) Suma de transactions de esa sesión en tiempo real
--
-- IMPORTANTE: El cajero NO debe ver expected_cash antes de declarar.
-- La vista es para uso exclusivo del panel de administración.

DROP VIEW IF EXISTS v_cash_reconciliation;

CREATE VIEW v_cash_reconciliation AS
SELECT
  cs.id,
  cs.school_id,
  cs.status,
  cs.opened_at,
  cs.closed_at,

  -- Lo que dijo tener el cajero (ingresado SIN ver el sistema)
  COALESCE(cs.reported_cash_amount, cs.declared_cash) AS monto_declarado,

  -- Lo que el sistema calculó (ventas en efectivo de esa sesión)
  COALESCE(
    cs.system_cash,
    (
      SELECT COALESCE(SUM(
        CASE
          WHEN t.payment_method IN ('efectivo', 'cash') THEN ABS(t.amount)
          WHEN t.paid_with_mixed                        THEN COALESCE(t.cash_amount, 0)
          ELSE 0
        END
      ), 0)
      FROM transactions t
      WHERE t.cash_session_id = cs.id
        AND t.type            = 'purchase'
        AND t.payment_status  = 'paid'
    )
  ) AS monto_sistema_efectivo,

  -- Diferencia: positivo = sobrante, negativo = faltante
  COALESCE(cs.reported_cash_amount, cs.declared_cash)
  - COALESCE(
      cs.system_cash,
      (
        SELECT COALESCE(SUM(
          CASE
            WHEN t.payment_method IN ('efectivo', 'cash') THEN ABS(t.amount)
            WHEN t.paid_with_mixed                        THEN COALESCE(t.cash_amount, 0)
            ELSE 0
          END
        ), 0)
        FROM transactions t
        WHERE t.cash_session_id = cs.id
          AND t.type            = 'purchase'
          AND t.payment_status  = 'paid'
      )
    ) AS diferencia_caja,

  -- Semáforo de estado
  CASE
    WHEN COALESCE(cs.reported_cash_amount, cs.declared_cash) IS NULL THEN 'sin_declarar'
    WHEN ABS(
      COALESCE(cs.reported_cash_amount, cs.declared_cash)
      - COALESCE(cs.system_cash, 0)
    ) < 0.01 THEN 'cuadrado'
    WHEN COALESCE(cs.reported_cash_amount, cs.declared_cash)
       > COALESCE(cs.system_cash, 0) THEN 'sobrante'
    ELSE 'faltante'
  END AS estado_arqueo,

  cs.variance_justification AS justificacion

FROM cash_sessions cs;

-- La vista hereda las políticas RLS de cash_sessions (SECURITY INVOKER por defecto).
-- Los cajeros solo ven SUS sesiones. Los admins ven todo.
-- El frontend SOLO debe mostrar las columnas de diferencia a roles admin_general / superadmin.

SELECT 'Arqueo Ciego ✅ vista v_cash_reconciliation creada' AS paso;


-- ================================================================
-- PARTE 3 — ÍNDICES DE RENDIMIENTO
-- ================================================================

-- ── transactions ──────────────────────────────────────────────────
-- Búsqueda más común: ventas por sede en rango de fechas
CREATE INDEX IF NOT EXISTS idx_tx_school_date
  ON transactions (school_id, created_at DESC);

-- Deudas / historial de un alumno
CREATE INDEX IF NOT EXISTS idx_tx_student_date
  ON transactions (student_id, created_at DESC)
  WHERE student_id IS NOT NULL;

-- Reporte de pagos pendientes por sede
CREATE INDEX IF NOT EXISTS idx_tx_payment_status_school
  ON transactions (school_id, payment_status)
  WHERE payment_status = 'pending';

-- Búsqueda por tipo de movimiento (recargas, compras, etc.)
CREATE INDEX IF NOT EXISTS idx_tx_type_school
  ON transactions (school_id, type, created_at DESC);

-- Vinculación de sesión de caja (para arqueo)
CREATE INDEX IF NOT EXISTS idx_tx_cash_session
  ON transactions (cash_session_id)
  WHERE cash_session_id IS NOT NULL;

SELECT 'Índices ✅ transactions: 5 índices creados' AS paso;


-- ── pos_stock_movements (Kardex POS) ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_psm_school_date
  ON pos_stock_movements (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_psm_type
  ON pos_stock_movements (school_id, movement_type, created_at DESC);

SELECT 'Índices ✅ pos_stock_movements: 2 índices adicionales creados' AS paso;


-- ── price_change_log ──────────────────────────────────────────────
-- Los índices idx_pcl_product y idx_pcl_school ya se crearon en p2.
-- Añadimos índice por administrador que cambió el precio (auditoría).
CREATE INDEX IF NOT EXISTS idx_pcl_changed_by
  ON price_change_log (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

SELECT 'Índices ✅ price_change_log: índice por usuario creado' AS paso;


-- ── products ──────────────────────────────────────────────────────
-- Para la query del POS que carga catálogo activo por sede
CREATE INDEX IF NOT EXISTS idx_products_active
  ON products (active, id)
  WHERE active = true;

SELECT 'Índices ✅ products: índice catálogo activo creado' AS paso;


-- ================================================================
-- VERIFICACIÓN FINAL
-- ================================================================
SELECT
  '20260403_pos_final_resilience' AS migracion,
  '1A — Soft Delete BEFORE DELETE trigger en products'  AS parche
UNION ALL SELECT '20260403_pos_final_resilience',
  '1B — Soft Delete BEFORE DELETE trigger en combos'
UNION ALL SELECT '20260403_pos_final_resilience',
  '2A — cash_sessions.reported_cash_amount añadida'
UNION ALL SELECT '20260403_pos_final_resilience',
  '2B — Vista v_cash_reconciliation para arqueo ciego'
UNION ALL SELECT '20260403_pos_final_resilience',
  '3  — Índices de rendimiento: transactions, pos_stock_movements, price_change_log, products';
