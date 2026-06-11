import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Printer, Receipt, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface TransactionDetailItem {
  description: string;
  qty: number;
  unit_price: number;
  total: number;
}

export interface TransactionDetailData {
  fecha: string;
  hora: string;
  numero_comprobante: string;
  vendedor_nombre: string;
  productos_detalle_json: TransactionDetailItem[];
  sunat_documento_numero: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: TransactionDetailData | null;
  isCancelled?: boolean;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  refundMethod?: string | null;
  onPrint?: () => void;
}

export const TransactionDetailModal = ({
  open,
  onOpenChange,
  detail,
  isCancelled = false,
  cancelledBy = null,
  cancelledAt = null,
  cancellationReason = null,
  refundMethod = null,
  onPrint,
}: Props) => {
  const items = detail?.productos_detalle_json ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-600" />
            Detalle de la venta
          </DialogTitle>
          <DialogDescription>
            Información general y detalle de productos de la transacción.
          </DialogDescription>
        </DialogHeader>

        {!detail ? (
          <div className="rounded-md border bg-slate-50 p-4 text-sm text-slate-600">
            Cargando detalle...
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-3">Información General</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <p><span className="text-slate-500">Fecha:</span> <span className="font-semibold">{detail.fecha || '—'}</span></p>
                <p><span className="text-slate-500">Hora:</span> <span className="font-semibold">{detail.hora || '—'}</span></p>
                <p><span className="text-slate-500">Número de Comprobante:</span> <span className="font-semibold">{detail.numero_comprobante || '—'}</span></p>
                <p><span className="text-slate-500">Vendedor (Cajero):</span> <span className="font-semibold">{detail.vendedor_nombre || '—'}</span></p>
                {detail.sunat_documento_numero && (
                  <p className="md:col-span-2">
                    <span className="text-slate-500">Documento de la SUNAT:</span>{' '}
                    <span className="font-semibold text-indigo-700">{detail.sunat_documento_numero}</span>
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-3">Detalle de Productos</h3>
              {items.length === 0 ? (
                <p className="text-sm text-slate-500">No se encontraron productos para esta venta.</p>
              ) : (
                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div key={`${it.description}-${idx}`} className="flex items-center justify-between text-sm border-b pb-2">
                      <span className="text-slate-700">
                        {Number(it.qty || 0).toFixed(0)} x {it.description || 'Producto'}
                      </span>
                      <span className="font-semibold text-slate-900">
                        S/ {Number(it.total || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {isCancelled && (
              <section className="rounded-lg border border-red-300 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-700 flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  Venta anulada (auditoría)
                </p>
                <div className="text-xs text-slate-700 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <span className="text-slate-500 font-semibold">Anulado por:</span>
                  <span>{cancelledBy || '—'}</span>
                  <span className="text-slate-500 font-semibold">Fecha y hora:</span>
                  <span>{cancelledAt ? format(new Date(cancelledAt), 'dd/MM/yyyy HH:mm:ss', { locale: es }) : '—'}</span>
                  <span className="text-slate-500 font-semibold">Motivo:</span>
                  <span>{cancellationReason || '—'}</span>
                  {refundMethod && (
                    <>
                      <span className="text-slate-500 font-semibold">Devolución:</span>
                      <span>{refundMethod}</span>
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={onPrint} className="gap-2" disabled={!detail}>
            <Printer className="h-4 w-4" />
            Imprimir Real
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

