-- ============================================================
-- LIMPIEZA DE DUPLICADOS en auditoria_vouchers
-- Fecha: 2026-03-29
--
-- PROBLEMA: El Edge Function analizar-voucher antes del fix
-- creaba un registro NUEVO cada vez que se re-analizaba un
-- comprobante RECHAZADO, acumulando duplicados.
--
-- SOLUCIÓN: Para cada nro_operacion con más de 1 fila,
-- conservar SOLO la más reciente (mayor creado_at).
-- Eliminar las filas antiguas.
-- ============================================================

-- ── PASO 1: Ver cuántos duplicados hay (diagnóstico) ──
DO $$
DECLARE
  v_grupos     INTEGER;
  v_duplicados INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_grupos
  FROM (
    SELECT nro_operacion
    FROM auditoria_vouchers
    WHERE nro_operacion IS NOT NULL
    GROUP BY nro_operacion
    HAVING COUNT(*) > 1
  ) t;

  SELECT COUNT(*) INTO v_duplicados
  FROM auditoria_vouchers av
  WHERE av.nro_operacion IS NOT NULL
    AND av.id NOT IN (
      SELECT DISTINCT ON (nro_operacion) id
      FROM auditoria_vouchers
      WHERE nro_operacion IS NOT NULL
      ORDER BY nro_operacion, creado_at DESC
    );

  RAISE NOTICE '=== DIAGNÓSTICO DUPLICADOS auditoria_vouchers ===';
  RAISE NOTICE 'Grupos con duplicados : %', v_grupos;
  RAISE NOTICE 'Filas a eliminar      : %', v_duplicados;
END $$;

-- ── PASO 2: Antes de borrar, verificar qué se va a eliminar ──
-- (Descomenta este SELECT para revisar antes de ejecutar el DELETE)
/*
SELECT
  av.id,
  av.nro_operacion,
  av.estado_ia,
  av.creado_at,
  'DUPLICADO - SE ELIMINARÁ' AS accion
FROM auditoria_vouchers av
WHERE av.nro_operacion IS NOT NULL
  AND av.id NOT IN (
    SELECT DISTINCT ON (nro_operacion) id
    FROM auditoria_vouchers
    WHERE nro_operacion IS NOT NULL
    ORDER BY nro_operacion, creado_at DESC
  )
ORDER BY av.nro_operacion, av.creado_at;
*/

-- ── PASO 3: Eliminar duplicados — conservar el más reciente ──
DELETE FROM auditoria_vouchers
WHERE nro_operacion IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (nro_operacion) id
    FROM auditoria_vouchers
    WHERE nro_operacion IS NOT NULL
    ORDER BY nro_operacion, creado_at DESC  -- el primero (más reciente) se conserva
  );

-- ── PASO 4: Verificar resultado ──
DO $$
DECLARE
  v_restantes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_restantes
  FROM (
    SELECT nro_operacion
    FROM auditoria_vouchers
    WHERE nro_operacion IS NOT NULL
    GROUP BY nro_operacion
    HAVING COUNT(*) > 1
  ) t;

  IF v_restantes = 0 THEN
    RAISE NOTICE '✅ Sin duplicados. Todos los N° de operación son únicos ahora.';
  ELSE
    RAISE WARNING '⚠️ Aún quedan % grupos con duplicados. Revisar manualmente.', v_restantes;
  END IF;
END $$;
