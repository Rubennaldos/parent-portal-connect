/**
 * PosConsumptionModal — Detalle de consumos en Cafetería / Kiosco
 *
 * Muestra las transacciones POS que descontaron saldo del estudiante,
 * explicando de dónde viene la deuda actual.
 *
 * Props:
 *  - studentId   : ID del estudiante
 *  - studentName : Nombre del estudiante (para el título)
 *  - kioskDebt   : Math.abs(balance) — monto total adeudado (para confirmar en el footer)
 *  - open        : controla visibilidad
 *  - onClose     : cierra el modal
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
import { supabase } from '@/lib/supabase';
import { ShoppingBag, AlertCircle } from 'lucide-react';

interface Consumo {
  id: string;
  created_at: string;
  amount: number;
  description: string | null;
  ticket_code: string | null;
  payment_method: string | null;
  metadata: any;
}

interface PosConsumptionModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  kioskDebt: number;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-100 rounded-lg ${className ?? ''}`} />
);

export function PosConsumptionModal({
  open,
  onClose,
  studentId,
  studentName,
  kioskDebt,
}: PosConsumptionModalProps) {
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !studentId) return;
    fetchConsumos();
  }, [open, studentId]);

  const fetchConsumos = async () => {
    setLoading(true);
    setError(null);
    try {
      // El indicador real de compra POS es metadata->>'source' = 'pos'
      // El payment_method puede ser 'yape', 'plin', 'saldo', 'null', etc.
      // dependiendo de cómo el cajero registró el pago en el POS.
      // Excluir almuerzos (lunch_order_id presente).
      const { data, error: fetchErr } = await supabase
        .from('transactions')
        .select('id, created_at, amount, description, ticket_code, payment_method, metadata')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .filter('metadata->>source', 'eq', 'pos')
        .in('payment_status', ['paid', 'pending'])
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(300);

      if (fetchErr) throw fetchErr;

      // Excluir en memoria cualquier transacción que tenga lunch_order_id (son almuerzos, no kiosco)
      const posOnly = (data ?? []).filter(
        (t: any) => !t.metadata?.lunch_order_id
      );

      setConsumos(posOnly);
    } catch (e: any) {
      setError('No se pudieron cargar los consumos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const totalConsumo = consumos.reduce((acc, c) => acc + Math.abs(c.amount), 0);
  const firstName = studentName.split(' ')[0];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm w-full p-0 overflow-hidden rounded-2xl">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-slate-800 leading-tight">
                Consumos en Cafetería
              </DialogTitle>
              <p className="text-xs text-slate-400 mt-0.5">{firstName}</p>
            </div>
          </div>
        </DialogHeader>

        {/* Cuerpo */}
        <div className="px-4 py-3 max-h-[55vh] overflow-y-auto space-y-1.5">
          {loading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </>
          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-3">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          ) : consumos.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">No se encontraron consumos recientes.</p>
              <p className="text-xs text-slate-300 mt-1">El saldo puede haberse ajustado manualmente.</p>
            </div>
          ) : (
            consumos.map((c) => {
              const isPaidFromBalance = c.metadata?.paid_from_balance === true;
              const source = c.metadata?.source ?? c.payment_method ?? 'pos';
              const label = c.description
                || (source === 'pos' ? 'Consumo en Cafetería' : `Consumo (${source})`);

              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2.5 bg-slate-50/70 rounded-xl border border-slate-100"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{label}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {format(new Date(c.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                      {c.ticket_code && (
                        <span className="ml-1.5 text-slate-300">· {c.ticket_code}</span>
                      )}
                    </p>
                    {isPaidFromBalance && (
                      <span className="text-[9px] text-rose-400 font-medium">Descontado del saldo</span>
                    )}
                  </div>
                  <p className="text-sm font-black text-rose-500 shrink-0">
                    −S/ {Math.abs(c.amount).toFixed(2)}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Footer — Total adeudado */}
        {!loading && !error && (
          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
                  Deuda actual registrada
                </p>
                <p className="text-[9px] text-slate-300 mt-0.5">
                  Saldo oficial de {firstName} en el sistema
                </p>
              </div>
              <p className="text-xl font-black text-rose-500">
                S/ {kioskDebt.toFixed(2)}
              </p>
            </div>

            {/* Aviso de discrepancia — cuando consumos listados no cuadran con el saldo */}
            {consumos.length > 0 && Math.abs(totalConsumo - kioskDebt) > 0.5 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-1">
                <p className="text-[10px] font-bold text-amber-700">
                  ⚠️ Nota sobre el historial
                </p>
                <p className="text-[9px] text-amber-600 leading-relaxed">
                  Los consumos listados suman <strong>S/ {totalConsumo.toFixed(2)}</strong>, 
                  pero la deuda oficial es <strong>S/ {kioskDebt.toFixed(2)}</strong>.
                  La diferencia (S/ {Math.abs(totalConsumo - kioskDebt).toFixed(2)}) 
                  puede deberse a pagos en efectivo, ajustes manuales o períodos anteriores 
                  no registrados digitalmente. Para aclarar el detalle exacto, 
                  comunícate con administración.
                </p>
              </div>
            )}

            {/* Aviso cuando NO hay consumos pero sí hay deuda */}
            {consumos.length === 0 && kioskDebt > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-bold text-amber-700">
                  ⚠️ Sin historial digital disponible
                </p>
                <p className="text-[9px] text-amber-600 leading-relaxed mt-0.5">
                  La deuda de S/ {kioskDebt.toFixed(2)} existe en el sistema pero no hay 
                  consumos digitales registrados que la expliquen. 
                  Puede haberse originado por consumos en efectivo o un ajuste 
                  manual de saldo. Consulta a administración para el detalle.
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
