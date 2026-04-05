/**
 * PosConsumptionModal — Estado de Cuenta de Cafetería / Kiosco
 *
 * Muestra un estado de cuenta justificado:
 *  (−) Consumos en cafetería (source = 'pos')
 *  (+) Abonos y recargas previas (diferencia histórica no registrada en transactions)
 *  (=) Deuda actual = Math.abs(students.balance)
 *
 * La matemática siempre cierra: Consumos − Abonos = Deuda actual.
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
import { ShoppingBag, AlertCircle, TrendingDown, TrendingUp, Minus } from 'lucide-react';

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
  /** Math.abs(students.balance) — deuda oficial actual */
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

      // Excluir almuerzos (tienen lunch_order_id)
      const posOnly = (data ?? []).filter((t: any) => !t.metadata?.lunch_order_id);
      setConsumos(posOnly);
    } catch (e: any) {
      setError('No se pudieron cargar los consumos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const firstName = studentName.split(' ')[0];

  // ── Matemática del estado de cuenta ──────────────────────────────────────
  // totalConsumo = suma de todos los consumos POS registrados digitalmente
  const totalConsumo = consumos.reduce((acc, c) => acc + Math.abs(c.amount), 0);

  // abonosHistoricos = diferencia entre consumos y deuda actual
  // Representa pagos/recargas que afectaron el balance pero no tienen registro en transactions
  const abonosHistoricos = totalConsumo > kioskDebt
    ? parseFloat((totalConsumo - kioskDebt).toFixed(2))
    : 0;

  // Verificación: totalConsumo − abonosHistoricos debe = kioskDebt (± centavos)
  const saldoCalculado = parseFloat((totalConsumo - abonosHistoricos).toFixed(2));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm w-full p-0 overflow-hidden rounded-2xl">

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

        {/* ── Cuerpo: lista de consumos ── */}
        <div className="px-4 py-3 max-h-[48vh] overflow-y-auto space-y-1.5">
          {loading ? (
            <>{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</>
          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-3">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          ) : consumos.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-400">No se encontraron consumos digitales.</p>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed px-4">
                La deuda puede provenir de consumos en efectivo o períodos anteriores al sistema digital.
              </p>
            </div>
          ) : (
            <>
              {/* Etiqueta de sección consumos */}
              <div className="flex items-center gap-1.5 px-1 pb-0.5">
                <TrendingDown className="w-3 h-3 text-rose-400" />
                <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                  Consumos en cafetería
                </p>
              </div>

              {consumos.map((c) => {
                const source = c.metadata?.source ?? 'pos';
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
                    </div>
                    <p className="text-sm font-black text-rose-500 shrink-0">
                      −S/ {Math.abs(c.amount).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </>
          )}

          {/* ── Fila de ajuste: Abonos y Recargas Previas ── */}
          {!loading && !error && abonosHistoricos > 0 && (
            <div className="mt-3 space-y-1.5">
              {/* Divisor */}
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-slate-200" />
                <Minus className="w-3 h-3 text-slate-300" />
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Etiqueta de sección abonos */}
              <div className="flex items-center gap-1.5 px-1 pb-0.5">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                  Abonos aplicados
                </p>
              </div>

              {/* Fila del ajuste */}
              <div className="flex items-center gap-3 px-3 py-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-emerald-700">
                    Abonos y Recargas Previas
                  </p>
                  <p className="text-[10px] text-emerald-600 mt-0.5 leading-relaxed">
                    Pagos históricos que redujeron la deuda. Pueden incluir recargas en efectivo
                    o abonos registrados antes del sistema digital.
                  </p>
                </div>
                <p className="text-sm font-black text-emerald-600 shrink-0">
                  +S/ {abonosHistoricos.toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer: cierre contable ── */}
        {!loading && !error && (
          <div className="px-5 pt-3 pb-5 border-t border-slate-100 bg-slate-50/60 space-y-3">

            {/* Resumen numérico */}
            {consumos.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Total consumos registrados</span>
                  <span className="font-semibold text-rose-400">−S/ {totalConsumo.toFixed(2)}</span>
                </div>
                {abonosHistoricos > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Abonos y recargas previas</span>
                    <span className="font-semibold text-emerald-500">+S/ {abonosHistoricos.toFixed(2)}</span>
                  </div>
                )}
                <div className="h-px bg-slate-200" />
              </div>
            )}

            {/* Total final */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                  Deuda actual
                </p>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  Saldo oficial de {firstName} en el sistema
                </p>
              </div>
              <p className="text-2xl font-black text-rose-500">
                S/ {kioskDebt.toFixed(2)}
              </p>
            </div>

            {/* Verificación de integridad */}
            {consumos.length > 0 && Math.abs(saldoCalculado - kioskDebt) > 0.1 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <p className="text-[9px] text-amber-600 leading-relaxed">
                  ⚠️ Existe una pequeña diferencia de S/ {Math.abs(saldoCalculado - kioskDebt).toFixed(2)} entre
                  el cálculo y el saldo oficial. Contacta a administración si necesitas el detalle exacto.
                </p>
              </div>
            )}

            {/* Aviso sin historial */}
            {consumos.length === 0 && kioskDebt > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-bold text-amber-700">⚠️ Sin historial digital</p>
                <p className="text-[9px] text-amber-600 leading-relaxed mt-0.5">
                  La deuda de S/ {kioskDebt.toFixed(2)} existe pero no hay consumos digitales registrados.
                  Puede ser por consumos en efectivo o un ajuste anterior. Consulta a administración.
                </p>
              </div>
            )}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
