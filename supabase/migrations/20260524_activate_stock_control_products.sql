-- ============================================================
-- ACTIVAR stock_control_enabled EN PRODUCTOS CON INVENTARIO REAL
-- ============================================================
-- Problema: productos con filas en product_stock (is_enabled=true)
-- tienen stock_control_enabled=false → el POS no los bloquea cuando
-- se agotan, aunque el switch global allow_negative_stock esté OFF.
--
-- Regla de negocio aplicada:
--   Si un producto tiene stock registrado y activo en alguna sede
--   → debe tener control de stock activado.
--
-- NO toca: RLS, triggers, funciones de pago, saldos, cobranzas.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- PASO 1: DRY-RUN  (solo lectura — no cambia nada)
-- Ejecuta esto PRIMERO para ver exactamente qué va a cambiar.
-- ─────────────────────────────────────────────────────────────
/*
SELECT
  p.id,
  p.name,
  p.stock_control_enabled  AS flag_actual,
  COUNT(DISTINCT ps.school_id) AS sedes_con_stock_activo,
  SUM(ps.current_stock)    AS stock_total_acumulado
FROM products p
INNER JOIN product_stock ps
        ON ps.product_id = p.id
       AND ps.is_enabled  = true
WHERE p.active                = true
  AND p.stock_control_enabled = false
GROUP BY p.id, p.name, p.stock_control_enabled
ORDER BY p.name;
*/


-- ─────────────────────────────────────────────────────────────
-- PASO 2: SNAPSHOT DE SEGURIDAD (backup puntual antes del cambio)
-- Crea tabla temporal de rollback. Puedes borrarla después del QA.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _rollback_stock_ctrl_20260524 (
  product_id             uuid        NOT NULL,
  product_name           text        NOT NULL,
  stock_control_enabled  boolean     NOT NULL,
  snapshot_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO _rollback_stock_ctrl_20260524 (product_id, product_name, stock_control_enabled)
SELECT
  p.id,
  p.name,
  p.stock_control_enabled
FROM products p
INNER JOIN product_stock ps
        ON ps.product_id = p.id
       AND ps.is_enabled  = true
WHERE p.active                = true
  AND p.stock_control_enabled = false
GROUP BY p.id, p.name, p.stock_control_enabled;


-- ─────────────────────────────────────────────────────────────
-- PASO 3: CORRECCIÓN PRINCIPAL (en transacción atómica)
-- Solo productos con stock real activo que aún tienen flag en false.
-- ─────────────────────────────────────────────────────────────
BEGIN;

UPDATE products
SET    stock_control_enabled = true,
       updated_at             = now()
WHERE  id IN (
  SELECT DISTINCT p.id
  FROM   products p
  INNER  JOIN product_stock ps
          ON  ps.product_id = p.id
          AND ps.is_enabled  = true
  WHERE  p.active                = true
    AND  p.stock_control_enabled = false
);

-- Conteo de filas afectadas (debe ser > 0 y coincidir con el dry-run)
DO $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*)
    INTO v_count
  FROM _rollback_stock_ctrl_20260524;
  RAISE NOTICE 'stock_control_enabled activado en % productos', v_count;
END $$;

COMMIT;


-- ─────────────────────────────────────────────────────────────
-- PASO 4: POST-CHECK (ejecuta después del commit)
-- Verifica el resultado. No debe quedar ningún producto con
-- product_stock activo y stock_control_enabled=false.
-- ─────────────────────────────────────────────────────────────
/*
-- 4a. Inconsistencias residuales (debe devolver 0 filas)
SELECT p.id, p.name, p.stock_control_enabled
FROM products p
INNER JOIN product_stock ps
        ON ps.product_id = p.id
       AND ps.is_enabled  = true
WHERE p.active                = true
  AND p.stock_control_enabled = false
GROUP BY p.id, p.name, p.stock_control_enabled;

-- 4b. Confirmación de productos corregidos
SELECT
  p.id,
  p.name,
  p.stock_control_enabled AS flag_nuevo,
  r.stock_control_enabled AS flag_anterior
FROM products p
INNER JOIN _rollback_stock_ctrl_20260524 r ON r.product_id = p.id
ORDER BY p.name;
*/


-- ─────────────────────────────────────────────────────────────
-- ROLLBACK (solo si algo salió mal — ejecutar MANUAL)
-- Revierte exactamente los productos que cambiamos.
-- ─────────────────────────────────────────────────────────────
/*
BEGIN;

UPDATE products p
SET    stock_control_enabled = r.stock_control_enabled,
       updated_at             = now()
FROM   _rollback_stock_ctrl_20260524 r
WHERE  p.id = r.product_id;

COMMIT;
*/


-- ─────────────────────────────────────────────────────────────
-- LIMPIEZA (ejecutar solo después de confirmar QA exitoso)
-- ─────────────────────────────────────────────────────────────
/*
DROP TABLE IF EXISTS _rollback_stock_ctrl_20260524;
*/
