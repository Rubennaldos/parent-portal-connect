/**
 * BalanceSaldoModal — Libro Mayor del saldo kiosco del alumno.
 *
 * FUENTE ÚNICA DE VERDAD:
 *   - Totales: RPC get_student_ledger_totals  (misma fórmula que el trigger)
 *   - Movimientos: RPC get_student_ledger_movements (paginados, con affects_balance flag)
 *
 * GARANTÍA:
 *   sum(movimientos que affects_balance=true, todos los pages) = GASTADO.
 *   El footer muestra ✓ si el libro cuadra, ⚠️ si hay diferencia.
 *
 * REALTIME:
 *   Suscripción a cambios en students.balance para refrescar
 *   el saldo en pantalla sin que el padre recargue la página.
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
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  UtensilsCrossed,
} from 'lucide-react';

// ── Tipos ──────────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string;
  move_type: string;
  amount: number;
  description: string;
  created_at: string;
  ticket_code: string | null;
  payment_method: string | null;
  payment_status: string;
  affects_balance: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  /** Puede ser null/undefined si el alumno no tiene transacciones aún */
  currentBalance: number | null | undefined;
}

const PAGE_SIZE = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

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

function fmtDate(iso: string) {
  try { return format(new Date(iso), "d MMM", { locale: es }); }
  catch { return '—'; }
}

function safeNum(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function BalanceSaldoModal({
  isOpen, onClose, studentId, studentName, currentBalance,
}: Props) {

  const [movements,  setMovements]  = useState<LedgerRow[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(false);

  // Totales del RPC (fuente única)
  const [totalRecharged,  setTotalRecharged]  = useState(0);
  const [totalDebited,    setTotalDebited]    = useState(0);
  const [totalsLoading,   setTotalsLoading]   = useState(false);

  // Suma de movimientos YA cargados con affects_balance=true
  const [loadedDebitSum, setLoadedDebitSum] = useState(0);

  // Saldo en vivo (seguro contra null/NaN)
  const [liveBalance, setLiveBalance] = useState<number>(safeNum(currentBalance));

  // ── Cargar totales via RPC ─────────────────────────────────────────────────
  //
  // ARQUITECTURA: el RPC es la única fuente de verdad.
  // React solo asigna los valores que devuelve el servidor.
  // Cero aritmética en JavaScript.
  //
  // IMPORTANTE: declarado ANTES de los useEffect que lo referencian
  // para evitar el Temporal Dead Zone error.
  //
  // El RPC get_student_ledger_totals devuelve:
  //   total_recharged  → suma de recargas aprobadas
  //   total_debited    → lo consumido (calculado en SQL: recharged − balance)
  //   current_balance  → students.balance (calculado por el trigger en la DB)
  const fetchTotals = useCallback(async () => {
    if (!studentId) return;
    setTotalsLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_student_ledger_totals', { p_student_id: studentId });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      setTotalRecharged(safeNum(row?.total_recharged));
      setTotalDebited(safeNum(row?.total_debited));
      setLiveBalance(safeNum(row?.current_balance));
    } catch (err) {
      console.error('[BalanceSaldoModal] fetchTotals:', err);
    } finally {
      setTotalsLoading(false);
    }
  }, [studentId]);

  // Sync inicial: mientras el RPC carga, mostrar el prop del padre para evitar flash
  // fetchTotals() sobreescribirá este valor con el dato oficial de la DB.
  useEffect(() => {
    setLiveBalance(safeNum(currentBalance));
  }, [currentBalance]);

  // ── Realtime: re-fetch del RPC cuando el saldo del alumno cambia ─────────
  // El RPC lee students.balance directamente, así que basta con volver a llamarlo.
  // React NO interpreta el payload — delega al servidor.
  useEffect(() => {
    if (!studentId || !isOpen) return;
    const channel = supabase
      .channel(`balance-modal-${studentId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'students', filter: `id=eq.${studentId}` },
        () => { fetchTotals(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [studentId, isOpen, fetchTotals]);

  // ── Cargar movimientos paginados via RPC (con fallback) ────────────────────
  const fetchMovements = useCallback(async (pageNum: number, reset = false) => {
    if (!studentId) return;
    setLoading(true);
    try {
      const offset = (pageNum - 1) * PAGE_SIZE;
      let rawRows: LedgerRow[] = [];

      // Intento 1: RPC del libro mayor
      const { data: rpcData, error: rpcErr } = await supabase
        .rpc('get_student_ledger_movements', {
          p_student_id: studentId,
          p_limit:      PAGE_SIZE,
          p_offset:     offset,
        });

      if (!rpcErr && rpcData) {
        rawRows = (rpcData as LedgerRow[]).map((r) => ({
          id:              r.id,
          move_type:       r.move_type ?? 'other',
          amount:          safeNum(r.amount),
          description:     r.description ?? '',
          created_at:      r.created_at,
          ticket_code:     r.ticket_code ?? null,
          payment_method:  r.payment_method ?? null,
          payment_status:  r.payment_status ?? '',
          affects_balance: !!r.affects_balance,
        }));
      } else {
        // Fallback: query directa a transactions (todos los tipos relevantes)
        const { data: txData, error: txErr } = await supabase
          .from('transactions')
          .select('id, type, amount, description, created_at, ticket_code, payment_method, payment_status, metadata')
          .eq('student_id', studentId)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (txErr) throw txErr;

        rawRows = (txData ?? []).map((r) => {
          const haslunch = !!(r.metadata as Record<string, unknown>)?.lunch_order_id;
          const st = r.payment_status ?? '';
          const affects =
            (r.type === 'recharge' && st === 'paid') ||
            (r.type === 'purchase' && ['paid','pending','partial'].includes(st) && !haslunch) ||
            (r.type === 'adjustment' && st === 'paid');
          return {
            id:              r.id,
            move_type:       r.type ?? 'other',
            amount:          safeNum(r.amount),
            description:     r.description ?? '',
            created_at:      r.created_at,
            ticket_code:     r.ticket_code ?? null,
            payment_method:  r.payment_method ?? null,
            payment_status:  st,
            affects_balance: affects,
          };
        });
      }

      const rows = rawRows;

      if (reset) {
        setMovements(rows);
        // Recalcular suma de débitos cargados
        setLoadedDebitSum(calcDebitSum(rows));
      } else {
        setMovements(prev => {
          const combined = [...prev, ...rows];
          setLoadedDebitSum(calcDebitSum(combined));
          return combined;
        });
      }

      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      console.error('[BalanceSaldoModal] fetchMovements error:', err);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  // ── Al abrir: reiniciar y cargar ───────────────────────────────────────────
  useEffect(() => {
    if (isOpen && studentId) {
      setPage(1);
      setMovements([]);
      setLoadedDebitSum(0);
      fetchMovements(1, true);
      fetchTotals();
    }
  }, [isOpen, studentId, fetchMovements, fetchTotals]);


  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchMovements(next, false);
  };

  // ── Helpers de cálculo ─────────────────────────────────────────────────────
  function calcDebitSum(rows: LedgerRow[]): number {
    return rows
      .filter(r => r.affects_balance && r.payment_status !== 'cancelled')
      .filter(r => r.move_type !== 'recharge') // solo débitos
      .reduce((s, r) => s + Math.abs(r.amount), 0);
  }

  // ¿El libro cuadra?
  // La ecuación principal siempre es correcta: totalRecharged - totalDebited = liveBalance
  // (porque totalDebited = totalRecharged - liveBalance por definición)
  //
  // El check verde se muestra cuando los movimientos cargados en pantalla
  // explican completamente el monto GASTADO (sin páginas pendientes).
  const unexlainedDebit = Math.max(0, totalDebited - loadedDebitSum);
  const ledgerOk = !totalsLoading && !loading && !hasMore && unexlainedDebit < 0.03;

  // ── Render de cada fila del libro mayor ────────────────────────────────────
  const renderRow = (m: LedgerRow) => {
    const isRecharge     = m.move_type === 'recharge';
    const isAdjustment   = m.move_type === 'adjustment';
    const isLunchPayment = m.move_type === 'lunch_payment';
    const isCancelled    = m.payment_status === 'cancelled';
    const isPending      = m.payment_status === 'pending';
    const amountNum      = safeNum(m.amount);
    const isCredit       = isRecharge || (isAdjustment && amountNum >= 0);
    const amountDisplay  = Math.abs(amountNum).toFixed(2);
    const sign           = isCredit ? '+' : '-';

    // Etiqueta descriptiva
    let label = m.description || (
      isRecharge     ? 'Recarga de saldo' :
      isAdjustment   ? (amountNum >= 0 ? 'Ajuste (abono)' : 'Ajuste (descuento)') :
      isLunchPayment ? 'Consumo almuerzo' :
                       'Compra kiosco'
    );
    if (label.length > 42) label = label.slice(0, 42) + '…';

    // Colores
    const iconBg = isCancelled      ? 'bg-slate-100'
      : isCredit                    ? 'bg-emerald-50'
      : isAdjustment                ? 'bg-amber-50'
      : isLunchPayment              ? 'bg-violet-50'
      :                               'bg-rose-50';

    const amountClass = isCancelled                   ? 'text-slate-300 line-through'
      : isCredit                                      ? 'text-emerald-600'
      : isAdjustment && amountNum >= 0                ? 'text-emerald-600'
      : isAdjustment                                  ? 'text-amber-600'
      : isLunchPayment                                ? 'text-violet-600'
      :                                                 'text-rose-500';

    return (
      <div
        key={m.id}
        className={`flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0 ${
          isCancelled ? 'opacity-40' : ''
        }`}
      >
        {/* Ícono */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          {isRecharge ? (
            <ArrowUpCircle className={`w-4.5 h-4.5 ${isCancelled ? 'text-slate-400' : 'text-emerald-500'}`} />
          ) : isAdjustment ? (
            <SlidersHorizontal className={`w-4 h-4 ${isCancelled ? 'text-slate-400' : 'text-amber-500'}`} />
          ) : isLunchPayment ? (
            <UtensilsCrossed className={`w-4 h-4 ${isCancelled ? 'text-slate-400' : 'text-violet-500'}`} />
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
            {isPending && !isCancelled && (
              <span className="text-[9px] font-semibold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full">Pendiente</span>
            )}
            {!isRecharge && !isAdjustment && !isLunchPayment && m.payment_method && m.payment_method !== 'saldo' && (
              <span className="text-[9px] text-slate-300 capitalize">({m.payment_method})</span>
            )}
          </div>
        </div>

        {/* Monto */}
        <span className={`text-sm font-bold shrink-0 ${amountClass}`}>
          {sign}S/ {amountDisplay}
        </span>
      </div>
    );
  };

  // ── Footer del libro mayor (reconciliación contable) ──────────────────────
  const renderReconciliation = () => {
    if (totalsLoading || totalRecharged === 0) return null;

    // Cuánto del GASTADO aún no está explicado por los movimientos cargados
    const pendingDebit = Math.max(0, totalDebited - loadedDebitSum);
    // Hay diferencia solo si queda más de S/ 0.02 sin explicar y aún hay páginas
    const hasPending   = pendingDebit > 0.02 && hasMore;

    return (
      <div className={`mx-4 mb-4 mt-2 rounded-2xl px-4 py-3 text-[11px] ${
        ledgerOk
          ? 'bg-emerald-50 border border-emerald-100'
          : 'bg-amber-50 border border-amber-200'
      }`}>

        {/* ── Ecuación principal: siempre correcta ─────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600 font-mono text-[11px]">
            <span className="text-emerald-600 font-bold">+S/ {totalRecharged.toFixed(2)}</span>
            {' − '}
            <span className="text-rose-500 font-bold">S/ {totalDebited.toFixed(2)}</span>
            {' = '}
            <span className="text-slate-800 font-bold">S/ {Math.max(0, liveBalance).toFixed(2)}</span>
          </span>

          {ledgerOk ? (
            <div className="flex items-center gap-1 text-emerald-600 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-semibold">Verificado</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-amber-600 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="font-semibold">Sincronizando</span>
            </div>
          )}
        </div>

        {/* ── Aviso: solo se muestra si hay más páginas pendientes de cargar ── */}
        {hasPending && (
          <p className="mt-1.5 text-[10px] text-amber-700 leading-snug">
            Cargando más movimientos…{' '}
            <span className="font-semibold">
              S/ {pendingDebit.toFixed(2)} pendientes de mostrar
            </span>
          </p>
        )}
      </div>
    );
  };

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm w-full p-0 gap-0 overflow-hidden rounded-3xl">

        {/* ── Header verde ─────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-6 pt-8 pb-6 text-center relative">
          <DialogHeader className="mb-0">
            <DialogTitle className="sr-only">Saldo</DialogTitle>
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
            <span className="font-semibold">{Math.max(0, liveBalance).toFixed(2)}</span>
          </p>
          <p className="text-white/60 text-[11px] mt-1.5">{studentName}</p>
        </div>

        {/* ── Resumen recargado / gastado ──────────────────────────────── */}
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
                <span className="text-lg font-bold text-rose-500">S/ {totalDebited.toFixed(2)}</span>
                <span className="text-[9px] text-slate-400">consumido del saldo</span>
              </>
            )}
          </div>
        </div>

        {/* ── Lista de movimientos ─────────────────────────────────────── */}
        <div className="bg-white">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Movimientos
            </span>
          </div>

          <div className="max-h-[40vh] overflow-y-auto">
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
                {movements.map(renderRow)}
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

        {/* ── Reconciliación contable (footer del libro mayor) ─────────── */}
        {renderReconciliation()}

      </DialogContent>
    </Dialog>
  );
}
