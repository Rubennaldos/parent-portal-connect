/**
 * PosConsumptionModal — Consumos de Cafetería
 *
 * Usa la RPC get_student_pos_consumptions que hace JOIN con `sales`
 * para obtener el detalle de productos de cada compra.
 *
 * Dos modos:
 *  - Normal (showHistory=false): solo pending/partial → deuda real con botón Pagar.
 *  - Historial (showHistory=true): todas las compras → info de Cuenta Libre, sin botón Pagar.
 */
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import {
  ShoppingBag,
  AlertCircle,
  ArrowDownLeft,
  CreditCard,
  CheckCircle2,
} from 'lucide-react';

interface Consumo {
  id: string;
  created_at: string;
  amount: number;
  description: string | null;
  ticket_code: string | null;
  payment_method: string | null;
  payment_status: string;
  metadata: any;
  sale_items?: ProductItem[];
}

interface ProductItem {
  name: string;
  quantity: number;
  price?: number;
}

export interface PosConsumptionModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  /** Callback cuando el padre presiona "Pagar deuda" (monto = suma RPC en pantalla) */
  onPay?: (total: number) => void;
  /**
   * true → modo historial: muestra TODAS las compras kiosco (paid + pending)
   * Usar cuando la deuda es saldo_negativo (Cuenta Libre).
   * false (default) → solo pending/partial.
   */
  showHistory?: boolean;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-100 rounded-lg ${className ?? ''}`} />
);

function parseSaleItems(rawItems: any[]): ProductItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  return rawItems.map((it: any) => ({
    name:     it.product_name || it.name || it.descripcion || it.nombre || 'Producto retirado',
    quantity: Number(it.quantity ?? it.cantidad ?? it.qty ?? 1),
    price:    it.unit_price != null ? Number(it.unit_price)
            : it.price     != null ? Number(it.price)
            : undefined,
  }));
}


export function PosConsumptionModal({
  open,
  onClose,
  studentId,
  studentName,
  onPay,
  showHistory = false,
}: PosConsumptionModalProps) {
  const [consumos, setConsumos]   = useState<Consumo[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [kioskPendingTotal, setKioskPendingTotal] = useState<number>(0);

  useEffect(() => {
    if (!open || !studentId) return;
    fetchMovimientos();
  }, [open, studentId]);

  useEffect(() => {
    if (!open) {
      setConsumos([]);
      setError(null);
      setKioskPendingTotal(0);
    }
  }, [open]);

  const fetchMovimientos = async () => {
    setLoading(true);
    setError(null);
    try {
      // Una sola llamada a la RPC que ya trae JOIN con sales → detalle de productos.
      // La RPC devuelve paid + pending + partial; filtramos en cliente según modo.
      const { data: rpcData, error: rpcErr } = await supabase
        .rpc('get_student_pos_consumptions', { p_student_id: studentId });

      if (rpcErr) throw rpcErr;

      const all: Consumo[] = (rpcData ?? []).map((row: any) => ({
        id:             row.id,
        created_at:     row.created_at,
        amount:         row.amount,
        description:    row.description,
        ticket_code:    row.ticket_code,
        payment_method: row.payment_method,
        payment_status: row.payment_status,
        metadata:       row.metadata,
        sale_items:     parseSaleItems(
          Array.isArray(row.sale_items) ? row.sale_items : []
        ),
      }));

      // showHistory=false → solo compras con deuda pendiente (pending/partial)
      // showHistory=true  → todo el historial (Cuenta Libre con saldo negativo)
      const visible = showHistory
        ? all
        : all.filter(c => c.payment_status === 'pending' || c.payment_status === 'partial');

      setConsumos(visible);

      // El total pagable siempre se calcula solo sobre pending/partial,
      // nunca sobre las filas "paid" (ya procesadas).
      const total = all
        .filter(c => c.payment_status === 'pending' || c.payment_status === 'partial')
        .reduce((sum, c) => sum + Math.abs(c.amount), 0);
      setKioskPendingTotal(total);

    } catch {
      setError('No se pudieron cargar los consumos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const firstName = studentName.split(' ')[0];
  const hayDeuda  = kioskPendingTotal > 0.009;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-sm w-full p-0 overflow-hidden rounded-2xl"
        aria-describedby={undefined}
      >
        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-slate-800 leading-tight">
                Estado de Cuenta — Cafetería
              </DialogTitle>
              <p className="text-xs text-slate-400 mt-0.5">{firstName}</p>
            </div>
          </div>
        </DialogHeader>

        {/* ── Cuerpo ── */}
        <div className="px-4 py-3 max-h-[52vh] overflow-y-auto space-y-4">

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>

          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-3">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>

          ) : consumos.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-600">Sin consumos registrados</p>
              <p className="text-xs text-slate-400 mt-1">{firstName} no tiene compras en cafetería</p>
            </div>

          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider px-1 flex items-center gap-1">
                <ArrowDownLeft className="w-3 h-3" />
                {showHistory ? 'Historial de consumos en cafetería' : 'Consumos por pagar'}
              </p>
              {showHistory && (
                <p className="text-[10px] text-slate-400 px-1">
                  Estas compras fueron realizadas con Cuenta Libre (crédito). El saldo negativo es el acumulado pendiente de pago.
                </p>
              )}
              {consumos.map((c) => {
                const products = c.sale_items ?? [];
                return (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 px-3 py-2.5 bg-white border border-rose-100 rounded-xl"
                  >
                    <ArrowDownLeft className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      {products.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {products.map((p, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[9px] font-medium text-slate-700"
                            >
                              <span className="font-bold">{p.quantity}×</span>
                              {p.name}
                              {p.price != null && (
                                <span className="text-slate-400 ml-0.5">S/{p.price.toFixed(2)}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-slate-700">Compra en cafetería</p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        {format(new Date(c.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                        {c.ticket_code && (
                          <span className="ml-1.5 text-slate-300">· {c.ticket_code}</span>
                        )}
                      </p>
                    </div>
                    <p className="text-sm font-black text-rose-500 shrink-0">
                      −S/ {Math.abs(c.amount).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer: saldo + botón ── */}
        {!loading && !error && (
          <div className="px-5 pt-3 pb-5 border-t border-slate-100 bg-slate-50/60 space-y-3">

            {/* Línea de saldo */}
            {hayDeuda ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    {showHistory ? 'Saldo negativo acumulado' : 'Deuda pendiente'}
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    {showHistory
                      ? 'Total de compras en crédito (Cuenta Libre) sin pagar'
                      : 'Suma de consumos de cafetería pendientes de pago'}
                  </p>
                </div>
                <p className="text-2xl font-black text-rose-500">
                  S/ {kioskPendingTotal.toFixed(2)}
                </p>
              </div>
            ) : showHistory ? (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-700">Deuda por saldo negativo acumulado</p>
                  <p className="text-[9px] text-amber-600 mt-0.5">
                    Estas compras se procesaron en crédito (Cuenta Libre). Para pagar, usa el botón <strong>Pagar</strong> en la pantalla de Pagos.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-700">Sin deuda pendiente</p>
                  <p className="text-[9px] text-emerald-600">{firstName} está al día con la cafetería</p>
                </div>
              </div>
            )}

            {/* Botón de pago — solo si hay deuda real */}
            {hayDeuda && onPay && (
              <Button
                onClick={() => onPay(kioskPendingTotal)}
                className="w-full rounded-xl font-bold text-sm py-3 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md active:scale-95"
              >
                <CreditCard className="w-4 h-4 mr-2 shrink-0" />
                Pagar deuda — S/ {kioskPendingTotal.toFixed(2)}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
