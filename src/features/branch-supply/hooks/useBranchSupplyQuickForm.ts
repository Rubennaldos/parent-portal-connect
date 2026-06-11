/**
 * Hook de orquestación del formulario de ingreso rápido (modo sin comprobante).
 *
 * Responsabilidades:
 *  - Mantener la lista de líneas (producto + cantidad + UoM).
 *  - Búsqueda de productos con debounce (reutiliza searchProducts del servicio).
 *  - Validar ANTES de enviar (muralla del cliente; la BD tiene su propia muralla).
 *  - Llamar submit_quick_stock_receipt vía submitQuickReceipt del servicio.
 *
 * Reglas de oro aplicadas:
 *  - CERO cálculo de stock aquí: solo quantity como string para el input.
 *  - CERO imports de logística central ni módulos legados.
 *  - El stock SOLO se mueve en el RPC de BD (atómico).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  searchProducts,
  fetchProductPackagings,
  submitQuickReceipt,
  extractRpcErrorMessage,
} from '../services/branchSupplyService';
import type {
  LineItem,
  ProductSearchResult,
  QuickReceiptItemPayload,
  QuickReceiptPayload,
} from '../types';

// ── Estado inicial ──────────────────────────────────────────────────────────────

let quickLineCounter = 0;
function makeEmptyQuickLine(): LineItem {
  return {
    uid:           `ql_${++quickLineCounter}`,
    productId:     '',
    productName:   '',
    productCode:   '',
    quantity:      '',
    uomId:         '',
    packagings:    [],
    searchQuery:   '',
    searchResults: [],
    searchLoading: false,
    showResults:   false,
  };
}

// ── Tipo de retorno ─────────────────────────────────────────────────────────────

export interface UseBranchSupplyQuickFormReturn {
  lines:      LineItem[];
  notes:      string;
  submitting: boolean;

  setNotes:         (v: string) => void;
  addLine:          () => void;
  removeLine:       (uid: string) => void;
  updateLineField:  (uid: string, field: 'quantity', value: string) => void;
  updateLineSearch: (uid: string, query: string) => void;
  selectProduct:    (uid: string, product: ProductSearchResult) => Promise<void>;
  selectUom:        (uid: string, uomId: string) => void;
  hideResults:      (uid: string) => void;
  handleSubmit:     () => Promise<void>;
  resetForm:        () => void;
}

// ── Hook principal ──────────────────────────────────────────────────────────────

export function useBranchSupplyQuickForm(
  schoolId:  string | null,
  onSuccess?: (receiptNumber: string) => void,
): UseBranchSupplyQuickFormReturn {
  const { toast } = useToast();

  const [lines,      setLines]      = useState<LineItem[]>([makeEmptyQuickLine()]);
  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Handlers de líneas (patrón idéntico al formulario estándar) ────────────

  const addLine = useCallback(() => {
    setLines(prev => [...prev, makeEmptyQuickLine()]);
  }, []);

  const removeLine = useCallback((uid: string) => {
    setLines(prev => prev.filter(l => l.uid !== uid));
  }, []);

  const updateLineField = useCallback(
    (uid: string, field: 'quantity', value: string) => {
      setLines(prev => prev.map(l => l.uid === uid ? { ...l, [field]: value } : l));
    },
    [],
  );

  const updateLineSearch = useCallback((uid: string, query: string) => {
    setLines(prev => prev.map(l =>
      l.uid === uid
        ? { ...l, searchQuery: query, showResults: true, searchLoading: true,
            productId: '', productName: '', productCode: '', packagings: [], uomId: '' }
        : l,
    ));
  }, []);

  // Búsqueda de productos con debounce 300 ms
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    lines.forEach(line => {
      if (!line.searchLoading || !line.searchQuery) return;

      const t = setTimeout(async () => {
        const results = await searchProducts(line.searchQuery);
        setLines(prev => prev.map(l =>
          l.uid === line.uid ? { ...l, searchResults: results, searchLoading: false } : l,
        ));
      }, 300);

      timers.push(t);
    });

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map(l => `${l.uid}:${l.searchQuery}:${l.searchLoading}`).join('|')]);

  const selectProduct = useCallback(async (uid: string, product: ProductSearchResult) => {
    setLines(prev => prev.map(l =>
      l.uid === uid
        ? {
            ...l,
            productId:     product.product_id,
            productName:   product.product_name,
            productCode:   product.product_code ?? '',
            searchQuery:   product.product_name,
            searchResults: [],
            showResults:   false,
            searchLoading: false,
            packagings:    [],
            uomId:         '',
          }
        : l,
    ));

    const packs = await fetchProductPackagings(product.product_id);
    setLines(prev => prev.map(l =>
      l.uid === uid ? { ...l, packagings: packs } : l,
    ));
  }, []);

  const selectUom = useCallback((uid: string, uomId: string) => {
    setLines(prev => prev.map(l => l.uid === uid ? { ...l, uomId } : l));
  }, []);

  const hideResults = useCallback((uid: string) => {
    setLines(prev => prev.map(l =>
      l.uid === uid ? { ...l, showResults: false } : l,
    ));
  }, []);

  // ── Reset ──────────────────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setLines([makeEmptyQuickLine()]);
    setNotes('');
  }, []);

  // ── Validación del cliente ────────────────────────────────────────────────
  // Muralla ligera antes de llamar al RPC; la BD tiene su propia muralla.

  const validateRef = useRef({ lines, schoolId });
  validateRef.current = { lines, schoolId };

  function validateQuickForm(): string | null {
    if (!validateRef.current.schoolId) {
      return 'No se encontró la sede asociada a tu perfil.';
    }

    const validLines = validateRef.current.lines.filter(
      l => l.productId && parseFloat(l.quantity) > 0,
    );

    if (validLines.length === 0) {
      return 'Agrega al menos un producto con cantidad válida.';
    }

    for (const l of validLines) {
      if (isNaN(parseFloat(l.quantity)) || parseFloat(l.quantity) <= 0) {
        return `El producto "${l.productName}" requiere una cantidad mayor a 0.`;
      }
    }

    return null;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const validationError = validateQuickForm();
    if (validationError) {
      toast({ title: 'Datos incompletos', description: validationError, variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    const validItems: QuickReceiptItemPayload[] = lines
      .filter(l => l.productId && parseFloat(l.quantity) > 0)
      .map(l => ({
        product_id: l.productId,
        quantity:   Math.round(parseFloat(l.quantity)),
        uom_id:     l.uomId || null,
      }));

    const payload: QuickReceiptPayload = {
      schoolId: schoolId!,
      items:    validItems,
      notes:    notes.trim() || null,
    };

    try {
      const result = await submitQuickReceipt(payload);

      toast({
        title:       `Stock actualizado — ${result.receipt_number}`,
        description: 'El ingreso rápido se registró y el stock se actualizó al instante.',
        duration:    6000,
      });

      resetForm();
      onSuccess?.(result.receipt_number);

    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      toast({
        title:       'Error al registrar el ingreso',
        description: msg,
        variant:     'destructive',
        duration:    8000,
      });
    } finally {
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, notes, schoolId, toast, onSuccess, resetForm]);

  return {
    lines,
    notes,
    submitting,
    setNotes,
    addLine,
    removeLine,
    updateLineField,
    updateLineSearch,
    selectProduct,
    selectUom,
    hideResults,
    handleSubmit,
    resetForm,
  };
}
