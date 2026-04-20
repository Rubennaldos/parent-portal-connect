// @ts-nocheck — archivo Deno (Edge Function de Supabase)
/**
 * izipay-webhook — PENTÁGONO DE SEGURIDAD v2
 * ─────────────────────────────────────────────────────────────────
 * REGLA 2 (CONFIANZA CRIPTOGRÁFICA):
 *   HMAC-SHA256 + timingSafeEqual se valida ANTES de crear el cliente
 *   Supabase y ANTES de cualquier acceso a la base de datos.
 *   Si la firma no coincide → 401 inmediato, sin tocar la DB.
 *
 * REGLA 3 (IDEMPOTENCIA ATÓMICA):
 *   `logs_pasarela` es el CANDADO PRIMARIO. Si ya existe una fila con
 *   status='applied' para este orderId, devolvemos 200 sin tocar nada.
 *   `gateway_webhook_events` es un registro histórico secundario.
 *
 * REGLA 4 (VAULT ONLY):
 *   IZIPAY_WEBHOOK_SECRET + IZIPAY_MERCHANT_ID solo desde Deno.env.
 *   El cliente Supabase se crea con service_role (también desde Deno.env).
 *
 * REGLA 5 (LOG-THEN-COMMIT):
 *   El INSERT en logs_pasarela ocurre ANTES de llamar apply_gateway_credit.
 *   Si el RPC falla, el log queda en status='error' para auditoría manual.
 *
 * ORDEN DE OPERACIONES:
 *  1. Leer body crudo (sin DB)
 *  2. Leer secretos desde Deno.env (sin DB)
 *  3. Verificar HMAC → 401 si falla (sin DB)
 *  4. Parsear JSON (sin DB)
 *  5. Crear cliente Supabase (primer contacto DB)
 *  6. Extraer orderId / datos IPN
 *  7. Verificar shopId
 *  8. CHECK logs_pasarela → idempotencia primaria (no re-acreditar si ya='applied')
 *  9. INSERT logs_pasarela (status='received') — LOG ANTES DE COMMIT
 * 10. Verificar/registrar gateway_webhook_events (idempotencia secundaria)
 * 11. Actualizar payment_transactions
 * 12. Si aprobado → apply_gateway_credit → actualizar logs_pasarela
 * 13. Responder 200 a IziPay
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Helpers criptográficos ─────────────────────────────────────────────────────
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

// ── Constantes ────────────────────────────────────────────────────────────────
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gateway-name",
};

const APPROVED_STATUSES = new Set(["PAID", "AUTHORISED", "CAPTURED"]);

// ── Handler principal ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST")   return json({ error: "Método no permitido" }, 405);

  // ══════════════════════════════════════════════════════════════════════
  // PASO 1 — Leer body RAW (sin DB, sin autenticación)
  // ══════════════════════════════════════════════════════════════════════
  const rawBody = await req.text();

  // ══════════════════════════════════════════════════════════════════════
  // PASO 2 — Leer SECRETOS desde Deno.env (REGLA 4 — VAULT ONLY)
  //          NO crear cliente Supabase todavía. NO tocar la DB.
  // ══════════════════════════════════════════════════════════════════════
  const webhookSecret   = (Deno.env.get("IZIPAY_WEBHOOK_SECRET") ?? "").trim();
  const rawMerchantId   = (Deno.env.get("IZIPAY_MERCHANT_ID")    ?? "").trim();
  const rawAllowedShops = (Deno.env.get("IZIPAY_ALLOWED_SHOP_IDS") ?? "").trim();

  if (!webhookSecret || !rawMerchantId) {
    console.error("[izipay-webhook] CRÍTICO: Faltan secretos en Vault (IZIPAY_WEBHOOK_SECRET / IZIPAY_MERCHANT_ID).");
    return json({ error: "Configuración segura no disponible" }, 500);
  }

  // shopId permitidos:
  // - IZIPAY_MERCHANT_ID (normalizado)
  // - IZIPAY_ALLOWED_SHOP_IDS (CSV opcional)
  // - fallback explícito para entorno actual (tienda + afiliación)
  const merchantBaseId = rawMerchantId.split(/[;:]/)[0]?.trim();
  const envAllowedShopIds = rawAllowedShops
    ? rawAllowedShops.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const allowedShopIds = Array.from(new Set([
    merchantBaseId,
    ...envAllowedShopIds,
    "19723694", // tienda
    "5822183",  // afiliación
  ].filter(Boolean)));

  // ══════════════════════════════════════════════════════════════════════
  // PASO 3 — Parsear body: soporta JSON y application/x-www-form-urlencoded
  //
  // IziPay V4 REST puede enviar el IPN en cualquiera de los dos formatos:
  //   - application/json        → { "kr-hash":"...", "kr-answer":"{...}" }
  //   - application/x-www-form-urlencoded → kr-hash=...&kr-answer=%7B...%7D
  //
  // En ambos casos, el HMAC se calcula sobre el STRING de "kr-answer".
  // ══════════════════════════════════════════════════════════════════════
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  let ipnData: Record<string, unknown>;
  let krAnswerRaw: string;
  let receivedSig: string;

  let krHashKey = "sha256_hmac"; // valor por defecto

  if (contentType.includes("application/x-www-form-urlencoded")) {
    // ── Formato URL-encoded (el que usa IziPay en producción) ─────────
    // URLSearchParams URL-decodifica automáticamente los valores.
    // El HMAC de Lyra se calcula sobre el valor DECODIFICADO de kr-answer.
    const params = new URLSearchParams(rawBody);
    receivedSig  = (params.get("kr-hash") ?? "").trim().toLowerCase();
    krAnswerRaw  = params.get("kr-answer") ?? "";
    krHashKey    = (params.get("kr-hash-key") ?? "sha256_hmac").trim().toLowerCase();

    // Construir ipnData para logs y compatibilidad con el resto del código
    ipnData = {};
    for (const [k, v] of params.entries()) ipnData[k] = v;

    console.log(
      "[izipay-webhook] IPN formato form-urlencoded. Claves:",
      [...params.keys()].join(", "),
      "| kr-hash-key:", krHashKey,
    );
  } else {
    // ── Formato JSON (fallback / pruebas locales) ─────────────────────
    try {
      ipnData = JSON.parse(rawBody);
    } catch {
      console.error("[izipay-webhook] Body no es JSON ni form-urlencoded. Raw:", rawBody.slice(0, 300));
      return json({ error: "Formato de body no soportado" }, 400);
    }
    receivedSig = ((ipnData["kr-hash"] as string | undefined) ?? "").trim().toLowerCase();
    krAnswerRaw = (ipnData["kr-answer"] as string | undefined) ?? "";
    krHashKey   = ((ipnData["kr-hash-key"] as string | undefined) ?? "sha256_hmac").trim().toLowerCase();

    console.log(
      "[izipay-webhook] IPN formato JSON. Claves:",
      Object.keys(ipnData).join(", "),
      "| kr-hash-key:", krHashKey,
    );
  }

  // ── Validar que los campos obligatorios estén presentes ───────────────
  if (!receivedSig) {
    console.warn("[izipay-webhook] kr-hash ausente. Claves recibidas:", Object.keys(ipnData).join(", "));
    return json({ error: "Firma IPN ausente" }, 400);
  }

  if (!krAnswerRaw) {
    console.error("[izipay-webhook] kr-answer ausente en el IPN.");
    return json({ error: "kr-answer ausente en IPN" }, 400);
  }

  // ── Seleccionar clave HMAC según kr-hash-key (estándar Lyra V4) ──────
  //
  //   kr-hash-key = "sha256_hmac" → usar IZIPAY_HMAC_SHA256  (Back Office → "Clave HMAC SHA-256")
  //   kr-hash-key = "password"    → usar IZIPAY_API_PASSWORD  (la contraseña de la cuenta API)
  //
  // Esto es crítico: IziPay elige qué clave usar y lo informa en kr-hash-key.
  // Si usamos la clave incorrecta, el HMAC nunca va a coincidir.
  const hmacSha256Key  = (Deno.env.get("IZIPAY_HMAC_SHA256")  ?? "").trim();
  const apiPassword    = (Deno.env.get("IZIPAY_API_PASSWORD") ?? "").trim();

  let hmacKey: string;
  if (krHashKey === "password") {
    // IziPay usó la contraseña API como clave de firma
    hmacKey = apiPassword || webhookSecret;
    console.log("[izipay-webhook] Usando clave: IZIPAY_API_PASSWORD (kr-hash-key=password)");
  } else {
    // kr-hash-key = "sha256_hmac" (o desconocido → default seguro)
    hmacKey = hmacSha256Key || webhookSecret;
    console.log("[izipay-webhook] Usando clave: IZIPAY_HMAC_SHA256 (kr-hash-key=sha256_hmac)");
  }

  if (!hmacKey) {
    console.error("[izipay-webhook] CRÍTICO: No hay clave HMAC disponible en Vault para kr-hash-key=" + krHashKey);
    return json({ error: "Clave de firma no configurada en el servidor" }, 500);
  }

  let expectedSig: string;
  try {
    expectedSig = await hmacSha256Hex(hmacKey, krAnswerRaw);
  } catch (e) {
    console.error("[izipay-webhook] Error calculando HMAC:", e);
    return json({ error: "Error interno al verificar firma" }, 500);
  }

  if (!timingSafeEqual(receivedSig, expectedSig.toLowerCase())) {
    console.error(
      "[izipay-webhook] Firma HMAC INVÁLIDA.",
      `kr-hash-key usado: ${krHashKey}`,
      `Recibido: ${receivedSig.slice(0, 12)}...`,
      `Calculado: ${expectedSig.slice(0, 12)}...`,
      "Si kr-hash-key=password, verifica IZIPAY_API_PASSWORD en Vault.",
      "Si kr-hash-key=sha256_hmac, verifica IZIPAY_HMAC_SHA256 en Vault.",
    );
    return json({ error: "Firma de seguridad inválida" }, 401);
  }

  console.log("[izipay-webhook] ✅ Firma HMAC verificada. Procesando pago...");

  // ══════════════════════════════════════════════════════════════════════
  // PASO 5 — Crear cliente Supabase (PRIMER contacto con la DB)
  //          Solo llega aquí si la firma es válida.
  // ══════════════════════════════════════════════════════════════════════
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ══════════════════════════════════════════════════════════════════════
  // PASO 6 — Parsear kr-answer (ya fue extraído y validado en PASO 3)
  // ══════════════════════════════════════════════════════════════════════
  let krAnswer: Record<string, unknown>;
  try {
    krAnswer = JSON.parse(krAnswerRaw);
  } catch (e) {
    console.error("[izipay-webhook] No se pudo parsear kr-answer como JSON:", e);
    console.error("[izipay-webhook] kr-answer(raw) snippet:", krAnswerRaw.slice(0, 300));
    return json({ error: "No se pudo leer la respuesta del IPN", reason: "INVALID_KR_ANSWER_JSON" }, 400);
  }

  const orderStatus     = (krAnswer.orderStatus as string | undefined) ?? "";
  // IziPay puede enviar orderId en rutas distintas según integración/config.
  const orderIdCandidates = [
    (krAnswer.orderId as string | undefined),
    ((krAnswer as any)?.orderDetails?.orderId as string | undefined),
    ((krAnswer as any)?.orderDetails?.order_id as string | undefined),
    ((krAnswer as any)?.transactions?.[0]?.orderId as string | undefined),
    ((krAnswer as any)?.transactions?.[0]?.order_id as string | undefined),
  ];
  const orderId = (
    orderIdCandidates.find((v) => typeof v === "string" && v.trim().length > 0) ?? ""
  ).trim();
  const transactionUuid = (krAnswer.transactions as any)?.[0]?.uuid           ?? null;
  const paymentMethod   = (krAnswer.transactions as any)?.[0]?.paymentMethodType ?? "card";
  const shopId          = krAnswer.shopId as string | undefined;

  if (!orderId) {
    console.error(
      "[izipay-webhook] orderId ausente en kr-answer.",
      "keys:", Object.keys(krAnswer).join(", "),
      "orderIdCandidates:", JSON.stringify(orderIdCandidates),
    );
    return json({ error: "orderId ausente en el IPN", reason: "ORDER_ID_MISSING" }, 400);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PASO 7 — Verificar shopId contra Vault (segunda barrera de seguridad)
  // ══════════════════════════════════════════════════════════════════════
  if (shopId && !allowedShopIds.includes(shopId)) {
    console.error(
      `[izipay-webhook] shopId mismatch: recibido='${shopId}' permitidos='${allowedShopIds.join(",")}'`,
    );
    return json({ error: "shopId no coincide con el registrado" }, 401);
  }

  const isApproved = APPROVED_STATUSES.has(orderStatus.toUpperCase());
  const newStatus  = isApproved ? "approved" : "rejected";

  console.log(`[izipay-webhook] orderId=${orderId} orderStatus=${orderStatus} → ${newStatus}`);

  // ══════════════════════════════════════════════════════════════════════
  // PASO 8 — IDEMPOTENCIA PRIMARIA: verificar logs_pasarela (REGLA 3)
  //          Si ya fue aplicado → devolver 200 SIN tocar nada más.
  // ══════════════════════════════════════════════════════════════════════
  const { data: existingLog } = await supabase
    .from("logs_pasarela")
    .select("id, status")
    .eq("provider_name", "izipay")
    .eq("gateway_reference_id", orderId)
    .maybeSingle();

  if (existingLog?.status === "applied" || existingLog?.status === "idempotent") {
    console.log(`[izipay-webhook] orderId=${orderId} ya aplicado en logs_pasarela. Respuesta idempotente.`);
    return json({ success: true, idempotent: true, orderId, newStatus });
  }

  // ══════════════════════════════════════════════════════════════════════
  // PASO 9 — LOG ANTES DE COMMIT (REGLA 5 — TRAZABILIDAD FORENSE)
  //          Insertar en logs_pasarela ANTES de llamar al RPC.
  //          Si el RPC falla, el log queda en status='error' para auditoría.
  // ══════════════════════════════════════════════════════════════════════
  {
    const { error: lpUpsertErr } = await supabase
      .from("logs_pasarela")
      .upsert(
        {
          provider_name:          "izipay",
          gateway_reference_id:   orderId,
          gateway_transaction_id: transactionUuid ?? null,
          payment_transaction_id: orderId,
          event_type:             "webhook",
          status:                 isApproved ? "received" : "rejected",
          payload:                ipnData,
        },
        { onConflict: "provider_name,gateway_reference_id" },
      );
    if (lpUpsertErr) console.error("[izipay-webhook] No se pudo registrar logs_pasarela:", lpUpsertErr.message);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PASO 10 — IDEMPOTENCIA SECUNDARIA: gateway_webhook_events (histórico)
  // ══════════════════════════════════════════════════════════════════════
  const { data: existingEvent } = await supabase
    .from("gateway_webhook_events")
    .select("id, processed_at, processing_error")
    .eq("provider_name", "izipay")
    .eq("external_event_id", orderId)
    .maybeSingle();

  let webhookEventId: string | null = existingEvent?.id ?? null;

  if (existingEvent) {
    if (existingEvent.processed_at && !existingEvent.processing_error) {
      // Este path solo se llega si logs_pasarela NO tenía status='applied'
      // (raro, puede pasar si la tabla fue limpiada manualmente).
      // Por seguridad, devolvemos 200 igualmente.
      console.log(`[izipay-webhook] orderId=${orderId} en gateway_webhook_events como procesado. Idempotente.`);
      return json({ success: true, idempotent: true, orderId, newStatus });
    }
    console.log(`[izipay-webhook] orderId=${orderId} reintento (procesamiento anterior falló).`);
  } else {
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

  // ══════════════════════════════════════════════════════════════════════
  // PASO 11 — Actualizar payment_transactions
  // ══════════════════════════════════════════════════════════════════════
  await supabase
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
    .eq("id", orderId)
    .then(({ error }) => {
      if (error) console.error("[izipay-webhook] Error actualizando payment_transactions:", error);
    });

  // ══════════════════════════════════════════════════════════════════════
  // PASO 12 — Si pago APROBADO → apply_gateway_credit (Caja Fuerte)
  // ══════════════════════════════════════════════════════════════════════
  if (isApproved) {
    console.log(`[izipay-webhook] PASO-12 START orderId="${orderId}" (tipo: ${typeof orderId}, len: ${orderId.length})`);

    // ── Buscar payment_transaction por orderId ────────────────────────
    const { data: txRecord, error: txLookupError } = await supabase
      .from("payment_transactions")
      .select("user_id, student_id, amount, currency")
      .eq("id", orderId)
      .single();

    console.log(`[izipay-webhook] PASO-12 txRecord:`, JSON.stringify(txRecord ?? null));
    if (txLookupError) console.error(`[izipay-webhook] PASO-12 txLookupError:`, txLookupError.message, "code:", txLookupError.code);

    if (!txRecord) {
      const errMsg = `payment_transaction no encontrada para orderId=${orderId} (DB error: ${txLookupError?.message ?? "sin fila"})`;
      console.error("[izipay-webhook]", errMsg);
      await failLog(supabase, orderId, webhookEventId, errMsg);
      // 200 para evitar reintento infinito (el problema es de datos, no de red)
      return json({ success: false, error: errMsg, orderId });
    }

    const { data: session, error: sessionLookupError } = await supabase
      .from("payment_sessions")
      .select("id, invoice_type, invoice_client_data, debt_tx_ids")
      .eq("gateway_reference", orderId)
      .maybeSingle();

    const sessionId            = session?.id ?? null;
    const sessionInvoiceType   = (session as any)?.invoice_type   as string | null ?? null;
    const sessionInvoiceClient = (session as any)?.invoice_client_data as Record<string, unknown> | null ?? null;
    const sessionDebtTxIds = Array.isArray((session as any)?.debt_tx_ids)
      ? ((session as any).debt_tx_ids as unknown[]).filter((v) => typeof v === "string" && v.length > 0) as string[]
      : [];

    console.log(
      `[izipay-webhook] PASO-12 session: id=${sessionId ?? "NULL"} | student_id=${txRecord.student_id} amount=${txRecord.amount}`,
      sessionLookupError ? `| sessionError: ${sessionLookupError.message}` : "",
    );

    const rpcParams = {
      p_student_id:     txRecord.student_id,
      p_amount:         txRecord.amount,
      p_session_id:     sessionId,
      p_gateway_ref_id: orderId,
      p_gateway_tx_id:  transactionUuid ?? null,
      p_payment_method: paymentMethod,
      p_description:    `Recarga online — IziPay (${paymentMethod}) ref:${orderId}`,
    };
    console.log(`[izipay-webhook] PASO-12 llamando apply_gateway_credit con:`, JSON.stringify(rpcParams));

    const { data: creditResult, error: creditError } = await supabase.rpc(
      "apply_gateway_credit",
      rpcParams,
    );

    console.log(`[izipay-webhook] PASO-12 creditResult:`, JSON.stringify(creditResult ?? null));
    if (creditError) console.error(`[izipay-webhook] PASO-12 creditError:`, creditError.message, "| code:", creditError.code, "| details:", creditError.details);

    if (creditError) {
      console.error("[izipay-webhook] apply_gateway_credit FALLÓ:", creditError);

      const { error: errLogErr } = await supabase.from("error_logs").insert({
        module:    "izipay-webhook",
        message:   "Pago IziPay aprobado pero fallo al acreditar saldo",
        context: {
          order_id:         orderId,
          transaction_uuid: transactionUuid,
          student_id:       txRecord.student_id,
          amount:           txRecord.amount,
          rpc_error:        creditError.message,
        },
        resolved: false,
      });
      if (errLogErr) console.warn("[izipay-webhook] No se pudo guardar en error_logs:", errLogErr.message);

      await failLog(supabase, orderId, webhookEventId, creditError.message);

      // 500 → IziPay reintentará el IPN
      return json({ success: false, error: "Error al acreditar saldo — se reintentará" }, 500);
    }

    const wasIdempotent = creditResult?.idempotent === true;
    const creditTxId    = (creditResult as any)?.transaction_id as string | null ?? null;
    console.log(
      `[izipay-webhook] Crédito aplicado: alumno=${txRecord.student_id} ` +
      `+S/${txRecord.amount} idempotente=${wasIdempotent} txId=${creditTxId}`,
    );

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

    {
      const { error: lpAppliedErr } = await supabase
        .from("logs_pasarela")
        .update({
          status:        wasIdempotent ? "idempotent" : "applied",
          processed_at:  new Date().toISOString(),
          error_message: null,
        })
        .eq("provider_name", "izipay")
        .eq("gateway_reference_id", orderId);
      if (lpAppliedErr) console.warn("[izipay-webhook] No se pudo marcar logs_pasarela applied:", lpAppliedErr.message);
    }

    // ── FORZAR payment_sessions.gateway_status = 'success' ───────────────────
    // CRÍTICO: apply_gateway_credit puede no actualizar payment_sessions si la
    // sesión ya fue marcada 'expired' (por el guard de 1 minuto). Este UPDATE
    // garantiza que GatewayPaymentWaiting siempre vea el estado correcto.
    // Se hace por sessionId (preferido) o por gateway_reference como fallback.
    if (sessionId) {
      const { error: psErr1 } = await supabase
        .from("payment_sessions")
        .update({ gateway_status: "success", status: "completed", completed_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (psErr1) console.warn("[izipay-webhook] No se pudo actualizar payment_sessions (by id):", psErr1.message);
    } else {
      const { error: psErr2 } = await supabase
        .from("payment_sessions")
        .update({ gateway_status: "success", status: "completed", completed_at: new Date().toISOString() })
        .eq("gateway_reference", orderId)
        .eq("gateway_name",      "izipay");
      if (psErr2) console.warn("[izipay-webhook] No se pudo actualizar payment_sessions (by ref):", psErr2.message);
    }

    // ── CIERRE CONTABLE DE DEUDAS SELECCIONADAS (debt_tx_ids) ─────────────────
    // Si el pago IziPay fue exitoso, además de acreditar recarga debemos cerrar
    // las compras pendientes incluidas en esta sesión para que no sigan visibles.
    if (sessionDebtTxIds.length > 0) {
      const { data: clearedDebts, error: clearDebtErr } = await supabase
        .from("transactions")
        .update({
          payment_status: "paid",
          payment_method: paymentMethod ?? "card",
        })
        .in("id", sessionDebtTxIds)
        .eq("student_id", txRecord.student_id)
        .eq("type", "purchase")
        .eq("payment_status", "pending")
        .neq("is_deleted", true)
        .select("id");

      if (clearDebtErr) {
        console.error(
          "[izipay-webhook] No se pudieron cerrar debt_tx_ids tras pago exitoso:",
          clearDebtErr.message,
          "orderId:", orderId,
          "debt_tx_ids:", JSON.stringify(sessionDebtTxIds),
        );
      } else {
        console.log(
          `[izipay-webhook] Deudas cerradas por IziPay: ${clearedDebts?.length ?? 0}/${sessionDebtTxIds.length} orderId=${orderId}`,
        );
      }
    } else {
      console.log(`[izipay-webhook] Sin debt_tx_ids en la sesión. orderId=${orderId}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PASO 12b — BILLING EN TIEMPO REAL: INSERT SÍNCRONO en billing_queue
    //
    // REGLA DE ORO: El INSERT en billing_queue es OBLIGATORIO y se hace
    // de forma síncrona ANTES de responder a IziPay. Si falla, se loguea
    // con detalle. Solo el invoke de process-billing-queue es fire-and-forget.
    //
    // DIAGNÓSTICO: Si creditTxId es null (apply_gateway_credit no retornó
    // transaction_id), se busca el TX por gateway_reference como fallback.
    // ══════════════════════════════════════════════════════════════════════

    // Saltar facturación solo en pagos idempotentes (ya facturados antes)
    if (!wasIdempotent) {

      // ── 1. Resolver creditTxId con fallback por gateway_reference ──────────
      let resolvedTxId: string | null = creditTxId;

      if (!resolvedTxId) {
        console.warn(
          `[izipay-webhook][billing] creditTxId es null — creditResult:`,
          JSON.stringify(creditResult ?? null),
          `Buscando TX por gateway_reference_id=${orderId}`,
        );
        const { data: fallbackTx, error: fallbackErr } = await supabase
          .from("transactions")
          .select("id")
          .eq("gateway_reference_id", orderId)
          .eq("student_id", txRecord.student_id)
          .eq("type", "credit")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackErr) {
          console.error("[izipay-webhook][billing] Error buscando TX fallback:", fallbackErr.message);
        }
        resolvedTxId = fallbackTx?.id ?? null;

        if (resolvedTxId) {
          console.log(`[izipay-webhook][billing] TX encontrado por fallback: ${resolvedTxId}`);
        } else {
          console.error(
            "[izipay-webhook][billing] ⛔ No se encontró TX de crédito para orderId=" + orderId +
            " — billing_queue NO insertado. Revisar apply_gateway_credit."
          );
        }
      }

      if (resolvedTxId) {
        // ── 2. Obtener school_id del alumno ─────────────────────────────────
        const { data: studentData, error: studentErr } = await supabase
          .from("students")
          .select("school_id")
          .eq("id", txRecord.student_id)
          .maybeSingle();

        const schoolId = (studentData as any)?.school_id as string | null ?? null;

        if (studentErr) {
          console.error("[izipay-webhook][billing] Error obteniendo school_id:", studentErr.message);
        }

        if (!schoolId) {
          console.error(
            "[izipay-webhook][billing] ⛔ Sin school_id para alumno=" + txRecord.student_id +
            " — billing_queue NO insertado."
          );
        } else {
          // ── 3. Marcar TX como taxable / pending antes del insert ───────────
          await supabase
            .from("transactions")
            .update({ is_taxable: true, billing_status: "pending" })
            .eq("id", resolvedTxId);

          // ── 4. Preparar invoice_client_data ─────────────────────────────────
          const invoiceClientData = sessionInvoiceClient
            ? {
                name:    (sessionInvoiceClient as any).razon_social ?? (sessionInvoiceClient as any).name    ?? null,
                dni_ruc: (sessionInvoiceClient as any).doc_number   ?? (sessionInvoiceClient as any).dni_ruc ?? null,
                email:   (sessionInvoiceClient as any).email        ?? null,
                address: (sessionInvoiceClient as any).direccion    ?? (sessionInvoiceClient as any).address ?? null,
              }
            : null;

          // ── 5. INSERT en billing_queue — SÍNCRONO y OBLIGATORIO ─────────────
          console.log(
            `[izipay-webhook][billing] Insertando billing_queue: tx=${resolvedTxId} ` +
            `school=${schoolId} amount=${txRecord.amount} invoice_type=${sessionInvoiceType ?? "boleta"}`
          );

          const { data: queueEntry, error: queueInsertErr } = await supabase
            .from("billing_queue")
            .insert({
              transaction_id:      resolvedTxId,
              recharge_request_id: null,
              student_id:          txRecord.student_id,
              school_id:           schoolId,
              amount:              txRecord.amount,
              invoice_type:        sessionInvoiceType ?? "boleta",
              invoice_client_data: invoiceClientData,
              status:              "pending",
            })
            .select("id")
            .single();

          if (queueInsertErr || !queueEntry?.id) {
            // Log DETALLADO — nunca ignorar este error
            console.error(
              "[izipay-webhook][billing] ⛔ FALLO INSERT billing_queue:",
              queueInsertErr?.message ?? "sin id retornado",
              "| code:", queueInsertErr?.code ?? "N/A",
              "| details:", queueInsertErr?.details ?? "N/A",
              "| hint:", queueInsertErr?.hint ?? "N/A",
              "| tx:", resolvedTxId, "| school:", schoolId,
            );
          } else {
            console.log(
              `[izipay-webhook][billing] ✅ billing_queue insertado id=${queueEntry.id} ` +
              `tx=${resolvedTxId} alumno=${txRecord.student_id} S/${txRecord.amount}`
            );

            // ── 6. Invocar process-billing-queue (fire-and-forget) ─────────────
            // El DB trigger pg_net ya dispara automáticamente; esta llamada directa
            // garantiza < 10 segundos de latencia.
            const invokeTask = supabase.functions.invoke("process-billing-queue", {
              body: { queue_id: queueEntry.id, source: "izipay_webhook_direct" },
            }).then((res: any) => {
              if (res.error) {
                console.warn("[izipay-webhook][billing] process-billing-queue error (no crítico):", res.error.message);
              } else {
                const data = res.data as any;
                console.log(
                  `[izipay-webhook][billing] process-billing-queue resultado:`,
                  JSON.stringify(data?.results?.[0] ?? data ?? null),
                );
              }
            }).catch((e: Error) => {
              console.warn("[izipay-webhook][billing] invoke falló (no crítico — DB trigger como respaldo):", e.message);
            });

            if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
              (globalThis as any).EdgeRuntime.waitUntil(invokeTask);
            }
          }
        }
      }
    } else {
      console.log(`[izipay-webhook][billing] Pago idempotente — billing_queue ya existente para orderId=${orderId}`);
    }

    return json({
      success:    true,
      idempotent: wasIdempotent,
      orderId,
      newStatus,
      creditResult,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // PASO 13 — Pago rechazado / fallido (sin cambios de saldo)
  // ══════════════════════════════════════════════════════════════════════
  if (webhookEventId) {
    await supabase
      .from("gateway_webhook_events")
      .update({ processed_at: new Date().toISOString(), gateway_status: "failed" })
      .eq("id", webhookEventId);
  }

  {
    const { error: lpRejErr } = await supabase
      .from("logs_pasarela")
      .update({ status: "rejected", processed_at: new Date().toISOString() })
      .eq("provider_name", "izipay")
      .eq("gateway_reference_id", orderId);
    if (lpRejErr) console.warn("[izipay-webhook] No se pudo marcar logs_pasarela rejected:", lpRejErr.message);
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

async function failLog(
  supabase: any,
  orderId: string,
  webhookEventId: string | null,
  errorMsg: string,
) {
  if (webhookEventId) {
    const { error: fwErr } = await supabase
      .from("gateway_webhook_events")
      .update({ processing_error: errorMsg, gateway_status: "failed" })
      .eq("id", webhookEventId);
    if (fwErr) console.warn("[izipay-webhook] failLog: no se pudo actualizar gateway_webhook_events:", fwErr.message);
  }
  const { error: flErr } = await supabase
    .from("logs_pasarela")
    .update({
      status:        "error",
      error_message: errorMsg,
      processed_at:  new Date().toISOString(),
    })
    .eq("provider_name", "izipay")
    .eq("gateway_reference_id", orderId);
  if (flErr) console.warn("[izipay-webhook] failLog: no se pudo actualizar logs_pasarela:", flErr.message);
}
