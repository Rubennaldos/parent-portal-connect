import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ClipboardList, Plus, Trash2, Loader2, CheckCircle2, Package,
  FileText, ChevronDown, ChevronUp, Link, ExternalLink,
} from 'lucide-react';

interface Supplier   { id: string; name: string; ruc: string | null; }
interface Product    { id: string; name: string; code: string; price_cost: number; }
interface Packaging  { id: string; uom_name: string; conversion_factor: number; }
interface EntryItem  {
  product_id: string;
  quantity:   number;    // en la unidad del uom_id seleccionado (o base si no hay UoM)
  unit_cost:  number;
  uom_id:     string;    // '' = sin UoM (unidades directas)
  packagings: Packaging[]; // opciones de empaque del producto seleccionado
}

interface Entry {
  id: string;
  supplier_id: string | null;
  doc_type: string;
  doc_number: string | null;
  total_amount: number;
  notes: string | null;
  evidence_url: string | null;
  created_at: string;
  supplier?: { name: string; ruc: string | null } | null;
  items?: Array<{ quantity: number; unit_cost: number; product: { name: string; code: string } }>;
}

const DOC_LABELS: Record<string, string> = {
  boleta:  'Boleta',
  factura: 'Factura',
  guia:    'Guía de remisión',
};

export const PurchaseEntriesTab = ({ schoolId }: { schoolId: string | null }) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries]     = useState<Entry[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Formulario cabecera
  const [fSupplierId, setFSupplierId]   = useState('');
  const [fDocType, setFDocType]         = useState<'boleta' | 'factura' | 'guia'>('boleta');
  const [fDocNumber, setFDocNumber]     = useState('');
  const [fNotes, setFNotes]             = useState('');
  const [fEvidenceUrl, setFEvidenceUrl] = useState('');

  // Ítems del formulario
  const [items, setItems] = useState<EntryItem[]>([
    { product_id: '', quantity: 1, unit_cost: 0, uom_id: '', packagings: [] },
  ]);

  useEffect(() => { loadAll(); }, [schoolId]);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: supData }, { data: prodData }, { data: entData }] = await Promise.all([
      supabase.from('suppliers').select('id, name, ruc').order('name'),
      supabase.from('products').select('id, name, code, price_cost').eq('active', true).order('name'),
      schoolId
        ? supabase
            .from('purchase_entries')
            .select(`*, supplier:suppliers(name,ruc), items:purchase_entry_items(quantity, unit_cost, product:products(name,code))`)
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
    ]);
    setSuppliers(supData || []);
    setProducts(prodData || []);
    setEntries((entData || []) as Entry[]);
    setLoading(false);
  };

  const openCreate = () => {
    setFSupplierId('');
    setFDocType('boleta');
    setFDocNumber('');
    setFNotes('');
    setFEvidenceUrl('');
    setItems([{ product_id: '', quantity: 1, unit_cost: 0, uom_id: '', packagings: [] }]);
    setShowModal(true);
  };

  const addItem = () =>
    setItems(prev => [...prev, { product_id: '', quantity: 1, unit_cost: 0, uom_id: '', packagings: [] }]);

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: keyof EntryItem, value: string | number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const handleProductSelect = async (idx: number, productId: string) => {
    const product = products.find(p => p.id === productId);

    // Cargar empaques disponibles para este producto desde la BD
    const { data: pkgData } = await supabase
      .from('product_packaging')
      .select('id, uom_name, conversion_factor')
      .eq('product_id', productId)
      .order('conversion_factor');

    setItems(prev => prev.map((it, i) =>
      i === idx
        ? { ...it, product_id: productId, unit_cost: product?.price_cost ?? 0, uom_id: '', packagings: pkgData || [] }
        : it
    ));
  };

  /** Calcula la cantidad en unidades base para mostrar preview (solo UI, la BD recalcula) */
  const getBaseUnitsPreview = (item: EntryItem): number => {
    if (!item.uom_id) return item.quantity;
    const pkg = item.packagings.find(p => p.id === item.uom_id);
    return item.quantity * (pkg?.conversion_factor ?? 1);
  };

  const totalAmount = items.reduce((sum, it) => sum + (it.quantity * it.unit_cost), 0);

  const handleSave = async () => {
    if (!schoolId || !user) {
      toast({ variant: 'destructive', title: 'Sin sede asignada' });
      return;
    }
    const validItems = items.filter(it => it.product_id && it.quantity > 0);
    if (validItems.length === 0) {
      toast({ variant: 'destructive', title: 'Agrega al menos un producto' });
      return;
    }

    setSaving(true);
    try {
      // 1. Crear cabecera con evidencia documental
      const { data: entry, error: entErr } = await supabase
        .from('purchase_entries')
        .insert({
          supplier_id:  fSupplierId || null,
          school_id:    schoolId,
          user_id:      user.id,
          doc_type:     fDocType,
          doc_number:   fDocNumber.trim()  || null,
          total_amount: totalAmount,
          notes:        fNotes.trim()      || null,
          evidence_url: fEvidenceUrl.trim() || null,
        })
        .select('id')
        .single();
      if (entErr) throw entErr;

      // 2. Crear ítems del detalle
      const { error: itemsErr } = await supabase.from('purchase_entry_items').insert(
        validItems.map(it => ({
          entry_id:   entry.id,
          product_id: it.product_id,
          quantity:   it.quantity,
          unit_cost:  it.unit_cost,
        }))
      );
      if (itemsErr) throw itemsErr;

      // 3. Incrementar stock con trazabilidad completa:
      //    - p_uom_id: la BD convierte cajas→unidades base (nunca el navegador)
      //    - p_entry_id: amarra el Kardex a esta entrada
      //    - el RPC escribe 'entrada_compra' con la conversión documentada
      for (const it of validItems) {
        const { error: rpcErr } = await supabase.rpc('increment_product_stock', {
          p_product_id: it.product_id,
          p_school_id:  schoolId,
          p_quantity:   it.quantity,
          p_entry_id:   entry.id,
          p_reason:     `Entrada ${DOC_LABELS[fDocType] || fDocType}${fDocNumber ? ` #${fDocNumber}` : ''}`,
          p_uom_id:     it.uom_id || null,  // la BD calcula la conversión, no el frontend
        });
        if (rpcErr) throw rpcErr;
      }

      toast({
        title: '✅ Entrada registrada',
        description: `${validItems.length} producto(s). Total: S/ ${totalAmount.toFixed(2)}`,
      });
      setShowModal(false);
      loadAll();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-6 w-6 text-[#8B4513]" />
                Entradas de Stock
              </CardTitle>
              <CardDescription>
                Registra compras a proveedores. El stock sube automáticamente y queda auditado en el Kardex.
              </CardDescription>
            </div>
            <Button className="bg-[#8B4513] hover:bg-[#6F370F]" onClick={openCreate} disabled={!schoolId}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Entrada
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!schoolId ? (
            <p className="text-center py-8 text-slate-400">No hay sede asignada para registrar entradas.</p>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No hay entradas registradas. ¡Registra la primera compra!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map(entry => (
                <Card key={entry.id} className="border-l-4 border-l-green-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">{DOC_LABELS[entry.doc_type] || entry.doc_type}</Badge>
                          {entry.doc_number && (
                            <span className="text-sm font-mono text-slate-600">{entry.doc_number}</span>
                          )}
                          {entry.supplier && (
                            <span className="text-sm text-slate-500">{entry.supplier.name}</span>
                          )}
                          {entry.evidence_url && (
                            <a
                              href={entry.evidence_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                              title="Ver documento de respaldo"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Evidencia
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
                          <span>
                            {new Date(entry.created_at).toLocaleDateString('es-PE', {
                              day: '2-digit', month: 'short', year: 'numeric',
                            })}
                          </span>
                          <span className="font-semibold text-slate-700">
                            S/ {Number(entry.total_amount).toFixed(2)}
                          </span>
                          <span>{entry.items?.length ?? 0} producto(s)</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      >
                        {expandedId === entry.id
                          ? <ChevronUp className="h-4 w-4" />
                          : <ChevronDown className="h-4 w-4" />
                        }
                      </Button>
                    </div>

                    {expandedId === entry.id && entry.items && (
                      <div className="mt-3 border-t pt-3 space-y-1">
                        {entry.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between text-sm text-slate-600">
                            <span>
                              <span className="font-medium">{it.product.name}</span>
                              <span className="text-xs text-slate-400 ml-1">({it.product.code})</span>
                            </span>
                            <span>{it.quantity} × S/ {Number(it.unit_cost).toFixed(2)}</span>
                          </div>
                        ))}
                        {entry.notes && (
                          <p className="text-xs text-slate-400 mt-2 italic">{entry.notes}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal nueva entrada */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[#8B4513]" />
              Nueva Entrada de Stock
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">

            {/* Cabecera: proveedor, doc tipo, nro */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Proveedor</Label>
                <Select value={fSupplierId} onValueChange={setFSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.ruc ? ` (${s.ruc})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de documento <span className="text-red-500">*</span></Label>
                <Select value={fDocType} onValueChange={v => setFDocType(v as 'boleta' | 'factura' | 'guia')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleta">Boleta</SelectItem>
                    <SelectItem value="factura">Factura</SelectItem>
                    <SelectItem value="guia">Guía de remisión</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nro. de documento</Label>
                <Input
                  placeholder="Ej: F001-00123"
                  value={fDocNumber}
                  onChange={e => setFDocNumber(e.target.value)}
                />
              </div>
            </div>

            {/* Evidencia documental */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                URL de respaldo (foto o PDF del documento)
              </Label>
              <Input
                placeholder="https://drive.google.com/file/... o https://dropbox.com/..."
                value={fEvidenceUrl}
                onChange={e => setFEvidenceUrl(e.target.value)}
              />
              <p className="text-xs text-slate-400">
                Opcional. Pega el enlace de la foto/PDF de la factura para respaldo de auditoría.
              </p>
            </div>

            {/* Ítems */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4" /> Productos recibidos
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-3 w-3 mr-1" /> Añadir producto
                </Button>
              </div>

              <div className="space-y-3">
                {items.map((it, idx) => {
                  const basePreview = getBaseUnitsPreview(it);
                  const hasUom = it.uom_id && it.packagings.length > 0;
                  return (
                    <div key={idx} className="space-y-1.5 p-3 border border-slate-100 rounded-lg bg-slate-50/50">
                      <div className="grid grid-cols-12 gap-2 items-end">
                        {/* Producto */}
                        <div className="col-span-5 space-y-1">
                          {idx === 0 && <Label className="text-xs text-slate-500">Producto</Label>}
                          <Select value={it.product_id} onValueChange={v => handleProductSelect(idx, v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar..." />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} <span className="text-xs text-slate-400">({p.code})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Cantidad */}
                        <div className="col-span-2 space-y-1">
                          {idx === 0 && <Label className="text-xs text-slate-500">Cant.</Label>}
                          <Input
                            type="number" min="1"
                            value={it.quantity}
                            onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                          />
                        </div>

                        {/* Empaque (UoM) — solo si el producto tiene empaques configurados */}
                        <div className="col-span-3 space-y-1">
                          {idx === 0 && <Label className="text-xs text-slate-500">Empaque</Label>}
                          <Select
                            value={it.uom_id || '__unit__'}
                            onValueChange={v => updateItem(idx, 'uom_id', v === '__unit__' ? '' : v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unit__">Unidad</SelectItem>
                              {it.packagings.map(pkg => (
                                <SelectItem key={pkg.id} value={pkg.id}>
                                  {pkg.uom_name} (×{pkg.conversion_factor})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Costo */}
                        <div className="col-span-1 space-y-1">
                          {idx === 0 && <Label className="text-xs text-slate-500">Costo (S/)</Label>}
                          <Input
                            type="number" min="0" step="0.01"
                            value={it.unit_cost}
                            onChange={e => updateItem(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                          />
                        </div>

                        {/* Eliminar */}
                        <div className="col-span-1 flex justify-center pb-0.5">
                          {items.length > 1 && (
                            <Button type="button" size="sm" variant="ghost"
                              className="text-red-500 p-1" onClick={() => removeItem(idx)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Preview de conversión — solo informativo, la BD recalcula */}
                      {it.product_id && hasUom && (
                        <p className="text-[10px] text-emerald-700 font-medium pl-1">
                          Resultado en stock: {it.quantity} {it.packagings.find(p => p.id === it.uom_id)?.uom_name}
                          {' '}× {it.packagings.find(p => p.id === it.uom_id)?.conversion_factor} = <strong>{basePreview} unidades</strong>
                          {' '}(confirmado por la base de datos al guardar)
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <div className="bg-slate-50 rounded-lg px-4 py-2 text-right">
                  <p className="text-xs text-slate-500">Total calculado</p>
                  <p className="text-xl font-black text-slate-800">S/ {totalAmount.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4" /> Notas (opcional)
              </Label>
              <Input
                placeholder="Observaciones de la entrada..."
                value={fNotes}
                onChange={e => setFNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 bg-[#8B4513] hover:bg-[#6F370F]" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
                  : <><CheckCircle2 className="h-4 w-4 mr-2" />Registrar Entrada</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
