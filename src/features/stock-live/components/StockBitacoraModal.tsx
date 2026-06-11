/**
 * Bitácora de movimientos: un producto en una sede (lectura paginada desde RPC).
 */

import { useEffect } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useStockBitacora } from '../hooks/useStockBitacora';
import type { StockBitacoraTarget } from '../types';

interface StockBitacoraModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fila seleccionada; null cierra sin consultar */
  selection: StockBitacoraTarget | null;
}

export function StockBitacoraModal({
  open,
  onOpenChange,
  selection,
}: StockBitacoraModalProps) {
  const {
    target,
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    pageSize,
    open: loadBitacora,
    loadMore,
    refresh,
    reset,
  } = useStockBitacora();

  useEffect(() => {
    if (open && selection) {
      loadBitacora(selection);
    }
    if (!open) {
      reset();
    }
  }, [open, selection, loadBitacora, reset]);

  const titleProduct = target?.productName ?? selection?.productName ?? 'Producto';
  const titleSchool = target?.schoolName ?? selection?.schoolName ?? 'Sede';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-2 shrink-0 space-y-1">
          <DialogTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-600" />
            Bitácora de movimientos
          </DialogTitle>
          <DialogDescription className="text-xs text-left">
            <span className="font-medium text-slate-700">{titleProduct}</span>
            <span className="text-slate-400"> · </span>
            <span className="text-slate-600">{titleSchool}</span>
            <span className="block text-[10px] text-slate-400 mt-0.5">
              Solo esta sede · últimos {pageSize} por página
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-2 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={loading || !target}
            onClick={() => refresh()}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-5">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-400 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando movimientos...
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 py-10 text-center">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 py-10 text-center">
              Sin movimientos registrados para este producto en esta sede.
            </p>
          ) : (
            <ul className="space-y-0 pb-2">
              {items.map((row, idx) => (
                <li
                  key={`${row.occurred_at_lima}-${row.delta_label}-${idx}`}
                  className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0"
                >
                  <span
                    className={`font-bold tabular-nums text-sm ${
                      row.quantity_delta > 0
                        ? 'text-emerald-700'
                        : row.quantity_delta < 0
                          ? 'text-red-600'
                          : 'text-slate-500'
                    }`}
                  >
                    {row.delta_label}
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {row.occurred_at_lima}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="px-5 py-4 border-t shrink-0">
          {hasMore && !error && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={loadingMore || loading}
              onClick={() => loadMore()}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Cargando...
                </>
              ) : (
                `Ver ${pageSize} movimientos anteriores`
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
