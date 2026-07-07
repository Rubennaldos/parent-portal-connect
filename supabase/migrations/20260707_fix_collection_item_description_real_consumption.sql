-- ============================================================================
-- FIX: Boletas de cobro de deuda mostraban "Cobro deuda - Alumno" en vez del
--      consumo real (almuerzo, servicio cafetería, etc.)
-- Fecha: 2026-07-07
--
-- ── QUÉ PROBLEMA RESUELVE (en simple) ──────────────────────────────────────
-- Cuando se cobra una deuda con boleta/factura (Cobranzas o aprobación de
-- voucher del padre), la función enqueue_billing_emission_v2 (job_type =
-- 'collection') armaba SIEMPRE una sola línea con el texto fijo "Cobro deuda"
-- (o el texto que mande el frontend, ej. "Pago deuda - Alumno"), sin importar
-- cuánto dinero fuera ni cuántas compras distintas incluyera.
--
-- Confirmado con datos reales de producción (2026-06-25 a 2026-07-06):
--   TODAS las boletas de cobro de deuda de las últimas 2 semanas, sin
--   excepción, mostraban únicamente "Cobro deuda - <nombre del alumno>",
--   incluso una de S/ 955.50 que agrupaba varias semanas de consumo.
--
-- La información real de qué se compró YA estaba guardada en
-- transactions.description (ej. "Compra POS (Crédito) - S/ 6.50") o se podía
-- reconstruir para almuerzos vía metadata->>'lunch_order_id'. Esa información
-- se ignoraba al armar la boleta.
--
-- ── LA SOLUCIÓN ─────────────────────────────────────────────────────────────
-- En la rama 'collection' de enqueue_billing_emission_v2:
--   · Antes: 1 ítem combinado con texto genérico.
--   · Ahora: 1 ítem POR CADA transacción de deuda incluida, con su
--     descripción real:
--       - Si es un almuerzo (metadata->>'lunch_order_id' presente):
--         "Almuerzo - <alumno> - <fecha>"
--       - Si no, se usa transactions.description tal cual quedó guardada
--         al momento de la compra (ej. "Compra POS (Crédito) - S/ 6.50").
--       - Si no hay descripción guardada: "Servicio cafetería - <alumno> -
--         <fecha>" (mismo texto de respaldo que ya usa fn_build_billing_payload
--         para vouchers, por consistencia).
--
-- El monto total y el IGV de la boleta NO cambian ni un céntimo: se sigue
-- calculando exactamente igual que antes (SUM(ABS(t.amount)) de las mismas
-- transacciones). Lo único que cambia es CÓMO se reparte ese mismo total
-- entre las líneas del comprobante. Se usa la misma técnica de "aritmética
-- de céntimos con el último ítem absorbiendo el residuo de redondeo" que ya
-- está probada en producción en la rama pos_sale de esta misma función
-- (Fase 2A, sin incidentes reportados).
--
-- ── QUÉ NO CAMBIA (blindaje) ────────────────────────────────────────────────
--   · v_total sigue viniendo 100% de la BD (SUM de transactions.amount).
--   · Los datos del cliente (v_client_data) no se tocan.
--   · La idempotencia (v_idem_key) no se toca: mismo hash que antes.
--   · Las ramas daily_summary y pos_sale quedan carácter por carácter iguales.
--   · No se toca Izipay, webhooks, pasarela, logs_pasarela ni payment_sessions.
--   · Si por algún motivo no se puede resolver ningún ítem (caso defensivo,
--     no debería ocurrir nunca dado que p_transaction_ids ya viene validado),
--     se cae a una sola línea con COALESCE(p_description, 'Cobro deuda') —
--     el mismo comportamiento de antes, para no dejar nunca una boleta sin
--     ítems.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_billing_emission_v2(
  p_job_type            text,
  p_school_id           uuid,
  p_transaction_ids     uuid[]  DEFAULT NULL,
  p_transaction_id      uuid    DEFAULT NULL,
  p_invoice_client_data jsonb   DEFAULT NULL,
  p_invoice_type        text    DEFAULT NULL,
  p_payment_method      text    DEFAULT NULL,
  p_description         text    DEFAULT NULL,
  p_items_raw           jsonb   DEFAULT NULL,
  p_emission_date       date    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Aritmética IGV (Regla #11.A: cero cálculos en cliente)
  v_igv_pct          numeric;
  v_divisor_x100     numeric;
  v_total            numeric;
  v_total_cents      bigint;
  v_base_cents       bigint;
  v_igv_cents        bigint;
  v_base             numeric;
  v_igv              numeric;

  -- Datos del comprobante
  v_invoice_type     text;
  v_tipo             int;
  v_client_data      jsonb;
  v_items            jsonb;
  v_payload          jsonb;

  -- Control de cola
  v_idem_key         text;
  v_new_id           uuid;
  v_tx_ids           uuid[];
  v_student_id       uuid;
  v_emission_date    date;
  v_days_elapsed     int;

  -- Validación de ítems POS
  v_items_sum        numeric;
BEGIN

  -- ── 0. VALIDACIONES BASE ────────────────────────────────────────────────
  IF p_job_type NOT IN ('daily_summary', 'pos_sale', 'collection') THEN
    RETURN jsonb_build_object(
      'error',    'INVALID_JOB_TYPE_V2',
      'detail',   'enqueue_billing_emission_v2 acepta: daily_summary | pos_sale | collection. '
                  'Para job_type=voucher usar enqueue_billing_emission (v1).',
      'received', p_job_type
    );
  END IF;

  IF p_school_id IS NULL THEN
    RETURN jsonb_build_object(
      'error',  'SCHOOL_ID_REQUIRED',
      'detail', 'p_school_id es obligatorio.'
    );
  END IF;

  -- ── 1. IGV DESDE billing_config (Regla #11.A: BD dicta, nunca el frontend) ─
  SELECT COALESCE(bc.igv_porcentaje, 18)
  INTO   v_igv_pct
  FROM   public.billing_config bc
  WHERE  bc.school_id = p_school_id
    AND  bc.activo    = true
  LIMIT  1;

  v_igv_pct      := COALESCE(v_igv_pct, 18);
  v_divisor_x100 := 100 + v_igv_pct;

  -- ── 2. FECHA LIMA (Regla #11.C: reloj único de PostgreSQL, nunca new Date()) ─
  v_emission_date := COALESCE(p_emission_date, timezone('America/Lima', now())::date);
  v_days_elapsed  := GREATEST(0, (timezone('America/Lima', now())::date - v_emission_date));

  -- ── 3. BLOQUEO EXTEMPORÁNEO (mismo criterio que enqueue_billing_emission v1) ─
  -- SUNAT rechaza documentos con más de 7 días de antigüedad (RS 097-2012).
  IF v_days_elapsed > 7 THEN
    RETURN jsonb_build_object(
      'error',       'EXTEMPORANEO',
      'detail',      'La fecha de emisión tiene ' || v_days_elapsed || ' días. '
                     'SUNAT solo acepta documentos de hasta 7 días. '
                     'Coordinar con la contadora para gestión manual.',
      'days_elapsed', v_days_elapsed,
      'emission_date', v_emission_date
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- 4. DISPATCH POR job_type
  -- ══════════════════════════════════════════════════════════════════════

  -- ──────────────────────────────────────────────────────────────────────
  -- A. daily_summary — Boleta resumen diaria (Cierre Mensual)
  -- Batch de N transacciones → 1 boleta "Consumidor Final".
  -- El total se calcula con la misma fórmula que v_billing_masivo_pending.
  -- SIN CAMBIOS respecto a la versión anterior.
  -- ──────────────────────────────────────────────────────────────────────
  IF p_job_type = 'daily_summary' THEN

    IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_IDS_REQUIRED',
        'detail', 'daily_summary requiere p_transaction_ids con al menos 1 ID.'
      );
    END IF;

    SELECT ARRAY_AGG(t.id ORDER BY t.id)
    INTO   v_tx_ids
    FROM   public.transactions t
    WHERE  t.id         = ANY(p_transaction_ids)
      AND  t.school_id  = p_school_id
      AND  t.is_taxable = true
      AND  COALESCE(t.is_deleted, false) = false;

    IF v_tx_ids IS NULL OR cardinality(v_tx_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'NO_TAXABLE_TRANSACTIONS',
        'detail', 'Ninguna ID enviada es una transacción emitible en esta sede. '
                  'Verificar is_taxable=true y school_id correcto.'
      );
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN lower(btrim(t.payment_method)) = 'mixto'
        THEN round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2)
        ELSE round(abs(t.amount), 2)
      END
    ), 0)
    INTO  v_total
    FROM  public.transactions t
    WHERE t.id        = ANY(v_tx_ids)
      AND t.school_id = p_school_id;

    IF v_total <= 0 THEN
      RETURN jsonb_build_object(
        'error',  'ZERO_AMOUNT',
        'detail', 'El total boleteable calculado es 0. Verificar montos de las transacciones.'
      );
    END IF;

    v_idem_key := md5(
      'daily_summary|' || p_school_id::text || '|' ||
      array_to_string(v_tx_ids, ',')
    );

    v_total_cents := round(v_total * 100)::bigint;
    v_base_cents  := floor(v_total_cents * 100.0 / v_divisor_x100)::bigint;
    v_igv_cents   := v_total_cents - v_base_cents;
    v_base        := v_base_cents::numeric / 100;
    v_igv         := v_igv_cents::numeric / 100;

    v_payload := jsonb_build_object(
      'school_id',     p_school_id,
      'tipo',          2,
      'emission_date', v_emission_date::text,
      'cliente',       jsonb_build_object(
        'doc_type',    '-',
        'doc_number',  '-',
        'razon_social','Consumidor Final',
        'direccion',   '-'
      ),
      'items', jsonb_build_array(jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'RVD',
        'descripcion',             COALESCE(
          p_description,
          'Resumen Ventas Diarias ' || to_char(v_emission_date, 'DD/MM/YYYY')
        ),
        'cantidad',                1,
        'valor_unitario',          v_base,
        'precio_unitario',         v_total,
        'descuento',               '',
        'subtotal',                v_base,
        'tipo_de_igv',             1,
        'igv',                     v_igv,
        'total',                   v_total,
        'anticipo_regularizacion', false
      )),
      'monto_total',   v_total,
      'payment_method','digital'
    );

    v_invoice_type := 'boleta';
    v_student_id   := NULL;

  -- ──────────────────────────────────────────────────────────────────────
  -- B. collection — Cobro de deuda confirmado (BillingCollection)
  -- El monto SIEMPRE viene de la suma de las transacciones en BD.
  -- El frontend no puede inflar ni deflactar el total.
  --
  -- FIX 2026-07-07: en vez de UNA línea genérica "Cobro deuda", se arma
  -- UNA línea POR CADA transacción con su descripción real de consumo.
  -- ──────────────────────────────────────────────────────────────────────
  ELSIF p_job_type = 'collection' THEN

    IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_IDS_REQUIRED',
        'detail', 'collection requiere p_transaction_ids.'
      );
    END IF;

    IF p_invoice_client_data IS NULL THEN
      RETURN jsonb_build_object(
        'error',  'INVOICE_CLIENT_DATA_REQUIRED',
        'detail', 'collection requiere p_invoice_client_data con los datos del contribuyente.'
      );
    END IF;

    v_invoice_type := lower(trim(COALESCE(p_invoice_type, 'boleta')));
    IF v_invoice_type NOT IN ('boleta', 'factura') THEN
      RETURN jsonb_build_object(
        'error',    'INVALID_INVOICE_TYPE',
        'detail',   'p_invoice_type debe ser ''boleta'' o ''factura''.',
        'received', v_invoice_type
      );
    END IF;
    v_tipo := CASE WHEN v_invoice_type = 'factura' THEN 1 ELSE 2 END;

    -- Total DESDE LA BD (Regla #1: SSOT financiero — nunca del frontend)
    SELECT ARRAY_AGG(t.id ORDER BY t.id),
           COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_tx_ids,
           v_total
    FROM   public.transactions t
    WHERE  t.id             = ANY(p_transaction_ids)
      AND  t.school_id      = p_school_id
      AND  t.payment_status = 'paid'
      AND  COALESCE(t.is_deleted, false) = false;

    IF v_tx_ids IS NULL OR cardinality(v_tx_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'NO_PAID_TRANSACTIONS',
        'detail', 'No se encontraron transacciones pagadas para esas IDs en esta sede. '
                  'Verificar payment_status=paid y school_id.'
      );
    END IF;

    IF v_total <= 0 THEN
      RETURN jsonb_build_object(
        'error',  'ZERO_AMOUNT',
        'detail', 'El total calculado desde las transacciones es 0.'
      );
    END IF;

    SELECT t.student_id INTO v_student_id
    FROM   public.transactions t
    WHERE  t.id = v_tx_ids[1]
    LIMIT  1;

    v_idem_key := md5('collection|' || array_to_string(v_tx_ids, ','));

    v_total_cents := round(v_total * 100)::bigint;
    v_base_cents  := floor(v_total_cents * 100.0 / v_divisor_x100)::bigint;
    v_igv_cents   := v_total_cents - v_base_cents;
    v_base        := v_base_cents::numeric / 100;
    v_igv         := v_igv_cents::numeric / 100;

    v_client_data := jsonb_build_object(
      'doc_type',    COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_type'),    ''), '-'),
      'doc_number',  COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_number'),  ''), '-'),
      'razon_social',COALESCE(NULLIF(trim(p_invoice_client_data->>'razon_social'),''), 'Consumidor Final'),
      'direccion',   COALESCE(NULLIF(trim(p_invoice_client_data->>'direccion'),   ''), '-'),
      'email',       COALESCE(NULLIF(trim(p_invoice_client_data->>'email'),       ''), '')
    );

    -- ── Construir UN ítem POR CADA transacción, con su consumo real ─────
    -- Misma técnica de "último ítem absorbe el residuo de redondeo" que ya
    -- usa la rama pos_sale de esta función (probada en producción).
    SELECT jsonb_agg(
      jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'COBRO',
        'descripcion',             lv2.item_desc,
        'cantidad',                1,
        'valor_unitario',          round(lv2.adj_base::numeric / 100, 2),
        'precio_unitario',         round(lv2.item_cents::numeric / 100, 2),
        'descuento',               '',
        'subtotal',                round(lv2.adj_base::numeric / 100, 2),
        'tipo_de_igv',             1,
        'igv',                     round(lv2.adj_igv::numeric / 100, 2),
        'total',                   round(lv2.item_cents::numeric / 100, 2),
        'anticipo_regularizacion', false
      )
      ORDER BY lv2.rn
    )
    INTO v_items
    FROM (
      SELECT
        lv1.item_cents,
        lv1.item_desc,
        lv1.rn,
        floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint
          + CASE WHEN lv1.rn = lv1.cnt
                 THEN v_base_cents
                      - SUM(floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint) OVER ()
                 ELSE 0
            END   AS adj_base,
        (lv1.item_cents - floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint)
          + CASE WHEN lv1.rn = lv1.cnt
                 THEN v_igv_cents
                      - SUM(lv1.item_cents
                            - floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint) OVER ()
                 ELSE 0
            END   AS adj_igv
      FROM (
        SELECT
          round(abs(t.amount) * 100)::bigint AS item_cents,
          CASE
            WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN
              'Almuerzo - ' || COALESCE(s.full_name, 'Alumno') || ' - ' ||
              to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY')
            ELSE
              COALESCE(
                nullif(trim(t.description), ''),
                'Servicio cafetería - ' || COALESCE(s.full_name, 'Alumno') || ' - ' ||
                to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY')
              )
          END AS item_desc,
          row_number() OVER (ORDER BY t.created_at ASC, t.id ASC) AS rn,
          count(*)     OVER ()                                    AS cnt
        FROM   public.transactions t
        LEFT JOIN public.students s ON s.id = t.student_id
        WHERE  t.id = ANY(v_tx_ids)
      ) lv1
    ) lv2;

    -- Defensivo: si por algún motivo no se pudo armar ni un ítem (no debería
    -- pasar nunca, ya que v_tx_ids viene validado arriba), no dejar la
    -- boleta sin líneas — mismo comportamiento de respaldo que antes.
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
      v_items := jsonb_build_array(jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'COBRO',
        'descripcion',             COALESCE(p_description, 'Cobro deuda'),
        'cantidad',                1,
        'valor_unitario',          v_base,
        'precio_unitario',         v_total,
        'descuento',               '',
        'subtotal',                v_base,
        'tipo_de_igv',             1,
        'igv',                     v_igv,
        'total',                   v_total,
        'anticipo_regularizacion', false
      ));
    END IF;

    v_payload := jsonb_build_object(
      'school_id',     p_school_id,
      'tipo',          v_tipo,
      'cliente',       v_client_data,
      'items',         v_items,
      'monto_total',   v_total,
      'payment_method', COALESCE(p_payment_method, 'efectivo')
    );

  -- ──────────────────────────────────────────────────────────────────────
  -- C. pos_sale — Venta directa del kiosco
  -- SIN CAMBIOS respecto a la versión anterior.
  -- ──────────────────────────────────────────────────────────────────────
  ELSIF p_job_type = 'pos_sale' THEN

    IF p_transaction_id IS NULL THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_ID_REQUIRED',
        'detail', 'pos_sale requiere p_transaction_id (UUID de la transacción ya guardada en BD).'
      );
    END IF;

    v_invoice_type := lower(trim(COALESCE(p_invoice_type, 'boleta')));
    IF v_invoice_type NOT IN ('boleta', 'factura') THEN
      RETURN jsonb_build_object(
        'error',    'INVALID_INVOICE_TYPE',
        'detail',   'p_invoice_type debe ser ''boleta'' o ''factura''.',
        'received', v_invoice_type
      );
    END IF;
    v_tipo := CASE WHEN v_invoice_type = 'factura' THEN 1 ELSE 2 END;

    SELECT ABS(t.amount), t.student_id
    INTO   v_total,       v_student_id
    FROM   public.transactions t
    WHERE  t.id        = p_transaction_id
      AND  t.school_id = p_school_id
      AND  COALESCE(t.is_deleted, false) = false;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_NOT_FOUND',
        'detail', 'Transacción no encontrada o no pertenece a esta sede.',
        'tx_id',  p_transaction_id
      );
    END IF;

    IF v_total <= 0 THEN
      RETURN jsonb_build_object(
        'error',  'ZERO_AMOUNT',
        'detail', 'La transacción tiene monto 0 o negativo.'
      );
    END IF;

    v_tx_ids   := ARRAY[p_transaction_id];
    v_idem_key := md5('pos_sale|' || p_transaction_id::text);

    v_total_cents := round(v_total * 100)::bigint;
    v_base_cents  := floor(v_total_cents * 100.0 / v_divisor_x100)::bigint;
    v_igv_cents   := v_total_cents - v_base_cents;
    v_base        := v_base_cents::numeric / 100;
    v_igv         := v_igv_cents::numeric / 100;

    IF p_invoice_client_data IS NOT NULL THEN
      v_client_data := jsonb_build_object(
        'doc_type',    COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_type'),    ''), '-'),
        'doc_number',  COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_number'),  ''), '-'),
        'razon_social',COALESCE(NULLIF(trim(p_invoice_client_data->>'razon_social'),''), 'Consumidor Final'),
        'direccion',   COALESCE(NULLIF(trim(p_invoice_client_data->>'direccion'),   ''), '-'),
        'email',       COALESCE(NULLIF(trim(p_invoice_client_data->>'email'),       ''), '')
      );
    ELSE
      v_client_data := jsonb_build_object(
        'doc_type',    '-',
        'doc_number',  '-',
        'razon_social','Consumidor Final',
        'direccion',   '-'
      );
    END IF;

    IF p_items_raw IS NOT NULL AND jsonb_array_length(p_items_raw) > 0 THEN

      SELECT COALESCE(SUM(
        round((elem->>'unit_price')::numeric * (elem->>'qty')::numeric, 2)
      ), 0)
      INTO   v_items_sum
      FROM   jsonb_array_elements(p_items_raw) AS elem;

      IF ABS(v_items_sum - v_total) > 0.02 THEN
        RETURN jsonb_build_object(
          'error',      'ITEMS_TOTAL_MISMATCH',
          'detail',     'La suma de ítems no coincide con el total de la transacción en BD. '
                        'El monto de referencia es el de la BD, no el del frontend.',
          'items_sum',  v_items_sum,
          'tx_total',   v_total
        );
      END IF;

      SELECT jsonb_agg(
        jsonb_build_object(
          'unidad_de_medida',        COALESCE(NULLIF(trim(lv2.elem->>'uom'),  ''), 'NIU'),
          'codigo',                  COALESCE(NULLIF(trim(lv2.elem->>'code'), ''), LPAD(lv2.rn::text, 3, '0')),
          'descripcion',             COALESCE(NULLIF(trim(lv2.elem->>'name'), ''), 'Producto'),
          'cantidad',                (lv2.elem->>'qty')::numeric,
          'valor_unitario',          round(lv2.adj_base::numeric / 100 / (lv2.elem->>'qty')::numeric, 6),
          'precio_unitario',         round((lv2.elem->>'unit_price')::numeric, 2),
          'descuento',               '',
          'subtotal',                round(lv2.adj_base::numeric / 100, 2),
          'tipo_de_igv',             1,
          'igv',                     round(lv2.adj_igv::numeric / 100, 2),
          'total',                   round(lv2.item_cents::numeric / 100, 2),
          'anticipo_regularizacion', false
        )
        ORDER BY lv2.rn
      )
      INTO  v_items
      FROM (
        SELECT
          lv1.elem,
          lv1.item_cents,
          lv1.rn,
          floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint
            + CASE WHEN lv1.rn = lv1.cnt
                   THEN v_base_cents
                        - SUM(floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint) OVER ()
                   ELSE 0
              END   AS adj_base,
          (lv1.item_cents - floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint)
            + CASE WHEN lv1.rn = lv1.cnt
                   THEN v_igv_cents
                        - SUM(lv1.item_cents
                              - floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint) OVER ()
                   ELSE 0
              END   AS adj_igv
        FROM (
          SELECT
            elem,
            round((elem->>'unit_price')::numeric * (elem->>'qty')::numeric * 100)::bigint AS item_cents,
            row_number() OVER () AS rn,
            count(*)     OVER () AS cnt
          FROM jsonb_array_elements(p_items_raw) AS elem
        ) lv1
      ) lv2;

    ELSE
      v_items := jsonb_build_array(jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'VTA',
        'descripcion',             COALESCE(p_description, 'Venta kiosco'),
        'cantidad',                1,
        'valor_unitario',          v_base,
        'precio_unitario',         v_total,
        'descuento',               '',
        'subtotal',                v_base,
        'tipo_de_igv',             1,
        'igv',                     v_igv,
        'total',                   v_total,
        'anticipo_regularizacion', false
      ));
    END IF;

    v_payload := jsonb_build_object(
      'school_id',      p_school_id,
      'transaction_id', p_transaction_id,
      'tipo',           v_tipo,
      'cliente',        v_client_data,
      'items',          v_items,
      'monto_total',    v_total,
      'payment_method', COALESCE(p_payment_method, 'digital')
    );

  END IF;  -- fin DISPATCH

  -- ── 5. INSERT IDEMPOTENTE ─────────────────────────────────────────────────
  INSERT INTO public.billing_queue (
    recharge_request_id,
    student_id,
    school_id,
    amount,
    invoice_type,
    invoice_client_data,
    status,
    job_type,
    idempotency_key,
    emission_date,
    days_since_sale,
    transaction_ids,
    payload_snapshot
  )
  VALUES (
    NULL,
    v_student_id,
    p_school_id,
    v_total,
    v_invoice_type,
    COALESCE(p_invoice_client_data, NULL),
    'pending',
    p_job_type,
    v_idem_key,
    v_emission_date,
    v_days_elapsed,
    v_tx_ids,
    v_payload
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    SELECT id INTO v_new_id
    FROM   public.billing_queue
    WHERE  idempotency_key = v_idem_key;

    RETURN jsonb_build_object(
      'status',   'already_enqueued',
      'queue_id', v_new_id,
      'detail',   'Job ya estaba en cola. No se creó duplicado.'
    );
  END IF;

  IF v_tx_ids IS NOT NULL AND cardinality(v_tx_ids) > 0 THEN
    UPDATE public.transactions
    SET    billing_status = 'queued'
    WHERE  id        = ANY(v_tx_ids)
      AND  school_id = p_school_id
      AND  billing_status IN ('pending', 'failed');
  END IF;

  RETURN jsonb_build_object(
    'status',        'enqueued',
    'queue_id',      v_new_id,
    'emission_date', v_emission_date,
    'days_elapsed',  v_days_elapsed,
    'tx_count',      COALESCE(cardinality(v_tx_ids), 0),
    'total',         v_total,
    'job_type',      p_job_type
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'error',  'UNEXPECTED_ERROR',
    'detail', SQLERRM,
    'hint',   'Revisar logs de Supabase Dashboard → Edge Function o Postgres logs.'
  );
END;
$function$;

COMMENT ON FUNCTION public.enqueue_billing_emission_v2(text, uuid, uuid[], uuid, jsonb, text, text, text, jsonb, date) IS
  'v2.1 2026-07-07 — Fase 2B + FIX: la rama collection ahora arma un ítem por '
  'cada transacción de deuda con su descripción real de consumo (almuerzo o '
  'transactions.description), en vez de una sola línea genérica "Cobro deuda". '
  'daily_summary y pos_sale quedan sin cambios. Ver migración 20260707 para '
  'evidencia de producción y detalle del fix.';

SELECT 'v2.1 OK: enqueue_billing_emission_v2 — collection ahora detalla el consumo real' AS resultado;
