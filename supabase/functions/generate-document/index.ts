import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    // ========== MODO TEST: solo verificar credenciales ==========
    if (body.test === true) {
      const { data: cfg } = await supabase
        .from("billing_config")
        .select("nubefact_ruta, nubefact_token")
        .eq("school_id", body.school_id)
        .single();

      const ruta  = cfg?.nubefact_ruta  || body.nubefact_ruta;
      const token = cfg?.nubefact_token || body.nubefact_token;

      if (!ruta || !token) {
        return new Response(JSON.stringify({ ok: false, error: "Sin credenciales — verifica RUTA y TOKEN" }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      try {
        const testRes = await fetch(ruta, {
          method: "GET",
          headers: { "Authorization": `Token token=${token}` },
        });
        const ok = testRes.status < 500;
        return new Response(JSON.stringify({ ok, status: testRes.status }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // ========== GENERACIÓN DE COMPROBANTE ==========
    const {
      school_id,
      transaction_id,
      sale_id,
      payment_id,
      cashier_id,
      created_by,
      tipo,           // 1=factura, 2=boleta, 7=NC-boleta, 8=NC-factura
      cliente,
      items,
      monto_total,
      doc_ref,
      demo_mode = false,
      payment_method,
      related_invoice_id,
      cancellation_reason,
    } = body;

    // 1. Obtener configuración Nubefact de la sede
    const { data: cfg, error: cfgErr } = await supabase
      .from("billing_config")
      .select("*")
      .eq("school_id", school_id)
      .single();

    if (cfgErr || !cfg) {
      return new Response(
        JSON.stringify({ success: false, error: `Sin configuración Nubefact para school_id=${school_id}. Detalle: ${cfgErr?.message}` }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 2. Mapeo tipos internos → tipos Nubefact
    // Interno: 1=factura, 2=boleta, 7=NC-boleta, 8=NC-factura
    // Nubefact: 1=factura, 2=boleta, 3=nota_credito
    const nubefact_tipo = (tipo === 7 || tipo === 8) ? 3 : tipo;

    // 3. Determinar serie según tipo
    const serie = tipo === 1 ? cfg.serie_factura
                : tipo === 7 ? cfg.serie_nc_boleta
                : tipo === 8 ? cfg.serie_nc_factura
                : cfg.serie_boleta;

    // 4. Tipo de documento SUNAT
    const invoice_type_map: Record<number, string> = {
      1: "factura", 2: "boleta", 7: "nota_credito", 8: "nota_credito",
    };
    const document_type_code_map: Record<number, string> = {
      1: "01", 2: "03", 7: "07", 8: "07",
    };

    // 5. Número correlativo — desde tabla invoices (más confiable que electronic_documents)
    let numero = 1;
    try {
      const { count } = await supabase
        .from("invoices")
        .select("*", { count: "exact", head: true })
        .eq("school_id", school_id)
        .eq("serie", serie);
      numero = (count || 0) + 1;
    } catch (_) {
      // Fallback a electronic_documents si invoices no existe aún
      try {
        const { count } = await supabase
          .from("electronic_documents")
          .select("*", { count: "exact", head: true })
          .eq("school_id", school_id)
          .eq("tipo_comprobante", tipo)
          .eq("serie", serie);
        numero = (count || 0) + 1;
      } catch (_2) {
        numero = 1;
      }
    }

    // 6. Calcular IGV
    const igv_pct      = Number(cfg.igv_porcentaje) || 18;
    const igv_monto    = monto_total - (monto_total / (1 + igv_pct / 100));
    const base_imponible = monto_total - igv_monto;

    // 7. Fecha
    const hoy   = new Date();
    const fecha = `${String(hoy.getDate()).padStart(2, "0")}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${hoy.getFullYear()}`;

    // 8. Items del comprobante (Nubefact format)
    const itemsNubefact = items ?? [{
      unidad_de_medida: "NIU",
      codigo: "001",
      descripcion: "Consumo cafetería / almuerzo",
      cantidad: 1,
      valor_unitario: +base_imponible.toFixed(2),
      precio_unitario: +monto_total.toFixed(2),
      descuento: "",
      subtotal: +base_imponible.toFixed(2),
      tipo_de_igv: 1,
      igv: +igv_monto.toFixed(2),
      total: +monto_total.toFixed(2),
      anticipo_regularizacion: false,
    }];

    // 9. Tipo de documento del cliente
    // Nubefact: 0=sin doc, 1=DNI, 6=RUC
    const clientDocTypeNubefact =
      cliente?.doc_type === "ruc"  ? 6 :
      cliente?.doc_type === "dni"  ? 1 :
      (cliente?.tipo_doc ?? 0);

    // 10. Payload para Nubefact
    const payload: Record<string, unknown> = {
      operacion:                      "generar_comprobante",
      tipo_de_comprobante:            nubefact_tipo,
      serie,
      numero,
      sunat_transaction:              1,
      cliente_tipo_de_documento:      clientDocTypeNubefact,
      cliente_numero_de_documento:    cliente?.doc_number || cliente?.numero_doc || (clientDocTypeNubefact === 0 ? "-" : ""),
      cliente_denominacion:           cliente?.razon_social || cliente?.nombre || "Consumidor Final",
      cliente_direccion:              cliente?.direccion || "",
      cliente_email:                  cliente?.email   || "",
      fecha_de_emision:               fecha,
      moneda:                         1,
      tipo_de_cambio:                 "",
      porcentaje_de_igv:              igv_pct,
      total_gravada:                  +base_imponible.toFixed(2),
      total_igv:                      +igv_monto.toFixed(2),
      total:                          +monto_total.toFixed(2),
      enviar_automaticamente_a_la_sunat:  !demo_mode,
      enviar_automaticamente_al_cliente:  !demo_mode && !!(cliente?.email),
      items: itemsNubefact,
    };

    // Campos extra para Nota de Crédito
    if ((tipo === 7 || tipo === 8) && doc_ref) {
      payload.tipo_de_nota_de_credito            = 1;
      payload.documento_que_se_modifica_tipo     = doc_ref.tipo;
      payload.documento_que_se_modifica_serie    = doc_ref.serie;
      payload.documento_que_se_modifica_numero   = doc_ref.numero;
    }

    // 11. Llamar a la API de Nubefact
    const nubefactRes  = await fetch(cfg.nubefact_ruta, {
      method:  "POST",
      headers: {
        "Authorization": `Token token=${cfg.nubefact_token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
    });

    const nubefactData = await nubefactRes.json();

    // 12. Estado SUNAT
    const sunat_status =
      nubefactData.aceptada_por_sunat ? "accepted" :
      nubefactData.errors             ? "rejected" :
      demo_mode                       ? "pending"  : "processing";

    // 13. Guardar en tabla `invoices` (nueva, principal)
    let savedInvoice: any = null;
    try {
      // Items para tabla invoice_items
      const invoiceItemsDB = (items ?? []).map((it: any) => ({
        description:         it.descripcion || "Consumo",
        quantity:            it.cantidad || 1,
        unit_price:          it.valor_unitario || base_imponible,
        subtotal:            it.subtotal || base_imponible,
        igv_amount:          it.igv || igv_monto,
        total:               it.total || monto_total,
        product_code:        it.codigo || null,
        unit_type:           it.unidad_de_medida || "NIU",
        tax_type:            "gravada",
        discount_percentage: 0,
        discount_amount:     0,
      }));

      const invoicePayload = {
        school_id,
        sale_id:           sale_id ?? transaction_id ?? null,
        payment_id:        payment_id ?? null,
        cashier_id:        cashier_id ?? null,
        created_by:        created_by ?? null,
        invoice_type:      invoice_type_map[tipo] || "boleta",
        document_type_code: document_type_code_map[tipo] || "03",
        serie,
        numero,
        client_document_type:   cliente?.doc_type || (clientDocTypeNubefact === 6 ? "ruc" : clientDocTypeNubefact === 1 ? "dni" : "-"),
        client_document_number: cliente?.doc_number || cliente?.numero_doc || null,
        client_name:            cliente?.razon_social || cliente?.nombre || "Consumidor Final",
        client_address:         cliente?.direccion || null,
        client_email:           cliente?.email || null,
        currency:               "PEN",
        subtotal:               +base_imponible.toFixed(2),
        igv_rate:               igv_pct / 100,
        igv_amount:             +igv_monto.toFixed(2),
        discount_amount:        0,
        total_amount:           +monto_total.toFixed(2),
        items:                  invoiceItemsDB,
        sunat_status,
        sunat_response_code:    nubefactData.codigo_respuesta_sunat ?? null,
        sunat_response_message: nubefactData.respuesta_sunat ?? nubefactData.errors ?? null,
        nubefact_id:            nubefactData.enlace_del_pdf?.split("/").pop() ?? null,
        pdf_url:                nubefactData.enlace_del_pdf ?? null,
        xml_url:                nubefactData.enlace_del_xml ?? null,
        cdr_url:                nubefactData.enlace_del_cdr ?? null,
        hash_signature:         nubefactData.hash_cpe ?? null,
        qr_code:                nubefactData.codigo_qr ?? null,
        related_invoice_id:     related_invoice_id ?? null,
        cancellation_reason:    cancellation_reason ?? null,
        payment_method:         payment_method ?? null,
        emission_date:          new Date().toISOString().split("T")[0],
        sent_to_sunat_at:       !demo_mode ? new Date().toISOString() : null,
        notes:                  demo_mode ? "MODO DEMO — no enviado a SUNAT" : null,
      };

      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert(invoicePayload)
        .select()
        .single();

      if (invErr) {
        console.error("Error guardando en invoices:", invErr);
      } else {
        savedInvoice = inv;

        // Guardar items en invoice_items
        if (invoiceItemsDB.length > 0 && inv?.id) {
          await supabase.from("invoice_items").insert(
            invoiceItemsDB.map((item) => ({ ...item, invoice_id: inv.id }))
          );
        }

        // Log del evento
        await supabase.from("invoicing_logs").insert({
          invoice_id:   inv.id,
          event_type:   "created",
          event_message: `Comprobante ${serie}-${String(numero).padStart(8,"0")} generado. Estado SUNAT: ${sunat_status}`,
          request_payload:  payload,
          response_payload: nubefactData,
        });
      }
    } catch (dbErr) {
      console.error("Error guardando invoice:", dbErr);
    }

    // 14. Fallback: guardar en electronic_documents (compatibilidad)
    try {
      await supabase.from("electronic_documents").insert({
        school_id,
        transaction_id: transaction_id ?? null,
        tipo_comprobante: tipo,
        serie,
        numero,
        enlace_pdf:   nubefactData.enlace_del_pdf ?? null,
        enlace_xml:   nubefactData.enlace_del_xml ?? null,
        enlace_cdr:   nubefactData.enlace_del_cdr ?? null,
        estado:       sunat_status === "accepted" ? "aceptado" : sunat_status === "rejected" ? "rechazado" : "pendiente",
        cliente_nombre:   cliente?.razon_social || cliente?.nombre || null,
        cliente_documento: cliente?.doc_number || null,
        monto_total:  +monto_total.toFixed(2),
        igv:          +igv_monto.toFixed(2),
        doc_ref_serie:  doc_ref?.serie ?? null,
        doc_ref_numero: doc_ref?.numero ?? null,
        respuesta_sunat: nubefactData,
      });
    } catch (_) {
      // No crítico si electronic_documents no existe
    }

    return new Response(
      JSON.stringify({
        success:   true,
        documento: savedInvoice ?? { id: null, serie, numero, enlace_pdf: nubefactData.enlace_del_pdf, enlace_xml: nubefactData.enlace_del_xml, estado: sunat_status },
        nubefact:  nubefactData,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("generate-document ERROR:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
