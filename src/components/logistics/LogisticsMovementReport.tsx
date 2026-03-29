import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Search, Download, Printer, Trophy, PackageOpen,
  CalendarRange, Building2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ReportRow {
  productName: string;
  schoolName:  string;
  schoolId:    string;
  qtySold:     number;
}

interface School { id: string; name: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Últimos 7 días como rango por defecto */
function defaultDates(): { start: string; end: string } {
  const now  = new Date();
  const end  = now.toISOString().slice(0, 10);
  const s    = new Date(now);
  s.setDate(s.getDate() - 6);
  const start = s.toISOString().slice(0, 10);
  return { start, end };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Convierte un YYYY-MM-DD en el inicio del día UTC para Lima (UTC−5: día empieza 05:00 UTC) */
function toUTCStart(date: string): string {
  return `${date}T05:00:00.000Z`;
}

/** Convierte un YYYY-MM-DD en el fin del día UTC para Lima (día termina 04:59:59 del día siguiente) */
function toUTCEnd(date: string): string {
  const d = new Date(`${date}T05:00:00.000Z`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Exporta un array de filas a un archivo CSV */
function exportCSV(rows: ReportRow[], start: string, end: string) {
  const header = 'Producto,Sede,Cantidad Vendida\n';
  const lines  = rows.map(r =>
    `"${r.productName.replace(/"/g, '""')}","${r.schoolName.replace(/"/g, '""')}",${r.qtySold}`
  );
  const csv    = header + lines.join('\n');
  const blob   = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `reporte-salidas-${start}_${end}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function LogisticsMovementReport() {
  const { toast } = useToast();

  const def = defaultDates();
  const [startDate,    setStartDate]    = useState(def.start);
  const [endDate,      setEndDate]      = useState(def.end);
  const [schools,      setSchools]      = useState<School[]>([]);
  const [selectedSede, setSelectedSede] = useState<string>('all');
  const [schoolsLoaded, setSchoolsLoaded] = useState(false);

  const [loading,   setLoading]   = useState(false);
  const [rows,      setRows]      = useState<ReportRow[] | null>(null);
  const [rangeLabel, setRangeLabel] = useState('');

  // Carga sedes la primera vez que se monta (solo lectura ligera)
  const loadSchools = useCallback(async () => {
    if (schoolsLoaded) return;
    const { data } = await supabase.from('schools').select('id, name').eq('is_active', true).order('name');
    setSchools(data || []);
    setSchoolsLoaded(true);
  }, [schoolsLoaded]);

  // Cargar sedes al montar
  useState(() => { loadSchools(); });

  // ── Query principal — SOLO se ejecuta al hacer clic en "Generar Reporte" ──

  /** Límite máximo del rango — Vector 4 QA: evitar colapso de memoria */
  const MAX_DAYS = 90;

  const generateReport = useCallback(async () => {
    if (!startDate || !endDate) {
      toast({ variant: 'destructive', title: 'Fechas requeridas', description: 'Selecciona Fecha Inicio y Fecha Fin.' });
      return;
    }
    if (startDate > endDate) {
      toast({ variant: 'destructive', title: 'Rango inválido', description: 'Fecha Inicio no puede ser mayor que Fecha Fin.' });
      return;
    }

    // Vector 4 QA: guardia de rango máximo
    const diffDays = Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000
    );
    if (diffDays > MAX_DAYS) {
      toast({
        variant: 'destructive',
        title: `Rango muy largo (${diffDays} días)`,
        description: `El máximo permitido es ${MAX_DAYS} días para evitar lentitud. Divide el período en tramos más pequeños.`,
        duration: 6000,
      });
      return;
    }

    setLoading(true);
    setRows(null);
    try {
      const gteUTC = toUTCStart(startDate);
      const ltUTC  = toUTCEnd(endDate);

      // Vector 2 + 4 QA: la agregación ocurre en la BD (GROUP BY via RPC).
      // El RPC ya excluye transacciones con payment_status = 'cancelled'.
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'report_stock_movement',
        {
          p_start_utc: gteUTC,
          p_end_utc:   ltUTC,
          p_school_id: selectedSede !== 'all' ? selectedSede : null,
        }
      );

      if (rpcErr) {
        // Fallback al método original si el RPC aún no fue desplegado en BD
        console.warn('[Report] RPC not found, falling back to client-side aggregation:', rpcErr.message);
        await generateReportFallback(gteUTC, ltUTC);
        return;
      }

      const result: ReportRow[] = (rpcData || []).map((r: any) => ({
        productName: r.product_name,
        schoolName:  r.school_name,
        schoolId:    r.school_id,
        qtySold:     Number(r.qty_sold),
      }));

      setRows(result);
      setRangeLabel(`${formatDate(startDate)} → ${formatDate(endDate)}`);
    } catch (err: any) {
      console.error('[Report] error:', err);
      toast({ variant: 'destructive', title: 'Error generando reporte', description: err.message });
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedSede, toast]);

  /** Fallback client-side (usado solo si el RPC aún no está en BD) */
  const generateReportFallback = useCallback(async (gteUTC: string, ltUTC: string) => {
    let txQuery = supabase
      .from('transactions')
      .select('id, school_id')
      .eq('type', 'purchase')
      .neq('payment_status', 'cancelled')   // Vector 2 QA
      .gte('created_at', gteUTC)
      .lt('created_at', ltUTC);
    if (selectedSede !== 'all') txQuery = txQuery.eq('school_id', selectedSede);
    const { data: txs, error: txErr } = await txQuery;
    if (txErr) throw txErr;

    if (!txs || txs.length === 0) {
      setRows([]);
      return;
    }

    const txIds        = txs.map(t => t.id);
    const schoolByTx   = new Map(txs.map(t => [t.id, t.school_id as string]));
    const allSchoolIds = [...new Set(txs.map(t => t.school_id).filter(Boolean) as string[])];

    const BATCH = 200;
    let allItems: { transaction_id: string; product_name: string; quantity: number }[] = [];
    for (let i = 0; i < txIds.length; i += BATCH) {
      const { data: batchItems, error: bErr } = await supabase
        .from('transaction_items')
        .select('transaction_id, product_name, quantity')
        .in('transaction_id', txIds.slice(i, i + BATCH));
      if (bErr) throw bErr;
      allItems = allItems.concat(batchItems || []);
    }

    const { data: schoolsData } = await supabase
      .from('schools').select('id, name').in('id', allSchoolIds);
    const sMap = new Map((schoolsData || []).map(s => [s.id, s.name]));

    const grouped = new Map<string, ReportRow>();
    for (const item of allItems) {
      const schoolId = schoolByTx.get(item.transaction_id) || '';
      const key = `${item.product_name}__${schoolId}`;
      if (!grouped.has(key)) {
        grouped.set(key, { productName: item.product_name, schoolName: sMap.get(schoolId) || '—', schoolId, qtySold: 0 });
      }
      grouped.get(key)!.qtySold += item.quantity;
    }

    const result = [...grouped.values()].sort((a, b) => b.qtySold - a.qtySold);
    setRows(result);
    setRangeLabel(`${formatDate(startDate)} → ${formatDate(endDate)}`);
  }, [selectedSede, startDate, endDate]);

  // ── Derivados ────────────────────────────────────────────────────────────────

  const totalUnits    = rows?.reduce((s, r) => s + r.qtySold, 0) ?? 0;
  const topProduct    = rows?.[0] ?? null;
  const hasResults    = rows !== null && rows.length > 0;

  // ── Imprimir ─────────────────────────────────────────────────────────────────

  const handlePrint = () => window.print();

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Cabecera ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-blue-600" />
            Reportes de Salidas
          </h2>
          <p className="text-[11px] text-slate-400">
            Genera reportes históricos de mercadería vendida por rango de fechas.
          </p>
        </div>
      </div>

      {/* ── Panel de filtros ── */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Filtros del Reporte</p>
          <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            Máximo 90 días por consulta
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Fecha inicio */}
          <div className="space-y-1.5">
            <Label htmlFor="start-date" className="text-xs font-medium text-slate-600">
              Fecha Inicio
            </Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Fecha fin */}
          <div className="space-y-1.5">
            <Label htmlFor="end-date" className="text-xs font-medium text-slate-600">
              Fecha Fin
            </Label>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Sede */}
          <div className="space-y-1.5">
            <Label htmlFor="sede" className="text-xs font-medium text-slate-600">
              <Building2 className="inline h-3 w-3 mr-1 text-slate-400" />
              Sede
            </Label>
            <select
              id="sede"
              value={selectedSede}
              onChange={e => setSelectedSede(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">Todas las sedes</option>
              {schools.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Botón generar */}
          <div className="flex items-end">
            <Button
              onClick={generateReport}
              disabled={loading}
              className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white gap-2 font-semibold"
            >
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Generando…</>
                : <><Search className="h-4 w-4" /> Generar Reporte</>
              }
            </Button>
          </div>
        </div>

        {/* Accesos rápidos de rango */}
        <div className="flex flex-wrap gap-2 pt-1">
          <p className="text-[10px] text-slate-400 self-center mr-1">Acceso rápido:</p>
          {[
            { label: 'Hoy',        days: 0  },
            { label: 'Últimos 7d', days: 6  },
            { label: 'Últimos 30d', days: 29 },
            { label: 'Este mes',   days: -1 },
          ].map(({ label, days }) => (
            <button
              key={label}
              onClick={() => {
                const now = new Date();
                const end = now.toISOString().slice(0, 10);
                let start: string;
                if (days === -1) {
                  start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                } else {
                  const s = new Date(now);
                  s.setDate(s.getDate() - days);
                  start = s.toISOString().slice(0, 10);
                }
                setStartDate(start);
                setEndDate(end);
              }}
              className="text-[10px] px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-500 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Estado inicial (sin buscar aún) ── */}
      {rows === null && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
          <Search className="h-10 w-10 text-slate-200" />
          <p className="text-sm font-medium">Selecciona un rango y haz clic en <strong>Generar Reporte</strong></p>
          <p className="text-xs text-slate-300">Los datos se cargarán solo cuando lo solicites.</p>
        </div>
      )}

      {/* ── Cargando ── */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
          <span className="text-sm">Procesando datos del período seleccionado…</span>
        </div>
      )}

      {/* ── Sin resultados ── */}
      {!loading && rows !== null && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
          <PackageOpen className="h-10 w-10 text-slate-200" />
          <p className="text-sm font-medium">Sin ventas en el rango {rangeLabel}</p>
          <p className="text-xs text-slate-300">Prueba ampliar el rango de fechas o cambiar la sede.</p>
        </div>
      )}

      {/* ── Resultados ── */}
      {!loading && hasResults && (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

            <div className="bg-blue-600 text-white rounded-xl p-4">
              <p className="text-[10px] font-semibold text-blue-100 uppercase tracking-wide mb-1">Total Unidades</p>
              <p className="font-black text-3xl">{totalUnits.toLocaleString()}</p>
              <p className="text-[11px] text-blue-200 mt-0.5">vendidas en el período</p>
            </div>

            <div className="bg-emerald-600 text-white rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Trophy className="h-4 w-4 text-yellow-300" />
                <p className="text-[10px] font-semibold text-emerald-100 uppercase tracking-wide">Producto Estrella</p>
              </div>
              <p className="font-black text-sm sm:text-base leading-tight line-clamp-2">{topProduct?.productName}</p>
              <p className="text-[11px] text-emerald-200 mt-0.5">{topProduct?.qtySold} unidades · {topProduct?.schoolName}</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 col-span-2 sm:col-span-1">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Período</p>
              <p className="font-bold text-slate-800 text-sm">{rangeLabel}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {rows.length} combinaciones producto×sede
              </p>
            </div>
          </div>

          {/* Barra de acciones */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-500">
              Mostrando <strong>{rows.length}</strong> registros · ordenados por cantidad desc.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportCSV(rows!, startDate, endDate)}
                className="gap-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handlePrint}
                className="gap-1.5 text-xs"
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRows(null)}
                className="gap-1 text-xs text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
                Limpiar
              </Button>
            </div>
          </div>

          {/* Tabla de resultados */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print:border-0">
            {/* Título visible al imprimir */}
            <div className="hidden print:block px-4 py-3 border-b">
              <p className="font-bold text-base">Reporte de Salidas — {rangeLabel}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[460px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 w-8">#</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Producto</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Sede</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Cantidad Vendida</th>
                    {/* Barra visual de proporción */}
                    <th className="text-left px-4 py-3 font-semibold text-slate-400 hidden sm:table-cell">Proporción</th>
                  </tr>
                </thead>
                <tbody>
                  {rows!.map((row, i) => {
                    const pct = totalUnits > 0 ? (row.qtySold / totalUnits) * 100 : 0;
                    const isTop = i === 0;
                    return (
                      <tr
                        key={`${row.productName}__${row.schoolId}__${i}`}
                        className={`border-b border-slate-50 transition-colors hover:bg-slate-50 ${isTop ? 'bg-emerald-50/50' : ''}`}
                      >
                        <td className="px-4 py-2.5 text-slate-400 font-mono">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {isTop && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">
                                🥇 Top
                              </span>
                            )}
                            <span className="font-medium text-slate-800 truncate max-w-[220px]" title={row.productName}>
                              {row.productName}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 truncate max-w-[160px]" title={row.schoolName}>
                          {row.schoolName}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-black text-blue-700 text-sm">{row.qtySold}</span>
                          <span className="text-slate-400 ml-0.5 text-[10px]">un.</span>
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5 min-w-[60px]">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${Math.max(pct, 1)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-400 w-8 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                    <td colSpan={3} className="px-4 py-2.5 text-xs text-slate-600">Total</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="font-black text-blue-700 text-sm">{totalUnits.toLocaleString()}</span>
                      <span className="text-slate-400 ml-0.5 text-[10px]">un.</span>
                    </td>
                    <td className="hidden sm:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Estilos solo para impresión */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print\\:border-0, .print\\:border-0 * { visibility: visible; }
          .print\\:block { display: block !important; }
          table { width: 100%; }
        }
      `}</style>
    </div>
  );
}
