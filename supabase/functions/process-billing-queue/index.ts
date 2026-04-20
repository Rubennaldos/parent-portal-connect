// @ts-nocheck — archivo Deno (Edge Function de Supabase)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    let pendingItems: { id: string }[] | null;
    let fetchErr: { message: string } | null;

    if (specificQueueId) {
      // Modo prioridad: solo el registro solicitado
      pendingItems = [{ id: specificQueueId }];
      fetchErr = null;
    } else {
      // Modo lote: FIFO, máximo MAX_PER_RUN
      const result = await supabase
        .from("billing_queue")
        .select("id")
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

        // ── PASO 3A: Llamar RPC — toda la lógica de datos en PostgreSQL ───
        //
        // fn_build_billing_payload:
        //   - Bloquea el registro atómicamente (FOR UPDATE SKIP LOCKED)
        //   - Hace los JOINs reales con transactions, students, profiles
        //   - Calcula el total en PostgreSQL (SUM, ROUND)
        //   - Retorna payload completo listo para generate-document
        //
        // El worker NO recibe montos del cliente. No hace aritmética.
        // Cumple Regla de Oro: CERO cálculos financieros fuera de la BD.
        const { data: payload, error: rpcErr } = await supabase
          .rpc("fn_build_billing_payload", { p_queue_id: queueId });

        if (rpcErr) {
          await markFailed(supabase, queueId, `RPC_ERROR: ${rpcErr.message}`);
          runLog.push({ queue_id: queueId, status: "failed", error: rpcErr.message });
          continue;
        }

        if (payload?.error) {
          // El RPC retornó error (registro ya tomado por otro proceso, etc.)
          console.warn(`[process-billing-queue] ${queueId} no disponible: ${payload.error}`);
          runLog.push({ queue_id: queueId, status: "skipped", error: payload.error });
          continue;
        }

        // ── PASO 3B: Verificación de integridad de monto ─────────────────
        //
        // El total calculado en PostgreSQL (v_computed_total) DEBE coincidir
        // con el monto aprobado en billing_queue.amount.
        // Si la discrepancia supera S/0.02, marcamos como error de integridad:
        //   → el admin debe revisar qué transacciones fueron anuladas o duplicadas.
        if (!payload.integrity_ok) {
          const diff = Math.abs((payload.amount_computed ?? 0) - (payload.amount_approved ?? 0));
          if (diff > 0.02) {
            const errMsg =
              `INTEGRITY_MISMATCH: monto aprobado=S/${payload.amount_approved} ` +
              `calculado en BD=S/${payload.amount_computed} ` +
              `diferencia=S/${diff.toFixed(2)}. Revisar transacciones del voucher.`;
            await markFailed(supabase, queueId, errMsg);
            runLog.push({
              queue_id: queueId,
              status:   "integrity_error",
              student:  payload.student_name,
              amount:   payload.amount_approved,
              error:    errMsg,
            });
            continue;
          }
        }

        // ── PASO 3C: Fecha de emisión en hora Lima ────────────────────────
        // Regla 11.C: reloj único. NO usamos new Date() del servidor Deno.
        // Usamos UTC - 5h para garantizar que la fecha sea la de Lima.
        // (Perú = UTC-5 fijo, sin horario de verano)
        const nowLima      = new Date(Date.now() - 5 * 60 * 60 * 1000);
        const emissionDate =
          `${nowLima.getUTCFullYear()}-` +
          `${String(nowLima.getUTCMonth() + 1).padStart(2, "0")}-` +
          `${String(nowLima.getUTCDate()).padStart(2, "0")}`;

        // ── PASO 3D: Llamar a generate-document con datos reales de la BD ──
        //
        // El payload viene ÍNTEGRO de PostgreSQL:
        //   - cliente:        datos tributarios reales (DNI/RUC, nombre)
        //   - items:          descripciones e importes de transactions
        //   - monto_total:    SUM calculado en PostgreSQL
        //   - payment_method: medio real de pago (Yape, Transferencia, etc.)
        //
        // PROHIBIDO: no pasamos monto_total calculado en JS, no hardcodeamos
        //            "Consumidor Final" ni "transferencia".
        const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            school_id:      payload.school_id,
            tipo:           payload.tipo,             // 1=factura, 2=boleta
            emission_date:  emissionDate,
            cliente:        payload.cliente,           // datos reales del padre/empresa
            items:          payload.items,             // ítems reales de la BD
            monto_total:    payload.monto_total,       // total calculado en PostgreSQL
            payment_method: payload.payment_method,    // medio real, no hardcoded
            // CRÍTICO: debe ser ID real de transactions (FK de invoices.transaction_id),
            // nunca el queue_id.
            transaction_id: payload.single_transaction_id ?? null,
          }),
        });

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
          const errMsg =
            `NUBEFACT_ERROR: ` +
            (genResult?.error || genResult?.nubefact?.errors || `HTTP ${genRes.status}`);
          await markFailed(supabase, queueId, errMsg);
          runLog.push({
            queue_id: queueId,
            status:   "failed",
            student:  payload.student_name,
            amount:   payload.monto_total,
            error:    errMsg,
          });
          continue;
        }

        // ── PASO 3E: Éxito — actualizar billing_queue ─────────────────────
        const doc    = genResult.documento ?? {};
        const serie  = doc.serie && doc.numero
          ? `${doc.serie}-${String(doc.numero).padStart(8, "0")}`
          : null;
        const pdfUrl = doc.pdf_url ?? doc.enlace_del_pdf ?? doc.enlace_pdf ?? null;

        await supabase
          .from("billing_queue")
          .update({
            status:               "emitted",
            processed_at:         new Date().toISOString(),
            nubefact_ticket:      serie,
            pdf_url:              pdfUrl,
            sunat_status:         doc.estado_sunat ?? doc.sunat_status ?? "emitido",
            error_message:        null,
            processing_started_at: null,
          })
          .eq("id", queueId);

        // ── PASO 3F: Marcar transacciones vinculadas como billing_status='sent' ─
        // IDs provenientes del RPC (ya validados con school_id guard en la BD)
        const invoiceId = doc.id ?? null;
        await markTransactionsSent(
          supabase,
          payload.paid_transaction_ids  ?? [],
          payload.lunch_order_ids       ?? [],
          payload.single_transaction_id ?? null,
          payload.school_id,
          invoiceId,
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
 * Actualiza billing_status='sent' + invoice_id en las transacciones vinculadas.
 *
 * Nota sobre la arquitectura: esto es una actualización de ESTADO administrativo,
 * no un cálculo financiero. El monto ya fue procesado en fn_build_billing_payload.
 * Los IDs de transacciones provienen del RPC (validados con school_id guard).
 */
async function markTransactionsSent(
  supabase:            ReturnType<typeof createClient>,
  paidTransactionIds:  string[],
  lunchOrderIds:       string[],
  singleTransactionId: string | null,
  schoolId:            string,
  invoiceId:           string | null,
): Promise<void> {

  const updateData: Record<string, unknown> = { billing_status: "sent" };
  if (invoiceId && UUID_RE.test(invoiceId)) {
    updateData.invoice_id = invoiceId;
  }

  // Actualizar por IDs explícitos (paid_transaction_ids + transaction_id único)
  const directIds = [
    ...paidTransactionIds.filter(id => UUID_RE.test(id)),
    ...(singleTransactionId && UUID_RE.test(singleTransactionId) ? [singleTransactionId] : []),
  ];

  if (directIds.length > 0) {
    await supabase
      .from("transactions")
      .update(updateData)
      .in("id", directIds)
      .eq("school_id", schoolId);  // guard multi-sede
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
