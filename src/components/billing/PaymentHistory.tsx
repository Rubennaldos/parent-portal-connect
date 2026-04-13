import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getSourceChannelBadge } from '@/lib/billingConfig';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  History,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  AlertCircle,
  X,
  Ban,
  AlertTriangle,
  Loader2,
  FileText,
  ExternalLink,
  Receipt,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  approved_at: string | null;
  voided_at: string | null;
  status: 'approved' | 'voided';
  student_name: string;
  student_grade: string;
  student_section: string;
  school_name: string;
  concepto: string;
  amount: number;
  payment_method: string;
  reference_code: string | null;
  source_channel: string | null;
  invoice_number: string | null;
  invoice_type: 'Boleta' | 'Factura' | 'Ticket' | 'Pendiente' | null;
  invoice_pdf_url: string | null;
  credit_note_number: string | null;
  credit_note_pdf_url: string | null;
  total_count: number;
}

interface VoidTarget {
  id: string;
  student_name: string;
  amount: number;
  concepto: string;
}

// ─── Constantes de estilo ─────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  yape:          'Yape',
  plin:          'Plin',
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
  izipay:        'Izipay',
  tarjeta:       'Tarjeta',
  deposito:      'Depósito',
  cheque:        'Cheque',
};

const METHOD_COLORS: Record<string, string> = {
  yape:          'bg-violet-100 text-violet-800 border-violet-200',
  plin:          'bg-sky-100 text-sky-800 border-sky-200',
  transferencia: 'bg-blue-100 text-blue-800 border-blue-200',
  efectivo:      'bg-green-100 text-green-800 border-green-200',
  izipay:        'bg-orange-100 text-orange-800 border-orange-200',
  tarjeta:       'bg-indigo-100 text-indigo-800 border-indigo-200',
  deposito:      'bg-teal-100 text-teal-800 border-teal-200',
  cheque:        'bg-amber-100 text-amber-800 border-amber-200',
};

const CONCEPTO_COLORS: Record<string, string> = {
  'Recarga de saldo':  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Pago de almuerzos': 'bg-amber-100 text-amber-800 border-amber-200',
  'Pago de deuda':     'bg-red-100 text-red-800 border-red-200',
};

// ─── Utilidades ───────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), "dd/MM/yyyy 'a las' HH:mm", { locale: es });
  } catch {
    return '—';
  }
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Hook: debounce con bypass para vacío y mínimo de 3 caracteres ────────────

function useSearchQuery(raw: string, delay = 500): string {
  const [query, setQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (raw === '') {
      setQuery('');
      return;
    }

    if (raw.length < 3) return;

    timerRef.current = setTimeout(() => setQuery(raw), delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [raw, delay]);

  return query;
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

const SkeletonRow = () => (
  <tr className="border-b border-gray-100 animate-pulse">
    {[160, 180, 110, 100, 80, 100, 120, 80, 60].map((w, i) => (
      <td key={i} className="px-4 py-4">
        <div className="h-3.5 bg-gray-200 rounded-full" style={{ width: `${w}px`, maxWidth: '100%' }} />
        {i === 1 && <div className="h-2.5 bg-gray-100 rounded-full mt-2 w-24" />}
      </td>
    ))}
  </tr>
);

const FetchingBar = ({ visible }: { visible: boolean }) => (
  <div className={`h-0.5 rounded-full overflow-hidden transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
    <div className="h-full bg-red-400 animate-[progressBar_1.2s_ease-in-out_infinite]" />
  </div>
);

// ─── Modal de confirmación de anulación ───────────────────────────────────────

interface VoidModalProps {
  target: VoidTarget | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

const VoidConfirmModal = ({ target, onClose, onConfirm }: VoidModalProps) => {
  const [reason, setReason]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (target) { setReason(''); setError(''); setLoading(false); }
  }, [target]);

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) { setError('El motivo de anulación es obligatorio.'); return; }
    setLoading(true);
    setError('');
    try {
      await onConfirm(trimmed);
    } catch (err: any) {
      setError(err?.message ?? 'Error al procesar la anulación.');
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={open => { if (!open && !loading) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Ban className="h-5 w-5" />
            Confirmar Anulación de Pago
          </DialogTitle>
          <DialogDescription>
            Esta acción es irreversible y quedará registrada en la auditoría.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4 py-1">
            {/* Resumen del pago */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
              <p className="text-sm font-semibold text-gray-800">{target.student_name}</p>
              <p className="text-sm text-gray-600">{target.concepto}</p>
              <p className="text-lg font-bold text-red-700">S/ {formatAmount(target.amount)}</p>
            </div>

            {/* Advertencias */}
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700">
                  Las deudas vinculadas <strong>volverán a estado pendiente</strong> y el padre deberá volver a pagar.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700">
                  Si fue una recarga de saldo, <strong>el monto se descontará del balance</strong> del alumno (puede quedar negativo).
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">
                  Si existe boleta electrónica, se generará una <strong>Nota de Crédito SUNAT (código 07)</strong>.
                </p>
              </div>
            </div>

            {/* Motivo */}
            <div className="space-y-1.5">
              <Label htmlFor="void-reason" className="text-sm font-medium">
                Motivo de anulación <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="void-reason"
                placeholder="Ej: Pago duplicado, error en monto, cliente solicitó cancelación..."
                value={reason}
                onChange={e => { setReason(e.target.value); setError(''); }}
                className="resize-none h-20 text-sm"
                disabled={loading}
              />
              {error && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {error}
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !reason.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Anulando…
              </>
            ) : (
              <>
                <Ban className="h-4 w-4 mr-2" />
                Confirmar anulación
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────

export const PaymentHistory = () => {
  const { user }  = useAuth();
  const { toast } = useToast();

  const [rows, setRows]                   = useState<PaymentRow[]>([]);
  const [totalCount, setTotal]            = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isFetching, setIsFetching]       = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const [search, setSearch]     = useState('');
  const [pageSize, setPageSize] = useState<20 | 50>(20);
  const [page, setPage]         = useState(1);

  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);

  const activeQuery = useSearchQuery(search);
  const totalPages  = Math.max(1, Math.ceil(totalCount / pageSize));
  const showMinCharHint = search.length > 0 && search.length < 3;

  useEffect(() => { setPage(1); }, [activeQuery, pageSize]);

  const fetchData = useCallback(async () => {
    if (isInitialLoad) {
      setIsFetching(false);
    } else {
      setIsFetching(true);
    }
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_payment_history', {
        p_search: activeQuery.trim(),
        p_limit:  pageSize,
        p_offset: (page - 1) * pageSize,
      });

      if (rpcError) throw rpcError;

      const list = (data ?? []) as PaymentRow[];
      setRows(list);
      setTotal(list.length > 0 ? Number(list[0].total_count) : 0);
    } catch (err: any) {
      console.error('❌ Error cargando historial de pagos:', err);
      setError(err?.message ?? 'Error desconocido al cargar los datos.');
    } finally {
      setIsInitialLoad(false);
      setIsFetching(false);
    }
  }, [activeQuery, pageSize, page, isInitialLoad]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Anulación ─────────────────────────────────────────────────────────────

  const handleVoidConfirm = async (reason: string) => {
    if (!voidTarget || !user) return;

    const { data, error: rpcError } = await supabase.rpc('void_payment', {
      p_request_id: voidTarget.id,
      p_admin_id:   user.id,
      p_reason:     reason,
    });

    if (rpcError) {
      const msg = rpcError.message ?? '';
      if (msg.includes('SPLIT_PAYMENT')) {
        throw new Error('Este pago usa billetera interna y requiere reversión manual. Contacta soporte técnico.');
      }
      if (msg.includes('INVALID_STATE')) {
        throw new Error('Este pago ya fue anulado o no está en estado aprobado.');
      }
      throw new Error(msg || 'Error al anular el pago.');
    }

    const result = data as {
      reverted_tx_count: number;
      reverted_lo_count: number;
      balance_deducted: number;
      credit_note_id: string | null;
    };

    setVoidTarget(null);

    const details: string[] = [];
    if (result.reverted_tx_count > 0)
      details.push(`${result.reverted_tx_count} deuda(s) revertida(s) a pendiente`);
    if (result.reverted_lo_count > 0)
      details.push(`${result.reverted_lo_count} almuerzo(s) revertido(s)`);
    if (result.balance_deducted > 0)
      details.push(`S/ ${formatAmount(result.balance_deducted)} descontado(s) del saldo`);
    if (result.credit_note_id)
      details.push('Nota de Crédito SUNAT generada');

    toast({
      title: 'Pago anulado correctamente',
      description: details.length > 0 ? details.join(' · ') : 'El pago quedó marcado como anulado.',
    });

    fetchData();
  };

  const handleClearSearch = () => setSearch('');

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Modal de confirmación ── */}
      <VoidConfirmModal
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={handleVoidConfirm}
      />

      {/* ── Cabecera con controles ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <History className="h-5 w-5 text-red-600" />
                Historial de Pagos
              </CardTitle>
              <CardDescription className="mt-1">
                Todos los pagos aprobados — del más reciente al más antiguo
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={isFetching || isInitialLoad}
              className="self-start sm:self-auto"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar por nombre de alumno o N° de operación…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700 transition-colors"
                  title="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v) as 20 | 50)}>
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20 por página</SelectItem>
                <SelectItem value="50">50 por página</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showMinCharHint && (
            <p className="text-xs text-muted-foreground pl-1">
              Escribe al menos 3 caracteres para buscar…
            </p>
          )}

          {!isInitialLoad && !error && !showMinCharHint && (
            <p className="text-sm text-muted-foreground">
              {totalCount === 0
                ? 'Sin resultados'
                : `Mostrando ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} de ${totalCount} pagos`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Error ── */}
      {error && (
        <Card className="border-red-200">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-red-700">No se pudo cargar el historial</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchData}>
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tabla ── */}
      {!error && (
        <Card className="overflow-hidden">
          <FetchingBar visible={isFetching} />
          <CardContent className="p-0">
            <div className={`overflow-x-auto transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Fecha y Hora</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Alumno</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Comprobante</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Concepto</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Monto (S/)</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Método de Pago</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">N° Operación / Referencia</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Canal</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">

                  {isInitialLoad && Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))}

                  {!isInitialLoad && rows.map((row, idx) => {
                    const isVoided = row.status === 'voided';
                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          isVoided
                            ? 'bg-red-50/40 opacity-65'
                            : idx % 2 === 0
                              ? 'hover:bg-muted/30'
                              : 'bg-gray-50/50 hover:bg-muted/30'
                        }`}
                      >
                        {/* Fecha */}
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                          <div>{formatDate(row.approved_at)}</div>
                          {isVoided && row.voided_at && (
                            <div className="text-xs text-red-500 mt-0.5">
                              Anulado: {formatDate(row.voided_at)}
                            </div>
                          )}
                        </td>

                        {/* Alumno */}
                        <td className="px-4 py-3">
                          <div className={`font-medium whitespace-nowrap ${isVoided ? 'text-gray-500' : 'text-gray-900'}`}>
                            {row.student_name}
                          </div>
                          {(row.student_grade || row.student_section) && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {[row.student_grade, row.student_section].filter(Boolean).join(' – ')}
                            </div>
                          )}
                          {row.school_name && row.school_name !== 'Sin sede' && (
                            <div className="text-xs text-muted-foreground">{row.school_name}</div>
                          )}
                        </td>

                        {/* Comprobante */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 min-w-[120px]">

                            {/* ── Documento original ── */}
                            {row.invoice_type === 'Boleta' || row.invoice_type === 'Factura' ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border w-fit ${
                                  isVoided
                                    ? 'bg-gray-100 text-gray-400 border-gray-200'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}>
                                  <FileText className="h-3 w-3 shrink-0" />
                                  <span className={isVoided ? 'line-through' : ''}>
                                    {row.invoice_number}
                                  </span>
                                </span>
                                {/* PDF siempre visible: azul normal, gris si está anulado */}
                                {row.invoice_pdf_url && (
                                  <a
                                    href={row.invoice_pdf_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`transition-colors ${
                                      isVoided
                                        ? 'text-gray-300 hover:text-gray-500'
                                        : 'text-blue-500 hover:text-blue-700'
                                    }`}
                                    title={isVoided ? 'Ver boleta original (anulada)' : 'Ver comprobante PDF'}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            ) : row.invoice_type === 'Ticket' ? (
                              <div className="flex flex-col gap-1">
                                {/* Número de ticket (tachado si anulado) */}
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border w-fit ${
                                  isVoided
                                    ? 'bg-gray-100 text-gray-400 border-gray-200'
                                    : 'bg-gray-100 text-gray-600 border-gray-200'
                                }`}>
                                  <Receipt className="h-3 w-3 shrink-0" />
                                  <span className={isVoided ? 'line-through' : ''}>
                                    {row.invoice_number}
                                  </span>
                                </span>
                                {/* Badge "Ticket Anulado" solo para tickets sin NC legal */}
                                {isVoided && !row.credit_note_number && (
                                  <div className="flex items-center gap-1 pl-1">
                                    <span className="text-xs text-red-300 select-none">↳</span>
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border bg-red-50 text-red-600 border-red-200 w-fit"
                                      title="Ticket interno anulado. No genera Nota de Crédito SUNAT porque no se emitió boleta electrónica."
                                    >
                                      <Ban className="h-3 w-3 shrink-0" />
                                      Ticket Anulado
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : isVoided ? (
                              /* Sin comprobante + anulado */
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border w-fit bg-red-50 text-red-600 border-red-200"
                                title="Pago anulado sin comprobante electrónico"
                              >
                                <Ban className="h-3 w-3 shrink-0" />
                                Ticket Anulado
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Pendiente</span>
                            )}

                            {/* ── Nota de Crédito SUNAT (solo si hay boleta original) ── */}
                            {isVoided && row.credit_note_number && (
                              <div className="flex items-center gap-1 flex-wrap pl-1">
                                <span className="text-xs text-red-300 select-none">↳</span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-red-50 text-red-600 border-red-200 w-fit">
                                  <FileText className="h-3 w-3 shrink-0" />
                                  {row.credit_note_number}
                                </span>
                                {row.credit_note_pdf_url ? (
                                  <a
                                    href={row.credit_note_pdf_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-red-400 hover:text-red-600 transition-colors"
                                    title="Ver Nota de Crédito PDF"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span
                                    className="text-xs text-gray-400 italic cursor-default"
                                    title="El PDF de la Nota de Crédito está siendo generado en Nubefact"
                                  >
                                    Procesando PDF…
                                  </span>
                                )}
                              </div>
                            )}

                          </div>
                        </td>

                        {/* Concepto */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            isVoided
                              ? 'bg-gray-100 text-gray-500 border-gray-200 line-through'
                              : CONCEPTO_COLORS[row.concepto] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                          }`}>
                            {row.concepto}
                          </span>
                        </td>

                        {/* Monto */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className={`font-semibold ${isVoided ? 'text-gray-400 line-through' : 'text-green-700'}`}>
                            S/ {formatAmount(row.amount)}
                          </span>
                        </td>

                        {/* Método */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            isVoided
                              ? 'bg-gray-100 text-gray-400 border-gray-200'
                              : METHOD_COLORS[row.payment_method?.toLowerCase()] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                          }`}>
                            {METHOD_LABELS[row.payment_method?.toLowerCase()] ?? row.payment_method ?? '—'}
                          </span>
                        </td>

                        {/* Referencia */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.reference_code ? (
                            <code className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                              isVoided ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {row.reference_code}
                            </code>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* Canal de Origen */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {(() => {
                            const badge = getSourceChannelBadge(row.source_channel);
                            return (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                                isVoided ? 'bg-gray-100 text-gray-400 border-gray-200' : badge.className
                              }`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                        </td>

                        {/* Acciones */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {isVoided ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                              <Ban className="h-3 w-3" />
                              Anulado
                            </span>
                          ) : (
                            <button
                              onClick={() => setVoidTarget({
                                id:           row.id,
                                student_name: row.student_name,
                                amount:       row.amount,
                                concepto:     row.concepto,
                              })}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300 transition-colors"
                              title="Anular este pago"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Sin resultados */}
                  {!isInitialLoad && rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-16 text-center">
                        <History className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                        <p className="text-gray-400 font-medium text-sm">
                          {activeQuery
                            ? `Sin resultados para "${activeQuery}"`
                            : 'No hay pagos registrados aún'}
                        </p>
                        {activeQuery && (
                          <button
                            onClick={handleClearSearch}
                            className="mt-2 text-xs text-red-500 hover:text-red-600 underline"
                          >
                            Limpiar búsqueda
                          </button>
                        )}
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Paginación ── */}
      {!isInitialLoad && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8"
              disabled={page === 1} onClick={() => setPage(1)} title="Primera página">
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8"
              disabled={page === 1} onClick={() => setPage(p => p - 1)} title="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 5)             p = i + 1;
              else if (page <= 3)              p = i + 1;
              else if (page >= totalPages - 2) p = totalPages - 4 + i;
              else                             p = page - 2 + i;
              return (
                <Button key={p}
                  variant={p === page ? 'default' : 'outline'}
                  size="icon" className="h-8 w-8 text-xs"
                  onClick={() => setPage(p)}>
                  {p}
                </Button>
              );
            })}

            <Button variant="outline" size="icon" className="h-8 w-8"
              disabled={page === totalPages} onClick={() => setPage(p => p + 1)} title="Siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8"
              disabled={page === totalPages} onClick={() => setPage(totalPages)} title="Última página">
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

    </div>
  );
};
