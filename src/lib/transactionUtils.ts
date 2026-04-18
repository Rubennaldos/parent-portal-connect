/**
 * transactionUtils.ts — Helpers puros para formatear datos de transacciones en la UI.
 *
 * Todas las funciones son PURAS (sin side-effects, sin dependencia de estado React)
 * para que puedan vivir fuera de los componentes y no se recreen en cada render.
 */

import { getPaymentMethodLabel } from './paymentMethodLabels';
import { isLunchTransaction, type LunchSignature } from './lunchUtils';

/** Forma mínima de transacción que necesita buildInlineLabel. */
export interface TransactionForLabel extends LunchSignature {
  payment_method?: string | null;
  description?: string | null;
  student_id?: string | null;
  teacher_id?: string | null;
}

/**
 * Construye la etiqueta compacta para la vista agrupada de ventas.
 *
 * Formato: [Método de pago] · [Descripción limpia] · [Tipo de cliente]
 *
 * Reglas de limpieza de descripción:
 *  - "Compra Cliente Genérico · N Items" → "N producto(s)"
 *  - "Venta Genérica POS · S/ X [OFFLINE]" → "Venta POS"
 *  - Resto: usar descripción tal cual, truncada a 55 chars
 */
export function buildInlineLabel(t: TransactionForLabel): string {
  const method = getPaymentMethodLabel(t.payment_method) || '—';

  const customerType = t.student_id
    ? 'Alumno'
    : t.teacher_id
      ? 'Profesor'
      : 'Genérico';

  const rawDesc = t.description ?? '';
  let desc = rawDesc;

  // Kiosco multi-producto: "Compra Cliente Genérico · 14 items" → "14 productos"
  const itemsMatch = rawDesc.match(/(\d+)\s*[Ii]tems?/);
  if (itemsMatch) {
    const n = parseInt(itemsMatch[1], 10);
    desc = n === 1 ? '1 producto' : `${n} productos`;
  } else if (rawDesc.startsWith('Compra Cliente Genérico')) {
    desc = rawDesc
      .replace('Compra Cliente Genérico · ', '')
      .replace('Compra Cliente Genérico', 'Compra kiosco')
      .trim();
  } else if (rawDesc.startsWith('Venta Genérica POS')) {
    desc = rawDesc
      .replace(/Venta Genérica POS\s*·?\s*/i, '')
      .replace(/\[OFFLINE\]/i, '')
      .trim() || 'Venta POS';
  }

  // Truncar descripciones muy largas
  if (desc.length > 55) desc = desc.substring(0, 52) + '…';

  return [method, desc, customerType].filter(Boolean).join(' · ');
}
