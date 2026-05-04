import { supabase } from '@/lib/supabase';

export type ProductSchoolPricePayload = {
  school_id: string;
  price_sale: number;
  price_cost?: number | null;
  is_available?: boolean;
};

export type SaveProductScopeAndPricesResult = {
  ok: boolean;
  mode?: string;
  product_id?: string;
  rows_inserted?: number;
};

/** Errores de triggers/RPC relacionados con alcance de sede (para Toast logística) */
export const PRICE_SCOPE_ERROR_RE =
  /SAVE_SCOPE_PRICES_|PRICE_SCOPE|PRICE_SCHOOL_NOT_IN_SCOPE/i;

export function getSupabaseErrorBlob(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    return [o.message, o.hint, o.details]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' ');
  }
  return err instanceof Error ? err.message : String(err ?? '');
}

export function isPriceScopeRelatedError(err: unknown): boolean {
  return PRICE_SCOPE_ERROR_RE.test(getSupabaseErrorBlob(err));
}

/** Texto unificado para Toast cuando falla validación de disponibilidad / alcance */
export function getPriceScopeFriendlyToast(): { title: string; description: string } {
  return {
    title: 'Error de Disponibilidad',
    description:
      'Error de Disponibilidad: La sede seleccionada no está en el alcance de este producto. Verifica la configuración de sedes antes de asignar precios.',
  };
}

/**
 * RPC atómico `save_product_scope_and_prices` — única vía de escritura para
 * disponibilidad por sede + precios de producto.
 *
 * Roles:
 *  - admin_general / supervisor_red → actualiza `products.school_ids` y reemplaza
 *    TODAS las filas de `product_school_prices` del producto en una sola transacción.
 *  - gestor_unidad → no toca `school_ids`; solo borra e inserta la fila de su sede.
 *
 * @param params.productId   UUID del producto a actualizar.
 * @param params.schoolIds   Nuevo alcance: null = global, [] = sin sedes, [ids] = específicas.
 * @param params.prices      Array de filas de precio a persistir.
 *                           Supabase JS serializa este array como jsonb al RPC automáticamente.
 *                           Solo incluir las filas con precio personalizado o is_available=false;
 *                           las no enviadas quedarán sin fila (usan precio base del producto).
 */
export async function saveProductScopeAndPrices(params: {
  productId: string;
  /** null = producto global (todas las sedes) */
  schoolIds: string[] | null;
  prices: ProductSchoolPricePayload[];
}): Promise<SaveProductScopeAndPricesResult> {
  const { data, error } = await supabase.rpc('save_product_scope_and_prices', {
    p_product_id: params.productId,
    p_school_ids: params.schoolIds,
    p_prices: params.prices,
  });

  if (error) throw error;

  return (data ?? { ok: true }) as SaveProductScopeAndPricesResult;
}
