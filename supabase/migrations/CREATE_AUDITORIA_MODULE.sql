-- ============================================================
-- MÓDULO DE AUDITORÍA — Tablas, Índices y RLS
-- Fecha: 2026-03-26
-- Ejecutar en: Supabase SQL Editor (localhost o producción)
-- ============================================================
-- CONTENIDO:
--   [1] Enum estado_ia para análisis de vouchers
--   [2] Tabla auditoria_vouchers (análisis IA de comprobantes)
--   [3] Tabla huella_digital_logs (rastro de clics y acciones)
--   [4] Índices de alto rendimiento
--   [5] Políticas RLS (solo admin_general y superadmin)
-- ============================================================


-- ============================================================
-- [1] ENUM: Estado del análisis de IA
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_ia_enum') THEN
    CREATE TYPE estado_ia_enum AS ENUM ('VALIDO', 'SOSPECHOSO', 'RECHAZADO');
  END IF;
END
$$;


-- ============================================================
-- [2] TABLA: auditoria_vouchers
-- Guarda el análisis que la IA hace sobre cada comprobante
-- de pago subido por los padres o admins.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditoria_vouchers (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Relación con la solicitud de recarga (recharge_requests)
  -- Puede ser NULL si el análisis es independiente del flujo de recargas
  id_cobranza           UUID          REFERENCES recharge_requests(id) ON DELETE SET NULL,

  -- URL de la imagen del comprobante en Supabase Storage
  url_imagen            TEXT          NOT NULL,

  -- Datos detectados por la IA en el comprobante
  banco_detectado       VARCHAR(100),
  monto_detectado       DECIMAL(10, 2),

  -- Número único de operación bancaria — previene reutilización del mismo voucher
  -- UNIQUE filtrando solo los no rechazados (igual que reference_code en recargas)
  nro_operacion         VARCHAR(100),

  -- Fecha y hora del pago según lo que aparece en el comprobante
  fecha_pago_detectada  TIMESTAMP WITH TIME ZONE,

  -- Hash SHA-256 de la imagen — detecta si suben el mismo archivo con otro nombre
  hash_imagen           TEXT,

  -- Veredicto final de la IA
  estado_ia             estado_ia_enum NOT NULL DEFAULT 'SOSPECHOSO',

  -- JSON con el razonamiento completo de la IA:
  -- { "confianza": 0.95, "motivo": "...", "alertas": [...], "metadata": {...} }
  analisis_ia           JSONB,

  -- Sede donde se originó el pago (para filtrar por sede)
  school_id             UUID          REFERENCES schools(id) ON DELETE SET NULL,

  -- Quién subió el comprobante
  subido_por            UUID          REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Timestamps
  creado_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  actualizado_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comentario descriptivo de la tabla
COMMENT ON TABLE auditoria_vouchers IS
  'Análisis de IA sobre comprobantes de pago. Detecta fraudes, duplicados y datos inconsistentes.';

COMMENT ON COLUMN auditoria_vouchers.nro_operacion IS
  'Número de operación bancario. UNIQUE para evitar que el mismo voucher se use dos veces.';

COMMENT ON COLUMN auditoria_vouchers.hash_imagen IS
  'Hash SHA-256 del archivo. Detecta si se sube el mismo comprobante con diferente nombre.';

COMMENT ON COLUMN auditoria_vouchers.analisis_ia IS
  'JSON con razonamiento completo: { confianza, motivo, alertas, datos_extraidos, metadata }';


-- ============================================================
-- [3] TABLA: huella_digital_logs
-- Rastro de cada acción relevante en el sistema.
-- IP, User-Agent y fingerprint del dispositivo.
-- ============================================================

CREATE TABLE IF NOT EXISTS huella_digital_logs (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Usuario que realizó la acción (puede ser NULL si es acción anónima)
  usuario_id            UUID          REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Tipo de acción realizada
  -- Ejemplos: 'SUBIDA_VOUCHER', 'APROBACION_MANUAL', 'RECHAZO_VOUCHER',
  --           'INICIO_SESION', 'CAMBIO_SALDO', 'EXPORTAR_REPORTE'
  accion                VARCHAR(100)  NOT NULL,

  -- Módulo desde donde se originó la acción
  -- Ejemplos: 'COBRANZAS', 'RECARGAS', 'POS', 'AUDITORIA'
  modulo                VARCHAR(100)  NOT NULL,

  -- JSON técnico del dispositivo y sesión:
  -- {
  --   "ip": "190.232.xx.xx",
  --   "user_agent": "Mozilla/5.0...",
  --   "fingerprint": "a1b2c3d4...",
  --   "referrer": "...",
  --   "timezone": "America/Lima"
  -- }
  detalles_tecnicos     JSONB,

  -- Datos adicionales de contexto (qué se aprobó, cuánto era, etc.)
  -- Ejemplo: { "voucher_id": "uuid", "monto": 50.00, "alumno": "Juan Pérez" }
  contexto              JSONB,

  -- Sede donde ocurrió la acción
  school_id             UUID          REFERENCES schools(id) ON DELETE SET NULL,

  -- Timestamp con zona horaria (importante para logs)
  creado_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE huella_digital_logs IS
  'Rastro completo de acciones críticas: quién, qué, cuándo, desde dónde. Para auditoría forense.';

COMMENT ON COLUMN huella_digital_logs.detalles_tecnicos IS
  'JSON con IP, User-Agent, fingerprint del dispositivo y datos de sesión.';

COMMENT ON COLUMN huella_digital_logs.contexto IS
  'JSON con datos del negocio relacionados a la acción (IDs, montos, nombres).';


-- ============================================================
-- [4] ÍNDICES DE ALTO RENDIMIENTO
-- Para búsquedas ultrarrápidas con miles de registros por sede
-- ============================================================

-- ──────────────────────────────────────────────────
-- auditoria_vouchers
-- ──────────────────────────────────────────────────

-- Índice único en nro_operacion (excluyendo rechazados)
-- Igual al patrón de reference_code en recharge_requests
CREATE UNIQUE INDEX IF NOT EXISTS idx_auditoria_nro_operacion_unique
ON auditoria_vouchers (nro_operacion)
WHERE estado_ia != 'RECHAZADO'
  AND nro_operacion IS NOT NULL
  AND nro_operacion != '';

-- Índice único en hash_imagen (excluyendo rechazados)
-- Detecta el mismo archivo subido con diferente nombre
CREATE UNIQUE INDEX IF NOT EXISTS idx_auditoria_hash_imagen_unique
ON auditoria_vouchers (hash_imagen)
WHERE estado_ia != 'RECHAZADO'
  AND hash_imagen IS NOT NULL
  AND hash_imagen != '';

-- Índice para filtrar por estado y sede (el más usado en el dashboard)
CREATE INDEX IF NOT EXISTS idx_auditoria_estado_school
ON auditoria_vouchers (estado_ia, school_id, creado_at DESC);

-- Índice para buscar por cobranza vinculada
CREATE INDEX IF NOT EXISTS idx_auditoria_id_cobranza
ON auditoria_vouchers (id_cobranza)
WHERE id_cobranza IS NOT NULL;

-- Índice por fecha (para reportes de rango)
CREATE INDEX IF NOT EXISTS idx_auditoria_creado_at
ON auditoria_vouchers (creado_at DESC);

-- Índice GIN en analisis_ia para búsquedas dentro del JSON
CREATE INDEX IF NOT EXISTS idx_auditoria_analisis_ia_gin
ON auditoria_vouchers USING GIN (analisis_ia);


-- ──────────────────────────────────────────────────
-- huella_digital_logs
-- ──────────────────────────────────────────────────

-- Índice por usuario y fecha (ver historial de un usuario)
CREATE INDEX IF NOT EXISTS idx_huella_usuario_fecha
ON huella_digital_logs (usuario_id, creado_at DESC);

-- Índice por acción y módulo (filtrar por tipo de evento)
CREATE INDEX IF NOT EXISTS idx_huella_accion_modulo
ON huella_digital_logs (accion, modulo, creado_at DESC);

-- Índice por sede y fecha (ver actividad por sede)
CREATE INDEX IF NOT EXISTS idx_huella_school_fecha
ON huella_digital_logs (school_id, creado_at DESC);

-- Índice GIN en detalles_tecnicos (buscar por IP o fingerprint)
CREATE INDEX IF NOT EXISTS idx_huella_detalles_gin
ON huella_digital_logs USING GIN (detalles_tecnicos);

-- Índice GIN en contexto (buscar por datos de negocio)
CREATE INDEX IF NOT EXISTS idx_huella_contexto_gin
ON huella_digital_logs USING GIN (contexto);


-- ============================================================
-- [5] ROW LEVEL SECURITY (RLS)
-- Solo admin_general y superadmin tienen acceso.
-- Los demás roles NO ven nada de este módulo.
-- ============================================================

-- ──────────────────────────────────────────────────
-- auditoria_vouchers: habilitar RLS
-- ──────────────────────────────────────────────────

ALTER TABLE auditoria_vouchers ENABLE ROW LEVEL SECURITY;

-- Solo admin_general y superadmin pueden VER registros
CREATE POLICY "av_select_admin_general_only"
ON auditoria_vouchers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  )
);

-- Solo admin_general y superadmin pueden INSERTAR (ej: análisis manual)
CREATE POLICY "av_insert_admin_general_only"
ON auditoria_vouchers
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  )
);

-- Solo admin_general y superadmin pueden ACTUALIZAR (ej: override manual)
CREATE POLICY "av_update_admin_general_only"
ON auditoria_vouchers
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  )
);

-- Nadie puede borrar registros de auditoría desde el cliente
-- (los logs son permanentes — hard delete solo desde backend)


-- ──────────────────────────────────────────────────
-- huella_digital_logs: habilitar RLS
-- ──────────────────────────────────────────────────

ALTER TABLE huella_digital_logs ENABLE ROW LEVEL SECURITY;

-- Solo admin_general y superadmin pueden VER el rastro de actividad
CREATE POLICY "hdl_select_admin_general_only"
ON huella_digital_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  )
);

-- INSERT abierto para authenticated: cualquier parte del sistema puede registrar acciones
-- (el service_role o las funciones del backend insertan logs automáticamente)
CREATE POLICY "hdl_insert_authenticated"
ON huella_digital_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Nadie puede modificar ni borrar logs desde el cliente
-- (los logs son inmutables por diseño)


-- ============================================================
-- [6] TRIGGER: actualizar actualizado_at en auditoria_vouchers
-- ============================================================

  CREATE OR REPLACE FUNCTION fn_update_auditoria_timestamp()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.actualizado_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_auditoria_vouchers_updated ON auditoria_vouchers;

  CREATE TRIGGER trg_auditoria_vouchers_updated
  BEFORE UPDATE ON auditoria_vouchers
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_auditoria_timestamp();


-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================

SELECT
  '✅ TABLA CREADA' AS resultado,
  'auditoria_vouchers' AS objeto
UNION ALL
SELECT '✅ TABLA CREADA', 'huella_digital_logs'
UNION ALL
SELECT '✅ ÍNDICE ÚNICO', 'idx_auditoria_nro_operacion_unique'
UNION ALL
SELECT '✅ ÍNDICE ÚNICO', 'idx_auditoria_hash_imagen_unique'
UNION ALL
SELECT '✅ ÍNDICES', '5 índices en auditoria_vouchers (estado, cobranza, fecha, GIN)'
UNION ALL
SELECT '✅ ÍNDICES', '5 índices en huella_digital_logs (usuario, acción, sede, GIN x2)'
UNION ALL
SELECT '✅ RLS ACTIVO', 'auditoria_vouchers — solo admin_general y superadmin'
UNION ALL
SELECT '✅ RLS ACTIVO', 'huella_digital_logs — solo admin_general ve; todos insertan'
UNION ALL
SELECT '✅ TRIGGER', 'trg_auditoria_vouchers_updated — actualiza actualizado_at';
