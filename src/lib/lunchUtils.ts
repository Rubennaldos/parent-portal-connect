/**
 * lunchUtils.ts — Utilidades compartidas para identificar transacciones de almuerzo.
 *
 * REGLA DE ORO #1: Los almuerzos son COMPLETAMENTE independientes del kiosco.
 * Esta función es la ÚNICA fuente de verdad para determinar si una transacción
 * pertenece al módulo de almuerzos. No duplicar esta lógica en otros archivos.
 *
 * Usos actuales:
 *   - SalesList.tsx (ocultar trash icon en transacciones de almuerzo)
 *   - LunchOrders.tsx (verificaciones de tipo de transacción)
 *   - transactionUtils.ts (buildInlineLabel)
 */

/** Valores canónicos del campo metadata.source que identifican un almuerzo. */
const LUNCH_SOURCES = new Set([
  'lunch_orders_confirm',
  'lunch_order',
  'lunch_fast',
  'lunch',
]);

/** Mínimo de campos necesarios para la detección. */
export interface LunchSignature {
  metadata?: {
    lunch_order_id?: string | null;
    source?: string | null;
    [key: string]: unknown;
  } | null;
  description?: string | null;
}

/**
 * Devuelve `true` si la transacción pertenece al módulo de almuerzos.
 *
 * Orden de prioridad:
 *  1. metadata.lunch_order_id presente (más confiable — datos nuevos)
 *  2. metadata.source en LUNCH_SOURCES o contiene 'lunch'
 *  3. description empieza por 'Almuerzo' (fallback para registros legacy)
 */
export function isLunchTransaction(t: LunchSignature): boolean {
  if (t.metadata?.lunch_order_id) return true;

  const src = t.metadata?.source ?? '';
  if (LUNCH_SOURCES.has(src) || src.toLowerCase().includes('lunch')) return true;

  if (t.description?.startsWith('Almuerzo')) return true;

  return false;
}
