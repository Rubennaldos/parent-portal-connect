// @ts-nocheck — archivo Deno (Edge Function de Supabase)
/**
 * izipay-create-order — PENTÁGONO DE SEGURIDAD v2.3
 * v2.3: Logs de debug eliminados (PCI DSS hygiene). Solo logs operativos.
 * v2.2: Auth via supabase.auth.getUser() + .neq('is_deleted', true) NULL-safe.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IZIPAY_API_URL = "https://api.micuentaweb.pe";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const TAG = "[izipay-create-order]";

  // ── GUARDIA GLOBAL: cualquier excepción no capturada devuelve CORS headers ─
  // Sin esto, un crash inesperado hace que el navegador vea "CORS error"
  // en vez del error real (porque no hay respuesta → no hay headers).
  try {
    return await handleRequest(req, TAG);
  } catch (unexpectedErr) {
    console.error(`${TAG} CRASH no capturado:`, unexpectedErr);
    return json({
      success: false,
      error:   "Error interno inesperado en el servidor",
      detail:  String(unexpectedErr),
    }, 500);
  }
});

async function handleRequest(req: Request, TAG: string): Promise<Response> {

  // ── 1. Secretos Vault ─────────────────────────────────────────────────────
  const supabaseUrl   = Deno.env.get("SUPABASE_URL")!;
  const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey       = Deno.env.get("SUPABASE_ANON_KEY")!;
  const envMerchantId = (Deno.env.get("IZIPAY_MERCHANT_ID")  ?? "").trim();
  const apiUsername   = (Deno.env.get("IZIPAY_API_USERNAME") ?? "").trim();
  const apiPassword   = (Deno.env.get("IZIPAY_API_PASSWORD") ?? "").trim();
  const envPublicKey  = (Deno.env.get("IZIPAY_PUBLIC_KEY")   ?? "").trim();

  if (!envMerchantId || !apiUsername || !apiPassword) {
    console.error(`${TAG} CRÍTICO: Faltan secretos en Vault.`);
    return json({ success: false, error: "Credenciales IziPay incompletas en Vault (IZIPAY_MERCHANT_ID / IZIPAY_API_USERNAME / IZIPAY_API_PASSWORD)." }, 500);
  }

  // ── 2. Autenticación ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ success: false, error: "No autorizado — token de sesión ausente" }, 401);
  }

  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const supabaseUserClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await supabaseUserClient.auth.getUser(bearerToken);

  if (authError || !authData?.user?.id) {
    return json({ success: false, error: "Sesión inválida o expirada" }, 401);
  }
  const callerUserId = authData.user.id;
  const callerEmail  = authData.user.email ?? "cliente@limacafe28.pe";

  // ── 3. Parsear body ───────────────────────────────────────────────────────
  let rawText = "";
  try {
    rawText = await req.text();
  } catch (e) {
    console.error(`${TAG} No se pudo leer el body:`, e);
    return json({ success: false, error: "No se pudo leer el cuerpo del request" }, 400);
  }

  let body: {
    studentId?:        string;
    orderId?:          string;
    paid_tx_ids?:      string[];
    recharge_surplus?: number;
    currency?:         string;
  };
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    return json({ success: false, error: "Body JSON inválido — verifica el Content-Type del request" }, 400);
  }

  const {
    studentId,
    orderId,
    paid_tx_ids      = [],
    recharge_surplus = 0,
    currency         = "PEN",
  } = body ?? {};

  const normalizedOrderId = orderId || crypto.randomUUID();

  if (!studentId) {
    return json({ success: false, error: "Campo 'studentId' requerido — verifica que el modal envíe el ID del alumno" }, 400);
  }
  // ── 4. Cliente service_role ───────────────────────────────────────────────
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 5. Verificar ownership ────────────────────────────────────────────────
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, school_id, parent_id")
    .eq("id", studentId)
    .eq("parent_id", callerUserId)
    .maybeSingle();

  if (studentError) {
    return json({ success: false, error: `Error al verificar el alumno: ${studentError.message}` }, 500);
  }
  if (!student) {
    return json({ success: false, error: `Alumno '${studentId}' no pertenece al padre autenticado (userId: ${callerUserId})` }, 403);
  }

  // ── 5b. Limpiar sesiones expiradas y verificar sesión activa ─────────────
  // Prevención del ataque "doble pestaña": si ya existe una sesión IziPay
  // activa (pending/processing) para este alumno, rechazamos la solicitud.
  // Primero expiramos sesiones fantasma para liberar el candado.
  await supabase.rpc("expire_stale_gateway_sessions").catch(() => {});

  const { data: activeSession } = await supabase
    .rpc("check_active_gateway_session", {
      p_student_id: studentId,
      p_gateway:    "izipay",
    });

  if (activeSession && activeSession.length > 0) {
    const sess = activeSession[0];
    // Guard window = 90 s desde created_at (independiente de expires_at)
    const guardExpiresAt    = new Date(sess.created_at).getTime() + 90_000;
    const expiresInSeconds  = Math.max(5, Math.ceil((guardExpiresAt - Date.now()) / 1_000));
    return json({
      success:            false,
      error_code:         "SESSION_ACTIVE",
      error:              `Ya hay un pago en proceso para este alumno. Espera ${expiresInSeconds} segundos o usa "Verificar pago".`,
      expires_in_seconds: expiresInSeconds,
      active_session_id:  sess.session_id,
    }, 409);
  }

  // ── 5c. Limpiar sesiones pendientes antiguas del mismo alumno ──────────────
  // La constraint UNIQUE idx_ps_student_one_active_izipay bloquea el INSERT
  // del frontend si existe una sesión pending/processing de más de 90s.
  // La limpiamos aquí ANTES de devolver el token al cliente.
  // Usamos status (TEXT) para evitar problemas de tipo con gateway_status (ENUM).
  try {
    await supabase
      .from("payment_sessions")
      .update({ gateway_status: "expired", status: "expired" })
      .eq("student_id", studentId)
      .eq("gateway_name", "izipay")
      .not("status", "in", "(completed,failed,expired)")
      .lt("created_at", new Date(Date.now() - 90_000).toISOString());
  } catch (e) {
    console.warn(`${TAG} No se pudieron limpiar sesiones antiguas (no crítico):`, (e as Error)?.message ?? e);
  }

  // ── 6. Config operativa ───────────────────────────────────────────────────
  const { data: gwConfig, error: gwError } = await supabase
    .from("payment_gateway_config")
    .select("api_url, is_production, is_active, min_amount, max_amount, settings")
    .eq("gateway_name", "izipay")
    .single();

  if (!gwConfig?.is_active) {
    return json({ success: false, error: "La pasarela Izipay no está activa. Actívala en Configuración → Pasarela de Pagos." }, 503);
  }

  const maxAllowed = Number(gwConfig.max_amount ?? 10000);
  const minAllowed = Number(gwConfig.min_amount ?? 1);

  // ── 7. Calcular deudas desde DB (REGLA 1 — AUTORIDAD ÚNICA) ─────────────
  // FIX CLAVE: .neq('is_deleted', true) incluye filas donde is_deleted IS NULL.
  // .eq('is_deleted', false) NO incluye NULL — ese era el bug del 400.
  let debtAmount   = 0;
  let txFoundCount = 0;

  if (Array.isArray(paid_tx_ids) && paid_tx_ids.length > 0) {
    const { data: txRows, error: txError } = await supabase
      .from("transactions")
      .select("id, amount, payment_status, student_id")
      .in("id", paid_tx_ids)
      .eq("payment_status", "pending")
      .neq("is_deleted", true)        // NULL-safe: incluye is_deleted IS NULL y is_deleted = false
      .eq("student_id", studentId);

    if (txError) {
      console.error(`${TAG} Error en query de transactions:`, txError.message);
    } else if (txRows && txRows.length > 0) {
      txFoundCount = txRows.length;
      debtAmount   = txRows.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0);
    }

    if (txFoundCount === 0) {
      console.warn(`${TAG} ADVERTENCIA: ${paid_tx_ids.length} IDs enviados pero ninguna TX pending encontrada.`);
    }
  }

  const sanitizedRecharge = Math.max(0, Math.min(
    Math.round((Number(recharge_surplus) || 0) * 100) / 100,
    maxAllowed,
  ));

  const serverAmount = Math.round((debtAmount + sanitizedRecharge) * 100) / 100;

  if (serverAmount <= 0) {
    const detail = (paid_tx_ids?.length ?? 0) > 0
      ? `Se enviaron ${paid_tx_ids.length} ID(s) de deuda pero no se encontraron transacciones pendientes (puede que ya estén pagadas o eliminadas).`
      : "No hay deudas seleccionadas ni recarga en el carrito.";
    return json({ success: false, error: "Monto calculado S/ 0. Revisa que las deudas no estén ya pagadas o eliminadas" }, 400);
  }
  if (serverAmount < minAllowed) {
    return json({
      success: false,
      error:   `Monto calculado S/ ${serverAmount.toFixed(2)}. Revisa que las deudas no estén ya pagadas o eliminadas`,
    }, 400);
  }
  if (serverAmount > maxAllowed) {
    return json({
      success: false,
      error:   `Monto S/ ${serverAmount.toFixed(2)} supera el límite de S/ ${maxAllowed.toFixed(2)}.`,
    }, 400);
  }

  // ── 8. Construir payload Izipay ───────────────────────────────────────────
  const amountInCents = Math.round(serverAmount * 100);
  const baseUrl = (gwConfig.api_url || IZIPAY_API_URL).replace(/\/$/, "");

  // Fallback inteligente para INT_905:
  // 1) Usuario técnico explícito (IZIPAY_API_USERNAME)
  // 2) Usuario derivado del Merchant ID (cuando viene con sufijo ;publickey_... o :publickey_...)
  //    Ejemplo: "97547567;publickey_xxx" -> "97547567"
  const merchantDerivedUser = envMerchantId.split(/[;:]/)[0]?.trim() ?? "";
  const authUserCandidates = Array.from(
    new Set([apiUsername, merchantDerivedUser].filter((v) => !!v)),
  );

  if (authUserCandidates.length === 0) {
    return json(
      { success: false, error: "No hay usuario API para Izipay. Configura IZIPAY_API_USERNAME." },
      500,
    );
  }

  const publicKeyForKr =
    envMerchantId.includes(":")
      ? envMerchantId
      : envPublicKey
        || (gwConfig.settings as { public_key?: string } | null)?.public_key?.trim()
        || envMerchantId;

  const orderPayload = {
    amount:   amountInCents,
    currency: currency || "PEN",
    orderId:  normalizedOrderId,
    customer: { reference: callerUserId, email: callerEmail },
  };

  console.log(
    `${TAG} Llamando a Izipay → amountCents=${amountInCents}, orderId=${normalizedOrderId}, ` +
    `production=${baseUrl.includes("api.micuentaweb.pe")}`,
  );

  // ── 9. Llamar a Izipay ────────────────────────────────────────────────────
  let izipayResponse: Response | null = null;
  let izipayData: any = null;
  let authUsed = "";
  for (const candidateUser of authUserCandidates) {
    authUsed = candidateUser;
    const basicAuth = btoa(`${candidateUser}:${apiPassword}`);
    try {
      izipayResponse = await fetch(`${baseUrl}/api-payment/V4/Charge/CreatePayment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${basicAuth}`, // formato exacto: "Basic " + base64(user:pass)
        },
        body: JSON.stringify(orderPayload),
      });
    } catch (fetchErr) {
      console.error(`${TAG} Error de red hacia Izipay:`, fetchErr);
      return json({ success: false, error: "No se pudo conectar con Izipay. Verifica la conexión." }, 502);
    }

    izipayData = await izipayResponse.json().catch(() => null);
    const errorCode = izipayData?.answer?.errorCode ?? "N/A";

    if (izipayResponse.ok && izipayData?.status === "SUCCESS") break;

    // Si fue INT_905 y hay más candidatos, seguimos al siguiente usuario.
    if (errorCode === "INT_905" && candidateUser !== authUserCandidates[authUserCandidates.length - 1]) {
      console.warn(`${TAG} INT_905 con ${candidateUser.slice(0, 4)}****, probando siguiente credencial...`);
      continue;
    }

    // Cualquier otro caso: detener intentos.
    break;
  }

  if (!izipayResponse.ok || !izipayData) {
    return json({ success: false, error: `Izipay HTTP ${izipayResponse.status} — ${JSON.stringify(izipayData ?? {})}` }, 200);
  }
  if (izipayData.status !== "SUCCESS") {
    const errMsg  = izipayData.answer?.errorMessage ?? "Izipay rechazó la orden";
    const errCode = izipayData.answer?.errorCode    ?? "SIN_CODIGO";
    console.error(`${TAG} Rechazado por Izipay: [${errCode}] ${errMsg} (authUsed=${authUsed.slice(0, 4)}****)`);
    return json({
      success: false,
      error: `[${errCode}] ${errMsg}`,
      errorCode: errCode,
      authHint: `${authUsed.slice(0, 4)}****`,
    }, 200);
  }

  const formToken = izipayData.answer?.formToken;
  if (!formToken) {
    return json({ success: false, error: "Izipay respondió SUCCESS pero no devolvió formToken" }, 500);
  }

  // ── 10. Registrar en payment_transactions ────────────────────────────────
  const { error: upsertErr } = await supabase
    .from("payment_transactions")
    .upsert({
      id:              normalizedOrderId,
      user_id:         callerUserId,
      student_id:      studentId,
      amount:          serverAmount,
      currency:        currency,
      payment_gateway: "izipay",
      payment_method:  "pending_selection",
      status:          "pending",
      expired_at:      new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }, { onConflict: "id" });

  if (upsertErr) {
    console.warn(`${TAG} No se pudo registrar payment_transaction (no crítico):`, upsertErr.message);
  }

  // ── Construir paymentUrl para modo redirección (popup) ──────────────────
  const appBaseUrl = (Deno.env.get("APP_BASE_URL") ?? "https://parent-portal-connect.vercel.app").replace(/\/$/, "");
  const paymentUrl = `${appBaseUrl}/izipay-frame.html?token=${encodeURIComponent(formToken)}&key=${encodeURIComponent(publicKeyForKr)}`;

  console.log(`${TAG} ÉXITO → orderId=${normalizedOrderId}, serverAmount=${serverAmount}, paymentUrl construida`);

  return json({
    success:         true,
    formToken:       formToken,
    paymentUrl:      paymentUrl,
    orderId:         normalizedOrderId,
    publicKey:       publicKeyForKr,
    server_amount:   serverAmount,
    debt_amount:     debtAmount,
    recharge_amount: sanitizedRecharge,
    tx_found:        txFoundCount,
  });
} // fin handleRequest

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
