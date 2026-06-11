import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Download, Loader2, SearchX,
  ChevronLeft, ChevronRight,
  CalendarDays, X,
  CheckCircle2, XCircle,
  Maximize2, Info,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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

// Fecha de pago: solo se muestra cuando hay pago real. Pendiente = sin fecha de pago.
const fmtPaymentDate = (iso: string, status: string | null): string =>
  status === 'pending' ? '—' : fmtDate(iso);

const fmtPaymentTime = (iso: string, status: string | null): string =>
  status === 'pending' ? '—' : fmtTime(iso);

const toDateStr = (t: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(t));

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin',
  transferencia: 'Transferencia', tarjeta: 'Tarjeta', card: 'Tarjeta',
  mixto: 'Mixto',
  saldo: 'Crédito', saldo_billetera: 'Crédito', wallet: 'Crédito',
  credito: 'Crédito', debt: 'Crédito',
};

const getMethodLabel = (method: string | null | undefined, status: string | null | undefined): string => {
  if (!method) return status === 'pending' ? 'Crédito' : '—';
  return PAYMENT_METHOD_LABEL[method.toLowerCase()] ?? method;
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

// ── Semana operativa (epoch: lunes 29/12/2025) ────────────────────────────────
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

const SALES_HEADER_DEFINITIONS: Record<string, string> = {
  'N° OP': 'Número de Operación interno del sistema (correlativo único).',
  'Ticket': 'Código de comprobante impreso (ej. T-AN...).',
  'S.': 'Semana operativa del sistema (S + número).',
  'Cliente': 'Titular de la venta. VSC significa Venta Sin Crédito (al contado).',
  'Vendedor': 'Usuario del sistema que registró la operación.',
  'Monto': 'Valor total de la transacción en Soles (S/).',
  'Método': 'Medio de pago utilizado (Yape, Efectivo, Saldo, etc.).',
  'Ref. Pago': 'Código de confirmación digital (Yape, Plin, ID Pasarela).',
  'Fecha': 'Fecha de pago de la operación en horario de Lima.',
  'Hora': 'Hora de pago de la operación en horario de Lima.',
  'Estado': 'Situación actual: Pagado (caja cerrada), Pendiente (deuda), Anulado.',
  'Sede': 'Punto físico o virtual donde se realizó la venta.',
};

interface HeaderTooltipProps {
  content: string;
}

function HeaderTooltip({ content }: HeaderTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          aria-label="Información de la columna"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="max-w-64 text-xs leading-snug">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

// ── ExpandableCell ────────────────────────────────────────────────────────────
// Trunca visualmente. Si el texto supera maxChars, muestra un botón expandible.
// El componente padre mantiene UN solo Dialog activo (no instancias por fila).
interface ExpandableCellProps {
  value: string;
  label: string;
  onExpand: (label: string, value: string) => void;
  maxChars?: number;
  className?: string;
}

function ExpandableCell({ value, label, onExpand, maxChars = 22, className = '' }: ExpandableCellProps) {
  if (!value || value === '—') {
    return <span className="text-muted-foreground">—</span>;
  }
  if (value.length <= maxChars) {
    return <span className={`block truncate ${className}`} title={value}>{value}</span>;
  }
  return (
    <button
      type="button"
      title="Clic para ver texto completo"
      onClick={() => onExpand(label, value)}
      className={`group flex items-center gap-1 w-full text-left truncate hover:text-primary transition-colors ${className}`}
    >
      <span className="truncate flex-1">{value}</span>
      <Maximize2 className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}

// ── Tipos locales ─────────────────────────────────────────────────────────────
type TextFilters = Pick<SalesColumnFilters, 'ticketCode' | 'opCode' | 'paymentRef' | 'clientName' | 'sellerName'>;
const EMPTY_TEXT: TextFilters = { ticketCode: '', opCode: '', paymentRef: '', clientName: '', sellerName: '' };
type ExportState = 'idle' | 'fetching' | 'generating' | 'success' | 'error';
const EXPORT_CHUNK_SIZE = 1000;
const SUCCESS_OVERLAY_MS = 1800;
const COL_COUNT = 12;

// ── Componente ────────────────────────────────────────────────────────────────
interface Props { filters: ReportFilters; }

export function SalesReport({ filters }: Props) {
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [fetchedRowCount, setFetchedRowCount] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  const [colFilters, dispatch] = useReducer(filterReducer, EMPTY_COLUMN_FILTERS);
  const [debouncedText, setDebouncedText] = useState<TextFilters>(EMPTY_TEXT);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  // Estado del dialog de celda expandida — UN solo dialog para toda la tabla.
  const [expandedCell, setExpandedCell] = useState<{ label: string; value: string } | null>(null);
  const handleExpand = useCallback((label: string, value: string) => setExpandedCell({ label, value }), []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDateFrom = selectedWeek ? getWeekRange(selectedWeek).from : filters.dateRange.from;
  const activeDateTo   = selectedWeek ? getWeekRange(selectedWeek).to   : filters.dateRange.to;

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

  const buildRpcBaseParams = useCallback(
    () => ({
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
    }),
    [filters.effectiveSchoolId, activeDateFrom, activeDateTo, debouncedText, colFilters.paymentMethod, colFilters.paymentStatus],
  );

  const buildRpcParams = useCallback(
    (limit: number, offset: number) => ({ ...buildRpcBaseParams(), p_limit: limit, p_offset: offset }),
    [buildRpcBaseParams],
  );

  const fetchData = useCallback(
    async (currentPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const [{ data, error: e1 }, { data: cnt, error: e2 }] = await Promise.all([
          supabase.rpc('get_sales_report', buildRpcParams(PAGE_SIZE, currentPage * PAGE_SIZE)),
          supabase.rpc('count_sales_report', buildRpcBaseParams()),
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
    [buildRpcParams, buildRpcBaseParams],
  );

  useEffect(() => { setPage(0); }, [
    filters.effectiveSchoolId, activeDateFrom, activeDateTo,
    colFilters.paymentMethod, colFilters.paymentStatus,
    debouncedText.ticketCode, debouncedText.opCode, debouncedText.paymentRef,
    debouncedText.clientName, debouncedText.sellerName,
  ]);

  useEffect(() => { fetchData(page); }, [fetchData, page]);

  const handleClearFilters = () => {
    dispatch({ type: 'reset' });
    setDebouncedText(EMPTY_TEXT);
    setSelectedWeek(null);
    setPage(0);
  };

  // ── Export ────────────────────────────────────────────────────────────────
  // Columnas en el MISMO orden que la tabla UI.
  // El texto siempre sale COMPLETO en Excel (sin truncate).
  const handleExport = async () => {
    let completed = false;
    setError(null);
    setExportError(null);
    setFetchedRowCount(0);
    setExportState('fetching');
    try {
      const TYPE_EXPORT_LABEL: Record<string, string> = {
        purchase: 'Venta',
        recharge: 'Recarga',
      };
      const toTitleCase = (value: string): string =>
        value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : '—';
      const normalizeTypeForExport = (value: string | null | undefined): string => {
        const key = (value ?? '').trim().toLowerCase();
        if (!key) return '—';
        return TYPE_EXPORT_LABEL[key] ?? toTitleCase(key);
      };
      const stripTrailingDateSuffix = (value: string): string =>
        value
          .replace(/\s*-\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo)\b.*$/i, '')
          .replace(/\s*-\s*\d{1,2}\s+de\s+[a-záéíóúñ]+(?:\s+de\s+\d{4})?\s*$/i, '')
          .replace(/\s*-\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s*$/i, '')
          .trim();
      const normalizeDescriptionForExport = (value: string | null | undefined): string => {
        const raw = (value ?? '').trim();
        if (!raw) return '—';
        if (/^almuerzo\s*-\s*men[uú]\s+del\s+d[ií]a\s*-/i.test(raw)) return 'Almuerzo';
        const cleaned = stripTrailingDateSuffix(raw);
        if (/^almuerzo\s*-\s*men[uú]\s+del\s+d[ií]a\b/i.test(cleaned)) return 'Almuerzo';
        return cleaned || '—';
      };

      const baseParams = buildRpcBaseParams();
      const exportRows: SalesRow[] = [];
      let offset = 0;

      while (true) {
        const { data, error: err } = await supabase.rpc('get_sales_report', {
          ...baseParams,
          p_limit: EXPORT_CHUNK_SIZE,
          p_offset: offset,
        });
        if (err) throw err;
        const chunk = (data as SalesRow[]) ?? [];
        if (chunk.length === 0) break;
        exportRows.push(...chunk);
        setFetchedRowCount(exportRows.length);
        if (chunk.length < EXPORT_CHUNK_SIZE) break;
        offset += EXPORT_CHUNK_SIZE;
      }

      setExportState('generating');

      // Orden de columnas espeja exactamente el orden visual de la tabla.
      const ws = XLSX.utils.json_to_sheet(
        exportRows.map((r) => ({
          'N° Operación':   r.op_code,
          'Ticket':         r.ticket_code ?? '—',
          'Semana':         `S${r.week_number}`,
          'Cliente':        r.client_name,
          'Vendedor':       r.seller_name,
          'Monto (S/)':     Math.abs(r.amount),
          'Método':         getMethodLabel(r.payment_method, r.payment_status),
          'Ref. Pago':      r.payment_ref ?? '—',
          'Fecha de Pago':  r.payment_status === 'pending' ? '—' : new Date(r.created_at),
          'Hora de Pago':   fmtPaymentTime(r.created_at, r.payment_status),
          'Estado':         getStatus(r.payment_status).label,
          'Sede':           r.school_name ?? '—',
          'Tipo':           normalizeTypeForExport(r.type),
          'Descripción':    normalizeDescriptionForExport(r.description),
        })),
        { cellDates: true },
      );

      // Anchos de columna alineados con el orden de exportación.
      ws['!cols'] = [
        { wch: 14 }, // A: N° Operación
        { wch: 14 }, // B: Ticket
        { wch: 8  }, // C: Semana
        { wch: 34 }, // D: Cliente
        { wch: 28 }, // E: Vendedor
        { wch: 14 }, // F: Monto
        { wch: 16 }, // G: Método
        { wch: 20 }, // H: Ref. Pago
        { wch: 14 }, // I: Fecha de Pago
        { wch: 10 }, // J: Hora de Pago
        { wch: 14 }, // K: Estado
        { wch: 24 }, // L: Sede
        { wch: 18 }, // M: Tipo
        { wch: 40 }, // N: Descripción
      ];

      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        // Formato numérico para Monto (col F = c:5)
        const amtCell = ws[XLSX.utils.encode_cell({ r: row, c: 5 })];
        if (amtCell && typeof amtCell.v === 'number') {
          amtCell.t = 'n';
          amtCell.z = '"S/ " #,##0.00';
        }
        // Formato de fecha para Fecha de Pago (col I = c:8) solo si es Date
        const dtCell = ws[XLSX.utils.encode_cell({ r: row, c: 8 })];
        if (dtCell && dtCell.v instanceof Date) {
          dtCell.z = 'dd/mm/yyyy';
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
      const weekTag = selectedWeek ? `_S${selectedWeek}` : '';
      XLSX.writeFile(wb, `ventas_${activeDateFrom}_${activeDateTo}${weekTag}.xlsx`, { cellDates: true });

      setExportState('success');
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_OVERLAY_MS));
      completed = true;
    } catch (e) {
      const msg = parseError(e);
      setError(msg);
      setExportError(msg);
      setExportState('error');
    } finally {
      if (completed) {
        setExportState('idle');
        setFetchedRowCount(0);
      }
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Selector de semana operativa */}
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
              <SelectItem key={o.weekNum} value={String(o.weekNum)}>{o.label}</SelectItem>
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

      {/* Barra superior */}
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
            disabled={loading || exportState !== 'idle' || total === 0}
            title="Exporta todos los registros filtrados con texto completo"
          >
            {(exportState === 'fetching' || exportState === 'generating')
              ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
              : <Download className="h-4 w-4 mr-1" />
            }
            {(exportState === 'fetching' || exportState === 'generating') ? 'Generando Excel...' : 'Exportar xlsx'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Tabla con layout fijo ─────────────────────────────────────────── */}
      {/* table-fixed + anchos definidos en <th> → las columnas no se deforman
          sin importar el contenido. overflow-x-auto en el wrapper para móvil. */}
      <div className="rounded-lg border overflow-x-auto bg-card">
        <TooltipProvider delayDuration={120}>
          <table className="w-full text-sm table-fixed min-w-[1100px]">
          <thead>
            {/* Cabecera */}
            <tr className="border-b bg-muted/40">
              <th className="w-[100px] px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">N° OP<HeaderTooltip content={SALES_HEADER_DEFINITIONS['N° OP']} /></span>
              </th>
              <th className="w-[110px] px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">Ticket<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Ticket} /></span>
              </th>
              <th className="w-[36px] px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center justify-center gap-1.5">S.<HeaderTooltip content={SALES_HEADER_DEFINITIONS['S.']} /></span>
              </th>
              <th className="w-[150px] px-3 py-2 text-left font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">Cliente<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Cliente} /></span>
              </th>
              <th className="w-[130px] px-3 py-2 text-left font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">Vendedor<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Vendedor} /></span>
              </th>
              <th className="w-[90px] px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">Monto<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Monto} /></span>
              </th>
              <th className="w-[110px] px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center justify-center gap-1.5">Método<HeaderTooltip content={SALES_HEADER_DEFINITIONS['Método']} /></span>
              </th>
              <th className="w-[110px] px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">Ref. Pago<HeaderTooltip content={SALES_HEADER_DEFINITIONS['Ref. Pago']} /></span>
              </th>
              <th className="w-[80px] px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center justify-center gap-1.5">Fecha<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Fecha} /></span>
              </th>
              <th className="w-[52px] px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center justify-center gap-1.5">Hora<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Hora} /></span>
              </th>
              <th className="w-[90px] px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <span className="inline-flex items-center justify-center gap-1.5">Estado<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Estado} /></span>
              </th>
              <th className="w-[100px] px-3 py-2 text-left font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">Sede<HeaderTooltip content={SALES_HEADER_DEFINITIONS.Sede} /></span>
              </th>
            </tr>

            {/* Fila de filtros por columna */}
            <tr className="border-b bg-muted/20">
              {/* N° OP */}
              <td className="px-2 py-1">
                <Input placeholder="OP-…" value={colFilters.opCode}
                  onChange={(e) => dispatch({ field: 'opCode', value: e.target.value })}
                  className="h-7 text-xs w-full" />
              </td>
              {/* Ticket */}
              <td className="px-2 py-1">
                <Input placeholder="T-…" value={colFilters.ticketCode}
                  onChange={(e) => dispatch({ field: 'ticketCode', value: e.target.value })}
                  className="h-7 text-xs w-full" />
              </td>
              {/* S. — sin filtro */}
              <td />
              {/* Cliente */}
              <td className="px-2 py-1">
                <Input placeholder="Cliente…" value={colFilters.clientName}
                  onChange={(e) => dispatch({ field: 'clientName', value: e.target.value })}
                  className="h-7 text-xs w-full" />
              </td>
              {/* Vendedor */}
              <td className="px-2 py-1">
                <Input placeholder="Vendedor…" value={colFilters.sellerName}
                  onChange={(e) => dispatch({ field: 'sellerName', value: e.target.value })}
                  className="h-7 text-xs w-full" />
              </td>
              {/* Monto — sin filtro */}
              <td />
              {/* Método */}
              <td className="px-2 py-1">
                <Select
                  value={colFilters.paymentMethod === 'all' ? undefined : colFilters.paymentMethod}
                  onValueChange={(v) => dispatch({ field: 'paymentMethod', value: v })}
                >
                  <SelectTrigger className="h-7 text-xs w-full">
                    <SelectValue placeholder="Método" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              {/* Ref. Pago */}
              <td className="px-2 py-1">
                <Input placeholder="Ref…" value={colFilters.paymentRef}
                  onChange={(e) => dispatch({ field: 'paymentRef', value: e.target.value })}
                  className="h-7 text-xs w-full" />
              </td>
              {/* Fecha / Hora — sin filtro (colSpan=2) */}
              <td colSpan={2} />
              {/* Estado */}
              <td className="px-2 py-1">
                <Select
                  value={colFilters.paymentStatus === 'all' ? undefined : colFilters.paymentStatus}
                  onValueChange={(v) => dispatch({ field: 'paymentStatus', value: v })}
                >
                  <SelectTrigger className="h-7 text-xs w-full">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              {/* Sede — sin filtro */}
              <td />
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={COL_COUNT} className="py-12 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin inline mr-2" />Consultando datos…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="py-12 text-center text-muted-foreground">
                  <SearchX className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>Sin resultados para los filtros seleccionados.</p>
                </td>
              </tr>
            )}
            {!loading && rows.map((r) => {
              const st = getStatus(r.payment_status);
              return (
                <tr
                  key={r.id}
                  className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${r.is_deleted ? 'opacity-40 line-through' : ''}`}
                >
                  {/* N° OP */}
                  <td className="px-3 py-2 font-mono text-xs text-primary whitespace-nowrap overflow-hidden">
                    {r.op_code}
                  </td>
                  {/* Ticket */}
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap overflow-hidden">
                    {r.ticket_code ?? '—'}
                  </td>
                  {/* Semana */}
                  <td className="px-3 py-2 text-xs text-center font-medium">
                    S{r.week_number}
                  </td>
                  {/* Cliente — expandible */}
                  <td className="px-3 py-2 text-xs overflow-hidden">
                    <ExpandableCell
                      value={r.client_name}
                      label="Cliente"
                      onExpand={handleExpand}
                      maxChars={20}
                    />
                  </td>
                  {/* Vendedor — expandible */}
                  <td className="px-3 py-2 text-xs text-muted-foreground overflow-hidden">
                    <ExpandableCell
                      value={r.seller_name}
                      label="Vendedor"
                      onExpand={handleExpand}
                      maxChars={18}
                    />
                  </td>
                  {/* Monto */}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                    {formatAmount(r.amount)}
                  </td>
                  {/* Método */}
                  <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
                    {getMethodLabel(r.payment_method, r.payment_status)}
                  </td>
                  {/* Ref. Pago — expandible (UUIDs de pasarela son muy largos) */}
                  <td className="px-3 py-2 text-xs text-muted-foreground overflow-hidden">
                    <ExpandableCell
                      value={r.payment_ref ?? '—'}
                      label="Ref. Pago"
                      onExpand={handleExpand}
                      maxChars={14}
                    />
                  </td>
                  {/* Fecha de pago — '—' si pendiente */}
                  <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
                    {fmtPaymentDate(r.created_at, r.payment_status)}
                  </td>
                  {/* Hora de pago — '—' si pendiente */}
                  <td className="px-3 py-2 text-xs text-center text-muted-foreground whitespace-nowrap">
                    {fmtPaymentTime(r.created_at, r.payment_status)}
                  </td>
                  {/* Estado */}
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${st.color}`}>
                      {st.label}
                    </span>
                  </td>
                  {/* Sede */}
                  <td className="px-3 py-2 text-xs text-muted-foreground overflow-hidden">
                    <ExpandableCell
                      value={r.school_name ?? '—'}
                      label="Sede"
                      onExpand={handleExpand}
                      maxChars={14}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </TooltipProvider>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0 || loading}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1 || loading}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Dialog de celda expandida — única instancia, compartida por toda la tabla */}
      <Dialog open={expandedCell !== null} onOpenChange={(open) => { if (!open) setExpandedCell(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-muted-foreground">
              {expandedCell?.label}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm break-words leading-relaxed whitespace-pre-wrap">
            {expandedCell?.value}
          </p>
        </DialogContent>
      </Dialog>

      {/* Overlay de exportación */}
      {exportState !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded shadow-xl flex min-w-[320px] max-w-[90vw] flex-col items-center gap-4 text-center">
            {(exportState === 'fetching' || exportState === 'generating') && (
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            )}
            {exportState === 'fetching' && (
              <p className="text-sm text-slate-700">
                Descargando registros… ({fetchedRowCount.toLocaleString('es-PE')} procesados)
              </p>
            )}
            {exportState === 'generating' && (
              <p className="text-sm text-slate-700">Armando archivo Excel…</p>
            )}
            {exportState === 'success' && (
              <>
                <CheckCircle2 className="h-14 w-14 text-green-600" />
                <p className="text-base font-semibold text-green-700">¡Descarga completada!</p>
              </>
            )}
            {exportState === 'error' && (
              <>
                <XCircle className="h-14 w-14 text-red-600" />
                <p className="text-base font-semibold text-red-700">No se pudo generar el Excel</p>
                {exportError && <p className="text-xs text-slate-600 max-w-[440px]">{exportError}</p>}
                <Button
                  variant="outline" size="sm"
                  onClick={() => { setExportState('idle'); setFetchedRowCount(0); setExportError(null); }}
                >
                  Cerrar
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
