/**
 * ReporteItemizado — Reportes 3 y 4
 *
 * Pestaña "Ventas por Producto": JOIN transaction_items + transactions,
 * agrupado en servidor (RPC get_itemized_products_report).
 *
 * Pestaña "Kardex / Inventario": movimientos pos_stock_movements por producto
 * (ventas automáticas, ajustes de merma, entradas de compra).
 *
 * Todo agrupado en el servidor → cero riesgo de congelar el navegador.
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';
import {
  Package,
  RefreshCw,
  Download,
  Calendar,
  Loader2,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  WrenchIcon,
  BoxesIcon,
} from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface VentaProducto {
  product_id:     string | null;
  product_name:   string;
  qty_sold:       number;
  revenue:        number;
  avg_unit_price: number;
  min_price:      number;
  max_price:      number;
  ticket_count:   number;
}

interface KardexProducto {
  product_id:       string | null;
  product_name:     string;
  ventas_pos:       number;
  ajustes_manual:   number;
  entradas_compra:  number;
  net_delta:        number;
}

interface StockActual {
  product_id:    string;
  product_name:  string;
  current_stock: number;
  school_name:   string;
}

interface ReportData {
  period:       { from: string; to: string; generated_at: string };
  ventas:       VentaProducto[];
  kardex:       KardexProducto[];
  stock_actual: StockActual[];
}

interface Props {
  schoolId?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt  = (n: number) => `S/ ${n.toFixed(2)}`;
const BAR_COLORS = ['#0f766e','#0d9488','#14b8a6','#2dd4bf','#5eead4','#99f6e4','#ccfbf1','#f0fdfa'];

const PRESET_RANGES = [
  { label: 'Hoy',            from: () => format(new Date(), 'yyyy-MM-dd'),                to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Ayer',           from: () => format(subDays(new Date(), 1), 'yyyy-MM-dd'),    to: () => format(subDays(new Date(), 1), 'yyyy-MM-dd') },
  { label: 'Últimos 7 días', from: () => format(subDays(new Date(), 6), 'yyyy-MM-dd'),    to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Últimos 30 días',from: () => format(subDays(new Date(), 29), 'yyyy-MM-dd'),   to: () => format(new Date(), 'yyyy-MM-dd') },
  { label: 'Este mes',       from: () => format(startOfMonth(new Date()), 'yyyy-MM-dd'),  to: () => format(new Date(), 'yyyy-MM-dd') },
];

// ── Componente principal ───────────────────────────────────────────────────────

export function ReporteItemizado({ schoolId }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom]     = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [dateTo,   setDateTo]       = useState(today);
  const [loading,  setLoading]      = useState(false);
  const [error,    setError]        = useState<string | null>(null);
  const [report,   setReport]       = useState<ReportData | null>(null);
  const [activeTab, setActiveTab]   = useState<'ventas' | 'kardex' | 'stock'>('ventas');
  const [activePreset, setPreset]   = useState(2);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_itemized_products_report', {
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
    setPreset(idx);
    setDateFrom(PRESET_RANGES[idx].from());
    setDateTo(PRESET_RANGES[idx].to());
  };

  const exportExcel = () => {
    if (!report) return;
    const wb = XLSX.utils.book_new();

    // ── Sheet: Sales by Product ────────────────────────────────────────────
    if (report.ventas && report.ventas.length > 0) {
      const headers = ['Rank', 'Product', 'Qty Sold', 'Revenue (S/)', 'Avg Price (S/)', 'Min Price (S/)', 'Max Price (S/)', 'Tickets'];
      const rows = [
        headers,
        ...report.ventas.map((v, i) => [
          i + 1,
          v.product_name,
          v.qty_sold,
          v.revenue,
          v.avg_unit_price,
          v.min_price,
          v.max_price,
          v.ticket_count,
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 34 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
      ws['!autofilter'] = { ref: `A1:H${rows.length}` };
      XLSX.utils.book_append_sheet(wb, ws, 'Sales by Product');
    }

    // ── Sheet: Kardex ──────────────────────────────────────────────────────
    if (report.kardex && report.kardex.length > 0) {
      const headers = ['Product', 'POS Sales (qty)', 'Manual Adjustments', 'Purchase Entries', 'Net Delta'];
      const rows = [
        headers,
        ...report.kardex.map(k => [
          k.product_name,
          -Math.abs(k.ventas_pos),
          k.ajustes_manual,
          k.entradas_compra,
          k.net_delta,
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 12 }];
      ws['!autofilter'] = { ref: `A1:E${rows.length}` };
      XLSX.utils.book_append_sheet(wb, ws, 'Kardex');
    }

    // ── Sheet: Current Stock ──────────────────────────────────────────────
    if (report.stock_actual && report.stock_actual.length > 0) {
      const headers = ['Product', 'School / Location', 'Current Stock', 'Status'];
      const rows = [
        headers,
        ...report.stock_actual.map(s => [
          s.product_name,
          s.school_name,
          s.current_stock,
          s.current_stock <= 5 ? 'LOW' : s.current_stock <= 15 ? 'MEDIUM' : 'OK',
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 34 }, { wch: 26 }, { wch: 14 }, { wch: 10 }];
      ws['!autofilter'] = { ref: `A1:D${rows.length}` };
      XLSX.utils.book_append_sheet(wb, ws, 'Current Stock');
    }

    XLSX.writeFile(wb, `itemized_report_${dateFrom}_${dateTo}.xlsx`);
  };

  // ── Top 10 para el gráfico ─────────────────────────────────────────────────
  const chartData = (report?.ventas ?? []).slice(0, 10).map(v => ({
    name:    v.product_name.length > 16 ? v.product_name.slice(0, 15) + '…' : v.product_name,
    revenue: v.revenue,
    qty:     v.qty_sold,
  })).reverse();

  return (
    <div className="space-y-5">

      {/* ── Filtros ── */}
      <div className="bg-white rounded-2xl border p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESET_RANGES.map((p, i) => (
            <button
              key={p.label}
              onClick={() => applyPreset(i)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors
                ${activePreset === i ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Desde</label>
            <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-slate-50">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date" value={dateFrom} max={dateTo}
                onChange={e => { setDateFrom(e.target.value); setPreset(-1); }}
                className="text-sm bg-transparent outline-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Hasta</label>
            <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-slate-50">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date" value={dateTo} min={dateFrom} max={today}
                onChange={e => { setDateTo(e.target.value); setPreset(-1); }}
                className="text-sm bg-transparent outline-none"
              />
            </div>
          </div>
          <Button onClick={fetchReport} disabled={loading} className="bg-slate-800 hover:bg-slate-700 text-white gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Cargando...' : 'Generar Reporte'}
          </Button>
          {report && (
            <Button variant="outline" onClick={exportExcel} className="gap-2 text-teal-700 border-teal-300">
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

      {/* ── Vacío ── */}
      {!report && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <Package className="w-12 h-12 opacity-30" />
          <p className="text-sm">Selecciona un rango y presiona "Generar Reporte"</p>
        </div>
      )}

      {/* ── Resultados ── */}
      {report && (
        <div className="space-y-5">

          {/* Sub-tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            {([
              { id: 'ventas', label: 'Ventas por Producto', icon: <ArrowDownCircle className="w-3.5 h-3.5" /> },
              { id: 'kardex', label: 'Kardex / Movimientos', icon: <WrenchIcon className="w-3.5 h-3.5" /> },
              { id: 'stock',  label: 'Stock Actual', icon: <BoxesIcon className="w-3.5 h-3.5" /> },
            ] as { id: typeof activeTab; label: string; icon: React.ReactNode }[]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                  ${activeTab === tab.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* ──────────── PESTAÑA: VENTAS POR PRODUCTO ──────────── */}
          {activeTab === 'ventas' && (
            <div className="space-y-4">

              {/* Totales rápidos */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <QuickStat label="Productos distintos"
                  value={(report.ventas?.length ?? 0).toString()} />
                <QuickStat label="Unidades vendidas"
                  value={(report.ventas?.reduce((s, v) => s + v.qty_sold, 0) ?? 0).toString()} />
                <QuickStat label="Revenue total"
                  value={fmt(report.ventas?.reduce((s, v) => s + v.revenue, 0) ?? 0)} />
                <QuickStat label="Producto top"
                  value={report.ventas?.[0]?.product_name?.slice(0, 18) ?? '—'} small />
              </div>

              {/* Gráfico horizontal Top 10 */}
              {chartData.length > 0 && (
                <div className="bg-white rounded-2xl border p-5">
                  <h4 className="text-sm font-semibold text-slate-700 mb-4">
                    Top {Math.min(10, report.ventas?.length ?? 0)} productos por revenue
                  </h4>
                  <ResponsiveContainer width="100%" height={chartData.length * 36 + 40}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 60 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `S/${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip
                        formatter={(v: number) => [`S/ ${v.toFixed(2)}`, 'Revenue']}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Tabla completa */}
              <div className="bg-white rounded-2xl border overflow-hidden">
                <div className="px-5 py-3 border-b bg-slate-50">
                  <h4 className="text-sm font-semibold text-slate-700">
                    Detalle completo — {report.ventas?.length ?? 0} productos
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b bg-slate-50/50">
                        <th className="text-left px-5 py-2.5">#</th>
                        <th className="text-left px-4 py-2.5">Producto</th>
                        <th className="text-right px-4 py-2.5">Cant.</th>
                        <th className="text-right px-4 py-2.5">Revenue</th>
                        <th className="text-right px-4 py-2.5">P. Prom.</th>
                        <th className="text-right px-4 py-2.5">P. Mín.</th>
                        <th className="text-right px-5 py-2.5">Tickets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.ventas ?? []).map((v, i) => (
                        <tr key={v.product_name} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                          <td className="px-5 py-2 text-xs text-slate-400 font-bold">{i + 1}</td>
                          <td className="px-4 py-2 font-medium text-slate-700 max-w-[220px] truncate">{v.product_name}</td>
                          <td className="px-4 py-2 text-right font-semibold text-teal-700">{v.qty_sold}</td>
                          <td className="px-4 py-2 text-right font-bold text-slate-800">{fmt(v.revenue)}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{fmt(v.avg_unit_price)}</td>
                          <td className="px-4 py-2 text-right text-slate-400">{fmt(v.min_price)}</td>
                          <td className="px-5 py-2 text-right text-slate-500">{v.ticket_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ──────────── PESTAÑA: KARDEX ──────────── */}
          {activeTab === 'kardex' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <QuickStat label="Productos con movimiento"
                  value={(report.kardex?.length ?? 0).toString()} />
                <QuickStat label="Total salidas (ventas POS)"
                  value={(report.kardex?.reduce((s, k) => s + k.ventas_pos, 0) ?? 0).toString()} />
                <QuickStat label="Ajustes / Merma"
                  value={(report.kardex?.reduce((s, k) => s + Math.abs(k.ajustes_manual), 0) ?? 0).toString()} />
              </div>

              <div className="bg-white rounded-2xl border overflow-hidden">
                <div className="px-5 py-3 border-b bg-slate-50 flex items-center gap-2">
                  <WrenchIcon className="w-4 h-4 text-slate-500" />
                  <h4 className="text-sm font-semibold text-slate-700">Kardex POS — Movimientos por Producto</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b bg-slate-50/50">
                        <th className="text-left px-5 py-2.5">Producto</th>
                        <th className="text-right px-4 py-2.5 text-rose-500">
                          <div className="flex items-center justify-end gap-1">
                            <ArrowDownCircle className="w-3 h-3" />
                            Ventas POS
                          </div>
                        </th>
                        <th className="text-right px-4 py-2.5 text-amber-600">
                          <div className="flex items-center justify-end gap-1">
                            <WrenchIcon className="w-3 h-3" />
                            Ajuste/Merma
                          </div>
                        </th>
                        <th className="text-right px-4 py-2.5 text-emerald-600">
                          <div className="flex items-center justify-end gap-1">
                            <ArrowUpCircle className="w-3 h-3" />
                            Entrada
                          </div>
                        </th>
                        <th className="text-right px-5 py-2.5 font-bold">Delta Neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.kardex ?? []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-slate-400 text-sm">
                            No hay movimientos de kardex en este período
                          </td>
                        </tr>
                      )}
                      {(report.kardex ?? []).map((k, i) => (
                        <tr key={k.product_name} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                          <td className="px-5 py-2 font-medium text-slate-700 max-w-[220px] truncate">{k.product_name}</td>
                          <td className="px-4 py-2 text-right text-rose-600 font-semibold">−{k.ventas_pos}</td>
                          <td className="px-4 py-2 text-right text-amber-600">
                            {k.ajustes_manual >= 0 ? '+' : ''}{k.ajustes_manual}
                          </td>
                          <td className="px-4 py-2 text-right text-emerald-600">+{k.entradas_compra}</td>
                          <td className={`px-5 py-2 text-right font-bold ${k.net_delta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {k.net_delta >= 0 ? '+' : ''}{k.net_delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-xs text-slate-400 px-1">
                <strong>Ventas POS</strong>: bajas automáticas cuando se procesa una venta en caja.
                <strong> Ajuste/Merma</strong>: correcciones manuales de stock (merma, pérdida, error de conteo).
                <strong> Entrada</strong>: reposición registrada desde módulo de Logística.
              </p>
            </div>
          )}

          {/* ──────────── PESTAÑA: STOCK ACTUAL ──────────── */}
          {activeTab === 'stock' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-700 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  El stock mostrado aquí es el <strong>actual en tiempo real</strong>, no el del período seleccionado.
                  Úsalo como referencia del estado actual del inventario.
                </span>
              </div>

              <div className="bg-white rounded-2xl border overflow-hidden">
                <div className="px-5 py-3 border-b bg-slate-50 flex items-center gap-2">
                  <BoxesIcon className="w-4 h-4 text-slate-500" />
                  <h4 className="text-sm font-semibold text-slate-700">
                    Stock actual — {report.stock_actual?.length ?? 0} productos
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b bg-slate-50/50">
                        <th className="text-left px-5 py-2.5">Producto</th>
                        <th className="text-left px-4 py-2.5">Sede</th>
                        <th className="text-right px-5 py-2.5">Stock Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.stock_actual ?? []).length === 0 && (
                        <tr>
                          <td colSpan={3} className="text-center py-8 text-slate-400 text-sm">
                            No hay datos de stock registrados
                          </td>
                        </tr>
                      )}
                      {(report.stock_actual ?? []).map((s, i) => (
                        <tr key={`${s.product_id}-${s.school_name}`} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                          <td className="px-5 py-2 font-medium text-slate-700 max-w-[220px] truncate">{s.product_name}</td>
                          <td className="px-4 py-2 text-slate-500">{s.school_name}</td>
                          <td className={`px-5 py-2 text-right font-bold text-lg
                            ${s.current_stock <= 5 ? 'text-red-600' : s.current_stock <= 15 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {s.current_stock}
                            {s.current_stock <= 5 && (
                              <span className="ml-1 text-xs font-normal text-red-500">⚠ bajo</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Sub-componente ─────────────────────────────────────────────────────────────

function QuickStat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`font-bold text-slate-800 ${small ? 'text-sm' : 'text-xl'} truncate`}>{value}</p>
    </div>
  );
}
