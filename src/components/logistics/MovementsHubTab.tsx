import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  PackagePlus, ArrowRightLeft, Plus, Loader2, CheckCircle2, Trash2,
  Camera, FileText, ChevronRight, ChevronLeft, AlertTriangle,
  Building2, ClipboardList, Package, ArrowRight, Search, Warehouse,
  Sparkles,
} from 'lucide-react';
import { SuppliersTab } from '@/components/logistics/SuppliersTab';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Supplier { id: string; name: string; ruc: string | null }
interface School   { id: string; name: string }

interface SearchResult {
  product_id:    string;
  product_name:  string;
  product_code:  string | null;
  category:      string;
  last_unit_cost: number;
  relevance:     number;
}

interface DistItem {
  uid:           string;
  product_id:    string;
  productName:   string;
  total:         string;
  unit_cost:     string;
  dist:          Record<string, string>;     // schoolId → qty string
  searchQuery:   string;
  searchResults: SearchResult[];
  searchLoading: boolean;
  showResults:   boolean;
}

interface TransferLine {
  uid:        string;
  product_id: string;
  productName: string;
  quantity:   string;
  searchQuery:   string;
  searchResults: SearchResult[];
  searchLoading: boolean;
  showResults:   boolean;
}

interface RecentTx {
  id: string;
  created_at: string;
  internal_transaction_id: string;
  supplier_id: string | null;
  doc_type: string;
  vendor_doc_number: string | null;
  total_amount: number;
  evidence_url: string | null;
  is_warehouse_only: boolean;
  supplier: { name: string } | null;
}

interface RecentTransfer {
  id: string;
  created_at: string;
  transfer_number: string | null;
  status: string;
  contact_person: string | null;
  from_school: { name: string } | null;
  to_school:   { name: string } | null;
}

interface GeneratedGuide {
  fileName: string;
  destinationSchool: string;
  doc: jsPDF;
  storagePath?: string; // poblado cuando ya fue persistida en Storage
}

interface PersistedGuideMetadata {
  guide_id: string;
  destination_label: string;
  storage_path: string;
  storage_bucket: string;
  generated_at: string;
}

interface IngressDetailLine {
  productName: string;
  quantity: number;
  unitCost: number;
}

interface TransferDetailLine {
  productName: string;
  quantity: number;
}

interface InsufficientStockAlertState {
  open: boolean;
  productName: string;
  originLabel: string;
}

// Hash determinístico para idempotencia. Mismo payload → mismo hash → no se regenera el PDF.
function simpleHash(payload: object): string {
  const s = JSON.stringify(payload, Object.keys(payload).sort() as any);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const DOC_LABELS: Record<string, string> = {
  factura: 'Factura', boleta: 'Boleta', guia: 'Guía de remisión',
};
const WAREHOUSE_OPTION_ID = '__warehouse__';
const WAREHOUSE_LABEL = 'Almacen Central';

function uid()       { return Math.random().toString(36).slice(2); }
function fmtDate(s:string) {
  return new Date(s).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' });
}

function getErrorMessage(err: any): string {
  if (!err) return 'Error desconocido';
  if (typeof err.message === 'string' && err.message.trim()) return err.message;
  if (typeof err.details === 'string' && err.details.trim()) return err.details;
  if (typeof err.hint === 'string' && err.hint.trim()) return err.hint;
  if (typeof err.error_description === 'string' && err.error_description.trim()) return err.error_description;
  return JSON.stringify(err);
}

function relName(v: any): string {
  if (Array.isArray(v)) return v[0]?.name || 'Producto';
  return v?.name || 'Producto';
}

function getInsufficientStockProductName(errorMessage: string): string | null {
  const quoted = errorMessage.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1].trim();
  return null;
}

interface GuidePdfLine {
  productName: string;
  quantity: number;
  unitCost: number;
}

function buildGuidePdf(params: {
  internalId: string;
  guideNumber: string;
  supplierName: string;
  docType: string;
  docNumber: string;
  originLabel?: string;
  destinationSchool: string;
  lines: GuidePdfLine[];
}): { fileName: string; doc: jsPDF } {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('GUIA INTERNA DE TRASLADO', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nro Guia: ${params.guideNumber}`, 14, 24);
  doc.text(`Ref Ingreso: ${params.internalId}`, 14, 30);
  doc.text(`Proveedor: ${params.supplierName}`, 14, 36);
  doc.text(`Documento: ${params.docType} ${params.docNumber}`, 14, 42);
  doc.text(`Origen: ${params.originLabel || 'Almacen Central'}`, 14, 48);
  doc.text(`Destino: ${params.destinationSchool}`, 14, 54);
  doc.text(`Fecha: ${new Date().toLocaleString('es-PE')}`, 14, 60);

  autoTable(doc, {
    startY: 68,
    head: [['Producto', 'Cantidad', 'Costo Unit.', 'Subtotal']],
    body: params.lines.map(line => [
      line.productName,
      line.quantity.toString(),
      `S/ ${line.unitCost.toFixed(2)}`,
      `S/ ${(line.unitCost * line.quantity).toFixed(2)}`,
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 118, 110] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  const tableEnd = (doc as any).lastAutoTable?.finalY ?? 120;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Firma Entrega: __________________________', 14, tableEnd + 18);
  doc.text('Firma Recepcion: ________________________', pageWidth / 2, tableEnd + 18);

  const safeSchool = params.destinationSchool.replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    fileName: `${params.guideNumber}_${safeSchool}.pdf`,
    doc,
  };
}

function buildTransferGuidePdf(params: {
  transferNumber: string;
  originSchool: string;
  destinationSchool: string;
  notes?: string;
  lines: Array<{ productName: string; quantity: number }>;
}): { fileName: string; doc: jsPDF } {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('GUIA INTERNA DE TRASLADO', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nro Guia: ${params.transferNumber}`, 14, 24);
  doc.text(`Origen: ${params.originSchool}`, 14, 30);
  doc.text(`Destino: ${params.destinationSchool}`, 14, 36);
  doc.text(`Fecha: ${new Date().toLocaleString('es-PE')}`, 14, 42);
  if (params.notes?.trim()) {
    doc.text(`Notas: ${params.notes.trim()}`, 14, 48);
  }

  autoTable(doc, {
    startY: params.notes?.trim() ? 56 : 50,
    head: [['Producto', 'Cantidad']],
    body: params.lines.map(line => [line.productName, line.quantity.toString()]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  const tableEnd = (doc as any).lastAutoTable?.finalY ?? 120;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Firma Entrega: __________________________', 14, tableEnd + 18);
  doc.text('Firma Recepcion: ________________________', pageWidth / 2, tableEnd + 18);

  const safeGuide = params.transferNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return { fileName: `${safeGuide}.pdf`, doc };
}

// ─── Hook: búsqueda con debounce ──────────────────────────────────────────────

function useDebounce<T>(value: T, ms = 300): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return dv;
}

// ─── Componente: buscador de producto (reutilizable) ─────────────────────────

interface ProductSearchProps {
  query:       string;
  results:     SearchResult[];
  loading:     boolean;
  showResults: boolean;
  selected:    string;                                  // product_id seleccionado
  onQueryChange: (q: string) => void;
  onSelect:    (r: SearchResult) => void;
  onFastTrack: () => void;
  onBlur:      () => void;
}

function ProductSearchInput({
  query, results, loading, showResults, selected,
  onQueryChange, onSelect, onFastTrack, onBlur,
}: ProductSearchProps) {
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <Input
          className="h-10 pl-8 pr-3"
          placeholder="Buscar producto… (sin tildes, cualquier orden)"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onBlur={() => setTimeout(onBlur, 180)}
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-slate-400" />
        )}
      </div>

      {showResults && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-3 space-y-2">
              <p className="text-xs text-slate-400 text-center">Sin resultados para "{query}"</p>
              {query.trim().length >= 2 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-dashed text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  onMouseDown={onFastTrack}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Crear "{query.trim()}"
                </Button>
              )}
            </div>
          ) : (
            results.map(r => (
              <button
                key={r.product_id}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 border-b border-slate-100 last:border-0 ${
                  selected === r.product_id ? 'bg-emerald-50' : ''
                }`}
                onMouseDown={() => onSelect(r)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{r.product_name}</p>
                  <p className="text-[10px] text-slate-400">{r.category}</p>
                </div>
                {r.last_unit_cost > 0 && (
                  <span className="text-xs text-emerald-700 font-semibold shrink-0">
                    S/ {r.last_unit_cost.toFixed(2)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function MovementsHubTab({ schoolId }: { schoolId: string | null }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [schools,   setSchools]   = useState<School[]>([]);
  const [recentTx,  setRecentTx]  = useState<RecentTx[]>([]);
  const [recentTrf, setRecentTrf] = useState<RecentTransfer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [warehouseLocationId, setWarehouseLocationId] = useState<string | null>(null);

  const [section, setSection] = useState<'ingresos' | 'salidas' | 'proveedores'>('ingresos');
  const [modal,   setModal]   = useState<'ingreso' | 'salida' | null>(null);
  const [step,    setStep]    = useState(1);
  const [sStep,   setSStep]   = useState(1);
  const [saving,  setSaving]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatedGuides, setGeneratedGuides] = useState<GeneratedGuide[]>([]);
  const [showGuidesDialog, setShowGuidesDialog] = useState(false);
  // Mapa: source_id → lista de guías persistidas en Storage (para reimpresión sin regenerar)
  const [txGuidesMap, setTxGuidesMap] = useState<Record<string, PersistedGuideMetadata[]>>({});
  const [persistingGuides, setPersistingGuides] = useState(false);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<'ingreso' | 'salida' | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedTx, setSelectedTx] = useState<RecentTx | null>(null);
  const [selectedTrf, setSelectedTrf] = useState<RecentTransfer | null>(null);
  const [txDetailLines, setTxDetailLines] = useState<IngressDetailLine[]>([]);
  const [trfDetailLines, setTrfDetailLines] = useState<TransferDetailLine[]>([]);
  const [insufficientStockAlert, setInsufficientStockAlert] = useState<InsufficientStockAlertState>({
    open: false,
    productName: '',
    originLabel: '',
  });

  // ── Form Ingreso ─────────────────────────────────────────────────────────
  const [iSupplier,       setISupplier]       = useState('');
  const [iDocType,        setIDocType]        = useState<'boleta'|'factura'|'guia'>('factura');
  const [iDocNumber,      setIDocNumber]      = useState('');
  const [iEvidenceUrl,    setIEvidenceUrl]    = useState('');
  const [iNotes,          setINotes]          = useState('');
  const [iIsWarehouseOnly,  setIIsWarehouseOnly]  = useState(false);
  const [iPricesIncludeIgv, setIPricesIncludeIgv] = useState(false);
  const [iDistItems,        setIDistItems]        = useState<DistItem[]>([]);

  // ── Fast-Track de producto ─────────────────────────────────────────────
  const [showFT,    setShowFT]    = useState(false);
  const [ftForUid,  setFtForUid]  = useState('');     // DistItem uid que lo abrió
  const [ftName,    setFtName]    = useState('');
  const [ftCategory, setFtCategory] = useState('');
  const [ftSaving,  setFtSaving]  = useState(false);

  // ── Form Salida ───────────────────────────────────────────────────────
  const [sFrom,    setSFrom]    = useState('');
  const [sTo,      setSTo]      = useState('');
  const [sLines,   setSLines]   = useState<TransferLine[]>([
    { uid: uid(), product_id: '', productName: '', quantity: '1', searchQuery: '', searchResults: [], searchLoading: false, showResults: false },
  ]);
  const [sContact, setSContact] = useState('');
  const [sPhone,   setSPhone]   = useState('');
  const [sApprove, setSApprove] = useState('');
  const [sNotes,   setSNotes]   = useState('');
  const [sStockByProduct, setSStockByProduct] = useState<Record<string, number>>({});

  // ── Carga inicial ────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: sup }, { data: sch }, { data: tx }, { data: trf }, { data: whLocation }] = await Promise.all([
        supabase.from('suppliers').select('id, name, ruc').order('name'),
        supabase.from('schools').select('id, name').eq('is_active', true).order('name'),
        supabase
          .from('inventory_transactions')
          .select('id, created_at, supplier_id, internal_transaction_id, doc_type, vendor_doc_number, total_amount, evidence_url, is_warehouse_only, supplier:suppliers(name)')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('internal_transfers')
          .select(`id, created_at, transfer_number, status, contact_person,
                   from_school:schools!internal_transfers_from_school_id_fkey(name),
                   to_school:schools!internal_transfers_to_school_id_fkey(name)`)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('inventory_locations')
          .select('id')
          .eq('location_type', 'warehouse')
          .eq('is_primary', true)
          .eq('is_active', true)
          .maybeSingle(),
      ]);
      const activeSchools = (sch || []) as School[];
      const txList = (tx || []) as unknown as RecentTx[];
      const trfList = (trf || []) as unknown as RecentTransfer[];
      setSuppliers(sup || []);
      setSchools(activeSchools);
      setRecentTx(txList as unknown as RecentTx[]);
      setRecentTrf(trfList as unknown as RecentTransfer[]);
      setWarehouseLocationId((whLocation as { id?: string } | null)?.id ?? null);

      // Cargar guías persistidas para los movimientos visibles (en paralelo, sin bloquear UI)
      const allSourceIds = [
        ...txList.map(t => ({ type: 'ingress' as const, id: t.id })),
        ...trfList.map(t => ({ type: 'transfer' as const, id: t.id })),
      ];
      if (allSourceIds.length > 0) {
        const guideQueries = allSourceIds.map(s =>
          supabase
            .from('inventory_guides')
            .select('id, destination_label, storage_path, storage_bucket, generated_at')
            .eq('source_type', s.type)
            .eq('source_id', s.id)
            .eq('status', 'active')
            .order('destination_label')
        );
        const guideResults = await Promise.all(guideQueries);
        const nextMap: Record<string, PersistedGuideMetadata[]> = {};
        guideResults.forEach((res, idx) => {
          const rows = (res.data || []).map(r => ({
            guide_id: r.id,
            destination_label: r.destination_label,
            storage_path: r.storage_path,
            storage_bucket: r.storage_bucket,
            generated_at: r.generated_at,
          }));
          if (rows.length > 0) {
            nextMap[allSourceIds[idx].id] = rows;
          }
        });
        setTxGuidesMap(nextMap);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Búsqueda de productos (search_products_pro) ──────────────────────

  const searchProducts = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query || query.trim().length < 1) return [];
    const { data, error } = await supabase.rpc('search_products_pro', {
      p_query: query.trim(),
      p_limit: 8,
    });
    if (error) return [];
    return (data || []) as SearchResult[];
  }, []);

  // Actualizar búsqueda en DistItem
  const updateDistSearch = useCallback(async (itemUid: string, query: string) => {
    setIDistItems(prev => prev.map(d =>
      d.uid === itemUid ? { ...d, searchQuery: query, showResults: true, searchLoading: true } : d
    ));
    const results = await searchProducts(query);
    setIDistItems(prev => prev.map(d =>
      d.uid === itemUid ? { ...d, searchResults: results, searchLoading: false } : d
    ));
  }, [searchProducts]);

  // Actualizar búsqueda en TransferLine
  const updateLineSearch = useCallback(async (lineUid: string, query: string) => {
    setSLines(prev => prev.map(l =>
      l.uid === lineUid ? { ...l, searchQuery: query, showResults: true, searchLoading: true } : l
    ));
    const results = await searchProducts(query);
    setSLines(prev => prev.map(l =>
      l.uid === lineUid ? { ...l, searchResults: results, searchLoading: false } : l
    ));
  }, [searchProducts]);

  const schoolLabel = useCallback((s: School) => s.name, []);

  const fromIsWarehouse = sFrom === WAREHOUSE_OPTION_ID;
  const toIsWarehouse = sTo === WAREHOUSE_OPTION_ID;
  const involvesWarehouseInTransfer = fromIsWarehouse || toIsWarehouse;

  // Stock en tiempo real de la sede origen para el modal de salidas.
  useEffect(() => {
    const loadOriginStock = async () => {
      if (!sFrom) {
        setSStockByProduct({});
        return;
      }
      const productIds = Array.from(new Set(sLines.map(l => l.product_id).filter(Boolean)));
      if (productIds.length === 0) {
        setSStockByProduct({});
        return;
      }
      if (fromIsWarehouse) {
        const { data } = await supabase.rpc('get_warehouse_stock_for_products', { p_product_ids: productIds });
        const next: Record<string, number> = {};
        for (const row of (data || [])) {
          next[row.product_id] = row.current_stock ?? 0;
        }
        setSStockByProduct(next);
      } else {
        const { data, error } = await supabase
          .from('product_stock')
          .select('product_id, current_stock')
          .eq('school_id', sFrom)
          .in('product_id', productIds);
        if (error) return;
        const next: Record<string, number> = {};
        for (const row of (data || [])) {
          next[row.product_id] = row.current_stock ?? 0;
        }
        setSStockByProduct(next);
      }
    };
    loadOriginStock();
  }, [sFrom, sLines, fromIsWarehouse]);

  // ── Manejo de archivo ─────────────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { data, error } = await supabase.storage.from('logistic_documents').upload(path, file);
      if (error) throw error;
      setIEvidenceUrl(data.path);
      toast({ title: '✅ Archivo subido', description: file.name });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error subiendo archivo', description: err.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Gestión de DistItems ──────────────────────────────────────────────

  const addDistItem = () => {
    setIDistItems(prev => [...prev, {
      uid: uid(), product_id: '', productName: '', total: '', unit_cost: '',
      dist: Object.fromEntries(schools.map(s => [s.id, ''])),
      searchQuery: '', searchResults: [], searchLoading: false, showResults: false,
    }]);
  };

  const selectDistProduct = (itemUid: string, r: SearchResult) => {
    setIDistItems(prev => prev.map(d =>
      d.uid === itemUid ? {
        ...d,
        product_id:  r.product_id,
        productName: r.product_name,
        searchQuery: r.product_name,
        unit_cost:   r.last_unit_cost > 0 ? String(r.last_unit_cost) : d.unit_cost,
        showResults: false,
      } : d
    ));
  };

  const updateDist = (itemUid: string, schoolId: string, value: string) => {
    setIDistItems(prev => prev.map(d =>
      d.uid === itemUid ? { ...d, dist: { ...d.dist, [schoolId]: value } } : d
    ));
  };

  const sumDist   = (d: DistItem) => Object.values(d.dist).reduce((a, v) => a + (parseInt(v) || 0), 0);
  const isDistValid = (d: DistItem) => {
    const t = parseInt(d.total) || 0;
    return d.product_id && t > 0 && (iIsWarehouseOnly || sumDist(d) === t);
  };

  // ── Fast-Track de producto ────────────────────────────────────────────

  const openFastTrack = (itemUid: string, name: string) => {
    setFtForUid(itemUid); setFtName(name); setFtCategory('');
    setShowFT(true);
  };

  const submitFastTrack = async () => {
    if (!ftName.trim()) return;
    setFtSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_product_fast', {
        p_name:      ftName.trim(),
        p_category:  ftCategory.trim() || null,
        p_min_stock: 0,
      });
      if (error) throw error;
      const result = data as any;
      const newProduct: SearchResult = {
        product_id: result.product_id,
        product_name: ftName.trim(),
        product_code: null,
        category: ftCategory.trim() || 'Sin categoría',
        last_unit_cost: 0,
        relevance: 1,
      };
      selectDistProduct(ftForUid, newProduct);
      toast({
        title: result.was_existing ? '✅ Producto encontrado' : '✅ Producto creado',
        description: result.message,
      });
      setShowFT(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setFtSaving(false);
    }
  };

  // ── Preview de guías DESDE EL FORMULARIO (independiente del RPC) ──────
  // Funciona aunque la migración no esté aplicada aún.

  const buildPreviewGuides = (): GeneratedGuide[] => {
    const supplierName = suppliers.find(s => s.id === iSupplier)?.name || 'Proveedor';
    const perSchool = new Map<string, GuidePdfLine[]>();

    for (const item of iDistItems) {
      for (const school of schools) {
        const qty = parseInt(item.dist[school.id] || '0') || 0;
        if (qty <= 0) continue;
        const lines = perSchool.get(school.id) || [];
        lines.push({
          productName: item.productName || 'Producto',
          quantity:    qty,
          unitCost:    parseFloat(item.unit_cost) || 0,
        });
        perSchool.set(school.id, lines);
      }
    }

    const result: GeneratedGuide[] = [];
    let n = 1;
    for (const [schoolId, lines] of perSchool.entries()) {
      const schoolName = schools.find(s => s.id === schoolId)?.name || 'Sede';
      const guideNumber = `GUIA-${iDocNumber.trim() || 'BORRADOR'}-${String(n).padStart(2, '0')}`;
      const generated = buildGuidePdf({
        internalId:        `(por confirmar)`,
        guideNumber,
        supplierName,
        docType:           DOC_LABELS[iDocType] || iDocType,
        docNumber:         iDocNumber.trim() || '-',
        originLabel:       'Proveedor / Almacén Central',
        destinationSchool: schoolName,
        lines,
      });
      result.push({ ...generated, destinationSchool: schoolName });
      n += 1;
    }
    return result;
  };

  const openPreviewGuides = () => {
    const guides = buildPreviewGuides();
    if (guides.length === 0) {
      toast({ variant: 'destructive', title: 'Sin sedes con cantidades', description: 'Ingresa cantidades por sede primero.' });
      return;
    }
    setGeneratedGuides(guides);
    setShowGuidesDialog(true);
  };

  const openEvidence = async (evidenceUrl: string, autoPrint = false) => {
    try {
      const cleanPath = evidenceUrl.replace(/^\/+/, '');
      const { data, error } = await supabase.storage
        .from('logistic_documents')
        .createSignedUrl(cleanPath, 60 * 10);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('No se pudo generar el enlace del comprobante');
      const win = window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      if (autoPrint && win) {
        win.addEventListener('load', () => {
          try {
            win.print();
          } catch {
            // noop: algunos visores PDF bloquean print automático
          }
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo abrir el comprobante',
        description: getErrorMessage(err),
      });
    }
  };

  // ── Abrir guía desde Storage (URL firmada, 15 min) ────────────────────────
  const openGuideFromStorage = async (storagePath: string, autoPrint = false) => {
    try {
      const { data, error } = await supabase.storage
        .from('logistic_documents')
        .createSignedUrl(storagePath, 60 * 15);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('No se pudo generar el enlace de la guía');
      const win = window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      if (autoPrint && win) {
        win.addEventListener('load', () => { try { win.print(); } catch { /* algunos visores PDF bloquean print */ } });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'No se pudo abrir la guía', description: getErrorMessage(err) });
    }
  };

  // ── Subir PDF a Storage y registrar metadatos en DB (idempotente) ──────────
  // Devuelve el storage_path si tiene éxito, null si falla (no bloquea el flujo principal).
  const uploadAndRegisterGuide = async (
    doc: jsPDF,
    params: {
      sourceType: 'ingress' | 'transfer' | 'transfer_warehouse';
      sourceId:   string;
      businessRef: string;
      destinationLabel: string;
      contentHashPayload: object;
    }
  ): Promise<string | null> => {
    try {
      const hash = simpleHash(params.contentHashPayload);
      const safeDest = params.destinationLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      const storagePath = `guides/${params.sourceType}/${params.sourceId}/${safeDest}_${hash}.pdf`;

      const pdfArrayBuffer = doc.output('arraybuffer');
      const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });

      // Subir al bucket (upsert: si ya existe con mismo path, no duplica)
      const { error: upError } = await supabase.storage
        .from('logistic_documents')
        .upload(storagePath, pdfBlob, { contentType: 'application/pdf', upsert: true });
      if (upError) throw upError;

      // Registrar/actualizar fila de metadatos (RPC idempotente)
      const { error: regError } = await supabase.rpc('upsert_inventory_guide', {
        p_source_type:       params.sourceType,
        p_source_id:         params.sourceId,
        p_business_ref:      params.businessRef,
        p_destination_label: params.destinationLabel,
        p_storage_bucket:    'logistic_documents',
        p_storage_path:      storagePath,
        p_content_hash:      hash,
      });
      if (regError) throw regError;

      return storagePath;
    } catch (err) {
      console.warn('[inventory_guides] Error al persistir guía:', err);
      return null;
    }
  };

  // ── Generación lazy para históricos (backfill bajo demanda) ───────────────

  const backfillTransferGuide = async (t: RecentTransfer) => {
    if (backfillingId) return;
    setBackfillingId(t.id);
    try {
      const { data: items, error } = await supabase
        .from('internal_transfer_items')
        .select('quantity, product:products(name)')
        .eq('transfer_id', t.id);
      if (error) throw error;

      const lines = (items || []).map(it => ({
        productName: (it.product as any)?.name || 'Producto',
        quantity: it.quantity as number,
      }));

      const guide = buildTransferGuidePdf({
        transferNumber: t.transfer_number || `TR-${t.id.slice(0, 8)}`,
        originSchool: t.from_school?.name || 'Origen',
        destinationSchool: t.to_school?.name || 'Destino',
        lines,
      });

      const storagePath = await uploadAndRegisterGuide(guide.doc, {
        sourceType: 'transfer',
        sourceId: t.id,
        businessRef: t.transfer_number || t.id,
        destinationLabel: t.to_school?.name || 'Destino',
        contentHashPayload: { transfer_id: t.id, lines },
      });

      if (storagePath) {
        const meta: PersistedGuideMetadata = {
          guide_id: '', destination_label: t.to_school?.name || 'Destino',
          storage_path: storagePath, storage_bucket: 'logistic_documents',
          generated_at: new Date().toISOString(),
        };
        setTxGuidesMap(prev => ({ ...prev, [t.id]: [meta] }));
        toast({ title: 'Guía generada y guardada', description: 'Ya puede reimprimir desde la lista.' });
      } else {
        throw new Error('No se pudo guardar la guía en Storage');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error generando guía histórica', description: getErrorMessage(err) });
    } finally {
      setBackfillingId(null);
    }
  };

  const backfillIngressGuides = async (tx: RecentTx) => {
    if (tx.is_warehouse_only || backfillingId) return;
    setBackfillingId(tx.id);
    try {
      const [{ data: items, error: eItems }, { data: movs, error: eMovs }] = await Promise.all([
        supabase
          .from('inventory_transaction_items')
          .select('product_id, total_quantity, unit_cost, product:products(name)')
          .eq('transaction_id', tx.id),
        supabase
          .from('pos_stock_movements')
          .select('school_id, product_id, quantity_delta, school:schools(name)')
          .eq('reference_id', tx.id)
          .gt('quantity_delta', 0),
      ]);
      if (eItems) throw eItems;
      if (eMovs) throw eMovs;

      const itemMap: Record<string, { name: string; unit_cost: number }> = {};
      for (const it of (items || [])) {
        itemMap[it.product_id] = {
          name: (it.product as any)?.name || 'Producto',
          unit_cost: it.unit_cost || 0,
        };
      }

      // Agrupar movimientos por sede
      const perSchool = new Map<string, { schoolName: string; lines: GuidePdfLine[] }>();
      for (const mov of (movs || [])) {
        const sId = mov.school_id;
        const sName = (mov.school as any)?.name || 'Sede';
        const entry = perSchool.get(sId) || { schoolName: sName, lines: [] };
        entry.lines.push({
          productName: itemMap[mov.product_id]?.name || 'Producto',
          quantity: mov.quantity_delta as number,
          unitCost: itemMap[mov.product_id]?.unit_cost || 0,
        });
        perSchool.set(sId, entry);
      }

      // Sin distribución encontrada: generar guía resumen
      if (perSchool.size === 0) {
        const allLines: GuidePdfLine[] = (items || []).map(it => ({
          productName: (it.product as any)?.name || 'Producto',
          quantity: it.total_quantity as number,
          unitCost: it.unit_cost || 0,
        }));
        const guide = buildGuidePdf({
          internalId: tx.internal_transaction_id,
          guideNumber: `GUIA-${tx.internal_transaction_id}-RESUMEN`,
          supplierName: tx.supplier?.name || 'Proveedor',
          docType: DOC_LABELS[tx.doc_type] || tx.doc_type,
          docNumber: tx.vendor_doc_number || '-',
          destinationSchool: 'Distribución múltiple',
          lines: allLines,
        });
        const storagePath = await uploadAndRegisterGuide(guide.doc, {
          sourceType: 'ingress', sourceId: tx.id,
          businessRef: tx.internal_transaction_id,
          destinationLabel: 'Distribución múltiple',
          contentHashPayload: { tx_id: tx.id, lines: allLines },
        });
        if (storagePath) {
          setTxGuidesMap(prev => ({
            ...prev,
            [tx.id]: [{ guide_id: '', destination_label: 'Distribución múltiple', storage_path: storagePath, storage_bucket: 'logistic_documents', generated_at: new Date().toISOString() }],
          }));
          toast({ title: 'Guía generada y guardada', description: 'Ya puede reimprimir desde la lista.' });
        } else {
          throw new Error('No se pudo guardar la guía en Storage');
        }
        return;
      }

      // Generar una guía por sede
      const newMetas: PersistedGuideMetadata[] = [];
      let n = 1;
      for (const [, { schoolName, lines }] of perSchool.entries()) {
        const guideNumber = `GUIA-${tx.internal_transaction_id}-${String(n).padStart(2, '0')}`;
        const guide = buildGuidePdf({
          internalId: tx.internal_transaction_id,
          guideNumber,
          supplierName: tx.supplier?.name || 'Proveedor',
          docType: DOC_LABELS[tx.doc_type] || tx.doc_type,
          docNumber: tx.vendor_doc_number || '-',
          destinationSchool: schoolName,
          lines,
        });
        const storagePath = await uploadAndRegisterGuide(guide.doc, {
          sourceType: 'ingress', sourceId: tx.id,
          businessRef: tx.internal_transaction_id,
          destinationLabel: schoolName,
          contentHashPayload: { tx_id: tx.id, school: schoolName, lines },
        });
        if (storagePath) {
          newMetas.push({ guide_id: '', destination_label: schoolName, storage_path: storagePath, storage_bucket: 'logistic_documents', generated_at: new Date().toISOString() });
        }
        n++;
      }
      if (newMetas.length > 0) {
        setTxGuidesMap(prev => ({ ...prev, [tx.id]: newMetas }));
        toast({ title: `${newMetas.length} guía(s) generadas y guardadas`, description: 'Ya puede reimprimir desde la lista.' });
      } else {
        throw new Error('No se pudo guardar ninguna guía en Storage');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error generando guías históricas', description: getErrorMessage(err) });
    } finally {
      setBackfillingId(null);
    }
  };

  const openIngresoDetail = async (tx: RecentTx) => {
    setSelectedTx(tx);
    setSelectedTrf(null);
    setDetailModal('ingreso');
    setDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from('inventory_transaction_items')
        .select('total_quantity, unit_cost, product:products(name)')
        .eq('transaction_id', tx.id);
      if (error) throw error;
      setTxDetailLines((data || []).map((it: any) => ({
        productName: relName(it.product),
        quantity: Number(it.total_quantity || 0),
        unitCost: Number(it.unit_cost || 0),
      })));
    } catch (err: any) {
      setTxDetailLines([]);
      toast({ variant: 'destructive', title: 'No se pudo cargar detalle de ingreso', description: getErrorMessage(err) });
    } finally {
      setDetailLoading(false);
    }
  };

  const openSalidaDetail = async (t: RecentTransfer) => {
    setSelectedTrf(t);
    setSelectedTx(null);
    setDetailModal('salida');
    setDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from('internal_transfer_items')
        .select('quantity, product:products(name)')
        .eq('transfer_id', t.id);
      if (error) throw error;
      setTrfDetailLines((data || []).map((it: any) => ({
        productName: relName(it.product),
        quantity: Number(it.quantity || 0),
      })));
    } catch (err: any) {
      setTrfDetailLines([]);
      toast({ variant: 'destructive', title: 'No se pudo cargar detalle de traslado', description: getErrorMessage(err) });
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Validaciones de paso ─────────────────────────────────────────────

  const step1Ok = !!iSupplier;
  const step2Ok = !!iDocType && !!iDocNumber.trim();   // evidencia opcional
  const step3Ok = iDistItems.length > 0
    && iDistItems.every(isDistValid)
    && (!iIsWarehouseOnly || !!warehouseLocationId);
  const sValidLines = sLines.filter(l => l.product_id && (parseInt(l.quantity) || 0) > 0);
  const sStep1Ok = !!sFrom && !!sTo && sFrom !== sTo && sValidLines.length > 0;

  const openIngresoModal = useCallback(() => {
    setISupplier('');
    setIDocType('factura');
    setIDocNumber('');
    setIEvidenceUrl('');
    setINotes('');
    setIDistItems([]);
    setIIsWarehouseOnly(false);
    setIPricesIncludeIgv(false);
    setSection('ingresos');
    setStep(1);
    setModal('ingreso');
  }, []);

  const goToIngresoFromStockAlert = useCallback(() => {
    setInsufficientStockAlert(prev => ({ ...prev, open: false }));
    setModal(null);
    openIngresoModal();
  }, [openIngresoModal]);

  const openPreviewTransferGuide = () => {
    if (!sStep1Ok) {
      toast({
        variant: 'destructive',
        title: 'Completa origen, destino y productos',
      });
      return;
    }

    const preview = buildTransferGuidePdf({
      transferNumber: 'TR-PREVIEW',
      originSchool: fromIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sFrom)?.name || 'Origen'),
      destinationSchool: toIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sTo)?.name || 'Destino'),
      notes: sNotes.trim() || undefined,
      lines: sValidLines.map(l => ({ productName: l.productName || 'Producto', quantity: parseInt(l.quantity) })),
    });

    setGeneratedGuides([{
      fileName: preview.fileName.replace('TR-PREVIEW', `GUIA-PREVIA-${Date.now()}`),
      destinationSchool: toIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sTo)?.name || 'Destino'),
      doc: preview.doc,
    }]);
    setShowGuidesDialog(true);
  };

  // ── Submit ingreso ─────────────────────────────────────────────────

  const submitIngreso = async () => {
    if (!step1Ok || !step2Ok || !step3Ok) return;
    const trimmedDoc = iDocNumber.trim().toLowerCase();
    if (trimmedDoc) {
      const exists = recentTx.some(tx =>
        (tx.vendor_doc_number || '').trim().toLowerCase() === trimmedDoc &&
        tx.supplier_id === iSupplier
      );
      if (exists) {
        toast({
          variant: 'destructive',
          title: 'Comprobante duplicado',
          description: `El comprobante ${iDocNumber.trim()} ya fue registrado para este proveedor.`,
        });
        return;
      }
    }
    setSaving(true);
    try {
      const items = iDistItems.map(d => ({
        product_id:    d.product_id,
        total_quantity: parseInt(d.total),
        unit_cost:     parseFloat(d.unit_cost) || 0,
        distribution:  iIsWarehouseOnly
          ? []    // el RPC ignora distribution cuando is_warehouse_only = true
          : schools
              .filter(s => (parseInt(d.dist[s.id]) || 0) > 0)
              .map(s => ({ school_id: s.id, quantity: parseInt(d.dist[s.id]) })),
      }));

      const { data, error } = await supabase.rpc('process_ingress_bulk', {
        p_supplier_id:         iSupplier,
        p_vendor_doc_number:   iDocNumber.trim() || null,
        p_doc_type:            iDocType,
        p_evidence_url:        iEvidenceUrl.trim() || null,
        p_notes:               iNotes.trim() || null,
        p_is_warehouse_only:   iIsWarehouseOnly,
        p_warehouse_school_id: null, // si es almacén-only, DB resuelve desde app_settings
        p_items:               items,
        p_prices_include_igv:  iPricesIncludeIgv,
      });
      if (error) throw error;

      const res = data as any;
      let guideCount = 0;
      const guideDocs: GeneratedGuide[] = [];

      // Solo generar guías cuando HAY distribución por sede (no almacén-only).
      if (!iIsWarehouseOnly) {
        const perSchool = new Map<string, GuidePdfLine[]>();

        for (const item of iDistItems) {
          for (const school of schools) {
            const qty = parseInt(item.dist[school.id] || '0') || 0;
            if (qty <= 0) continue;
            const lines = perSchool.get(school.id) || [];
            lines.push({
              productName: item.productName || 'Producto',
              quantity: qty,
              unitCost: parseFloat(item.unit_cost) || 0,
            });
            perSchool.set(school.id, lines);
          }
        }

        const supplierName = suppliers.find(s => s.id === iSupplier)?.name || 'Proveedor';
        let n = 1;
        for (const [schoolId, lines] of perSchool.entries()) {
          const schoolName = schools.find(s => s.id === schoolId)?.name || 'Sede';
          const guideNumber = `GUIA-${res.internal_transaction_id}-${String(n).padStart(2, '0')}`;
          const generated = buildGuidePdf({
            internalId: res.internal_transaction_id,
            guideNumber,
            supplierName,
            docType: DOC_LABELS[iDocType] || iDocType,
            docNumber: iDocNumber.trim() || '-',
            originLabel: WAREHOUSE_LABEL,
            destinationSchool: schoolName,
            lines,
          });
          guideDocs.push({
            ...generated,
            destinationSchool: schoolName,
          });
          n += 1;
          guideCount += 1;
        }
      }

      toast({
        title: `✅ Ingreso ${res.internal_transaction_id} registrado`,
        description: iIsWarehouseOnly
          ? `${iDistItems.length} producto(s) · S/ ${res.total_amount?.toFixed(2) || '0.00'} · Sin guías (Almacén Central)`
          : `${iDistItems.length} producto(s) · S/ ${res.total_amount?.toFixed(2) || '0.00'} · ${guideCount} guía(s) PDF generadas`,
      });

      if (!iIsWarehouseOnly && guideDocs.length > 0) {
        setGeneratedGuides(guideDocs);
        setShowGuidesDialog(true);

        // Persistir en Storage + DB en segundo plano (no bloquea cierre del modal)
        setPersistingGuides(true);
        const txSourceId = res.transaction_id || res.id || '';
        if (txSourceId) {
          const persistPromises = guideDocs.map(g =>
            uploadAndRegisterGuide(g.doc, {
              sourceType: 'ingress',
              sourceId: txSourceId,
              businessRef: res.internal_transaction_id,
              destinationLabel: g.destinationSchool,
              contentHashPayload: {
                tx_id: txSourceId,
                guide_number: g.fileName,
                destination: g.destinationSchool,
              },
            })
          );
          Promise.all(persistPromises).then(paths => {
            const newMetas: PersistedGuideMetadata[] = guideDocs
              .map((g, i) => paths[i] ? ({
                guide_id: '',
                destination_label: g.destinationSchool,
                storage_path: paths[i]!,
                storage_bucket: 'logistic_documents',
                generated_at: new Date().toISOString(),
              }) : null)
              .filter(Boolean) as PersistedGuideMetadata[];
            if (newMetas.length > 0 && txSourceId) {
              setTxGuidesMap(prev => ({ ...prev, [txSourceId]: newMetas }));
            }
          }).finally(() => setPersistingGuides(false));
        } else {
          setPersistingGuides(false);
        }
      }

      setModal(null);
      loadAll();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error al registrar ingreso',
        description: getErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Submit traslado ───────────────────────────────────────────────────

  const submitSalida = async () => {
    if (!sStep1Ok) {
      toast({ variant: 'destructive', title: 'Completa todos los campos requeridos' });
      return;
    }
    setSaving(true);
    try {
      const payloadItems = sValidLines.map(l => ({ product_id: l.product_id, quantity: parseInt(l.quantity) }));
      const { data, error } = involvesWarehouseInTransfer
        ? await supabase.rpc('create_transfer_with_warehouse', {
            p_from_is_warehouse: fromIsWarehouse,
            p_from_school_id: fromIsWarehouse ? null : sFrom,
            p_to_is_warehouse: toIsWarehouse,
            p_to_school_id: toIsWarehouse ? null : sTo,
            p_items: payloadItems,
            p_notes: sNotes.trim() || null,
            p_contact_person: null,
            p_contact_phone: null,
            p_approved_by: sApprove.trim() || null,
          })
        : await supabase.rpc('create_internal_transfer', {
            p_from_school_id: sFrom,
            p_to_school_id:   sTo,
            p_items:          payloadItems,
            p_notes:          sNotes.trim() || null,
            p_contact_person: sContact.trim() || null,
            p_contact_phone:  sPhone.trim() || null,
            p_approved_by:    sApprove.trim() || null,
          });
      if (error) throw error;
      const num = (data as any)?.transfer_number || '';
      const tsfSourceId = (data as any)?.id || (data as any)?.transfer_id || '';
      const destLabel = toIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sTo)?.name || 'Destino');

      const transferGuide = buildTransferGuidePdf({
        transferNumber: num || `TR-${Date.now()}`,
        originSchool: fromIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sFrom)?.name || 'Origen'),
        destinationSchool: destLabel,
        notes: sNotes.trim() || undefined,
        lines: sValidLines.map(l => ({ productName: l.productName || 'Producto', quantity: parseInt(l.quantity) })),
      });

      setGeneratedGuides([{
        fileName: transferGuide.fileName,
        destinationSchool: destLabel,
        doc: transferGuide.doc,
      }]);
      setShowGuidesDialog(true);

      toast({ title: `✅ Guía ${num} generada`, description: `${sValidLines.length} producto(s) trasladado(s).` });

      // Persistir en Storage + DB en segundo plano
      if (tsfSourceId) {
        setPersistingGuides(true);
        uploadAndRegisterGuide(transferGuide.doc, {
          sourceType: 'transfer',
          sourceId: tsfSourceId,
          businessRef: num || tsfSourceId,
          destinationLabel: destLabel,
          contentHashPayload: {
            transfer_id: tsfSourceId,
            destination: destLabel,
            lines: sValidLines.map(l => ({ pid: l.product_id, qty: parseInt(l.quantity) })),
          },
        }).then(storagePath => {
          if (storagePath) {
            setTxGuidesMap(prev => ({
              ...prev,
              [tsfSourceId]: [{
                guide_id: '',
                destination_label: destLabel,
                storage_path: storagePath,
                storage_bucket: 'logistic_documents',
                generated_at: new Date().toISOString(),
              }],
            }));
          }
        }).finally(() => setPersistingGuides(false));
      }

      setModal(null);
      setSStep(1);
      loadAll();
    } catch (err: any) {
      const errorMessage = getErrorMessage(err);
      if (errorMessage.toUpperCase().includes('INSUFFICIENT_STOCK')) {
        const productName =
          getInsufficientStockProductName(errorMessage)
          || sValidLines.find(line => line.productName.trim())?.productName
          || 'este producto';
        const originLabel = fromIsWarehouse
          ? WAREHOUSE_LABEL
          : (schools.find(s => s.id === sFrom)?.name || 'sede de origen');
        setInsufficientStockAlert({
          open: true,
          productName,
          originLabel,
        });
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Error al registrar traslado',
        description: errorMessage,
      });
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Selector de sección ── */}
      <div className="flex items-center gap-1.5 bg-white rounded-xl border border-slate-200 p-1.5 overflow-x-auto">
        {([
          { key: 'ingresos',    label: 'Ingresos',    Icon: PackagePlus,    color: 'bg-emerald-700' },
          { key: 'salidas',     label: 'Salidas',     Icon: ArrowRightLeft, color: 'bg-blue-700'    },
          { key: 'proveedores', label: 'Proveedores', Icon: Building2,      color: 'bg-slate-800'   },
        ] as const).map(({ key, label, Icon, color }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
              section === key ? `${color} text-white shadow-sm` : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {section === 'proveedores' && <SuppliersTab />}

      {section !== 'proveedores' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-800">
                {section === 'ingresos' ? 'Entradas de Proveedor' : 'Guías de Traslado Interno'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {section === 'ingresos'
                  ? 'Correlativo automático ING · Costo histórico · Distribución por sede'
                  : 'Correlativo TR automático · Doble asiento atómico en stock'}
              </p>
            </div>
            <Button
              size="sm"
              className={`gap-1.5 shrink-0 ${section === 'ingresos' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-700 hover:bg-blue-800'}`}
              onClick={() => {
                if (section === 'ingresos') {
                  openIngresoModal();
                } else {
                  setSFrom(''); setSTo('');
                  setSLines([{ uid: uid(), product_id: '', productName: '', quantity: '1', searchQuery: '', searchResults: [], searchLoading: false, showResults: false }]);
                  setSContact(''); setSPhone(''); setSApprove(''); setSNotes('');
                  setSStep(1);
                  setModal('salida');
                }
              }}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{section === 'ingresos' ? 'Nuevo Ingreso' : 'Nuevo Traslado'}</span>
              <span className="sm:hidden">Nuevo</span>
            </Button>
          </div>

          {/* ── Banner de Almacén Central ── */}
          {section === 'ingresos' && (
            <div className={`rounded-xl px-3 py-2 border ${
              warehouseLocationId
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-red-50 border-red-200'
            }`}>
              <p className={`text-xs ${
                warehouseLocationId ? 'text-emerald-700' : 'text-red-700'
              }`}>
                <span className="font-semibold">Almacén Central:</span>{' '}
                {warehouseLocationId ? 'Operativo (ubicación de inventario)' : 'No configurado en DB. Ejecuta migración Fase 3.'}
              </p>
            </div>
          )}

          {/* ── Lista de movimientos recientes ── */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : section === 'ingresos' ? (
            <div className="space-y-2">
              {recentTx.length === 0 ? (
                <Card><CardContent className="py-12 text-center">
                  <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">Sin ingresos registrados aún.</p>
                </CardContent></Card>
              ) : recentTx.map(tx => (
                <Card
                  key={tx.id}
                  className="border-slate-200 cursor-pointer hover:border-emerald-300 transition-colors"
                  onClick={() => openIngresoDetail(tx)}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className="text-[10px] font-mono bg-emerald-100 text-emerald-800 border-emerald-200">
                            {tx.internal_transaction_id}
                          </Badge>
                          <Badge className="text-[10px] bg-slate-100 text-slate-600">
                            {DOC_LABELS[tx.doc_type] || tx.doc_type}
                          </Badge>
                          {tx.is_warehouse_only && (
                            <Badge className="text-[10px] bg-amber-100 text-amber-800">
                              <Warehouse className="h-2.5 w-2.5 mr-0.5" /> Almacén
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-800 mt-1 truncate">
                          {tx.supplier?.name || 'Sin proveedor'}
                          {tx.vendor_doc_number ? ` · #${tx.vendor_doc_number}` : ''}
                        </p>
                        <p className="text-xs text-slate-400">{fmtDate(tx.created_at)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-slate-800">S/ {tx.total_amount.toFixed(2)}</p>
                        <span className={`text-[10px] flex items-center gap-0.5 justify-end mt-0.5 ${tx.evidence_url ? 'text-emerald-600' : 'text-amber-500'}`}>
                          {tx.evidence_url
                            ? <><FileText className="h-3 w-3" /> Con evidencia</>
                            : <><AlertTriangle className="h-3 w-3" /> Sin evidencia</>
                          }
                        </span>
                        {tx.evidence_url && (
                          <div className="flex items-center justify-end gap-1.5 mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={(e) => { e.stopPropagation(); openEvidence(tx.evidence_url!); }}
                            >
                              Ver
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2 text-[11px] bg-blue-700 hover:bg-blue-800"
                              onClick={(e) => { e.stopPropagation(); openEvidence(tx.evidence_url!, true); }}
                            >
                              Imprimir
                            </Button>
                          </div>
                        )}
                        {/* ── Botones de guías internas persistidas ── */}
                        {!tx.is_warehouse_only && (() => {
                          const guides = txGuidesMap[tx.id] || [];
                          if (guides.length > 0) {
                            return (
                              <div className="mt-2 space-y-1">
                                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Guías internas</p>
                                {guides.map((g, i) => (
                                  <div key={i} className="flex items-center justify-between gap-1.5 bg-blue-50 rounded-lg px-2 py-1">
                                    <span className="text-[11px] text-blue-800 truncate flex-1">{g.destination_label}</span>
                                    <div className="flex gap-1 shrink-0">
                                      <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]"
                                        onClick={(e) => { e.stopPropagation(); openGuideFromStorage(g.storage_path); }}>Ver</Button>
                                      <Button size="sm" className="h-6 px-1.5 text-[10px] bg-blue-700 hover:bg-blue-800"
                                        onClick={(e) => { e.stopPropagation(); openGuideFromStorage(g.storage_path, true); }}>Imprimir</Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          return (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] mt-2 border-dashed border-blue-300 text-blue-600 w-full"
                              disabled={backfillingId === tx.id}
                              onClick={(e) => { e.stopPropagation(); backfillIngressGuides(tx); }}
                            >
                              {backfillingId === tx.id
                                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generando...</>
                                : <><FileText className="h-3 w-3 mr-1" />Generar guía interna</>}
                            </Button>
                          );
                        })()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {recentTrf.length === 0 ? (
                <Card><CardContent className="py-12 text-center">
                  <ArrowRightLeft className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">Sin traslados registrados aún.</p>
                </CardContent></Card>
              ) : recentTrf.map(t => (
                <Card
                  key={t.id}
                  className="border-slate-200 cursor-pointer hover:border-blue-300 transition-colors"
                  onClick={() => openSalidaDetail(t)}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {t.transfer_number && (
                            <Badge className="text-[10px] font-mono bg-blue-100 text-blue-800 border-blue-200">
                              {t.transfer_number}
                            </Badge>
                          )}
                          <Badge className={`text-[10px] ${t.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                            {t.status === 'completed' ? 'Completado' : 'Pendiente'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-sm font-semibold text-slate-700 truncate">{t.from_school?.name || '?'}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="text-sm font-semibold text-slate-700 truncate">{t.to_school?.name || '?'}</span>
                        </div>
                        {t.contact_person && <p className="text-xs text-slate-400 mt-0.5">Responsable: {t.contact_person}</p>}
                        {/* ── Botones de guía de traslado persistida ── */}
                        {(() => {
                          const guides = txGuidesMap[t.id] || [];
                          if (guides.length > 0) {
                            return (
                              <div className="flex items-center gap-1.5 mt-2">
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); openGuideFromStorage(guides[0].storage_path); }}>
                                  <FileText className="h-3 w-3 mr-1" />Ver guía
                                </Button>
                                <Button size="sm" className="h-7 px-2 text-[11px] bg-blue-700 hover:bg-blue-800"
                                  onClick={(e) => { e.stopPropagation(); openGuideFromStorage(guides[0].storage_path, true); }}>
                                  Imprimir
                                </Button>
                              </div>
                            );
                          }
                          return (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] mt-2 border-dashed border-blue-300 text-blue-600"
                              disabled={backfillingId === t.id}
                              onClick={(e) => { e.stopPropagation(); backfillTransferGuide(t); }}
                            >
                              {backfillingId === t.id
                                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generando...</>
                                : <><FileText className="h-3 w-3 mr-1" />Generar guía</>}
                            </Button>
                          );
                        })()}
                      </div>
                      <p className="text-xs text-slate-400 shrink-0">{fmtDate(t.created_at)}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* DETALLE DE INGRESO                                            */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Dialog open={detailModal === 'ingreso'} onOpenChange={(v) => !v && setDetailModal(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5 text-emerald-700" />
              Detalle de ingreso
            </DialogTitle>
          </DialogHeader>
          {!selectedTx ? null : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-[10px] font-mono bg-emerald-100 text-emerald-800">{selectedTx.internal_transaction_id}</Badge>
                  <Badge className="text-[10px] bg-slate-100 text-slate-700">{DOC_LABELS[selectedTx.doc_type] || selectedTx.doc_type}</Badge>
                </div>
                <p className="text-sm font-semibold text-slate-800 mt-2">{selectedTx.supplier?.name || 'Sin proveedor'}</p>
                <p className="text-xs text-slate-500">{selectedTx.vendor_doc_number ? `#${selectedTx.vendor_doc_number} · ` : ''}{fmtDate(selectedTx.created_at)}</p>
              </div>

              {detailLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Productos</p>
                  {txDetailLines.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin líneas disponibles.</p>
                  ) : txDetailLines.map((line, i) => (
                    <div key={`${line.productName}-${i}`} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate">{line.productName}</span>
                      <span className="font-semibold text-slate-800">{line.quantity} unid.</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedTx.evidence_url && (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => openEvidence(selectedTx.evidence_url!)}>
                    Ver comprobante
                  </Button>
                  <Button className="flex-1 bg-blue-700 hover:bg-blue-800" onClick={() => openEvidence(selectedTx.evidence_url!, true)}>
                    Imprimir comprobante
                  </Button>
                </div>
              )}

              {!selectedTx.is_warehouse_only && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Guías internas</p>
                  {(txGuidesMap[selectedTx.id] || []).length > 0 ? (
                    (txGuidesMap[selectedTx.id] || []).map((g, i) => (
                      <div key={`${g.storage_path}-${i}`} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-blue-800 truncate">{g.destination_label}</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => openGuideFromStorage(g.storage_path)}>Ver</Button>
                          <Button size="sm" className="h-7 text-xs px-2 bg-blue-700 hover:bg-blue-800" onClick={() => openGuideFromStorage(g.storage_path, true)}>Imprimir</Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Button variant="outline" className="w-full border-dashed border-blue-300 text-blue-700" disabled={backfillingId === selectedTx.id} onClick={() => backfillIngressGuides(selectedTx)}>
                      {backfillingId === selectedTx.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Generando...</> : 'Generar guía interna'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* DETALLE DE SALIDA                                             */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Dialog open={detailModal === 'salida'} onOpenChange={(v) => !v && setDetailModal(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ArrowRightLeft className="h-5 w-5 text-blue-700" />
              Detalle de salida
            </DialogTitle>
          </DialogHeader>
          {!selectedTrf ? null : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedTrf.transfer_number && (
                    <Badge className="text-[10px] font-mono bg-blue-100 text-blue-800">{selectedTrf.transfer_number}</Badge>
                  )}
                  <Badge className={`text-[10px] ${selectedTrf.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {selectedTrf.status === 'completed' ? 'Completado' : 'Pendiente'}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-slate-800 mt-2">{selectedTrf.from_school?.name || '?'} → {selectedTrf.to_school?.name || '?'}</p>
                <p className="text-xs text-slate-500">{fmtDate(selectedTrf.created_at)}</p>
              </div>

              {detailLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Productos</p>
                  {trfDetailLines.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin líneas disponibles.</p>
                  ) : trfDetailLines.map((line, i) => (
                    <div key={`${line.productName}-${i}`} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate">{line.productName}</span>
                      <span className="font-semibold text-slate-800">{line.quantity} unid.</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Guía interna</p>
                {(txGuidesMap[selectedTrf.id] || []).length > 0 ? (
                  (txGuidesMap[selectedTrf.id] || []).map((g, i) => (
                    <div key={`${g.storage_path}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-blue-800 truncate">{g.destination_label}</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => openGuideFromStorage(g.storage_path)}>Ver</Button>
                        <Button size="sm" className="h-7 text-xs px-2 bg-blue-700 hover:bg-blue-800" onClick={() => openGuideFromStorage(g.storage_path, true)}>Imprimir</Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <Button variant="outline" className="w-full border-dashed border-blue-300 text-blue-700" disabled={backfillingId === selectedTrf.id} onClick={() => backfillTransferGuide(selectedTrf)}>
                    {backfillingId === selectedTrf.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Generando...</> : 'Generar guía interna'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MODAL DE INGRESO — Stepper 4 pasos                            */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Dialog open={modal === 'ingreso'} onOpenChange={v => !v && setModal(null)}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <PackagePlus className="h-5 w-5 text-emerald-700" />
              Nuevo Ingreso de Proveedor
            </DialogTitle>
          </DialogHeader>

          {/* Barra de progreso */}
          <div className="flex items-center gap-1 mb-1">
            {[1,2,3,4].map(n => (
              <div key={n} className={`flex-1 h-1.5 rounded-full transition-colors ${n <= step ? 'bg-emerald-600' : 'bg-slate-200'}`} />
            ))}
          </div>
          <p className="text-xs text-slate-400 text-center mb-4">
            Paso {step} de 4 — {['Proveedor','Comprobante','Productos','Confirmar'][step-1]}
          </p>

          {/* Paso 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Proveedor *</Label>
                <Select value={iSupplier} onValueChange={setISupplier}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Selecciona un proveedor..." /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}{s.ruc ? ` (${s.ruc})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suppliers.length === 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Sin proveedores. Ve a "Proveedores" para crear uno.
                  </p>
                )}
              </div>
              <Button className="w-full h-11 bg-emerald-700 hover:bg-emerald-800" disabled={!step1Ok} onClick={() => setStep(2)}>
                Siguiente <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Paso 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Tipo de comprobante *</Label>
                <Select value={iDocType} onValueChange={v => setIDocType(v as any)}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="factura">Factura</SelectItem>
                    <SelectItem value="boleta">Boleta</SelectItem>
                    <SelectItem value="guia">Guía de remisión</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Número de comprobante *</Label>
                <Input className="h-11" placeholder="Ej: F001-00123" value={iDocNumber} onChange={e => setIDocNumber(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Foto o PDF del comprobante <span className="text-slate-400">(opcional)</span></Label>
                <input type="file" accept="image/*,application/pdf" ref={fileInputRef} onChange={handleFileUpload} className="hidden" capture="environment" />
                {iEvidenceUrl ? (
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                    <span className="text-sm text-emerald-700 flex items-center gap-2"><FileText className="h-4 w-4" /> Archivo subido</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setIEvidenceUrl('')}>Cambiar</Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full h-12 border-dashed flex-col gap-1" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Camera className="h-4 w-4 text-slate-400" /><span className="text-xs text-slate-500">Tomar foto o subir archivo</span></>}
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Notas internas</Label>
                <Input placeholder="Observaciones del pedido..." value={iNotes} onChange={e => setINotes(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4 mr-1" /> Atrás</Button>
                <Button className="flex-1 h-11 bg-emerald-700 hover:bg-emerald-800" disabled={!step2Ok} onClick={() => { if (iDistItems.length === 0) addDistItem(); setStep(3); }}>
                  Siguiente <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Paso 3 */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Switch: Almacén Central */}
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-amber-700 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Todo al Almacén Central</p>
                    <p className="text-xs text-amber-600">Sin necesidad de repartir por sedes</p>
                  </div>
                </div>
                <Switch checked={iIsWarehouseOnly} onCheckedChange={setIIsWarehouseOnly} />
              </div>

              {/* Switch: Los precios incluyen IGV */}
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs text-slate-600">Los precios incluyen IGV (18%)</span>
                <Switch checked={iPricesIncludeIgv} onCheckedChange={setIPricesIncludeIgv} />
              </div>

              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                <strong>Regla:</strong> {iIsWarehouseOnly
                  ? 'El 100% va al Almacén Central (ubicación real, no sede). Sin reparto manual.'
                  : 'La suma por sede debe coincidir con el total recibido.'}
              </p>
              {iIsWarehouseOnly && !warehouseLocationId && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  No hay Almacén Central operativo en DB. Ejecuta la migración Fase 3 para habilitar ingresos directos a almacén.
                </p>
              )}
              {iIsWarehouseOnly && warehouseLocationId && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Almacén Central activo como ubicación independiente.
                </p>
              )}

              {iDistItems.map((item, idx) => {
                const total   = parseInt(item.total) || 0;
                const current = sumDist(item);
                const valid   = isDistValid(item);
                const totalCosto = parseFloat(item.unit_cost) || 0;
                const neto = totalCosto / 1.18;
                const igv = totalCosto - neto;
                return (
                  <div key={item.uid} className="border border-slate-200 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Producto {idx + 1}</span>
                      <button onClick={() => setIDistItems(prev => prev.filter(d => d.uid !== item.uid))} className="text-red-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <ProductSearchInput
                      query={item.searchQuery}
                      results={item.searchResults}
                      loading={item.searchLoading}
                      showResults={item.showResults}
                      selected={item.product_id}
                      onQueryChange={q => updateDistSearch(item.uid, q)}
                      onSelect={r => selectDistProduct(item.uid, r)}
                      onFastTrack={() => openFastTrack(item.uid, item.searchQuery)}
                      onBlur={() => setIDistItems(prev => prev.map(d => d.uid === item.uid ? { ...d, showResults: false } : d))}
                    />

                    {item.productName && (
                      <p className="text-xs text-emerald-700 font-medium truncate">✓ {item.productName}</p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Total recibido (unid.)</Label>
                        <Input type="number" min="1" className="h-10 text-center font-semibold" placeholder="0"
                          value={item.total} onChange={e => setIDistItems(prev => prev.map(d => d.uid === item.uid ? { ...d, total: e.target.value } : d))} />
                      </div>
                      <div className="flex flex-col w-full">
                        <Label className="text-xs">Costo unitario (S/)</Label>
                        <Input type="number" min="0" step="0.01" className="h-10" placeholder="0.00"
                          value={item.unit_cost} onChange={e => setIDistItems(prev => prev.map(d => d.uid === item.uid ? { ...d, unit_cost: e.target.value } : d))} />
                        {iPricesIncludeIgv ? (
                          <p className="text-xs mt-1 text-blue-600 font-medium break-words leading-tight">
                            Neto: S/ {neto.toFixed(2)} + IGV: S/ {igv.toFixed(2)} = S/ {totalCosto.toFixed(2)}
                          </p>
                        ) : (
                          <p className="text-xs mt-1 text-muted-foreground">Precio sin IGV</p>
                        )}
                      </div>
                    </div>

                    {/* Distribución por sede (solo si no es warehouse-only) */}
                    {!iIsWarehouseOnly && total > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-slate-600">Distribución por sede:</p>
                        {schools.map(s => (
                          <div key={s.id} className="flex items-center gap-2">
                            <span className="text-xs text-slate-600 flex-1 truncate">{schoolLabel(s)}</span>
                            <Input type="number" min="0" className="w-20 h-8 text-center text-sm" placeholder="0"
                              value={item.dist[s.id] || ''} onChange={e => updateDist(item.uid, s.id, e.target.value)} />
                          </div>
                        ))}
                        <div className={`flex items-center justify-between text-xs font-semibold px-2 py-1.5 rounded-lg ${valid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          <span>Suma: {current}</span>
                          <span>Total: {total}</span>
                          {valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <Button variant="outline" className="w-full border-dashed" onClick={addDistItem}>
                <Plus className="h-4 w-4 mr-2" /> Agregar otro producto
              </Button>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setStep(2)}><ChevronLeft className="h-4 w-4 mr-1" /> Atrás</Button>
                <Button className="flex-1 h-11 bg-emerald-700 hover:bg-emerald-800" disabled={!step3Ok} onClick={() => setStep(4)}>
                  Siguiente <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Paso 4 */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Resumen del ingreso</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-400">Proveedor</p>
                    <p className="text-sm font-semibold text-slate-800">{suppliers.find(s => s.id === iSupplier)?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Comprobante</p>
                    <p className="text-sm font-semibold text-slate-800">{DOC_LABELS[iDocType]} {iDocNumber}</p>
                  </div>
                </div>
                <div className="space-y-1 pt-1 border-t border-slate-200">
                  {iDistItems.map(d => (
                    <div key={d.uid} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate flex-1">{d.productName}</span>
                      <span className="font-semibold text-slate-800 ml-2">{d.total} unid.</span>
                    </div>
                  ))}
                </div>
                {iIsWarehouseOnly && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    <Warehouse className="h-3.5 w-3.5 shrink-0" />
                    Todo va al Almacén Central (ubicación logística).
                  </div>
                )}
                {!iEvidenceUrl && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Sin evidencia adjunta. Recomendado subir foto del comprobante.
                  </div>
                )}
              </div>

              {/* Botón de guías ANTES de confirmar (independiente del RPC) */}
              {!iIsWarehouseOnly && (
                <Button
                  variant="outline"
                  className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                  onClick={openPreviewGuides}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Ver / Imprimir Guías por Sede
                </Button>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setStep(3)} disabled={saving}><ChevronLeft className="h-4 w-4 mr-1" /> Atrás</Button>
                <Button className="flex-1 h-11 bg-emerald-700 hover:bg-emerald-800" onClick={submitIngreso} disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registrando...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar Ingreso</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MODAL DE SALIDA                                               */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Dialog open={modal === 'salida'} onOpenChange={v => !v && setModal(null)}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ArrowRightLeft className="h-5 w-5 text-blue-700" />
              Nueva Guía de Traslado
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-1 mb-1">
            {[1, 2].map(n => (
              <div key={n} className={`flex-1 h-1.5 rounded-full transition-colors ${n <= sStep ? 'bg-blue-600' : 'bg-slate-200'}`} />
            ))}
          </div>
          <p className="text-xs text-slate-400 text-center mb-4">
            Paso {sStep} de 2 — {sStep === 1 ? 'Datos del traslado' : 'Confirmar'}
          </p>

          {sStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">Origen *</Label>
                  <Select value={sFrom} onValueChange={setSFrom}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Sede origen..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={WAREHOUSE_OPTION_ID} disabled={sTo === WAREHOUSE_OPTION_ID}>{WAREHOUSE_LABEL}</SelectItem>
                      {schools.map(s => <SelectItem key={s.id} value={s.id} disabled={s.id === sTo}>{schoolLabel(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">Destino *</Label>
                  <Select value={sTo} onValueChange={setSTo}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Sede destino..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={WAREHOUSE_OPTION_ID} disabled={sFrom === WAREHOUSE_OPTION_ID}>{WAREHOUSE_LABEL}</SelectItem>
                      {schools.map(s => <SelectItem key={s.id} value={s.id} disabled={s.id === sFrom}>{schoolLabel(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Productos *</Label>
                {sLines.map(line => (
                  <div key={line.uid} className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <ProductSearchInput
                          query={line.searchQuery}
                          results={line.searchResults}
                          loading={line.searchLoading}
                          showResults={line.showResults}
                          selected={line.product_id}
                          onQueryChange={q => updateLineSearch(line.uid, q)}
                          onSelect={r => setSLines(prev => prev.map(l => l.uid === line.uid ? { ...l, product_id: r.product_id, productName: r.product_name, searchQuery: r.product_name, showResults: false } : l))}
                          onFastTrack={() => {}}
                          onBlur={() => setSLines(prev => prev.map(l => l.uid === line.uid ? { ...l, showResults: false } : l))}
                        />
                        {line.productName && <p className="text-xs text-emerald-700 mt-0.5 truncate">✓ {line.productName}</p>}
                        {sFrom && line.product_id && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Stock en origen: <span className="font-semibold text-slate-700">{sStockByProduct[line.product_id] ?? 0}</span>
                          </p>
                        )}
                      </div>
                      <Input type="number" min="1" className="w-20 h-10 text-center mt-0" placeholder="Qty"
                        value={line.quantity} onChange={e => setSLines(prev => prev.map(l => l.uid === line.uid ? { ...l, quantity: e.target.value } : l))} />
                      {sLines.length > 1 && (
                        <button onClick={() => setSLines(prev => prev.filter(l => l.uid !== line.uid))} className="text-red-400 hover:text-red-600 mt-2">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="border-dashed"
                  onClick={() => setSLines(prev => [...prev, { uid: uid(), product_id: '', productName: '', quantity: '1', searchQuery: '', searchResults: [], searchLoading: false, showResults: false }])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar producto
                </Button>
              </div>
              {!involvesWarehouseInTransfer ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Responsabilidad</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Persona encargada</Label>
                      <Input className="h-10" placeholder="Nombre completo" value={sContact} onChange={e => setSContact(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Teléfono / WhatsApp</Label>
                      <Input className="h-10" placeholder="999 999 999" value={sPhone} onChange={e => setSPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Aprobado por</Label>
                    <Input className="h-10" placeholder="Nombre de quien aprueba" value={sApprove} onChange={e => setSApprove(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notas</Label>
                    <Textarea rows={2} className="resize-none" placeholder="Motivo del traslado..." value={sNotes} onChange={e => setSNotes(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  Traslado con Almacen Central: no requiere campos de responsabilidad.
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setModal(null)} disabled={saving}>Cancelar</Button>
                <Button
                  className="flex-1 h-11 bg-blue-700 hover:bg-blue-800"
                  disabled={saving || !sStep1Ok}
                  onClick={() => setSStep(2)}
                >
                  Revisar y confirmar <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {sStep === 2 && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Resumen del traslado</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-400">Origen</p>
                    <p className="text-sm font-semibold text-slate-800">{fromIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sFrom)?.name || '—')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Destino</p>
                    <p className="text-sm font-semibold text-slate-800">{toIsWarehouse ? WAREHOUSE_LABEL : (schools.find(s => s.id === sTo)?.name || '—')}</p>
                  </div>
                </div>
                <div className="space-y-1 pt-1 border-t border-slate-200">
                  {sValidLines.map(l => (
                    <div key={l.uid} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate flex-1">{l.productName || 'Producto'}</span>
                      <span className="font-semibold text-slate-800 ml-2">{parseInt(l.quantity)} unid.</span>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={openPreviewTransferGuide}
                disabled={!sStep1Ok}
              >
                <FileText className="h-4 w-4 mr-2" />
                Ver / Imprimir guía previa
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setSStep(1)} disabled={saving}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Atrás
                </Button>
                <Button className="flex-1 h-11 bg-blue-700 hover:bg-blue-800" disabled={saving || !sStep1Ok} onClick={submitSalida}>
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registrando...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar traslado</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={insufficientStockAlert.open}
        onOpenChange={(open) => setInsufficientStockAlert(prev => ({ ...prev, open }))}
      >
        <DialogContent className="w-[92vw] sm:max-w-md p-0 overflow-hidden">
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-100 p-2.5 shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogHeader className="space-y-0 text-left">
                  <DialogTitle className="text-base font-semibold text-slate-900">Stock insuficiente</DialogTitle>
                  <DialogDescription className="text-sm text-slate-600 mt-1">
                    No hay stock disponible de <span className="font-semibold text-slate-800">{insufficientStockAlert.productName}</span> en <span className="font-semibold text-slate-800">{insufficientStockAlert.originLabel}</span>.
                  </DialogDescription>
                </DialogHeader>
                <p className="text-xs text-slate-500 mt-2">
                  Puedes registrar un ingreso de proveedor para reabastecer y continuar con el traslado.
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                className="h-10 sm:flex-1"
                onClick={() => setInsufficientStockAlert(prev => ({ ...prev, open: false }))}
              >
                Entendido
              </Button>
              <Button
                className="h-10 sm:flex-1 bg-emerald-700 hover:bg-emerald-800"
                onClick={goToIngresoFromStockAlert}
              >
                Ir a Ingreso de Proveedor
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MODAL GUÍAS GENERADAS                                         */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Dialog open={showGuidesDialog} onOpenChange={v => !v && setShowGuidesDialog(false)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-blue-700" />
              Guías internas listas para imprimir
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {persistingGuides && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                Guardando guías en repositorio para reimpresión futura…
              </div>
            )}
            <p className="text-xs text-slate-500">
              Una guía por cada sede destino. Descarga o imprime desde aquí:
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {generatedGuides.map(g => (
                <div key={g.fileName} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{g.destinationSchool}</p>
                    <p className="text-[11px] text-slate-400 truncate">{g.fileName}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-8 text-xs px-2"
                      onClick={() => {
                        const blob = g.doc.output('blob');
                        const url = URL.createObjectURL(blob);
                        const win = window.open(url, '_blank');
                        win?.addEventListener('load', () => win.print());
                      }}>
                      Imprimir
                    </Button>
                    <Button size="sm" className="h-8 text-xs px-2 bg-blue-700 hover:bg-blue-800"
                      onClick={() => g.doc.save(g.fileName)}>
                      Descargar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowGuidesDialog(false)}>
                Cerrar
              </Button>
              <Button className="flex-1 bg-blue-700 hover:bg-blue-800"
                onClick={() => generatedGuides.forEach(g => g.doc.save(g.fileName))}
                disabled={generatedGuides.length === 0}>
                Descargar todas
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MODAL FAST-TRACK — Crear producto rápido                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Dialog open={showFT} onOpenChange={v => !v && setShowFT(false)}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-emerald-700" />
              Crear Producto Rápido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Crea el producto básico ahora. Luego completa precio de venta en <strong>Maestro de Productos</strong>.
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Nombre del producto *</Label>
              <Input className="h-11" placeholder="Ej: Galletas de Avena 200g" value={ftName} onChange={e => setFtName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Categoría (opcional)</Label>
              <Input className="h-10" placeholder="Ej: snacks, bebidas..." value={ftCategory} onChange={e => setFtCategory(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-11" onClick={() => setShowFT(false)} disabled={ftSaving}>Cancelar</Button>
              <Button className="flex-1 h-11 bg-emerald-700 hover:bg-emerald-800" onClick={submitFastTrack} disabled={ftSaving || !ftName.trim()}>
                {ftSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creando...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Crear y seleccionar</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
