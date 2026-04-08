-- ═══════════════════════════════════════════════════════════════════════════
-- RESYNC DE SECUENCIAS + HERRAMIENTAS DE AJUSTE MANUAL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA:
--   invoice_sequences.last_numero puede quedar DETRÁS de lo que Nubefact
--   ya emitió. Esto causa el error "Este documento ya existe en NubeFacT"
--   al intentar boletear el siguiente número.
--
-- CAUSAS DOCUMENTADAS:
--   A) El fallback de emergencia en generate-document consume DOS números
--      en un solo intento fallido (N y N+1). Si N+1 tampoco existía en
--      invoice_sequences pero sí en Nubefact, la secuencia queda desfasada.
--   B) Boletas emitidas antes de la migración 20260404 (con SELECT MAX+1)
--      no siempre quedaron registradas en invoice_sequences.
--   C) Boletas con billing_status='failed' (IGV error, etc.) SÍ llegaron
--      a Nubefact (que las numeró), pero nuestro rollback no actualizó la
--      secuencia si el insert en `invoices` falló.
--   D) El modo demo puede haberlos consumido en Nubefact en modo real por error.
--
-- ESTE SCRIPT:
--   PARTE 1 — Diagnóstico: muestra el estado actual de cada serie
--   PARTE 2 — Re-sync automático: avanza last_numero al MAX de nuestra BD
--   PARTE 3 — Función set_invoice_sequence: ajuste manual para cuando
--             Nubefact tiene números que NO están en nuestra BD
--   PARTE 4 — Vista de auditoría: consulta rápida de estado post-fix
-- ═══════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1: DIAGNÓSTICO — Estado actual
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecuta esta sección primero para VER el problema antes de tocar nada.
-- Compara last_numero (lo que cree nuestra BD) vs max_en_invoices (lo real).

SELECT
  iseq.serie,
  sc.name                              AS sede,
  iseq.last_numero                     AS secuencia_actual,
  COALESCE(inv.max_num, 0)             AS max_en_invoices,
  COALESCE(ed.max_num,  0)             AS max_en_electronic_docs,
  GREATEST(
    iseq.last_numero,
    COALESCE(inv.max_num, 0),
    COALESCE(ed.max_num,  0)
  )                                    AS correcto_deberia_ser,
  CASE
    WHEN iseq.last_numero < GREATEST(COALESCE(inv.max_num, 0), COALESCE(ed.max_num, 0))
      THEN '❌ DESFASADO — ajuste necesario'
    ELSE '✅ En sincronía'
  END                                  AS estado,
  iseq.updated_at
FROM invoice_sequences iseq
LEFT JOIN schools sc          ON sc.id = iseq.school_id
LEFT JOIN (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   invoices
  WHERE  numero IS NOT NULL AND serie IS NOT NULL
  GROUP  BY school_id, serie
) inv ON inv.school_id = iseq.school_id AND inv.serie = iseq.serie
LEFT JOIN (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   electronic_documents
  WHERE  numero IS NOT NULL AND serie IS NOT NULL
  GROUP  BY school_id, serie
) ed ON ed.school_id = iseq.school_id AND ed.serie = iseq.serie
ORDER BY sc.name, iseq.serie;


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2: RE-SYNC AUTOMÁTICO
-- ════════════════════════════════════════════════════════════════════════════
-- Avanza last_numero al mayor valor encontrado en nuestra BD.
-- IDEMPOTENTE: si ya está sincronizado, no cambia nada.
-- ⚠️  ADVERTENCIA: esto sincroniza con nuestra BD, pero si Nubefact tiene
--     números que NO están en invoices ni electronic_documents, necesitas
--     la Parte 3 para avanzar manualmente al número correcto.

UPDATE invoice_sequences iseq
SET
  last_numero = GREATEST(
    iseq.last_numero,
    COALESCE(inv.max_num, 0),
    COALESCE(ed.max_num,  0)
  ),
  updated_at  = now()
FROM (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   invoices
  WHERE  numero IS NOT NULL AND serie IS NOT NULL
  GROUP  BY school_id, serie
) inv
LEFT JOIN (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   electronic_documents
  WHERE  numero IS NOT NULL AND serie IS NOT NULL
  GROUP  BY school_id, serie
) ed ON ed.school_id = inv.school_id AND ed.serie = inv.serie
WHERE  iseq.school_id = inv.school_id
  AND  iseq.serie     = inv.serie;

-- También insertar series que están en invoices pero faltan en invoice_sequences:
INSERT INTO invoice_sequences (school_id, serie, last_numero, updated_at)
SELECT
  inv.school_id,
  inv.serie,
  GREATEST(inv.max_num, COALESCE(ed.max_num, 0)),
  now()
FROM (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   invoices
  WHERE  numero IS NOT NULL AND serie IS NOT NULL
  GROUP  BY school_id, serie
) inv
LEFT JOIN (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   electronic_documents
  WHERE  numero IS NOT NULL AND serie IS NOT NULL
  GROUP  BY school_id, serie
) ed ON ed.school_id = inv.school_id AND ed.serie = inv.serie
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_sequences iseq2
  WHERE iseq2.school_id = inv.school_id AND iseq2.serie = inv.serie
)
ON CONFLICT (school_id, serie) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3: FUNCIÓN set_invoice_sequence — Ajuste manual con llave de seguridad
-- ════════════════════════════════════════════════════════════════════════════
-- Usar cuando Nubefact tiene números que NO están en nuestra BD.
-- Ejemplo: Nubefact llega a BJL3-00000205 pero nuestra BD solo ve hasta 198.
-- Llamar: SELECT set_invoice_sequence('BJL3', 205, 'admin_token_secreto');
--
-- La llave de seguridad evita que cualquier script la ejecute accidentalmente.
-- Cambiar 'AJUSTE_MANUAL_OK' por una cadena conocida solo por el equipo.

DROP FUNCTION IF EXISTS set_invoice_sequence(text, int, text);

CREATE OR REPLACE FUNCTION set_invoice_sequence(
  p_serie         text,       -- ej: 'BJL3', 'BMS4', 'BMC3'
  p_new_last      int,        -- el nuevo valor de last_numero (el máximo REAL de Nubefact)
  p_admin_token   text        -- llave de seguridad: debe ser 'AJUSTE_MANUAL_OK'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_last int;
  v_rows_updated int;
BEGIN
  -- Validar token de seguridad
  IF p_admin_token != 'AJUSTE_MANUAL_OK' THEN
    RAISE EXCEPTION 'TOKEN_INVALIDO: token de seguridad incorrecto';
  END IF;

  -- Validar que el nuevo valor no sea negativo ni cero
  IF p_new_last < 1 THEN
    RAISE EXCEPTION 'VALOR_INVALIDO: el nuevo last_numero debe ser >= 1, recibido: %', p_new_last;
  END IF;

  -- Obtener el valor actual para el log
  SELECT last_numero INTO v_old_last
  FROM   invoice_sequences
  WHERE  serie = p_serie
  LIMIT 1;

  -- Si no existe la fila, advertir
  IF v_old_last IS NULL THEN
    RAISE WARNING 'La serie % no existe en invoice_sequences. '
      'Se creará con last_numero = %.', p_serie, p_new_last;
  END IF;

  -- Advertir si estamos BAJANDO el correlativo (muy peligroso)
  IF v_old_last IS NOT NULL AND p_new_last < v_old_last THEN
    RAISE WARNING 'ADVERTENCIA: estás BAJANDO el correlativo de % a % para la serie %. '
      'Esto puede causar duplicados si Nubefact ya emitió números entre % y %.',
      v_old_last, p_new_last, p_serie, p_new_last, v_old_last;
  END IF;

  -- Actualizar (o insertar) el correlativo para TODAS las sedes que usen esta serie
  UPDATE invoice_sequences
  SET    last_numero = p_new_last,
         updated_at  = now()
  WHERE  serie       = p_serie;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Log de auditoría
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id, accion, modulo, contexto, creado_at
    ) VALUES (
      auth.uid(),
      'AJUSTE_MANUAL_CORRELATIVO',
      'FACTURACION',
      jsonb_build_object(
        'serie',          p_serie,
        'valor_anterior', v_old_last,
        'valor_nuevo',    p_new_last,
        'filas_afectadas', v_rows_updated
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo escribir en huella_digital_logs: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok',              true,
    'serie',           p_serie,
    'valor_anterior',  v_old_last,
    'valor_nuevo',     p_new_last,
    'filas_afectadas', v_rows_updated,
    'proximo_a_emitir', p_new_last + 1,
    'mensaje',         format(
      'Correlativo de %s ajustado de %s a %s. Próximo número a emitir: %s.',
      p_serie, v_old_last, p_new_last, p_new_last + 1
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION set_invoice_sequence(text, int, text)
  TO authenticated;

COMMENT ON FUNCTION set_invoice_sequence IS
  'Ajuste manual del correlativo de una serie. '
  'Usar cuando Nubefact tiene números que no están en nuestra BD. '
  'Requiere token de seguridad ''AJUSTE_MANUAL_OK''. '
  'p_new_last debe ser el ÚLTIMO número que ya tiene Nubefact '
  '(el próximo a emitir será p_new_last + 1).';


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4: VISTA DE AUDITORÍA POST-FIX
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar DESPUÉS del re-sync para confirmar el resultado.

SELECT
  iseq.serie,
  sc.name                              AS sede,
  iseq.last_numero                     AS ultimo_emitido,
  iseq.last_numero + 1                 AS proximo_a_emitir,
  COALESCE(inv.max_num, 0)             AS max_en_invoices,
  CASE
    WHEN iseq.last_numero >= COALESCE(inv.max_num, 0)
      THEN '✅ SINCRONIZADO'
    ELSE '⚠️  AUN DESFASADO — revisar con Nubefact'
  END                                  AS estado_final,
  iseq.updated_at
FROM invoice_sequences iseq
LEFT JOIN schools sc ON sc.id = iseq.school_id
LEFT JOIN (
  SELECT school_id, serie, MAX(numero) AS max_num
  FROM   invoices
  WHERE  numero IS NOT NULL
  GROUP  BY school_id, serie
) inv ON inv.school_id = iseq.school_id AND inv.serie = iseq.serie
ORDER BY sc.name, iseq.serie;
