import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';
import { BitacoraFilters } from './components/BitacoraFilters';
import { BitacoraList }    from './components/BitacoraList';
import { BitacoraTicketDetailModal } from './components/BitacoraTicketDetailModal';
import { useBitacoraList }  from './hooks/useBitacoraList';
import type { BitacoraEvent, BitacoraTicket, SelectOption } from './types';

interface Props {
  schools:           SelectOption[];
  canViewAllSchools: boolean;
  userSchoolId:      string | null;
}

interface ActiveDetail {
  ticket: BitacoraTicket;
  event:  BitacoraEvent;
}

/**
 * Bitácora de pagos de deuda.
 * Un evento = un pago (voucher del padre o cobro directo del admin).
 * Acordeón lazy → boletas → modal detalle.
 * Cero cálculos financieros en este componente; todo viene de la BD.
 */
export function BitacoraLayout({ schools, canViewAllSchools, userSchoolId }: Props) {
  const {
    filters, events, total, page, totalPages,
    loading, error, applyFilters, goToPage, initialLoad,
  } = useBitacoraList();

  const [activeDetail, setActiveDetail] = useState<ActiveDetail | null>(null);

  // Carga inicial con la semana actual
  useEffect(() => { initialLoad(); }, [initialLoad]);

  // Si el usuario es gestor, forzar su sede como default
  useEffect(() => {
    if (!canViewAllSchools && userSchoolId) {
      applyFilters({ schoolId: userSchoolId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAllSchools, userSchoolId]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-bold text-gray-800">
            <BookOpen className="h-5 w-5 text-blue-600" />
            Bitácora de Pagos
          </CardTitle>
          <p className="text-xs text-gray-500 mt-0.5">
            Cada línea es un pago. Tocá para ver las boletas que cubrió.
          </p>
        </CardHeader>
        <CardContent>
          <BitacoraFilters
            filters={filters}
            schools={schools}
            canViewAllSchools={canViewAllSchools}
            onApply={applyFilters}
          />

          <BitacoraList
            events={events}
            total={total}
            page={page}
            totalPages={totalPages}
            loading={loading}
            error={error}
            onDetail={(ticket, event) => setActiveDetail({ ticket, event })}
            onPage={goToPage}
          />
        </CardContent>
      </Card>

      {/* Modal de detalle de boleta */}
      {activeDetail && (
        <BitacoraTicketDetailModal
          ticket={activeDetail.ticket}
          event={activeDetail.event}
          onClose={() => setActiveDetail(null)}
        />
      )}
    </div>
  );
}
