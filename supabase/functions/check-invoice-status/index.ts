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

// Nubefact usa tipos numéricos (1=factura, 2=boleta, 3=nota crédito, 4=nota débito)
// mientras nuestra BD suele guardar códigos SUNAT (01,03,07,08).
function mapToNubefactDocType(documentTypeCode: string | null | undefined): number {
  const code = String(documentTypeCode ?? "").trim();
  switch (code) {
    case "01": return 1; // factura
    case "03": return 2; // boleta
    case "07": return 3; // nota de crédito
    case "08": return 4; // nota de débito
    default:   return 2; // fallback seguro: boleta
  }
}

async function safeInvoicingLog(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from("invoicing_logs").insert(payload);
  if (error) {
    console.warn("[check-invoice-status] No se pudo escribir invoicing_log:", error.message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  // ── 1. Seleccionar lote de comprobantes pendientes de confirmar ─────────
  // NOTA: ya NO filtramos por nubefact_ticket IS NOT NULL.
  // Boletas en sunat_status='processing' sin ticket (o con ticket inválido)
  // también se consultan usando serie+numero, que son clave primaria del CPE en Nubefact.
  //
  // Compatibilidad de esquema:
  // algunos proyectos antiguos pueden no tener evidence_retry_count.
  // Si falta esa columna, hacemos fallback automático sin romper toda la función.
  let invoices: any[] | null = null;
  let fetchErr: { message?: string } | null = null;

  const withRetryColumn = await supabase
    .from("invoices")
    .select("id, school_id, serie, numero, document_type_code, nubefact_ticket, sunat_status, evidence_retry_count")
    .eq("sunat_status", "processing")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (withRetryColumn.error && String(withRetryColumn.error.message ?? "").includes("evidence_retry_count")) {
    console.warn("[check-invoice-status] Columna evidence_retry_count no existe. Usando fallback compatible.");
    const fallback = await supabase
      .from("invoices")
      .select("id, school_id, serie, numero, document_type_code, nubefact_ticket, sunat_status")
      .eq("sunat_status", "processing")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    invoices = (fallback.data ?? []).map((inv: any) => ({ ...inv, evidence_retry_count: 0 }));
    fetchErr = fallback.error;
  } else {
    invoices = withRetryColumn.data;
    fetchErr = withRetryColumn.error;
  }

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

  // ── Guardia de retraso crítico: >15 min en processing sin PDF ───────────────
  const criticalCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: criticalCandidates } = await supabase
    .from("invoices")
    .select("id, serie, numero, created_at, school_id")
    .eq("sunat_status", "processing")
    .is("pdf_url", null)
    .lt("created_at", criticalCutoff)
    .limit(200);

  if (criticalCandidates && criticalCandidates.length > 0) {
    const candidateIds = criticalCandidates.map((c) => c.id);
    const { data: recentCriticalLogs } = await supabase
      .from("invoicing_logs")
      .select("invoice_id")
      .eq("event_type", "critical_delay")
      .in("invoice_id", candidateIds)
      .gte("created_at", criticalCutoff);

    const alreadyLogged = new Set((recentCriticalLogs ?? []).map((r: any) => r.invoice_id));
    for (const c of criticalCandidates) {
      if (alreadyLogged.has(c.id)) continue;
      const label = `${c.serie}-${String(c.numero).padStart(8, "0")}`;
      await safeInvoicingLog(supabase, {
        invoice_id:    c.id,
        event_type:    "critical_delay",
        action:        "delay_guard",
        status:        "critical",
        event_message: `CRITICAL_DELAY: ${label} lleva más de 15 minutos en processing sin PDF.`,
        request_payload: {
          threshold_minutes: 15,
          detected_at: new Date().toISOString(),
          created_at: c.created_at,
          school_id: c.school_id,
        },
      });
    }
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
      await safeInvoicingLog(supabase, {
        invoice_id: invoice.id,
        event_type: "error",
        action: "poll",
        status: "error",
        event_message: `Poller: ${msg}`,
        error_code:    "NO_CREDENTIALS",
        error_message: msg,
      });
      results.push({ id: invoice.id, action: "error", error: msg });
      continue;
    }

    const nubefactUrl   = creds?.ruta  ?? globalUrl;
    const nubefactToken = creds?.token ?? globalToken!;

    // Detectar ticket "basura": si coincide con el patrón serie-numero (ej. "BMC3-00000518")
    // ese valor NO es un ticket de polling de Nubefact sino el correlativo del comprobante.
    // En ese caso usamos solo serie+numero para la consulta (suficiente para Nubefact).
    const TICKET_BASURA_RE = /^[A-Z0-9]+-\d{8}$/;
    const ticketValido = invoice.nubefact_ticket && !TICKET_BASURA_RE.test(invoice.nubefact_ticket)
      ? invoice.nubefact_ticket
      : null;

    console.log(
      `[check-invoice-status] Consultando ${label}` +
      (ticketValido ? ` (ticket=${ticketValido})` : " (por serie+numero — sin ticket válido)"),
    );

    try {
      // ── 3a. Llamada a Nubefact ─────────────────────────────────────────
      // Nubefact acepta serie+numero como identificador estable del CPE.
      // El ticket solo acelera la consulta cuando existe y es válido.
      const nubefactPayload = {
        operacion:           "consultar_comprobante",
        tipo_de_comprobante: mapToNubefactDocType(invoice.document_type_code),
        serie:               invoice.serie,
        numero:              invoice.numero,
        ...(ticketValido ? { ticket: ticketValido } : {}),
      };

      await safeInvoicingLog(supabase, {
        invoice_id: invoice.id,
        event_type: "poll_attempt",
        action: "poll",
        status: "requesting",
        event_message: `Poller: consultando ${label} en Nubefact.`,
        request_payload: nubefactPayload,
      });

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

      await safeInvoicingLog(supabase, {
        invoice_id: invoice.id,
        event_type: "poll_response",
        action: "poll",
        status: "received",
        event_message: `Poller: respuesta Nubefact recibida para ${label}.`,
        request_payload: nubefactPayload,
        response_payload: nubefactData,
      });

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

            await safeInvoicingLog(supabase, {
              invoice_id:    invoice.id,
              event_type:    "error",
              action: "poll",
              status: "retrying",
              event_message: `ADVERTENCIA LEGAL: ${label} aceptado por SUNAT pero sin URL de XML/PDF (intento ${retryCount}/${MAX_EVIDENCE_RETRIES}). Sin evidencia no hay validez ante auditoría SUNAT. Reintentando en próxima vuelta.`,
              error_code:    "MISSING_XML_EVIDENCE",
              error_message: "enlace_del_xml y enlace_del_pdf ausentes en respuesta Nubefact",
              request_payload: nubefactPayload,
              response_payload: nubefactData,
            });

            console.warn(`[check-invoice-status] ${label} aceptado pero SIN evidencia XML/PDF (retry ${retryCount})`);
            results.push({ id: invoice.id, action: "retrying_evidence", estado: "accepted_no_xml" });
            continue;
          } else {
            // Límite de reintentos alcanzado: marcar accepted pero con alerta crítica
            console.error(`[check-invoice-status] ${label} excedió ${MAX_EVIDENCE_RETRIES} reintentos de evidencia. Marcando accepted con alerta.`);
            await safeInvoicingLog(supabase, {
              invoice_id:    invoice.id,
              event_type:    "error",
              action: "poll",
              status: "critical",
              event_message: `ALERTA CRÍTICA: ${label} marcado como aceptado sin XML/CDR tras ${MAX_EVIDENCE_RETRIES} reintentos. Verificar manualmente en panel Nubefact.`,
              error_code:    "EVIDENCE_EXHAUSTED",
              error_message: "No se pudieron obtener URLs de evidencia tras máximos reintentos",
              request_payload: nubefactPayload,
              response_payload: nubefactData,
            });
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

      // ── 3d-bis. Propagar pdf_url a billing_queue y transactions ────────
      // Garantía de Recepción: cuando el PDF llega, actualizar TODAS las tablas
      // que el portal del padre consulta. Sin esto el padre ve "En proceso" aunque
      // invoices ya tenga el PDF.
      if (newStatus === "accepted" && updatePayload.pdf_url) {
        // Actualizar billing_queue vinculado a este invoice
        await supabase
          .from("billing_queue")
          .update({
            pdf_url:      updatePayload.pdf_url,
            sunat_status: "accepted",
          })
          .eq("nubefact_ticket", label)  // billing_queue.nubefact_ticket = "BMC3-XXXXXXXX"
          .eq("status", "emitted");

        // Actualizar transaction vinculada al invoice
        if (invoice.id) {
          const { error: txPdfErr } = await supabase
            .from("transactions")
            .update({ billing_status: "sent" })
            .eq("invoice_id", invoice.id);
          if (txPdfErr) {
            console.warn(`[check-invoice-status] No se pudo actualizar transactions para invoice ${invoice.id}:`, txPdfErr.message);
          }
        }

        console.log(`[check-invoice-status] ✅ PDF propagado a billing_queue + transactions para ${label}`);
      }

      // ── 3e. Log de auditoría con código de error SUNAT (PFC-06) ───────
      const logEvent   = newStatus === "accepted" ? "accepted" : "rejected";
      const logMsg     = newStatus === "accepted"
        ? `Poller: ${label} ACEPTADO por SUNAT.${updatePayload.pdf_url ? " PDF disponible." : " SIN PDF."}`
        : `Poller: ${label} RECHAZADO por SUNAT. ${sunatErrorMsg}`;

      await safeInvoicingLog(supabase, {
        invoice_id:       invoice.id,
        event_type:       logEvent,
        action:           "poll",
        status:           newStatus,
        event_message:    logMsg,
        request_payload:  nubefactPayload,
        response_payload: nubefactData,
        ...(newStatus === "rejected" ? {
          error_code:    sunatErrorCode ?? "REJECTED",
          error_message: sunatErrorMsg,
        } : {}),
      });

      console.log(`[check-invoice-status] ${label} → ${newStatus.toUpperCase()}`);
      results.push({ id: invoice.id, action: "updated", estado: newStatus });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[check-invoice-status] Error procesando ${label}:`, errMsg);

      // PFC-07: Log del error con trazabilidad completa
      await safeInvoicingLog(supabase, {
        invoice_id:    invoice.id,
        event_type:    "error",
        action:        "poll",
        status:        "error",
        event_message: `Poller: error consultando ${label} en Nubefact. ${errMsg}`,
        error_code:    "POLLER_FETCH_ERROR",
        error_message: errMsg,
        request_payload: {
          invoice_id: invoice.id,
          label,
          doc_type: invoice.document_type_code,
          ticket_valido: ticketValido,
        },
      });

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
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[check-invoice-status] FATAL:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
