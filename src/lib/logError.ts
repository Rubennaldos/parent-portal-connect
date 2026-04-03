/**
 * Helper para registrar errores críticos en la tabla error_logs.
 *
 * Reemplaza console.error en puntos clave del sistema:
 *   - VoucherApproval (fallo Nubefact, fallo de aprobación)
 *   - CierreMensual (fallo de boleteo, rollback fallido)
 *   - Index.tsx (fallo de carga de datos del padre)
 *
 * Diseño "fire and forget": si el INSERT a Supabase falla (red, RLS, etc.),
 * cae silenciosamente y siempre hace console.error como fallback para devtools.
 * Nunca bloquea el flujo principal.
 *
 * Uso:
 *   import { logError } from '@/lib/logError';
 *   await logError('voucher_approval', 'Nubefact rechazó la boleta', { req_id, error });
 */

import { supabase } from '@/lib/supabase';

export type ErrorModule =
  | 'voucher_approval'
  | 'cierre_mensual'
  | 'parent_portal'
  | 'pos'
  | 'nubefact'
  | 'auto_billing'
  | 'lunch_orders'
  | 'rpc'
  | string; // acepta strings libres para módulos futuros

interface LogErrorOptions {
  schoolId?: string | null;
  userId?: string | null;
  errorCode?: string | null;
  context?: Record<string, unknown> | null;
}

export async function logError(
  module: ErrorModule,
  message: string,
  options: LogErrorOptions = {},
): Promise<void> {
  // Siempre hacer console.error como fallback para devtools/Vercel logs
  console.error(`[${module}] ${message}`, options.context ?? '');

  try {
    await supabase.from('error_logs').insert({
      module,
      message: String(message).slice(0, 2000), // limitar para no exceder columna text
      school_id:  options.schoolId  ?? null,
      user_id:    options.userId    ?? null,
      error_code: options.errorCode ?? null,
      context:    options.context   ?? null,
    });
  } catch {
    // Silencioso: no queremos que un error de logging cause otro error
  }
}

/**
 * Versión sincrónica que no bloquea con await.
 * Útil en catch blocks donde no queremos hacer async el handler completo.
 */
export function logErrorAsync(
  module: ErrorModule,
  message: string,
  options: LogErrorOptions = {},
): void {
  logError(module, message, options).catch(() => {});
}
