/**
 * ════════════════════════════════════════════════════════════════════════════
 * POS — Capa anti-corrupción del RPC complete_pos_sale_v2
 *
 * Responsabilidad única: llamar al RPC y devolver un CheckoutOutcome tipado.
 *
 * Garantías:
 *  • Nunca lanza excepción — siempre retorna un CheckoutOutcome.
 *  • No toca estado React, no llama toast, no navega.
 *  • Clasifica correctamente el caso "idempotencia en vuelo"
 *    (backend retorna ok:true pero transaction_id = null).
 *  • El caller (POS.tsx) toma 100% de las decisiones de UI basándose en status.
 *
 * Reglas de oro respetadas:
 *  • Precios recalculados en BD (el RPC usa product_school_prices).
 *  • Monto nunca viene del frontend.
 *  • Idempotencia gestionada via pos_idempotency_keys en el RPC.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase';

// ─── Tipos de error de negocio que emite complete_pos_sale_v2 ────────────────
export type BusinessErrorType =
  | 'INSUFFICIENT_STOCK'
  | 'INSUFFICIENT_BALANCE'
  | 'SPENDING_LIMIT'
  | 'KIOSK_DISABLED'
  | 'PRODUCT_NOT_FOUND'
  | 'STUDENT_NOT_FOUND'
  | 'NO_OPEN_SESSION'
  | 'SPLITS_MISMATCH'
  | 'UNAUTHORIZED_SCHOOL'
  | 'UNAUTHORIZED_CUSTOM_SALE'
  | 'UNAUTHORIZED'
  | 'INVALID_QUANTITY'
  | 'INVALID_CUSTOM_PRICE'
  | 'STOCK_CONFIG_ERROR'
  | 'INACTIVE_PRODUCT'
  | 'DUPLICATE_CODE'
  | 'UNKNOWN';

/**
 * Contrato exhaustivo de salida de un checkout POS.
 *
 * Regla de uso:
 *   Ningún componente puede asumir éxito sin verificar explícitamente
 *   status === 'success'. Cualquier otro status conserva el carrito intacto.
 *
 * status === 'success'
 *   Backend confirmó la venta. transactionId garantizado non-null.
 *   → Limpiar carrito + cliente. Imprimir ticket.
 *
 * status === 'retryable'
 *   Fallo de red o timeout. La venta puede o no estar en BD.
 *   → Preservar carrito + idempotency key. Mostrar "Reintentar".
 *
 * status === 'business_error'
 *   Regla de negocio bloqueó la venta (stock, tope, kiosco…).
 *   → Preservar carrito. Mostrar causa. Cajera debe corregir.
 *
 * status === 'in_progress'
 *   Idempotency key reclamada pero transaction_id todavía null
 *   (race condition: el primer request aún no terminó).
 *   → Tratar como retryable. Reintentar con la misma clave.
 *
 * status === 'offline_queued'
 *   Sin conexión real. Venta encolada en IndexedDB.
 *   → Limpiar carrito como si hubiera éxito (ticket temporal emitido).
 *
 * status === 'session_error'
 *   Sesión expirada o sin autorización.
 *   → Forzar re-login. No reintentar.
 */
export type CheckoutOutcome =
  | {
      status: 'success';
      transactionId: string;
      ticketCode: string;
      total: number;
      balanceAfter: number;
      paymentStatus: string;
      businessDate: string;
    }
  | { status: 'retryable';      errorType: 'NETWORK' | 'TIMEOUT'; message: string }
  | { status: 'business_error'; errorType: BusinessErrorType;     message: string }
  | { status: 'in_progress';    message: string }
  | { status: 'offline_queued'; offlineId: string; tempTicket: string }
  | { status: 'session_error';  message: string };

// ─── Parámetros de entrada al RPC ────────────────────────────────────────────
export interface CheckoutRpcParams {
  schoolId:        string;
  cashierId:       string;
  lines:           unknown[];
  clientMode:      string;
  studentId?:      string | null;
  teacherId?:      string | null;
  paymentMethod?:  string | null;
  paymentMetadata?: Record<string, unknown>;
  billingData?:    { document_type: string; client_name?: string; client_dni_ruc?: string };
  idempotencyKey?: string | null;
  cashGiven?:      number | null;
  paymentSplits?:  unknown[];
  cashSessionId?:  string | null;
}

// Prefijos que lanza el RPC en RAISE EXCEPTION para errores de negocio
const BUSINESS_PREFIXES: BusinessErrorType[] = [
  'INSUFFICIENT_STOCK',
  'INSUFFICIENT_BALANCE',
  'SPENDING_LIMIT',
  'KIOSK_DISABLED',
  'PRODUCT_NOT_FOUND',
  'STUDENT_NOT_FOUND',
  'NO_OPEN_SESSION',
  'SPLITS_MISMATCH',
  'UNAUTHORIZED_SCHOOL',
  'UNAUTHORIZED_CUSTOM_SALE',
  'UNAUTHORIZED',
  'INVALID_QUANTITY',
  'INVALID_CUSTOM_PRICE',
  'STOCK_CONFIG_ERROR',
];

/**
 * executeCheckout — único punto de entrada al RPC complete_pos_sale_v2.
 *
 * Nunca lanza. Siempre retorna CheckoutOutcome.
 */
export async function executeCheckout(params: CheckoutRpcParams): Promise<CheckoutOutcome> {
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('complete_pos_sale_v2', {
      p_school_id:        params.schoolId,
      p_cashier_id:       params.cashierId,
      p_lines:            params.lines,
      p_client_mode:      params.clientMode,
      p_student_id:       params.clientMode === 'student' ? (params.studentId ?? null) : null,
      p_teacher_id:       params.clientMode === 'teacher' ? (params.teacherId ?? null) : null,
      // Alumno/profesor: método lo resuelve el RPC (saldo invisible / teacher_account).
      // Genérico: método obligatorio del selector de pago.
      p_payment_method:   (params.clientMode === 'student' || params.clientMode === 'teacher')
                            ? null
                            : (params.paymentMethod || 'efectivo'),
      p_payment_metadata: params.paymentMetadata ?? {},
      p_billing_data:     params.billingData ?? { document_type: 'ticket' },
      p_idempotency_key:  params.idempotencyKey ?? null,
      p_cash_given:       params.cashGiven ?? null,
      p_payment_splits:   params.paymentSplits ?? [],
      p_cash_session_id:  params.cashSessionId ?? null,
    });

    if (rpcError) {
      const msg = rpcError.message ?? '';
      const matched = BUSINESS_PREFIXES.find(prefix => msg.includes(prefix));
      if (matched) {
        return { status: 'business_error', errorType: matched, message: msg };
      }
      if (msg.toLowerCase().includes('jwt') || msg.toLowerCase().includes('not authenticated')) {
        return { status: 'session_error', message: msg };
      }
      return { status: 'business_error', errorType: 'UNKNOWN', message: msg };
    }

    const data = rpcResult as Record<string, unknown> | null;

    // Idempotencia en vuelo: la clave fue reclamada por otro request
    // que todavía no escribió el transaction_id.
    if (data?.idempotent_hit === true && !data?.transaction_id) {
      return {
        status:  'in_progress',
        message: 'El servidor está procesando esta transacción. Esperá un segundo y volvé a intentar.',
      };
    }

    // Idempotencia exitosa: ya se procesó antes → retornar éxito idempotente
    if (data?.idempotent_hit === true && data?.transaction_id) {
      return {
        status:        'success',
        transactionId: data.transaction_id as string,
        ticketCode:    (data.ticket_code as string) ?? '',
        total:         (data.total as number) ?? 0,
        balanceAfter:  (data.balance_after as number) ?? 0,
        paymentStatus: (data.payment_status as string) ?? '',
        businessDate:  (data.business_date_lima as string) ?? '',
      };
    }

    if (!data?.ok) {
      return {
        status:    'business_error',
        errorType: 'UNKNOWN',
        message:   (data?.error as string) ?? 'El servidor no confirmó la venta.',
      };
    }

    return {
      status:        'success',
      transactionId: data.transaction_id as string,
      ticketCode:    data.ticket_code as string,
      total:         data.total as number,
      balanceAfter:  data.balance_after as number,
      paymentStatus: data.payment_status as string,
      businessDate:  data.business_date_lima as string,
    };

  } catch (err: unknown) {
    const msg   = (err as Error)?.message ?? '';
    const isNet =
      !navigator.onLine ||
      msg.toLowerCase().includes('failed to fetch') ||
      msg.toLowerCase().includes('network') ||
      (err as { code?: string })?.code === 'NETWORK_ERROR';

    if (isNet) {
      return { status: 'retryable', errorType: 'NETWORK', message: msg || 'Sin conexión a internet.' };
    }
    if (msg.toLowerCase().includes('timeout') || (err as Error)?.name === 'AbortError') {
      return { status: 'retryable', errorType: 'TIMEOUT', message: 'La operación tardó demasiado.' };
    }
    return { status: 'business_error', errorType: 'UNKNOWN', message: msg || 'Error inesperado al procesar la venta.' };
  }
}
