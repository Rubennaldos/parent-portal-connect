/**
 * ReporteVentasPeriodo — Reporte 1
 * Ventas por período, desglosadas por fuente (Quiosco / Comedor)
 * y por medio de pago (Efectivo, Digital, Tarjeta, Saldo, Mixto, Otro).
 *
 * Llama al RPC get_ventas_periodo_report que aplica lógica de cierre.
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';
import {
  TrendingUp,
  RefreshCw,
  Download,
  Calendar,
  Store,
  UtensilsCrossed,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
} from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PaymentBreakdown {
  total:     number;
  paid:      number;
  pending:   number;
  cancelled: number;
  efectivo:  number;
  digital:   number;
  tarjeta:   number;
  saldo:     number;
  mixto:     number;
  otro:      number;
  count:     number;
}

interface DayRow {
  date:    string;
  quiosco: number;
  comedor: number;
  total:   number;
  count:   number;
}

interface SchoolRow {
  school_name: string;
  quiosco:     number;
  comedor:     number;
  total:       number;
  paid:        number;
  pending:     number;
}

interface ReportData {
  period:      { from: string; to: string; generated_at: string; timezone: string };
  quiosco:     PaymentBreakdown;
  comedor:     PaymentBreakdown;
  grand_total: Omit<PaymentBreakdown, 'count' | 'pending' | 'cancelled'> & { paid: number; pending: number };
  by_day:      DayRow[];
  by_school:   SchoolRow[];
}

interface Props {
  schoolId?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt  = (n: number) => `S/ ${n.toFixed(2)}`;
const pct  = (part: number, total: number) =>
  total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%';

const PRESET_RANGES = [
  { label: 'Hoy',           from: () => format(new Date(), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Ayer',          from: () => format(subDays(new Date(), 1), 'yyyy-MM-dd'), to: () => format(subDays(new Date(), 1), 'yyyy-MM-dd') },
  { label: 'Últimos 7 días',from: () => format(subDays(new Date(), 6), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Últimos 30 días',from: () => format(subDays(new Date(), 29), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Este mes',      from: () => format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: () => format(new Date(), 'yyyy-MM-dd') },
];

// ── Componente principal ───────────────────────────────────────────────────────

export function ReporteVentasPeriodo({ schoolId }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom]     = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [dateTo, setDateTo]         = useState(today);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [report, setReport]         = useState<ReportData | null>(null);
  const [activePreset, setActivePreset] = useState(2); // Últimos 7 días por defecto

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_ventas_periodo_report', {
        p_school_id: schoolId ?? null,
        p_date_from: dateFrom,
        p_date_to:   dateTo,
      });
      if (rpcError) throw rpcError;
      setReport(data as ReportData);
    } catch (e: any) {
      setError(e.message ?? 'Error al cargar el reporte');
    } finally {
      setLoading(false);
    }
  }, [schoolId, dateFrom, dateTo]);

  const applyPreset = (idx: number) => {
    setActivePreset(idx);
    setDateFrom(PRESET_RANGES[idx].from());
    setDateTo(PRESET_RANGES[idx].to());
  };

  const exportExcel = () => {
    if (!report) return;
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Summary by Source ─────────────────────────────────────────
    const summaryHeaders = [
      'Source', 'Total (S/)', 'Paid (S/)', 'Pending (S/)', 'Cancelled (S/)',
      'Cash (S/)', 'Digital (S/)', 'Card (S/)', 'Balance (S/)', 'Mixed (S/)', 'Other (S/)', 'Tickets',
    ];
    const summaryRows = [
      summaryHeaders,
      ['Quiosco (Kiosk)',
        report.quiosco.total, report.quiosco.paid, report.quiosco.pending, report.quiosco.cancelled,
        report.quiosco.efectivo, report.quiosco.digital, report.quiosco.tarjeta, report.quiosco.saldo,
        report.quiosco.mixto, report.quiosco.otro, report.quiosco.count],
      ['Comedor (Cafeteria)',
        report.comedor.total, report.comedor.paid, report.comedor.pending, report.comedor.cancelled,
        report.comedor.efectivo, report.comedor.digital, report.comedor.tarjeta, report.comedor.saldo,
        report.comedor.mixto, report.comedor.otro, report.comedor.count],
      ['TOTAL',
        report.quiosco.total + report.comedor.total,
        report.grand_total.paid, report.grand_total.pending,
        (report.quiosco.cancelled ?? 0) + (report.comedor.cancelled ?? 0),
        report.quiosco.efectivo + report.comedor.efectivo,
        report.quiosco.digital + report.comedor.digital,
        report.quiosco.tarjeta + report.comedor.tarjeta,
        report.quiosco.saldo + report.comedor.saldo,
        report.quiosco.mixto + report.comedor.mixto,
        report.quiosco.otro + report.comedor.otro,
        report.quiosco.count + report.comedor.count],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSummary['!cols'] = summaryHeaders.map(() => ({ wch: 16 }));
    wsSummary['!autofilter'] = { ref: `A1:L${summaryRows.length}` };
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // ── Sheet 2: Daily Detail ──────────────────────────────────────────────
    if (report.by_day && report.by_day.length > 0) {
      const dailyHeaders = ['Date', 'Day of Week', 'Kiosk (S/)', 'Cafeteria (S/)', 'Total (S/)', 'Tickets'];
      const dailyRows = [
        dailyHeaders,
        ...report.by_day.map(d => {
          const dt = new Date(d.date + 'T12:00:00');
          return [
            format(dt, 'yyyy-MM-dd'),
            format(dt, 'EEEE'),
            d.quiosco,
            d.comedor,
            d.total,
            d.count,
          ];
        }),
        ['TOTAL', '', report.quiosco.total, report.comedor.total,
          report.quiosco.total + report.comedor.total,
          report.quiosco.count + report.comedor.count],
      ];
      const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
      wsDaily['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
      wsDaily['!autofilter'] = { ref: `A1:F${dailyRows.length}` };
      XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Detail');
    }

    // ── Sheet 3: By School (solo si hay más de una sede) ──────────────────
    if (report.by_school && report.by_school.length > 1) {
      const schoolHeaders = ['School', 'Kiosk (S/)', 'Cafeteria (S/)', 'Total (S/)', 'Paid (S/)', 'Pending (S/)'];
      const schoolRows = [
        schoolHeaders,
        ...report.by_school.map(s => [s.school_name, s.quiosco, s.comedor, s.total, s.paid, s.pending]),
      ];
      const wsSchool = XLSX.utils.aoa_to_sheet(schoolRows);
      wsSchool['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
      wsSchool['!autofilter'] = { ref: `A1:F${schoolRows.length}` };
      XLSX.utils.book_append_sheet(wb, wsSchool, 'By School');
    }

    XLSX.writeFile(wb, `sales_report_${dateFrom}_${dateTo}.xlsx`);
  };

  return (
    <div className="space-y-5">

      {/* ── Filtros ── */}
      <div className="bg-white rounded-2xl border p-4 space-y-4">

        {/* Rangos rápidos */}
        <div className="flex flex-wrap gap-2">
          {PRESET_RANGES.map((p, i) => (
            <button
              key={p.label}
              onClick={() => applyPreset(i)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                ${activePreset === i
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Selectores de fecha */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Desde</label>
            <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-slate-50">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={e => { setDateFrom(e.target.value); setActivePreset(-1); }}
                className="text-sm bg-transparent outline-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Hasta</label>
            <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-slate-50">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={today}
                onChange={e => { setDateTo(e.target.value); setActivePreset(-1); }}
                className="text-sm bg-transparent outline-none"
              />
            </div>
          </div>
          <Button onClick={fetchReport} disabled={loading} className="bg-slate-800 hover:bg-slate-700 text-white gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Cargando...' : 'Generar Reporte'}
          </Button>
          {report && (
            <Button variant="outline" onClick={exportExcel} className="gap-2 text-emerald-700 border-emerald-300">
              <Download className="w-4 h-4" />
              Exportar Excel
            </Button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Sin datos todavía ── */}
      {!report && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <TrendingUp className="w-12 h-12 opacity-30" />
          <p className="text-sm">Selecciona un rango de fechas y presiona "Generar Reporte"</p>
        </div>
      )}

      {/* ── Resultados ── */}
      {report && (
        <div className="space-y-5">

          {/* Info de cierre */}
          <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Generado el {format(new Date(report.period.generated_at), "dd/MM/yyyy 'a las' HH:mm")} (hora Lima).
              Los estados de pago reflejan el momento actual — para auditoría, exporta y guarda el PDF en la fecha de cierre.
            </span>
          </div>

          {/* ── Tarjetas de resumen ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard
              title="Total General"
              value={fmt(report.grand_total.total ?? (report.quiosco.total + report.comedor.total))}
              sub={`${report.quiosco.count + report.comedor.count} tickets`}
              color="bg-gradient-to-br from-slate-700 to-slate-900 text-white"
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <SummaryCard
              title="Quiosco"
              value={fmt(report.quiosco.total)}
              sub={`${report.quiosco.count} tickets · ${pct(report.quiosco.total, report.quiosco.total + report.comedor.total)} del total`}
              color="bg-gradient-to-br from-emerald-50 to-teal-50"
              icon={<Store className="w-5 h-5 text-emerald-600" />}
            />
            <SummaryCard
              title="Comedor"
              value={fmt(report.comedor.total)}
              sub={`${report.comedor.count} tickets · ${pct(report.comedor.total, report.quiosco.total + report.comedor.total)} del total`}
              color="bg-gradient-to-br from-amber-50 to-orange-50"
              icon={<UtensilsCrossed className="w-5 h-5 text-amber-600" />}
            />
          </div>

          {/* ── Estado de pagos ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatusCard label="Pagado" amount={report.grand_total.paid} icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} color="text-emerald-600" />
            <StatusCard label="Pendiente" amount={report.grand_total.pending} icon={<Clock className="w-4 h-4 text-amber-600" />} color="text-amber-600" />
            <StatusCard label="Anulado" amount={(report.quiosco.cancelled ?? 0) + (report.comedor.cancelled ?? 0)} icon={<Ban className="w-4 h-4 text-red-500" />} color="text-red-500" />
          </div>

          {/* ── Desglose por medio de pago ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PaymentTable title="Quiosco — Medios de pago" data={report.quiosco} />
            <PaymentTable title="Comedor — Medios de pago" data={report.comedor} />
          </div>

          {/* ── Tabla por día ── */}
          {report.by_day && report.by_day.length > 0 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50">
                <h4 className="text-sm font-semibold text-slate-700">Detalle por Día</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b">
                      <th className="text-left px-5 py-2.5">Fecha</th>
                      <th className="text-right px-4 py-2.5">Quiosco</th>
                      <th className="text-right px-4 py-2.5">Comedor</th>
                      <th className="text-right px-4 py-2.5">Total</th>
                      <th className="text-right px-5 py-2.5">Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_day.map((d, i) => (
                      <tr key={d.date} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="px-5 py-2.5 font-medium text-slate-700">
                          {format(new Date(d.date + 'T12:00:00'), 'EEEE dd/MM', { locale: undefined })}
                        </td>
                        <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(d.quiosco)}</td>
                        <td className="px-4 py-2.5 text-right text-amber-700">{fmt(d.comedor)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmt(d.total)}</td>
                        <td className="px-5 py-2.5 text-right text-slate-500">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-5 py-2.5 text-slate-700">TOTAL</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(report.quiosco.total)}</td>
                      <td className="px-4 py-2.5 text-right text-amber-700">{fmt(report.comedor.total)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(report.quiosco.total + report.comedor.total)}</td>
                      <td className="px-5 py-2.5 text-right text-slate-500">{report.quiosco.count + report.comedor.count}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── Por sede (solo si admin_general sin filtro) ── */}
          {report.by_school && report.by_school.length > 1 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50">
                <h4 className="text-sm font-semibold text-slate-700">Comparativa por Sede</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b">
                      <th className="text-left px-5 py-2.5">Sede</th>
                      <th className="text-right px-4 py-2.5">Quiosco</th>
                      <th className="text-right px-4 py-2.5">Comedor</th>
                      <th className="text-right px-4 py-2.5">Total</th>
                      <th className="text-right px-4 py-2.5">Pagado</th>
                      <th className="text-right px-5 py-2.5">Pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_school.map((s, i) => (
                      <tr key={s.school_name} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="px-5 py-2.5 font-medium text-slate-700">{s.school_name}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(s.quiosco)}</td>
                        <td className="px-4 py-2.5 text-right text-amber-700">{fmt(s.comedor)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmt(s.total)}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-600">{fmt(s.paid)}</td>
                        <td className="px-5 py-2.5 text-right text-amber-600">{fmt(s.pending)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function SummaryCard({ title, value, sub, color, icon }: {
  title: string; value: string; sub: string; color: string; icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl p-5 border ${color}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-semibold opacity-70">{title}</span>
      </div>
      <p className="text-2xl font-black mb-0.5">{value}</p>
      <p className="text-xs opacity-60">{sub}</p>
    </div>
  );
}

function StatusCard({ label, amount, icon, color }: {
  label: string; amount: number; icon: React.ReactNode; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        <p className={`text-lg font-bold ${color}`}>S/ {amount.toFixed(2)}</p>
      </div>
    </div>
  );
}

const PAYMENT_LABELS: { key: keyof PaymentBreakdown; label: string; color: string }[] = [
  { key: 'efectivo', label: 'Efectivo',   color: 'bg-green-100 text-green-700' },
  { key: 'digital',  label: 'Digital (Yape/Plin/Transfer)', color: 'bg-blue-100 text-blue-700' },
  { key: 'tarjeta',  label: 'Tarjeta',    color: 'bg-purple-100 text-purple-700' },
  { key: 'saldo',    label: 'Saldo',      color: 'bg-teal-100 text-teal-700' },
  { key: 'mixto',    label: 'Mixto',      color: 'bg-orange-100 text-orange-700' },
  { key: 'otro',     label: 'Otro',       color: 'bg-slate-100 text-slate-500' },
];

function PaymentTable({ title, data }: { title: string; data: PaymentBreakdown }) {
  const grandTotal = data.paid + data.pending;
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="px-5 py-3 border-b bg-slate-50">
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      </div>
      <div className="p-4 space-y-2">
        {PAYMENT_LABELS.map(({ key, label, color }) => {
          const amount = data[key] as number;
          if (amount === 0) return null;
          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>{label}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-400 rounded-full"
                    style={{ width: pct(amount, grandTotal) }}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-700 w-20 text-right">
                  S/ {amount.toFixed(2)}
                </span>
                <span className="text-xs text-slate-400 w-10 text-right">
                  {pct(amount, grandTotal)}
                </span>
              </div>
            </div>
          );
        })}
        {grandTotal === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">Sin ventas en este período</p>
        )}
      </div>
      <div className="px-5 py-2.5 border-t bg-slate-50 flex justify-between">
        <span className="text-xs font-semibold text-slate-500">Total ({data.count} tickets)</span>
        <span className="text-sm font-bold text-slate-800">S/ {grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
