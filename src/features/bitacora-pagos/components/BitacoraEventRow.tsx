import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Receipt, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { useBitacoraTickets } from '../hooks/useBitacoraTickets';
import type { BitacoraEvent, BitacoraTicket } from '../types';

// ─── Utilidades de display ───────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  yape:             'Yape',
  plin:             'Plin',
  efectivo:         'Efectivo',
  tarjeta:          'Tarjeta',
  card:             'Tarjeta',
  transferencia:    'Transferencia',
  voucher:          'Comprobante',
  saldo:            'Saldo',
  mixto:            'Mixto',
  teacher_account:  'Cuenta Profesor',
};

function methodLabel(m: string | null) {
  if (!m) return 'Sin registrar';
  return METHOD_LABELS[m.toLowerCase()] ?? m;
}

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy  HH:mm", { locale: es });
}

// ─── Fila de una boleta dentro del acordeón ──────────────────────────────────

interface TicketRowProps {
  ticket:   BitacoraTicket;
  onDetail: (t: BitacoraTicket) => void;
}

function TicketRow({ ticket, onDetail }: TicketRowProps) {
  return (
    <button
      onClick={() => onDetail(ticket)}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left
                 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-0 group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Receipt className="h-4 w-4 text-gray-400 shrink-0" />
        <div className="min-w-0">
          {ticket.ticket_code ? (
            <span className="text-xs font-bold text-indigo-700 block">{ticket.ticket_code}</span>
          ) : (
            <span className="text-xs font-bold text-amber-700 block">Sin ticket T-</span>
          )}
          <span className="text-sm text-gray-700 truncate block">{ticket.description || 'Sin descripción'}</span>
        </div>
        {ticket.is_lunch && (
          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 shrink-0">
            Almuerzo
          </Badge>
        )}
      </div>
      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-gray-900">S/ {ticket.amount.toFixed(2)}</span>
        <span className="text-[10px] text-blue-500 block group-hover:text-blue-700">Ver detalle →</span>
      </div>
    </button>
  );
}

// ─── Fila principal del acordeón (un evento de pago) ────────────────────────

interface Props {
  event:    BitacoraEvent;
  onDetail: (ticket: BitacoraTicket, event: BitacoraEvent) => void;
}

export function BitacoraEventRow({ event, onDetail }: Props) {
  const [open, setOpen] = useState(false);
  const { tickets, loading, error, load, reset } = useBitacoraTickets();

  const toggle = () => {
    if (open) {
      setOpen(false);
      reset();
    } else {
      setOpen(true);
      load(event.event_id, event.event_type);
    }
  };

  const isVoucher = event.event_type === 'voucher';
  const isIzipay  = event.event_type === 'izipay';

  const borderColor = isVoucher
    ? 'border-l-green-500'
    : isIzipay
      ? 'border-l-violet-500'
      : 'border-l-blue-500';

  const badgeEl = isVoucher ? (
    <Badge variant="outline" className="text-[11px] bg-green-50 text-green-700 border-green-200">
      Voucher del padre
    </Badge>
  ) : isIzipay ? (
    <Badge variant="outline" className="text-[11px] bg-violet-50 text-violet-700 border-violet-200">
      Pago online IziPay
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[11px] bg-blue-50 text-blue-700 border-blue-200">
      Cobro admin
    </Badge>
  );

  return (
    <div className={`rounded-lg border border-gray-200 border-l-4 ${borderColor} overflow-hidden shadow-sm`}>

      {/* ── Cabecera: clic para abrir/cerrar ── */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left
                   hover:bg-gray-50 transition-colors"
      >
        {/* Ícono acordeón */}
        <span className="shrink-0 text-gray-400">
          {open
            ? <ChevronDown className="h-5 w-5" />
            : <ChevronRight className="h-5 w-5" />}
        </span>

        {/* Información principal */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Alumno o cantidad de alumnos */}
            <span className="font-bold text-gray-900 text-base">
              {event.student_count > 1
                ? `${event.student_count} alumnos`
                : (event.student_name ?? 'Alumno')}
            </span>
            {badgeEl}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
            <span>{formatDate(event.event_ts)}</span>
            <span className="font-medium text-gray-700">{methodLabel(event.payment_method)}</span>
            {event.operation_number && (
              <span className="font-mono text-gray-600">#{event.operation_number}</span>
            )}
            <span className="text-gray-400">{event.ticket_count} boleta{event.ticket_count !== 1 ? 's' : ''}</span>
          </div>

          {/* Sede (solo visible si admin_general con varias sedes) */}
          <p className="text-xs text-blue-700 font-medium">{event.school_name}</p>

          {/* Padre (voucher o IziPay) */}
          {(isVoucher || isIzipay) && event.parent_name && (
            <p className="text-xs text-gray-500">
              Pagó: <span className="font-medium text-gray-700">{event.parent_name}</span>
              {event.parent_email && (
                <span className="text-gray-400"> · {event.parent_email}</span>
              )}
            </p>
          )}

          {/* Admin cobrador (no aplica a IziPay) */}
          {!isIzipay && event.collector_name && (
            <p className="text-xs text-gray-500">
              {isVoucher ? 'Aprobó:' : 'Cobró:'}
              <span className="font-medium text-gray-700 ml-1">{event.collector_name}</span>
              {event.collector_email && (
                <span className="text-gray-400"> · {event.collector_email}</span>
              )}
            </p>
          )}
        </div>

        {/* Monto + foto voucher */}
        <div className="text-right shrink-0 space-y-1">
          <p className="text-2xl font-bold text-green-600">S/ {event.amount.toFixed(2)}</p>
          {event.voucher_url && (
            <a
              href={event.voucher_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-block text-[11px] text-blue-600 hover:text-blue-800 underline"
            >
              Ver comprobante
            </a>
          )}
        </div>
      </button>

      {/* ── Cuerpo del acordeón: lista de boletas ── */}
      {open && (
        <div className="border-t border-gray-100 bg-gray-50">
          {loading && (
            <div className="flex items-center gap-2 justify-center py-4 text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Cargando boletas...</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-sm">Error al cargar boletas. Intenta de nuevo.</span>
            </div>
          )}
          {!loading && !error && tickets.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No se encontraron boletas para este pago.</p>
          )}
          {!loading && !error && tickets.map((t) => (
            <TicketRow key={t.transaction_id} ticket={t} onDetail={(tk) => onDetail(tk, event)} />
          ))}
        </div>
      )}
    </div>
  );
}
