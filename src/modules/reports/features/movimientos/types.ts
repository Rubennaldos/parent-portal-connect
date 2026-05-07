export interface PaymentsRow {
  id: string;
  op_number: string;
  ticket_number: string;
  payment_date: string;   // 'DD/MM/YYYY' — ya formateado por el RPC
  payment_time: string;   // 'HH:MM'      — ya formateado por el RPC
  week_number: number;
  registered_by: string;
  client_name: string;
  amount: number;         // siempre positivo (el RPC hace ABS)
  payment_method: string;
  payment_status: string;
  reference: string;
  school_name: string;
  description: string;
}

export interface PaymentsColumnFilters {
  opNumber: string;
  ticketNumber: string;
  clientName: string;
  reference: string;
  paymentMethod: string;
}

export const EMPTY_PAYMENTS_FILTERS: PaymentsColumnFilters = {
  opNumber: '',
  ticketNumber: '',
  clientName: '',
  reference: '',
  paymentMethod: 'all',
};

export const PAYMENTS_METHOD_OPTIONS = [
  { value: 'all',           label: 'Todos' },
  { value: 'efectivo',      label: 'Efectivo' },
  { value: 'yape',          label: 'Yape' },
  { value: 'plin',          label: 'Plin' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta',       label: 'Tarjeta' },
  { value: 'mixto',         label: 'Mixto' },
] as const;

export const PAGE_SIZE = 50;
