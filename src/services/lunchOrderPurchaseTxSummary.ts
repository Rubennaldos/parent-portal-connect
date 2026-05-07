import type { SupabaseClient } from '@supabase/supabase-js';

export type LunchOrderPurchaseTxRow = {
  lunch_order_id: string;
  ticket_code: string | null;
  payment_status: string | null;
  payment_method: string | null;
  amount_abs: number | null;
  tx_metadata_source: string | null;
};

const CHUNK_SIZE = 400;

/**
 * Resumen de transacciones de compra (almuerzo) por lunch_order_id.
 * Delega en RPC get_lunch_order_purchase_tx_summary (índice en metadata->>'lunch_order_id').
 */
export type FetchLunchOrderPurchaseTxOptions = {
  /** Calendario padre/profe: incluir payment_status cancelled en el ranking. Admin pedidos: false. */
  includeCancelled?: boolean;
};

export async function fetchLunchOrderPurchaseTxSummary(
  client: SupabaseClient,
  lunchOrderIds: string[],
  schoolId?: string | null,
  options?: FetchLunchOrderPurchaseTxOptions
): Promise<LunchOrderPurchaseTxRow[]> {
  const ids = [...new Set(lunchOrderIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  const out: LunchOrderPurchaseTxRow[] = [];
  for (const chunk of chunks) {
    const { data, error } = await client.rpc('get_lunch_order_purchase_tx_summary', {
      p_lunch_order_ids: chunk,
      p_school_id: schoolId ?? null,
      p_include_cancelled: options?.includeCancelled ?? false,
    });
    if (error) throw error;
    if (data?.length) out.push(...(data as LunchOrderPurchaseTxRow[]));
  }
  return out;
}
