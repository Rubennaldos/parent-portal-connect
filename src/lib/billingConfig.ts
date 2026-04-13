/**
 * billingConfig.ts — Configuración Centralizada de Facturación
 *
 * PROPÓSITO: Única fuente de verdad para decidir qué comprobante emitir
 * en cada canal de pago. Todas las pantallas deben usar get_billing_config
 * en lugar de tener lógica if/else duplicada.
 *
 * REGLAS POR CANAL:
 *
 *   parent_web:
 *     - Siempre Boleta o Factura (el padre seleccionó invoice_type al subir voucher)
 *     - Nunca Ticket
 *
 *   admin_cxc:
 *     - Ticket por defecto (cobro en oficina sin comprobante formal)
 *     - Boleta/Factura solo si el admin selecciona explícitamente
 *
 *   pos_kiosk:
 *     - Ticket por defecto (venta rápida en cafetería)
 *     - Boleta/Factura solo si el cliente lo solicita en caja
 *
 * INTEGRACIÓN CON billingUtils.ts:
 *   get_billing_config devuelve el document_type ya resuelto.
 *   Para obtener is_taxable y billing_status, pasar ese document_type
 *   a calcBillingFlags() de billingUtils.ts.
 */

import { calcBillingFlags, BILLING_EXCLUDED, type BillingFlags } from './billingUtils';

// ── Tipos ──────────────────────────────────────────────────────────────────────

/** Canal de pago — identifica desde qué módulo se origina la transacción */
export type SourceChannel = 'parent_web' | 'admin_cxc' | 'pos_kiosk';

/** Tipo de comprobante a emitir */
export type DocumentType = 'ticket' | 'boleta' | 'factura';

/** Resultado de get_billing_config */
export interface BillingConfig extends BillingFlags {
  /** Comprobante resuelto para este contexto */
  document_type: DocumentType;
  /** Canal de origen — para incluir en metadata de transactions */
  source_channel: SourceChannel;
}

// ── Regla por defecto de documento por canal ───────────────────────────────────

const DEFAULT_DOCUMENT: Record<SourceChannel, DocumentType> = {
  parent_web: 'boleta',
  admin_cxc:  'ticket',
  pos_kiosk:  'ticket',
};

// ── Helper principal ───────────────────────────────────────────────────────────

/**
 * Devuelve la configuración de facturación completa para una transacción.
 *
 * @param channel       Canal de pago (ver SourceChannel)
 * @param paymentMethod Método de pago usado ('efectivo', 'yape', 'transferencia', …)
 * @param invoiceType   Tipo de comprobante solicitado explícitamente (o null para usar el default del canal)
 *
 * @example — POS sin comprobante especial:
 *   const cfg = get_billing_config('pos_kiosk', 'efectivo');
 *   // → { document_type: 'ticket', is_taxable: false, billing_status: 'excluded', source_channel: 'pos_kiosk' }
 *
 * @example — Padre paga con boleta:
 *   const cfg = get_billing_config('parent_web', 'transferencia', 'boleta');
 *   // → { document_type: 'boleta', is_taxable: true, billing_status: 'pending', source_channel: 'parent_web' }
 *
 * @example — Admin CXC emite boleta en oficina:
 *   const cfg = get_billing_config('admin_cxc', 'yape', 'boleta');
 *   // → { document_type: 'boleta', is_taxable: true, billing_status: 'pending', source_channel: 'admin_cxc' }
 */
export function get_billing_config(
  channel: SourceChannel,
  paymentMethod: string | null | undefined,
  invoiceType?: DocumentType | string | null,
): BillingConfig {
  // Resolver document_type: usar el explícito si viene, si no el default del canal
  const resolved = (invoiceType ?? DEFAULT_DOCUMENT[channel]) as DocumentType;

  // parent_web NUNCA puede emitir Ticket — siempre Boleta o Factura
  const document_type: DocumentType =
    channel === 'parent_web' && resolved === 'ticket' ? 'boleta' : resolved;

  // Calcular flags de facturación (is_taxable + billing_status)
  const flags = calcBillingFlags(document_type, paymentMethod);

  return {
    ...flags,
    document_type,
    source_channel: channel,
  };
}

/**
 * Variante para recargas y ajustes internos que NUNCA son facturables.
 * Usar en recharge aprobals, ajustes manuales, devoluciones internas.
 */
export function get_recharge_billing_config(channel: SourceChannel): BillingConfig {
  return {
    ...BILLING_EXCLUDED,
    document_type: 'ticket',
    source_channel: channel,
  };
}

// ── Etiquetas de canal para mostrar en UI ─────────────────────────────────────

export const CHANNEL_LABELS: Record<SourceChannel, string> = {
  parent_web: 'Portal Web',
  admin_cxc:  'Cobranzas (Oficina)',
  pos_kiosk:  'POS Kiosco',
};

/**
 * Devuelve la etiqueta legible y clases CSS para mostrar el canal de origen.
 */
export function getSourceChannelBadge(channel: string | null | undefined): {
  label: string;
  className: string;
} {
  switch (channel) {
    case 'parent_web':
      return { label: 'Portal Web', className: 'bg-blue-100 text-blue-800 border border-blue-200' };
    case 'admin_cxc':
      return { label: 'Cobranzas', className: 'bg-purple-100 text-purple-800 border border-purple-200' };
    case 'pos_kiosk':
      return { label: 'POS Kiosco', className: 'bg-orange-100 text-orange-800 border border-orange-200' };
    default:
      return { label: '—', className: 'bg-gray-100 text-gray-500 border border-gray-200' };
  }
}
