// @ts-nocheck — Edge Function Deno (Supabase). No usar tipos de Node.js.
//
// Propósito: Poller de estado de comprobantes en limbo.
//   Consulta `invoices` por registros con sunat_status='processing' y nubefact_ticket,
//   luego pregunta a Nubefact (usando credenciales POR SEDE desde billing_config) cómo quedaron.
//
// CORRECCIÓN AUDITADA (PFC-01):
//   Versión anterior usaba NUBEFACT_API_TOKEN global — ignoraba tokens por sede.
//   Ahora se cargan las credenciales desde billing_config.nubefact_ruta y nubefact_token.
//
// CORRECCIÓN AUDITADA (PFC-05):
//   El poller ahora valida que PDF/XML existan antes de marcar 'accepted'.
//   Si faltan, graba un warning en invoicing_logs y deja el estado en 'processing'
//   para reintentar en la próxima vuelta (máx. 3 reintentos registrados).
//
// CORRECCIÓN AUDITADA (PFC-06):
//   El código de error SUNAT (ej. "0301") se guarda en error_code de invoicing_logs.
//
// CORRECCIÓN AUDITADA (PFC-07):
//   Cada evento (accepted, rejected, error, missing_evidence) queda en invoicing_logs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cuántos comprobantes procesamos por vuelta (evita timeouts de Edge Functions ~10 s)
const BATCH_SIZE = 20;

// Máximo de reintentos cuando Nubefact acepta pero sin URLs de evidencia
const MAX_EVIDENCE_RETRIES = 3;

// ── Determinar nuevo estado desde la respuesta de Nubefact ──────────────────
function resolveNewStatus(data: any): "accepted" | "rejected" | "processing" {
  const e = (
    data?.sunat_estado ??
    data?.estado       ??
    data?.description  ??
    ""
  ).toLowerCase().trim();

  if (
    e.includes("aceptado") || e.includes("aceptada") || e.includes("accepted") ||
    e === "0"
  ) return "accepted";

  if (
    e.includes("rechazado") || e.includes("rechazada") || e.includes("rejected")
  ) return "rejected";

  return "processing";
}

// ── Extraer código de error SUNAT de la respuesta de Nubefact ───────────────
function extractSunatErrorCode(data: any): string | null {
  return (
    data?.codigo_respuesta_sunat ??
    data?.codigo_error            ??
    data?.errors?.[0]?.code       ??
    data?.error_code              ??
    null
  );
}

// ── Extraer descripción legible del error SUNAT ─────────────────────────────
function extractSunatErrorMsg(data: any): string {
  const code = extractSunatErrorCode(data);
  const raw  = (
    data?.sunat_descripcion ??
    data?.respuesta_sunat   ??
    data?.sunat_estado      ??
    data?.estado            ??
    data?.description       ??
    data?.errors            ??
    "Sin detalle"
  );
  const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);
  return code ? `[SUNAT ${code}] ${rawStr}` : rawStr;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  // ── 1. Seleccionar lote de comprobantes pendientes de confirmar ─────────
  const { data: invoices, error: fetchErr } = await supabase
    .from("invoices")
    .select("id, school_id, serie, numero, document_type_code, nubefact_ticket, sunat_status, evidence_retry_count")
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
  console.log(`[check-invoice-status] Inicio. Lote: ${total} comprobantes a verificar.`);

  if (total === 0) {
    return new Response(
      JSON.stringify({ message: "Sin comprobantes pendientes", processed: 0 }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  // ── 2. Cargar credenciales POR SEDE (PFC-01) ────────────────────────────
  // Una sola query para todas las sedes presentes en el lote — no N+1.
  const schoolIds = [...new Set((invoices ?? []).map((inv) => inv.school_id))];

  const { data: billingConfigs, error: cfgErr } = await supabase
    .from("billing_config")
    .select("school_id, nubefact_ruta, nubefact_token")
    .in("school_id", schoolIds);

  if (cfgErr) {
    console.error("[check-invoice-status] Error cargando billing_config:", cfgErr);
    // Continuar con fallback global si existe
  }

  // Mapa school_id → { ruta, token }
  type Creds = { ruta: string; token: string };
  const credsBySchool = new Map<string, Creds>();
  for (const cfg of billingConfigs ?? []) {
    if (cfg.nubefact_ruta && cfg.nubefact_token) {
      credsBySchool.set(cfg.school_id, {
        ruta:  cfg.nubefact_ruta.trim(),
        token: cfg.nubefact_token.trim(),
      });
    }
  }

  // Fallback: token global (solo si billing_config no tiene credenciales)
  const globalToken = Deno.env.get("NUBEFACT_API_TOKEN");
  const globalUrl   = Deno.env.get("NUBEFACT_API_URL") ?? "https://api.nubefact.com/api/v1";

  // ── 3. Procesar cada comprobante ─────────────────────────────────────────
  const results: Array<{ id: string; action: string; estado?: string; error?: string }> = [];

  for (const invoice of invoices) {
    const label = `${invoice.serie}-${String(invoice.numero).padStart(8, "0")}`;

    // Resolver credenciales: preferir por sede, fallback global
    const creds = credsBySchool.get(invoice.school_id);
    if (!creds && !globalToken) {
      const msg = `Sin credenciales Nubefact para school_id=${invoice.school_id}. Configura billing_config.`;
      console.error(`[check-invoice-status] ${label}: ${msg}`);
      await supabase.from("invoicing_logs").insert({
        invoice_id: invoice.id,
        event_type: "error",
        event_message: `Poller: ${msg}`,
        error_code:    "NO_CREDENTIALS",
        error_message: msg,
      }).catch(() => {});
      results.push({ id: invoice.id, action: "error", error: msg });
      continue;
    }

    const nubefactUrl   = creds?.ruta  ?? globalUrl;
    const nubefactToken = creds?.token ?? globalToken!;

    console.log(`[check-invoice-status] Consultando ticket ${invoice.nubefact_ticket} para ${label}`);

    try {
      // ── 3a. Llamada a Nubefact ─────────────────────────────────────────
      const nubefactPayload = {
        operacion:           "consultar_comprobante",
        tipo_de_comprobante: Number(invoice.document_type_code ?? "03"),
        serie:               invoice.serie,
        numero:              invoice.numero,
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
        throw new Error(`HTTP ${nubefactRes.status}: ${await nubefactRes.text()}`);
      }

      const nubefactData = await nubefactRes.json();
      console.log(`[check-invoice-status] Respuesta para ${label}:`, JSON.stringify(nubefactData));

      // ── 3b. Determinar nuevo estado ────────────────────────────────────
      const newStatus       = resolveNewStatus(nubefactData);
      const sunatErrorCode  = extractSunatErrorCode(nubefactData);
      const sunatErrorMsg   = extractSunatErrorMsg(nubefactData);

      if (newStatus === "processing") {
        console.log(`[check-invoice-status] ${label} sigue en cola SUNAT. Sin cambios.`);
        results.push({ id: invoice.id, action: "skipped", estado: "processing" });
        continue;
      }

      // ── 3c. Construir payload de actualización ─────────────────────────
      const updatePayload: Record<string, unknown> = {
        sunat_status:      newStatus,
        nubefact_response: nubefactData,
      };

      if (newStatus === "accepted") {
        const pdfUrl = nubefactData?.enlace_del_pdf ?? null;
        const xmlUrl = nubefactData?.enlace_del_xml ?? null;
        const cdrUrl = nubefactData?.enlace_del_cdr ?? null;

        if (pdfUrl) updatePayload.pdf_url = pdfUrl;
        if (xmlUrl) updatePayload.xml_url = xmlUrl;
        if (cdrUrl) updatePayload.cdr_url = cdrUrl;

        if (nubefactData?.nubefact_id || nubefactData?.id) {
          updatePayload.nubefact_id = String(nubefactData?.nubefact_id ?? nubefactData?.id ?? "");
        }

        // PFC-05: Validar evidencia legal (XML es obligatorio ante SUNAT)
        if (!xmlUrl && !pdfUrl) {
          const retryCount = (invoice.evidence_retry_count ?? 0) + 1;
          if (retryCount <= MAX_EVIDENCE_RETRIES) {
            // No marcar accepted todavía — esperar próxima vuelta con reintentos
            await supabase
              .from("invoices")
              .update({ evidence_retry_count: retryCount })
              .eq("id", invoice.id)
              .eq("sunat_status", "processing");

            await supabase.from("invoicing_logs").insert({
              invoice_id:    invoice.id,
              event_type:    "error",
              event_message: `ADVERTENCIA LEGAL: ${label} aceptado por SUNAT pero sin URL de XML/PDF (intento ${retryCount}/${MAX_EVIDENCE_RETRIES}). Sin evidencia no hay validez ante auditoría SUNAT. Reintentando en próxima vuelta.`,
              error_code:    "MISSING_XML_EVIDENCE",
              error_message: "enlace_del_xml y enlace_del_pdf ausentes en respuesta Nubefact",
            }).catch(() => {});

            console.warn(`[check-invoice-status] ${label} aceptado pero SIN evidencia XML/PDF (retry ${retryCount})`);
            results.push({ id: invoice.id, action: "retrying_evidence", estado: "accepted_no_xml" });
            continue;
          } else {
            // Límite de reintentos alcanzado: marcar accepted pero con alerta crítica
            console.error(`[check-invoice-status] ${label} excedió ${MAX_EVIDENCE_RETRIES} reintentos de evidencia. Marcando accepted con alerta.`);
            await supabase.from("invoicing_logs").insert({
              invoice_id:    invoice.id,
              event_type:    "error",
              event_message: `ALERTA CRÍTICA: ${label} marcado como aceptado sin XML/CDR tras ${MAX_EVIDENCE_RETRIES} reintentos. Verificar manualmente en panel Nubefact.`,
              error_code:    "EVIDENCE_EXHAUSTED",
              error_message: "No se pudieron obtener URLs de evidencia tras máximos reintentos",
            }).catch(() => {});
          }
        }
      }

      // ── 3d. Actualizar invoices (guard de idempotencia incluido) ───────
      const { error: updateErr } = await supabase
        .from("invoices")
        .update(updatePayload)
        .eq("id", invoice.id)
        .eq("sunat_status", "processing"); // solo si sigue en processing

      if (updateErr) {
        throw new Error(`Error actualizando invoice en BD: ${updateErr.message}`);
      }

      // ── 3e. Log de auditoría con código de error SUNAT (PFC-06) ───────
      const logEvent   = newStatus === "accepted" ? "accepted" : "rejected";
      const logMsg     = newStatus === "accepted"
        ? `Poller: ${label} ACEPTADO por SUNAT.${updatePayload.pdf_url ? " PDF disponible." : " SIN PDF."}`
        : `Poller: ${label} RECHAZADO por SUNAT. ${sunatErrorMsg}`;

      await supabase.from("invoicing_logs").insert({
        invoice_id:       invoice.id,
        event_type:       logEvent,
        event_message:    logMsg,
        response_payload: nubefactData,
        ...(newStatus === "rejected" ? {
          error_code:    sunatErrorCode ?? "REJECTED",
          error_message: sunatErrorMsg,
        } : {}),
      }).catch(() => {});

      console.log(`[check-invoice-status] ${label} → ${newStatus.toUpperCase()}`);
      results.push({ id: invoice.id, action: "updated", estado: newStatus });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[check-invoice-status] Error procesando ${label}:`, errMsg);

      // PFC-07: Log del error con trazabilidad completa
      await supabase.from("invoicing_logs").insert({
        invoice_id:    invoice.id,
        event_type:    "error",
        event_message: `Poller: error consultando ${label} en Nubefact. ${errMsg}`,
        error_code:    "POLLER_FETCH_ERROR",
        error_message: errMsg,
      }).catch(() => {});

      results.push({ id: invoice.id, action: "error", error: errMsg });
    }
  }

  // ── 4. Resumen ─────────────────────────────────────────────────────────────
  const updated  = results.filter((r) => r.action === "updated").length;
  const skipped  = results.filter((r) => r.action === "skipped").length;
  const errors   = results.filter((r) => r.action === "error").length;
  const retrying = results.filter((r) => r.action === "retrying_evidence").length;

  console.log(
    `[check-invoice-status] Fin. Total: ${total} | ` +
    `Actualizados: ${updated} | Sin cambio: ${skipped} | ` +
    `Reintentando evidencia: ${retrying} | Errores: ${errors}`
  );

  return new Response(
    JSON.stringify({ processed: total, updated, skipped, retrying, errors, details: results }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
  );
});
