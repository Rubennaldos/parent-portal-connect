/**
 * Consulta DNI/RUC vía Edge Function `consult-document`.
 *
 * Usamos fetch() directo (no supabase.functions.invoke) porque:
 *  - El SDK puede reemplazar headers y perder `apikey`.
 *  - resilientFetch inyecta Pragma/Cache-Control que rompe CORS en algunas funciones.
 *
 * Patrón ya probado en InvoiceClientModal (Cobranzas).
 */
import { supabaseConfig } from '@/config/supabase.config';

export interface ConsultDocumentResult {
  success: boolean;
  error?: string;
  razon_social?: string;
  nombre?: string;
  direccion?: string;
  [key: string]: unknown;
}

export async function consultarDNIRUC(
  tipo: 'dni' | 'ruc',
  numero: string,
  schoolId?: string | null,
): Promise<ConsultDocumentResult> {
  const supabaseUrl = supabaseConfig.url.replace(/\/$/, '');
  const anonKey     = supabaseConfig.anonKey;
  const functionUrl = `${supabaseUrl}/functions/v1/consult-document`;

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey':        anonKey,
      },
      body: JSON.stringify({ tipo, numero, school_id: schoolId ?? null }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[consult-document] HTTP ${res.status}:`, text);
      return {
        success: false,
        error: `Servicio no disponible (${res.status}). Escribe tu nombre manualmente.`,
      };
    }

    const data = (await res.json()) as ConsultDocumentResult;
    return data ?? { success: false, error: 'Respuesta vacía del servidor.' };
  } catch (err) {
    console.warn('[consult-document] Error de red:', err);
    return { success: false, error: 'No se pudo conectar con el servicio de consulta.' };
  }
}
