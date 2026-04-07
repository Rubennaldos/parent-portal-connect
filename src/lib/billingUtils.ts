/**
 * Utilidad compartida de facturación electrónica.
 *
 * Reglas de negocio:
 *   - Ticket + Efectivo (o sin método)  → is_taxable=false, billing_status='excluded'
 *   - Boleta o Factura (cualquier pago) → is_taxable=true,  billing_status='pending'
 *   - Ticket + Digital (yape/plin/tarjeta/transferencia) → is_taxable=true, billing_status='pending'
 *   - Recargas, reembolsos, ajustes     → is_taxable=false, billing_status='excluded'
 *
 * ESTADOS de billing_status:
 *   pending    = pendiente de enviar a SUNAT
 *   processing = reservado por el Cierre Mensual (TTL 10 min)
 *   sent       = boleta/factura emitida y aceptada
 *   error      = error genérico (legacy)
 *   excluded   = PERMANENTE: intencionalmente fuera de SUNAT (efectivo, billetera, ajustes)
 *   failed     = TEMPORAL: Nubefact falló; requiere reintento manual
 *
 * IMPORTANTE: 'excluded' y 'failed' son conceptos distintos. No confundirlos.
 */

export type BillingStatus = 'pending' | 'processing' | 'sent' | 'error' | 'excluded' | 'failed';

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

/**
 * Devuelve la etiqueta y clases CSS para mostrar billing_status como badge.
 * Usar en cualquier componente que renderice el estado de facturación.
 */
export function getBillingStatusBadge(status: string | null | undefined): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'sent':
      return { label: '✓ Enviado a SUNAT', className: 'bg-green-100 text-green-800 border border-green-300' };
    case 'pending':
      return { label: '⏳ Pendiente emitir', className: 'bg-amber-100 text-amber-800 border border-amber-300' };
    case 'processing':
      return { label: '⚙️ Procesando…', className: 'bg-blue-100 text-blue-800 border border-blue-300' };
    case 'failed':
      return { label: '✗ Error SUNAT', className: 'bg-red-100 text-red-800 border border-red-300 font-semibold' };
    case 'error':
      return { label: '⚠ Error técnico', className: 'bg-orange-100 text-orange-800 border border-orange-300' };
    case 'excluded':
      return { label: 'Sin boleta', className: 'bg-gray-100 text-gray-600 border border-gray-200' };
    default:
      return { label: status ?? '—', className: 'bg-gray-100 text-gray-500 border border-gray-200' };
  }
}
