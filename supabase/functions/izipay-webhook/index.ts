// @ts-nocheck — archivo Deno (Edge Function de Supabase)
/**
 * izipay-webhook — REFACTORIZADO (Fase 0 IziPay Foundation)
 * ─────────────────────────────────────────────────────────────────
 * Recibe las notificaciones IPN de IziPay cuando el comprador completa
 * o falla el pago en el formulario embebido.
 *
 * FLUJO ACTUALIZADO (idempotente + atómico):
 *  1. Validar firma HMAC-SHA256 (igual que antes)
 *  2. Registrar evento en gateway_webhook_events
 *     → Si ya existe Y fue procesado exitosamente → retornar 200 (idempotente)
 *     → Si ya existe pero falló → reintentar procesamiento
 *     → Si es nuevo → continuar
 *  3. Actualizar payment_transactions → status = 'approved' / 'rejected'
 *  4. Si pago aprobado:
 *     a) Buscar payment_session vinculada (vía gateway_reference)
 *     b) Llamar apply_gateway_credit (RPC Caja Fuerte)
 *        — crea transacción contable + sube saldo en 1 operación atómica
 *        — es IDEMPOTENTE: segundo llamado con mismo orderId no hace nada
 *  5. Marcar gateway_webhook_events como procesado
 *  6. Responder 200 a IziPay
 *
 * SEGURIDAD CONTABLE:
 *  - apply_gateway_credit reemplaza la llamada directa a adjust_student_balance
 *  - El mismo orderId NUNCA genera 2 transacciones (índice único en BD)
 *  - Todos los créditos dejan rastro en transactions + trg_log_student_balance_change
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Calcula HMAC-SHA256 usando la Web Crypto API nativa de Deno (sin dependencias externas)
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gateway-name",
};

// Estados de IziPay que consideramos como PAGO APROBADO
const APPROVED_STATUSES = new Set(["PAID", "AUTHORISED", "CAPTURED"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST")   return json({ error: "Método no permitido" }, 405);

  // ── 1. Leer body raw (necesario para verificar HMAC) ─────────────────────
  const rawBody = await req.text();

  let ipnData: Record<string, unknown>;
  try {
    ipnData = JSON.parse(rawBody);
  } catch {
    return json({ error: "Body JSON inválido" }, 400);
  }

  // ── 2. Cliente Supabase con service_role ──────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 3. Obtener configuración de IziPay desde BD ───────────────────────────
  const { data: gwConfig, error: gwError } = await supabase
    .from("payment_gateway_config")
    .select("merchant_id, webhook_secret, is_active")
    .eq("gateway_name", "izipay")
    .single();

  if (gwError || !gwConfig?.webhook_secret) {
    console.error("[izipay-webhook] Configuración no disponible:", gwError);
    return json({ error: "Configuración de IziPay no disponible" }, 500);
  }

  // ── 4. Verificar firma HMAC-SHA256 ────────────────────────────────────────
  const receivedSignature = req.headers.get("kr-hash") ?? "";

  if (!receivedSignature) {
    console.warn("[izipay-webhook] IPN sin firma (kr-hash). Ignorando.");
    return json({ error: "Firma IPN ausente" }, 400);
  }

  let expectedSignature: string;
  try {
    expectedSignature = await hmacSha256Hex(gwConfig.webhook_secret, rawBody);
  } catch (e) {
    console.error("[izipay-webhook] Error calculando HMAC:", e);
    return json({ error: "Error interno al verificar firma" }, 500);
  }

  if (receivedSignature.toLowerCase() !== expectedSignature.toLowerCase()) {
    console.error("[izipay-webhook] Firma HMAC inválida. Posible spoofing.");
    return json({ error: "Firma de seguridad inválida" }, 401);
  }

  // ── 5. Extraer datos del IPN ──────────────────────────────────────────────
  let krAnswer: Record<string, unknown>;
  try {
    const raw = ipnData["kr-answer"] as string | undefined;
    if (!raw) throw new Error("kr-answer ausente");
    krAnswer = JSON.parse(raw);
  } catch (e) {
    console.error("[izipay-webhook] No se pudo parsear kr-answer:", e);
    return json({ error: "No se pudo leer la respuesta del IPN" }, 400);
  }

  const orderStatus     = (krAnswer.orderStatus as string | undefined) ?? "";
  const orderId         = (krAnswer.orderId     as string | undefined) ?? "";
  const transactionUuid = (krAnswer.transactions as any)?.[0]?.uuid ?? null;
  const paymentMethod   = (krAnswer.transactions as any)?.[0]?.paymentMethodType ?? "card";
  const shopId          = krAnswer.shopId as string | undefined;

  if (shopId && shopId !== gwConfig.merchant_id) {
    console.error(`[izipay-webhook] shopId (${shopId}) no coincide con el configurado`);
    return json({ error: "shopId no coincide" }, 401);
  }

  if (!orderId) {
    return json({ error: "orderId ausente en el IPN" }, 400);
  }

  const isApproved = APPROVED_STATUSES.has(orderStatus.toUpperCase());
  const newStatus  = isApproved ? "approved" : "rejected";

  console.log(`[izipay-webhook] orderId=${orderId} orderStatus=${orderStatus} → ${newStatus}`);

  // ── 6. IDEMPOTENCIA: registrar evento en gateway_webhook_events ───────────
  // Intento de INSERT; si ya existe (por el UNIQUE idx), hacemos upsert
  // para leer el registro existente y decidir si reprocesamos.
  const { data: existingEvent } = await supabase
    .from("gateway_webhook_events")
    .select("id, processed_at, processing_error")
    .eq("provider_name", "izipay")
    .eq("external_event_id", orderId)
    .maybeSingle();

  let webhookEventId: string | null = existingEvent?.id ?? null;

  if (existingEvent) {
    // El evento ya fue registrado antes
    if (existingEvent.processed_at && !existingEvent.processing_error) {
      // Ya procesado exitosamente → respuesta idempotente sin duplicar saldo
      console.log(`[izipay-webhook] orderId=${orderId} ya procesado (idempotente). Sin cambios.`);
      return json({ success: true, idempotent: true, orderId });
    }
    // Si falló antes → permitir reprocesamiento (caerá en la sección isApproved)
    console.log(`[izipay-webhook] orderId=${orderId} reintento (procesamiento anterior falló).`);
  } else {
    // Primer intento: registrar el evento
    const { data: newEvent } = await supabase
      .from("gateway_webhook_events")
      .insert({
        provider_name:     "izipay",
        external_event_id: orderId,
        payload:           ipnData,
        gateway_status:    isApproved ? "success" : "failed",
      })
      .select("id")
      .single();

    webhookEventId = newEvent?.id ?? null;
  }

  // ── 7. Actualizar payment_transactions ───────────────────────────────────
  const { error: updateTxError } = await supabase
    .from("payment_transactions")
    .update({
      status:                newStatus,
      transaction_reference: transactionUuid ?? null,
      payment_method:        paymentMethod,
      updated_at:            new Date().toISOString(),
      metadata: {
        izipay_order_status: orderStatus,
        izipay_kr_answer:    krAnswer,
        webhook_received_at: new Date().toISOString(),
      },
    })
    .eq("id", orderId);

  if (updateTxError) {
    console.error("[izipay-webhook] Error actualizando payment_transactions:", updateTxError);
    // Continuar — el crédito contable es más importante que este registro
  }

  // ── 8. Si pago aprobado → apply_gateway_credit (Caja Fuerte) ─────────────
  if (isApproved) {
    // Recuperar datos del alumno y la sesión de pago
    const { data: txRecord } = await supabase
      .from("payment_transactions")
      .select("user_id, student_id, amount, currency")
      .eq("id", orderId)
      .single();

    if (!txRecord) {
      const errMsg = `No se encontró payment_transaction con id=${orderId}`;
      console.error("[izipay-webhook]", errMsg);
      await markFailed(supabase, "izipay", orderId, webhookEventId, errMsg);
      // Devolver 200 para que IziPay no reintente (el problema es de datos, no de red)
      return json({ success: false, error: errMsg, orderId });
    }

    // Buscar la payment_session vinculada por gateway_reference = orderId
    const { data: session } = await supabase
      .from("payment_sessions")
      .select("id")
      .eq("gateway_reference", orderId)
      .maybeSingle();

    const sessionId = session?.id ?? null;

    // ── LLAMADA A LA CAJA FUERTE ──────────────────────────────────────────
    // apply_gateway_credit es IDEMPOTENTE: si ya existe una transacción
    // con gateway_reference_id = orderId, retorna sin duplicar.
    const { data: creditResult, error: creditError } = await supabase.rpc(
      "apply_gateway_credit",
      {
        p_student_id:     txRecord.student_id,
        p_amount:         txRecord.amount,
        p_session_id:     sessionId,
        p_gateway_ref_id: orderId,
        p_gateway_tx_id:  transactionUuid ?? null,
        p_payment_method: paymentMethod,
        p_description:    `Recarga online — IziPay (${paymentMethod}) ref:${orderId}`,
      }
    );

    if (creditError) {
      console.error("[izipay-webhook] apply_gateway_credit FALLÓ:", creditError);

      // Registrar el fallo en error_logs para que el admin pueda re-intentar
      await supabase.from("error_logs").insert({
        module:   "izipay-webhook",
        message:  "Pago IziPay aprobado pero fallo al acreditar saldo",
        context: {
          order_id:          orderId,
          transaction_uuid:  transactionUuid,
          student_id:        txRecord.student_id,
          amount:            txRecord.amount,
          rpc_error:         creditError.message,
        },
        resolved: false,
      }).catch(() => {/* no bloquear si error_logs falla */});

      // Marcar el webhook event como fallido para permitir reintento
      await markFailed(supabase, "izipay", orderId, webhookEventId, creditError.message);

      // Devolver 500 para que IziPay reintente el IPN
      return json({ success: false, error: "Error al acreditar saldo — se reintentará" }, 500);
    }

    const wasIdempotent = creditResult?.idempotent === true;
    console.log(
      `[izipay-webhook] Crédito aplicado a alumno ${txRecord.student_id}: ` +
      `+S/${txRecord.amount} (idempotente: ${wasIdempotent})`
    );

    // Marcar el webhook event como procesado exitosamente
    if (webhookEventId) {
      await supabase
        .from("gateway_webhook_events")
        .update({
          processed_at:       new Date().toISOString(),
          processing_error:   null,
          payment_session_id: sessionId,
          gateway_status:     "success",
        })
        .eq("id", webhookEventId);
    }

    return json({
      success:    true,
      idempotent: wasIdempotent,
      orderId,
      newStatus,
      creditResult,
    });
  }

  // ── 9. Pago rechazado / fallido ───────────────────────────────────────────
  if (webhookEventId) {
    await supabase
      .from("gateway_webhook_events")
      .update({
        processed_at:   new Date().toISOString(),
        gateway_status: "failed",
      })
      .eq("id", webhookEventId);
  }

  return json({ success: true, orderId, newStatus });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function markFailed(
  supabase: any,
  provider: string,
  eventId: string,
  webhookEventId: string | null,
  errorMsg: string
) {
  if (!webhookEventId) return;
  await supabase
    .from("gateway_webhook_events")
    .update({
      processing_error: errorMsg,
      gateway_status:   "failed",
    })
    .eq("id", webhookEventId);
}
