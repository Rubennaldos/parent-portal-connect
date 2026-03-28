-- ============================================================
-- FIOBOT TEXT-TO-SQL — Función de solo lectura
-- Fecha: 2026-03-27
--
-- Propósito: darle a la IA la capacidad de ejecutar cualquier
-- consulta SELECT que ella misma genere, de forma segura.
--
-- Seguridad:
--   1. Solo acepta sentencias SELECT o WITH (CTEs de lectura)
--   2. Bloquea palabras peligrosas con regex
--   3. REVOKE para roles anon y authenticated — solo service_role
--      puede llamarla (el Edge Function usa service_role)
--   4. Limita resultados a 200 filas para proteger tokens
-- ============================================================

CREATE OR REPLACE FUNCTION execute_fiobot_query(p_sql text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result  json;
  v_upper   text;
BEGIN

  -- ── 1. Limpiar y validar ──────────────────────────────────
  v_upper := upper(regexp_replace(trim(p_sql), '\s+', ' ', 'g'));

  -- Solo SELECT o WITH (CTEs de lectura)
  IF NOT (v_upper LIKE 'SELECT %' OR v_upper LIKE 'WITH %') THEN
    RAISE EXCEPTION 'FIOBOT_SECURITY: Solo se permiten consultas SELECT.';
  END IF;

  -- Bloquear cualquier intento de escritura o escalada
  IF v_upper ~ '(INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE|ALTER|GRANT|REVOKE|COPY|EXECUTE|DO\s|CALL\s|PERFORM\s|SET\s|RESET\s|PREPARE\s|DEALLOCATE|NOTIFY|LISTEN|UNLISTEN|VACUUM|ANALYZE|CHECKPOINT|CLUSTER|REINDEX|LOAD|IMPORT)' THEN
    RAISE EXCEPTION 'FIOBOT_SECURITY: Operación no permitida en modo de solo lectura.';
  END IF;

  -- Bloquear múltiples sentencias (punto y coma en mitad del query)
  IF p_sql ~ ';\s*\S' THEN
    RAISE EXCEPTION 'FIOBOT_SECURITY: No se permiten múltiples sentencias.';
  END IF;

  -- ── 2. Ejecutar envuelto en un límite de filas ────────────
  EXECUTE format(
    'SELECT json_agg(t) FROM (SELECT * FROM (%s) _q LIMIT 200) t',
    p_sql
  ) INTO v_result;

  RETURN COALESCE(v_result, '[]'::json);

EXCEPTION
  WHEN others THEN
    -- Re-lanzar con contexto para que la IA lo reciba
    RAISE EXCEPTION 'FIOBOT_ERROR: % — %', SQLERRM, p_sql;
END;
$$;

-- ── Permisos: solo service_role puede ejecutar esta función ──
REVOKE ALL ON FUNCTION execute_fiobot_query(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION execute_fiobot_query(text) FROM authenticated;
REVOKE ALL ON FUNCTION execute_fiobot_query(text) FROM anon;
GRANT EXECUTE ON FUNCTION execute_fiobot_query(text) TO service_role;

SELECT 'execute_fiobot_query creada con éxito (solo lectura, max 200 filas)' AS resultado;
