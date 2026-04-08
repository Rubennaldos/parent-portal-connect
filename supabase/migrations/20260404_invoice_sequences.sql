-- ============================================================
-- CORRELATIVO ATÓMICO — invoice_sequences
-- ============================================================
-- Problema original:
--   generate-document usaba SELECT MAX(numero)+1, una operación
--   NO atómica. Dos Edge Functions simultáneas podían leer el
--   mismo MAX y enviar el MISMO correlativo a SUNAT/Nubefact
--   → infracción Art. 174 Código Tributario Peruano.
--
-- Solución:
--   INSERT ... ON CONFLICT ... DO UPDATE RETURNING last_numero
--   es una operación atómica garantizada por Postgres.
--   Bajo cualquier nivel de concurrencia, cada llamada recibe
--   un número distinto. Imposible duplicar correlativos.
--
-- Estructura:
--   invoice_sequences (school_id, serie) → last_numero
--   get_next_invoice_numero(school_id, serie) → int
--
-- Inicialización:
--   Al final de este script se cargan los máximos actuales
--   desde invoices + electronic_documents para que la secuencia
--   arranque desde donde dejó el sistema anterior.
-- ============================================================

-- ── TABLA: invoice_sequences ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_sequences (
  school_id    uuid   NOT NULL,
  serie        text   NOT NULL,
  last_numero  int    NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, serie)
);

COMMENT ON TABLE invoice_sequences IS
  'Contador atómico de correlativos por sede y serie. '
  'Reemplaza el frágil SELECT MAX(numero)+1. '
  'Cada llamada a get_next_invoice_numero incrementa last_numero '
  'de forma atómica: imposible que dos instancias lean el mismo número.';

-- Índice para auditoría (ver todos los contadores de una sede)
CREATE INDEX IF NOT EXISTS idx_invoice_sequences_school
  ON invoice_sequences (school_id);

-- RLS: solo service_role y la función pueden modificar (SECURITY DEFINER la invoca)
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_sequences_select_admin"
  ON invoice_sequences FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin', 'supervisor_red')
    )
  );

-- ── FUNCIÓN: get_next_invoice_numero ─────────────────────────────────────────
-- Retorna el próximo correlativo para (school_id, serie).
-- Atómica: usa INSERT...ON CONFLICT...DO UPDATE RETURNING.
-- Si la fila no existe la crea con last_numero=1.
-- Si existe la incrementa en 1 y devuelve el nuevo valor.
--
-- Llamada desde la Edge Function generate-document (service_role).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_next_invoice_numero(uuid, text);

CREATE OR REPLACE FUNCTION get_next_invoice_numero(
  p_school_id  uuid,
  p_serie      text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  -- Una sola sentencia: crear o incrementar atómicamente.
  -- Postgres garantiza que dos transacciones concurrentes
  -- sobre la misma (school_id, serie) NO obtendrán el mismo v_next.
  INSERT INTO invoice_sequences (school_id, serie, last_numero, updated_at)
  VALUES (p_school_id, p_serie, 1, now())
  ON CONFLICT (school_id, serie) DO UPDATE
    SET last_numero = invoice_sequences.last_numero + 1,
        updated_at  = now()
  RETURNING last_numero INTO v_next;

  RETURN v_next;
END;
$$;

-- Acceso exclusivo para service_role (Edge Function corre con este rol)
GRANT EXECUTE ON FUNCTION get_next_invoice_numero(uuid, text) TO service_role;

COMMENT ON FUNCTION get_next_invoice_numero IS
  'Genera el siguiente correlativo atómico para una serie de comprobante. '
  'Seguro bajo concurrencia extrema: usa INSERT ON CONFLICT DO UPDATE, '
  'no SELECT MAX(). Nunca puede devolver el mismo número dos veces '
  'para la misma (school_id, serie).';


-- ── INICIALIZACIÓN: cargar máximos existentes ─────────────────────────────────
-- CRÍTICO: antes de activar la secuencia, la inicializamos con el MAX actual
-- de las tablas históricas para que el primer número emitido sea MAX+1.
-- Si no hacemos esto, la secuencia arranca en 1 y colisiona con datos anteriores.
-- ─────────────────────────────────────────────────────────────────────────────

-- Paso 1: Cargar desde tabla `invoices` (fuente primaria actual)
INSERT INTO invoice_sequences (school_id, serie, last_numero)
SELECT
  school_id,
  serie,
  MAX(numero)
FROM invoices
WHERE numero IS NOT NULL
  AND serie   IS NOT NULL
  AND school_id IS NOT NULL
GROUP BY school_id, serie
ON CONFLICT (school_id, serie) DO UPDATE
  SET last_numero = GREATEST(invoice_sequences.last_numero, EXCLUDED.last_numero),
      updated_at  = now();

-- Paso 2: Complementar con tabla `electronic_documents` (fuente legacy/fallback)
-- Por si hubiera registros allí que no están en invoices.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'electronic_documents'
  ) THEN
    INSERT INTO invoice_sequences (school_id, serie, last_numero)
    SELECT
      school_id,
      serie,
      MAX(numero)
    FROM electronic_documents
    WHERE numero    IS NOT NULL
      AND serie     IS NOT NULL
      AND school_id IS NOT NULL
    GROUP BY school_id, serie
    ON CONFLICT (school_id, serie) DO UPDATE
      SET last_numero = GREATEST(invoice_sequences.last_numero, EXCLUDED.last_numero),
          updated_at  = now();

    RAISE NOTICE 'Secuencias inicializadas desde electronic_documents.';
  ELSE
    RAISE NOTICE 'electronic_documents no existe — omitido.';
  END IF;
END;
$$;


-- ── VERIFICACIÓN FINAL ────────────────────────────────────────────────────────
-- Esta query muestra el estado de todas las secuencias inicializadas.
-- Ejecútala para confirmar que los números son correctos antes de activar.
SELECT
  s.school_id,
  sc.name                                                    AS sede,
  s.serie,
  s.last_numero                                              AS ultimo_emitido,
  s.last_numero + 1                                          AS proximo_a_emitir,
  s.updated_at
FROM invoice_sequences s
LEFT JOIN schools sc ON sc.id = s.school_id
ORDER BY sc.name, s.serie;
