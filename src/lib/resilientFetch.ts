/**
 * resilientFetch — capa de resiliencia de red para el cliente Supabase.
 *
 * REGLAS DE ORO aplicadas:
 *  - Solo reintenta métodos idempotentes (GET, HEAD). NUNCA POST/PATCH/DELETE.
 *  - Writes (RPC, INSERT, UPDATE) viajan UNA sola vez. Un segundo intento en un
 *    POST financiero puede crear pedidos duplicados aunque la DB sea idempotente,
 *    porque ante un timeout no sabemos si el primer request se commitió o no.
 *  - Backoff exponencial con jitter para no generar ráfagas sincronizadas desde
 *    múltiples celulares al mismo tiempo (problema conocido en horario 8 AM).
 *  - Cache-Control: no-cache en TODAS las peticiones, sin excepción.
 *    Esto fuerza a los Service Workers Workbox (NetworkFirst) a validar contra
 *    la red antes de usar caché. La defensa adicional está en vite.config.ts
 *    (NetworkOnly para Supabase REST y RPC).
 *  - Nunca registra contenido sensible de la respuesta en consola de producción.
 */

/** Códigos HTTP que justifican reintentar (errores transitorios de servidor). */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Métodos HTTP idempotentes donde el reintento es seguro. */
const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD']);

export interface ResilientFetchOptions {
  /** Número máximo de intentos total (incluye el primero). Por defecto: 3. */
  maxAttempts?: number;
  /** Delay base en ms antes del segundo intento. Se duplica por cada reintento. Por defecto: 800. */
  baseDelayMs?: number;
}

/**
 * Wrapper de fetch con:
 *  - Headers anti-caché obligatorios en cada llamada.
 *  - Reintento con backoff exponencial + jitter SOLO para GET/HEAD.
 *  - Sin reintento para POST/PUT/PATCH/DELETE (protección financiera).
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: ResilientFetchOptions,
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 800;
  const method = ((init?.method ?? 'GET') as string).toUpperCase();
  const canRetry = SAFE_RETRY_METHODS.has(method);

  // Enriquecer siempre los headers anti-caché sin mutar el objeto original.
  const enrichedInit: RequestInit = {
    ...init,
    headers: {
      ...init?.headers,
      'Cache-Control': 'no-cache, no-store',
      Pragma: 'no-cache',
    },
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(input, enrichedInit);

      // Si el método no es reintentable, devolver la respuesta tal cual (incluso error).
      if (!canRetry) return response;

      // Si la respuesta es OK o el error no es transitorio, devolver.
      if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) return response;

      // Error transitorio y hay intentos restantes → esperar y reintentar.
      if (attempt < maxAttempts) {
        const jitter = Math.random() * 200;
        await _sleep(baseDelayMs * attempt + jitter);
        continue;
      }

      // Último intento agotado → devolver la respuesta de error tal cual.
      return response;

    } catch (err) {
      lastError = err;

      // Error de red (no código HTTP): solo reintentar si es GET y quedan intentos.
      if (!canRetry || attempt >= maxAttempts) break;

      const jitter = Math.random() * 200;
      await _sleep(baseDelayMs * attempt + jitter);
    }
  }

  throw lastError ?? new Error('resilientFetch: error de red desconocido');
}

function _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
