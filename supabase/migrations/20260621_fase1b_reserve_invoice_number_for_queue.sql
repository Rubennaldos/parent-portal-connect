-- ============================================================================
-- FASE 1B — RESERVA IDEMPOTENTE DE CORRELATIVO POR FILA DE COLA
-- Proyecto: Lima Café 28  ·  Fecha: 2026-06-21
-- ============================================================================
--
-- QUÉ HACE (en simple):
--   Crea UNA función que le "aparta" un número de boleta a un trabajo de la
--   cola (billing_queue) y lo GUARDA en la propia fila. Si el trabajo se
--   reintenta (timeout, corte de red), la función devuelve EL MISMO número
--   que ya tenía apartado, en lugar de pedir uno nuevo. Esa es la garantía
--   central de "cero huecos" de la SUNAT.
--
-- POR QUÉ ES SEGURO (no rompe nada):
--   · Es una función NUEVA. Ningún flujo actual la llama todavía (modo sombra).
--   · NO modifica get_next_invoice_numero, ni invoice_sequences, ni la función
--     anti-zombie, ni fn_build_billing_payload (los flujos vivos quedan intactos).
--   · Usa FOR UPDATE sobre la fila → dos workers nunca reservan a la vez.
--   · Es IDEMPOTENTE: llamarla dos veces sobre la misma fila devuelve el mismo
--     número. No consume correlativos extra.
--
-- DEPENDE DE: la migración 20260621_fase1a (columnas reserved_serie/numero/at).
--   Aplicar 1A ANTES que esta.
--
-- ALCANCE: boleta y factura (el 99% del volumen). Las notas de crédito
--   (credit_note) NO se reservan aquí; siguen el camino actual de
--   generate-document (bajo volumen, gestión manual). Documentado a propósito.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_invoice_number_for_queue(
  p_queue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.billing_queue;
  v_serie  text;
  v_numero int;
  v_sb     text;   -- serie_boleta
  v_sf     text;   -- serie_factura
BEGIN
  -- ── 1. Bloquear la fila (anti-carrera entre workers) ──────────────────────
  SELECT * INTO v_row
  FROM   public.billing_queue
  WHERE  id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'QUEUE_NOT_FOUND', 'queue_id', p_queue_id);
  END IF;

  -- ── 2. IDEMPOTENCIA: si ya hay número reservado, devolver EL MISMO ─────────
  -- Este es el corazón del protocolo de cero huecos: un reintento NUNCA pide
  -- un número nuevo. Reutiliza el que quedó comprometido con esta fila.
  IF v_row.reserved_numero IS NOT NULL AND v_row.reserved_serie IS NOT NULL THEN
    RETURN jsonb_build_object(
      'serie',  v_row.reserved_serie,
      'numero', v_row.reserved_numero,
      'reused', true
    );
  END IF;

  -- ── 3. Resolver la serie desde billing_config según el tipo ───────────────
  SELECT serie_boleta, serie_factura
  INTO   v_sb, v_sf
  FROM   public.billing_config
  WHERE  school_id = v_row.school_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error',     'NO_BILLING_CONFIG',
      'detail',    'Sin billing_config para school_id=' || COALESCE(v_row.school_id::text, 'NULL'),
      'queue_id',  p_queue_id
    );
  END IF;

  v_serie := CASE
               WHEN v_row.invoice_type = 'factura' THEN v_sf
               ELSE v_sb   -- boleta por defecto
             END;

  IF v_serie IS NULL OR btrim(v_serie) = '' THEN
    RETURN jsonb_build_object(
      'error',    'NO_SERIE_CONFIGURED',
      'detail',   'Serie no configurada para invoice_type=' || COALESCE(v_row.invoice_type, 'NULL'),
      'queue_id', p_queue_id
    );
  END IF;

  -- ── 4. Reservar número atómico (reutiliza la función ya existente) ─────────
  -- get_next_invoice_numero usa INSERT...ON CONFLICT DO UPDATE RETURNING:
  -- imposible que dos llamadas concurrentes reciban el mismo número.
  v_numero := public.get_next_invoice_numero(v_row.school_id, v_serie);

  IF v_numero IS NULL THEN
    RETURN jsonb_build_object(
      'error',    'SEQUENCE_NULL',
      'detail',   'get_next_invoice_numero devolvió NULL para serie=' || v_serie,
      'queue_id', p_queue_id
    );
  END IF;

  -- ── 5. PERSISTIR la reserva en la fila ANTES de cualquier llamada de red ───
  -- Si el worker muere tras esto, el número queda comprometido con la fila.
  -- El próximo reintento entra por la rama del paso 2 y reutiliza el número.
  UPDATE public.billing_queue
  SET    reserved_serie  = v_serie,
         reserved_numero = v_numero,
         reserved_at     = now()
  WHERE  id = p_queue_id;

  RETURN jsonb_build_object(
    'serie',  v_serie,
    'numero', v_numero,
    'reused', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_invoice_number_for_queue(uuid) TO service_role;

COMMENT ON FUNCTION public.reserve_invoice_number_for_queue(uuid) IS
  'Aparta (o reutiliza) el correlativo de una fila de billing_queue y lo persiste '
  'en reserved_serie/reserved_numero. Idempotente: un reintento reutiliza el mismo '
  'número (garantía de cero huecos SUNAT). FOR UPDATE anti-carrera. Solo service_role.';

COMMIT;

-- ============================================================================
-- FUNCIONES DE APOYO PARA EL WORKER (también aditivas, sin dependencias nuevas)
-- ============================================================================

BEGIN;

-- Devuelve la fecha hoy en hora Lima como TEXT 'YYYY-MM-DD'.
-- El worker la llama para obtener emission_date desde PostgreSQL (Regla 11.C:
-- reloj único de BD; prohibido usar new Date() con offset manual en JS).
CREATE OR REPLACE FUNCTION public.get_lima_date_today()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_char(
    timezone('America/Lima', now()),
    'YYYY-MM-DD'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_lima_date_today() TO service_role;

COMMENT ON FUNCTION public.get_lima_date_today() IS
  'Devuelve la fecha actual en hora Lima (America/Lima = UTC-5 permanente) '
  'como TEXT YYYY-MM-DD. Usar en el worker para emission_date; '
  'prohibido calcular esto con offset manual en TypeScript.';

-- Devuelve los días transcurridos entre la fecha Lima de la venta original y
-- la fecha Lima actual. El worker lo llama en el momento de emitir para
-- detectar documentos extemporáneos (> 7 días → SUNAT los rechaza).
-- La venta se toma de billing_queue.created_at como proxy de la fecha de venta.
CREATE OR REPLACE FUNCTION public.get_days_since_queue_sale(p_queue_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    (timezone('America/Lima', now())::date
     - timezone('America/Lima', created_at)::date)
  )
  FROM public.billing_queue
  WHERE id = p_queue_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_days_since_queue_sale(uuid) TO service_role;

COMMENT ON FUNCTION public.get_days_since_queue_sale(uuid) IS
  'Devuelve los días calendario entre la creación del job y hoy (hora Lima). '
  'Si supera 7, el documento es extemporáneo y SUNAT lo rechaza. '
  'El worker lo verifica justo antes de llamar a Nubefact.';

COMMIT;
