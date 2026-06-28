// ─── Tipos de la Bitácora de Pagos de Deuda ───────────────────────────────────
// Estos tipos reflejan exactamente lo que devuelven los RPCs de la BD.
// El frontend NO calcula nada a partir de estos datos; solo los muestra.

export type EventType = 'voucher' | 'admin_group' | 'admin_single';

/** Una fila de la lista principal: un pago que cubrió N boletas. */
export interface BitacoraEvent {
  event_id:         string;       // clave opaca devuelta a la BD para pedir boletas
  event_type:       EventType;
  event_ts:         string;       // ISO timestamptz
  amount:           number;       // monto total del evento
  student_name:     string | null;
  student_count:    number;       // >1 cuando el cobro agrupó varios alumnos
  school_name:      string;
  school_id:        string;
  payment_method:   string | null;
  operation_number: string | null; // referencia Yape/tarjeta/etc.
  ticket_count:     number;
  parent_name:      string | null;  // solo vouchers del padre
  parent_email:     string | null;  // solo vouchers del padre
  collector_name:   string | null;  // quien aprobó (voucher) o registró (admin)
  collector_email:  string | null;
  voucher_url:      string | null;  // foto del comprobante del padre
}

/** Una boleta dentro de un evento (carga lazy al abrir acordeón). */
export interface BitacoraTicket {
  transaction_id: string;
  ticket_code:    string | null;
  amount:         number;
  description:    string;
  is_lunch:       boolean;
  payment_status: string;
}

/** Detalle completo de una boleta (carga lazy al tocar la boleta). */
export interface BitacoraTicketDetail {
  transaction_id:   string;
  ticket_code:      string | null;
  amount:           number;
  description:      string;
  payment_status:   string;
  payment_method:   string | null;
  operation_number: string | null;
  created_at:       string;
  is_lunch:         boolean;
  student_name:     string | null;
  parent_name:      string | null;
  parent_email:     string | null;
  school_name:      string | null;
  collector_name:   string | null;
  collector_email:  string | null;
  voucher_url:      string | null;
  invoice_id:       string | null;
  invoice_pdf_url:  string | null;
}

/** Estado de los filtros de la bitácora. */
export interface BitacoraFilters {
  schoolId:      string | null;
  dateFrom:      string;
  dateTo:        string;
  searchTerm:    string;
  collectorId:   string | null;
}

/** Un elemento del selector de sede o cobrador. */
export interface SelectOption {
  id:   string;
  name: string;
}
