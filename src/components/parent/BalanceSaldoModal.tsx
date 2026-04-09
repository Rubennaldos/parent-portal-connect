/**
 * BalanceSaldoModal — Detalle del saldo del alumno para el padre.
 *
 * Muestra:
 *  - Saldo disponible actual
 *  - Total recargado (historial de recargas aprobadas)
 *  - Total gastado del saldo (compras pagadas con saldo)
 *  - Lista de movimientos recientes (recargas + compras)
 */
import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpCircle,
  ShoppingBag,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

interface Movement {
  id: string;
  type: 'recharge' | 'purchase' | 'other';
  amount: number;
  description: string;
  created_at: string;
  ticket_code: string | null;
  payment_method: string | null;
  payment_status: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  currentBalance: number;
}

const PAGE_SIZE = 20;

// ── Skeleton ──────────────────────────────────────────────────────────────────
const MovementSkeleton = () => (
  <div className="flex items-center gap-3 p-3 animate-pulse">
    <div className="w-9 h-9 bg-slate-100 rounded-xl shrink-0" />
    <div className="flex-1 space-y-1.5">
      <div className="h-3 w-3/4 bg-slate-100 rounded-full" />
      <div className="h-2.5 w-1/3 bg-slate-100 rounded-full" />
    </div>
    <div className="h-4 w-14 bg-slate-100 rounded-full shrink-0" />
  </div>
);

// ── Formato de fecha corta ─────────────────────────────────────────────────────
function fmtDate(iso: string) {
  try {
    return format(new Date(iso), "d MMM", { locale: es });
  } catch {
    return '—';
  }
}

export function BalanceSaldoModal({ isOpen, onClose, studentId, studentName, currentBalance }: Props) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const [hasMore, setHasMore]     = useState(false);

  // Totales calculados localmente
  const [totalRecharged, setTotalRecharged] = useState(0);
  const [totalSpentBalance, setTotalSpentBalance] = useState(0);
  const [totalsLoading, setTotalsLoading] = useState(false);

  // ── Cargar totales históricos ──────────────────────────────────────────────
  const fetchTotals = useCallback(async () => {
    if (!studentId) return;
    setTotalsLoading(true);
    try {
      // Total recargado (recharges aprobadas)
      const { data: recharges } = await supabase
        .from('transactions')
        .select('amount')
        .eq('student_id', studentId)
        .eq('type', 'recharge')
        .eq('payment_status', 'paid')
        .eq('is_deleted', false);

      const recharged = (recharges ?? []).reduce((acc, r) => acc + Math.abs(Number(r.amount)), 0);
      setTotalRecharged(recharged);

      // Total gastado del saldo (compras pagadas con saldo)
      const { data: purchases } = await supabase
        .from('transactions')
        .select('amount')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .eq('payment_method', 'saldo')
        .eq('payment_status', 'paid')
        .eq('is_deleted', false);

      const spentFromBalance = (purchases ?? []).reduce((acc, p) => acc + Math.abs(Number(p.amount)), 0);
      setTotalSpentBalance(spentFromBalance);
    } finally {
      setTotalsLoading(false);
    }
  }, [studentId]);

  // ── Cargar movimientos paginados ───────────────────────────────────────────
  const fetchMovements = useCallback(async (pageNum: number, reset = false) => {
    if (!studentId) return;
    setLoading(true);
    try {
      const from = (pageNum - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('transactions')
        .select('id, type, amount, description, created_at, ticket_code, payment_method, payment_status')
        .eq('student_id', studentId)
        .eq('is_deleted', false)
        .in('type', ['recharge', 'purchase'])
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const mapped: Movement[] = (data ?? []).map((r) => ({
        id:             r.id,
        type:           r.type === 'recharge' ? 'recharge' : 'purchase',
        amount:         Number(r.amount),
        description:    r.description ?? '',
        created_at:     r.created_at,
        ticket_code:    r.ticket_code ?? null,
        payment_method: r.payment_method ?? null,
        payment_status: r.payment_status ?? '',
      }));

      setMovements(reset ? mapped : (prev) => [...prev, ...mapped]);
      setHasMore(mapped.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  // ── Al abrir: reiniciar y cargar ──────────────────────────────────────────
  useEffect(() => {
    if (isOpen && studentId) {
      setPage(1);
      setMovements([]);
      fetchMovements(1, true);
      fetchTotals();
    }
  }, [isOpen, studentId, fetchMovements, fetchTotals]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchMovements(next, false);
  };

  // ── Render de cada movimiento ─────────────────────────────────────────────
  const renderMovement = (m: Movement) => {
    const isRecharge = m.type === 'recharge';
    const isCancelled = m.payment_status === 'cancelled';
    const amountDisplay = Math.abs(m.amount).toFixed(2);

    // Descripción corta
    let label = m.description || (isRecharge ? 'Recarga de saldo' : 'Compra en cafetería');
    if (label.length > 40) label = label.slice(0, 40) + '…';

    return (
      <div
        key={m.id}
        className={`flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0 ${
          isCancelled ? 'opacity-40' : ''
        }`}
      >
        {/* Ícono */}
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            isCancelled
              ? 'bg-slate-100'
              : isRecharge
              ? 'bg-emerald-50'
              : 'bg-rose-50'
          }`}
        >
          {isRecharge ? (
            <ArrowUpCircle className={`w-4.5 h-4.5 ${isCancelled ? 'text-slate-400' : 'text-emerald-500'}`} />
          ) : (
            <ShoppingBag className={`w-4 h-4 ${isCancelled ? 'text-slate-400' : 'text-rose-400'}`} />
          )}
        </div>

        {/* Descripción + fecha */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-slate-700 leading-tight truncate">{label}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-slate-400">{fmtDate(m.created_at)}</span>
            {m.ticket_code && (
              <span className="text-[9px] text-slate-300 font-mono">{m.ticket_code}</span>
            )}
            {isCancelled && (
              <span className="text-[9px] font-semibold text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full">Anulado</span>
            )}
            {!isRecharge && m.payment_method && m.payment_method !== 'saldo' && (
              <span className="text-[9px] text-slate-300 capitalize">({m.payment_method})</span>
            )}
          </div>
        </div>

        {/* Monto */}
        <span
          className={`text-sm font-bold shrink-0 ${
            isCancelled
              ? 'text-slate-300 line-through'
              : isRecharge
              ? 'text-emerald-600'
              : 'text-rose-500'
          }`}
        >
          {isRecharge ? '+' : '-'}S/ {amountDisplay}
        </span>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm w-full p-0 gap-0 overflow-hidden rounded-3xl">
        {/* ── Header verde ─────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-6 pt-8 pb-6 text-center relative">
          <DialogHeader className="mb-0">
            <DialogTitle className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-1 sr-only">
              Saldo
            </DialogTitle>
          </DialogHeader>

          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
              <Wallet className="w-6 h-6 text-white" />
            </div>
          </div>

          <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1">
            Saldo disponible
          </p>
          <p className="text-white font-light text-[3.2rem] leading-none tracking-tight">
            <span className="text-2xl font-normal text-white/70 mr-1">S/</span>
            <span className="font-semibold">{Math.max(0, currentBalance).toFixed(2)}</span>
          </p>
          <p className="text-white/60 text-[11px] mt-1.5">{studentName}</p>
        </div>

        {/* ── Resumen recargado / gastado ───────────────────────────────────── */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100 bg-white">
          <div className="flex flex-col items-center gap-1 py-4">
            {totalsLoading ? (
              <div className="h-5 w-20 bg-slate-100 rounded-full animate-pulse" />
            ) : (
              <>
                <div className="flex items-center gap-1 text-emerald-500">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Recargado</span>
                </div>
                <span className="text-lg font-bold text-emerald-600">S/ {totalRecharged.toFixed(2)}</span>
                <span className="text-[9px] text-slate-400">total histórico</span>
              </>
            )}
          </div>
          <div className="flex flex-col items-center gap-1 py-4">
            {totalsLoading ? (
              <div className="h-5 w-20 bg-slate-100 rounded-full animate-pulse" />
            ) : (
              <>
                <div className="flex items-center gap-1 text-rose-400">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Gastado</span>
                </div>
                <span className="text-lg font-bold text-rose-500">S/ {totalSpentBalance.toFixed(2)}</span>
                <span className="text-[9px] text-slate-400">de este saldo</span>
              </>
            )}
          </div>
        </div>

        {/* ── Lista de movimientos ──────────────────────────────────────────── */}
        <div className="bg-white">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Movimientos
            </span>
          </div>

          <div className="max-h-[46vh] overflow-y-auto">
            {loading && movements.length === 0 ? (
              <div className="space-y-0">
                {[1, 2, 3, 4, 5].map((i) => <MovementSkeleton key={i} />)}
              </div>
            ) : movements.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sin movimientos registrados</p>
              </div>
            ) : (
              <>
                {movements.map(renderMovement)}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors"
                  >
                    {loading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        Ver más movimientos
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
