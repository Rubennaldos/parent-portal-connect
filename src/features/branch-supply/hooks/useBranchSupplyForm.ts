/**
 * Hook de orquestación del formulario de carga de comprobantes de sede.
 *
 * SEDE CIEGA DE COSTOS (v2):
 *  - Sin campo unitCost en las líneas: items se envían con unit_cost=0.
 *  - Sin pricesIncludeIgv: el Auditor General lo establece al aprobar.
 *  - Sin preview_branch_supply_totals: no hay costos que comparar en la sede.
 *  - Buscador de proveedores: search_suppliers_smart con debounce (no dropdown estático).
 *
 * Reglas de oro aplicadas:
 *  - CERO .reduce() para cálculos financieros.
 *  - El stock lo aplica submit_branch_supply_receipt en BD (inmediato).
 *  - NUNCA importar nada de logística central ni módulos legados.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  searchSuppliersSmart,
  searchProducts,
  fetchProductPackagings,
  submitReceipt,
  extractRpcErrorMessage,
} from '../services/branchSupplyService';
import {
  uploadEvidence,
  deleteOrphanedEvidence,
} from '../services/branchSupplyEvidenceService';
import type {
  HeaderFields,
  LineItem,
  SupplierOption,
  ProductSearchResult,
  EvidenceUploadState,
  ReceiptItemPayload,
  SubmitReceiptPayload,
  SupplierSearchState,
} from '../types';
import { EMPTY_EVIDENCE, EMPTY_SUPPLIER_SEARCH } from '../types';

// ── Helpers de estado inicial ──────────────────────────────────────────────────

function makeEmptyHeader(): HeaderFields {
  return {
    supplierId:  '',
    docType:     'boleta',
    docNumber:   '',
    notes:       '',
  };
}

let lineCounter = 0;
function makeEmptyLine(): LineItem {
  return {
    uid:           `line_${++lineCounter}`,
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

// ── Tipos de retorno del hook ──────────────────────────────────────────────────

export interface UseBranchSupplyFormReturn {
  // Estado
  header:           HeaderFields;
  lines:            LineItem[];
  supplierSearch:   SupplierSearchState;
  evidence:         EvidenceUploadState;
  submitting:       boolean;

  // Handlers cabecera
  setHeaderField: <K extends keyof HeaderFields>(field: K, value: HeaderFields[K]) => void;

  // Handlers búsqueda de proveedor
  updateSupplierQuery:  (query: string) => void;
  selectSupplier:       (supplier: SupplierOption) => void;
  clearSupplier:        () => void;
  hideSupplierResults:  () => void;

  // Handlers líneas
  addLine:          () => void;
  removeLine:       (uid: string) => void;
  updateLineField:  (uid: string, field: 'quantity', value: string) => void;
  updateLineSearch: (uid: string, query: string) => void;
  selectProduct:    (uid: string, product: ProductSearchResult) => Promise<void>;
  selectUom:        (uid: string, uomId: string) => void;
  hideResults:      (uid: string) => void;

  // Handlers evidencia
  handleFileChange: (file: File) => Promise<void>;
  removeEvidence:   () => void;

  // Submit
  handleSubmit: () => Promise<void>;

  // Util
  resetForm: () => void;
}

// ── Hook principal ─────────────────────────────────────────────────────────────

export function useBranchSupplyForm(
  schoolId: string | null,
  onSuccess?: (receiptNumber: string) => void,
): UseBranchSupplyFormReturn {
  const { toast } = useToast();

  const [header, setHeader] = useState<HeaderFields>(makeEmptyHeader);
  const [lines,  setLines]  = useState<LineItem[]>([makeEmptyLine()]);

  const [supplierSearch, setSupplierSearch] = useState<SupplierSearchState>(EMPTY_SUPPLIER_SEARCH);
  const supplierDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [evidence,   setEvidence]   = useState<EvidenceUploadState>(EMPTY_EVIDENCE);
  const [submitting, setSubmitting] = useState(false);

  // Ref para limpiar archivo huérfano en caso de fallo de submit
  const uploadedPathRef = useRef<string | null>(null);

  // ── Handlers de cabecera ─────────────────────────────────────────────────────

  const setHeaderField = useCallback(
    <K extends keyof HeaderFields>(field: K, value: HeaderFields[K]) => {
      setHeader(prev => ({ ...prev, [field]: value }));
    },
    [],
  );

  // ── Buscador de proveedores (search_suppliers_smart con debounce 300 ms) ──────

  const updateSupplierQuery = useCallback((query: string) => {
    setSupplierSearch(prev => ({
      ...prev,
      query,
      loading:     true,
      showResults: true,
      // Limpiar selección actual si el usuario está escribiendo distinto
      selected: prev.selected?.name === query ? prev.selected : null,
    }));
    // Limpiar también el supplierId en la cabecera
    setHeader(prev => ({ ...prev, supplierId: '' }));

    if (supplierDebounceRef.current) clearTimeout(supplierDebounceRef.current);

    supplierDebounceRef.current = setTimeout(async () => {
      const results = await searchSuppliersSmart(query);
      setSupplierSearch(prev => ({ ...prev, results, loading: false }));
    }, 300);
  }, []);

  const selectSupplier = useCallback((supplier: SupplierOption) => {
    setSupplierSearch(prev => ({
      ...prev,
      query:       supplier.name,
      selected:    supplier,
      results:     [],
      loading:     false,
      showResults: false,
    }));
    setHeader(prev => ({ ...prev, supplierId: supplier.id }));
  }, []);

  const clearSupplier = useCallback(() => {
    setSupplierSearch(EMPTY_SUPPLIER_SEARCH);
    setHeader(prev => ({ ...prev, supplierId: '' }));
  }, []);

  const hideSupplierResults = useCallback(() => {
    setSupplierSearch(prev => ({ ...prev, showResults: false }));
  }, []);

  // Cargar lista inicial de proveedores al montar (query vacía = top 10)
  useEffect(() => {
    let active = true;
    setSupplierSearch(prev => ({ ...prev, loading: true }));
    searchSuppliersSmart('').then(results => {
      if (active) setSupplierSearch(prev => ({ ...prev, results, loading: false }));
    }).catch(() => {
      if (active) setSupplierSearch(prev => ({ ...prev, loading: false }));
    });
    return () => { active = false; };
  }, []);

  // ── Handlers de líneas ───────────────────────────────────────────────────────

  const addLine = useCallback(() => {
    setLines(prev => [...prev, makeEmptyLine()]);
  }, []);

  const removeLine = useCallback((uid: string) => {
    setLines(prev => prev.filter(l => l.uid !== uid));
  }, []);

  // Solo 'quantity' es editable en la sede (sin unitCost)
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

  // Búsqueda de productos con debounce 300 ms (por línea)
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
            // Sin unitCost: la sede no ve ni registra costos
          }
        : l,
    ));

    // Cargar empaques autorizados para sede
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

  // ── Upload de evidencia ──────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (file: File) => {
    if (!schoolId) {
      toast({ title: 'Error', description: 'No se encontró la sede asociada.', variant: 'destructive' });
      return;
    }

    setEvidence({ file, path: null, progress: 0, uploading: true, error: null });

    const receiptUuid = crypto.randomUUID();

    try {
      const { storagePath } = await uploadEvidence(file, schoolId, receiptUuid, {
        onProgress: (pct) => setEvidence(prev => ({ ...prev, progress: pct })),
      });

      uploadedPathRef.current = storagePath;
      setEvidence({ file, path: storagePath, progress: 100, uploading: false, error: null });

    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      setEvidence({ file: null, path: null, progress: 0, uploading: false, error: msg });
      toast({ title: 'Error al subir comprobante', description: msg, variant: 'destructive' });
    }
  }, [schoolId, toast]);

  const removeEvidence = useCallback(() => {
    uploadedPathRef.current = null;
    setEvidence(EMPTY_EVIDENCE);
  }, []);

  // ── Validación previa al submit ──────────────────────────────────────────────

  function validateForm(): string | null {
    if (!schoolId)                  return 'No se encontró la sede asociada a tu perfil.';
    if (!header.supplierId)         return 'Debes seleccionar un proveedor de la lista.';
    const validLines = lines.filter(l => l.productId && parseFloat(l.quantity) > 0);
    if (validLines.length === 0)    return 'Agrega al menos un producto con cantidad válida.';

    for (const l of validLines) {
      if (isNaN(parseFloat(l.quantity)) || parseFloat(l.quantity) <= 0) {
        return `El producto "${l.productName}" requiere una cantidad mayor a 0.`;
      }
    }

    return null;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const validationError = validateForm();
    if (validationError) {
      toast({ title: 'Datos incompletos', description: validationError, variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    // SEDE CIEGA: unit_cost siempre 0; los costos reales los fija el Auditor General
    const validItems: ReceiptItemPayload[] = lines
      .filter(l => l.productId && parseFloat(l.quantity) > 0)
      .map(l => ({
        product_id: l.productId,
        quantity:   Math.round(parseFloat(l.quantity)),
        unit_cost:  0,
        uom_id:     l.uomId || null,
      }));

    const payload: SubmitReceiptPayload = {
      schoolId:     schoolId!,
      supplierId:   header.supplierId,
      docType:      header.docType,
      docNumber:    header.docNumber.trim() || null,
      notes:        header.notes.trim() || null,
      evidencePath: evidence.path,
      items:        validItems,
    };

    try {
      const result = await submitReceipt(payload);

      const description = result.warning
        ? `${result.warning} El stock de esta sede ya fue actualizado.`
        : 'El ingreso quedó registrado y el stock de esta sede ya subió al inventario.';

      toast({
        title:       `Ingreso registrado — ${result.receipt_number}`,
        description,
        duration:    8000,
      });

      uploadedPathRef.current = null;
      resetForm();
      onSuccess?.(result.receipt_number);

    } catch (err: unknown) {
      // RPC falló: limpiar archivo huérfano del bucket
      if (uploadedPathRef.current) {
        deleteOrphanedEvidence(uploadedPathRef.current);
        uploadedPathRef.current = null;
        setEvidence(EMPTY_EVIDENCE);
      }

      const msg = extractRpcErrorMessage(err);
      toast({
        title:       'Error al enviar el comprobante',
        description: msg,
        variant:     'destructive',
        duration:    8000,
      });
    } finally {
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, lines, evidence, schoolId, toast, onSuccess]);

  // ── Reset ────────────────────────────────────────────────────────────────────

  function resetForm() {
    setHeader(makeEmptyHeader());
    setLines([makeEmptyLine()]);
    setEvidence(EMPTY_EVIDENCE);
    setSupplierSearch(EMPTY_SUPPLIER_SEARCH);
    uploadedPathRef.current = null;
  }

  return {
    header,
    lines,
    supplierSearch,
    evidence,
    submitting,
    setHeaderField,
    updateSupplierQuery,
    selectSupplier,
    clearSupplier,
    hideSupplierResults,
    addLine,
    removeLine,
    updateLineField,
    updateLineSearch,
    selectProduct,
    selectUom,
    hideResults,
    handleFileChange,
    removeEvidence,
    handleSubmit,
    resetForm,
  };
}
