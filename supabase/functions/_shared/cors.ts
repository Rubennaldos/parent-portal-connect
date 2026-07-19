/**
 * CORS único para Edge Functions llamadas desde el browser.
 *
 * resilientFetch (src/lib/resilientFetch.ts) inyecta Cache-Control y Pragma
 * en todas las peticiones del cliente Supabase. Sin permitirlos aquí, el
 * preflight OPTIONS falla y el POST nunca llega (FunctionsFetchError).
 *
 * SSOT: no duplicar Allow-Headers en cada function.
 */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, x-gateway-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Mismo CORS + Content-Type JSON (respuestas de API). */
export const corsHeadersJson: Record<string, string> = {
  ...corsHeaders,
  "Content-Type": "application/json",
};
