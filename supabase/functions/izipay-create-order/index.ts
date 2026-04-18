// @ts-nocheck — archivo Deno (Edge Function de Supabase)
/**
 * izipay-create-order
 * ─────────────────────────────────────────────────────────────────
 * Crea una orden en Izipay (Lyra / micuentaweb.pe) y devuelve el
 * formToken al frontend para renderizar el formulario embebido.
 *
 * Flujo:
 *  1. Padre presiona "Pagar con tarjeta / Yape / Plin"
 *  2. Frontend llama a esta Edge Function con { amount, studentId, orderId, currency? }
 *  3. Esta función consulta payment_gateway_config (izipay) para obtener
 *     merchant_id (shopId) y api_key (password) — NUNCA se exponen al frontend
 *  4. Llama a la API REST de Izipay para crear la orden y obtiene formToken
 *  5. Devuelve el formToken al frontend (el frontend lo pasa al SDK JS de Izipay)
 *
 * Campos usados de payment_gateway_config:
 *  - merchant_id   → shopId (identificador de la tienda en Izipay)
 *  - api_key       → password (clave privada para Basic Auth)
 *  - api_url       → base URL (si está vacío usa el default de Izipay Perú)
 *  - is_production → selecciona endpoint de prueba vs producción
 *  - min_amount / max_amount → validación de monto antes de llamar a la API
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Endpoints oficiales de Izipay Perú ──────────────────────────────────────
const IZIPAY_PROD_URL   = "https://api.micuentaweb.pe";
const IZIPAY_TEST_URL   = "https://api.micuentaweb.pe"; // Izipay usa el mismo dominio; sandbox via credenciales

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── 1. Autenticación del llamante (padre autenticado en Supabase) ─────────
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearerToken) {
    return json({ success: false, error: "No autorizado — inicia sesión primero" }, 401);
  }

  let callerUserId: string | null = null;
  try {
    const parts = bearerToken.split(".");
    if (parts.length === 3) {
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, "="));
      callerUserId = JSON.parse(decoded).sub ?? null;
    }
  } catch { /* JWT malformado */ }

  if (!callerUserId) {
    return json({ success: false, error: "Token de sesión inválido" }, 401);
  }

  // ── 2. Parsear body ───────────────────────────────────────────────────────
  let body: { amount?: number; studentId?: string; orderId?: string; currency?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Body JSON inválido" }, 400);
  }

  const { amount, studentId, orderId, currency = "PEN" } = body;

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return json({ success: false, error: "El campo 'amount' es requerido y debe ser mayor a 0" }, 400);
  }
  if (!studentId) {
    return json({ success: false, error: "El campo 'studentId' es requerido" }, 400);
  }
  if (!orderId) {
    return json({ success: false, error: "El campo 'orderId' es requerido (UUID de la transacción)" }, 400);
  }

  // ── 3. Supabase con service_role (solo backend — lee credenciales sensibles) ─
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 4. Leer configuración de Izipay desde payment_gateway_config ──────────
  const { data: gwConfig, error: gwError } = await supabase
    .from("payment_gateway_config")
    .select("merchant_id, api_key, api_url, is_production, is_active, min_amount, max_amount, settings")
    .eq("gateway_name", "izipay")
    .single();

  if (gwError || !gwConfig) {
    return json({ success: false, error: "Configuración de Izipay no encontrada" }, 500);
  }
  if (!gwConfig.is_active) {
    return json({ success: false, error: "La pasarela Izipay no está activa actualmente" }, 503);
  }

  // Validar credenciales mínimas
  if (!gwConfig.merchant_id || !gwConfig.api_key) {
    return json({
      success: false,
      error: "Credenciales de Izipay incompletas. Configura el Merchant ID y API Key en el panel de SuperAdmin.",
    }, 500);
  }

  // Validar rango de monto
  if (amount < (gwConfig.min_amount ?? 1)) {
    return json({ success: false, error: `El monto mínimo permitido es S/ ${gwConfig.min_amount}` }, 400);
  }
  if (amount > (gwConfig.max_amount ?? 10000)) {
    return json({ success: false, error: `El monto máximo permitido es S/ ${gwConfig.max_amount}` }, 400);
  }

  // ── 5a. Obtener email del padre (IziPay lo requiere en customer) ─────────
  let callerEmail = "cliente@test.pe"; // fallback si no se encuentra
  try {
    const { data: authUser } = await supabase.auth.admin.getUserById(callerUserId);
    if (authUser?.user?.email) {
      callerEmail = authUser.user.email;
    }
  } catch { /* usa el fallback */ }

  // ── 5. Construir payload de la orden para Izipay ──────────────────────────
  // Izipay trabaja con centavos (enteros) — multiplicar por 100 y redondear
  const amountInCents = Math.round(amount * 100);
  // El panel suele guardar "97547567:testpublickey_..." en merchant_id: el Basic Auth
  // solo usa shopId + contraseña (Usuario + Contraseña de test del Back Office).
  const rawMerchant    = String(gwConfig.merchant_id ?? "").trim();
  const rawApiKey      = String(gwConfig.api_key      ?? "").trim();
  const rawApiSecret   = String(gwConfig.api_secret   ?? "").trim();

  // IziPay Basic Auth → usuario = shopId (parte numérica), contraseña = testpassword_...
  const shopId = rawMerchant.includes(":") ? rawMerchant.split(":")[0].trim() : rawMerchant;

  // La contraseña de test de IziPay empieza con "testpassword_".
  // Buscamos ese valor en api_key primero; si no, en api_secret como fallback.
  const password =
    rawApiKey.startsWith("testpassword_") || rawApiKey.startsWith("password_")
      ? rawApiKey
      : rawApiSecret.startsWith("testpassword_") || rawApiSecret.startsWith("password_")
        ? rawApiSecret
        : rawApiKey; // último recurso: usar api_key tal cual

  const publicKeyForKr =
    rawMerchant.includes(":")
      ? rawMerchant
      : (gwConfig.settings as { public_key?: string } | null)?.public_key?.trim() || rawMerchant;
  const baseUrl = gwConfig.api_url || (gwConfig.is_production ? IZIPAY_PROD_URL : IZIPAY_TEST_URL);

  // Debug info — se devuelve en el body de error para que el admin lo vea en Network tab
  const _credDebug = {
    shopId,
    apiKey_prefix:    rawApiKey.substring(0, 15)    + (rawApiKey.length > 15    ? "..." : ""),
    apiSecret_prefix: rawApiSecret.substring(0, 15) + (rawApiSecret.length > 15 ? "..." : ""),
    password_used:    password.substring(0, 15)     + (password.length > 15     ? "..." : ""),
    password_source:  rawApiKey.startsWith("testpassword_") || rawApiKey.startsWith("password_")
                        ? "api_key" : "api_secret",
    baseUrl,
  };
  console.log("[izipay] credenciales:", JSON.stringify(_credDebug));

  if (!shopId || !password) {
    return json({
      success: false,
      error: "Credenciales incompletas: Merchant ID y contraseña son obligatorios.",
      _debug: _credDebug,
    }, 200);
  }

  // Basic Auth: base64(shopId:password)
  const basicAuth = btoa(`${shopId}:${password}`);

  const orderPayload = {
    amount: amountInCents,
    currency: currency || "PEN", // IziPay Perú usa código alfabético (PEN, USD), no numérico
    orderId: orderId,                               // ID único de nuestra transacción
    customer: {
      reference: callerUserId,                      // ID del padre (Supabase auth.uid)
      email:     callerEmail,                       // IziPay requiere email obligatorio
    },
    // formAction: "PAYMENT" es el modo estándar de cobro
    // Izipay devolverá el formToken que el frontend usa con su SDK JS
  };

  // ── 6. Llamar a la API de Izipay para crear la orden ─────────────────────
  let izipayResponse: Response;
  try {
    izipayResponse = await fetch(`${baseUrl}/api-payment/V4/Charge/CreatePayment`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: JSON.stringify(orderPayload),
    });
  } catch (fetchErr) {
    console.error("[izipay-create-order] Error de red al llamar a Izipay:", fetchErr);
    return json({ success: false, error: "No se pudo conectar con Izipay. Intente de nuevo." }, 502);
  }

  const izipayData = await izipayResponse.json().catch(() => null);

  if (!izipayResponse.ok || !izipayData) {
    const rawText = izipayData ? JSON.stringify(izipayData) : "(sin body)";
    console.error("[izipay-create-order] HTTP error de Izipay:", izipayResponse.status, rawText);
    // Devolvemos 200 para que el frontend pueda leer el body con el error real
    return json({
      success: false,
      error:   `Izipay HTTP ${izipayResponse.status}: ${rawText}`,
    }, 200);
  }

  // Izipay devuelve status "SUCCESS" en el body (HTTP puede ser 200 aunque haya error lógico)
  if (izipayData.status !== "SUCCESS") {
    const errMsg  = izipayData.answer?.errorMessage ?? "Izipay rechazó la creación de la orden";
    const errCode = izipayData.answer?.errorCode    ?? "SIN_CODIGO";
    console.error("[izipay-create-order] Izipay rechazó:", errCode, errMsg);
    return json({
      success:   false,
      error:     `[${errCode}] ${errMsg}`,
      errorCode: errCode,
      izipayRaw: izipayData,
      _debug:    _credDebug,   // ← qué shopId y contraseña se usaron
    }, 200);
  }

  const formToken = izipayData.answer?.formToken;
  if (!formToken) {
    return json({ success: false, error: "Izipay no devolvió formToken en la respuesta" }, 500);
  }

  // ── 7. Registrar el intento en nuestra tabla payment_transactions ─────────
  await supabase
    .from("payment_transactions")
    .upsert({
      id:                orderId,
      user_id:           callerUserId,
      student_id:        studentId,
      amount:            amount,
      currency:          currency,
      payment_gateway:   "izipay",
      payment_method:    "pending_selection",  // el padre elige en el formulario embebido
      status:            "pending",
      expired_at:        new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    }, { onConflict: "id" });

  // ── 8. Devolver formToken al frontend ─────────────────────────────────────
  // El frontend inyecta este token en el SDK JS de Izipay: KRGlue.loadLibrary(...)
  return json({
    success:    true,
    formToken:  formToken,
    orderId:    orderId,
    publicKey:  publicKeyForKr,
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
