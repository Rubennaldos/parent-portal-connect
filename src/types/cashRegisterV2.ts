// ─── Cierre de Caja v2 — Tipos ───────────────────────────────────────────────

export type CashSessionStatus = 'open' | 'closed';
export type ManualEntryType = 'income' | 'expense';
export type ManualEntryCategory =
  | 'overage'
  | 'deficit'
  | 'internal_purchase'
  | 'refund'
  | 'miscellaneous';
export type TreasuryTransferStatus = 'created' | 'in_transit' | 'received';

export interface CashSession {
  id: string;
  school_id: string;
  session_date: string;
  status: CashSessionStatus;
  opened_by: string;
  opened_at: string;
  initial_cash: number;
  initial_yape: number;
  initial_plin: number;
  initial_other: number;
  closed_by: string | null;
  closed_at: string | null;
  cashier_name: string | null;
  cashier_dni: string | null;
  cashier_signature: string | null;
  closure_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joins opcionales
  opener_profile?: { full_name: string; email: string } | null;
}

export interface CashManualEntry {
  id: string;
  cash_session_id: string;
  school_id: string;
  entry_type: ManualEntryType;
  amount: number;
  entry_date: string;
  category: ManualEntryCategory;
  description: string;
  created_by: string;
  created_at: string;
  // Join opcional
  creator_profile?: { full_name: string } | null;
}

export interface CashReconciliation {
  id: string;
  cash_session_id: string;
  school_id: string;
  system_cash: number;
  system_yape: number;
  system_plin: number;
  system_transferencia: number;
  system_tarjeta: number;
  system_mixto: number;
  system_total: number;
  physical_cash: number;
  physical_yape: number;
  physical_plin: number;
  physical_transferencia: number;
  physical_tarjeta: number;
  physical_mixto: number;
  physical_total: number;
  variance_cash: number;
  variance_yape: number;
  variance_plin: number;
  variance_transferencia: number;
  variance_tarjeta: number;
  variance_mixto: number;
  variance_total: number;
  declared_overage: number;
  declared_deficit: number;
  reconciled_by: string;
  created_at: string;
}

export interface TreasuryTransfer {
  id: string;
  cash_session_id: string;
  school_id: string;
  amount_cash: number;
  amount_yape: number;
  amount_plin: number;
  amount_transferencia: number;
  amount_total: number;
  status: TreasuryTransferStatus;
  sender_id: string;
  sender_name: string;
  sender_signature: string | null;
  receiver_id: string | null;
  receiver_name: string | null;
  receiver_signature: string | null;
  received_at: string | null;
  pdf_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Totales de ventas validadas del día, desglosados por método */
export interface DailySalesTotals {
  cash: number;
  yape: number;
  plin: number;
  transferencia: number;
  tarjeta: number;
  mixto: number;
  total: number;
}

export const CATEGORY_LABELS: Record<ManualEntryCategory, string> = {
  overage: 'Sobrante',
  deficit: 'Faltante / Déficit',
  internal_purchase: 'Compra Interna',
  refund: 'Devolución',
  miscellaneous: 'Varios',
};

export const PAYMENT_METHODS = [
  { key: 'cash', label: 'Efectivo', icon: '💵' },
  { key: 'yape', label: 'Yape', icon: '📱' },
  { key: 'plin', label: 'Plin', icon: '📲' },
  { key: 'transferencia', label: 'Transferencia', icon: '🏦' },
  { key: 'tarjeta', label: 'Tarjeta', icon: '💳' },
  { key: 'mixto', label: 'Pago Mixto', icon: '🔀' },
] as const;
