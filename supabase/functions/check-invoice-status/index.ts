// @ts-nocheck — Edge Function Deno (Supabase). No usar tipos de Node.js.
// Propósito: Poller de estado de comprobantes en limbo.
//   Consulta la tabla `invoices` por registros con sunat_status='processing'
//   y un nubefact_ticket guardado, luego les pregunta a Nubefact cómo quedaron.
//   Idempotente: si se ejecuta dos veces no hay doble actualización.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cuántos comprobantes procesamos por vuelta (evita timeouts de Edge Functions)
const BATCH_SIZE = 20;

// ── Mapa de estados que devuelve Nubefact → estado interno ──────────────────
// Nubefact puede devolver variaciones, normalizamos a minúsculas para comparar.
function resolveNewStatus(nubefactEstado: string): "accepted" | "rejected" | "processing" {
  const e = (nubefactEstado ?? "").toLowerCase().trim();
  if (
    e.includes("aceptado") ||
    e.includes("aceptada") ||
    e.includes("accepted") ||
    e === "0"          // código de éxito en algunas versiones de Nubefact
  ) return "accepted";
  if (
    e.includes("rechazado") ||
    e.includes("rechazada") ||
    e.includes("rejected")
  ) return "rejected";
  return "processing"; // todavía en cola
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Inicialización del cliente con service_role (salta RLS) ─────────────
  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const nubefactToken = Deno.env.get("NUBEFACT_API_TOKEN");
  const nubefactUrl   = Deno.env.get("NUBEFACT_API_URL") ?? "https://api.nubefact.com/api/v1";

  if (!nubefactToken) {
    console.error("[check-invoice-status] NUBEFACT_API_TOKEN no configurado.");
    return new Response(JSON.stringify({ error: "NUBEFACT_API_TOKEN ausente" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 1. Seleccionar lote de comprobantes en estado 'processing' ───────────
  const { data: invoices, error: fetchErr } = await supabase
    .from("invoices")
    .select("id, school_id, serie, numero, document_type_code, nubefact_ticket, sunat_status")
    .eq("sunat_status", "processing")
    .not("nubefact_ticket", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[check-invoice-status] Error consultando invoices:", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const total = invoices?.length ?? 0;
  console.log(`[check-invoice-status] Inicio del poller. Lote: ${total} comprobantes a verificar.`);

  if (total === 0) {
    console.log("[check-invoice-status] Nada por sincronizar en esta vuelta.");
    return new Response(JSON.stringify({ message: "Sin comprobantes pendientes", processed: 0 }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ── 2. Procesar cada comprobante ─────────────────────────────────────────
  const results: Array<{ id: string; action: string; estado?: string; error?: string }> = [];

  for (const invoice of invoices) {
    const label = `${invoice.serie}-${String(invoice.numero).padStart(8, "0")}`;
    console.log(`[check-invoice-status] Consultando ticket ${invoice.nubefact_ticket} para ${label}`);

    try {
      // ── 2a. Llamada a Nubefact: consultar_comprobante ──────────────────
      // La API de Nubefact acepta el ticket directamente en el endpoint
      // POST /comprobantes/consultar  con  { token, tipo_de_comprobante, serie, numero }
      // o bien por ticket:  POST /comprobantes/consultar_ticket { token, ticket }
      // Intentamos primero por ticket (más directo) y fallamos grácilmente si no existe ese endpoint.
      const nubefactPayload = {
        operacion:             "consultar_comprobante",
        tipo_de_comprobante:   Number(invoice.document_type_code), // 01=Factura, 03=Boleta
        serie:                 invoice.serie,
        numero:                invoice.numero,
        // Incluimos el ticket si existe para que Nubefact lo use como referencia
        ...(invoice.nubefact_ticket ? { ticket: invoice.nubefact_ticket } : {}),
      };

      const nubefactRes = await fetch(nubefactUrl, {
        method:  "POST",
        headers: {
          "Authorization": `Token token=${nubefactToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(nubefactPayload),
      });

      if (!nubefactRes.ok) {
        const errText = await nubefactRes.text();
        throw new Error(`HTTP ${nubefactRes.status}: ${errText}`);
      }

      const nubefactData = await nubefactRes.json();
      console.log(`[check-invoice-status] Respuesta Nubefact para ${label}:`, JSON.stringify(nubefactData));

      // ── 2b. Determinar nuevo estado ────────────────────────────────────
      // Nubefact puede devolver: sunat_estado, estado, description, errors[0].code
      const estadoRaw: string =
        nubefactData?.sunat_estado ??
        nubefactData?.estado        ??
        nubefactData?.description   ??
        "";

      const newStatus = resolveNewStatus(estadoRaw);

      if (newStatus === "processing") {
        // Todavía en cola de SUNAT → no tocar nada, esperamos la próxima vuelta
        console.log(`[check-invoice-status] ${label} sigue en procesamiento. Sin cambios.`);
        results.push({ id: invoice.id, action: "skipped", estado: "processing" });
        continue;
      }

      // ── 2c. Construir payload de actualización ─────────────────────────
      const updatePayload: Record<string, unknown> = {
        sunat_status:      newStatus,
        nubefact_response: nubefactData,
      };

      if (newStatus === "accepted") {
        // Guardar URLs de PDF/XML si Nubefact las devuelve
        if (nubefactData?.enlace_del_pdf)  updatePayload.pdf_url = nubefactData.enlace_del_pdf;
        if (nubefactData?.enlace_del_xml)  updatePayload.xml_url = nubefactData.enlace_del_xml;
        if (nubefactData?.enlace_del_cdr)  updatePayload.cdr_url = nubefactData.enlace_del_cdr;
        if (nubefactData?.nubefact_id || nubefactData?.id) {
          updatePayload.nubefact_id = String(nubefactData?.nubefact_id ?? nubefactData?.id ?? "");
        }
      }

      // ── 2d. Actualizar la tabla invoices ───────────────────────────────
      const { error: updateErr } = await supabase
        .from("invoices")
        .update(updatePayload)
        .eq("id", invoice.id)
        // Guard de idempotencia: solo actualizamos si aún está en 'processing'
        .eq("sunat_status", "processing");

      if (updateErr) {
        throw new Error(`Error al actualizar invoice: ${updateErr.message}`);
      }

      // ── 2e. Log de auditoría ───────────────────────────────────────────
      const logEvent = newStatus === "accepted" ? "accepted" : "rejected";
      const logMsg = newStatus === "accepted"
        ? `Sincronización automática: ${label} aceptado por SUNAT via Poller.`
        : `Sincronización automática: ${label} rechazado por SUNAT. Motivo: ${estadoRaw || "Sin detalle"}`;

      await supabase.from("invoicing_logs").insert({
        invoice_id:       invoice.id,
        event_type:       logEvent,
        event_message:    logMsg,
        response_payload: nubefactData,
        ...(newStatus === "rejected" ? { error_message: estadoRaw } : {}),
      });

      console.log(`[check-invoice-status] ${label} → ${newStatus.toUpperCase()}`);
      results.push({ id: invoice.id, action: "updated", estado: newStatus });

    } catch (err) {
      // Error aislado: no detiene el bucle
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[check-invoice-status] Error procesando ${label}:`, errMsg);

      // Log del error para debugging posterior
      await supabase.from("invoicing_logs").insert({
        invoice_id:    invoice.id,
        event_type:    "error",
        event_message: `Poller: error al consultar ${label} en Nubefact.`,
        error_message: errMsg,
      }).catch(() => {}); // si el log también falla, no queremos cascada

      results.push({ id: invoice.id, action: "error", error: errMsg });
    }
  }

  // ── 3. Resumen final ──────────────────────────────────────────────────────
  const updated  = results.filter((r) => r.action === "updated").length;
  const skipped  = results.filter((r) => r.action === "skipped").length;
  const errors   = results.filter((r) => r.action === "error").length;

  console.log(
    `[check-invoice-status] Fin del poller. ` +
    `Total: ${total} | Actualizados: ${updated} | Sin cambio: ${skipped} | Errores: ${errors}`
  );

  return new Response(
    JSON.stringify({ processed: total, updated, skipped, errors, details: results }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
  );
});
