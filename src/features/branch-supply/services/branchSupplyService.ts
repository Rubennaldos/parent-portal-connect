/**
 * Servicio de datos del módulo Branch Supply.
 *
 * Responsabilidad: única puerta de acceso a Supabase para este feature.
 * Ningún componente ni hook del feature hace queries directas fuera de este archivo.
 *
 * Imports permitidos: solo @/lib/supabase y los tipos propios del feature.
 * Prohibido: importar desde logistics/, billing/, school-admin/, supply_requests.
 */

import { supabase } from '@/lib/supabase';
import type {
  SupplierOption,
  ProductSearchResult,
  ProductPackaging,
  MatchPreview,
  SubmitReceiptPayload,
  SubmitReceiptResult,
  ReceiptSummaryRow,
  ReceiptStatus,
  ReceiptDetail,
  ApproveReceiptPayload,
  ApproveReceiptResult,
  RejectReceiptResult,
  QuickReceiptPayload,
  QuickReceiptResult,
} from '../types';

// ── Utilidad de mensajes de error de RPC ──────────────────────────────────────

/**
 * Extrae el mensaje legible de errores de Supabase/PostgreSQL.
 * Los RPCs lanzan excepciones con prefijos en MAYÚSCULAS seguido de ': '.
 * Ejemplo: "SUPPLIER_NOT_FOUND: El proveedor seleccionado..." → "El proveedor..."
 */
export function extractRpcErrorMessage(err: unknown): string {
  if (!err) return 'Error desconocido.';
  const raw = (() => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e.message === 'string') return e.message;
      if (typeof e.details === 'string') return e.details;
      if (typeof e.hint   === 'string') return e.hint;
    }
    return 'Error desconocido.';
  })();

  // Quitar prefijo tipo "CODIGO_ERROR: " si el mensaje lo contiene
  const colonIdx = raw.indexOf(': ');
  if (colonIdx > 0 && colonIdx < 50 && /^[A-Z_]+$/.test(raw.slice(0, colonIdx))) {
    return raw.slice(colonIdx + 2);
  }
  return raw;
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

// ── Proveedores — búsqueda inteligente ────────────────────────────────────────

/**
 * Busca proveedores ignorando tildes, mayúsculas y minúsculas.
 * Usa el RPC search_suppliers_smart (unaccent + ILIKE).
 * Con texto vacío devuelve los primeros 10 proveedores ordenados por nombre.
 *
 * REEMPLAZA a fetchSuppliers() en el formulario de sede.
 * La sede no puede crear proveedores; solo seleccionar de esta lista.
 */
export async function searchSuppliersSmart(query: string): Promise<SupplierOption[]> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('search_suppliers_smart', {
    p_search_text: query.trim(),
  });

  if (error) {
    console.warn('[branchSupplyService] searchSuppliersSmart error:', error.message);
    return [];
  }
  return (data ?? []) as SupplierOption[];
}

// ── Búsqueda de productos ──────────────────────────────────────────────────────

/**
 * Busca productos activos usando el RPC search_products_pro.
 * Devuelve lista vacía si la consulta es muy corta o hay un error.
 */
export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  if (!query || query.trim().length < 1) return [];

  const db = requireSupabase();

  const { data, error } = await db.rpc('search_products_pro', {
    p_query: query.trim(),
    p_limit: 8,
  });

  if (error) {
    console.warn('[branchSupplyService] searchProducts error:', error.message);
    return [];
  }
  return (data ?? []) as ProductSearchResult[];
}

// ── Empaques (UoM) ────────────────────────────────────────────────────────────

/**
 * Obtiene los empaques autorizados para pedidos de sede del producto.
 * Solo devuelve los que tienen is_branch_order_allowed = true.
 */
export async function fetchProductPackagings(productId: string): Promise<ProductPackaging[]> {
  const db = requireSupabase();

  const { data, error } = await db
    .from('product_packaging')
    .select('id, uom_name, conversion_factor, is_branch_order_allowed')
    .eq('product_id', productId)
    .eq('is_branch_order_allowed', true)
    .order('conversion_factor');

  if (error) {
    console.warn('[branchSupplyService] fetchProductPackagings error:', error.message);
    return [];
  }
  return (data ?? []) as ProductPackaging[];
}

// ── Preview de totales (server-side, sin persistir) ───────────────────────────

/**
 * Llama al RPC preview_branch_supply_totals para calcular match score.
 * Usado por el Panel de Auditoría con debounce cuando el auditor digita costos.
 * NUNCA se usa para decisiones definitivas: solo para feedback UX.
 * La validación definitiva ocurre dentro de approve_branch_supply_receipt.
 */
export async function previewTotals(
  declaredTotal: number,
  items: Array<{ quantity: number; unit_cost: number }>,
): Promise<MatchPreview> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('preview_branch_supply_totals', {
    p_declared_total: declaredTotal,
    p_items:          items,
  });

  if (error) throw new Error(extractRpcErrorMessage(error));

  return data as MatchPreview;
}

// ── Listado de comprobantes (panel de auditoría) ──────────────────────────────

/**
 * Consulta la vista v_branch_supply_receipts_summary.
 * Con security_invoker=true, el admin_general ve todos; la sede ve solo los suyos.
 *
 * @param statusFilter 'all' devuelve todos los estados; si se omite, solo 'pending'.
 */
export async function fetchReceiptsSummary(
  statusFilter: ReceiptStatus | 'all' = 'pending',
): Promise<ReceiptSummaryRow[]> {
  const db = requireSupabase();

  let query = db
    .from('v_branch_supply_receipts_summary')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;

  if (error) throw new Error(extractRpcErrorMessage(error));
  return (data ?? []) as ReceiptSummaryRow[];
}

/**
 * Historial de comprobantes de UNA sede específica.
 * Filtra explícitamente por school_id además de respetar el RLS.
 * Usado por BranchSupplySedePanel — la sede solo ve los suyos.
 */
export async function fetchSedeReceiptHistory(
  schoolId:     string,
  statusFilter: ReceiptStatus | 'all' = 'all',
  limit         = 60,
): Promise<ReceiptSummaryRow[]> {
  const db = requireSupabase();

  let query = db
    .from('v_branch_supply_receipts_summary')
    .select('*')
    .eq('school_id', schoolId)           // filtro explícito: defensa doble con el RLS
    .order('submitted_at', { ascending: false })
    .limit(limit);

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;

  if (error) throw new Error(extractRpcErrorMessage(error));
  return (data ?? []) as ReceiptSummaryRow[];
}

// ── Detalle de un comprobante (split-screen) ──────────────────────────────────

/**
 * Invoca get_branch_supply_receipt_detail.
 * Devuelve cabecera + ítems + proveedor + sede en una sola llamada.
 * Incluye match_score calculado por la BD (no el frontend).
 */
export async function getReceiptDetail(receiptId: string): Promise<ReceiptDetail> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('get_branch_supply_receipt_detail', {
    p_receipt_id: receiptId,
  });

  if (error) throw new Error(extractRpcErrorMessage(error));

  return data as ReceiptDetail;
}

// ── Aprobar comprobante v2 (costos + IGV + stock atómico) ─────────────────────

/**
 * Invoca approve_branch_supply_receipt con los costos finales del Auditor General.
 *
 * El RPC ejecuta en una sola transacción atómica:
 *   1. Actualiza unit_cost en cada ítem con los valores del auditor.
 *   2. Actualiza prices_include_igv en cabecera.
 *   3. Recalcula match score con los costos reales → falla si no cuadra.
 *   4. Llama a increment_product_stock por cada ítem.
 *   5. Actualiza status = 'approved' + audit_log.
 *
 * Garantía: si CUALQUIER paso falla → rollback total.
 */
export async function approveReceipt(
  payload: ApproveReceiptPayload,
): Promise<ApproveReceiptResult> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('approve_branch_supply_receipt', {
    p_receipt_id:         payload.receiptId,
    p_cost_items:         payload.costItems,
    p_prices_include_igv: payload.pricesIncludeIgv,
  });

  if (error) throw new Error(extractRpcErrorMessage(error));

  return data as ApproveReceiptResult;
}

// ── Ingreso rápido (sin comprobante, stock inmediato) ─────────────────────────

/**
 * Llama a submit_quick_stock_receipt.
 * Solo requiere schoolId, lista de ítems (product_id + quantity + uom_id) y nota opcional.
 * El RPC aplica stock atómicamente sin pasar por flujo de auditoría.
 */
export async function submitQuickReceipt(
  payload: QuickReceiptPayload,
): Promise<QuickReceiptResult> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('submit_quick_stock_receipt', {
    p_school_id: payload.schoolId,
    p_items:     payload.items.map(it => ({
      product_id: it.product_id,
      quantity:   it.quantity,
      uom_id:     it.uom_id ?? null,
    })),
    p_notes: payload.notes ?? null,
  });

  if (error) throw new Error(extractRpcErrorMessage(error));

  return data as QuickReceiptResult;
}

// ── Rechazar comprobante (sin tocar stock) ────────────────────────────────────

/**
 * Invoca reject_branch_supply_receipt.
 * El stock permanece INTACTO — solo cambia el status y registra el motivo.
 * El RPC valida que rejection_reason no sea vacío (muralla server-side).
 */
export async function rejectReceipt(
  receiptId:       string,
  rejectionReason: string,
): Promise<RejectReceiptResult> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('reject_branch_supply_receipt', {
    p_receipt_id:       receiptId,
    p_rejection_reason: rejectionReason,
  });

  if (error) throw new Error(extractRpcErrorMessage(error));

  return data as RejectReceiptResult;
}

// ── Envío del comprobante ──────────────────────────────────────────────────────

/**
 * Llama a submit_branch_supply_receipt.
 * Precondición: el archivo de evidencia ya fue subido y su path está en el payload.
 * Si este RPC falla, el caller (hook) debe eliminar el archivo huérfano.
 *
 * NOTA: unit_cost en todos los ítems siempre es 0 (la sede no registra costos).
 *       El stock lo aplica el RPC en BD al enviar (no espera aprobación).
 */
export async function submitReceipt(
  payload: SubmitReceiptPayload,
): Promise<SubmitReceiptResult> {
  const db = requireSupabase();

  const { data, error } = await db.rpc('submit_branch_supply_receipt', {
    p_school_id:           payload.schoolId,
    p_supplier_id:         payload.supplierId,
    p_doc_type:            payload.docType,
    p_doc_number:          payload.docNumber ?? null,
    p_declared_total:      0,
    p_prices_include_igv:  false,           // siempre false desde la sede
    p_notes:               payload.notes ?? null,
    p_evidence_path:       payload.evidencePath ?? null,
    p_items:               payload.items.map(it => ({
      product_id: it.product_id,
      quantity:   it.quantity,
      unit_cost:  0,                        // costos los fija el Auditor al aprobar
      uom_id:     it.uom_id ?? null,
    })),
    p_replaces_receipt_id: payload.replacesReceiptId ?? null,
  });

  if (error) throw new Error(extractRpcErrorMessage(error));

  return data as SubmitReceiptResult;
}
