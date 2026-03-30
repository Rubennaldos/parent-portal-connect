-- =============================================================
-- MIGRACIÓN: TABLAS BASE DE FACTURACIÓN ELECTRÓNICA (v2)
-- Fecha: 2026-03-29  |  Fix: compatible con tabla invoices preexistente
--
-- PROBLEMA ANTERIOR:
--   La tabla invoices ya existía (creada por SETUP_FACTURACION_ELECTRONICA.sql)
--   con columna 'sale_id'. El CREATE TABLE IF NOT EXISTS la dejó intacta
--   y el índice falló porque 'transaction_id' no existía en esa versión.
--
-- SOLUCIÓN:
--   1. CREATE TABLE IF NOT EXISTS  →  crea la tabla si no existe.
--   2. ALTER TABLE ADD COLUMN IF NOT EXISTS →  agrega columnas faltantes
--      en cualquier versión de la tabla (nueva o preexistente).
--   3. Índices y trigger al final, siempre con IF NOT EXISTS.
-- =============================================================

-- =============================================================
-- PASO 1A: Crear tabla invoices (solo si NO existe)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.invoices (
    id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id              uuid         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    transaction_id         uuid         REFERENCES public.transactions(id) ON DELETE SET NULL,
    document_type_code     varchar(2)   NOT NULL DEFAULT '03',
    serie                  varchar(10)  NOT NULL,
    numero                 integer      NOT NULL,
    full_number            varchar(20)  GENERATED ALWAYS AS (
                               serie || '-' || LPAD(numero::text, 8, '0')
                           ) STORED,
    client_name            text         NOT NULL DEFAULT 'Consumidor Final',
    client_document_type   varchar(20)  DEFAULT '-',
    client_document_number varchar(15),
    client_address         text,
    client_email           text,
    subtotal               numeric(10,2) NOT NULL DEFAULT 0,
    igv_amount             numeric(10,2) NOT NULL DEFAULT 0,
    total_amount           numeric(10,2) NOT NULL DEFAULT 0,
    sunat_status           varchar(20)  NOT NULL DEFAULT 'pending',
    pdf_url                text,
    xml_url                text,
    cdr_url                text,
    nubefact_id            text,
    nubefact_response      jsonb,
    is_demo                boolean      NOT NULL DEFAULT true,
    created_by             uuid         REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at             timestamptz  NOT NULL DEFAULT now(),
    updated_at             timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_invoice_serie_numero UNIQUE (school_id, serie, numero)
);

-- =============================================================
-- PASO 1B: Agregar columnas FALTANTES en caso de tabla preexistente
--   Si la tabla fue recién creada, todos estos ADD COLUMN son no-op.
--   Si la tabla ya existía con esquema viejo, agregan lo que falta.
-- =============================================================

-- Vínculo con la venta del POS (la tabla vieja tenía 'sale_id')
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

-- Respuesta RAW de Nubefact (para diagnóstico)
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS nubefact_response jsonb;

-- Flag de modo demo (no enviado a SUNAT real)
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT true;

-- Columnas de montos (por si la tabla vieja las tiene con otro nombre/tipo)
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS subtotal   numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS igv_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS total_amount numeric(10,2) NOT NULL DEFAULT 0;

-- Estado SUNAT con default correcto
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS sunat_status varchar(20) NOT NULL DEFAULT 'pending';

-- URLs de documentos
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_url  text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS xml_url  text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cdr_url  text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS nubefact_id text;

-- updated_at para el trigger
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- created_by (auditoría)
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- =============================================================
-- PASO 1C: Índices (con IF NOT EXISTS, seguros en cualquier caso)
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_invoices_school_id      ON public.invoices (school_id);
CREATE INDEX IF NOT EXISTS idx_invoices_transaction_id ON public.invoices (transaction_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sunat_status   ON public.invoices (sunat_status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at     ON public.invoices (created_at DESC);

-- =============================================================
-- PASO 1D: Trigger updated_at
-- =============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at_invoices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_invoices();

-- =============================================================
-- PASO 1E: Row Level Security
-- =============================================================

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_read_staff"   ON public.invoices;
CREATE POLICY "invoices_read_staff" ON public.invoices
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (
                  p.role IN ('superadmin', 'admin_general')
                  OR (p.school_id = invoices.school_id
                      AND p.role IN ('gestor_unidad', 'operador_caja', 'contadora'))
              )
        )
    );

DROP POLICY IF EXISTS "invoices_insert_staff" ON public.invoices;
CREATE POLICY "invoices_insert_staff" ON public.invoices
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (
                  p.role IN ('superadmin', 'admin_general')
                  OR (p.school_id = invoices.school_id
                      AND p.role IN ('gestor_unidad', 'operador_caja'))
              )
        )
    );

DROP POLICY IF EXISTS "invoices_update_staff" ON public.invoices;
CREATE POLICY "invoices_update_staff" ON public.invoices
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('superadmin', 'admin_general', 'gestor_unidad', 'contadora')
        )
    );

-- =============================================================
-- PASO 2: COLUMNAS NUEVAS EN transactions
-- Permiten que el POS registre el tipo de comprobante y los datos
-- del cliente sin romper nada existente.
-- =============================================================

-- Tipo de comprobante elegido en caja
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS document_type varchar(10) DEFAULT 'ticket';

-- Agregar el CHECK solo si la columna es nueva (no falla si ya existe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'transactions_document_type_check'
    ) THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_document_type_check
            CHECK (document_type IN ('ticket', 'boleta', 'factura'));
    END IF;
END$$;

-- Nombre del cliente (para boleta/factura)
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS invoice_client_name text;

-- Número de documento del cliente (DNI para boleta, RUC para factura)
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS invoice_client_dni_ruc varchar(15);

-- FK hacia el comprobante emitido (se llena DESPUÉS de generar en Nubefact)
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id    ON public.transactions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_transactions_document_type ON public.transactions (document_type);

-- Documentación
COMMENT ON COLUMN public.transactions.document_type
    IS 'Tipo de comprobante elegido en el POS: ticket (sin fiscal), boleta (DNI), factura (RUC)';
COMMENT ON COLUMN public.transactions.invoice_client_name
    IS 'Nombre o razón social del cliente para el comprobante';
COMMENT ON COLUMN public.transactions.invoice_client_dni_ruc
    IS 'DNI (8 dígitos) para boleta o RUC (11 dígitos) para factura';
COMMENT ON COLUMN public.transactions.invoice_id
    IS 'UUID del comprobante en tabla invoices. NULL = aún no facturado';

-- =============================================================
-- VERIFICACIÓN FINAL
-- Ejecuta las siguientes queries para confirmar que todo está bien:
-- =============================================================

-- 1. Ver columnas nuevas en invoices:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'invoices'
--   AND column_name IN ('transaction_id','nubefact_response','is_demo','sunat_status')
-- ORDER BY column_name;

-- 2. Ver columnas nuevas en transactions:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'transactions'
--   AND column_name IN ('document_type','invoice_client_name','invoice_client_dni_ruc','invoice_id')
-- ORDER BY column_name;
