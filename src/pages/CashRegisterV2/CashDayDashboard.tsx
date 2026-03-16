import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, ArrowDownCircle, ArrowUpCircle, Lock, RefreshCw, Send,
  ChevronLeft, ChevronRight, Calendar, TrendingUp, TrendingDown,
  Wallet, ChevronDown, ChevronUp, Clock, Eye,
} from 'lucide-react';
import { format, subDays, parseISO, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession, CashManualEntry, DailySalesTotals } from '@/types/cashRegisterV2';
import ManualCashEntryModal from './ManualCashEntryModal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeAdd(...values: number[]): number {
  return Number(values.reduce((acc, v) => acc + (v || 0), 0).toFixed(2));
}

function todayLima(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function formatDateDisplay(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE d 'de' MMMM yyyy", { locale: es });
  } catch { return dateStr; }
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '💵 Efectivo', yape: '📱 Yape', plin: '📲 Plin',
  tarjeta: '💳 Tarjeta', transferencia: '🏦 Transferencia', otro: '🔀 Otro',
};

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface PosTransaction {
  id: string;
  created_at: string;
  amount: number;
  payment_method: string | null;
  student_name?: string;
  metadata?: Record<string, any>;
}

interface DrillDownState {
  label: string;
  paymentMethod: string; // 'cash' | 'yape' | etc. — clave que busca en transactions
  total: number;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  session: CashSession;           // sesión de HOY (puede ser null si se navega a otro día)
  schoolId: string;
  onCloseRequested: () => void;
  onTreasuryRequested: () => void;
  onRefresh: () => void;
  isReadOnly?: boolean;
}

// ─── Subcomponente: Tarjeta de medio de pago clicable ────────────────────────

function PaymentCard({
  label, value, accent, onClick,
}: { label: string; value: number; accent?: string; onClick?: () => void }) {
  const isClickable = !!onClick && value > 0;
  return (
    <button
      type="button"
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      className={`relative rounded-xl p-3 border-2 text-center transition-all w-full
        ${accent ? `${accent} shadow-sm` : 'bg-gray-50 border-gray-200'}
        ${isClickable ? 'cursor-pointer hover:scale-[1.03] hover:shadow-md active:scale-100' : 'cursor-default'}
      `}
    >
      <p className="text-xs font-medium text-gray-500 mb-0.5">{label}</p>
      <p className="text-lg font-black text-gray-800">S/ {value.toFixed(2)}</p>
      {isClickable && (
        <span className="absolute top-1.5 right-1.5">
          <Eye className="h-3 w-3 text-blue-400" />
        </span>
      )}
    </button>
  );
}

// ─── Subcomponente: Panel acordeón de ingresos/egresos manuales ───────────────

function ManualEntriesPanel({
  title, entries, totalAmount, color, emptyText,
}: {
  title: string;
  entries: CashManualEntry[];
  totalAmount: number;
  color: 'green' | 'red';
  emptyText: string;
}) {
  const [open, setOpen] = useState(true);
  const colorMap = {
    green: { card: 'border-green-200', header: 'text-green-700', bg: 'bg-green-50', amount: 'text-green-700', badge: 'bg-green-100 text-green-700', method: 'text-green-600' },
    red:   { card: 'border-red-200',   header: 'text-red-700',   bg: 'bg-red-50',   amount: 'text-red-700',   badge: 'bg-red-100 text-red-700',   method: 'text-red-500' },
  }[color];

  return (
    <Card className={`border-2 ${colorMap.card}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 rounded-t-xl transition-colors"
      >
        <span className={`font-bold text-base ${colorMap.header}`}>{title}</span>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${colorMap.badge}`}>
            {entries.length} mov.
          </span>
          <span className={`font-black text-lg ${colorMap.amount}`}>
            {color === 'green' ? '+' : '-'}S/ {totalAmount.toFixed(2)}
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <CardContent className="pt-0 pb-3">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{emptyText}</p>
          ) : (
            <ul className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className={`flex items-center justify-between gap-2 text-sm ${colorMap.bg} rounded-lg px-3 py-2`}
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-semibold text-gray-800 truncate">{e.description}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs ${colorMap.method}`}>
                        {PAYMENT_METHOD_LABELS[(e as any).payment_method || 'cash']}
                      </span>
                      <span className="text-xs text-gray-400">
                        {format(new Date(e.created_at), 'HH:mm', { locale: es })}
                      </span>
                    </div>
                  </div>
                  <span className={`font-black whitespace-nowrap ${colorMap.amount}`}>
                    {color === 'green' ? '+' : '-'}S/ {e.amount.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CashDayDashboard({
  session, schoolId, onCloseRequested, onTreasuryRequested, onRefresh, isReadOnly = false,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── 1. Selector de fecha ──────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(todayLima());
  const isToday = selectedDate === todayLima();
  const isPastDay = !isToday;

  // La sesión activa para la fecha seleccionada (puede ser distinta a la de hoy)
  const [activeSession, setActiveSession] = useState<CashSession | null>(session);

  // ── 2. Data ───────────────────────────────────────────────────────────────
  const [salesTotals, setSalesTotals] = useState<DailySalesTotals | null>(null);
  const [manualEntries, setManualEntries] = useState<CashManualEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 3. Modales ────────────────────────────────────────────────────────────
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  // ── 4. DrillDown (lupa) ───────────────────────────────────────────────────
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
  const [drillItems, setDrillItems] = useState<PosTransaction[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // ── Cargar data para la fecha seleccionada ────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Determinar la sesión para la fecha seleccionada
      let currentSession: CashSession | null;
      if (!isToday) {
        // Intento 1: buscar por session_date exacto
        const { data: sess } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('school_id', schoolId)
          .eq('session_date', selectedDate)
          .maybeSingle();

        // Intento 2: si no encontró, buscar por rango de opened_at en hora Lima
        // (cubre el caso donde session_date quedó en UTC, un día adelantado)
        let fallbackSess: CashSession | null = null;
        if (!sess) {
          const { data: fb } = await supabase
            .from('cash_sessions')
            .select('*')
            .eq('school_id', schoolId)
            .gte('opened_at', `${selectedDate}T00:00:00-05:00`)
            .lt('opened_at',  `${selectedDate}T23:59:59-05:00`)
            .maybeSingle();
          fallbackSess = fb || null;
        }

        currentSession = sess || fallbackSess;
        setActiveSession(currentSession);
        if (!currentSession) {
          setSalesTotals(null);
          setManualEntries([]);
          setLoading(false);
          return;
        }
      } else {
        currentSession = session;
        setActiveSession(session);
      }

      // RPC de totales para la fecha seleccionada
      const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_daily_totals', {
        p_school_id: schoolId,
        p_date: selectedDate,
      });
      if (rpcErr) console.error('[CashDayDashboard] RPC error:', rpcErr);

      const d = rpcData || { pos: {}, lunch: {}, manual: {} };
      const pos    = d.pos    || {};
      const lunch  = d.lunch  || {};
      const manIn  = d.manual?.income  || {};
      const manOut = d.manual?.expense || {};

      // Total COBRADO en POS = solo efectivo, yape, plin, tarjeta, transferencia (lo que sí entró a caja)
      const posCobrado = safeAdd(
        pos.cash, lunch.cash, pos.mixed_cash,
        pos.yape, pos.yape_qr, lunch.yape, pos.mixed_yape,
        pos.plin, lunch.plin,
        pos.transferencia, lunch.transferencia,
        pos.card, lunch.card, pos.mixed_card
      );
      const creditPos = Number((pos.credit || 0).toFixed(2));
      const creditLunch = Number((lunch.credit || 0).toFixed(2));
      const creditTotal = creditPos + creditLunch;

      setSalesTotals({
        cash:          safeAdd(pos.cash, lunch.cash, pos.mixed_cash),
        yape:          safeAdd(pos.yape, pos.yape_qr, lunch.yape, pos.mixed_yape),
        plin:          safeAdd(pos.plin, lunch.plin),
        transferencia: safeAdd(pos.transferencia, lunch.transferencia),
        tarjeta:       safeAdd(pos.card, lunch.card, pos.mixed_card),
        mixto: 0,
        total: posCobrado, // solo lo cobrado; así cuadra con la suma de las 5 tarjetas
        credit_total: creditTotal, // ventas a crédito (no están en caja)
        manual_income_cash:          Number((manIn.cash          || 0).toFixed(2)),
        manual_income_yape:          Number((manIn.yape          || 0).toFixed(2)),
        manual_income_plin:          Number((manIn.plin          || 0).toFixed(2)),
        manual_income_tarjeta:       Number((manIn.tarjeta       || 0).toFixed(2)),
        manual_income_transferencia: Number((manIn.transferencia || 0).toFixed(2)),
        manual_income_otro:          Number((manIn.otro          || 0).toFixed(2)),
        manual_income_total:         Number((manIn.total         || 0).toFixed(2)),
        manual_expense_total:        Number((manOut.total        || 0).toFixed(2)),
      } as any);

      // Ingresos/egresos manuales de esa sesión — usando variable local (no estado)
      if (currentSession?.id) {
        const { data: entries } = await supabase
          .from('cash_manual_entries')
          .select('id, cash_session_id, school_id, entry_type, amount, entry_date, category, description, payment_method, created_by, created_at')
          .eq('cash_session_id', currentSession.id)
          .order('created_at', { ascending: false });
        setManualEntries(entries || []);
      } else {
        setManualEntries([]);
      }
    } catch (err) {
      console.error('[CashDayDashboard] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [schoolId, session.id, selectedDate, isToday]);

  useEffect(() => { load(); }, [load]);

  // ── Drill-down: cargar transacciones del método clickeado ─────────────────
  const openDrillDown = useCallback(async (drill: DrillDownState) => {
    setDrillDown(drill);
    setDrillItems([]);
    setDrillLoading(true);
    try {
      // Mapeo de clave interna → valor en la columna payment_method de transactions
      const methodMap: Record<string, string[]> = {
        cash:          ['efectivo'],
        yape:          ['yape', 'yape_qr'],
        plin:          ['plin'],
        tarjeta:       ['tarjeta'],
        transferencia: ['transferencia'],
      };
      const methods = methodMap[drill.paymentMethod] || [drill.paymentMethod];

      const { data } = await supabase
        .from('transactions')
        .select('id, created_at, amount, payment_method, metadata, student:student_id(full_name)')
        .eq('school_id', schoolId)
        .eq('type', 'purchase')
        .in('payment_method', methods)
        .neq('payment_status', 'cancelled')
        .gte('created_at', `${selectedDate}T00:00:00-05:00`)
        .lt('created_at',  `${selectedDate}T23:59:59-05:00`)
        .order('created_at', { ascending: false });

      setDrillItems(
        (data || []).map((t: any) => ({
          id: t.id,
          created_at: t.created_at,
          amount: Math.abs(t.amount),
          payment_method: t.payment_method,
          student_name: t.student?.full_name ?? 'Desconocido',
          metadata: t.metadata,
        }))
      );
    } catch (err) {
      console.error('[DrillDown] Error:', err);
    } finally {
      setDrillLoading(false);
    }
  }, [schoolId, selectedDate]);

  // ── Navegación por fechas ─────────────────────────────────────────────────
  const goToPreviousDay = () => {
    const d = parseISO(selectedDate);
    setSelectedDate(format(subDays(d, 1), 'yyyy-MM-dd'));
  };
  const goToNextDay = () => {
    const today = todayLima();
    if (selectedDate >= today) return;
    const d = parseISO(selectedDate);
    setSelectedDate(format(subDays(d, -1), 'yyyy-MM-dd'));
  };
  const goToToday = () => setSelectedDate(todayLima());

  // ── Cálculos finales ──────────────────────────────────────────────────────
  const incomeEntries  = manualEntries.filter(e => e.entry_type === 'income');
  const expenseEntries = manualEntries.filter(e => e.entry_type === 'expense');
  const totalManualIncome  = Number(incomeEntries .reduce((s, e) => s + e.amount, 0).toFixed(2));
  const totalManualExpense = Number(expenseEntries.reduce((s, e) => s + e.amount, 0).toFixed(2));

  const posTotal        = salesTotals?.total ?? 0;
  const manIncomeTotal  = (salesTotals as any)?.manual_income_total ?? 0;
  const manExpenseTotal = (salesTotals as any)?.manual_expense_total ?? 0;
  const totalIngresos   = safeAdd(posTotal, manIncomeTotal);
  const granTotal       = safeAdd(posTotal, manIncomeTotal, -manExpenseTotal);

  // ── Modo de lectura para días pasados ─────────────────────────────────────
  const isViewReadOnly = isReadOnly || isPastDay;

  // ── Loading inicial ───────────────────────────────────────────────────────
  if (loading && !salesTotals) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-500">Cargando caja...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── CABECERA + SELECTOR DE FECHA ─────────────────────────────────── */}
      <Card className="border-0 shadow-sm bg-gradient-to-r from-slate-800 to-slate-700 text-white">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

            {/* Título + badge estado */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                <Wallet className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">Cierre de Caja</h2>
                  {isToday ? (
                    activeSession ? (
                      <Badge className="bg-green-400/20 text-green-300 border-green-400/30 text-xs">
                        ● Abierta
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/30 text-xs">
                        Sin abrir
                      </Badge>
                    )
                  ) : (
                    <Badge className="bg-slate-400/20 text-slate-300 border-slate-400/30 text-xs">
                      Histórico
                    </Badge>
                  )}
                </div>
                <p className="text-slate-300 text-xs capitalize mt-0.5">
                  {formatDateDisplay(selectedDate)}
                </p>
              </div>
            </div>

            {/* Controles de fecha */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToPreviousDay}
                className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors"
                title="Día anterior"
              >
                <ChevronLeft className="h-4 w-4 text-white" />
              </button>

              {/* Input de fecha nativo — sencillo y universal */}
              <div className="relative">
                <input
                  type="date"
                  value={selectedDate}
                  max={todayLima()}
                  onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value); }}
                  className="bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer w-[140px] [color-scheme:dark]"
                />
              </div>

              <button
                type="button"
                onClick={goToNextDay}
                disabled={isToday}
                className="w-9 h-9 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded-lg flex items-center justify-center transition-colors"
                title="Día siguiente"
              >
                <ChevronRight className="h-4 w-4 text-white" />
              </button>

              {!isToday && (
                <button
                  type="button"
                  onClick={goToToday}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  Hoy
                </button>
              )}

              {isToday && (
                <button
                  type="button"
                  onClick={() => { load(); onRefresh(); }}
                  className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors"
                  title="Actualizar"
                >
                  <RefreshCw className={`h-4 w-4 text-white ${loading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </div>

          {/* Aviso modo histórico */}
          {isPastDay && (
            <div className="mt-3 flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 text-amber-300 text-xs">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              Estás viendo un día pasado — modo solo lectura. Los botones de registro están desactivados.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── SIN SESIÓN PARA ESE DÍA ──────────────────────────────────────── */}
      {!salesTotals && !loading && (
        <Card className="border-dashed border-2 border-gray-200">
          <CardContent className="py-12 text-center space-y-2">
            <Calendar className="h-10 w-10 mx-auto text-gray-300" />
            <p className="text-gray-500 font-medium">No hay caja registrada para este día</p>
            <p className="text-gray-400 text-sm">
              {isPastDay ? 'No se abrió caja en esa fecha.' : 'Abre la caja para comenzar a operar.'}
            </p>
          </CardContent>
        </Card>
      )}

      {salesTotals && (
        <>
          {/* ── TARJETA GRAN TOTAL (Hero) ─────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* 1. Todo lo que entró */}
            <Card className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Todo lo que entró</p>
                    <p className="text-3xl font-black text-emerald-700 mt-1">S/ {totalIngresos.toFixed(2)}</p>
                    <p className="text-xs text-emerald-500 mt-1">
                      Ventas POS S/ {posTotal.toFixed(2)} + Cobros manuales S/ {manIncomeTotal.toFixed(2)}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. Todo lo que salió */}
            <Card className="border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-red-50">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-rose-600 uppercase tracking-wide">Todo lo que salió</p>
                    <p className="text-3xl font-black text-rose-700 mt-1">S/ {manExpenseTotal.toFixed(2)}</p>
                    <p className="text-xs text-rose-400 mt-1">
                      {expenseEntries.length} egreso{expenseEntries.length !== 1 ? 's' : ''} registrado{expenseEntries.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
                    <TrendingDown className="h-5 w-5 text-rose-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 3. Resultado: lo que debe haber en caja AHORA (caja abrió en 0) */}
            <Card className="border-2 border-indigo-400 bg-gradient-to-br from-indigo-600 to-blue-700 shadow-lg shadow-indigo-200">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-indigo-200 uppercase tracking-wider">Lo que debe haber en caja ahora</p>
                    <p className="text-4xl font-black text-white mt-1">S/ {granTotal.toFixed(2)}</p>
                    <p className="text-xs text-indigo-300 mt-1">
                      Ingresos {totalIngresos.toFixed(2)} − Egresos {manExpenseTotal.toFixed(2)}
                    </p>
                    <p className="text-xs text-indigo-200/90 mt-2 font-medium">
                      La caja abrió en S/ 0.00. Este monto es lo que debería haber al cierre.
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Wallet className="h-5 w-5 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── VENTAS POS — Tarjetas clicables (LUPA) ───────────────────── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-base font-bold text-gray-700 flex items-center gap-2">
                🛒 Ventas POS
                <Badge variant="outline" className="text-xs font-normal text-gray-500">
                  Toca un monto para ver el detalle
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: '💵 Efectivo',    value: salesTotals.cash,          key: 'cash' },
                  { label: '📱 Yape',        value: salesTotals.yape,          key: 'yape' },
                  { label: '📲 Plin',        value: salesTotals.plin,          key: 'plin' },
                  { label: '🏦 Transfer.',   value: salesTotals.transferencia, key: 'transferencia' },
                  { label: '💳 Tarjeta',     value: salesTotals.tarjeta,       key: 'tarjeta' },
                ].map((item) => (
                  <PaymentCard
                    key={item.key}
                    label={item.label}
                    value={item.value}
                    onClick={() => openDrillDown({ label: item.label, paymentMethod: item.key, total: item.value })}
                  />
                ))}
                <div className="rounded-xl bg-indigo-600 p-3 text-center flex flex-col justify-center">
                  <p className="text-xs font-bold text-indigo-200 uppercase">Total cobrado POS</p>
                  <p className="text-xl font-black text-white mt-0.5">S/ {salesTotals.total.toFixed(2)}</p>
                  <p className="text-[10px] text-indigo-200 mt-0.5">Efectivo + Yape + Tarjeta + …</p>
                </div>
              </div>
              {(salesTotals as any).credit_total > 0 && (
                <p className="text-xs text-amber-600 mt-3 flex items-center gap-1.5">
                  <span className="font-semibold">Ventas a crédito (aún no están en caja):</span>
                  <span className="font-bold">S/ {((salesTotals as any).credit_total || 0).toFixed(2)}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── INGRESOS + EGRESOS MANUALES ──────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ManualEntriesPanel
              title="📥 Ingresos Manuales"
              entries={incomeEntries}
              totalAmount={totalManualIncome}
              color="green"
              emptyText="Sin ingresos manuales en este día"
            />
            <ManualEntriesPanel
              title="📤 Egresos Manuales"
              entries={expenseEntries}
              totalAmount={totalManualExpense}
              color="red"
              emptyText="Sin egresos manuales en este día"
            />
          </div>

          {/* ── DESGLOSE POR MEDIO — Solo si hay manuales ────────────────── */}
          {(manIncomeTotal > 0 || manExpenseTotal > 0) && (
            <Card className="border border-gray-200">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-bold text-gray-600 uppercase tracking-wide">
                  Desglose Consolidado por Medio de Pago
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {[
                    { label: '💵 Efectivo',  pos: salesTotals.cash,          man: (salesTotals as any).manual_income_cash },
                    { label: '📱 Yape',      pos: salesTotals.yape,          man: (salesTotals as any).manual_income_yape },
                    { label: '📲 Plin',      pos: salesTotals.plin,          man: (salesTotals as any).manual_income_plin },
                    { label: '🏦 Transfer.', pos: salesTotals.transferencia, man: (salesTotals as any).manual_income_transferencia },
                    { label: '💳 Tarjeta',   pos: salesTotals.tarjeta,       man: (salesTotals as any).manual_income_tarjeta },
                  ].map((item) => {
                    const total = safeAdd(item.pos, item.man);
                    return (
                      <div key={item.label} className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                        <p className="text-xs text-gray-400 font-medium">{item.label}</p>
                        <p className="text-base font-black text-gray-800 mt-0.5">S/ {total.toFixed(2)}</p>
                        {item.man > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            POS {item.pos.toFixed(2)} + Man. {item.man.toFixed(2)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── BOTONES DE ACCIÓN — Solo cajeros activos en día de hoy ──────── */}
      {!isViewReadOnly && activeSession && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <Button onClick={() => setShowIncomeModal(true)} className="h-14 bg-emerald-600 hover:bg-emerald-700 text-sm font-bold">
            <ArrowDownCircle className="h-5 w-5 mr-1.5" /> Registrar Ingreso
          </Button>
          <Button onClick={() => setShowExpenseModal(true)} className="h-14 bg-rose-600 hover:bg-rose-700 text-sm font-bold">
            <ArrowUpCircle className="h-5 w-5 mr-1.5" /> Registrar Egreso
          </Button>
          <Button onClick={onTreasuryRequested} variant="outline" className="h-14 text-sm font-bold border-indigo-300 text-indigo-700 hover:bg-indigo-50">
            <Send className="h-5 w-5 mr-1.5" /> A Tesorería
          </Button>
          <Button onClick={onCloseRequested} className="h-14 text-sm font-bold bg-slate-800 hover:bg-slate-900">
            <Lock className="h-5 w-5 mr-1.5" /> Cerrar Caja
          </Button>
        </div>
      )}

      {/* ── MODALES DE REGISTRO ──────────────────────────────────────────── */}
      {activeSession && (
        <>
          <ManualCashEntryModal
            open={showIncomeModal}
            onClose={() => setShowIncomeModal(false)}
            entryType="income"
            cashSessionId={activeSession.id}
            schoolId={schoolId}
            onCreated={load}
          />
          <ManualCashEntryModal
            open={showExpenseModal}
            onClose={() => setShowExpenseModal(false)}
            entryType="expense"
            cashSessionId={activeSession.id}
            schoolId={schoolId}
            onCreated={load}
          />
        </>
      )}

      {/* ── DRILL-DOWN MODAL (lupa) ───────────────────────────────────────── */}
      <Dialog open={!!drillDown} onOpenChange={() => setDrillDown(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <Eye className="h-5 w-5 text-blue-500" />
              {drillDown?.label} — {formatDateDisplay(selectedDate)}
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-sm text-gray-500">
              {drillItems.length} transacción{drillItems.length !== 1 ? 'es' : ''}
            </span>
            <span className="font-black text-lg text-gray-800">
              Total: S/ {drillDown?.total.toFixed(2)}
            </span>
          </div>

          {drillLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : drillItems.length === 0 ? (
            <p className="text-center text-gray-400 py-10">No hay transacciones POS para este medio de pago.</p>
          ) : (
            <div className="overflow-y-auto flex-1 space-y-1.5 pr-1">
              {drillItems.map((t) => {
                const isLunch = !!t.metadata?.lunch_order_id;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 text-sm border border-gray-100"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-gray-800 truncate">{t.student_name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">
                          {format(new Date(t.created_at), 'HH:mm', { locale: es })}
                        </span>
                        {isLunch && (
                          <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">
                            Almuerzo
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="font-black text-gray-900 whitespace-nowrap ml-2">
                      S/ {t.amount.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
