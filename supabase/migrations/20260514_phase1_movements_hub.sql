-- ============================================================
-- FASE 1 — Hub Gestión de Movimientos (Ingresos y Salidas)
-- ============================================================
-- Cambios ADITIVOS — no rompe nada existente:
--   1. Correlativo TR-XXX en internal_transfers (+ backfill de existentes)
--   2. Campos de responsabilidad: contact_person, contact_phone, approved_by
--   3. Recrear create_internal_transfer con nuevos campos (compatible hacia atrás)
--   4. purchase_entries.school_id nullable (entrada multisede)
--   5. Tabla purchase_distribution_items (desglose por sede de entrada multisede)
--   6. RPC bulk_distribute_purchase (entrada con proveedor + evidencia + distribución)
--   7. Bucket logistic_documents + políticas RLS de storage
-- ============================================================

-- ── 1. Correlativo automático en internal_transfers ──────────────────────────

CREATE SEQUENCE IF NOT EXISTS seq_transfer_number START 1;

ALTER TABLE internal_transfers
  ADD COLUMN IF NOT EXISTS transfer_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS contact_person  text,
  ADD COLUMN IF NOT EXISTS contact_phone   text,
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN internal_transfers.transfer_number IS
  'Correlativo único de guía de traslado (TR-001, TR-002...). Trazabilidad contable.';
COMMENT ON COLUMN internal_transfers.contact_person IS
  'Persona responsable del traslado físico (encargado que firma)';
COMMENT ON COLUMN internal_transfers.contact_phone IS
  'Teléfono o WhatsApp del responsable del traslado';
COMMENT ON COLUMN internal_transfers.approved_by IS
  'UUID del usuario que aprobó este traslado';

CREATE OR REPLACE FUNCTION fn_assign_transfer_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transfer_number IS NULL THEN
    NEW.transfer_number := 'TR-' || LPAD(nextval('seq_transfer_number')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_transfer_number ON internal_transfers;
CREATE TRIGGER trg_assign_transfer_number
  BEFORE INSERT ON internal_transfers
  FOR EACH ROW
  EXECUTE FUNCTION fn_assign_transfer_number();

-- Backfill de registros existentes (sin correlativo aún)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM internal_transfers
    WHERE  transfer_number IS NULL
    ORDER  BY created_at
  LOOP
    UPDATE internal_transfers
    SET    transfer_number = 'TR-' || LPAD(nextval('seq_transfer_number')::text, 3, '0')
    WHERE  id = r.id;
  END LOOP;
END;
$$;

SELECT 'OK: correlativo TR-XXX + campos responsabilidad en internal_transfers' AS resultado;

-- ── 2. Recrear create_internal_transfer con nuevos campos ────────────────────
-- Firma nueva (compatible hacia atrás: nuevos params tienen DEFAULT NULL)
-- El frontend existente (InternalTransfersTab) sigue funcionando sin cambios.

DROP FUNCTION IF EXISTS create_internal_transfer(uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION create_internal_transfer(
  p_from_school_id uuid,
  p_to_school_id   uuid,
  p_items          jsonb,
  p_notes          text DEFAULT NULL,
  p_contact_person text DEFAULT NULL,
  p_contact_phone  text DEFAULT NULL,
  p_approved_by    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid;
  v_transfer_id  uuid;
  v_transfer_num text;
  v_item         jsonb;
  v_product_id   uuid;
  v_quantity     integer;
  v_stock_before integer;
  v_stock_after  integer;
  v_dest_before  integer;
  v_dest_after   integer;
  v_product_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = p_from_school_id) THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: sede origen no existe (%).',  p_from_school_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = p_to_school_id) THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: sede destino no existe (%).', p_to_school_id;
  END IF;

  IF p_from_school_id = p_to_school_id THEN
    RAISE EXCEPTION 'INVALID_TRANSFER: origen y destino no pueden ser la misma sede';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'INVALID_TRANSFER: debe incluir al menos un producto';
  END IF;

  -- Bloquear filas de origen en orden determinista (evita deadlocks)
  PERFORM ps.product_id
  FROM product_stock ps
  WHERE ps.school_id = p_from_school_id
    AND ps.product_id = ANY (
      ARRAY(
        SELECT (elem->>'product_id')::uuid
        FROM jsonb_array_elements(p_items) elem
      )
    )
  ORDER BY ps.product_id
  FOR UPDATE OF ps;

  -- Validar stock disponible en origen
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
    END IF;

    SELECT ps.current_stock, p.name
    INTO   v_stock_before, v_product_name
    FROM   product_stock ps
    JOIN   products p ON p.id = ps.product_id
    WHERE  ps.product_id = v_product_id
      AND  ps.school_id  = p_from_school_id;

    IF NOT FOUND THEN
      SELECT name INTO v_product_name FROM products WHERE id = v_product_id;
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: "%" no tiene stock registrado en la sede de origen', v_product_name;
    END IF;

    IF v_stock_before < v_quantity THEN
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK: Stock insuficiente para "%". Disponible: %, Solicitado: %',
        v_product_name, v_stock_before, v_quantity;
    END IF;
  END LOOP;

  -- Crear cabecera (transfer_number lo asigna el trigger trg_assign_transfer_number)
  INSERT INTO internal_transfers (
    from_school_id, to_school_id,
    notes, created_by,
    contact_person, contact_phone, approved_by
  )
  VALUES (
    p_from_school_id, p_to_school_id,
    p_notes, v_caller_id,
    p_contact_person, p_contact_phone, p_approved_by
  )
  RETURNING id, transfer_number
  INTO v_transfer_id, v_transfer_num;

  -- Suprimir trigger genérico en product_stock (Kardex propio más abajo)
  PERFORM set_config('app.kardex_source', 'transfer_rpc', true);

  -- Procesar cada ítem: doble asiento atómico (origen↓, destino↑)
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    SELECT ps.current_stock, p.name
    INTO   v_stock_before, v_product_name
    FROM   product_stock ps
    JOIN   products p ON p.id = ps.product_id
    WHERE  ps.product_id = v_product_id AND ps.school_id = p_from_school_id;

    SELECT COALESCE(current_stock, 0)
    INTO   v_dest_before
    FROM   product_stock
    WHERE  product_id = v_product_id AND school_id = p_to_school_id;

    v_stock_after := v_stock_before - v_quantity;
    v_dest_after  := COALESCE(v_dest_before, 0) + v_quantity;

    -- Descontar en origen
    UPDATE product_stock
    SET    current_stock = current_stock - v_quantity,
           last_updated  = clock_timestamp()
    WHERE  product_id = v_product_id
      AND  school_id  = p_from_school_id;

    -- Sumar en destino (upsert)
    INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
    VALUES (v_product_id, p_to_school_id, v_quantity, true, clock_timestamp())
    ON CONFLICT (product_id, school_id)
    DO UPDATE SET
      current_stock = product_stock.current_stock + v_quantity,
      last_updated  = clock_timestamp();

    -- Detalle del traslado
    INSERT INTO internal_transfer_items (transfer_id, product_id, quantity)
    VALUES (v_transfer_id, v_product_id, v_quantity);

    -- Kardex: salida de origen
    INSERT INTO pos_stock_movements (
      product_id, school_id,
      movement_type, quantity_delta,
      stock_before,  stock_after,
      reference_id,  created_by,
      created_at,    reason
    ) VALUES (
      v_product_id, p_from_school_id,
      'transfer_out', -v_quantity,
      v_stock_before, v_stock_after,
      v_transfer_id, v_caller_id,
      clock_timestamp(),
      format('Guía %s → sede destino', v_transfer_num)
    );

    -- Kardex: entrada a destino
    INSERT INTO pos_stock_movements (
      product_id, school_id,
      movement_type, quantity_delta,
      stock_before,  stock_after,
      reference_id,  created_by,
      created_at,    reason
    ) VALUES (
      v_product_id, p_to_school_id,
      'transfer_in', v_quantity,
      COALESCE(v_dest_before, 0), v_dest_after,
      v_transfer_id, v_caller_id,
      clock_timestamp(),
      format('Guía %s desde sede origen', v_transfer_num)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok',              true,
    'transfer_id',     v_transfer_id,
    'transfer_number', v_transfer_num
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_internal_transfer(uuid, uuid, jsonb, text, text, text, uuid)
  TO authenticated, service_role;

SELECT 'OK: create_internal_transfer actualizado con correlativo y campos de responsabilidad' AS resultado;

-- ── 3. purchase_entries.school_id nullable (entrada multisede) ───────────────
-- NULL = entrada multisede. El desglose por sede está en purchase_distribution_items.
-- Las entradas existentes (por sede) no se ven afectadas.

ALTER TABLE purchase_entries
  ALTER COLUMN school_id DROP NOT NULL;

COMMENT ON COLUMN purchase_entries.school_id IS
  'NULL indica entrada multisede (distribución). Ver purchase_distribution_items para el desglose.';

SELECT 'OK: purchase_entries.school_id ahora nullable para entradas multisede' AS resultado;

-- ── 4. Tabla purchase_distribution_items ─────────────────────────────────────
-- Desglose por sede de una entrada multisede. Solo se usa en entradas con school_id=NULL.
-- Aditiva: no altera ninguna tabla ni lógica existente.

CREATE TABLE IF NOT EXISTS purchase_distribution_items (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id    uuid        NOT NULL REFERENCES purchase_entries(id)  ON DELETE CASCADE,
  product_id  uuid        NOT NULL REFERENCES products(id)          ON DELETE RESTRICT,
  school_id   uuid        NOT NULL REFERENCES schools(id)           ON DELETE RESTRICT,
  quantity    integer     NOT NULL CHECK (quantity > 0),
  unit_cost   numeric     NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  uom_id      uuid        REFERENCES product_packaging(id)          ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_pdi_entry   ON purchase_distribution_items (entry_id);
CREATE INDEX IF NOT EXISTS idx_pdi_product ON purchase_distribution_items (product_id);
CREATE INDEX IF NOT EXISTS idx_pdi_school  ON purchase_distribution_items (school_id);

ALTER TABLE purchase_distribution_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdi_read_admin_only"  ON purchase_distribution_items;
DROP POLICY IF EXISTS "pdi_write_admin_only" ON purchase_distribution_items;

CREATE POLICY "pdi_read_admin_only" ON purchase_distribution_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE POLICY "pdi_write_admin_only" ON purchase_distribution_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

SELECT 'OK: purchase_distribution_items creada con RLS admin_general' AS resultado;

-- ── 5. RPC bulk_distribute_purchase ──────────────────────────────────────────
-- Entrada de proveedor multisede en UNA sola transacción atómica.
--
-- Muralla backend (RAISE EXCEPTION antes del primer INSERT):
--   a) supplier_id obligatorio
--   b) evidence_url obligatorio (sin foto/PDF = bloqueado)
--   c) doc_type válido (boleta/factura/guia)
--   d) Al menos un producto
--   e) Por cada producto: SUM(distribución[].quantity) == total_quantity
--   f) Cantidades siempre > 0
--
-- Efecto en una transacción:
--   1. INSERT purchase_entries  (school_id=NULL → multisede)
--   2. INSERT purchase_entry_items  (total por producto, para resumen de factura)
--   3. INSERT purchase_distribution_items  (detalle por producto+sede)
--   4. increment_product_stock  por cada (product, school)  → Kardex automático
--
-- p_items: [{
--   product_id:    uuid,
--   total_quantity: integer,   ← total recibido en unidades BASE
--   unit_cost:     numeric,
--   distribution: [{ school_id: uuid, quantity: integer }]
-- }]

DROP FUNCTION IF EXISTS bulk_distribute_purchase(uuid, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION bulk_distribute_purchase(
  p_supplier_id  uuid,
  p_doc_type     text,
  p_doc_number   text,
  p_evidence_url text,
  p_notes        text  DEFAULT NULL,
  p_items        jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id     uuid;
  v_total_amount numeric := 0;
  v_item         jsonb;
  v_dist         jsonb;
  v_product_id   uuid;
  v_total_qty    integer;
  v_unit_cost    numeric;
  v_dist_qty     integer;
  v_school_id    uuid;
  v_sum_dist     integer;
  v_product_name text;
BEGIN
  -- ── Muralla: validaciones de cabecera ─────────────────────────────────────
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: supplier_id es obligatorio. No se puede registrar una entrada sin proveedor.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = p_supplier_id) THEN
    RAISE EXCEPTION 'VALIDATION: El proveedor seleccionado no existe.';
  END IF;

  IF p_evidence_url IS NULL OR trim(p_evidence_url) = '' THEN
    RAISE EXCEPTION 'VALIDATION: evidence_url es obligatorio. Sube la foto o PDF del comprobante antes de continuar.';
  END IF;

  IF p_doc_type NOT IN ('boleta', 'factura', 'guia') THEN
    RAISE EXCEPTION 'VALIDATION: doc_type debe ser boleta, factura o guia. Recibido: %', p_doc_type;
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debe incluir al menos un producto en la entrada.';
  END IF;

  -- ── Muralla: validar distribución por cada producto ────────────────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_total_qty  := (v_item->>'total_quantity')::integer;

    IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: total_quantity debe ser mayor a 0 para cada producto.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto % no existe en el sistema.', v_product_id;
    END IF;

    IF jsonb_array_length(COALESCE(v_item->'distribution', '[]'::jsonb)) = 0 THEN
      SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
      RAISE EXCEPTION
        'VALIDATION: El producto "%" no tiene distribución por sede. Indica cuántas unidades van a cada sede.',
        COALESCE(v_product_name, v_product_id::text);
    END IF;

    -- Verificar que la suma de la distribución cuadra con el total
    SELECT COALESCE(SUM((d->>'quantity')::integer), 0)
    INTO   v_sum_dist
    FROM   jsonb_array_elements(v_item->'distribution') d;

    IF v_sum_dist <> v_total_qty THEN
      SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
      RAISE EXCEPTION
        'DISTRIBUCION_INVALIDA: La suma de sedes (%) no coincide con el total (%) para "%". Ajusta la distribución antes de confirmar.',
        v_sum_dist, v_total_qty, COALESCE(v_product_name, v_product_id::text);
    END IF;

    -- Verificar cantidades individuales positivas
    FOR v_dist IN SELECT value FROM jsonb_array_elements(v_item->'distribution') AS value
    LOOP
      IF (v_dist->>'quantity')::integer <= 0 THEN
        RAISE EXCEPTION 'VALIDATION: Cada cantidad por sede debe ser mayor a 0.';
      END IF;
    END LOOP;

    -- Acumular total de la factura (solo para el header)
    v_total_amount := v_total_amount +
      (COALESCE((v_item->>'unit_cost')::numeric, 0) * v_total_qty);
  END LOOP;

  -- ── Insertar cabecera de la entrada (school_id = NULL → multisede) ─────────
  INSERT INTO purchase_entries (
    supplier_id,   doc_type,     doc_number,
    total_amount,  notes,        evidence_url,
    school_id,     user_id,      created_at
  )
  VALUES (
    p_supplier_id, p_doc_type,   p_doc_number,
    v_total_amount, p_notes,     p_evidence_url,
    NULL,           auth.uid(),  clock_timestamp()
  )
  RETURNING id INTO v_entry_id;

  -- ── Procesar cada producto ─────────────────────────────────────────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_total_qty  := (v_item->>'total_quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);

    -- Total del producto en purchase_entry_items (resumen de la factura)
    INSERT INTO purchase_entry_items (
      entry_id, product_id, quantity, unit_cost
    )
    VALUES (
      v_entry_id, v_product_id, v_total_qty, v_unit_cost
    );

    -- Distribución por sede
    FOR v_dist IN SELECT value FROM jsonb_array_elements(v_item->'distribution') AS value
    LOOP
      v_school_id := (v_dist->>'school_id')::uuid;
      v_dist_qty  := (v_dist->>'quantity')::integer;

      -- Registro auditable de la distribución
      INSERT INTO purchase_distribution_items (
        entry_id, product_id, school_id, quantity, unit_cost
      )
      VALUES (
        v_entry_id, v_product_id, v_school_id, v_dist_qty, v_unit_cost
      );

      -- Incrementar stock en esa sede + Kardex automático vía increment_product_stock
      PERFORM increment_product_stock(
        v_product_id,
        v_school_id,
        v_dist_qty,
        v_entry_id,
        format('Entrada multisede %s %s',
          p_doc_type, COALESCE(p_doc_number, '(sin número)')),
        NULL  -- cantidades siempre en unidades base en distribución multisede
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',       true,
    'entry_id', v_entry_id,
    'total',    v_total_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_distribute_purchase(uuid, text, text, text, text, jsonb)
  TO authenticated, service_role;

SELECT 'OK: bulk_distribute_purchase creada — entrada multisede atómica con muralla de distribución' AS resultado;

-- ── 6. Storage: bucket logistic_documents + políticas RLS ────────────────────
-- Crea el bucket (privado) si no existe, y aplica las políticas de acceso.
-- Solo admin_general puede subir y leer documentos de logística.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logistic_documents',
  'logistic_documents',
  false,
  10485760,  -- 10 MB máximo por archivo
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "logistic_docs_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "logistic_docs_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "logistic_docs_delete_admin" ON storage.objects;

CREATE POLICY "logistic_docs_select_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'logistic_documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE POLICY "logistic_docs_insert_admin"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'logistic_documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE POLICY "logistic_docs_delete_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'logistic_documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

SELECT 'OK: bucket logistic_documents creado con RLS admin_general' AS resultado;

SELECT '✅ FASE 1 MOVEMENTS HUB: migración completada exitosamente' AS resultado;
