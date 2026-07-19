// @ts-nocheck — archivo Deno (Edge Function de Supabase)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as cors } from "../_shared/cors.ts";

// ── Configuración ─────────────────────────────────────────────────────────────

// Máximo de registros a procesar por invocación (cron cada minuto)
// Valor bajo para garantizar que la Edge Function termina bien antes del timeout
const MAX_PER_RUN = 5;

// TTL anti-zombie: registros en 'processing' por más de este tiempo → reset a 'pending'
const PROCESSING_TTL_MINUTES = 10;

// UUID v4 regex — previene SQL injection via "invalid input syntax for type uuid"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Edge Function principal ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  const runLog: {
    queue_id: string;
    status: "emitted" | "failed" | "integrity_error" | "skipped";
    serie?: string;
    student?: string;
    amount?: number;
    error?: string;
  }[] = [];

  let zombiesReset = 0;

  // ══════════════════════════════════════════════════════════════════════
  // MODO PRIORIDAD: si llega un queue_id específico (desde DB webhook o
  // llamada directa de izipay-webhook), procesar SOLO ese registro sin
  // esperar el lote completo. Esto garantiza < 10 segundos hasta el PDF.
  // ══════════════════════════════════════════════════════════════════════
  let specificQueueId: string | null = null;
  try {
    const body = await req.json();
    if (body?.queue_id && UUID_RE.test(body.queue_id)) {
      specificQueueId = body.queue_id;
      console.log(`[process-billing-queue] MODO PRIORIDAD: queue_id=${specificQueueId} source=${body.source ?? "direct"}`);
    }
  } catch (_) { /* body vacío o no JSON — modo lote normal */ }

  try {

    // ══════════════════════════════════════════════════════════════════════
    // PASO 1: Reset de zombies (TTL anti-bloqueo)
    //
    // Si un registro lleva más de PROCESSING_TTL_MINUTES en estado 'processing'
    // sin resolverse (caída del worker, error de red, etc.), lo devolvemos a
    // 'pending' para que este cron lo procese normalmente.
    //
    // Usa fn_reset_billing_queue_zombies: toda la lógica de tiempo en PostgreSQL
    // (Regla 11.C: reloj único — no usamos new Date() en JS para decidir TTL)
    // ══════════════════════════════════════════════════════════════════════
    const { data: zombieCount, error: zombieErr } = await supabase
      .rpc("fn_reset_billing_queue_zombies", { p_ttl_minutes: PROCESSING_TTL_MINUTES });

    if (!zombieErr && typeof zombieCount === "number") {
      zombiesReset = zombieCount;
      if (zombiesReset > 0) {
        console.log(`[process-billing-queue] ${zombiesReset} zombies reseteados a pending`);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // PASO 2: Obtener IDs de registros a procesar
    //
    // MODO PRIORIDAD (queue_id en body): solo ese registro.
    // MODO LOTE     (sin queue_id):      hasta MAX_PER_RUN registros FIFO.
    //
    // El bloqueo real ocurre en fn_build_billing_payload (FOR UPDATE SKIP LOCKED).
    // ══════════════════════════════════════════════════════════════════════
    // FASE 2A-fix: transaction_ids incluido en ambos caminos.
    // Para daily_summary/collection/pos_sale los IDs viven en billing_queue.transaction_ids
    // (no en el payload_snapshot que usa los campos legacy del flujo voucher).
    let pendingItems: { id: string; payload_snapshot?: unknown; emit_attempts?: number; transaction_ids?: string[] | null }[] | null;
    let fetchErr: { message: string } | null;

    if (specificQueueId) {
      // Modo prioridad: traer los mismos campos que el modo lote para que el
      // camino snapshot funcione igual (payload_snapshot, emit_attempts necesarios).
      const result = await supabase
        .from("billing_queue")
        .select("id, payload_snapshot, emit_attempts, transaction_ids")
        .eq("id", specificQueueId)
        .maybeSingle();
      pendingItems = result.data ? [result.data] : [];
      fetchErr = result.error;
    } else {
      // Modo lote: FIFO, máximo MAX_PER_RUN.
      // Se incluye payload_snapshot y emit_attempts para detectar el camino snapshot
      // sin una segunda consulta dentro del loop (reduce round-trips a la BD).
      const result = await supabase
        .from("billing_queue")
        .select("id, payload_snapshot, emit_attempts, transaction_ids")
        .eq("status", "pending")
        .lte("emit_attempts", 3)
        .order("created_at", { ascending: true })
        .limit(MAX_PER_RUN);
      pendingItems = result.data;
      fetchErr = result.error;
    }

    if (fetchErr) throw fetchErr;

    if (!pendingItems || pendingItems.length === 0) {
      return new Response(
        JSON.stringify({
          success:   true,
          message:   "No hay registros pendientes en billing_queue",
          processed: 0,
          zombies_reset: zombiesReset,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    console.log(`[process-billing-queue] ${pendingItems.length} registros pendientes — procesando...`);

    // ══════════════════════════════════════════════════════════════════════
    // PASO 3: Procesar cada registro de la cola
    // ══════════════════════════════════════════════════════════════════════
    for (const item of pendingItems) {
      const queueId = item.id as string;
      if (!UUID_RE.test(queueId)) continue;

      try {

        // ── PASO 3A: Obtener payload — dos caminos según origen de la fila ───
        //
        // CAMINO NUEVO (Fase 1B — flujo asíncrono):
        //   La fila tiene payload_snapshot congelado al encolar. Se usa TAL CUAL.
        //   Esto garantiza que el worker procesa los mismos datos que aprobó el
        //   usuario/sistema: montos, ítems, datos del cliente. Sin drift de datos.
        //
        // CAMINO LEGACY (Izipay / vouchers anteriores):
        //   Sin payload_snapshot → fn_build_billing_payload reconstruye el payload
        //   en tiempo real desde transactions, students, profiles. Retrocompatible.
        //   (Regla 0.A: el flujo Izipay no se toca.)
        //
        // El worker NO recibe montos del cliente. No hace aritmética.
        // Cumple Regla de Oro: CERO cálculos financieros fuera de la BD.

        let payload: Record<string, any> | null = null;
        const snapshotRaw = (item as any).payload_snapshot;

        if (snapshotRaw && typeof snapshotRaw === "object" && !Array.isArray(snapshotRaw)) {
          // ── Camino nuevo: snapshot congelado ─────────────────────────────
          // El UPDATE es atómico y solo aplica si status='pending'.
          // Si devuelve count=0 → otro worker ya tomó la fila → skip.
          const { count: lockCount, error: lockErr } = await supabase
            .from("billing_queue")
            .update({
              status:                "processing",
              processing_started_at: new Date().toISOString(),
              emit_attempts:         (item.emit_attempts ?? 0) + 1,
            })
            .eq("id", queueId)
            .eq("status", "pending")   // guard: solo tomar si sigue en pending
            .select("id", { count: "exact", head: true });

          if (lockErr || lockCount === 0) {
            runLog.push({ queue_id: queueId, status: "skipped", error: "LOCK_LOST" });
            continue;
          }

          payload = snapshotRaw as Record<string, any>;

        } else {
          // ── Camino legacy: fn_build_billing_payload ───────────────────────
          const { data: rpcPayload, error: rpcErr } = await supabase
            .rpc("fn_build_billing_payload", { p_queue_id: queueId });

          if (rpcErr) {
            await markFailed(supabase, queueId, `RPC_ERROR: ${rpcErr.message}`);
            runLog.push({ queue_id: queueId, status: "failed", error: rpcErr.message });
            continue;
          }

          if (rpcPayload?.error) {
            console.warn(`[process-billing-queue] ${queueId} no disponible: ${rpcPayload.error}`);
            runLog.push({ queue_id: queueId, status: "skipped", error: rpcPayload.error });
            continue;
          }

          payload = rpcPayload;
        }

        if (!payload) {
          await markFailed(supabase, queueId, "PAYLOAD_NULL: payload vacío tras RPC/snapshot.");
          runLog.push({ queue_id: queueId, status: "failed", error: "PAYLOAD_NULL" });
          continue;
        }

        // ── PASO 3B: Diferencia de monto — solo log, NUNCA bloqueo ──────────
        // Solo aplica al camino legacy donde fn_build_billing_payload calcula
        // la diferencia entre monto aprobado y monto real de transactions.
        // El camino snapshot no tiene este campo (el monto ya fue validado al encolar).
        if (!snapshotRaw && !payload.integrity_ok) {
          const diff = Math.abs((payload.amount_computed ?? 0) - (payload.amount_approved ?? 0));
          console.warn(
            `[process-billing-queue] ${queueId} — diferencia de monto S/${diff.toFixed(2)} ` +
            `(aprobado S/${payload.amount_approved}, calculado S/${payload.amount_computed}). ` +
            `Emitiendo boleta con monto calculado en BD. No se bloquea el flujo.`
          );
          // Continúa hacia generate-document — no se llama markFailed
        }

        // ── PASO 3C: Fecha de emisión — reloj único de PostgreSQL (Regla 11.C) ─
        // PROHIBIDO: new Date() ni offsets manuales en JS (dispositivo puede
        // estar mal sincronizado; Perú no tiene horario de verano pero el offset
        // fijo en código es frágil). La fuente de verdad temporal es la BD.
        const { data: limaDateRow, error: limaDateErr } = await supabase
          .rpc("get_lima_date_today");    // retorna TEXT 'YYYY-MM-DD'

        if (limaDateErr || !limaDateRow) {
          // Falla al obtener fecha Lima = problema de config/DB, no de Nubefact.
          // Tratar como transitorio: requeue conservando número reservado.
          await requeueTransient(
            supabase, queueId,
            `LIMA_DATE_ERROR: ${limaDateErr?.message ?? "respuesta nula"}`
          );
          runLog.push({ queue_id: queueId, status: "skipped", error: "LIMA_DATE_ERROR" });
          continue;
        }

        const emissionDate: string = limaDateRow as string;

        // Verificar extemporaneidad al momento de emitir, no solo al encolar.
        // days_since_sale se congeló al encolar (puede haber sido correcto ese día),
        // pero una fila que esperó en cola puede cruzar el límite de 7 días.
        {
          const { data: daysRow } = await supabase
            .rpc("get_days_since_queue_sale", { p_queue_id: queueId });
          const daysSinceSale = Number(daysRow ?? 0);
          if (daysSinceSale > 7) {
            await markBlockedExtemporaneo(
              supabase, queueId,
              `EXTEMPORANEO_EN_EMISION: ${daysSinceSale} días desde la venta (límite SUNAT: 7).`
            );
            runLog.push({ queue_id: queueId, status: "failed", error: "BLOCKED_EXTEMPORANEO" });
            continue;
          }
        }

        // ── PASO 3C-bis: RESERVAR correlativo (FASE 1B — garantía cero huecos) ─
        // El número se aparta y se PERSISTE en la fila ANTES de llamar a Nubefact.
        // Si esta fila ya tenía número reservado (reintento tras timeout), la RPC
        // devuelve EL MISMO número (idempotente), nunca uno nuevo.
        const { data: reservation, error: reserveErr } = await supabase
          .rpc("reserve_invoice_number_for_queue", { p_queue_id: queueId });

        if (reserveErr || !reservation || (reservation as any).error) {
          const rMsg =
            reserveErr?.message ||
            (reservation as any)?.detail ||
            (reservation as any)?.error ||
            "reserva nula";
          // Falla de reserva = problema de config/secuencia. Es transitorio: NO
          // marcar dead_letter (no se consumió un número útil). Volver a pending.
          await requeueTransient(supabase, queueId, `RESERVE_ERROR: ${rMsg}`);
          runLog.push({ queue_id: queueId, status: "skipped", error: `RESERVE_ERROR: ${rMsg}` });
          continue;
        }

        const reservedSerie  = (reservation as any).serie  as string;
        const reservedNumero = (reservation as any).numero as number;
        const reservedLabel  = `${reservedSerie}-${String(reservedNumero).padStart(8, "0")}`;

        // ── PASO 3C-ter: PRE-CHECK idempotente (Rama A1) ──────────────────────
        // Si un intento previo SÍ creó el invoice pero murió antes de marcar la
        // cola, el número ya está en `invoices`. No volver a llamar a Nubefact:
        // recuperar el invoice existente y marcar emitido.
        {
          const { data: preExisting } = await supabase
            .from("invoices")
            .select("id")
            .eq("school_id", payload.school_id)
            .eq("serie", reservedSerie)
            .eq("numero", reservedNumero)
            .maybeSingle();

          if (preExisting?.id) {
            console.log(`[process-billing-queue] ${queueId} — invoice ${reservedLabel} ya existe. Éxito idempotente sin Nubefact.`);
            const preCheckQueueTxIds: string[] = Array.isArray((item as any).transaction_ids)
              ? ((item as any).transaction_ids as string[]).filter((id: string) => UUID_RE.test(id))
              : [];
            await markEmittedAndLink(supabase, queueId, payload, preExisting.id, reservedSerie, reservedNumero, preCheckQueueTxIds);
            runLog.push({ queue_id: queueId, status: "emitted", serie: reservedLabel, student: payload.student_name, amount: payload.monto_total });
            continue;
          }
        }

        // ── PASO 3D: Llamar a generate-document con el número RESERVADO ────────
        // El payload viene ÍNTEGRO de PostgreSQL (cliente, items, monto, medio).
        // reserved_serie/reserved_numero le indican a generate-document que use
        // ESE número y que NO salte a otro ante "ya existe" (eso crea huecos).
        let genRes: Response;
        try {
          genRes = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
            method:  "POST",
            headers: {
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type":  "application/json",
            },
            body: JSON.stringify({
              school_id:       payload.school_id,
              tipo:            payload.tipo,
              emission_date:   emissionDate,
              cliente:         payload.cliente,
              items:           payload.items,
              monto_total:     payload.monto_total,
              payment_method:  payload.payment_method,
              transaction_id:  payload.single_transaction_id ?? null,
              reserved_serie:  reservedSerie,    // FASE 1B
              reserved_numero: reservedNumero,   // FASE 1B
            }),
          });
        } catch (netErr) {
          // TRANSITORIO: timeout / red caída. El número reservado se CONSERVA en
          // la fila. El próximo ciclo lo reutiliza (Rama A2). Cero huecos.
          await requeueTransient(supabase, queueId, `NETWORK: ${String(netErr)}`);
          runLog.push({ queue_id: queueId, status: "skipped", error: "NETWORK_TRANSIENT" });
          continue;
        }

        let genResult: {
          success?: boolean;
          error?: string;
          nubefact?: { errors?: string };
          documento?: {
            id?: string;
            serie?: string;
            numero?: number;
            pdf_url?: string;
            enlace_del_pdf?: string;
            enlace_pdf?: string;
            estado_sunat?: string;
            sunat_status?: string;
          };
        } | null = null;

        try {
          genResult = await genRes.json();
        } catch (_parseErr) {
          genResult = null;
        }

        if (!genResult?.success) {
          // ══ CLASIFICACIÓN DE ERRORES (FASE 1B) — sin optimismo ══════════════
          const errText = String(
            genResult?.error || genResult?.nubefact?.errors || `HTTP ${genRes.status}`
          );
          const lower = errText.toLowerCase();

          // (a) DUPLICADO sobre número reservado → reconciliar, NUNCA saltar número.
          if ((genResult as any)?.duplicate === true) {
            const { data: dupInv } = await supabase
              .from("invoices")
              .select("id")
              .eq("school_id", payload.school_id)
              .eq("serie", reservedSerie)
              .eq("numero", reservedNumero)
              .maybeSingle();

            if (dupInv?.id) {
              // El comprobante SÍ existe localmente: éxito idempotente.
              const dupQueueTxIds: string[] = Array.isArray((item as any).transaction_ids)
                ? ((item as any).transaction_ids as string[]).filter((id: string) => UUID_RE.test(id))
                : [];
              await markEmittedAndLink(supabase, queueId, payload, dupInv.id, reservedSerie, reservedNumero, dupQueueTxIds);
              runLog.push({ queue_id: queueId, status: "emitted", serie: reservedLabel, student: payload.student_name, amount: payload.monto_total });
              continue;
            }
            // Existe en Nubefact pero NO en nuestra BD → reconciliación manual.
            // Se conserva el número reservado; NO se mueve a dead_letter.
            await markFailedKeepReserved(
              supabase, queueId,
              `DUPLICATE_RESERVED: ${reservedLabel} existe en Nubefact sin invoice local. Reconciliar manualmente (consult-document).`,
            );
            runLog.push({ queue_id: queueId, status: "failed", error: "DUPLICATE_RESERVED_RECONCILE", serie: reservedLabel });
            continue;
          }

          // (b) EXTEMPORÁNEO / fecha / periodo → permanente, requiere gestión manual.
          if (lower.includes("extempor") || lower.includes("fecha de emision") ||
              lower.includes("fecha de emisión") || lower.includes("periodo") || lower.includes("período")) {
            await markBlockedExtemporaneo(supabase, queueId, errText);
            runLog.push({ queue_id: queueId, status: "failed", error: `BLOCKED_EXTEMPORANEO: ${errText.slice(0, 160)}`, serie: reservedLabel });
            continue;
          }

          // (c) TRANSITORIO (HTTP 5xx) → requeue conservando el número reservado.
          if (genRes.status >= 500) {
            await requeueTransient(supabase, queueId, `HTTP_5XX: ${errText}`);
            runLog.push({ queue_id: queueId, status: "skipped", error: "HTTP_5XX_TRANSIENT", serie: reservedLabel });
            continue;
          }

          // (d) Resto: error de contenido / rechazo SUNAT.
          //     Reintentable hasta agotar intentos; luego dead_letter.
          await markFailedOrDeadLetter(supabase, queueId, `NUBEFACT_ERROR: ${errText}`);
          runLog.push({ queue_id: queueId, status: "failed", student: payload.student_name, amount: payload.monto_total, error: errText, serie: reservedLabel });
          continue;
        }

        // ── PASO 3E: Éxito — actualizar billing_queue ─────────────────────
        const doc    = genResult.documento ?? {};
        const serie  = doc.serie && doc.numero
          ? `${doc.serie}-${String(doc.numero).padStart(8, "0")}`
          : null;
        const pdfUrl = doc.pdf_url ?? doc.enlace_del_pdf ?? doc.enlace_pdf ?? null;

        // Fallback robusto: algunos escenarios de generate-document pueden devolver
        // success=true pero documento.id nulo (p.ej. inserción no retornada).
        // En ese caso, resolver invoice_id por (school_id, serie, numero).
        let resolvedInvoiceId = doc.id ?? null;
        if (!resolvedInvoiceId && doc.serie && doc.numero) {
          const { data: invFallback, error: invFallbackErr } = await supabase
            .from("invoices")
            .select("id")
            .eq("school_id", payload.school_id)
            .eq("serie", doc.serie)
            .eq("numero", doc.numero)
            .maybeSingle();

          if (invFallbackErr) {
            console.warn(
              `[process-billing-queue] No se pudo resolver invoice_id fallback ${doc.serie}-${doc.numero}:`,
              invFallbackErr.message,
            );
          } else {
            resolvedInvoiceId = invFallback?.id ?? null;
          }
        }

        // FASE 2A-fix: invoice_id incluido en el UPDATE de éxito.
        // El camino legacy ya lo hacía via markEmittedAndLink; el camino snapshot
        // lo omitía. Ahora ambos caminos cierran la fila con invoice_id vinculado.
        await supabase
          .from("billing_queue")
          .update({
            status:               "emitted",
            invoice_id:           resolvedInvoiceId,    // ← fix: faltaba en camino snapshot
            processed_at:         new Date().toISOString(),
            nubefact_ticket:      serie,
            pdf_url:              pdfUrl,
            sunat_status:         doc.estado_sunat ?? doc.sunat_status ?? "emitido",
            error_message:        null,
            processing_started_at: null,
          })
          .eq("id", queueId);

        // ── PASO 3F: Marcar transacciones vinculadas como billing_status='sent' ─
        // FASE 2A-fix: para daily_summary/collection/pos_sale los IDs están en
        // billing_queue.transaction_ids, no en los campos legacy del payload.
        // Se leen del item ya cargado en memoria (sin round-trip extra a la BD).
        const invoiceId = resolvedInvoiceId;
        const queueTxIds: string[] = Array.isArray((item as any).transaction_ids)
          ? ((item as any).transaction_ids as string[]).filter((id: string) => UUID_RE.test(id))
          : [];
        await markTransactionsSent(
          supabase,
          payload.paid_transaction_ids  ?? [],
          payload.lunch_order_ids       ?? [],
          payload.single_transaction_id ?? null,
          payload.school_id,
          invoiceId,
          queueTxIds,                                   // ← fix: IDs del nuevo flujo
        );

        console.log(
          `[process-billing-queue] ✅ ${queueId} → ${serie ?? "emitido"} ` +
          `| S/ ${payload.monto_total} | ${payload.student_name}`
        );

        runLog.push({
          queue_id: queueId,
          status:   "emitted",
          serie:    serie ?? "OK",
          student:  payload.student_name,
          amount:   payload.monto_total,
        });

      } catch (itemErr) {
        // Captura errores inesperados (red, parsing, etc.) sin bloquear el resto
        const errMsg = `EXCEPTION: ${String(itemErr)}`;
        await markFailed(supabase, queueId, errMsg);
        runLog.push({ queue_id: queueId, status: "failed", error: errMsg });
      }

    } // end for pendingItems

    const emitted = runLog.filter(r => r.status === "emitted").length;
    const failed  = runLog.filter(r => r.status !== "emitted" && r.status !== "skipped").length;

    return new Response(
      JSON.stringify({
        success:       true,
        processed:     runLog.length,
        emitted,
        failed,
        zombies_reset: zombiesReset,
        results:       runLog,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (globalErr) {
    console.error("[process-billing-queue] Error global:", String(globalErr));
    return new Response(
      JSON.stringify({ success: false, error: String(globalErr) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Marca un registro de billing_queue como 'failed' con el mensaje de error exacto.
 * No lanza excepción para no bloquear el procesamiento del siguiente registro.
 */
async function markFailed(
  supabase: ReturnType<typeof createClient>,
  queueId:  string,
  errorMessage: string,
): Promise<void> {
  try {
    await supabase
      .from("billing_queue")
      .update({
        status:               "failed",
        error_message:        errorMessage.slice(0, 2000), // límite seguro para columna text
        processing_started_at: null,
      })
      .eq("id", queueId);
  } catch (_) { /* best-effort: si falla el update, el zombie TTL lo limpiará */ }

  console.error(`[process-billing-queue] ❌ ${queueId}: ${errorMessage.slice(0, 200)}`);
}

/**
 * FASE 1B — Devuelve la fila a 'pending' SIN borrar reserved_serie/numero.
 * Esto es lo que permite que un reintento reutilice el MISMO correlativo
 * (cero huecos). Se usa para fallas TRANSITORIAS: timeout, red, HTTP 5xx,
 * o error de reserva de configuración.
 */
async function requeueTransient(
  supabase: ReturnType<typeof createClient>,
  queueId:  string,
  reason:   string,
): Promise<void> {
  try {
    await supabase
      .from("billing_queue")
      .update({
        status:                "pending",
        processing_started_at: null,
        error_message:         reason.slice(0, 2000),
      })
      .eq("id", queueId);
  } catch (_) { /* best-effort: el TTL anti-zombie lo recupera */ }
  console.warn(`[process-billing-queue] ↩️ ${queueId} requeue transitorio: ${reason.slice(0, 200)}`);
}

/**
 * FASE 1B — Marca 'blocked_extemporaneo': SUNAT no acepta el comprobante por
 * antigüedad/fecha. Estado PERMANENTE que exige gestión manual del contador.
 * Conserva el número reservado para trazabilidad; no lo libera ni lo salta.
 */
async function markBlockedExtemporaneo(
  supabase: ReturnType<typeof createClient>,
  queueId:  string,
  reason:   string,
): Promise<void> {
  try {
    await supabase
      .from("billing_queue")
      .update({
        status:                "blocked_extemporaneo",
        fatal_reason:          reason.slice(0, 2000),
        error_message:         reason.slice(0, 2000),
        processing_started_at: null,
      })
      .eq("id", queueId);
  } catch (_) { /* best-effort */ }
  console.error(`[process-billing-queue] 🚫 ${queueId} BLOQUEADO extemporáneo: ${reason.slice(0, 200)}`);
}

/**
 * FASE 1B — Marca 'failed' conservando el número reservado, sin tocar el contador
 * de intentos. Para el caso DUPLICATE_RESERVED que necesita reconciliación manual.
 */
async function markFailedKeepReserved(
  supabase: ReturnType<typeof createClient>,
  queueId:  string,
  reason:   string,
): Promise<void> {
  try {
    await supabase
      .from("billing_queue")
      .update({
        status:                "failed",
        error_message:         reason.slice(0, 2000),
        processing_started_at: null,
      })
      .eq("id", queueId);
  } catch (_) { /* best-effort */ }
  console.error(`[process-billing-queue] ⚠️ ${queueId} failed (reconciliar): ${reason.slice(0, 200)}`);
}

/**
 * FASE 1B — Falla de CONTENIDO (datos inválidos / rechazo SUNAT). Si quedan
 * intentos (emit_attempts < 3) deja 'failed' (reintentable tras corrección);
 * si se agotaron, mueve a 'dead_letter' (rechazo permanente, no se reintenta solo).
 */
async function markFailedOrDeadLetter(
  supabase: ReturnType<typeof createClient>,
  queueId:  string,
  reason:   string,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let attempts = 0;
  try {
    const { data: row } = await supabase
      .from("billing_queue")
      .select("emit_attempts")
      .eq("id", queueId)
      .maybeSingle();
    attempts = Number((row as { emit_attempts?: number } | null)?.emit_attempts ?? 0);
  } catch (_) { /* si no se puede leer, se trata como reintentable */ }

  const status = attempts >= MAX_ATTEMPTS ? "dead_letter" : "failed";
  const patch: Record<string, unknown> = {
    status,
    error_message:         reason.slice(0, 2000),
    processing_started_at: null,
  };
  if (status === "dead_letter") patch.fatal_reason = reason.slice(0, 2000);

  try {
    await supabase.from("billing_queue").update(patch).eq("id", queueId);
  } catch (_) { /* best-effort */ }
  console.error(`[process-billing-queue] ${status === "dead_letter" ? "💀" : "❌"} ${queueId} ${status} (intentos=${attempts}): ${reason.slice(0, 200)}`);
}

/**
 * FASE 1B/2A — Marca 'emitted' y vincula invoice cuando el comprobante ya existe
 * (recuperación idempotente: el invoice se creó en un intento previo, pero la
 * cola no alcanzó a marcarse). Replica el cierre de éxito normal.
 *
 * FASE 2A-fix: acepta queueTransactionIds para cerrar correctamente los jobs de
 * daily_summary / collection / pos_sale que almacenan los IDs en la columna
 * billing_queue.transaction_ids en lugar de en los campos legacy del payload.
 */
async function markEmittedAndLink(
  supabase:            ReturnType<typeof createClient>,
  queueId:             string,
  payload:             any,
  invoiceId:           string,
  serie:               string,
  numero:              number,
  queueTransactionIds: string[] = [],
): Promise<void> {
  try {
    await supabase
      .from("billing_queue")
      .update({
        status:                "emitted",
        invoice_id:            invoiceId,
        processed_at:          new Date().toISOString(),
        nubefact_ticket:       `${serie}-${String(numero).padStart(8, "0")}`,
        error_message:         null,
        processing_started_at: null,
      })
      .eq("id", queueId);
  } catch (_) { /* best-effort */ }

  await markTransactionsSent(
    supabase,
    Array.isArray(payload?.paid_transaction_ids) ? payload.paid_transaction_ids : [],
    Array.isArray(payload?.lunch_order_ids)       ? payload.lunch_order_ids       : [],
    payload?.single_transaction_id ?? null,
    payload?.school_id,
    invoiceId,
    queueTransactionIds,
  );
}

/**
 * Actualiza billing_status='sent' + invoice_id en las transacciones vinculadas.
 *
 * Nota sobre la arquitectura: esto es una actualización de ESTADO administrativo,
 * no un cálculo financiero. El monto ya fue procesado en fn_build_billing_payload.
 * Los IDs de transacciones provienen del RPC (validados con school_id guard).
 *
 * FASE 2A-fix: nuevo parámetro queueTransactionIds para cubrir los jobs de
 * daily_summary / collection / pos_sale. Sus IDs no están en los campos legacy
 * del payload sino en billing_queue.transaction_ids. Se deduplican con Set para
 * no enviar el mismo ID dos veces si ambas fuentes lo traen (flujo voucher batch).
 */
async function markTransactionsSent(
  supabase:            ReturnType<typeof createClient>,
  paidTransactionIds:  string[],
  lunchOrderIds:       string[],
  singleTransactionId: string | null,
  schoolId:            string,
  invoiceId:           string | null,
  queueTransactionIds: string[] = [],
): Promise<void> {

  const updateData: Record<string, unknown> = { billing_status: "sent" };
  if (invoiceId && UUID_RE.test(invoiceId)) {
    updateData.invoice_id = invoiceId;
  }

  // Unión deduplicada: IDs legacy + IDs del nuevo flujo Fase 2A.
  // Set elimina duplicados sin alterar el significado del UPDATE.
  const directIds = [...new Set([
    ...paidTransactionIds.filter(id => UUID_RE.test(id)),
    ...(singleTransactionId && UUID_RE.test(singleTransactionId) ? [singleTransactionId] : []),
    ...queueTransactionIds.filter(id => UUID_RE.test(id)),
  ])];

  if (directIds.length > 0) {
    const { error: txUpdateErr } = await supabase
      .from("transactions")
      .update(updateData)
      .in("id", directIds)
      .eq("school_id", schoolId);  // guard multi-sede
    if (txUpdateErr) {
      // Log crítico: si invoice_id no existe en transactions o hay otro error de esquema
      // el administrador debe revisar la migración de la columna transactions.invoice_id
      console.error(
        `[markTransactionsSent] ERROR actualizando transactions (ids=${directIds.join(",")}) ` +
        `invoice_id=${invoiceId}: ${txUpdateErr.code} ${txUpdateErr.message} | ${txUpdateErr.details ?? ""}`,
      );
    } else {
      console.log(
        `[markTransactionsSent] ✅ ${directIds.length} transaction(s) vinculada(s) → invoice_id=${invoiceId}`,
      );
    }
  }

  // Actualizar por lunch_order_id en metadata
  // (necesario porque lunch_order_ids son IDs de ordenes, no de transacciones)
  const validLunchIds = lunchOrderIds.filter(id => UUID_RE.test(id));
  for (const lunchId of validLunchIds) {
    try {
      const { data: txRows } = await supabase
        .from("transactions")
        .select("id")
        .eq("school_id", schoolId)
        .filter("metadata->>lunch_order_id", "eq", lunchId);

      if (txRows && txRows.length > 0) {
        const txIds = txRows
          .map((r: { id: string }) => r.id)
          .filter((id: string) => UUID_RE.test(id));

        if (txIds.length > 0) {
          await supabase
            .from("transactions")
            .update(updateData)
            .in("id", txIds)
            .eq("school_id", schoolId);
        }
      }
    } catch (_) { /* no crítico: la boleta ya fue emitida */ }
  }
}
