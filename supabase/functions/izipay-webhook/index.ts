// @ts-nocheck — archivo Deno (Edge Function de Supabase)
/**
 * izipay-webhook
 * ─────────────────────────────────────────────────────────────────
 * Recibe las notificaciones IPN de Izipay (Instant Payment Notification)
 * cuando el comprador completa o falla el pago en el formulario embebido.
 *
 * Flujo:
 *  1. Izipay llama a esta URL con POST cuando hay un evento de pago
 *  2. Esta función valida la firma HMAC-SHA256 usando webhook_secret
 *     almacenado en payment_gateway_config → NUNCA expuesto al frontend
 *  3. Si la firma es válida y el pago fue aprobado:
 *     a) Actualiza payment_transactions → status = 'approved'
 *     b) Crea / aprueba una recharge_request para sumar el saldo al alumno
 *        (si aplica — solo para recargas de saldo; los pagos de deuda tienen su propio flujo)
 *  4. Si el pago falló o fue rechazado, marca la transacción como 'rejected'
 *
 * Campos usados de payment_gateway_config:
 *  - webhook_secret  → clave HMAC para validar la firma del IPN
 *  - merchant_id     → shopId (confirmar que el IPN es de nuestra tienda)
 *
 * Registro en la URL de Izipay:
 *  Panel Izipay → Configuración de la tienda → URL de notificación IPN
 *  → https://<tu-proyecto>.supabase.co/functions/v1/izipay-webhook
 *  → Header personalizado: x-gateway-name: izipay
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gateway-name",
};

// ── Códigos de resultado de Izipay que consideramos APROBADOS ────────────────
const APPROVED_TRANSACTION_STATUSES = new Set(["PAID", "AUTHORISED", "CAPTURED"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Izipay solo llama con POST
  if (req.method !== "POST") {
    return json({ success: false, error: "Método no permitido" }, 405);
  }

  // ── 1. Leer el cuerpo raw (necesitamos el texto para validar la firma) ────
  const rawBody = await req.text();

  let ipnData: Record<string, unknown>;
  try {
    ipnData = JSON.parse(rawBody);
  } catch {
    return json({ success: false, error: "Body JSON inválido" }, 400);
  }

  // ── 2. Supabase service_role para leer credenciales y actualizar BD ───────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 3. Obtener webhook_secret y merchant_id desde payment_gateway_config ──
  const { data: gwConfig, error: gwError } = await supabase
    .from("payment_gateway_config")
    .select("merchant_id, webhook_secret, is_active")
    .eq("gateway_name", "izipay")
    .single();

  if (gwError || !gwConfig) {
    console.error("[izipay-webhook] No se encontró configuración de Izipay:", gwError);
    return json({ success: false, error: "Configuración de Izipay no disponible" }, 500);
  }

  if (!gwConfig.webhook_secret) {
    // Sin webhook_secret configurado no podemos validar la firma → rechazamos por seguridad
    console.error("[izipay-webhook] webhook_secret no configurado. Configúralo en SuperAdmin → Izipay.");
    return json({
      success: false,
      error:   "Webhook secret no configurado. Ingresa el 'Webhook Secret' en el panel de SuperAdmin.",
    }, 500);
  }

  // ── 4. VALIDACIÓN DE FIRMA HMAC-SHA256 ────────────────────────────────────
  //
  // Izipay calcula:
  //   signature = HMAC-SHA256(kr-hash-key, SHA256(rawBody))
  //
  // Los headers del IPN incluyen:
  //   kr-hash        → firma enviada por Izipay
  //   kr-hash-key    → indica cuál clave usar ("password" o "sha256_key")
  //   kr-hash-algorithm → "sha256_hmac"
  //
  // Para mayor seguridad, siempre usamos el webhook_secret guardado en BD
  // independientemente del kr-hash-key recibido.

  const receivedSignature  = req.headers.get("kr-hash") ?? "";
  const hashAlgorithm      = req.headers.get("kr-hash-algorithm") ?? "";

  if (!receivedSignature) {
    console.warn("[izipay-webhook] IPN sin firma (kr-hash). Ignorando.");
    return json({ success: false, error: "Firma IPN ausente" }, 400);
  }

  // Calcular firma esperada: HMAC-SHA256(webhook_secret, rawBody)
  let expectedSignature: string;
  try {
    expectedSignature = hmac("sha256", gwConfig.webhook_secret, rawBody, "utf8", "hex") as string;
  } catch (sigErr) {
    console.error("[izipay-webhook] Error calculando HMAC:", sigErr);
    return json({ success: false, error: "Error interno al verificar firma" }, 500);
  }

  if (receivedSignature.toLowerCase() !== expectedSignature.toLowerCase()) {
    console.error("[izipay-webhook] Firma HMAC inválida. Posible spoofing.");
    console.error("  Recibida: ", receivedSignature);
    console.error("  Esperada: ", expectedSignature);
    return json({ success: false, error: "Firma de seguridad inválida" }, 401);
  }

  // ── 5. Extraer datos del IPN ──────────────────────────────────────────────
  //
  // Estructura típica del IPN de Izipay:
  // {
  //   "kr-hash": "...",
  //   "kr-hash-key": "sha256_key",
  //   "kr-hash-algorithm": "sha256_hmac",
  //   "kr-answer-type": "V4/Payment",
  //   "kr-answer": "{...json codificado...}"
  // }
  //
  // El payload real del pago viene en "kr-answer" (string JSON)

  let krAnswer: Record<string, unknown>;
  try {
    const krAnswerRaw = ipnData["kr-answer"] as string | undefined;
    if (!krAnswerRaw) throw new Error("kr-answer ausente");
    krAnswer = JSON.parse(krAnswerRaw);
  } catch (parseErr) {
    console.error("[izipay-webhook] No se pudo parsear kr-answer:", parseErr);
    return json({ success: false, error: "No se pudo leer la respuesta del IPN" }, 400);
  }

  // Campos clave del pago
  const orderStatus      = (krAnswer.orderStatus as string | undefined) ?? "";
  const orderId          = (krAnswer.orderId as string | undefined) ?? "";           // = nuestro payment_transactions.id
  const transactionUuid  = (krAnswer.transactions as any)?.[0]?.uuid ?? null;
  const paymentMethod    = (krAnswer.transactions as any)?.[0]?.paymentMethodType ?? "card";
  const shopId           = krAnswer.shopId as string | undefined;

  // Confirmar que el IPN es para nuestra tienda
  if (shopId && shopId !== gwConfig.merchant_id) {
    console.error(`[izipay-webhook] shopId del IPN (${shopId}) no coincide con el configurado (${gwConfig.merchant_id})`);
    return json({ success: false, error: "shopId no coincide" }, 401);
  }

  if (!orderId) {
    return json({ success: false, error: "orderId ausente en el IPN" }, 400);
  }

  // ── 6. Determinar estado final ────────────────────────────────────────────
  const isApproved = APPROVED_TRANSACTION_STATUSES.has(orderStatus.toUpperCase());
  const newStatus  = isApproved ? "approved" : "rejected";

  console.log(`[izipay-webhook] orderId=${orderId} orderStatus=${orderStatus} → ${newStatus}`);

  // ── 7. Actualizar payment_transactions ───────────────────────────────────
  const { error: updateTxError } = await supabase
    .from("payment_transactions")
    .update({
      status:                 newStatus,
      transaction_reference:  transactionUuid ?? null,
      payment_method:         paymentMethod,
      updated_at:             new Date().toISOString(),
      // Guardar la respuesta completa de Izipay para auditoría
      metadata: {
        izipay_order_status: orderStatus,
        izipay_kr_answer:    krAnswer,
        webhook_received_at: new Date().toISOString(),
      },
    })
    .eq("id", orderId);

  if (updateTxError) {
    console.error("[izipay-webhook] Error actualizando payment_transactions:", updateTxError);
    // No abortamos — intentamos continuar para no perder el IPN
  }

  // ── 8. Si el pago fue aprobado: crear recharge_request y sumar saldo ─────
  if (isApproved) {
    // Obtener los datos de la transacción para saber qué alumno recarga
    const { data: txRecord } = await supabase
      .from("payment_transactions")
      .select("user_id, student_id, amount, currency")
      .eq("id", orderId)
      .single();

    if (txRecord) {
      // Crear recharge_request aprobada (el saldo se suma vía adjust_student_balance RPC)
      const { error: rrError } = await supabase.rpc("adjust_student_balance", {
        p_student_id:   txRecord.student_id,
        p_amount:       txRecord.amount,
        p_description:  `Recarga online — Izipay (${paymentMethod})`,
        p_payment_method: paymentMethod,
        p_source:       "izipay_webhook",
        p_reference:    transactionUuid ?? orderId,
      });

      if (rrError) {
        console.error("[izipay-webhook] Error al sumar saldo con adjust_student_balance:", rrError);
        // Registrar el fallo para que el admin pueda re-intentar manualmente
        await supabase.from("error_logs").insert({
          module:   "izipay-webhook",
          message:  "Pago aprobado pero fallo al sumar saldo",
          context: {
            order_id:   orderId,
            student_id: txRecord.student_id,
            amount:     txRecord.amount,
            rpc_error:  rrError.message,
          },
        }).catch(() => {/* error_logs opcional */});
      } else {
        console.log(`[izipay-webhook] Saldo sumado a alumno ${txRecord.student_id}: +${txRecord.amount}`);
      }
    }
  }

  // ── 9. Responder 200 a Izipay ─────────────────────────────────────────────
  // Izipay re-intentará el IPN si no recibe HTTP 200 dentro del tiempo límite
  return json({ success: true, orderId, newStatus });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
