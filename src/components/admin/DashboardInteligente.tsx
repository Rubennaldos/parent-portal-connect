/**
 * DashboardInteligente — Pestaña de Analytics
 *
 * Tres secciones con recharts:
 *  1. Ventas vs Créditos (paid vs pending) — barras comparativas por día
 *  2. Top 10 productos más rentables — barras horizontales
 *  3. Salud de Cartera — donut chart + indicadores numéricos
 *
 * Queries optimizadas: todo agrupado en supabase, cero loops en cliente.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
  RefreshCw,
  Loader2,
  Calendar,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Wallet,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Sector,
} from 'recharts';
import { format, subDays, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DayBar {
  day:     string;  // 'Lun 07'
  ventas:  number;  // paid
  credito: number;  // pending
}

interface TopProduct {
  name:    string;
  revenue: number;
  qty:     number;
}

interface CarteraData {
  recaudado: number;
  pendiente: number;
  anulado:   number;
  total:     number;
}

interface Props {
  schoolId?: string | null;
}

// ── Constantes ─────────────────────────────────────────────────────────────────
const PRESET_RANGES = [
  { label: 'Hoy',             from: () => format(new Date(), 'yyyy-MM-dd'),               to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: '7 días',          from: () => format(subDays(new Date(), 6), 'yyyy-MM-dd'),   to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: '30 días',         from: () => format(subDays(new Date(), 29), 'yyyy-MM-dd'),  to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Este mes',        from: () => format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
];

const PIE_COLORS = ['#0d9488', '#f59e0b', '#ef4444'];

// ── Componente principal ───────────────────────────────────────────────────────

export function DashboardInteligente({ schoolId }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [dateTo,   setDateTo]   = useState(today);
  const [preset,   setPreset]   = useState(1);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const [dayBars,    setDayBars]    = useState<DayBar[]>([]);
  const [topProds,   setTopProds]   = useState<TopProduct[]>([]);
  const [cartera,    setCartera]    = useState<CarteraData | null>(null);
  const [activePie,  setActivePie]  = useState(0);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const limaStart = (dateFrom + 'T00:00:00-05:00');
      const limaEnd   = (dateTo   + 'T23:59:59-05:00');

      let baseQuery = supabase
        .from('transactions')
        .select('id, amount, payment_status, created_at, school_id')
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .gte('created_at', limaStart)
        .lte('created_at', limaEnd);

      if (schoolId) baseQuery = baseQuery.eq('school_id', schoolId);

      const { data: txData, error: txErr } = await baseQuery;
      if (txErr) throw txErr;

      // ── 1. Ventas vs Créditos por día ──────────────────────────────────────
      const dayMap = new Map<string, { ventas: number; credito: number }>();
      (txData ?? []).forEach(tx => {
        const d   = new Date(tx.created_at);
        // Convertir a Lima: UTC-5
        const limaD = new Date(d.getTime() - 5 * 60 * 60 * 1000);
        const key  = format(limaD, 'EEE dd', { locale: es });
        if (!dayMap.has(key)) dayMap.set(key, { ventas: 0, credito: 0 });
        const s = dayMap.get(key)!;
        const amt = Math.abs(tx.amount);
        if (tx.payment_status === 'paid')                    s.ventas  += amt;
        else if (tx.payment_status === 'pending' || tx.payment_status === 'partial') s.credito += amt;
      });
      setDayBars(
        Array.from(dayMap.entries())
          .map(([day, v]) => ({ day, ventas: +v.ventas.toFixed(2), credito: +v.credito.toFixed(2) }))
          .sort((a, b) => {
            // Orden cronológico aproximado usando el índice del mapa
            const aIdx = Array.from(dayMap.keys()).indexOf(a.day);
            const bIdx = Array.from(dayMap.keys()).indexOf(b.day);
            return aIdx - bIdx;
          })
      );

      // ── 2. Cartera (salud) ─────────────────────────────────────────────────
      const recaudado = (txData ?? []).filter(t => t.payment_status === 'paid')
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const pendiente = (txData ?? []).filter(t => ['pending','partial'].includes(t.payment_status))
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const anulado   = (txData ?? []).filter(t => t.payment_status === 'cancelled')
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      setCartera({ recaudado, pendiente, anulado, total: recaudado + pendiente });

      // ── 3. Top 10 productos ────────────────────────────────────────────────
      const txIds = (txData ?? [])
        .filter(t => t.payment_status !== 'cancelled')
        .map(t => t.id);

      if (txIds.length > 0) {
        const { data: itemData, error: itemErr } = await supabase
          .from('transaction_items')
          .select('product_name, quantity, subtotal, product_id')
          .in('transaction_id', txIds.slice(0, 1000));  // limit para evitar URL demasiado larga

        if (itemErr) throw itemErr;

        const prodMap = new Map<string, { revenue: number; qty: number }>();
        (itemData ?? []).forEach(item => {
          const key = item.product_name ?? 'Sin nombre';
          if (!prodMap.has(key)) prodMap.set(key, { revenue: 0, qty: 0 });
          const s = prodMap.get(key)!;
          s.revenue += item.subtotal ?? 0;
          s.qty     += item.quantity ?? 0;
        });
        const sorted = Array.from(prodMap.entries())
          .map(([name, v]) => ({ name, revenue: +v.revenue.toFixed(2), qty: v.qty }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
          .reverse();  // recharts horizontal: bottom = 1er lugar visualmente
        setTopProds(sorted);
      } else {
        setTopProds([]);
      }

    } catch (e: any) {
      setError(e.message ?? 'Error al cargar el dashboard');
    } finally {
      setLoading(false);
    }
  }, [schoolId, dateFrom, dateTo]);

  // Auto-carga al montar y cuando cambian los filtros
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const applyPreset = (idx: number) => {
    setPreset(idx);
    setDateFrom(PRESET_RANGES[idx].from());
    setDateTo(PRESET_RANGES[idx].to());
  };

  // ── Helpers visuales ────────────────────────────────────────────────────────
  const fmt = (n: number) => `S/ ${n.toFixed(2)}`;
  const cobro_pct = cartera && cartera.total > 0
    ? ((cartera.recaudado / cartera.total) * 100).toFixed(1)
    : '0';
  const pieData = cartera ? [
    { name: 'Recaudado', value: cartera.recaudado },
    { name: 'Pendiente', value: cartera.pendiente },
    { name: 'Anulado',   value: cartera.anulado   },
  ] : [];

  // Donut activo
  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value } = props;
    return (
      <g>
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#1e293b" className="text-sm font-bold" fontSize={13}>
          {payload.name}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill={fill} fontSize={14} fontWeight="bold">
          S/ {value.toFixed(0)}
        </text>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6}
          startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={innerRadius - 2}
          startAngle={startAngle} endAngle={endAngle} fill={fill} />
      </g>
    );
  };

  return (
    <div className="space-y-6">

      {/* ── Header controles ── */}
      <div className="bg-white rounded-2xl border p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-wrap gap-2">
          {PRESET_RANGES.map((p, i) => (
            <button
              key={p.label}
              onClick={() => applyPreset(i)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                ${preset === i ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center ml-auto">
          <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-slate-50 text-sm">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input type="date" value={dateFrom} max={dateTo}
              onChange={e => { setDateFrom(e.target.value); setPreset(-1); }}
              className="bg-transparent outline-none text-sm" />
          </div>
          <span className="text-slate-400 text-xs">—</span>
          <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-slate-50 text-sm">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input type="date" value={dateTo} min={dateFrom} max={today}
              onChange={e => { setDateTo(e.target.value); setPreset(-1); }}
              className="bg-transparent outline-none text-sm" />
          </div>
          <Button onClick={fetchAll} disabled={loading} size="sm"
            className="bg-slate-800 hover:bg-slate-700 text-white gap-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {loading ? 'Cargando...' : 'Actualizar'}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Cargando datos del dashboard...</span>
        </div>
      )}

      {!loading && (
        <div className="space-y-6">

          {/* ══════════════════════════════════════════════════
              SECCIÓN 1: Ventas vs Créditos
          ══════════════════════════════════════════════════ */}
          <div className="bg-white rounded-2xl border p-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800">Ventas Cobradas vs Créditos Pendientes</h3>
            </div>
            <p className="text-xs text-slate-400 mb-5">
              Comparativa diaria del importe pagado al momento (verde) frente al crédito aún por cobrar (ámbar).
            </p>

            {dayBars.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dayBars} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `S/${v}`} width={60} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      `S/ ${v.toFixed(2)}`,
                      name === 'ventas' ? '✅ Cobrado' : '⏳ Crédito',
                    ]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend
                    formatter={v => v === 'ventas' ? 'Cobrado' : 'Crédito pendiente'}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="ventas"  fill="#0d9488" radius={[4,4,0,0]} name="ventas" />
                  <Bar dataKey="credito" fill="#f59e0b" radius={[4,4,0,0]} name="credito" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ══════════════════════════════════════════════════
              SECCIÓN 2 + 3: Top 10 y Cartera — side by side
          ══════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

            {/* Top 10 — col 3 */}
            <div className="lg:col-span-3 bg-white rounded-2xl border p-5">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-800">Top 10 Productos más Rentables</h3>
              </div>
              <p className="text-xs text-slate-400 mb-5">
                Ordenados por revenue (ventas no anuladas) en el período seleccionado.
              </p>

              {topProds.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={topProds.length * 36 + 40}>
                  <BarChart data={topProds} layout="vertical" margin={{ left: 10, right: 70 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `S/${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                    <Tooltip
                      formatter={(v: number, name: string) => [
                        name === 'revenue' ? `S/ ${v.toFixed(2)}` : `${v} uds`,
                        name === 'revenue' ? 'Revenue' : 'Cantidad',
                      ]}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                      {topProds.map((_, i) => (
                        <Cell key={i}
                          fill={`hsl(${160 + i * 8}, 65%, ${45 + i * 2}%)`}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Salud de Cartera — col 2 */}
            <div className="lg:col-span-2 bg-white rounded-2xl border p-5">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-800">Salud de Cartera</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Porcentaje de lo emitido que ya fue cobrado vs lo pendiente.
              </p>

              {!cartera || cartera.total === 0 ? (
                <EmptyChart small />
              ) : (
                <div className="space-y-4">

                  {/* Donut */}
                  <div className="flex justify-center">
                    <PieChart width={200} height={180}>
                      <Pie
                        activeIndex={activePie}
                        activeShape={renderActiveShape}
                        data={pieData.filter(d => d.value > 0)}
                        cx={100} cy={90}
                        innerRadius={55}
                        outerRadius={80}
                        dataKey="value"
                        onMouseEnter={(_, idx) => setActivePie(idx)}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </div>

                  {/* Indicadores numéricos */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-teal-50">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-teal-600" />
                        <span className="text-xs font-semibold text-teal-700">Recaudado</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-teal-700">{fmt(cartera.recaudado)}</p>
                        <p className="text-xs text-teal-500">{cobro_pct}% del total</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-semibold text-amber-700">Pendiente</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-amber-700">{fmt(cartera.pendiente)}</p>
                        <p className="text-xs text-amber-500">
                          {cartera.total > 0 ? ((cartera.pendiente / cartera.total) * 100).toFixed(1) : 0}% del total
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-red-50">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="w-4 h-4 text-red-500" />
                        <span className="text-xs font-semibold text-red-600">Anulado</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-600">{fmt(cartera.anulado)}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-slate-500" />
                          <span className="text-xs font-semibold text-slate-600">Total emitido</span>
                        </div>
                        <p className="text-sm font-bold text-slate-800">{fmt(cartera.total)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Semáforo */}
                  <div className={`rounded-xl p-3 text-center text-xs font-bold
                    ${Number(cobro_pct) >= 80
                      ? 'bg-emerald-100 text-emerald-700'
                      : Number(cobro_pct) >= 50
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                    }`}>
                    {Number(cobro_pct) >= 80
                      ? `✅ Cartera saludable — ${cobro_pct}% cobrado`
                      : Number(cobro_pct) >= 50
                      ? `⚠️ Cartera media — ${cobro_pct}% cobrado`
                      : `🚨 Cartera débil — solo ${cobro_pct}% cobrado`
                    }
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function EmptyChart({ small = false }: { small?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-slate-300 ${small ? 'py-8' : 'py-12'}`}>
      <TrendingUp className={`${small ? 'w-8 h-8' : 'w-12 h-12'} opacity-30`} />
      <p className="text-xs">Sin datos para este período</p>
    </div>
  );
}
