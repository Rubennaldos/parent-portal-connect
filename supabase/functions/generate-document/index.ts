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
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: cfg } = await supabase
        .from("billing_config")
        .select("nubefact_ruta, nubefact_token")
        .eq("school_id", body.school_id)
        .single();

      const ruta = cfg?.nubefact_ruta || body.nubefact_ruta;
      const token = cfg?.nubefact_token || body.nubefact_token;

      if (!ruta || !token) {
        return new Response(JSON.stringify({ ok: false, error: "Sin credenciales — verifica RUTA y TOKEN" }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      try {
        const testRes = await fetch(ruta, {
          method: "GET",
          headers: { "Authorization": `Token ${token}` },
        });
        const ok = testRes.status < 500;
        return new Response(JSON.stringify({ ok, status: testRes.status }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    const {
      school_id,
      transaction_id,
      tipo,
      cliente,
      items,
      monto_total,
      doc_ref,
      demo_mode = false,   // si true: no envía a SUNAT (pruebas)
    } = body;

    // 1. Obtener credenciales Nubefact de este cliente/sede
    const { data: cfg, error: cfgErr } = await supabase
      .from("billing_config")
      .select("*")
      .eq("school_id", school_id)
      .single();

    if (cfgErr || !cfg) {
      return new Response(
        JSON.stringify({ success: false, error: `Sin configuración para school_id=${school_id}. Detalle: ${cfgErr?.message}` }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 2. Determinar serie según tipo de documento
    const serie = tipo === 1 ? cfg.serie_factura
                : tipo === 7 ? cfg.serie_nc_boleta
                : cfg.serie_boleta;

    // 3. Obtener número correlativo (contar docs previos del mismo tipo/serie)
    let numero = 1;
    try {
      const { count } = await supabase
        .from("electronic_documents")
        .select("*", { count: "exact", head: true })
        .eq("school_id", school_id)
        .eq("tipo_comprobante", tipo)
        .eq("serie", serie);
      numero = (count || 0) + 1;
    } catch (_) {
      // Si la tabla no existe aún, empezamos desde 1
      numero = 1;
    }

    // 4. Calcular IGV
    const igv_pct = Number(cfg.igv_porcentaje) || 18;
    const igv_monto = monto_total - (monto_total / (1 + igv_pct / 100));
    const base_imponible = monto_total - igv_monto;

    // 5. Fecha
    const hoy = new Date();
    const fecha = `${String(hoy.getDate()).padStart(2, "0")}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${hoy.getFullYear()}`;

    // 6. Items del comprobante
    const itemsDoc = items ?? [{
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

    // 7. Armar payload para Nubefact
    const payload: Record<string, unknown> = {
      operacion: "generar_comprobante",
      tipo_de_comprobante: tipo,
      serie,
      numero,
      sunat_transaction: 1,
      cliente_tipo_de_documento: cliente?.tipo_doc ?? 0,
      cliente_numero_de_documento: cliente?.numero_doc ?? "",
      cliente_denominacion: cliente?.nombre ?? "Cliente",
      cliente_direccion: "",
      cliente_email: cliente?.email ?? "",
      fecha_de_emision: fecha,
      moneda: 1,
      tipo_de_cambio: "",
      porcentaje_de_igv: igv_pct,
      total_gravada: +base_imponible.toFixed(2),
      total_igv: +igv_monto.toFixed(2),
      total: +monto_total.toFixed(2),
      enviar_automaticamente_a_la_sunat: !demo_mode,   // false en modo demo
      enviar_automaticamente_al_cliente: !demo_mode && !!(cliente?.email),
      items: itemsDoc,
    };

    // Campos extra para Nota de Crédito
    if (tipo === 7 && doc_ref) {
      payload.tipo_de_nota_de_credito = 1; // 1 = Anulación de operación
      payload.documento_que_se_modifica_tipo = doc_ref.tipo;
      payload.documento_que_se_modifica_serie = doc_ref.serie;
      payload.documento_que_se_modifica_numero = doc_ref.numero;
    }

    // 8. Llamar a la API de Nubefact
    const nubefactRes = await fetch(cfg.nubefact_ruta, {
      method: "POST",
      headers: {
        "Authorization": `Token ${cfg.nubefact_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const nubefactData = await nubefactRes.json();

    // 9. Guardar documento en base de datos (tolerante si la tabla no existe aún)
    let docGuardado: any = null;
    try {
    const { data: _doc } = await supabase
      .from("electronic_documents")
      .insert({
        school_id,
        transaction_id: transaction_id ?? null,
        tipo_comprobante: tipo,
        serie,
        numero,
        enlace_pdf: nubefactData.enlace_del_pdf ?? null,
        enlace_xml: nubefactData.enlace_del_xml ?? null,
        enlace_cdr: nubefactData.enlace_del_cdr ?? null,
        estado: nubefactData.aceptada_por_sunat ? "aceptado"
              : nubefactData.errors ? "rechazado"
              : "pendiente",
        cliente_nombre: cliente?.nombre ?? null,
        cliente_documento: cliente?.numero_doc ?? null,
        monto_total: +monto_total.toFixed(2),
        igv: +igv_monto.toFixed(2),
        doc_ref_serie: doc_ref?.serie ?? null,
        doc_ref_numero: doc_ref?.numero ?? null,
        respuesta_sunat: nubefactData,
      })
      .select()
      .single();
    docGuardado = _doc;
    } catch (dbErr) {
      console.error("Error guardando en electronic_documents:", dbErr);
      // No falla si la tabla no existe - el comprobante ya fue generado en Nubefact
    }

    return new Response(
      JSON.stringify({ success: true, documento: docGuardado ?? { serie, numero }, nubefact: nubefactData }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("generate-document ERROR:", error);
    // Siempre devolver 200 para que el cliente pueda leer el mensaje de error
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
