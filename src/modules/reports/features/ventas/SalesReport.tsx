import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Download, Loader2, SearchX, ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ReportFilters, ISODateString } from '@/modules/reports/types';
import type { SalesRow, SalesColumnFilters } from './types';
import { EMPTY_COLUMN_FILTERS, PAYMENT_METHOD_OPTIONS, PAYMENT_STATUS_OPTIONS, PAGE_SIZE } from './types';

// ── Reducer ───────────────────────────────────────────────────────────────────
type FilterAction = { field: keyof SalesColumnFilters; value: string } | { type: 'reset' };
function filterReducer(state: SalesColumnFilters, action: FilterAction): SalesColumnFilters {
  if ('type' in action && action.type === 'reset') return EMPTY_COLUMN_FILTERS;
  if ('field' in action) return { ...state, [action.field]: action.value };
  return state;
}

// ── Helpers de presentación ───────────────────────────────────────────────────
const formatAmount = (n: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Math.abs(n));

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: '2-digit',
  }).format(new Date(iso));

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));

const toDateStr = (t: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(t));

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin',
  transferencia: 'Transferencia', tarjeta: 'Tarjeta', card: 'Tarjeta',
  mixto: 'Mixto', saldo: 'Saldo Cliente', saldo_billetera: 'Saldo Cliente', wallet: 'Saldo Cliente',
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  paid:      { label: 'Pagado',    color: 'bg-green-100 text-green-800 border-green-200' },
  completed: { label: 'Pagado',    color: 'bg-green-100 text-green-800 border-green-200' },
  pending:   { label: 'Pendiente', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  cancelled: { label: 'Anulado',   color: 'bg-red-100 text-red-800 border-red-200' },
  refunded:  { label: 'Anulado',   color: 'bg-red-100 text-red-800 border-red-200' },
  voided:    { label: 'Anulado',   color: 'bg-red-100 text-red-800 border-red-200' },
};
const getStatus = (s: string | null) =>
  PAYMENT_STATUS_CONFIG[s ?? ''] ?? { label: s ?? '—', color: 'bg-slate-100 text-slate-600 border-slate-200' };

const toOptionalFilter = (v: string): string | undefined => {
  const n = v.trim().toLowerCase();
  return n === '' || n === 'all' ? undefined : v.trim();
};

interface SupabaseLikeError { message?: string; details?: string; hint?: string; code?: string; }
const parseError = (e: unknown): string => {
  if (!e) return 'Error inesperado.';
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const err = e as SupabaseLikeError;
    if ((err.message ?? '').includes('REPORTS_ACCESS_DENIED')) return 'Sin acceso a este reporte.';
    if (err.code === 'PGRST202') return 'RPC no encontrado. Ejecuta las migraciones de reportes en tu base de datos.';
    return [err.message, err.details, err.hint].filter(Boolean).join(' | ') || String(e);
  }
  return String(e);
};

// ── Semana operativa Beto (epoch: lunes 29/12/2025) ──────────────────────────
// noon UTC para evitar problemas en bordes de zona horaria.
const BETO_EPOCH_MS = new Date('2025-12-29T12:00:00Z').getTime();
const MS_WEEK = 7 * 86_400_000;

function getBetoWeekNumber(dateStr: string): number {
  const t = new Date(`${dateStr}T12:00:00Z`).getTime();
  return Math.max(Math.floor((t - BETO_EPOCH_MS) / MS_WEEK) + 1, 1);
}

function getWeekRange(weekNum: number): { from: ISODateString; to: ISODateString } {
  const fromMs = BETO_EPOCH_MS + (weekNum - 1) * MS_WEEK;
  return {
    from: toDateStr(fromMs) as ISODateString,
    to:   toDateStr(fromMs + 6 * 86_400_000) as ISODateString,
  };
}

interface WeekOption { weekNum: number; label: string; }
function buildWeekOptions(): WeekOption[] {
  const todayStr = toDateStr(Date.now());
  const current = getBetoWeekNumber(todayStr);
  const options: WeekOption[] = [];
  const d = (s: string) => s.split('-').slice(1).join('/').replace('-', '/');
  for (let w = current; w >= Math.max(1, current - 25); w--) {
    const { from, to } = getWeekRange(w);
    options.push({ weekNum: w, label: `S${w}  ·  ${d(from)} – ${d(to)}` });
  }
  return options;
}

const WEEK_OPTIONS = buildWeekOptions();

// ── Tipos locales ─────────────────────────────────────────────────────────────
type TextFilters = Pick<SalesColumnFilters, 'ticketCode' | 'opCode' | 'paymentRef' | 'clientName' | 'sellerName'>;
const EMPTY_TEXT: TextFilters = { ticketCode: '', opCode: '', paymentRef: '', clientName: '', sellerName: '' };

// ── Componente ────────────────────────────────────────────────────────────────
interface Props { filters: ReportFilters; }

export function SalesReport({ filters }: Props) {
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [colFilters, dispatch] = useReducer(filterReducer, EMPTY_COLUMN_FILTERS);
  const [debouncedText, setDebouncedText] = useState<TextFilters>(EMPTY_TEXT);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fechas activas: semana tiene prioridad sobre el filtro global
  const activeDateFrom = selectedWeek ? getWeekRange(selectedWeek).from : filters.dateRange.from;
  const activeDateTo   = selectedWeek ? getWeekRange(selectedWeek).to   : filters.dateRange.to;

  // Debounce 500ms solo para inputs de texto
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedText({
        ticketCode: colFilters.ticketCode, opCode: colFilters.opCode,
        paymentRef: colFilters.paymentRef, clientName: colFilters.clientName,
        sellerName: colFilters.sellerName,
      });
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [colFilters.ticketCode, colFilters.opCode, colFilters.paymentRef, colFilters.clientName, colFilters.sellerName]);

  // RPC params — incluye todos los filtros activos
  const buildRpcParams = useCallback(
    (limit: number, offset: number) => ({
      p_school_id:      filters.effectiveSchoolId ?? undefined,
      p_date_from:      activeDateFrom,
      p_date_to:        activeDateTo,
      p_ticket_code:    toOptionalFilter(debouncedText.ticketCode),
      p_op_code:        toOptionalFilter(debouncedText.opCode),
      p_payment_ref:    toOptionalFilter(debouncedText.paymentRef),
      p_client_name:    toOptionalFilter(debouncedText.clientName),
      p_seller_name:    toOptionalFilter(debouncedText.sellerName),
      p_payment_method: toOptionalFilter(colFilters.paymentMethod),
      p_payment_status: toOptionalFilter(colFilters.paymentStatus),
      p_limit:          limit,
      p_offset:         offset,
    }),
    [filters.effectiveSchoolId, activeDateFrom, activeDateTo, debouncedText, colFilters.paymentMethod, colFilters.paymentStatus],
  );

  const fetchData = useCallback(
    async (currentPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = buildRpcParams(PAGE_SIZE, currentPage * PAGE_SIZE);
        const countParams = {
          p_school_id: params.p_school_id, p_date_from: params.p_date_from,
          p_date_to: params.p_date_to, p_ticket_code: params.p_ticket_code,
          p_op_code: params.p_op_code, p_payment_ref: params.p_payment_ref,
          p_client_name: params.p_client_name, p_seller_name: params.p_seller_name,
          p_payment_method: params.p_payment_method, p_payment_status: params.p_payment_status,
        };
        const [{ data, error: e1 }, { data: cnt, error: e2 }] = await Promise.all([
          supabase.rpc('get_sales_report', params),
          supabase.rpc('count_sales_report', countParams),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        setRows((data as SalesRow[]) ?? []);
        setTotal((cnt as number) ?? 0);
      } catch (e) {
        setError(parseError(e));
      } finally {
        setLoading(false);
      }
    },
    [buildRpcParams],
  );

  // Reset de página cuando cambia cualquier filtro
  useEffect(() => { setPage(0); }, [
    filters.effectiveSchoolId, activeDateFrom, activeDateTo,
    colFilters.paymentMethod, colFilters.paymentStatus,
    debouncedText.ticketCode, debouncedText.opCode, debouncedText.paymentRef,
    debouncedText.clientName, debouncedText.sellerName,
  ]);

  // Fetch cuando cambia página o filtros
  useEffect(() => { fetchData(page); }, [fetchData, page]);

  const goToPage = (p: number) => setPage(p);

  const handleClearFilters = () => {
    dispatch({ type: 'reset' });
    setDebouncedText(EMPTY_TEXT);
    setSelectedWeek(null);
    setPage(0);
  };

  // Export: mismos filtros activos + página actual
  const handleExport = async () => {
    setExporting(true);
    try {
      const { data, error: err } = await supabase.rpc('get_sales_report', buildRpcParams(PAGE_SIZE, page * PAGE_SIZE));
      if (err) throw err;
      const exportRows = (data as SalesRow[]) ?? [];
      const ws = XLSX.utils.json_to_sheet(
        exportRows.map((r) => ({
          'N° Operación': r.op_code,
          Ticket: r.ticket_code ?? '',
          'Ref. Pago (Yape/Plin)': r.payment_ref ?? '',
          Fecha: fmtDate(r.created_at),
          Hora: fmtTime(r.created_at),
          Semana: `S${r.week_number}`,
          Cliente: r.client_name,
          Vendedor: r.seller_name,
          'Monto (S/)': Math.abs(r.amount),
          Método: PAYMENT_METHOD_LABEL[(r.payment_method ?? '').toLowerCase()] ?? r.payment_method ?? '',
          Estado: getStatus(r.payment_status).label,
          Sede: r.school_name ?? '',
          Tipo: r.type,
          Descripción: r.description ?? '',
        })),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
      const weekTag = selectedWeek ? `_S${selectedWeek}` : '';
      XLSX.writeFile(wb, `ventas_${activeDateFrom}_${activeDateTo}${weekTag}_p${page + 1}.xlsx`);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* ── Selector de Semana operativa ─────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          Semana operativa
        </div>
        <Select
          value={selectedWeek ? String(selectedWeek) : 'none'}
          onValueChange={(v) => setSelectedWeek(v === 'none' ? null : Number(v))}
        >
          <SelectTrigger className="h-7 text-xs w-56">
            <SelectValue placeholder="— Usar rango de fechas —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Usar rango de fechas —</SelectItem>
            {WEEK_OPTIONS.map((o) => (
              <SelectItem key={o.weekNum} value={String(o.weekNum)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedWeek && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 border border-indigo-200 px-2 py-0.5 text-xs font-semibold text-indigo-800">
            S{selectedWeek} · {activeDateFrom} → {activeDateTo}
            <button onClick={() => setSelectedWeek(null)} className="ml-1 hover:text-indigo-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {selectedWeek && (
          <p className="text-xs text-muted-foreground">
            Los filtros globales de Fecha están pausados mientras hay semana activa.
          </p>
        )}
      </div>

      {/* ── Barra superior ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {loading ? 'Cargando…' : `${total.toLocaleString('es-PE')} registros`}
          </span>
          {total > 0 && (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              Pág. {page + 1}/{totalPages || 1}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleClearFilters} disabled={loading}>
            Limpiar filtros
          </Button>
          <Button
            variant="default" size="sm"
            onClick={handleExport}
            disabled={loading || exporting || total === 0}
            title="Exporta la página visible con los filtros activos"
          >
            {exporting
              ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
              : <Download className="h-4 w-4 mr-1" />
            }
            Exportar xlsx
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Tabla ─────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {([
                ['N° OP',    'text-left'],    ['Ticket',   'text-left'],
                ['Ref. Pago','text-left'],    ['Fecha',    'text-center'],
                ['Hora',     'text-center'],  ['S.',       'text-center'],
                ['Cliente',  'text-left'],    ['Vendedor', 'text-left'],
                ['Monto',    'text-right'],   ['Método',   'text-center'],
                ['Estado',   'text-center'],  ['Sede',     'text-left'],
              ] as [string, string][]).map(([label, align]) => (
                <th key={label} className={`px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap ${align}`}>
                  {label}
                </th>
              ))}
            </tr>

            {/* Fila de filtros por columna (estilo Excel) */}
            <tr className="border-b bg-muted/20">
              {/* OP */}
              <td className="px-2 py-1">
                <Input placeholder="OP-…" value={colFilters.opCode}
                  onChange={(e) => dispatch({ field: 'opCode', value: e.target.value })}
                  className="h-7 text-xs w-24" />
              </td>
              {/* Ticket */}
              <td className="px-2 py-1">
                <Input placeholder="T-…" value={colFilters.ticketCode}
                  onChange={(e) => dispatch({ field: 'ticketCode', value: e.target.value })}
                  className="h-7 text-xs w-28" />
              </td>
              {/* Ref Pago */}
              <td className="px-2 py-1">
                <Input placeholder="Ref…" value={colFilters.paymentRef}
                  onChange={(e) => dispatch({ field: 'paymentRef', value: e.target.value })}
                  className="h-7 text-xs w-24" />
              </td>
              {/* Fecha / Hora / S. sin filtro */}
              <td colSpan={3} />
              {/* Cliente */}
              <td className="px-2 py-1">
                <Input placeholder="Cliente…" value={colFilters.clientName}
                  onChange={(e) => dispatch({ field: 'clientName', value: e.target.value })}
                  className="h-7 text-xs w-32" />
              </td>
              {/* Vendedor */}
              <td className="px-2 py-1">
                <Input placeholder="Vendedor…" value={colFilters.sellerName}
                  onChange={(e) => dispatch({ field: 'sellerName', value: e.target.value })}
                  className="h-7 text-xs w-32" />
              </td>
              <td />
              {/* Método */}
              <td className="px-2 py-1">
                <Select
                  value={colFilters.paymentMethod === 'all' ? undefined : colFilters.paymentMethod}
                  onValueChange={(v) => dispatch({ field: 'paymentMethod', value: v })}
                >
                  <SelectTrigger className="h-7 text-xs w-28">
                    <SelectValue placeholder="Método" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              {/* Estado */}
              <td className="px-2 py-1">
                <Select
                  value={colFilters.paymentStatus === 'all' ? undefined : colFilters.paymentStatus}
                  onValueChange={(v) => dispatch({ field: 'paymentStatus', value: v })}
                >
                  <SelectTrigger className="h-7 text-xs w-28">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td />
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr><td colSpan={12} className="py-12 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin inline mr-2" />Consultando datos…
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={12} className="py-12 text-center text-muted-foreground">
                <SearchX className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>Sin resultados para los filtros seleccionados.</p>
              </td></tr>
            )}
            {!loading && rows.map((r) => {
              const st = getStatus(r.payment_status);
              const methodLabel = PAYMENT_METHOD_LABEL[(r.payment_method ?? '').toLowerCase()] ?? r.payment_method ?? '—';
              return (
                <tr key={r.id}
                  className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${r.is_deleted ? 'opacity-40 line-through' : ''}`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-primary whitespace-nowrap">{r.op_code}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.ticket_code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.payment_ref ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-center whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-center text-muted-foreground whitespace-nowrap">{fmtTime(r.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-center font-medium">S{r.week_number}</td>
                  <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={r.client_name}>{r.client_name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[120px] truncate" title={r.seller_name}>{r.seller_name}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{formatAmount(r.amount)}</td>
                  <td className="px-3 py-2 text-xs text-center">{methodLabel}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${st.color}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.school_name ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Paginación ────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => goToPage(page - 1)} disabled={page === 0 || loading}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1 || loading}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
