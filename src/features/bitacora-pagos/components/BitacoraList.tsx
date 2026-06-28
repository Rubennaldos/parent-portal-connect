import { Loader2, AlertCircle, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BitacoraEventRow } from './BitacoraEventRow';
import { BITACORA_PAGE_SIZE } from '../services/bitacoraService';
import type { BitacoraEvent, BitacoraTicket } from '../types';

interface Props {
  events:     BitacoraEvent[];
  total:      number;
  page:       number;
  totalPages: number;
  loading:    boolean;
  error:      string | null;
  onDetail:   (ticket: BitacoraTicket, event: BitacoraEvent) => void;
  onPage:     (p: number) => void;
}

export function BitacoraList({
  events, total, page, totalPages, loading, error, onDetail, onPage,
}: Props) {
  const from = (page - 1) * BITACORA_PAGE_SIZE + 1;
  const to   = Math.min(page * BITACORA_PAGE_SIZE, total);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Cargando bitácora...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-red-500">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm font-medium">Error al cargar los datos</p>
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <BookOpen className="h-10 w-10" />
        <p className="text-sm font-medium text-gray-500">No se encontraron pagos</p>
        <p className="text-xs">Probá cambiando las fechas o el término de búsqueda</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Contador de resultados */}
      <p className="text-sm text-gray-500">
        Mostrando <strong>{from}–{to}</strong> de <strong>{total}</strong> pago{total !== 1 ? 's' : ''}
      </p>

      {/* Lista de eventos */}
      <div className="space-y-3">
        {events.map((ev) => (
          <BitacoraEventRow key={ev.event_id} event={ev} onDetail={onDetail} />
        ))}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline" size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
          </Button>

          <span className="text-sm text-gray-600">
            Página <strong>{page}</strong> de <strong>{totalPages}</strong>
          </span>

          <Button
            variant="outline" size="sm"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Siguiente <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
