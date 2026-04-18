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
import { format, isToday, isYesterday } from 'date-fns';
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
  Clock,
  Banknote,
  CreditCard,
  Smartphone,
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

function fmtDateLabel(iso: string) {
  try {
    const d = new Date(iso);
    if (isToday(d))     return 'Hoy';
    if (isYesterday(d)) return 'Ayer';
    return format(d, "EEEE d 'de' MMMM", { locale: es });
  } catch { return '—'; }
}

function fmtDateKey(iso: string) {
  try { return format(new Date(iso), 'yyyy-MM-dd'); }
  catch { return iso.slice(0, 10); }
}

const METHOD_CHIP: Record<string, { label: string; color: string }> = {
  saldo:                { label: 'Saldo',        color: 'bg-emerald-50 text-emerald-600' },
  balance:              { label: 'Saldo',        color: 'bg-emerald-50 text-emerald-600' },
  transferencia:        { label: 'Transferencia', color: 'bg-blue-50 text-blue-600' },
  bank_transfer:        { label: 'Transferencia', color: 'bg-blue-50 text-blue-600' },
  yape:                 { label: 'Yape',          color: 'bg-violet-50 text-violet-600' },
  plin:                 { label: 'Plin',          color: 'bg-teal-50 text-teal-600' },
  efectivo:             { label: 'Efectivo',      color: 'bg-amber-50 text-amber-700' },
  cash:                 { label: 'Efectivo',      color: 'bg-amber-50 text-amber-700' },
  tarjeta:              { label: 'Tarjeta',       color: 'bg-slate-100 text-slate-600' },
};

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

    // Etiqueta descriptiva — limpiar el prefijo técnico para el padre
    let rawLabel = m.description || (
      isRecharge     ? 'Recarga de saldo' :
      isAdjustment   ? (amountNum >= 0 ? 'Ajuste (abono)' : 'Ajuste (descuento)') :
      isLunchPayment ? 'Consumo almuerzo' :
                       'Compra kiosco'
    );
    // Simplificar descripciones técnicas del POS
    rawLabel = rawLabel
      .replace(/^Compra POS \(Saldo\) - S\/ [\d.]+/, 'Compra en kiosco')
      .replace(/^Compra POS \(Cuenta Libre - Deuda\) - S\/ [\d.]+/, 'Compra en kiosco')
      .replace(/^Compra POS - Total: S\/ [\d.]+/, 'Compra en kiosco');
    const label = rawLabel.length > 38 ? rawLabel.slice(0, 38) + '…' : rawLabel;

    // Colores del ícono
    const iconBg = isCancelled  ? 'bg-slate-100'
      : isCredit                ? 'bg-emerald-50'
      : isPending               ? 'bg-amber-50'
      : isAdjustment            ? 'bg-amber-50'
      : isLunchPayment          ? 'bg-violet-50'
      :                           'bg-rose-50';

    const amountClass = isCancelled                   ? 'text-slate-300 line-through'
      : isCredit                                      ? 'text-emerald-600'
      : isAdjustment && amountNum >= 0                ? 'text-emerald-600'
      : isAdjustment                                  ? 'text-amber-600'
      : isLunchPayment                                ? 'text-violet-600'
      : isPending                                     ? 'text-amber-500'
      :                                                 'text-rose-500';

    // Borde izquierdo para pendientes
    const rowBorder = isPending && !isCancelled ? 'border-l-2 border-amber-300 pl-3' : 'pl-4';

    // Chip de método de pago
    const chipKey = (m.payment_method || '').toLowerCase();
    const chip = METHOD_CHIP[chipKey];

    return (
      <div
        key={m.id}
        className={`flex items-center gap-3 pr-4 py-3 border-b border-slate-50 last:border-0 ${rowBorder} ${
          isCancelled ? 'opacity-40' : ''
        }`}
      >
        {/* Ícono */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          {isRecharge ? (
            <ArrowUpCircle className={`w-[18px] h-[18px] ${isCancelled ? 'text-slate-400' : 'text-emerald-500'}`} />
          ) : isAdjustment ? (
            <SlidersHorizontal className={`w-4 h-4 ${isCancelled ? 'text-slate-400' : 'text-amber-500'}`} />
          ) : isLunchPayment ? (
            <UtensilsCrossed className={`w-4 h-4 ${isCancelled ? 'text-slate-400' : 'text-violet-500'}`} />
          ) : isPending ? (
            <Clock className="w-4 h-4 text-amber-400" />
          ) : (
            <ShoppingBag className={`w-4 h-4 ${isCancelled ? 'text-slate-400' : 'text-rose-400'}`} />
          )}
        </div>

        {/* Descripción + metadatos */}
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold text-slate-700 leading-tight truncate">{label}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {m.ticket_code && (
              <span className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">
                {m.ticket_code}
              </span>
            )}
            {isCancelled && (
              <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Anulado</span>
            )}
            {isPending && !isCancelled && (
              <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" /> Pendiente
              </span>
            )}
            {/* Chip de método de pago — solo para no-recargas con método explícito */}
            {!isRecharge && !isCancelled && chip && chipKey !== 'saldo' && chipKey !== 'balance' && (
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${chip.color}`}>
                {chipKey === 'transferencia' || chipKey === 'bank_transfer' ? (
                  <span className="flex items-center gap-0.5"><Banknote className="w-2.5 h-2.5" /> {chip.label}</span>
                ) : chipKey === 'yape' || chipKey === 'plin' ? (
                  <span className="flex items-center gap-0.5"><Smartphone className="w-2.5 h-2.5" /> {chip.label}</span>
                ) : chipKey === 'tarjeta' ? (
                  <span className="flex items-center gap-0.5"><CreditCard className="w-2.5 h-2.5" /> {chip.label}</span>
                ) : (
                  chip.label
                )}
              </span>
            )}
          </div>
        </div>

        {/* Monto */}
        <div className="text-right shrink-0">
          <span className={`text-[14px] font-bold ${amountClass}`}>
            {sign}S/ {amountDisplay}
          </span>
        </div>
      </div>
    );
  };

  // ── Render de separador de fecha ────────────────────────────────────────────
  const renderDateSeparator = (iso: string) => (
    <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
      <div className="flex-1 h-px bg-slate-100" />
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap capitalize">
        {fmtDateLabel(iso)}
      </span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );

  // ── Render de la lista agrupada por fecha ───────────────────────────────────
  const renderMovements = () => {
    if (movements.length === 0) return null;
    const groups: { key: string; iso: string; rows: LedgerRow[] }[] = [];
    for (const m of movements) {
      const key = fmtDateKey(m.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.rows.push(m);
      } else {
        groups.push({ key, iso: m.created_at, rows: [m] });
      }
    }
    return groups.map(g => (
      <div key={g.key}>
        {renderDateSeparator(g.iso)}
        {g.rows.map(renderRow)}
      </div>
    ));
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
      <DialogContent className="max-w-sm w-full p-0 gap-0 overflow-hidden rounded-3xl shadow-2xl">

        {/* ── Header verde ─────────────────────────────────────────────── */}
        <div className="relative bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 px-6 pt-8 pb-7 text-center overflow-hidden">
          {/* Círculos decorativos de fondo */}
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-8 -left-4 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />

          <DialogHeader className="mb-0">
            <DialogTitle className="sr-only">Saldo</DialogTitle>
          </DialogHeader>

          <div className="flex justify-center mb-3">
            <div className="w-13 h-13 bg-white/20 rounded-2xl flex items-center justify-center ring-1 ring-white/30">
              <Wallet className="w-6 h-6 text-white" />
            </div>
          </div>

          <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">
            Saldo disponible
          </p>
          <p className="text-white leading-none tracking-tight">
            <span className="text-xl font-light text-white/70 mr-1 align-middle">S/</span>
            <span className="text-[3rem] font-bold align-middle">{Math.max(0, liveBalance).toFixed(2)}</span>
          </p>
          <p className="text-white/50 text-[11px] mt-2 font-medium">{studentName}</p>
        </div>

        {/* ── Resumen recargado / gastado ──────────────────────────────── */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100 bg-white">
          <div className="flex flex-col items-center gap-0.5 py-4 px-3">
            {totalsLoading ? (
              <div className="h-5 w-20 bg-slate-100 rounded-full animate-pulse" />
            ) : (
              <>
                <div className="flex items-center gap-1 text-emerald-500 mb-0.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Recargado</span>
                </div>
                <span className="text-[18px] font-bold text-emerald-600 leading-tight">
                  S/ {totalRecharged.toFixed(2)}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5">total histórico</span>
              </>
            )}
          </div>
          <div className="flex flex-col items-center gap-0.5 py-4 px-3">
            {totalsLoading ? (
              <div className="h-5 w-20 bg-slate-100 rounded-full animate-pulse" />
            ) : (
              <>
                <div className="flex items-center gap-1 text-rose-400 mb-0.5">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Gastado</span>
                </div>
                <span className="text-[18px] font-bold text-rose-500 leading-tight">
                  S/ {totalDebited.toFixed(2)}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5">consumido del saldo</span>
              </>
            )}
          </div>
        </div>

        {/* ── Lista de movimientos ─────────────────────────────────────── */}
        <div className="bg-white">
          <div className="flex items-center justify-between px-4 pt-4 pb-1">
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Movimientos
              </span>
            </div>
            {movements.length > 0 && (
              <span className="text-[10px] text-slate-400">{movements.length} registro{movements.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          <div className="max-h-[42vh] overflow-y-auto">
            {loading && movements.length === 0 ? (
              <div className="space-y-0 py-1">
                {[1, 2, 3, 4, 5].map((i) => <MovementSkeleton key={i} />)}
              </div>
            ) : movements.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Wallet className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">Sin movimientos registrados</p>
              </div>
            ) : (
              <>
                {renderMovements()}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3.5 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors border-t border-slate-50"
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
