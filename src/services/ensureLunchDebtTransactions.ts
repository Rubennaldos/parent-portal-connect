/**
 * Orquestación del RPC ensure_lunch_debt_transactions_for_payment.
 * La autoridad (precio, ownership, idempotencia) vive en PostgreSQL.
 * Este módulo solo transporta IDs y propaga errores tipados.
 */
import { supabase } from '@/lib/supabase';

export type EnsureLunchDebtResult = {
  success: boolean;
  transaction_ids: string[];
  materialized_count: number;
  existing_count: number;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Extrae UUID de lunch_order desde id sintético lunch_<uuid> o UUID puro. */
export function resolveLunchOrderId(rawId: string | null | undefined): string | null {
  if (!rawId) return null;
  if (rawId.startsWith('lunch_')) {
    const maybe = rawId.slice('lunch_'.length);
    return isUuid(maybe) ? maybe : null;
  }
  return isUuid(rawId) ? rawId : null;
}

export function isSyntheticLunchDebtId(rawId: string | null | undefined): boolean {
  return Boolean(rawId?.startsWith('lunch_'));
}

/**
 * Materializa almuerzos virtuales en transactions.pending y devuelve UUID reales.
 * Si no hay lunch_order_ids, devuelve los paid_tx_ids ya filtrados (solo UUID).
 */
export async function ensureRealDebtTransactionIds(params: {
  studentId: string;
  parentId: string;
  paidTransactionIds?: string[] | null;
  lunchOrderIds?: string[] | null;
}): Promise<string[]> {
  const existingTxIds = (params.paidTransactionIds ?? []).filter(
    (id) => id && isUuid(id) && !id.startsWith('lunch_') && !id.startsWith('kiosk_balance_'),
  );

  const lunchIds = (params.lunchOrderIds ?? [])
    .map((id) => resolveLunchOrderId(id))
    .filter((id): id is string => Boolean(id));

  if (lunchIds.length === 0) {
    return existingTxIds;
  }

  const { data, error } = await supabase.rpc('ensure_lunch_debt_transactions_for_payment', {
    p_student_id: params.studentId,
    p_lunch_order_ids: lunchIds,
    p_parent_id: params.parentId,
  });

  if (error) {
    throw new Error(error.message || 'No se pudieron preparar las deudas de almuerzo.');
  }

  const payload = data as EnsureLunchDebtResult | null;
  const fromDb = (payload?.transaction_ids ?? []).filter((id) => isUuid(id));

  // Unión estable: tickets ya reales + materializados (sin duplicar)
  const merged = new Set<string>([...existingTxIds, ...fromDb]);
  return Array.from(merged);
}
