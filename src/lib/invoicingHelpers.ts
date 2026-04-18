/**
 * Helpers centralizados para la emisión automática de comprobantes electrónicos.
 *
 * MOTIVACIÓN:
 *   VoucherApproval.tsx construía el objeto `cliente` manualmente en 2+ lugares,
 *   omitiendo el campo `email` → Nubefact ponía `enviar_automaticamente_al_cliente=false`
 *   → el PDF nunca llegaba al correo del padre aunque él lo había ingresado.
 *
 * SOLUCIÓN ESCALABLE:
 *   - `buildClientePayload` centraliza la construcción: todos los campos, siempre.
 *   - `buildAutoEmisionBody` genera el body completo para `generate-document`.
 *   - `logEmisionFallida` registra fallos en `error_logs` con contexto suficiente
 *     para auditoría (req_id, tx_ids, amount, invoice_type, error).
 *
 * USO:
 *   import { buildClientePayload, buildAutoEmisionBody, logEmisionFallida }
 *     from '@/lib/invoicingHelpers';
 *
 *   // Construir cliente (siempre incluye email)
 *   const cliente = buildClientePayload(req.invoice_client_data, req.students?.full_name);
 *
 *   // Construir body completo
 *   const body = buildAutoEmisionBody({
 *     schoolId, txId, invoiceType, invoiceClientData, fallbackName,
 *     amount, igvPct, descriptionLine, paymentMethod,
 *   });
 *
 *   // Log de fallo auditado
 *   logEmisionFallida(error, { schoolId, txIds, amount, invoiceType, parentName, reqId });
 */

import { logErrorAsync } from '@/lib/logError';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Datos del cliente enviados a `generate-document` → Nubefact.
 * Todos los campos son siempre presentes (nunca undefined) para que
 * Nubefact tenga una estructura predecible.
 */
export interface ClientePayload {
  /** 'dni' | 'ruc' | '-' (sin documento) */
  doc_type: string;
  /** Número de documento (8 dig. DNI, 11 RUC) o '-' si no aplica */
  doc_number: string;
  /** Razón social o nombre del cliente */
  razon_social: string;
  /** Dirección fiscal (cadena vacía válida para boleta sin dirección) */
  direccion: string;
  /**
   * Email del cliente.
   * Nubefact evalúa `!!(cliente?.email)` para decidir si envía el PDF.
   * Omitirlo o dejarlo vacío desactiva el envío automático al cliente.
   */
  email: string;
}

/**
 * Forma cruda de invoice_client_data tal como se guarda en recharge_requests
 * (JSONB de Supabase → parsed como Record o null).
 */
export type RawInvoiceClientData = Record<string, string | null | undefined> | null | undefined;

/** Parámetros para construir el body completo de generate-document */
export interface AutoEmisionBodyParams {
  /** UUID de la sede (requerido por generate-document) */
  schoolId: string | null | undefined;
  /** Primera transacción aprobada (para el JOIN invoices.transaction_id) */
  txId: string | null | undefined;
  /** 'boleta' | 'factura' */
  invoiceType: string;
  /** Datos crudos del cliente desde recharge_requests */
  invoiceClientData: RawInvoiceClientData;
  /** Nombre de respaldo (alumno o padre) cuando razon_social esté vacío */
  fallbackName: string;
  /** Monto total YA precalculado (sin redondeado adicional aquí) */
  amount: number;
  /**
   * IGV en porcentaje (ej: 18 o 10.5).
   * Debe calcularse con la misma aritmética de céntimos que usa generate-document
   * para no crear discrepancias en el header vs ítems.
   */
  igvPct: number;
  /** Descripción del ítem en el comprobante */
  descriptionLine: string;
  /** Método de pago (yape, efectivo, tarjeta…) */
  paymentMethod: string | null | undefined;
}

/** Contexto auditado al registrar un fallo de emisión */
export interface EmisionLogContext {
  schoolId:    string | null | undefined;
  txIds:       string[];
  amount:      number;
  invoiceType: string;
  parentName:  string;
  reqId:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildClientePayload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye el objeto `cliente` para `generate-document` de forma consistente.
 *
 * GARANTÍAS:
 *   - Nunca devuelve campos undefined.
 *   - `email` siempre está presente (crucial para el envío automático del PDF).
 *   - `razon_social` cae a fallbackName antes de "Consumidor Final".
 *
 * @param rawData      - invoice_client_data de recharge_requests (puede ser null)
 * @param fallbackName - Nombre de respaldo (ej: nombre del alumno)
 */
export function buildClientePayload(
  rawData: RawInvoiceClientData,
  fallbackName: string = 'Consumidor Final',
): ClientePayload {
  return {
    doc_type:     rawData?.doc_type    || '-',
    doc_number:   rawData?.doc_number  || '-',
    razon_social: rawData?.razon_social || fallbackName || 'Consumidor Final',
    direccion:    rawData?.direccion   || '',
    // ← Campo que faltaba: sin él, Nubefact no envía el PDF al cliente.
    email:        rawData?.email       || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildAutoEmisionBody
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye el body completo para invocar `generate-document` en una
 * aprobación automática (VoucherApproval, CierreMensual, etc.).
 *
 * La aritmética IGV usa céntimos enteros para evitar ruido IEEE 754.
 * La misma fórmula que usa la Edge Function internamente al recalcular ítems.
 */
export function buildAutoEmisionBody(p: AutoEmisionBodyParams): Record<string, unknown> {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalForInvoice = round2(p.amount);

  // Aritmética de céntimos — evita ±0.01 que SUNAT/Nubefact rechaza
  const totalCents  = Math.round(totalForInvoice * 100);
  const divisorX100 = 100 + p.igvPct;
  const baseCents   = Math.floor(totalCents * 100 / divisorX100);
  const igvCents    = totalCents - baseCents;
  const base        = baseCents / 100;
  const igv         = igvCents  / 100;

  const cliente = buildClientePayload(p.invoiceClientData, p.fallbackName);

  return {
    school_id:      p.schoolId    ?? null,
    transaction_id: p.txId        ?? null,
    tipo:           p.invoiceType === 'factura' ? 1 : 2,
    cliente,
    items: [{
      unidad_de_medida:         'NIU',
      codigo:                   'PAGO',
      descripcion:              p.descriptionLine,
      cantidad:                 1,
      valor_unitario:           base,
      precio_unitario:          totalForInvoice,
      descuento:                '',
      subtotal:                 base,
      tipo_de_igv:              1,
      igv,
      total:                    totalForInvoice,
      anticipo_regularizacion:  false,
    }],
    monto_total:    totalForInvoice,
    payment_method: p.paymentMethod ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// logEmisionFallida
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra un fallo de emisión automática en `error_logs` con contexto
 * completo para auditoría.
 *
 * "Fire-and-forget": no bloquea el flujo principal.
 * Siempre hace console.error como fallback para devtools/Vercel logs.
 *
 * @param error   - Mensaje de error (string) o excepción
 * @param context - Contexto auditado: req_id, tx_ids, amount, invoice_type…
 */
export function logEmisionFallida(
  error: string | unknown,
  context: EmisionLogContext,
): void {
  const msg = typeof error === 'string'
    ? error
    : (error as any)?.message ?? JSON.stringify(error);

  logErrorAsync('auto_billing', `Emisión automática fallida — ${context.invoiceType}: ${msg}`, {
    schoolId: context.schoolId ?? null,
    context: {
      req_id:       context.reqId,
      tx_ids:       context.txIds,
      amount:       context.amount,
      invoice_type: context.invoiceType,
      parent_name:  context.parentName,
      error_detail: msg,
    },
  });
}
