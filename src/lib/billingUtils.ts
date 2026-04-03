/**
 * Utilidad compartida de facturación electrónica.
 *
 * Reglas de negocio:
 *   - Ticket + Efectivo (o sin método)  → is_taxable=false, billing_status='excluded'
 *   - Boleta o Factura (cualquier pago) → is_taxable=true,  billing_status='pending'
 *   - Ticket + Digital (yape/plin/tarjeta/transferencia) → is_taxable=true, billing_status='pending'
 *   - Recargas, reembolsos, ajustes     → is_taxable=false, billing_status='excluded'
 *
 * IMPORTANTE: el efectivo sin comprobante NUNCA aparece en el módulo de facturación manual.
 */

export type BillingStatus = 'pending' | 'sent' | 'excluded';

export interface BillingFlags {
  is_taxable: boolean;
  billing_status: BillingStatus;
}

// 'pagar_luego' = deuda sin cobrar todavía → nunca facturable hasta que se pague
// 'adjustment' = ajuste contable interno → no facturable
const METODOS_EFECTIVO = ['efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment'];

export function calcBillingFlags(
  documentType: 'ticket' | 'boleta' | 'factura' | string | null | undefined,
  paymentMethod: string | null | undefined,
): BillingFlags {
  const docType = documentType ?? 'ticket';

  // Boleta o factura: siempre gravado, pendiente de emitir
  if (docType === 'boleta' || docType === 'factura') {
    return { is_taxable: true, billing_status: 'pending' };
  }

  // Ticket + efectivo / saldo / sin método: excluido de facturación electrónica
  const esEfectivo = !paymentMethod || METODOS_EFECTIVO.includes(paymentMethod);
  if (esEfectivo) {
    return { is_taxable: false, billing_status: 'excluded' };
  }

  // Ticket + método digital (tarjeta, yape, plin, transferencia, mixto): gravado
  return { is_taxable: true, billing_status: 'pending' };
}

/**
 * Shortcut: transacciones que NUNCA son facturables
 * (recargas, reembolsos, ajustes, deudas sin pago).
 */
export const BILLING_EXCLUDED: BillingFlags = {
  is_taxable: false,
  billing_status: 'excluded',
};
