import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, ArrowDownCircle, ArrowUpCircle, Lock, Unlock, RefreshCw, Send,
  ChevronLeft, ChevronRight, Calendar, TrendingUp, TrendingDown,
  Wallet, ChevronDown, ChevronUp, Clock, Eye, AlertTriangle, Globe,
  ClipboardList, ScanSearch,
} from 'lucide-react';
import { format, subDays, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession, CashManualEntry, DailySalesTotals } from '@/types/cashRegisterV2';
import ManualCashEntryModal from './ManualCashEntryModal';
import InventoryAuditModal from './InventoryAuditModal';

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
  session: CashSession | null;    // null cuando admin entra sin sesión abierta
  schoolId: string;
  allSchoolIds?: string[];        // cuando se pasa, agrega datos de todas las sedes
  onCloseRequested: () => void;
  /** Abrir o reabrir caja del día (sesión cerrada o sin sesión) */
  onOpenCashRequested?: () => void | Promise<void>;
  onTreasuryRequested: () => void;
  onRefresh: () => void;
  isReadOnly?: boolean;
  isAdmin?: boolean;              // controla visibilidad del selector de fecha y datos sensibles
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

// ─── Historial de Turnos (Auditoría Admin) ───────────────────────────────────

interface AuditRow {
  id: string;
  session_date: string;
  status: string;
  cashier_name: string | null;
  opened_at: string;
  closed_at: string | null;
  initial_cash: number;
  system_cash: number | null;
  system_tarjeta: number | null;
  declared_cash: number | null;
  declared_tarjeta: number | null;
  variance_total: number | null;
  variance_justification: string | null;
  opened_by_email?: string;
}

function CashAuditHistory({ schoolId }: { schoolId: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('cash_sessions')
        .select('id, session_date, status, cashier_name, opened_at, closed_at, initial_cash, system_cash, system_tarjeta, declared_cash, declared_tarjeta, variance_total, variance_justification, opened_by_profile:opened_by(email)')
        .eq('school_id', schoolId)
        .order('session_date', { ascending: false })
        .limit(30);

      setRows(
        (data || []).map((r: any) => ({
          ...r,
          opened_by_email: r.opened_by_profile?.email ?? '—',
        }))
      );
    } catch (err) {
      console.error('[CashAudit] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => { if (expanded) load(); }, [expanded, load]);

  return (
    <Card className="border border-slate-200">
      <CardHeader
        className="pb-2 pt-4 px-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <CardTitle className="text-base font-bold text-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-500" />
            Historial de Turnos / Auditoría
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent className="px-5 pb-5">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
          ) : rows.length === 0 ? (
            <p className="text-center text-gray-400 py-6 text-sm">No hay sesiones de caja registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-gray-300 text-left">
                    <th className="py-2 px-2 font-semibold">Fecha</th>
                    <th className="py-2 px-2 font-semibold">Cajero</th>
                    <th className="py-2 px-2 font-semibold">Apertura</th>
                    <th className="py-2 px-2 font-semibold text-right">Monto Ap.</th>
                    <th className="py-2 px-2 font-semibold">Cierre</th>
                    <th className="py-2 px-2 font-semibold text-right">Sistema</th>
                    <th className="py-2 px-2 font-semibold text-right">Declarado</th>
                    <th className="py-2 px-2 font-semibold text-right">Descuadre</th>
                    <th className="py-2 px-2 font-semibold">Justificación</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const systemTotal = safeAdd(r.system_cash ?? 0, r.system_tarjeta ?? 0);
                    const declaredTotal = safeAdd(r.declared_cash ?? 0, r.declared_tarjeta ?? 0);
                    const vt = r.variance_total ?? 0;
                    return (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-2 font-medium whitespace-nowrap">
                          {format(parseISO(r.session_date), 'dd/MM/yy')}
                        </td>
                        <td className="py-2 px-2 truncate max-w-[120px]">{r.cashier_name || r.opened_by_email}</td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {format(new Date(r.opened_at), 'HH:mm')}
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">S/ {r.initial_cash.toFixed(2)}</td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {r.closed_at ? format(new Date(r.closed_at), 'HH:mm') : (
                            <Badge className="bg-amber-100 text-amber-700 text-[10px]">Abierta</Badge>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap font-semibold text-blue-700">
                          {r.system_cash != null ? `S/ ${systemTotal.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap font-semibold">
                          {r.declared_cash != null ? `S/ ${declaredTotal.toFixed(2)}` : '—'}
                        </td>
                        <td className={`py-2 px-2 text-right whitespace-nowrap font-bold ${
                          Math.abs(vt) < 0.50 ? 'text-green-600' : vt > 0 ? 'text-red-600' : 'text-amber-600'
                        }`}>
                          {r.variance_total != null
                            ? (Math.abs(vt) < 0.50
                                ? '✓'
                                : `${vt > 0 ? '-' : '+'}S/ ${Math.abs(vt).toFixed(2)}`)
                            : '—'}
                        </td>
                        <td className="py-2 px-2 truncate max-w-[150px] text-gray-500">
                          {r.variance_justification || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CashDayDashboard({
  session, schoolId, allSchoolIds, onCloseRequested, onOpenCashRequested, onTreasuryRequested, onRefresh, isReadOnly = false, isAdmin = false,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Modo consolidado (todas las sedes) ────────────────────────────────────
  const isAllSchools = (allSchoolIds?.length ?? 0) > 1;

  // ── 1. Selector de fecha y modo ───────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(todayLima());
  const isToday = selectedDate === todayLima();
  const isPastDay = !isToday;

  // Modo de fecha: día individual | rango personalizado | mes completo
  const [dateMode, setDateMode] = useState<'day' | 'range' | 'month'>('day');
  const isRangeMode = dateMode !== 'day';

  // Valores pendientes (se aplican al hacer clic en "Buscar")
  const [pendingStart, setPendingStart] = useState<string>(todayLima());
  const [pendingEnd, setPendingEnd] = useState<string>(todayLima());
  const [pendingMonth, setPendingMonth] = useState<string>(todayLima().substring(0, 7));

  // Valores activos (los que dispararon la última búsqueda)
  const [activeStart, setActiveStart] = useState<string>(todayLima());
  const [activeEnd, setActiveEnd] = useState<string>(todayLima());

  // La sesión activa para la fecha seleccionada (puede ser distinta a la de hoy)
  const [activeSession, setActiveSession] = useState<CashSession | null>(session);

  // ── 2. Data ───────────────────────────────────────────────────────────────
  const [salesTotals, setSalesTotals] = useState<DailySalesTotals | null>(null);
  const [manualEntries, setManualEntries] = useState<CashManualEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 3. Modales ────────────────────────────────────────────────────────────
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);

  // ── 4. DrillDown (lupa) ───────────────────────────────────────────────────
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
  const [drillItems, setDrillItems] = useState<PosTransaction[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // ── Cargar data para la fecha/rango seleccionado ─────────────────────────
  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      // ── MODO RANGO / MES o TODAS LAS SEDES ─────────────────────────────
      if (isRangeMode || isAllSchools) {
        // En modo día, usar selectedDate; en modo rango, usar activeStart/activeEnd
        const startDate = isRangeMode ? activeStart : selectedDate;
        const endDate   = isRangeMode ? activeEnd   : selectedDate;

        const rpcArgs = isAllSchools
          ? { p_school_id: null as unknown as string, p_start_date: startDate, p_end_date: endDate, p_school_ids: allSchoolIds }
          : { p_school_id: schoolId, p_start_date: startDate, p_end_date: endDate };

        const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_range_totals', rpcArgs as any);
        if (rpcErr) console.error('[CashDayDashboard] Range RPC error:', rpcErr);

        const d = rpcData || { pos: {}, lunch: {}, manual: {} };
        const pos   = d.pos   || {};
        const lunch = d.lunch || {};
        const manualIncome  = Number(d.manual?.income  || 0);
        const manualExpense = Number(d.manual?.expense || 0);

        const posCobrado = safeAdd(
          pos.cash, lunch.cash, pos.mixed_cash,
          pos.yape,  lunch.yape, pos.mixed_yape,
          pos.plin,  lunch.plin,
          pos.transferencia, lunch.transferencia,
          pos.card, lunch.card, pos.mixed_card
        );

        setSalesTotals({
          cash:          safeAdd(pos.cash, lunch.cash, pos.mixed_cash),
          yape:          safeAdd(pos.yape, lunch.yape, pos.mixed_yape),
          plin:          safeAdd(pos.plin, lunch.plin),
          transferencia: safeAdd(pos.transferencia, lunch.transferencia),
          tarjeta:       safeAdd(pos.card, lunch.card, pos.mixed_card),
          mixto: 0,
          total: posCobrado,
          credit_total:              safeAdd(pos.credit, lunch.credit),
          manual_income_cash:         0,
          manual_income_yape:         0,
          manual_income_plin:         0,
          manual_income_tarjeta:      0,
          manual_income_transferencia:0,
          manual_income_otro:         0,
          manual_income_total:        manualIncome,
          manual_expense_total:       manualExpense,
        } as any);
        setActiveSession(null);
        setManualEntries([]);
        return;
      }

      // ── MODO DÍA (lógica original) ────────────────────────────────────────
      let currentSession: CashSession | null;
      if (!isToday) {
        const { data: sess } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('school_id', schoolId)
          .eq('session_date', selectedDate)
          .maybeSingle();

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
        total: posCobrado,
        credit_total: creditTotal,
        manual_income_cash:          Number((manIn.cash          || 0).toFixed(2)),
        manual_income_yape:          Number((manIn.yape          || 0).toFixed(2)),
        manual_income_plin:          Number((manIn.plin          || 0).toFixed(2)),
        manual_income_tarjeta:       Number((manIn.tarjeta       || 0).toFixed(2)),
        manual_income_transferencia: Number((manIn.transferencia || 0).toFixed(2)),
        manual_income_otro:          Number((manIn.otro          || 0).toFixed(2)),
        manual_income_total:         Number((manIn.total         || 0).toFixed(2)),
        manual_expense_total:        Number((manOut.total        || 0).toFixed(2)),
      } as any);

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
  }, [schoolId, allSchoolIds, session?.id, selectedDate, isToday, isRangeMode, isAllSchools, activeStart, activeEnd]);

  useEffect(() => { load(); }, [load]);

  // ── Drill-down: cargar transacciones del método clickeado ─────────────────
  const openDrillDown = useCallback(async (drill: DrillDownState) => {
    setDrillDown(drill);
    setDrillItems([]);
    setDrillLoading(true);
    try {
      const methodMap: Record<string, string[]> = {
        cash:          ['efectivo'],
        yape:          ['yape', 'yape_qr', 'plin'],   // Yape/Plin juntos
        plin:          ['plin', 'yape', 'yape_qr'],   // mismo grupo
        tarjeta:       ['tarjeta'],
        transferencia: ['transferencia'],
      };
      const methods = methodMap[drill.paymentMethod] || [drill.paymentMethod];

      const startDate = isRangeMode ? activeStart : selectedDate;
      const endDate   = isRangeMode ? activeEnd   : selectedDate;

      let query = supabase
        .from('transactions')
        .select('id, created_at, amount, payment_method, metadata, student:students(full_name)')
        .eq('type', 'purchase')
        .in('payment_method', methods)
        .neq('payment_status', 'cancelled')
        .gte('created_at', `${startDate}T00:00:00-05:00`)
        .lt('created_at',  `${endDate}T23:59:59-05:00`)
        .order('created_at', { ascending: false })
        .limit(100);

      if (isAllSchools && allSchoolIds?.length) {
        query = query.in('school_id', allSchoolIds);
      } else {
        query = query.eq('school_id', schoolId);
      }

      const { data } = await query;

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
  }, [schoolId, allSchoolIds, selectedDate, isRangeMode, isAllSchools, activeStart, activeEnd]);

  // ── Helpers para aplicar rangos ──────────────────────────────────────────
  const applyRange = (start: string, end: string) => {
    setActiveStart(start);
    setActiveEnd(end);
  };

  const applyQuickRange = (preset: 'today' | 'yesterday' | 'last7') => {
    const today = todayLima();
    if (preset === 'today') {
      setPendingStart(today); setPendingEnd(today);
      applyRange(today, today);
    } else if (preset === 'yesterday') {
      const y = format(subDays(parseISO(today), 1), 'yyyy-MM-dd');
      setPendingStart(y); setPendingEnd(y);
      applyRange(y, y);
    } else if (preset === 'last7') {
      const s = format(subDays(parseISO(today), 6), 'yyyy-MM-dd');
      setPendingStart(s); setPendingEnd(today);
      applyRange(s, today);
    }
  };

  const applyMonth = () => {
    const base = parseISO(`${pendingMonth}-01`);
    const s = format(startOfMonth(base), 'yyyy-MM-dd');
    const e = format(endOfMonth(base), 'yyyy-MM-dd');
    applyRange(s, e);
  };

  // Etiqueta descriptiva del rango activo para el header
  const rangeLabelDisplay = () => {
    if (dateMode === 'month') {
      try { return format(parseISO(`${pendingMonth}-01`), 'MMMM yyyy', { locale: es }); } catch { return pendingMonth; }
    }
    if (activeStart === activeEnd) return formatDateDisplay(activeStart);
    try {
      return `${format(parseISO(activeStart), "d MMM", { locale: es })} → ${format(parseISO(activeEnd), "d MMM yyyy", { locale: es })}`;
    } catch { return `${activeStart} → ${activeEnd}`; }
  };

  // ── Navegación por fechas (modo día) ──────────────────────────────────────
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

  // ── Políticas de medios de pago ──────────────────────────────────────────
  // FÍSICO (va a caja, la cajera los cuenta): Efectivo + Tarjeta
  // DIGITAL (no va a caja, se concilia aparte): Yape/Plin + Transferencia
  // Yape y Plin se muestran juntos (igual que en el POS: botón "Yape / Plin").

  const yapePlin    = safeAdd(salesTotals?.yape ?? 0, salesTotals?.plin ?? 0);
  const posEnCaja   = safeAdd(salesTotals?.cash ?? 0, salesTotals?.tarjeta ?? 0);
  const posDigital  = safeAdd(yapePlin, salesTotals?.transferencia ?? 0);
  const granTotal   = safeAdd(posEnCaja, manIncomeTotal, -manExpenseTotal);

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

            {/* Título + badge + botón cerrar (botón siempre visible en pantalla chica) */}
            <div className="flex flex-col gap-3 w-full sm:flex-1 min-w-0">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                  <Wallet className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-white">
                      {isAllSchools ? 'Consolidado Global' : 'Cierre de Caja'}
                    </h2>
                    {isAllSchools ? (
                      <Badge className="bg-indigo-400/20 text-indigo-300 border-indigo-400/30 text-xs">
                        <Globe className="h-3 w-3 mr-1" />Todas las sedes
                      </Badge>
                    ) : isRangeMode ? (
                      <Badge className="bg-purple-400/20 text-purple-300 border-purple-400/30 text-xs">
                        📆 Período
                      </Badge>
                    ) : isToday ? (
                      activeSession?.status === 'open' ? (
                        <Badge className="bg-green-400/20 text-green-300 border-green-400/30 text-xs">
                          ● Abierta
                        </Badge>
                      ) : activeSession ? (
                        <Badge className="bg-slate-400/20 text-slate-300 border-slate-400/30 text-xs">
                          Cerrada
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/30 text-xs">
                          Sin abrir
                        </Badge>
                      )
                    ) : activeSession?.status === 'open' ? (
                      <Badge className="bg-red-400/30 text-red-200 border-red-400/40 text-xs">
                        ⚠️ Sin cerrar
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-400/20 text-slate-300 border-slate-400/30 text-xs">
                        Histórico
                      </Badge>
                    )}
                  </div>
                  <p className="text-slate-300 text-xs capitalize mt-0.5">
                    {isRangeMode || isAllSchools ? rangeLabelDisplay() : formatDateDisplay(selectedDate)}
                  </p>
                </div>
              </div>
              {isToday && !isRangeMode && !isAllSchools && onOpenCashRequested && (!activeSession || activeSession.status === 'closed') && (
                <Button
                  type="button"
                  onClick={() => void onOpenCashRequested()}
                  size="sm"
                  className="w-full sm:w-auto sm:self-start bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  <Unlock className="h-4 w-4 mr-1.5" /> Abrir Caja
                </Button>
              )}
              {isToday && !isRangeMode && !isAllSchools && activeSession?.status === 'open' && (
                <Button
                  type="button"
                  onClick={onCloseRequested}
                  size="sm"
                  className="w-full sm:w-auto sm:self-start bg-red-600 hover:bg-red-700 text-white font-bold"
                >
                  <Lock className="h-4 w-4 mr-1.5" /> Cerrar Caja
                </Button>
              )}
            </div>

            {/* Controles de fecha — solo para admins */}
            <div className="flex flex-col items-end gap-2">
              {isAdmin ? (
                <>
                  {/* Selector de modo */}
                  <div className="flex gap-1 bg-white/10 rounded-lg p-0.5">
                    {(['day', 'range', 'month'] as const).map((mode) => {
                      const labels = { day: 'Día', range: 'Rango', month: 'Mes' };
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => { setDateMode(mode); if (mode === 'day') { setActiveStart(selectedDate); setActiveEnd(selectedDate); } }}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${dateMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-white/70 hover:text-white'}`}
                        >
                          {labels[mode]}
                        </button>
                      );
                    })}
                  </div>

                  {/* Controles según modo */}
                  {dateMode === 'day' && (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={goToPreviousDay}
                        className="w-8 h-8 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors">
                        <ChevronLeft className="h-4 w-4 text-white" />
                      </button>
                      <input
                        type="date"
                        value={selectedDate}
                        max={todayLima()}
                        onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value); }}
                        className="bg-white/10 text-white text-sm rounded-lg px-2.5 py-1.5 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer w-[130px] [color-scheme:dark]"
                      />
                      <button type="button" onClick={goToNextDay} disabled={isToday}
                        className="w-8 h-8 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded-lg flex items-center justify-center transition-colors">
                        <ChevronRight className="h-4 w-4 text-white" />
                      </button>
                      {!isToday && (
                        <button type="button" onClick={goToToday}
                          className="text-xs bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg transition-colors">
                          Hoy
                        </button>
                      )}
                      {isToday && (
                        <button type="button" onClick={() => { load(); onRefresh(); }}
                          className="w-8 h-8 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors">
                          <RefreshCw className={`h-4 w-4 text-white ${loading ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                    </div>
                  )}

                  {dateMode === 'range' && (
                    <div className="flex flex-col gap-1.5">
                      {/* Presets rápidos */}
                      <div className="flex gap-1 justify-end">
                        {[
                          { label: 'Hoy',    preset: 'today' as const },
                          { label: 'Ayer',   preset: 'yesterday' as const },
                          { label: 'Últ. 7d', preset: 'last7' as const },
                        ].map(({ label, preset }) => (
                          <button key={preset} type="button" onClick={() => applyQuickRange(preset)}
                            className="text-xs bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded-md transition-colors">
                            {label}
                          </button>
                        ))}
                      </div>
                      {/* Inputs de rango */}
                      <div className="flex items-center gap-1.5">
                        <input type="date" value={pendingStart} max={todayLima()}
                          onChange={(e) => { if (e.target.value) setPendingStart(e.target.value); }}
                          className="bg-white/10 text-white text-xs rounded-lg px-2 py-1.5 border border-white/20 focus:outline-none w-[120px] [color-scheme:dark]"
                        />
                        <span className="text-white/60 text-xs">→</span>
                        <input type="date" value={pendingEnd} max={todayLima()} min={pendingStart}
                          onChange={(e) => { if (e.target.value) setPendingEnd(e.target.value); }}
                          className="bg-white/10 text-white text-xs rounded-lg px-2 py-1.5 border border-white/20 focus:outline-none w-[120px] [color-scheme:dark]"
                        />
                        <button type="button"
                          onClick={() => {
                            if (pendingStart > pendingEnd) {
                              toast({ variant: 'destructive', title: 'Rango inválido', description: '"Desde" no puede ser posterior a "Hasta".' });
                              return;
                            }
                            applyRange(pendingStart, pendingEnd);
                          }}
                          className="text-xs bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                          Buscar
                        </button>
                      </div>
                    </div>
                  )}

                  {dateMode === 'month' && (
                    <div className="flex items-center gap-1.5">
                      <input type="month" value={pendingMonth}
                        max={todayLima().substring(0, 7)}
                        onChange={(e) => { if (e.target.value) setPendingMonth(e.target.value); }}
                        className="bg-white/10 text-white text-sm rounded-lg px-2.5 py-1.5 border border-white/20 focus:outline-none w-[150px] [color-scheme:dark]"
                      />
                      <button type="button" onClick={applyMonth}
                        className="text-xs bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-3 py-1.5 rounded-lg transition-colors">
                        Buscar
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Cajeros: solo botón de actualizar — sin selector de fechas */
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

          {/* Aviso modo histórico — solo visible para admins con selector de fecha, solo en modo día */}
          {isAdmin && isPastDay && !isRangeMode && !isAllSchools && (
            <div className="mt-3 flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 text-amber-300 text-xs">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              Estás viendo un día pasado — modo solo lectura. Los botones de registro están desactivados.
            </div>
          )}

          {/* Aviso modo rango */}
          {isAdmin && isRangeMode && (
            <div className="mt-3 flex items-center gap-2 bg-purple-400/10 border border-purple-400/20 rounded-lg px-3 py-2 text-purple-300 text-xs">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              Vista de período — solo lectura. Muestra el consolidado de ventas del rango seleccionado.
            </div>
          )}

          {/* Aviso modo todas las sedes */}
          {isAdmin && isAllSchools && (
            <div className="mt-3 flex items-center gap-2 bg-indigo-400/10 border border-indigo-400/20 rounded-lg px-3 py-2 text-indigo-300 text-xs">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              Vista consolidada de todas las sedes — suma los totales de {allSchoolIds?.length} sedes.
            </div>
          )}

          {/* Alerta crítica: caja de día pasado que nunca fue cerrada */}
          {isAdmin && isPastDay && !isRangeMode && activeSession?.status === 'open' && (
            <div className="mt-2 flex items-center gap-2 bg-red-500/15 border border-red-400/30 rounded-lg px-3 py-2 text-red-300 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
              <span>
                <strong className="text-red-200">Caja sin cerrar:</strong> La sesión de este día quedó abierta y nunca fue reconciliada.
                Revisa con el cajero responsable.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── SIN SESIÓN PARA ESE DÍA ──────────────────────────────────────── */}
      {!salesTotals && !loading && (
        <Card className="border-dashed border-2 border-gray-200">
          <CardContent className="py-12 text-center space-y-2">
            <Calendar className="h-10 w-10 mx-auto text-gray-300" />
            <p className="text-gray-500 font-medium">
              {isRangeMode ? 'Sin ventas registradas en el período' : 'No hay caja registrada para este día'}
            </p>
            <p className="text-gray-400 text-sm">
              {isRangeMode
                ? 'Prueba seleccionando otro rango de fechas.'
                : isPastDay ? 'No se abrió caja en esa fecha.' : 'Abre la caja para comenzar a operar.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── VISTA CAJERO: Cierre a Ciegas ────────────────────────────────── */}
      {!isAdmin && salesTotals && (
        <Card className="border-2 border-amber-200 bg-amber-50">
          <CardContent className="p-6 text-center space-y-3">
            <div className="w-14 h-14 mx-auto bg-amber-100 rounded-full flex items-center justify-center">
              <Clock className="h-7 w-7 text-amber-600" />
            </div>
            <div>
              <p className="font-bold text-amber-800 text-lg">Turno en curso</p>
              <p className="text-sm text-amber-600 mt-1">
                Para cerrar el turno, usa el botón <strong>"Cerrar Caja"</strong> abajo.
                Se te pedirá que cuentes el efectivo y los vouchers físicamente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {salesTotals && isAdmin && (
        <>
          {/* ── TARJETAS HERO ────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* 1. LO QUE DEBE HABER EN CAJA — HERO principal (va primero) */}
            <Card className="border-2 border-indigo-400 bg-gradient-to-br from-indigo-600 to-blue-700 shadow-lg shadow-indigo-200">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-indigo-200 uppercase tracking-wider">
                      💵 Ventas POS (Físico + Tarjeta)
                    </p>
                    <p className="text-4xl font-black text-white mt-1">S/ {granTotal.toFixed(2)}</p>
                    <div className="mt-2 space-y-0.5">
                      <p className="text-xs text-indigo-200">
                        Efectivo S/ {(salesTotals?.cash ?? 0).toFixed(2)}
                        &nbsp;+&nbsp;Tarjeta S/ {(salesTotals?.tarjeta ?? 0).toFixed(2)}
                        {manIncomeTotal > 0 && ` + Ingresos S/ ${manIncomeTotal.toFixed(2)}`}
                        {manExpenseTotal > 0 && ` − Egresos S/ ${manExpenseTotal.toFixed(2)}`}
                      </p>
                      <p className="text-xs text-indigo-300/80 flex items-center gap-1">
                        <span>📱 Digital no va a caja:</span>
                        <span className="font-bold">S/ {posDigital.toFixed(2)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <Wallet className="h-5 w-5 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. COBROS DIGITALES — informativo, no va a caja */}
            <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">
                      📱 Cobros digitales (procesados en Kiosco)
                    </p>
                    <p className="text-3xl font-black text-purple-700 mt-1">S/ {posDigital.toFixed(2)}</p>
                    <div className="mt-1.5 space-y-0.5">
                      <p className="text-xs text-purple-500">
                        Yape/Plin S/ {yapePlin.toFixed(2)}
                        &nbsp;·&nbsp;Transfer. S/ {(salesTotals?.transferencia ?? 0).toFixed(2)}
                      </p>
                      <p className="text-xs text-purple-400 font-medium">
                        Cobrados vía Kiosco — NO están en caja física
                      </p>
                    </div>
                  </div>
                  <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
                    <TrendingUp className="h-5 w-5 text-purple-500" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 3. EGRESOS */}
            <Card className="border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-red-50">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-rose-600 uppercase tracking-wide">
                      📤 Salidas de caja
                    </p>
                    <p className="text-3xl font-black text-rose-700 mt-1">S/ {manExpenseTotal.toFixed(2)}</p>
                    <p className="text-xs text-rose-400 mt-1">
                      {expenseEntries.length} egreso{expenseEntries.length !== 1 ? 's' : ''} registrado{expenseEntries.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
                    <TrendingDown className="h-5 w-5 text-rose-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── DESGLOSE MEDIOS DE PAGO ──────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-base font-bold text-gray-700 flex items-center gap-2">
                🧾 Desglose por medio de pago
                <Badge variant="outline" className="text-xs font-normal text-gray-500">
                  Toca un monto para ver el detalle
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">

              {/* Físico — va a caja */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                  Ventas por POS (Físico y Tarjeta)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <PaymentCard
                    label="💵 Efectivo"
                    value={salesTotals.cash}
                    accent="bg-green-50 border-green-300"
                    onClick={() => openDrillDown({ label: '💵 Efectivo', paymentMethod: 'cash', total: salesTotals.cash })}
                  />
                  <PaymentCard
                    label="💳 Tarjeta"
                    value={salesTotals.tarjeta}
                    accent="bg-blue-50 border-blue-300"
                    onClick={() => openDrillDown({ label: '💳 Tarjeta', paymentMethod: 'tarjeta', total: salesTotals.tarjeta })}
                  />
                </div>
                <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Subtotal en caja</span>
                  <span className="text-lg font-black text-indigo-700">S/ {posEnCaja.toFixed(2)}</span>
                </div>
              </div>

              {/* Digital — no va a caja */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                  Pagos digitales procesados en Kiosco
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {/* Yape + Plin juntos — igual que el botón del POS */}
                  <PaymentCard
                    label="📱 Yape / Plin"
                    value={yapePlin}
                    accent="bg-purple-50 border-purple-300"
                    onClick={yapePlin > 0 ? () => openDrillDown({ label: '📱 Yape / Plin', paymentMethod: 'yape', total: yapePlin }) : undefined}
                  />
                  <PaymentCard
                    label="🏦 Transferencia"
                    value={salesTotals.transferencia}
                    accent="bg-cyan-50 border-cyan-300"
                    onClick={() => openDrillDown({ label: '🏦 Transferencia', paymentMethod: 'transferencia', total: salesTotals.transferencia })}
                  />
                </div>
                <div className="mt-2 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">Subtotal digital</span>
                  <span className="text-lg font-black text-purple-700">S/ {posDigital.toFixed(2)}</span>
                </div>
              </div>

              {(salesTotals as any).credit_total > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5 pt-1">
                  <span className="font-semibold">⏳ Créditos pendientes de cobro:</span>
                  <span className="font-bold">S/ {((salesTotals as any).credit_total || 0).toFixed(2)}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── BOTÓN AUDITORÍA DE INVENTARIO — solo admins, solo modo día ──── */}
          {!isRangeMode && !isAllSchools && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAuditModal(true)}
                className="border-amber-400 text-amber-700 hover:bg-amber-50 font-semibold gap-2"
              >
                <ScanSearch className="h-4 w-4" />
                Auditar Salida de Productos
              </Button>
            </div>
          )}

          {/* ── INGRESOS + EGRESOS MANUALES — ocultar en modo rango ─────────── */}
          {!isRangeMode && !isAllSchools && (
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
          )}

          {/* ── DESGLOSE CONSOLIDADO (cuando hay manuales) ───────────────── */}
          {(manIncomeTotal > 0 || manExpenseTotal > 0) && (
            <Card className="border border-gray-200">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-bold text-gray-600 uppercase tracking-wide">
                  Desglose Consolidado por Medio de Pago
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {[
                    { label: '💵 Efectivo',    pos: salesTotals.cash,          man: (salesTotals as any).manual_income_cash },
                    { label: '📱 Yape/Plin',   pos: yapePlin,                  man: safeAdd((salesTotals as any).manual_income_yape, (salesTotals as any).manual_income_plin) },
                    { label: '🏦 Transfer.',   pos: salesTotals.transferencia, man: (salesTotals as any).manual_income_transferencia },
                    { label: '💳 Tarjeta',     pos: salesTotals.tarjeta,       man: (salesTotals as any).manual_income_tarjeta },
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
      {!isViewReadOnly && !isRangeMode && !isAllSchools && activeSession && (
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

      {/* ── HISTORIAL DE TURNOS / AUDITORÍA — Solo admins ──────────────── */}
      {isAdmin && !isAllSchools && (
        <CashAuditHistory schoolId={schoolId} />
      )}

      {/* ── MODAL AUDITORÍA DE INVENTARIO — solo admins ─────────────────── */}
      {isAdmin && (
        <InventoryAuditModal
          open={showAuditModal}
          onClose={() => setShowAuditModal(false)}
          schoolId={schoolId}
          date={selectedDate}
        />
      )}

      {/* ── DRILL-DOWN MODAL (lupa) ───────────────────────────────────────── */}
      <Dialog open={!!drillDown} onOpenChange={() => setDrillDown(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" aria-describedby={undefined}>
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
