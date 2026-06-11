/**
 * Solo presentación POS: valores numéricos vienen de BD (ej. current_stock en product_stock).
 * No inferir montos financieros ni aplicar reglas de negocio de cobro aquí.
 */

export type PosStockBadgeVariant = 'negative' | 'empty' | 'low' | 'neutral' | 'none';

export function getPosStockBadge(input: {
  stock_control_enabled?: boolean;
  current_stock?: number | null;
}): { visible: boolean; label: string; variant: PosStockBadgeVariant } {
  // Verdad visual: siempre mostrar número (positivo, cero o negativo).
  const n = Number(input.current_stock ?? 0);
  if (n < 0) {
    return { visible: true, label: String(n), variant: 'negative' };
  }
  if (n === 0) {
    return { visible: true, label: '0', variant: 'empty' };
  }
  if (n <= 5) {
    return { visible: true, label: String(n), variant: 'low' };
  }
  return { visible: true, label: String(n), variant: 'neutral' };
}

/** Clases Tailwind para el badge (compacto en tarjetas POS). */
export function posStockBadgeClass(variant: PosStockBadgeVariant): string {
  switch (variant) {
    case 'negative':
      return 'bg-rose-100 text-rose-900';
    case 'empty':
      return 'bg-red-100 text-red-800';
    case 'low':
      return 'bg-amber-100 text-amber-900';
    case 'neutral':
      return 'bg-slate-100 text-slate-600';
    default:
      return '';
  }
}

/**
 * Regla única de bloqueo en POS:
 * - Switch global OFF + hay fila de stock en sede + stock <= 0 → bloquear.
 * - current_stock === null significa "sin fila product_stock" = venta libre → NO bloquear.
 * - stock_control_enabled ya no interviene: el switch global lo gobierna todo.
 */
export function shouldBlockProductCardWhenNoStock(input: {
  current_stock?: number | null;
}, allowNegativeStock: boolean): boolean {
  if (allowNegativeStock) return false;

  // Sin fila de stock en la sede → producto sin inventario configurado → venta libre.
  if (input.current_stock === null || input.current_stock === undefined) return false;

  return input.current_stock <= 0;
}
