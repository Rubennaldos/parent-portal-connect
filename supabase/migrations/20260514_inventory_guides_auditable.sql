-- ============================================================
-- GUÍAS AUDITABLES DE LOGÍSTICA
-- Tabla: inventory_guides
-- Propósito: registrar metadatos de cada PDF de guía
--   generado para ingresos y traslados, enlazado a
--   logistic_documents (Storage). No regenerar en cada clic.
-- Estrategia:
--   - Generación: al confirmar la transacción (1 sola vez).
--   - Reimpresión: leer URL firmada del archivo ya persistido.
--   - Deduplicación: UNIQUE (source_type, source_id, destination_label, template_version)
--   - Históricos: backfill lazy (al primer clic de reimp. sin guía).
-- ============================================================

-- ── 1. Tabla principal ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventory_guides (
  id                 uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Entidad origen del movimiento
  source_type        text         NOT NULL
    CHECK (source_type IN ('ingress', 'transfer', 'transfer_warehouse')),
  source_id          uuid         NOT NULL,       -- FK lógica (FK real infactible para 3 tablas diferentes)

  -- Correlativo legible del movimiento (ING-2024-0001, TR-001, TRW-2024-001…)
  business_ref       text         NOT NULL,

  -- Destino (para ingresos multisede hay una fila por cada sede)
  destination_label  text         NOT NULL DEFAULT 'Almacén Central',

  -- Archivo generado
  storage_bucket     text         NOT NULL DEFAULT 'logistic_documents',
  storage_path       text         NOT NULL,       -- path relativo dentro del bucket

  -- Auditoría e idempotencia
  content_hash       text         NOT NULL,       -- SHA-256 hex del payload canónico
  template_version   text         NOT NULL DEFAULT '1.0',
  status             text         NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'failed')),
  superseded_by      uuid         REFERENCES public.inventory_guides(id) ON DELETE SET NULL,

  -- Trazabilidad
  generated_by       uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at       timestamptz  NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.inventory_guides IS
  'Metadatos auditables de cada PDF de guía logística generado. Un registro por (movimiento × sede destino). El archivo físico vive en Storage (logistic_documents).';

COMMENT ON COLUMN public.inventory_guides.source_type IS
  'Tipo del movimiento: ingress=inventory_transactions, transfer=internal_transfers, transfer_warehouse=inventory_location_transfers';
COMMENT ON COLUMN public.inventory_guides.source_id IS
  'UUID del registro origen (id de inventory_transactions, internal_transfers o inventory_location_transfers).';
COMMENT ON COLUMN public.inventory_guides.business_ref IS
  'Correlativo legible del sistema: ING-YYYY-XXXX, TR-001, TRW-2024-001, etc.';
COMMENT ON COLUMN public.inventory_guides.destination_label IS
  'Nombre de la sede o almacén destino tal como aparece en el PDF. Para ingresos multisede, una fila por sede.';
COMMENT ON COLUMN public.inventory_guides.storage_path IS
  'Ruta relativa dentro del bucket logistic_documents. Ej: guides/ingress/<source_id>/<content_hash>.pdf';
COMMENT ON COLUMN public.inventory_guides.content_hash IS
  'SHA-256 hex del payload canónico (JSON con IDs + cantidades + nombres snapshot + business_ref). Garantiza idempotencia y deduplicación.';
COMMENT ON COLUMN public.inventory_guides.template_version IS
  'Versión del layout del PDF. Si se actualiza el diseño y se regenera, permite auditar qué versión generó cada guía.';
COMMENT ON COLUMN public.inventory_guides.superseded_by IS
  'Si esta guía fue reemplazada por una nueva versión, referencia al nuevo registro. El archivo antiguo se conserva.';

-- ── 2. Índices ────────────────────────────────────────────────────────────────

-- Consulta principal desde UI: "dame las guías activas de esta transacción"
CREATE INDEX IF NOT EXISTS idx_invguides_source
  ON public.inventory_guides (source_type, source_id)
  WHERE status = 'active';

-- Idempotencia: no crear archivo duplicado para mismo movimiento × destino × template
CREATE UNIQUE INDEX IF NOT EXISTS idx_invguides_unique_active
  ON public.inventory_guides (source_type, source_id, destination_label, template_version)
  WHERE status = 'active';

-- Auditoría: quién generó y cuándo
CREATE INDEX IF NOT EXISTS idx_invguides_generated
  ON public.inventory_guides (generated_by, generated_at DESC);

-- Búsqueda por correlativo legible
CREATE INDEX IF NOT EXISTS idx_invguides_business_ref
  ON public.inventory_guides (business_ref);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.inventory_guides ENABLE ROW LEVEL SECURITY;

-- Lectura: admin_general, superadmin y admin pueden ver todas las guías
DROP POLICY IF EXISTS "invguides_read_admin" ON public.inventory_guides;
CREATE POLICY "invguides_read_admin" ON public.inventory_guides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role IN ('admin_general', 'superadmin', 'admin')
    )
  );

-- Insertar: solo admin_general y superadmin pueden crear registros de guía
DROP POLICY IF EXISTS "invguides_insert_admin" ON public.inventory_guides;
CREATE POLICY "invguides_insert_admin" ON public.inventory_guides
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  );

-- UPDATE restringido: solo para marcar superseded_by o status (nunca borrar contenido)
DROP POLICY IF EXISTS "invguides_update_admin" ON public.inventory_guides;
CREATE POLICY "invguides_update_admin" ON public.inventory_guides
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  );

-- DELETE prohibido para todo usuario (inmutabilidad de registros de auditoría)
-- No se crea policy de DELETE → Supabase bloquea por defecto.

-- ── 4. RPC: upsert_inventory_guide ───────────────────────────────────────────
-- Operación atómica: "dame o crea" la fila de metadatos de guía.
-- Si ya existe (mismo source + destino + template, mismo hash) devuelve la existente.
-- Si el hash cambió marca la anterior como superseded e inserta la nueva.
-- El archivo en Storage lo gestiona el cliente; este RPC solo maneja la fila de DB.

CREATE OR REPLACE FUNCTION public.upsert_inventory_guide(
  p_source_type        text,
  p_source_id          uuid,
  p_business_ref       text,
  p_destination_label  text,
  p_storage_bucket     text,
  p_storage_path       text,
  p_content_hash       text,
  p_template_version   text DEFAULT '1.0'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_new_id   uuid;
BEGIN
  -- Buscar fila activa para este movimiento × destino × template
  SELECT * INTO v_existing
  FROM public.inventory_guides
  WHERE source_type       = p_source_type
    AND source_id         = p_source_id
    AND destination_label = p_destination_label
    AND template_version  = p_template_version
    AND status            = 'active'
  LIMIT 1;

  -- Si ya existe Y tiene el mismo hash → devolver existente (idempotencia total)
  IF FOUND AND v_existing.content_hash = p_content_hash THEN
    RETURN jsonb_build_object(
      'action',       'found_existing',
      'guide_id',     v_existing.id,
      'storage_path', v_existing.storage_path,
      'business_ref', v_existing.business_ref
    );
  END IF;

  -- Si existe pero con hash diferente → marcar como superseded
  IF FOUND AND v_existing.content_hash <> p_content_hash THEN
    UPDATE public.inventory_guides
    SET status = 'superseded'
    WHERE id = v_existing.id;
  END IF;

  -- Insertar nueva fila activa
  INSERT INTO public.inventory_guides (
    source_type,
    source_id,
    business_ref,
    destination_label,
    storage_bucket,
    storage_path,
    content_hash,
    template_version,
    status,
    superseded_by,
    generated_by,
    generated_at
  ) VALUES (
    p_source_type,
    p_source_id,
    p_business_ref,
    p_destination_label,
    p_storage_bucket,
    p_storage_path,
    p_content_hash,
    p_template_version,
    'active',
    CASE WHEN FOUND THEN v_existing.id ELSE NULL END,
    auth.uid(),
    clock_timestamp()
  )
  RETURNING id INTO v_new_id;

  -- Actualizar superseded_by en la fila antigua si existía
  IF FOUND THEN
    UPDATE public.inventory_guides
    SET superseded_by = v_new_id
    WHERE id = v_existing.id;
  END IF;

  RETURN jsonb_build_object(
    'action',       CASE WHEN FOUND THEN 'replaced' ELSE 'created' END,
    'guide_id',     v_new_id,
    'storage_path', p_storage_path,
    'business_ref', p_business_ref
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_inventory_guide IS
  'Atomicamente registra o recupera metadatos de guía PDF logística. Idempotente por (source, destino, template, hash). Si el hash cambia, marca la anterior como superseded y crea la nueva.';

-- ── 5. RPC: get_guides_for_source ─────────────────────────────────────────────
-- Devuelve todas las guías activas de un movimiento para la UI de lista.

CREATE OR REPLACE FUNCTION public.get_guides_for_source(
  p_source_type text,
  p_source_id   uuid
)
RETURNS TABLE (
  guide_id          uuid,
  destination_label text,
  storage_path      text,
  storage_bucket    text,
  content_hash      text,
  template_version  text,
  generated_at      timestamptz,
  generated_by      uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    id,
    destination_label,
    storage_path,
    storage_bucket,
    content_hash,
    template_version,
    generated_at,
    generated_by
  FROM public.inventory_guides
  WHERE source_type = p_source_type
    AND source_id   = p_source_id
    AND status      = 'active'
  ORDER BY destination_label;
$$;

COMMENT ON FUNCTION public.get_guides_for_source IS
  'Devuelve las guías activas de un movimiento logístico. Usado por la UI para obtener storage_path y generar URL firmada sin regenerar PDF.';

SELECT 'OK: inventory_guides + RLS + upsert_inventory_guide + get_guides_for_source creados' AS resultado;
