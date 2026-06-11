/**
 * Tipos del dominio "Branch Supply" (Comprobantes de Suministros por Sede).
 *
 * Reglas:
 *  - Estos tipos no se importan desde componentes de logística central ni de
 *    módulos legados (supply_requests, inventory_items).
 *  - Los DTOs de lectura son mínimos; solo los campos que el feature consume.
 */

// ── Enumeraciones ──────────────────────────────────────────────────────────────

/** Valores persistidos en branch_supply_receipts.doc_type (lectura / BD). */
export type DocType = 'boleta' | 'factura' | 'guia' | 'nota_venta' | 'interno';

/** Solo formulario estándar de sede (con comprobante). interno queda exclusivo del RPC rápido. */
export type DocTypeSedeForm = Exclude<DocType, 'interno'>;

export type ReceiptStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  boleta:      'Boleta',
  factura:     'Factura',
  guia:        'Guía de Remisión',
  nota_venta:  'Nota de Venta',
  interno:     'Ingreso interno',
};

/** Opciones del combo "Tipo de documento" — Registrar Ingreso → Estándar. */
export const DOC_TYPE_OPTIONS_SEDE: ReadonlyArray<{ value: DocTypeSedeForm; label: string }> = [
  { value: 'boleta',     label: DOC_TYPE_LABELS.boleta },
  { value: 'factura',    label: DOC_TYPE_LABELS.factura },
  { value: 'guia',       label: DOC_TYPE_LABELS.guia },
  { value: 'nota_venta', label: DOC_TYPE_LABELS.nota_venta },
] as const;

/** Etiqueta de tipo para listados y modal (respeta is_quick, no el combo de sede). */
export function receiptDocTypeLabel(row: { is_quick: boolean; doc_type: DocType }): string {
  if (row.is_quick) return 'Ingreso rápido';
  return DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type;
}

/** Monto en listados: pendiente sin monto de sede vs total ya auditado. */
export function receiptDisplayAmount(row: {
  is_quick:        boolean;
  declared_total:  number;
  status:          ReceiptStatus;
}): string | null {
  if (row.is_quick) return null;
  if (row.status === 'pending' && row.declared_total <= 0) return null;
  return row.declared_total.toFixed(2);
}

/** true = aprobación por costos de línea (sin cotejo contra monto de sede). */
export function receiptUsesAuditorCostOnly(row: {
  is_quick:       boolean;
  declared_total: number;
  status:         ReceiptStatus;
}): boolean {
  return !row.is_quick && row.declared_total <= 0;
}

// ── DTOs de lectura (datos que vienen de la BD) ────────────────────────────────

export interface SupplierOption {
  id:   string;
  name: string;
  ruc:  string | null;
}

/** Resultado devuelto por el RPC search_products_pro */
export interface ProductSearchResult {
  product_id:    string;
  product_name:  string;
  product_code:  string | null;
  category:      string;
  last_unit_cost: number;
  relevance:     number;
}

/** Empaque/UoM de un producto (product_packaging) */
export interface ProductPackaging {
  id:                string;
  uom_name:          string;
  conversion_factor: number;
  is_branch_order_allowed: boolean;
}

// ── Estado interno del formulario ──────────────────────────────────────────────

/**
 * Campos de la cabecera del comprobante (formulario de sede).
 * NOTA: La sede NO registra costos unitarios ni flag IGV.
 * - pricesIncludeIgv: lo establece el Auditor General al aprobar.
 * - unit_cost por ítem: siempre 0 en el submit de la sede.
 */
export interface HeaderFields {
  supplierId:  string;
  docType:     DocTypeSedeForm;
  docNumber:   string;
  notes:       string;
}

/**
 * Estado de una fila de la grilla de ítems (formulario de sede).
 * SEDE CIEGA DE COSTOS: sin campo unitCost.
 */
export interface LineItem {
  /** Clave local de React (no se envía a la BD) */
  uid:         string;
  productId:   string;
  productName: string;
  productCode: string;
  /** Cantidad como string para input controlado; la BD recibe integer */
  quantity:    string;
  /** UUID del empaque seleccionado; '' = sin UoM (unidades base) */
  uomId:       string;
  packagings:  ProductPackaging[];
  // ── estado de búsqueda de producto (por fila) ──
  searchQuery:   string;
  searchResults: ProductSearchResult[];
  searchLoading: boolean;
  showResults:   boolean;
}

/**
 * Estado del buscador de proveedores en el formulario de sede.
 * Reemplaza el dropdown estático; usa search_suppliers_smart RPC.
 */
export interface SupplierSearchState {
  query:         string;
  results:       SupplierOption[];
  loading:       boolean;
  showResults:   boolean;
  /** Proveedor actualmente seleccionado (null = sin selección) */
  selected:      SupplierOption | null;
}

export const EMPTY_SUPPLIER_SEARCH: SupplierSearchState = {
  query:       '',
  results:     [],
  loading:     false,
  showResults: false,
  selected:    null,
};

// ── Tipos del Panel de Auditoría (costos por auditor) ─────────────────────────

/**
 * Input de costo por ítem en el Panel de Auditoría.
 * El Auditor General digita el costo unitario real de cada producto
 * basándose en la factura física visualizada a la izquierda.
 */
export interface CostItemInput {
  item_id:   string;
  /** string para input controlado; parseado a number al enviar */
  unit_cost: string;
}

// ── Resultados de RPCs ─────────────────────────────────────────────────────────

/** Resultado de preview_branch_supply_totals */
export interface MatchPreview {
  lines_sum:      number;
  declared_total: number;
  matched:        boolean;
  delta_cents:    number;
  phase?:         'legacy_sede_declared_total' | 'auditor_line_costs' | 'awaiting_auditor_costs';
}

/** Resultado de submit_branch_supply_receipt */
export interface SubmitReceiptResult {
  ok:             boolean;
  receipt_id:     string;
  receipt_number: string;
  lines_sum:      number;
  declared_total: number;
  matched:        boolean;
  delta_cents:    number;
  warning:        string | null;
}

// ── Payload de submit ──────────────────────────────────────────────────────────

export interface ReceiptItemPayload {
  product_id: string;
  quantity:   number;
  unit_cost:  number;
  uom_id:     string | null;
}

/**
 * Payload para submit_branch_supply_receipt.
 * - pricesIncludeIgv NO está aquí: la sede no gestiona IGV.
 *   El Auditor General lo establece al aprobar (approve_branch_supply_receipt).
 * - unit_cost en items siempre es 0 cuando viene desde la sede.
 */
export interface SubmitReceiptPayload {
  schoolId:            string;
  supplierId:          string;
  docType:             DocTypeSedeForm;
  docNumber:           string | null;
  notes:               string | null;
  evidencePath:        string | null;
  items:               ReceiptItemPayload[];
  replacesReceiptId?:  string | null;
}

/** Payload para approve_branch_supply_receipt (costos finales del auditor) */
export interface ApproveReceiptPayload {
  receiptId:          string;
  costItems:          { item_id: string; unit_cost: number }[];
  pricesIncludeIgv:   boolean;
}

// ── Estado de subida de evidencia ──────────────────────────────────────────────

export interface EvidenceUploadState {
  file:       File | null;
  /** Ruta relativa en el bucket branch_supply_evidence */
  path:       string | null;
  progress:   number;
  uploading:  boolean;
  error:      string | null;
}

export const EMPTY_EVIDENCE: EvidenceUploadState = {
  file:      null,
  path:      null,
  progress:  0,
  uploading: false,
  error:     null,
};

// ── DTOs del Panel de Auditoría ────────────────────────────────────────────────
// Mapeados 1:1 a las columnas de v_branch_supply_receipts_summary

export interface ReceiptSummaryRow {
  id:                  string;
  receipt_number:      string;
  school_id:           string;
  school_name:         string;
  supplier_id:         string | null;
  supplier_name:       string;            // COALESCE en vista → siempre string
  supplier_ruc:        string | null;
  submitted_by:        string;
  doc_type:            DocType;
  doc_number:          string | null;
  declared_total:      number;
  prices_include_igv:  boolean;
  evidence_path:       string | null;
  match_matched:       boolean | null;
  match_delta_cents:   number | null;
  match_lines_sum:     number | null;
  status:              ReceiptStatus;
  notes:               string | null;
  reviewed_by:         string | null;
  reviewed_at:         string | null;
  rejection_reason:    string | null;
  replaces_receipt_id: string | null;
  submitted_at:        string;
  updated_at:          string;
  /** true = ingreso rápido (stock inmediato, sin proveedor ni comprobante) */
  is_quick:            boolean;
  items_count:         number;
  items_sum_live:      number;
}

// ── DTOs de get_branch_supply_receipt_detail ───────────────────────────────────

export interface ReceiptDetailItem {
  id:                string;
  product_id:        string;
  product_name:      string;
  product_code:      string | null;
  quantity:          number;
  unit_cost:         number;
  line_total:        number;
  uom_id:            string | null;
  uom_name:          string | null;
  conversion_factor: number | null;
  sort_order:        number;
}

export interface ReceiptDetailSupplier {
  id:             string;
  name:           string;
  ruc:            string | null;
  contact_person: string | null;
  phone:          string | null;
}

export interface ReceiptDetailSchool {
  id:   string;
  name: string;
}

/** match_score JSONB del comprobante; calculado por submit/approve RPCs */
export interface MatchScore {
  lines_sum:      number;
  declared_total: number;
  /** true = coincide al céntimo; false = descalce (bloquea botón Aprobar) */
  matched:        boolean;
  delta_cents:    number;
  warning?:       string | null;
}

/** Cabecera branch_supply_receipts mapeada a camelCase para consumo seguro */
export interface ReceiptDetailHeader {
  id:                  string;
  receipt_number:      string;
  school_id:           string;
  supplier_id:         string | null;
  submitted_by:        string;
  doc_type:            DocType;
  doc_number:          string | null;
  declared_total:      number;
  prices_include_igv:  boolean;
  evidence_path:       string | null;
  match_score:         MatchScore | null;
  is_quick:            boolean;
  status:              ReceiptStatus;
  notes:               string | null;
  reviewed_by:         string | null;
  reviewed_at:         string | null;
  rejection_reason:    string | null;
  replaces_receipt_id: string | null;
  submitted_at:        string;
  updated_at:          string;
}

/** Respuesta completa de get_branch_supply_receipt_detail */
export interface ReceiptDetail {
  receipt:  ReceiptDetailHeader;
  items:    ReceiptDetailItem[] | null;
  supplier: ReceiptDetailSupplier | null;
  school:   ReceiptDetailSchool | null;
}

// ── Resultados de RPCs de auditoría ───────────────────────────────────────────

export interface ApproveReceiptResult {
  ok:             boolean;
  receipt_id:     string;
  receipt_number: string;
  items_approved: number;
  lines_sum:      number;
  declared_total: number;
}

export interface RejectReceiptResult {
  ok:               boolean;
  receipt_id:       string;
  receipt_number:   string;
  rejection_reason: string;
}

// ── Modo rápido (ingreso interno sin comprobante) ──────────────────────────────

/** Ítem a enviar en un ingreso rápido: producto + cantidad + empaque */
export interface QuickReceiptItemPayload {
  product_id: string;
  quantity:   number;
  uom_id:     string | null;
}

/** Payload para submit_quick_stock_receipt */
export interface QuickReceiptPayload {
  schoolId: string;
  items:    QuickReceiptItemPayload[];
  notes:    string | null;
}

/** Resultado de submit_quick_stock_receipt */
export interface QuickReceiptResult {
  ok:             boolean;
  receipt_id:     string;
  receipt_number: string;
}
