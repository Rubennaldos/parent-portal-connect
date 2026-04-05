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
    .select("merchant_id, api_key, api_url, is_production, is_active, min_amount, max_amount")
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

  // ── 5. Construir payload de la orden para Izipay ──────────────────────────
  // Izipay trabaja con centavos (enteros) — multiplicar por 100 y redondear
  const amountInCents = Math.round(amount * 100);
  const shopId      = gwConfig.merchant_id;
  const password    = gwConfig.api_key;
  const baseUrl     = gwConfig.api_url || (gwConfig.is_production ? IZIPAY_PROD_URL : IZIPAY_TEST_URL);

  // Basic Auth: base64(shopId:password)
  const basicAuth = btoa(`${shopId}:${password}`);

  const orderPayload = {
    amount: amountInCents,
    currency: currency === "PEN" ? "604" : "840", // ISO 4217: PEN=604, USD=840
    orderId: orderId,                               // ID único de nuestra transacción
    customer: {
      reference: callerUserId,                      // ID del padre (Supabase auth.uid)
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
    console.error("[izipay-create-order] Respuesta inesperada de Izipay:", izipayResponse.status, izipayData);
    return json({
      success: false,
      error:   "Izipay devolvió un error al crear la orden",
      details: izipayData,
    }, 502);
  }

  // Izipay devuelve status "SUCCESS" en el body (HTTP puede ser 200 aunque haya error lógico)
  if (izipayData.status !== "SUCCESS") {
    console.error("[izipay-create-order] Izipay rechazó la orden:", izipayData);
    return json({
      success:    false,
      error:      izipayData.answer?.errorMessage ?? "Izipay rechazó la creación de la orden",
      errorCode:  izipayData.answer?.errorCode,
    }, 422);
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
    success:   true,
    formToken: formToken,
    orderId:   orderId,
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
