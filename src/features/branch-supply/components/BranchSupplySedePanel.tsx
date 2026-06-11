/**
 * Panel de suministros para el administrador de sede.
 *
 * Orquesta dos sub-vistas dentro de la pestaña "Pedidos" de SchoolAdmin:
 *   • Registrar Ingreso  → <BranchSupplyForm />
 *   • Historial de Envíos → tabla de v_branch_supply_receipts_summary (filtrada por schoolId)
 *
 * Reglas aplicadas:
 *   - Cero aritmética financiera aquí. Todos los cálculos son del servidor.
 *   - La tabla de historial lee desde la vista (RLS + filtro explícito school_id).
 *   - No importa nada de supply_requests, inventory_items ni módulos legados.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, Clock, FileText, Loader2, RefreshCw, XCircle, Zap,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge }    from '@/components/ui/badge';
import { Button }   from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { fetchSedeReceiptHistory } from '../services/branchSupplyService';
import { BranchSupplyForm }      from './BranchSupplyForm';
import { BranchSupplyQuickForm } from './BranchSupplyQuickForm';
import { BranchSupplyReceiptDetailModal } from './BranchSupplyReceiptDetailModal';
import {
  receiptDisplayAmount,
  receiptDocTypeLabel,
  type ReceiptStatus,
  type ReceiptSummaryRow,
} from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function currency(n: number) { return `S/ ${n.toFixed(2)}`; }

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Lima',
    }).format(new Date(iso));
  } catch { return iso; }
}

// Badge por estado
function StatusBadge({ status, rejectionReason }: { status: string; rejectionReason: string | null }) {
  const map: Record<string, { label: string; icon: typeof Clock; cls: string }> = {
    pending:   { label: 'Pendiente',  icon: Clock,          cls: 'bg-gray-100 text-gray-700 border-gray-200' },
    approved:  { label: 'Aprobado',   icon: CheckCircle2,   cls: 'bg-green-50 text-green-700 border-green-200' },
    rejected:  { label: 'Rechazado',  icon: XCircle,        cls: 'bg-red-50 text-red-700 border-red-200' },
    cancelled: { label: 'Cancelado',  icon: XCircle,        cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  };
  const cfg = map[status] ?? map.pending;
  const Icon = cfg.icon;

  const badge = (
    <Badge
      variant="outline"
      className={`flex items-center gap-1 text-xs font-medium ${cfg.cls} cursor-default`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      {cfg.label}
    </Badge>
  );

  if (status === 'rejected' && rejectionReason) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed p-3">
            <p className="font-semibold text-red-600 mb-1">Motivo de rechazo:</p>
            <p className="text-gray-700 whitespace-pre-wrap">{rejectionReason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}

// ── Historial (sub-componente) ─────────────────────────────────────────────────

interface HistorialProps {
  schoolId:       string;
  refreshTrigger: number;
}

function HistorialDeEnvios({ schoolId, refreshTrigger }: HistorialProps) {
  const [rows,    setRows]    = useState<ReceiptSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState<ReceiptStatus | 'all'>('all');
  const [detailReceiptId, setDetailReceiptId] = useState<string | null>(null);
  const [detailOpen,      setDetailOpen]      = useState(false);
  const mountedRef = useRef(true);

  const openDetail = useCallback((receiptId: string) => {
    setDetailReceiptId(receiptId);
    setDetailOpen(true);
  }, []);

  const handleDetailOpenChange = useCallback((open: boolean) => {
    setDetailOpen(open);
    if (!open) setDetailReceiptId(null);
  }, []);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async (f: ReceiptStatus | 'all') => {
    setLoading(true);
    try {
      const data = await fetchSedeReceiptHistory(schoolId, f);
      if (mountedRef.current) setRows(data);
    } catch (err: unknown) {
      console.error('[HistorialDeEnvios]', err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => { load(filter); }, [filter, load, refreshTrigger]);

  return (
    <div className="space-y-3">
      {/* Controles */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Filtrar:</span>
          <Select value={filter} onValueChange={v => setFilter(v as ReceiptStatus | 'all')}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="approved">Aprobados</SelectItem>
              <SelectItem value="rejected">Rechazados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-gray-500"
          onClick={() => load(filter)}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Tabla / estados vacíos */}
      <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Cargando historial...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
            <FileText className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">No hay comprobantes enviados</p>
            <p className="text-xs">Usa la pestaña "Registrar Ingreso" para enviar tu primer comprobante.</p>
          </div>
        ) : (
          <>
            {/* Encabezados */}
            <div className="grid grid-cols-[1fr_120px_90px_90px_140px_110px] gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <span>Recibo / Origen</span>
              <span>Tipo</span>
              <span className="text-right">Monto</span>
              <span className="text-right">Ítems</span>
              <span>Enviado</span>
              <span>Estado</span>
            </div>

            <ScrollArea className="max-h-[500px]">
              {rows.map(row => (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Ver detalle del ingreso ${row.receipt_number}`}
                  onClick={() => openDetail(row.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDetail(row.id);
                    }
                  }}
                  className={`grid grid-cols-[1fr_120px_90px_90px_140px_110px] gap-2 px-4 py-3 border-b border-gray-50 last:border-0 transition-colors items-center cursor-pointer hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B4513]/40 focus-visible:ring-inset ${row.is_quick ? 'bg-amber-50/40 hover:bg-amber-50/70' : ''}`}
                >
                  {/* Recibo + origen */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {row.receipt_number}
                      </p>
                      {row.is_quick && (
                        <span title="Ingreso rápido — stock actualizado al instante">
                          <Zap className="h-3 w-3 text-amber-500 flex-shrink-0" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {row.is_quick
                        ? 'Ingreso rápido (sin proveedor)'
                        : `${row.supplier_name}${row.supplier_ruc ? ` · RUC ${row.supplier_ruc}` : ''}`
                      }
                    </p>
                    {!row.is_quick && row.doc_number && (
                      <p className="text-xs text-gray-400 truncate">{row.doc_number}</p>
                    )}
                    {row.notes && (
                      <p className="text-xs text-gray-400 italic truncate">{row.notes}</p>
                    )}
                  </div>

                  {/* Tipo de documento */}
                  <span className="text-xs text-gray-600 truncate">
                    {row.is_quick ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                        <Zap className="h-3 w-3" />
                        Rápido
                      </span>
                    ) : (
                      receiptDocTypeLabel(row)
                    )}
                  </span>

                  {/* Monto declarado */}
                  <span className="text-sm font-semibold text-gray-900 text-right tabular-nums">
                    {row.is_quick
                      ? '—'
                      : receiptDisplayAmount(row) != null
                        ? currency(Number(receiptDisplayAmount(row)))
                        : 'Por auditar'}
                  </span>

                  {/* Cantidad de ítems */}
                  <span className="text-xs text-gray-600 text-right tabular-nums">
                    {row.items_count} ítem{row.items_count !== 1 ? 's' : ''}
                  </span>

                  {/* Fecha */}
                  <span className="text-xs text-gray-500 leading-tight">
                    {formatDate(row.submitted_at)}
                  </span>

                  {/* Estado */}
                  <div className="flex justify-start">
                    <StatusBadge
                      status={row.status}
                      rejectionReason={row.rejection_reason}
                    />
                  </div>
                </div>
              ))}
            </ScrollArea>
          </>
        )}
      </div>

      {/* Aviso de descalce financiero si hay pending con match_matched=false */}
      {rows.some(r =>
        r.status === 'pending'
        && r.match_matched === false
        && r.declared_total > 0,
      ) && (
        <Alert variant="destructive" className="text-xs">
          <AlertDescription>
            Uno o más comprobantes pendientes tienen un <strong>descalce financiero</strong>.
            El Administrador General no podrá aprobarlos hasta que la sede los corrija (rechaza y reenvía).
          </AlertDescription>
        </Alert>
      )}

      <p className="text-[11px] text-gray-400 text-center">
        Pulsa una fila para ver el detalle de productos ingresados
      </p>

      <BranchSupplyReceiptDetailModal
        receiptId={detailReceiptId}
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
      />
    </div>
  );
}

// ── Componente principal exportado ─────────────────────────────────────────────

interface BranchSupplySedePanel {
  schoolId: string | null;
}

type EntryMode = 'standard' | 'quick';

export function BranchSupplySedePanel({ schoolId }: BranchSupplySedePanel) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [entryMode,      setEntryMode]      = useState<EntryMode>('standard');

  const handleSuccess = useCallback((_receiptNumber: string) => {
    setRefreshTrigger(t => t + 1);
  }, []);

  if (!schoolId) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando información de la sede...</span>
      </div>
    );
  }

  return (
    <Tabs defaultValue="new" className="w-full">
      <TabsList className="grid grid-cols-2 w-full max-w-xs bg-white border rounded-lg p-0.5 h-9">
        <TabsTrigger
          value="new"
          className="text-xs data-[state=active]:bg-[#8B4513] data-[state=active]:text-white rounded-md"
        >
          Registrar Ingreso
        </TabsTrigger>
        <TabsTrigger
          value="history"
          className="text-xs data-[state=active]:bg-[#8B4513] data-[state=active]:text-white rounded-md"
        >
          Historial de Envíos
        </TabsTrigger>
      </TabsList>

      <TabsContent value="new" className="mt-4 space-y-4">

        {/* ── Toggle estándar / rápido ──────────────────────────────────── */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setEntryMode('standard')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              entryMode === 'standard'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Estándar (con comprobante)
          </button>
          <button
            type="button"
            onClick={() => setEntryMode('quick')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              entryMode === 'quick'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Zap className="h-3 w-3" />
            Rápido (sin comprobante)
          </button>
        </div>

        {/* ── Formulario según modo ─────────────────────────────────────── */}
        {entryMode === 'standard'
          ? <BranchSupplyForm      schoolId={schoolId} onSuccess={handleSuccess} />
          : <BranchSupplyQuickForm schoolId={schoolId} onSuccess={handleSuccess} />
        }

      </TabsContent>

      <TabsContent value="history" className="mt-4">
        <HistorialDeEnvios schoolId={schoolId} refreshTrigger={refreshTrigger} />
      </TabsContent>
    </Tabs>
  );
}
