import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { fetchBitacoraTicketDetail } from '../services/bitacoraService';
import type { BitacoraTicket, BitacoraTicketDetail, BitacoraEvent } from '../types';

// ─── Utilidades ──────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  yape: 'Yape', plin: 'Plin', efectivo: 'Efectivo', tarjeta: 'Tarjeta',
  transferencia: 'Transferencia', voucher: 'Comprobante del padre',
  saldo: 'Saldo', mixto: 'Mixto', teacher_account: 'Cuenta Profesor',
};

function methodLabel(m: string | null) {
  if (!m) return 'Sin registrar';
  return METHOD_LABELS[m.toLowerCase()] ?? m;
}

// ─── Fila de detalle (label + valor) ────────────────────────────────────────

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-2 gap-2 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 break-all">{value}</span>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

interface Props {
  ticket: BitacoraTicket;
  event:  BitacoraEvent;
  onClose: () => void;
}

export function BitacoraTicketDetailModal({ ticket, event, onClose }: Props) {
  const [detail,  setDetail]  = useState<BitacoraTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchBitacoraTicketDetail(ticket.transaction_id)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error inesperado'))
      .finally(() => setLoading(false));
  }, [ticket.transaction_id]);

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
         onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div>
            {ticket.ticket_code && (
              <span className="text-xs font-bold text-indigo-700 block mb-0.5">{ticket.ticket_code}</span>
            )}
            <h2 className="font-bold text-gray-900 text-lg leading-tight">
              {ticket.description || 'Detalle de boleta'}
            </h2>
            <p className="text-2xl font-bold text-green-600 mt-1">S/ {ticket.amount.toFixed(2)}</p>
          </div>
          <button onClick={onClose}
            className="shrink-0 p-1.5 rounded-full hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Cargando detalle...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 py-4">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {!loading && !error && detail && (
            <div className="space-y-5">

              {/* Sección: Qué es */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Detalle</h3>
                <div className="bg-gray-50 rounded-lg p-3">
                  <Row label="Fecha"
                    value={format(new Date(detail.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })} />
                  <Row label="Descripción" value={detail.description} />
                  <Row label="Ticket"      value={detail.ticket_code} />
                  <Row label="Estado"      value={
                    detail.payment_status === 'paid' ? '✅ Pagado' :
                    detail.payment_status === 'pending' ? '⏳ Pendiente' : detail.payment_status
                  } />
                  <Row label="Tipo"        value={detail.is_lunch ? 'Almuerzo' : 'Compra / Deuda'} />
                  <Row label="Sede"        value={detail.school_name} />
                </div>
              </section>

              {/* Sección: Alumno */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Alumno</h3>
                <div className="bg-gray-50 rounded-lg p-3">
                  <Row label="Nombre" value={detail.student_name} />
                </div>
              </section>

              {/* Sección: Quien pagó (solo voucher con padre) */}
              {(detail.parent_name || event.parent_name) && (
                <section>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Quien pagó (padre)</h3>
                  <div className="bg-green-50 rounded-lg p-3">
                    <Row label="Nombre"  value={detail.parent_name ?? event.parent_name} />
                    <Row label="Correo"  value={detail.parent_email ?? event.parent_email} />
                  </div>
                </section>
              )}

              {/* Sección: Quien cobró / aprobó */}
              {(detail.collector_name || event.collector_name) && (
                <section>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    {event.event_type === 'voucher' ? 'Quien aprobó (admin)' : 'Quien cobró (admin)'}
                  </h3>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <Row label="Nombre" value={detail.collector_name ?? event.collector_name} />
                    <Row label="Correo" value={detail.collector_email ?? event.collector_email} />
                  </div>
                </section>
              )}

              {/* Sección: Medio de pago */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Medio de pago</h3>
                <div className="bg-gray-50 rounded-lg p-3">
                  <Row label="Método"       value={methodLabel(detail.payment_method ?? event.payment_method)} />
                  <Row label="N° operación" value={detail.operation_number ?? event.operation_number} />
                </div>
              </section>

              {/* Foto del comprobante del padre */}
              {(detail.voucher_url ?? event.voucher_url) && (
                <section>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Comprobante del padre
                  </h3>
                  <a href={detail.voucher_url ?? event.voucher_url!}
                     target="_blank" rel="noopener noreferrer"
                     className="block rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors">
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-2">
                      <ImageIcon className="h-4 w-4 text-gray-400" />
                      <span className="text-xs text-gray-600">Ver foto del comprobante</span>
                      <ExternalLink className="h-3.5 w-3.5 text-blue-400 ml-auto" />
                    </div>
                    <img src={detail.voucher_url ?? event.voucher_url!}
                         alt="Comprobante de pago"
                         className="w-full max-h-52 object-cover" />
                  </a>
                </section>
              )}

              {/* Comprobante SUNAT */}
              {detail.invoice_pdf_url && (
                <section>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">SUNAT</h3>
                  <Button asChild variant="outline" size="sm" className="w-full border-indigo-400 text-indigo-600 hover:bg-indigo-50">
                    <a href={detail.invoice_pdf_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Ver PDF SUNAT
                    </a>
                  </Button>
                </section>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <Button variant="outline" className="w-full" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}
