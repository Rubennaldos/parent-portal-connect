/**
 * Panel Dual de Auditoría de Comprobantes de Suministros de Sede.
 *
 * ENDURECIMIENTO v2 — AUDITOR PROPIETARIO DE COSTOS:
 *  - La grilla de ítems tiene inputs numéricos editables para que el Auditor
 *    General digite los costos reales basándose en la factura física a la izquierda.
 *  - Switch de "Precios incluyen IGV" exclusivo para el auditor (no visible en la sede).
 *  - Match Score dinámico: usa auditPreview (RPC preview_branch_supply_totals
 *    con debounce) mientras el auditor tipea. SSOT del cotejo.
 *  - Botón "Aprobar Ingreso" SOLO activo si auditPreview.matched === true (servidor).
 *
 * Arquitectura:
 *  - Solo accesible para admin_general / superadmin.
 *  - CERO aritmética en este archivo. El cotejo lo calcula el servidor.
 *  - No importa nada de MovementsHubTab, billing, ni módulos legados.
 */

import { useCallback } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock,
  Loader2, ShieldAlert, XCircle, ClipboardList, Package, DollarSign,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge }    from '@/components/ui/badge';
import { Button }   from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch }   from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useRole }  from '@/hooks/useRole';
import { useBranchSupplyAudit } from '../hooks/useBranchSupplyAudit';
import type { UseBranchSupplyAuditReturn } from '../hooks/useBranchSupplyAudit';
import { BranchSupplyEvidenceViewer } from './BranchSupplyEvidenceViewer';
import {
  receiptDisplayAmount,
  receiptDocTypeLabel,
  receiptUsesAuditorCostOnly,
  type ReceiptDetail,
  type ReceiptSummaryRow,
  type ReceiptStatus,
  type CostItemInput,
  type MatchPreview,
} from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:   { label: 'Pendiente',  variant: 'secondary'   },
  approved:  { label: 'Aprobado',   variant: 'default'     },
  rejected:  { label: 'Rechazado',  variant: 'destructive' },
  cancelled: { label: 'Cancelado',  variant: 'outline'     },
};

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

// ── Sub-componente: Match Score dinámico (preview del auditor) ─────────────

function AuditMatchScoreBlock({
  costOnlyMode,
  declaredTotal,
  auditPreview,
  auditPreviewLoading,
  isPending,
}: {
  costOnlyMode:        boolean;
  declaredTotal:       number;
  auditPreview:        MatchPreview | null;
  auditPreviewLoading: boolean;
  isPending:           boolean;
}) {
  if (!isPending) return null;

  if (auditPreviewLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
        Validando costos ingresados en el servidor...
      </div>
    );
  }

  if (!auditPreview) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-center gap-2 text-sm text-blue-700">
          <DollarSign className="h-4 w-4 flex-shrink-0" />
          <span>
            {costOnlyMode
              ? 'Ingresa el costo unitario de cada ítem según la factura física. La sede no declaró monto total.'
              : (
                <>
                  Ingresa los costos unitarios de la factura física.
                  {' '}Monto declarado por la sede (legacy): <strong>{currency(declaredTotal)}</strong>
                </>
              )}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-4 ${auditPreview.matched ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-300'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {auditPreview.matched
              ? <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
              : <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0" />
            }
            <span className={`text-sm font-semibold ${auditPreview.matched ? 'text-green-800' : 'text-red-800'}`}>
              {auditPreview.matched
                ? (costOnlyMode
                  ? 'Costos completos — listo para aprobar'
                  : 'Cotejo exacto — los costos coinciden al céntimo')
                : (costOnlyMode
                  ? 'Completa los costos unitarios (suma mayor a S/ 0)'
                  : 'DESCALCE — corrige los costos antes de aprobar')}
            </span>
          </div>
          {!auditPreview.matched && !costOnlyMode && (
            <p className="text-xs text-red-700 pl-6">
              Diferencia de {currency(Math.abs(auditPreview.delta_cents) / 100)}.
              Ajusta los costos hasta que la suma iguale el monto declarado por la sede.
            </p>
          )}
        </div>
        <div className="text-right text-xs text-gray-600 space-y-0.5 shrink-0">
          <p>Suma con costos: <strong>{currency(auditPreview.lines_sum)}</strong></p>
          {costOnlyMode ? (
            <p>Total al aprobar: <strong>{currency(auditPreview.lines_sum)}</strong></p>
          ) : (
            <p>Monto sede (legacy): <strong>{currency(auditPreview.declared_total)}</strong></p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-componente: Tabla editable de costos (lado derecho, solo auditor) ──

function CostEntryTable({
  detail,
  costItems,
  onCostChange,
}: {
  detail:        ReceiptDetail;
  costItems:     CostItemInput[];
  onCostChange:  (itemId: string, cost: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left p-2 font-semibold text-gray-600 min-w-[140px]">Producto</th>
            <th className="text-left p-2 font-semibold text-gray-600">Empaque</th>
            <th className="text-right p-2 font-semibold text-gray-600">Cant.</th>
            <th className="text-right p-2 font-semibold text-gray-600 min-w-[120px]">
              Costo Unit. (S/)
              <span className="text-[10px] font-normal text-orange-600 block">← Auditor ingresa</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(detail.items ?? []).map(item => {
            const ci = costItems.find(c => c.item_id === item.id);
            return (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="p-2">
                  <p className="font-medium text-gray-900 leading-tight">{item.product_name}</p>
                  {item.product_code && (
                    <p className="text-[10px] text-gray-400">{item.product_code}</p>
                  )}
                </td>
                <td className="p-2 text-gray-600">{item.uom_name ?? 'Unidad base'}</td>
                <td className="p-2 text-right tabular-nums font-medium">{item.quantity}</td>
                <td className="p-2 text-right">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={ci?.unit_cost ?? ''}
                    onChange={e => onCostChange(item.id, e.target.value)}
                    className="h-7 text-xs text-right w-28 ml-auto tabular-nums border-orange-200 focus:border-orange-400"
                  />
                </td>
              </tr>
            );
          })}
          {(!detail.items || detail.items.length === 0) && (
            <tr>
              <td colSpan={4} className="p-4 text-center text-gray-400">Sin ítems registrados</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Sub-componente: Modal de rechazo ───────────────────────────────────────────

function RejectModal({
  open, reason, fieldError, rejecting, onReasonChange, onConfirm, onCancel,
}: {
  open:           boolean;
  reason:         string;
  fieldError:     string | null;
  rejecting:      boolean;
  onReasonChange: (v: string) => void;
  onConfirm:      () => void;
  onCancel:       () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !rejecting) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <XCircle className="h-5 w-5" />
            Rechazar comprobante
          </DialogTitle>
          <DialogDescription>
            El stock <strong>no se modificará</strong>. El motivo quedará registrado y visible
            para la sede para que pueda corregir el comprobante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="rejection-reason" className="text-sm font-medium">
            Motivo de rechazo <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="rejection-reason"
            value={reason}
            onChange={e => onReasonChange(e.target.value)}
            placeholder="Ej: El precio del arroz no coincide con la factura. Cantidad declarada es 50 kg pero el doc dice 25 kg."
            rows={4}
            className={fieldError ? 'border-red-400 focus-visible:ring-red-400' : ''}
            disabled={rejecting}
          />
          {fieldError && <p className="text-xs text-red-600">{fieldError}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={rejecting}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={rejecting || !reason.trim()}
            className="gap-1.5"
          >
            {rejecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {rejecting ? 'Rechazando...' : 'Confirmar rechazo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-componente: Fila de la lista ──────────────────────────────────────────

function ReceiptRow({ row, onSelect }: { row: ReceiptSummaryRow; onSelect: (id: string) => void }) {
  const badge    = STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;
  // Mostrar badge de "Sin costos" si está pending (la sede siempre envía costos 0)
  const noCosts  = row.status === 'pending';

  return (
    <button
      type="button"
      className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-slate-50 transition-colors"
      onClick={() => onSelect(row.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{row.receipt_number}</span>
            <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0">{badge.label}</Badge>
            {noCosts && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-orange-700 border-orange-300">
                Costos pendientes
              </Badge>
            )}
            {!row.evidence_path && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-300">
                Sin evidencia
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-0.5 truncate">
            {row.school_name} · {row.supplier_name}
            {row.supplier_ruc ? ` (${row.supplier_ruc})` : ''}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {receiptDocTypeLabel(row)}
            {row.doc_number ? ` ${row.doc_number}` : ''} · {row.items_count} ítem(s)
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-gray-900">
            {receiptDisplayAmount(row) != null
              ? currency(Number(receiptDisplayAmount(row)))
              : 'Por auditar'}
          </p>
          <p className="text-xs text-gray-400">{formatDate(row.submitted_at)}</p>
        </div>
      </div>
    </button>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function BranchSupplyAuditPanel() {
  const { canViewAllSchools, role } = useRole();

  const {
    receipts, loadingList, statusFilter, setStatusFilter,
    selectedId, detail, loadingDetail,
    signedUrl, loadingSignedUrl,
    costItems, pricesIncludeIgvAudit, auditPreview, auditPreviewLoading,
    canApprove,
    updateItemCost, setAuditPricesIncludeIgv,
    approving, rejectModal, rejecting,
    selectReceipt, clearSelection,
    handleApprove, openRejectModal, closeRejectModal, setRejectReason, handleReject,
    refreshList,
  }: UseBranchSupplyAuditReturn = useBranchSupplyAudit();

  // ── Gate de acceso ─────────────────────────────────────────────────────────
  if (role === null) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Verificando acceso...</span>
      </div>
    );
  }

  if (!canViewAllSchools) {
    return (
      <Alert variant="destructive" className="m-4">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Acceso denegado</AlertTitle>
        <AlertDescription>
          Este panel requiere el rol de Administrador General o Superadmin.
          El permiso <code>logistica.auditar_comprobantes_sede</code> no está habilitado para tu cuenta.
        </AlertDescription>
      </Alert>
    );
  }

  const canReject = !!detail && detail.receipt.status === 'pending';

  // ── Vista detalle (split-screen) ─────────────────────────────────────────────

  if (selectedId) {
    return (
      <>
        {/* Barra de retorno */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-gray-600"
            onClick={clearSelection}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver a la lista
          </Button>

          {detail && (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-sm font-semibold text-gray-800">{detail.receipt.receipt_number}</span>
              <Badge variant={STATUS_BADGE[detail.receipt.status]?.variant ?? 'secondary'}>
                {STATUS_BADGE[detail.receipt.status]?.label ?? detail.receipt.status}
              </Badge>
              {detail.school && (
                <span className="text-xs text-gray-500 hidden sm:block">
                  {detail.school.name}
                  {' · '}
                  {detail.receipt.is_quick
                    ? 'Ingreso rápido'
                    : (detail.supplier?.name ?? 'Sin proveedor')}
                </span>
              )}
            </>
          )}

          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={refreshList} disabled={loadingDetail}>
            Refrescar
          </Button>
        </div>

        {loadingDetail ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Cargando detalle...</span>
          </div>
        ) : detail ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100vh-200px)]">

            {/* ── LADO IZQUIERDO: Visor de evidencia física ── */}
            <div className="border-r border-gray-200 flex flex-col">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-gray-500" />
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Comprobante físico original
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <BranchSupplyEvidenceViewer
                  variant="audit"
                  className="h-full min-h-[320px]"
                  evidencePath={detail.receipt.evidence_path}
                  signedUrl={signedUrl}
                  loading={loadingSignedUrl}
                />
              </div>
            </div>

            {/* ── LADO DERECHO: Ingreso de costos + cotejo ── */}
            <div className="flex flex-col">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-orange-50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-orange-600" />
                  <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                    Ingreso de costos — Auditor General
                  </span>
                </div>
                {/* IGV Toggle — solo para el Auditor, no visible en la sede */}
                {detail.receipt.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      id="igv-audit"
                      checked={pricesIncludeIgvAudit}
                      onCheckedChange={setAuditPricesIncludeIgv}
                      className="data-[state=checked]:bg-orange-600"
                    />
                    <Label htmlFor="igv-audit" className="text-xs text-orange-700 whitespace-nowrap cursor-pointer">
                      Precios con IGV
                    </Label>
                  </div>
                )}
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">

                  {/* ── Cabecera del comprobante ── */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div><span className="text-gray-500">Sede:</span> <strong>{detail.school?.name}</strong></div>
                    <div>
                      <span className="text-gray-500">Proveedor:</span>{' '}
                      <strong>{detail.supplier?.name}</strong>
                      {detail.supplier?.ruc && <span className="text-gray-400 ml-1">RUC {detail.supplier.ruc}</span>}
                    </div>
                    <div>
                      <span className="text-gray-500">Tipo doc.:</span>{' '}
                      <strong>{receiptDocTypeLabel(detail.receipt)}</strong>
                    </div>
                    <div><span className="text-gray-500">N.° doc.:</span> <strong>{detail.receipt.doc_number ?? '—'}</strong></div>
                    {receiptUsesAuditorCostOnly(detail.receipt) ? (
                      detail.receipt.status !== 'pending' && (
                        <div>
                          <span className="text-gray-500">Total auditado:</span>{' '}
                          <strong className="text-gray-900">{currency(detail.receipt.declared_total)}</strong>
                        </div>
                      )
                    ) : (
                      <div>
                        <span className="text-gray-500">Monto sede (legacy):</span>{' '}
                        <strong className="text-gray-900">{currency(detail.receipt.declared_total)}</strong>
                      </div>
                    )}
                    <div><span className="text-gray-500">Enviado:</span> <strong>{formatDate(detail.receipt.submitted_at)}</strong></div>
                    {detail.receipt.notes && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Notas sede:</span>
                        <span className="ml-1 text-gray-700">{detail.receipt.notes}</span>
                      </div>
                    )}
                    {detail.receipt.rejection_reason && (
                      <div className="col-span-2 bg-red-50 border border-red-200 rounded p-2">
                        <span className="text-red-700 font-medium">Motivo de rechazo:</span>
                        <span className="ml-1 text-red-700">{detail.receipt.rejection_reason}</span>
                      </div>
                    )}
                  </div>

                  {/* ── Match Score dinámico ── */}
                  <AuditMatchScoreBlock
                    costOnlyMode={receiptUsesAuditorCostOnly(detail.receipt)}
                    declaredTotal={detail.receipt.declared_total}
                    auditPreview={auditPreview}
                    auditPreviewLoading={auditPreviewLoading}
                    isPending={detail.receipt.status === 'pending'}
                  />

                  {/* ── Tabla editable de costos ── */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <CostEntryTable
                      detail={detail}
                      costItems={costItems}
                      onCostChange={updateItemCost}
                    />
                  </div>

                  {detail.receipt.status === 'pending' && (
                    <p className="text-xs text-orange-600">
                      Ingresa el costo unitario de cada ítem según la factura física.
                      {pricesIncludeIgvAudit
                        ? ' Los precios incluyen IGV (18%).'
                        : ' Los precios NO incluyen IGV.'}
                    </p>
                  )}

                  {/* ── Acciones de auditoría ── */}
                  {detail.receipt.status === 'pending' && (
                    <div className="flex gap-3 pt-2">
                      <Button
                        variant="destructive"
                        className="flex-1 gap-1.5"
                        onClick={openRejectModal}
                        disabled={approving || !canReject}
                      >
                        <XCircle className="h-4 w-4" />
                        Rechazar
                      </Button>
                      <Button
                        className="flex-1 gap-1.5 bg-green-700 hover:bg-green-800 text-white disabled:opacity-50"
                        onClick={handleApprove}
                        disabled={!canApprove}
                        title={
                          !canApprove
                            ? auditPreview
                              ? (receiptUsesAuditorCostOnly(detail.receipt)
                                ? 'Ingresa costos válidos en todos los ítems (suma > S/ 0).'
                                : 'Descalce financiero: ajusta los costos hasta que la suma cuadre con el monto de la sede.')
                              : 'Ingresa los costos de todos los ítems para habilitar la aprobación.'
                            : undefined
                        }
                      >
                        {approving
                          ? <><Loader2 className="h-4 w-4 animate-spin" />Aprobando...</>
                          : <><CheckCircle2 className="h-4 w-4" />Aprobar Ingreso</>
                        }
                      </Button>
                    </div>
                  )}

                  {/* Alerta de bloqueo cuando hay descalce */}
                  {detail.receipt.status === 'pending' && auditPreview && !auditPreview.matched && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Aprobación bloqueada</AlertTitle>
                      <AlertDescription>
                        {receiptUsesAuditorCostOnly(detail.receipt) ? (
                          <>
                            Completa el costo unitario de cada ítem según la factura.
                            La suma debe ser mayor a <strong>S/ 0</strong> (actual:{' '}
                            <strong>{currency(auditPreview.lines_sum)}</strong>).
                          </>
                        ) : (
                          <>
                            La suma de costos (
                            <strong>{currency(auditPreview.lines_sum)}</strong>)
                            difiere en{' '}
                            <strong>{currency(Math.abs(auditPreview.delta_cents) / 100)}</strong>
                            {' '}del monto declarado por la sede (
                            <strong>{currency(auditPreview.declared_total)}</strong>).
                          </>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                </div>
              </ScrollArea>
            </div>

          </div>
        ) : null}

        {/* Modal de rechazo */}
        <RejectModal
          open={rejectModal.open}
          reason={rejectModal.reason}
          fieldError={rejectModal.fieldError}
          rejecting={rejecting}
          onReasonChange={setRejectReason}
          onConfirm={handleReject}
          onCancel={closeRejectModal}
        />
      </>
    );
  }

  // ── Vista lista ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Estado:</span>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as ReceiptStatus | 'all')}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="approved">Aprobados</SelectItem>
              <SelectItem value="rejected">Rechazados</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={refreshList}
          disabled={loadingList}
        >
          {loadingList && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Refrescar
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loadingList ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Cargando comprobantes...</span>
          </div>
        ) : receipts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <Clock className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">
              {statusFilter === 'pending'
                ? 'No hay comprobantes pendientes de revisión'
                : 'No se encontraron comprobantes con este filtro'}
            </p>
          </div>
        ) : (
          <div>
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
              {receipts.length} comprobante(s) · Haz clic para abrir el panel de auditoría
            </div>
            {receipts.map(row => (
              <ReceiptRow key={row.id} row={row} onSelect={selectReceipt} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
