/**
 * Hook de orquestación para el Panel Dual de Auditoría de Comprobantes de Sede.
 *
 * ENDURECIMIENTO v2 — AUDITOR PROPIETARIO DE COSTOS:
 *  1. Al seleccionar un comprobante, se inicializa costItems[] con unit_cost=''
 *     (vacío) para cada ítem. El auditor los llena desde la factura física.
 *  2. pricesIncludeIgvAudit: switch que el auditor activa si los precios de la
 *     factura ya incluyen IGV.
 *  3. auditPreview: resultado del RPC preview_branch_supply_totals con debounce
 *     500ms. SSOT del match score mientras el auditor tipea costos.
 *  4. canApprove = auditPreview?.matched === true && status === 'pending'
 *  5. handleApprove pasa al RPC: [item_id, unit_cost][] + pricesIncludeIgv.
 *
 * Reglas de oro:
 *  - CERO .reduce() para suma de costos: usa preview_branch_supply_totals (RPC).
 *  - El match_score del servidor es la única fuente de verdad del cotejo.
 *  - El stock solo se toca en approveReceipt(); este hook nunca escribe stock.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchReceiptsSummary,
  getReceiptDetail,
  approveReceipt,
  rejectReceipt,
  previewTotals,
  extractRpcErrorMessage,
} from '../services/branchSupplyService';
import { getEvidenceSignedUrl } from '../services/branchSupplyEvidenceService';
import type {
  ReceiptSummaryRow,
  ReceiptDetail,
  ReceiptStatus,
  CostItemInput,
  MatchPreview,
} from '../types';

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface RejectModalState {
  open:       boolean;
  reason:     string;
  fieldError: string | null;
}

const CLOSED_REJECT_MODAL: RejectModalState = {
  open:       false,
  reason:     '',
  fieldError: null,
};

// ── Tipo de retorno del hook ──────────────────────────────────────────────────

export interface UseBranchSupplyAuditReturn {
  // Lista
  receipts:        ReceiptSummaryRow[];
  loadingList:     boolean;
  statusFilter:    ReceiptStatus | 'all';
  setStatusFilter: (v: ReceiptStatus | 'all') => void;

  // Detalle (split-screen)
  selectedId:    string | null;
  detail:        ReceiptDetail | null;
  loadingDetail: boolean;

  // Evidencia
  signedUrl:        string | null;
  loadingSignedUrl: boolean;

  // ── Estado de costos del auditor ─────────────────────────────────────────
  costItems:            CostItemInput[];
  pricesIncludeIgvAudit: boolean;
  auditPreview:         MatchPreview | null;
  auditPreviewLoading:  boolean;
  /** true cuando todos los items tienen cost > 0 y el server dice matched */
  canApprove:           boolean;

  // Handlers de costos
  updateItemCost:           (itemId: string, cost: string) => void;
  setAuditPricesIncludeIgv: (v: boolean) => void;

  // Aprobación
  approving: boolean;

  // Modal de rechazo
  rejectModal:      RejectModalState;
  rejecting:        boolean;

  // Handlers
  selectReceipt:    (id: string) => void;
  clearSelection:   () => void;
  handleApprove:    () => Promise<void>;
  openRejectModal:  () => void;
  closeRejectModal: () => void;
  setRejectReason:  (v: string) => void;
  handleReject:     () => Promise<void>;
  refreshList:      () => void;
}

// ── Hook principal ─────────────────────────────────────────────────────────────

export function useBranchSupplyAudit(): UseBranchSupplyAuditReturn {
  const { toast } = useToast();

  const [receipts,       setReceipts]       = useState<ReceiptSummaryRow[]>([]);
  const [loadingList,    setLoadingList]     = useState(false);
  const [statusFilter,   setStatusFilterRaw] = useState<ReceiptStatus | 'all'>('pending');

  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [detail,         setDetail]         = useState<ReceiptDetail | null>(null);
  const [loadingDetail,  setLoadingDetail]  = useState(false);

  const [signedUrl,        setSignedUrl]        = useState<string | null>(null);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);

  // ── Estado de costos del auditor ────────────────────────────────────────────
  const [costItems,             setCostItems]             = useState<CostItemInput[]>([]);
  const [pricesIncludeIgvAudit, setPricesIncludeIgvAudit] = useState(false);
  const [auditPreview,          setAuditPreview]          = useState<MatchPreview | null>(null);
  const [auditPreviewLoading,   setAuditPreviewLoading]   = useState(false);

  const [approving,   setApproving]   = useState(false);
  const [rejectModal, setRejectModal] = useState<RejectModalState>(CLOSED_REJECT_MODAL);
  const [rejecting,   setRejecting]   = useState(false);

  const mountedRef         = useRef(true);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Carga de la lista ──────────────────────────────────────────────────────

  const loadList = useCallback(async (filter: ReceiptStatus | 'all') => {
    setLoadingList(true);
    try {
      const rows = await fetchReceiptsSummary(filter);
      if (mountedRef.current) setReceipts(rows);
    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      toast({ title: 'Error al cargar comprobantes', description: msg, variant: 'destructive' });
    } finally {
      if (mountedRef.current) setLoadingList(false);
    }
  }, [toast]);

  useEffect(() => { loadList(statusFilter); }, [statusFilter, loadList]);

  const refreshList = useCallback(() => loadList(statusFilter), [statusFilter, loadList]);

  const setStatusFilter = useCallback((v: ReceiptStatus | 'all') => {
    setStatusFilterRaw(v);
    setSelectedId(null);
    setDetail(null);
    setSignedUrl(null);
    setCostItems([]);
    setAuditPreview(null);
    setPricesIncludeIgvAudit(false);
  }, []);

  // ── Selección de comprobante ───────────────────────────────────────────────

  const selectReceipt = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setSignedUrl(null);
    setCostItems([]);
    setAuditPreview(null);
    setPricesIncludeIgvAudit(false);
    setLoadingDetail(true);

    try {
      const d = await getReceiptDetail(id);
      if (!mountedRef.current) return;

      setDetail({
        ...d,
        receipt: {
          ...d.receipt,
          is_quick:     d.receipt.is_quick ?? false,
          supplier_id:  d.receipt.supplier_id ?? null,
          match_score:  d.receipt.match_score ?? null,
        },
        items:    d.items ?? [],
        supplier: d.supplier ?? null,
        school:   d.school ?? null,
      });

      // Inicializar costItems con vacíos (el auditor llena desde la factura física)
      setCostItems((d.items ?? []).map(item => ({
        item_id:   item.id,
        unit_cost: item.unit_cost > 0 ? String(item.unit_cost) : '',
      })));

      // Evidencia: generar URL firmada (10 min)
      if (d.receipt.evidence_path) {
        setLoadingSignedUrl(true);
        try {
          const url = await getEvidenceSignedUrl(d.receipt.evidence_path);
          if (mountedRef.current) setSignedUrl(url);
        } catch {
          if (mountedRef.current) setSignedUrl(null);
        } finally {
          if (mountedRef.current) setLoadingSignedUrl(false);
        }
      }
    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      toast({ title: 'Error al cargar comprobante', description: msg, variant: 'destructive' });
      if (mountedRef.current) { setSelectedId(null); setDetail(null); }
    } finally {
      if (mountedRef.current) setLoadingDetail(false);
    }
  }, [toast]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setSignedUrl(null);
    setCostItems([]);
    setAuditPreview(null);
    setPricesIncludeIgvAudit(false);
  }, []);

  // ── Handlers de costos ────────────────────────────────────────────────────

  const updateItemCost = useCallback((itemId: string, cost: string) => {
    setCostItems(prev => prev.map(ci =>
      ci.item_id === itemId ? { ...ci, unit_cost: cost } : ci,
    ));
  }, []);

  const setAuditPricesIncludeIgv = useCallback((v: boolean) => {
    setPricesIncludeIgvAudit(v);
  }, []);

  // ── Preview de cotejo del auditor — debounce 500 ms ────────────────────────
  // Respeta SSOT: el servidor calcula la suma, no el cliente.
  // Se dispara cuando cambian costItems o pricesIncludeIgv.

  useEffect(() => {
    if (!detail) return;

    // Necesitamos items del detalle (para las cantidades) y los costos del auditor
    const pairs = (detail.items ?? []).map(item => {
      const ci  = costItems.find(c => c.item_id === item.id);
      const cost = parseFloat(ci?.unit_cost ?? '0');
      return { quantity: item.quantity, unit_cost: isNaN(cost) ? 0 : cost };
    });

    // Si ningún costo fue llenado aún, limpiar preview
    const hasAnyCost = pairs.some(p => p.unit_cost > 0);
    if (!hasAnyCost) {
      setAuditPreview(null);
      return;
    }

    setAuditPreviewLoading(true);

    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);

    previewDebounceRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const preview = await previewTotals(detail.receipt.declared_total, pairs);
        if (mountedRef.current) setAuditPreview(preview);
      } catch {
        if (mountedRef.current) setAuditPreview(null);
      } finally {
        if (mountedRef.current) setAuditPreviewLoading(false);
      }
    }, 500);

    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    detail?.receipt.id,
    detail?.receipt.declared_total,
    // Stringify mínimo para activar el effect solo cuando cambian costos
    costItems.map(c => `${c.item_id}:${c.unit_cost}`).join('|'),
  ]);

  // canApprove: solo si el servidor confirma que la suma cuadra al céntimo
  const canApprove =
    !!detail &&
    detail.receipt.status === 'pending' &&
    auditPreview?.matched === true &&
    !approving;

  // ── Aprobación con costos ─────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!selectedId || !detail) return;

    // Muralla de cliente (el RPC también valida; esta capa evita clics accidentales)
    if (!auditPreview?.matched) {
      const costOnly = (detail.receipt.declared_total ?? 0) <= 0;
      toast({
        title:       'No se puede aprobar',
        description: costOnly
          ? 'Ingresa costos unitarios válidos en todos los ítems. El servidor exige suma mayor a S/ 0.'
          : 'La suma de costos no coincide con el monto declarado por la sede (comprobante legacy).',
        variant:     'destructive',
      });
      return;
    }

    // Validar que todos los ítems tengan costo >= 0 ingresado
    const parsedCosts = costItems.map(ci => ({
      item_id:   ci.item_id,
      unit_cost: parseFloat(ci.unit_cost),
    }));

    const hasInvalidCost = parsedCosts.some(c => isNaN(c.unit_cost) || c.unit_cost < 0);
    if (hasInvalidCost) {
      toast({
        title:       'Costos incompletos',
        description: 'Todos los ítems deben tener un costo unitario válido (≥ 0) antes de aprobar.',
        variant:     'destructive',
      });
      return;
    }

    setApproving(true);
    try {
      const result = await approveReceipt({
        receiptId:        selectedId,
        costItems:        parsedCosts,
        pricesIncludeIgv: pricesIncludeIgvAudit,
      });

      toast({
        title:       `Aprobado — ${result.receipt_number}`,
        description: `${result.items_approved} ítem(s) incorporados al inventario. `
                   + `Total auditado en BD: S/ ${result.declared_total.toFixed(2)}.`,
        duration:    8000,
      });

      // Actualizar estado local
      setDetail(prev => prev ? {
        ...prev,
        receipt: { ...prev.receipt, status: 'approved' },
      } : null);
      setReceipts(prev => prev.filter(r => r.id !== selectedId));
      clearSelection();

    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      toast({ title: 'Error al aprobar', description: msg, variant: 'destructive', duration: 8000 });
    } finally {
      if (mountedRef.current) setApproving(false);
    }
  }, [selectedId, detail, auditPreview, costItems, pricesIncludeIgvAudit, toast, clearSelection]);

  // ── Modal de rechazo ───────────────────────────────────────────────────────

  const openRejectModal  = useCallback(() => setRejectModal({ open: true, reason: '', fieldError: null }), []);
  const closeRejectModal = useCallback(() => setRejectModal(CLOSED_REJECT_MODAL), []);

  const setRejectReason = useCallback((v: string) => {
    setRejectModal(prev => ({ ...prev, reason: v, fieldError: null }));
  }, []);

  const handleReject = useCallback(async () => {
    if (!selectedId) return;

    const trimmedReason = rejectModal.reason.trim();
    if (!trimmedReason) {
      setRejectModal(prev => ({
        ...prev,
        fieldError: 'El motivo de rechazo es obligatorio. Escribe una explicación clara para la sede.',
      }));
      return;
    }

    setRejecting(true);
    try {
      const result = await rejectReceipt(selectedId, trimmedReason);

      toast({
        title:       `Rechazado — ${result.receipt_number}`,
        description: 'Motivo registrado. El stock permanece intacto.',
        duration:    6000,
      });

      setRejectModal(CLOSED_REJECT_MODAL);
      setDetail(prev => prev ? {
        ...prev,
        receipt: { ...prev.receipt, status: 'rejected', rejection_reason: trimmedReason },
      } : null);
      setReceipts(prev => prev.filter(r => r.id !== selectedId));
      clearSelection();

    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      toast({ title: 'Error al rechazar', description: msg, variant: 'destructive', duration: 8000 });
    } finally {
      if (mountedRef.current) setRejecting(false);
    }
  }, [selectedId, rejectModal.reason, toast, clearSelection]);

  return {
    receipts,
    loadingList,
    statusFilter,
    setStatusFilter,
    selectedId,
    detail,
    loadingDetail,
    signedUrl,
    loadingSignedUrl,
    costItems,
    pricesIncludeIgvAudit,
    auditPreview,
    auditPreviewLoading,
    canApprove,
    updateItemCost,
    setAuditPricesIncludeIgv,
    approving,
    rejectModal,
    rejecting,
    selectReceipt,
    clearSelection,
    handleApprove,
    openRejectModal,
    closeRejectModal,
    setRejectReason,
    handleReject,
    refreshList,
  };
}
