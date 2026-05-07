export interface SalesRow {
  id: string;
  op_code: string;
  report_op_seq: number;
  ticket_code: string | null;
  payment_ref: string | null;
  amount: number;
  type: string;
  payment_method: string | null;
  payment_status: string | null;
  created_at: string;
  week_number: number;
  school_name: string | null;
  client_name: string;
  seller_name: string;
  description: string | null;
  is_deleted: boolean;
}

export interface SalesColumnFilters {
  ticketCode: string;
  opCode: string;
  paymentRef: string;
  clientName: string;
  sellerName: string;
  paymentMethod: string;
  paymentStatus: string;
}

export const EMPTY_COLUMN_FILTERS: SalesColumnFilters = {
  ticketCode: '',
  opCode: '',
  paymentRef: '',
  clientName: '',
  sellerName: '',
  paymentMethod: 'all',
  paymentStatus: 'all',
};

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'mixto', label: 'Mixto' },
] as const;

export const PAYMENT_STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'completed', label: 'Completado' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'refunded', label: 'Anulado' },
] as const;

export const PAGE_SIZE = 50;
