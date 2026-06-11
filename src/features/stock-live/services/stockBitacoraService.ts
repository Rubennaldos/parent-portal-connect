import { supabase } from '@/lib/supabase';
import type { StockBitacoraResponse } from '../types';

const PAGE_SIZE = 10;

function parseBitacoraResponse(raw: unknown): StockBitacoraResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('BITACORA_EMPTY: respuesta inválida del servidor.');
  }
  const o = raw as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    product_id: String(o.product_id ?? ''),
    school_id: String(o.school_id ?? ''),
    has_more: Boolean(o.has_more),
    limit: Number(o.limit ?? PAGE_SIZE),
    offset: Number(o.offset ?? 0),
    items: items.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        quantity_delta: Number(r.quantity_delta ?? 0),
        delta_label: String(r.delta_label ?? ''),
        occurred_at_lima: String(r.occurred_at_lima ?? ''),
      };
    }),
  };
}

/**
 * Bitácora de una fila Stock Live: un producto en una sede (nunca multi-sede).
 */
export async function fetchProductStockBitacora(
  productId: string,
  schoolId: string,
  offset: number,
): Promise<StockBitacoraResponse> {
  if (!productId?.trim() || !schoolId?.trim()) {
    throw new Error('BITACORA_PARAMS: producto y sede son obligatorios.');
  }

  const { data, error } = await supabase.rpc('get_product_stock_bitacora', {
    p_product_id: productId,
    p_school_id: schoolId,
    p_limit: PAGE_SIZE,
    p_offset: Math.max(0, offset),
  });

  if (error) throw error;
  return parseBitacoraResponse(data);
}

export const STOCK_BITACORA_PAGE_SIZE = PAGE_SIZE;
