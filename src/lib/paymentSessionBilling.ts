/**
 * Contrato único de datos fiscales para pagos iniciados desde el portal del padre.
 *
 * PROBLEMA QUE RESUELVE:
 *   El flujo de voucher manual (recharge_requests, vía useRechargeSubmit) ya
 *   persiste invoice_type + invoice_client_data con el shape exacto que arma
 *   InvoiceClientModal. El flujo de pasarela (payment_sessions, vía IziPay)
 *   nunca guardaba esos dos campos antes de redirigir — el webhook recibía
 *   una sesión vacía y emitía Boleta + Consumidor Final en silencio, sin que
 *   el padre se enterara de que su Factura con RUC se perdió en el camino.
 *
 * REGLA DE DISEÑO:
 *   Un solo shape para ambos canales de pago (voucher manual y pasarela).
 *   invoice_type SIEMPRE se deriva de invoiceClientData.tipo — nunca de un
 *   estado paralelo — para que ambos no puedan desincronizarse.
 */

import type { InvoiceType, InvoiceClientData } from '@/components/billing/InvoiceClientModal';

export interface PaymentSessionBillingFields {
  invoice_type: InvoiceType | null;
  invoice_client_data: InvoiceClientData | null;
}

/**
 * Campos fiscales para el INSERT en payment_sessions.
 *
 * Si no hay invoiceClientData (ej. recarga pura desde Index.tsx, que no pasa
 * por InvoiceClientModal), retorna ambos campos en null: es una recarga sin
 * comprobante solicitado, no un error — el comportamiento histórico (batch
 * nocturno / Consumidor Final) sigue aplicando para ese caso legítimo.
 */
export function buildPaymentSessionBilling(
  invoiceClientData: InvoiceClientData | null | undefined,
): PaymentSessionBillingFields {
  if (!invoiceClientData) {
    return { invoice_type: null, invoice_client_data: null };
  }
  return {
    invoice_type:        invoiceClientData.tipo,
    invoice_client_data: invoiceClientData,
  };
}

/**
 * Guard de integridad previo a redirigir a IziPay.
 *
 * Si el padre eligió Boleta/Factura en el selector pero los datos fiscales
 * no llegaron completos (modal cerrado a medias, estado desincronizado,
 * etc.), se bloquea el pago con un mensaje claro en vez de dejar que el
 * webhook complete la operación con datos nulos en silencio.
 *
 * Devuelve un mensaje de error legible para el padre, o null si está OK.
 */
export function getInvoiceBillingGuardError(
  invoiceType: InvoiceType | null | undefined,
  invoiceClientData: InvoiceClientData | null | undefined,
): string | null {
  // Sin selector de comprobante (ej. recarga simple): nada que validar.
  if (!invoiceType) return null;

  if (!invoiceClientData) {
    return 'No se encontraron los datos del comprobante. Vuelve a elegir Boleta o Factura e intenta de nuevo.';
  }

  if (invoiceClientData.tipo !== invoiceType) {
    return 'El tipo de comprobante no coincide con los datos ingresados. Vuelve a intentar.';
  }

  if (!invoiceClientData.doc_number || invoiceClientData.doc_number === '-') {
    return invoiceType === 'factura'
      ? 'Falta el RUC para emitir la factura. Vuelve a completarlo.'
      : 'Falta el número de documento para emitir la boleta. Vuelve a completarlo.';
  }

  if (!invoiceClientData.razon_social?.trim()) {
    return 'Falta el nombre o razón social para el comprobante. Vuelve a completarlo.';
  }

  if (invoiceType === 'factura' && !invoiceClientData.direccion?.trim()) {
    return 'Falta la dirección fiscal para emitir la factura. Vuelve a completarla.';
  }

  return null;
}
