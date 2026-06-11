import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowRightLeft, Plus, Loader2, CheckCircle2, Trash2, ChevronDown, ChevronUp, Package,
} from 'lucide-react';

interface School  { id: string; name: string; }
interface Product { id: string; name: string; code: string; }

interface TransferLine { product_id: string; quantity: number; }

interface Transfer {
  id: string;
  from_school_id: string;
  to_school_id:   string;
  notes:          string | null;
  status:         string;
  created_at:     string;
  from_school?:   { name: string } | null;
  to_school?:     { name: string } | null;
  items?:         Array<{ quantity: number; product: { name: string; code: string } }>;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  completed: { label: 'Completado', color: 'bg-green-100 text-green-800' },
  pending:   { label: 'Pendiente',  color: 'bg-amber-100 text-amber-800' },
  cancelled: { label: 'Cancelado',  color: 'bg-red-100 text-red-800' },
};

export function InternalTransfersTab() {
  const { toast } = useToast();

  const [transfers, setTransfers]   = useState<Transfer[]>([]);
  const [schools, setSchools]       = useState<School[]>([]);
  const [products, setProducts]     = useState<Product[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Formulario
  const [fFrom, setFFrom]   = useState('');
  const [fTo, setFTo]       = useState('');
  const [fNotes, setFNotes] = useState('');
  const [lines, setLines]   = useState<TransferLine[]>([{ product_id: '', quantity: 1 }]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: schData }, { data: prodData }, { data: txData }] = await Promise.all([
      supabase.from('schools').select('id, name').eq('is_active', true).order('name'),
      supabase.from('products').select('id, name, code').eq('active', true).order('name'),
      supabase
        .from('internal_transfers')
        .select(`*, from_school:schools!internal_transfers_from_school_id_fkey(name),
                    to_school:schools!internal_transfers_to_school_id_fkey(name),
                    items:internal_transfer_items(quantity, product:products(name,code))`)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    setSchools(schData || []);
    setProducts(prodData || []);
    setTransfers((txData || []) as Transfer[]);
    setLoading(false);
  };

  const openCreate = () => {
    setFFrom('');
    setFTo('');
    setFNotes('');
    setLines([{ product_id: '', quantity: 1 }]);
    setShowModal(true);
  };

  const addLine    = () => setLines(prev => [...prev, { product_id: '', quantity: 1 }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof TransferLine, value: string | number) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));

  const handleSave = async () => {
    if (!fFrom || !fTo) {
      toast({ variant: 'destructive', title: 'Selecciona sede de origen y destino' });
      return;
    }
    if (fFrom === fTo) {
      toast({ variant: 'destructive', title: 'El origen y destino no pueden ser la misma sede' });
      return;
    }
    const validLines = lines.filter(l => l.product_id && l.quantity > 0);
    if (validLines.length === 0) {
      toast({ variant: 'destructive', title: 'Agrega al menos un producto con cantidad > 0' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_internal_transfer', {
        p_from_school_id: fFrom,
        p_to_school_id:   fTo,
        p_items:          validLines.map(l => ({ product_id: l.product_id, quantity: l.quantity })),
        p_notes:          fNotes.trim() || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error('El traslado no se pudo completar');

      toast({
        title: '✅ Traslado registrado',
        description: `${validLines.length} producto(s) movidos de sede correctamente.`,
      });
      setShowModal(false);
      loadAll();
    } catch (e: any) {
      const msg = e.message || '';
      const detail = msg.includes('INSUFFICIENT_STOCK:') ? msg.split('INSUFFICIENT_STOCK: ')[1] : msg;
      toast({ variant: 'destructive', title: 'Error en traslado', description: detail });
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
                <ArrowRightLeft className="h-6 w-6 text-blue-700" />
                Traslados entre Sedes
              </CardTitle>
              <CardDescription>
                Mueve stock de una sede a otra. El Kardex registra automáticamente la salida y la entrada.
              </CardDescription>
            </div>
            <Button className="bg-blue-700 hover:bg-blue-800" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Traslado
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-12">
              <ArrowRightLeft className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-400">No hay traslados registrados.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transfers.map(t => {
                const s = STATUS_LABELS[t.status] || STATUS_LABELS.completed;
                return (
                  <Card key={t.id} className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.color}`}>
                              {s.label}
                            </span>
                            <span className="text-sm font-medium text-slate-700">
                              {t.from_school?.name ?? '—'}
                            </span>
                            <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            <span className="text-sm font-medium text-slate-700">
                              {t.to_school?.name ?? '—'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                            <span>
                              {new Date(t.created_at).toLocaleDateString('es-PE', {
                                day: '2-digit', month: 'short', year: 'numeric',
                              })}
                            </span>
                            <span>{t.items?.length ?? 0} producto(s)</span>
                            {t.notes && <span className="italic truncate max-w-[200px]">{t.notes}</span>}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost"
                          onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                          {expandedId === t.id
                            ? <ChevronUp className="h-4 w-4" />
                            : <ChevronDown className="h-4 w-4" />
                          }
                        </Button>
                      </div>

                      {expandedId === t.id && t.items && (
                        <div className="mt-3 border-t pt-3 space-y-1">
                          {t.items.map((it, i) => (
                            <div key={i} className="flex justify-between text-sm text-slate-600">
                              <span>
                                <span className="font-medium">{it.product.name}</span>
                                <span className="text-xs text-slate-400 ml-1">({it.product.code})</span>
                              </span>
                              <Badge variant="outline" className="text-xs">{it.quantity} un.</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal nuevo traslado */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-blue-700" />
              Nuevo Traslado de Stock
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sede de origen <span className="text-red-500">*</span></Label>
                <Select value={fFrom} onValueChange={setFFrom}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {schools.filter(s => s.id !== fTo).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sede de destino <span className="text-red-500">*</span></Label>
                <Select value={fTo} onValueChange={setFTo}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {schools.filter(s => s.id !== fFrom).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Ítems */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4" /> Productos a trasladar
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="h-3 w-3 mr-1" /> Añadir
                </Button>
              </div>

              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-8 space-y-1">
                    {idx === 0 && <Label className="text-xs text-slate-500">Producto</Label>}
                    <Select value={l.product_id} onValueChange={v => updateLine(idx, 'product_id', v)}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {products.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} <span className="text-xs text-slate-400">({p.code})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3 space-y-1">
                    {idx === 0 && <Label className="text-xs text-slate-500">Cantidad</Label>}
                    <Input
                      type="number" min="1"
                      value={l.quantity}
                      onChange={e => updateLine(idx, 'quantity', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {lines.length > 1 && (
                      <Button type="button" size="sm" variant="ghost"
                        className="text-red-500 p-1" onClick={() => removeLine(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Input
                placeholder="Motivo del traslado..."
                value={fNotes}
                onChange={e => setFNotes(e.target.value)}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
              El sistema validará que haya stock suficiente en la sede de origen antes de confirmar.
              Si no hay stock, el traslado se cancelará sin afectar ningún inventario.
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 bg-blue-700 hover:bg-blue-800" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Procesando...</>
                  : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar Traslado</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
