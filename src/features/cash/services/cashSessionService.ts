/**
 * Caja — capa de servicios (contrato SSOT)
 *
 * CONTRATO DE DATOS (post 20260710_cash_sessions_operational_contract):
 *  - Lectura operativa PostgREST → vista `v_cash_sessions_operational`
 *    (nunca `cash_sessions` con select('*'); PostgREST + GRANT por columna rompe).
 *  - Guard POS / apertura → RPC `get_open_cash_session` / `ensure_cash_session_open`
 *  - Totales / arqueo sistema → solo RPC admin (`get_cash_day_summary`, etc.)
 *  - Operador NUNCA pide calculate_daily_totals ni montos system_*.
 */

import { supabase } from '@/lib/supabase';

export type CashVisibilityMode = 'blind' | 'admin';

/** Vista operativa — única superficie PostgREST segura para sesiones. */
export const CASH_SESSIONS_OPERATIONAL_VIEW = 'v_cash_sessions_operational' as const;

export interface CashSessionOperational {
  id: string;
  school_id?: string;
  status: 'open' | 'closed';
  opened_at: string | null;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
  session_date: string;
  initial_cash?: number;
  initial_yape?: number;
  initial_plin?: number;
  initial_other?: number;
  cashier_name?: string | null;
  declared_cash?: number | null;
  declared_tarjeta?: number | null;
}

export interface CashDaySummaryBlind {
  ok: true;
  mode: 'blind';
  session_date: string;
  school_id: string;
  session: CashSessionOperational | null;
  can_close: boolean;
  can_operate: boolean;
}

export interface CashDaySummaryAdmin {
  ok: true;
  mode: 'admin';
  session_date: string;
  school_id: string;
  session: CashSessionOperational | null;
  daily_totals: Record<string, unknown> | null;
  computed_balances: {
    system_cash: number;
    system_tarjeta: number;
    system_yape: number;
    system_transferencia: number;
    system_total: number;
  } | null;
}

export type CashDaySummary = CashDaySummaryBlind | CashDaySummaryAdmin;

export interface CloseCashBlindResult {
  ok: true;
  mode: 'blind';
  session_id: string;
  session_date: string;
  closed_at: string;
  declared_cash: number;
  declared_tarjeta: number;
}

export interface CloseCashAdminResult {
  ok: true;
  mode: 'admin';
  session_id: string;
  session_date: string;
  closed_at: string;
  declared_cash: number;
  declared_tarjeta: number;
  system_cash: number;
  system_tarjeta: number;
  system_yape: number;
  system_transferencia: number;
  system_total: number;
  variance_cash: number;
  variance_tarjeta: number;
  variance_total: number;
}

export type CloseCashResult = CloseCashBlindResult | CloseCashAdminResult;

export interface PosCashSession {
  id: string;
  school_id: string;
  session_date: string;
  status: 'open' | 'closed';
  opened_by: string;
  opened_at: string;
  closed_by?: string | null;
  closed_at?: string | null;
  initial_cash?: number;
  initial_yape?: number;
  initial_plin?: number;
  initial_other?: number;
  cashier_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

function rpcErrorMessage(err: { message?: string } | null): string {
  return err?.message || 'Error de caja';
}

/** Resumen del día según rol (ciego vs admin). */
export async function fetchCashDaySummary(
  schoolId: string,
  date?: string,
): Promise<{ data: CashDaySummary | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_cash_day_summary', {
    p_school_id: schoolId,
    p_date: date ?? null,
  });

  if (error) {
    return { data: null, error: rpcErrorMessage(error) };
  }

  return { data: data as CashDaySummary, error: null };
}

/**
 * Cierre de caja. Solo envía montos físicos.
 * La BD recalcula system_* y decide qué devolver según el rol.
 */
export async function closeCashSession(params: {
  sessionId: string;
  physicalCash: number;
  physicalTarjeta: number;
  varianceJustification?: string | null;
}): Promise<{ data: CloseCashResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_session_id: params.sessionId,
    p_physical_cash: params.physicalCash,
    p_physical_tarjeta: params.physicalTarjeta,
    p_variance_justification: params.varianceJustification ?? null,
  });

  if (error) {
    return { data: null, error: rpcErrorMessage(error) };
  }

  return { data: data as CloseCashResult, error: null };
}

/** SSOT guard POS — sesión abierta hoy (Lima). */
export async function fetchOpenCashSessionForPos(
  schoolId: string,
): Promise<{ data: PosCashSession | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_open_cash_session', {
    p_school_id: schoolId,
  });

  if (error) {
    return { data: null, error: rpcErrorMessage(error) };
  }

  const session = (data as { session?: PosCashSession | null } | null)?.session ?? null;
  return { data: session, error: null };
}

/** Apertura / reconciliación atómica (idempotente). */
export async function ensureCashSessionOpen(
  schoolId: string,
): Promise<{ data: PosCashSession | null; action: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('ensure_cash_session_open', {
    p_school_id: schoolId,
  });

  if (error) {
    return { data: null, action: null, error: rpcErrorMessage(error) };
  }

  const payload = data as { session?: PosCashSession; action?: string } | null;
  return {
    data: payload?.session ?? null,
    action: payload?.action ?? null,
    error: null,
  };
}

/** Sesión del día vía vista operativa (nunca tabla base con '*'). */
export async function fetchTodayCashSession(
  schoolId: string,
  sessionDate: string,
): Promise<{ data: CashSessionOperational | null; error: string | null }> {
  const { data, error } = await supabase
    .from(CASH_SESSIONS_OPERATIONAL_VIEW)
    .select('*')
    .eq('school_id', schoolId)
    .eq('session_date', sessionDate)
    .maybeSingle();

  if (error) {
    return { data: null, error: rpcErrorMessage(error) };
  }

  return { data: data as CashSessionOperational | null, error: null };
}

export function isBlindCashError(message: string): boolean {
  return (
    message.includes('BLIND_CASH_FORBIDDEN') ||
    message.includes('UNAUTHORIZED') ||
    message.includes('VARIANCE_JUSTIFICATION_REQUIRED')
  );
}

/** Historial de arqueo (solo admin — incluye system_* / variance_*). */
export async function fetchCashSessionsAudit(
  schoolId: string,
  limit = 30,
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  const { data, error } = await supabase.rpc('get_cash_sessions_audit', {
    p_school_id: schoolId,
    p_limit: limit,
  });

  if (error) {
    return { data: [], error: rpcErrorMessage(error) };
  }

  const rows = (data as { rows?: Array<Record<string, unknown>> } | null)?.rows || [];
  return { data: rows, error: null };
}
