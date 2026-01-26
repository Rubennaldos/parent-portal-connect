-- ============================================
-- SISTEMA DE FACTURACIÓN ELECTRÓNICA
-- Parent Portal Connect - Lima Café 28
-- ============================================

-- ====================
-- PASO 1: CREAR ROL "CONTADORA"
-- ====================

-- Primero, asegurarnos de que el tipo ENUM incluya 'contadora'
-- Si ya existe, esto dará error pero no afectará la BD
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM (
            'parent',
            'operador_caja',
            'gestor_unidad',
            'supervisor_red',
            'admin_general',
            'superadmin',
            'contadora'
        );
    ELSE
        -- Agregar 'contadora' si no existe
        BEGIN
            ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'contadora';
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'El valor contadora ya existe en user_role';
        END;
    END IF;
END $$;

-- ====================
-- PASO 2: TABLA DE CONFIGURACIÓN NUBEFACT
-- ====================

CREATE TABLE IF NOT EXISTS public.nubefact_config (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE UNIQUE NOT NULL,
    
    -- Datos de la empresa en SUNAT
    ruc text NOT NULL,
    razon_social text NOT NULL,
    direccion_fiscal text NOT NULL,
    ubigeo text, -- Código de 6 dígitos: Dpto-Prov-Dist
    
    -- Configuración Nubefact
    nubefact_token text NOT NULL, -- Token de API (encriptado)
    is_sandbox boolean DEFAULT true, -- true = pruebas, false = producción
    
    -- Series de comprobantes
    serie_boleta text DEFAULT 'B001',
    serie_factura text DEFAULT 'F001',
    serie_nota_credito_boleta text DEFAULT 'BC01',
    serie_nota_credito_factura text DEFAULT 'FC01',
    serie_nota_debito_boleta text DEFAULT 'BD01',
    serie_nota_debito_factura text DEFAULT 'FD01',
    serie_guia_remision text DEFAULT 'T001',
    
    -- Numeración actual (para correlativos)
    current_boleta_number integer DEFAULT 0,
    current_factura_number integer DEFAULT 0,
    current_nc_boleta_number integer DEFAULT 0,
    current_nc_factura_number integer DEFAULT 0,
    current_nd_boleta_number integer DEFAULT 0,
    current_nd_factura_number integer DEFAULT 0,
    current_guia_number integer DEFAULT 0,
    
    -- Logo y personalización
    logo_url text,
    email_envio text, -- Correo para enviar comprobantes
    telefono text,
    website text,
    
    -- Estado
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_nubefact_config_school_id ON public.nubefact_config(school_id);

-- ====================
-- PASO 3: TABLA DE COMPROBANTES (INVOICES)
-- ====================

CREATE TABLE IF NOT EXISTS public.invoices (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relaciones
    school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
    sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL, -- Referencia a venta en POS
    payment_id uuid, -- ID de pago (cuando viene de portal padres o cobranzas)
    cashier_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Tipo y numeración
    invoice_type text NOT NULL CHECK (invoice_type IN ('boleta', 'factura', 'nota_credito', 'nota_debito', 'guia_remision')),
    document_type_code text NOT NULL, -- Código SUNAT: '03' = Boleta, '01' = Factura, '07' = NC, '08' = ND, '09' = Guía
    serie text NOT NULL, -- B001, F001, etc.
    numero integer NOT NULL, -- Correlativo
    full_number text GENERATED ALWAYS AS (serie || '-' || LPAD(numero::text, 8, '0')) STORED, -- B001-00000123
    
    -- Datos del cliente
    client_document_type text CHECK (client_document_type IN ('dni', 'ruc', 'ce', 'pasaporte', '-')), -- '-' para boletas sin documento
    client_document_number text,
    client_name text NOT NULL, -- Nombre o Razón Social
    client_address text, -- Obligatorio para facturas
    client_email text, -- Para enviar PDF
    
    -- Montos (en soles)
    currency text DEFAULT 'PEN' NOT NULL,
    subtotal numeric NOT NULL, -- Base imponible (sin IGV)
    igv_rate numeric DEFAULT 0.18 NOT NULL, -- 18%
    igv_amount numeric NOT NULL, -- Monto de IGV
    discount_amount numeric DEFAULT 0,
    total_amount numeric NOT NULL, -- Total a pagar
    
    -- Items (productos/servicios)
    items jsonb NOT NULL, -- Array de productos con detalle
    
    -- Datos SUNAT y Nubefact
    sunat_status text DEFAULT 'pending' CHECK (sunat_status IN ('pending', 'processing', 'accepted', 'rejected', 'cancelled', 'error')),
    sunat_response_code text, -- Código de respuesta SUNAT
    sunat_response_message text, -- Mensaje de SUNAT
    
    -- IDs externos
    nubefact_id text, -- ID que genera Nubefact
    external_reference text, -- Referencia externa (si aplica)
    
    -- URLs de archivos generados
    pdf_url text, -- URL del PDF generado
    xml_url text, -- URL del XML firmado
    cdr_url text, -- URL de la Constancia de Recepción (CDR)
    
    -- Firma digital y QR
    hash_signature text, -- Hash de firma digital
    qr_code text, -- Código QR en base64
    
    -- Comprobante relacionado (para NC y ND)
    related_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
    cancellation_reason text, -- Motivo de anulación (para NC)
    
    -- Observaciones
    notes text, -- Notas internas
    payment_method text, -- Método de pago: efectivo, tarjeta, yape, etc.
    
    -- Fechas importantes
    emission_date date NOT NULL DEFAULT CURRENT_DATE,
    due_date date, -- Fecha de vencimiento (para facturas a crédito)
    sent_to_sunat_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    
    -- Auditoría
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Constraint único para serie-numero por escuela
    CONSTRAINT unique_invoice_number UNIQUE (school_id, serie, numero)
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_invoices_school_id ON public.invoices(school_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sale_id ON public.invoices(sale_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_document ON public.invoices(client_document_number);
CREATE INDEX IF NOT EXISTS idx_invoices_full_number ON public.invoices(full_number);
CREATE INDEX IF NOT EXISTS idx_invoices_emission_date ON public.invoices(emission_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_sunat_status ON public.invoices(sunat_status);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON public.invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_nubefact_id ON public.invoices(nubefact_id);

-- ====================
-- PASO 4: TABLA DE ITEMS DE COMPROBANTES
-- ====================

CREATE TABLE IF NOT EXISTS public.invoice_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
    
    -- Datos del producto/servicio
    product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, -- Puede ser NULL para items personalizados
    product_code text, -- Código interno del producto
    description text NOT NULL,
    unit_type text DEFAULT 'NIU', -- Código SUNAT: NIU = Unidad, ZZ = Servicio, etc.
    
    -- Cantidades y precios
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL, -- Precio unitario SIN IGV
    subtotal numeric NOT NULL, -- quantity * unit_price
    igv_amount numeric NOT NULL,
    total numeric NOT NULL, -- subtotal + igv
    
    -- Impuestos y descuentos
    discount_percentage numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    
    -- Tipo de operación
    tax_type text DEFAULT 'gravada' CHECK (tax_type IN ('gravada', 'exonerada', 'inafecta', 'gratuita')),
    
    -- Auditoría
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON public.invoice_items(product_id);

-- ====================
-- PASO 5: TABLA DE LOG DE FACTURACIÓN
-- ====================

CREATE TABLE IF NOT EXISTS public.invoicing_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
    
    -- Evento
    event_type text NOT NULL CHECK (event_type IN ('created', 'sent_to_sunat', 'accepted', 'rejected', 'cancelled', 'pdf_generated', 'email_sent', 'error')),
    event_message text,
    
    -- Request y Response (para debugging)
    request_payload jsonb,
    response_payload jsonb,
    
    -- Error details
    error_code text,
    error_message text,
    
    -- Auditoría
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Metadata
    ip_address inet,
    user_agent text
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_invoicing_logs_invoice_id ON public.invoicing_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoicing_logs_event_type ON public.invoicing_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_invoicing_logs_created_at ON public.invoicing_logs(created_at DESC);

-- ====================
-- PASO 6: TRIGGER PARA UPDATED_AT
-- ====================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a tablas
DROP TRIGGER IF EXISTS set_nubefact_config_updated_at ON public.nubefact_config;
CREATE TRIGGER set_nubefact_config_updated_at
    BEFORE UPDATE ON public.nubefact_config
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_invoices_updated_at ON public.invoices;
CREATE TRIGGER set_invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ====================
-- PASO 7: RLS (Row Level Security)
-- ====================

-- Habilitar RLS
ALTER TABLE public.nubefact_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoicing_logs ENABLE ROW LEVEL SECURITY;

-- Políticas para nubefact_config
DROP POLICY IF EXISTS "allow_admin_read_nubefact_config" ON public.nubefact_config;
CREATE POLICY "allow_admin_read_nubefact_config"
ON public.nubefact_config FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad', 'contadora')
    )
);

DROP POLICY IF EXISTS "allow_admin_manage_nubefact_config" ON public.nubefact_config;
CREATE POLICY "allow_admin_manage_nubefact_config"
ON public.nubefact_config FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin')
    )
);

-- Políticas para invoices
DROP POLICY IF EXISTS "allow_staff_read_invoices" ON public.invoices;
CREATE POLICY "allow_staff_read_invoices"
ON public.invoices FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (
            profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'contadora')
            OR (profiles.role IN ('gestor_unidad', 'operador_caja') AND profiles.school_id = invoices.school_id)
        )
    )
);

DROP POLICY IF EXISTS "allow_staff_create_invoices" ON public.invoices;
CREATE POLICY "allow_staff_create_invoices"
ON public.invoices FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad', 'operador_caja')
        AND (profiles.school_id = invoices.school_id OR profiles.role IN ('admin_general', 'superadmin'))
    )
);

DROP POLICY IF EXISTS "allow_staff_update_invoices" ON public.invoices;
CREATE POLICY "allow_staff_update_invoices"
ON public.invoices FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (
            profiles.role IN ('admin_general', 'superadmin')
            OR (profiles.role = 'gestor_unidad' AND profiles.school_id = invoices.school_id)
        )
    )
);

-- Políticas para invoice_items
DROP POLICY IF EXISTS "allow_read_invoice_items" ON public.invoice_items;
CREATE POLICY "allow_read_invoice_items"
ON public.invoice_items FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.invoices
        WHERE invoices.id = invoice_items.invoice_id
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND (
                profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'contadora')
                OR (profiles.role IN ('gestor_unidad', 'operador_caja') AND profiles.school_id = invoices.school_id)
            )
        )
    )
);

-- Políticas para invoicing_logs
DROP POLICY IF EXISTS "allow_admin_read_logs" ON public.invoicing_logs;
CREATE POLICY "allow_admin_read_logs"
ON public.invoicing_logs FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin', 'contadora')
    )
);

-- ====================
-- PASO 8: COMENTARIOS EN TABLAS
-- ====================

COMMENT ON TABLE public.nubefact_config IS 'Configuración de facturación electrónica por sede (Nubefact)';
COMMENT ON TABLE public.invoices IS 'Comprobantes electrónicos emitidos (boletas, facturas, NC, ND, guías)';
COMMENT ON TABLE public.invoice_items IS 'Detalle de productos/servicios en comprobantes';
COMMENT ON TABLE public.invoicing_logs IS 'Log de eventos de facturación para auditoría';

-- ====================
-- FIN DEL SCRIPT
-- ====================

-- Verificar que todo se creó correctamente
SELECT 
    'nubefact_config' as tabla,
    COUNT(*) as registros
FROM public.nubefact_config
UNION ALL
SELECT 
    'invoices' as tabla,
    COUNT(*) as registros
FROM public.invoices
UNION ALL
SELECT 
    'invoice_items' as tabla,
    COUNT(*) as registros
FROM public.invoice_items
UNION ALL
SELECT 
    'invoicing_logs' as tabla,
    COUNT(*) as registros
FROM public.invoicing_logs;

-- Mostrar roles disponibles
SELECT unnest(enum_range(NULL::user_role)) as roles_disponibles;
