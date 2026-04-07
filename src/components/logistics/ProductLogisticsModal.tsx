import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Save, BadgeCheck, Package2, Boxes, AlertCircle } from 'lucide-react';

interface Family    { id: string; name: string }
interface Subfamily { id: string; family_id: string; name: string }
interface Packaging {
  id?: string;
  uom_name: string;
  conversion_factor: number;
  barcode: string;
  is_branch_order_allowed: boolean;
  _dirty?: boolean;
  _delete?: boolean;
}

interface Product {
  id: string;
  name: string;
  family_id: string | null;
  subfamily_id: string | null;
  moq: number;
  min_stock: number;
}

interface Props {
  product: Product;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormErrors {
  moq?: string;
  minStock?: string;
  packagings?: Record<number, { uom_name?: string; conversion_factor?: string }>;
}

// ── Función de validación completa ────────────────────────────────────────────
function validate(
  moq: string,
  minStock: string,
  packagings: Packaging[],
): FormErrors {
  const errors: FormErrors = {};

  const moqNum = parseInt(moq);
  if (isNaN(moqNum) || moqNum < 1) {
    errors.moq = 'El MOQ debe ser un número mayor o igual a 1.';
  }

  const minNum = parseInt(minStock);
  if (isNaN(minNum) || minNum < 0) {
    errors.minStock = 'El stock mínimo no puede ser negativo.';
  }

  const pkgErrors: Record<number, { uom_name?: string; conversion_factor?: string }> = {};
  packagings.forEach((pkg, idx) => {
    if (pkg._delete) return;
    const row: { uom_name?: string; conversion_factor?: string } = {};
    if (!pkg.uom_name.trim()) row.uom_name = 'El nombre del empaque es obligatorio.';
    if (pkg.conversion_factor < 1) row.conversion_factor = 'El factor debe ser ≥ 1.';
    if (Object.keys(row).length > 0) pkgErrors[idx] = row;
  });
  if (Object.keys(pkgErrors).length > 0) errors.packagings = pkgErrors;

  return errors;
}

const hasErrors = (e: FormErrors) =>
  !!(e.moq || e.minStock || (e.packagings && Object.keys(e.packagings).length > 0));

export const ProductLogisticsModal = ({ product, open, onClose, onSaved }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving]           = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  const [families, setFamilies]         = useState<Family[]>([]);
  const [subfamilies, setSubfamilies]   = useState<Subfamily[]>([]);
  const [filteredSubs, setFilteredSubs] = useState<Subfamily[]>([]);

  const [familyId, setFamilyId]       = useState<string>('');
  const [subfamilyId, setSubfamilyId] = useState<string>('');
  const [moq, setMoq]                 = useState('1');
  const [minStock, setMinStock]       = useState('0');
  const [packagings, setPackagings]   = useState<Packaging[]>([]);
  const [errors, setErrors]           = useState<FormErrors>({});

  // Cada vez que se abre el modal (o cambia de producto), resetea todo y carga datos frescos
  useEffect(() => {
    if (!open) {
      // Al cerrar: limpiar errores y estado de guardado por si acaso
      setErrors({});
      setSaving(false);
      return;
    }
    setFamilyId(product.family_id || '');
    setSubfamilyId(product.subfamily_id || '');
    setMoq(String(product.moq ?? 1));
    setMinStock(String(product.min_stock ?? 0));
    setErrors({});
    loadData();
  }, [open, product.id]);

  // Cascada familia → subfamilias
  useEffect(() => {
    const subs = familyId ? subfamilies.filter(s => s.family_id === familyId) : [];
    setFilteredSubs(subs);
    if (subfamilyId && !subs.find(s => s.id === subfamilyId)) {
      setSubfamilyId('');
    }
  }, [familyId, subfamilies]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      const [{ data: fams, error: e1 }, { data: subs, error: e2 }, { data: pkgs, error: e3 }] =
        await Promise.all([
          supabase.from('product_families').select('id,name').order('name'),
          supabase.from('product_subfamilies').select('id,family_id,name').order('name'),
          supabase.from('product_packaging').select('*').eq('product_id', product.id).order('created_at'),
        ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      setFamilies(fams || []);
      setSubfamilies(subs || []);
      setPackagings((pkgs || []).map(p => ({
        id: p.id,
        uom_name: p.uom_name,
        conversion_factor: p.conversion_factor,
        barcode: p.barcode || '',
        is_branch_order_allowed: p.is_branch_order_allowed,
        _dirty: false,
        _delete: false,
      })));
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al cargar datos', description: e.message });
    } finally {
      setLoadingData(false);
    }
  };

  // ── Empaques helpers ──────────────────────────────────────────────────────
  const addPackaging = () => {
    setPackagings(prev => [...prev, {
      uom_name: '', conversion_factor: 1, barcode: '',
      is_branch_order_allowed: true, _dirty: true,
    }]);
  };

  const updatePkg = (idx: number, field: keyof Packaging, value: unknown) => {
    setPackagings(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value, _dirty: true } : p));
    // Limpiar error del campo modificado al instante
    if (field === 'uom_name' || field === 'conversion_factor') {
      setErrors(prev => {
        if (!prev.packagings?.[idx]) return prev;
        const updated = { ...prev.packagings };
        delete updated[idx]?.[field as 'uom_name' | 'conversion_factor'];
        if (Object.keys(updated[idx] || {}).length === 0) delete updated[idx];
        return { ...prev, packagings: Object.keys(updated).length ? updated : undefined };
      });
    }
  };

  const markDelete = (idx: number) => {
    setPackagings(prev => prev.map((p, i) => i === idx ? { ...p, _delete: true } : p));
    setErrors(prev => {
      if (!prev.packagings?.[idx]) return prev;
      const updated = { ...prev.packagings };
      delete updated[idx];
      return { ...prev, packagings: Object.keys(updated).length ? updated : undefined };
    });
  };

  const visiblePackagings = packagings.filter(p => !p._delete);

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // Validar antes de enviar
    const errs = validate(moq, minStock, packagings);
    if (hasErrors(errs)) {
      setErrors(errs);
      toast({
        variant: 'destructive',
        title: 'Datos inválidos',
        description: 'Revisa los campos marcados en rojo antes de guardar.',
      });
      return;
    }

    setSaving(true);
    try {
      const { error: prodErr } = await supabase
        .from('products')
        .update({
          family_id:    familyId    || null,
          subfamily_id: subfamilyId || null,
          moq:          parseInt(moq),
          min_stock:    parseInt(minStock),
        })
        .eq('id', product.id);
      if (prodErr) throw prodErr;

      // Borrar empaques marcados
      const toDelete = packagings.filter(p => p._delete && p.id);
      for (const pkg of toDelete) {
        const { error } = await supabase.from('product_packaging').delete().eq('id', pkg.id!);
        if (error) throw error;
      }

      // Upsert empaques sucios y no borrados
      const toUpsert = packagings.filter(p => p._dirty && !p._delete && p.uom_name.trim());
      for (const pkg of toUpsert) {
        const payload = {
          uom_name:               pkg.uom_name.trim(),
          conversion_factor:      pkg.conversion_factor,
          barcode:                pkg.barcode.trim() || null,
          is_branch_order_allowed: pkg.is_branch_order_allowed,
        };
        if (pkg.id) {
          const { error } = await supabase.from('product_packaging').update(payload).eq('id', pkg.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('product_packaging').insert({ ...payload, product_id: product.id });
          if (error) throw error;
        }
      }

      toast({ title: '✅ Configuración guardada', description: `"${product.name}" actualizado correctamente.` });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  // Limpiar error de un campo numérico al editar
  const clearError = (field: keyof FormErrors) =>
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-green-600" />
            Configurar Logística — <span className="text-[#8B4513]">{product.name}</span>
          </DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Tabs defaultValue="general">
              <TabsList className="grid grid-cols-2 w-full mb-4">
                <TabsTrigger value="general" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
                  <Package2 className="h-4 w-4 mr-2" /> Datos Generales
                  {(errors.moq || errors.minStock) && (
                    <AlertCircle className="h-3.5 w-3.5 ml-1 text-red-400" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="uom" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
                  <Boxes className="h-4 w-4 mr-2" /> Empaques / UoM
                  {errors.packagings && Object.keys(errors.packagings).length > 0 && (
                    <AlertCircle className="h-3.5 w-3.5 ml-1 text-red-400" />
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── TAB 1: Datos Generales ────────────────────────────────── */}
              <TabsContent value="general" className="space-y-4 px-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Familia</Label>
                    <Select value={familyId} onValueChange={v => setFamilyId(v === '__none__' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin familia" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sin familia</SelectItem>
                        {families.map(f => (
                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Subfamilia</Label>
                    <Select
                      value={subfamilyId}
                      onValueChange={v => setSubfamilyId(v === '__none__' ? '' : v)}
                      disabled={!familyId || filteredSubs.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={!familyId ? 'Elige familia primero' : 'Sin subfamilia'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sin subfamilia</SelectItem>
                        {filteredSubs.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>MOQ — Cantidad Mínima de Pedido</Label>
                    <Input
                      type="number" min="1"
                      value={moq}
                      onChange={e => { setMoq(e.target.value); clearError('moq'); }}
                      className={errors.moq ? 'border-red-400 focus-visible:ring-red-300' : ''}
                    />
                    {errors.moq
                      ? <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{errors.moq}</p>
                      : <p className="text-xs text-slate-400">Las sedes deben pedir al menos esta cantidad de golpe.</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Stock Mínimo (alerta)</Label>
                    <Input
                      type="number" min="0"
                      value={minStock}
                      onChange={e => { setMinStock(e.target.value); clearError('minStock'); }}
                      className={errors.minStock ? 'border-red-400 focus-visible:ring-red-300' : ''}
                    />
                    {errors.minStock
                      ? <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{errors.minStock}</p>
                      : <p className="text-xs text-slate-400">Se generará alerta cuando el stock baje de este número.</p>}
                  </div>
                </div>
              </TabsContent>

              {/* ── TAB 2: UoM / Empaques ─────────────────────────────────── */}
              <TabsContent value="uom" className="space-y-4 px-1">
                <p className="text-sm text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <strong>La unidad base (1 un)</strong> es la que se vende en el kiosco.
                  Define aquí cómo <em>compras</em> al proveedor y cómo <em>distribuyes</em> a las sedes.
                </p>

                {visiblePackagings.length > 0 && (
                  <div className="grid grid-cols-12 gap-2 px-1 text-xs font-bold text-slate-500">
                    <span className="col-span-3">Empaque</span>
                    <span className="col-span-2 text-center">Factor</span>
                    <span className="col-span-4">Cód. de barras</span>
                    <span className="col-span-2 text-center">Sedes ✓</span>
                    <span className="col-span-1" />
                  </div>
                )}

                <div className="space-y-3">
                  {visiblePackagings.map((pkg, visIdx) => {
                    const realIdx = packagings.indexOf(pkg);
                    const pkgErr  = errors.packagings?.[realIdx];
                    return (
                      <div key={visIdx} className="space-y-1">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <Input
                            className={`col-span-3 h-8 text-sm ${pkgErr?.uom_name ? 'border-red-400' : ''}`}
                            placeholder="Caja, Tira…"
                            value={pkg.uom_name}
                            onChange={e => updatePkg(realIdx, 'uom_name', e.target.value)}
                          />
                          <div className="col-span-2 flex items-center gap-1">
                            <Input
                              type="number" min="1"
                              className={`h-8 text-sm text-center ${pkgErr?.conversion_factor ? 'border-red-400' : ''}`}
                              value={pkg.conversion_factor}
                              onChange={e => updatePkg(realIdx, 'conversion_factor', parseInt(e.target.value) || 1)}
                            />
                            <span className="text-xs text-slate-400 shrink-0">un.</span>
                          </div>
                          <Input
                            className="col-span-4 h-8 text-sm"
                            placeholder="(opcional)"
                            value={pkg.barcode}
                            onChange={e => updatePkg(realIdx, 'barcode', e.target.value)}
                          />
                          <div className="col-span-2 flex justify-center">
                            <Checkbox
                              checked={pkg.is_branch_order_allowed}
                              onCheckedChange={v => updatePkg(realIdx, 'is_branch_order_allowed', !!v)}
                              title="¿Las sedes pueden pedirlo en este empaque?"
                            />
                          </div>
                          <Button
                            size="sm" variant="ghost"
                            className="col-span-1 h-7 w-7 p-0 text-red-400 hover:text-red-600"
                            onClick={() => markDelete(realIdx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {/* Errores inline por fila */}
                        {(pkgErr?.uom_name || pkgErr?.conversion_factor) && (
                          <div className="col-span-12 flex gap-4 pl-1">
                            {pkgErr?.uom_name && (
                              <p className="text-xs text-red-500 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />{pkgErr.uom_name}
                              </p>
                            )}
                            {pkgErr?.conversion_factor && (
                              <p className="text-xs text-red-500 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />{pkgErr.conversion_factor}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {visiblePackagings.length === 0 && (
                  <p className="text-center text-slate-400 py-6 text-sm">
                    Sin empaques definidos. Añade el primero con el botón de abajo.
                  </p>
                )}

                <Button variant="outline" className="w-full border-dashed" onClick={addPackaging}>
                  <Plus className="h-4 w-4 mr-2" /> Añadir empaque
                </Button>

                {visiblePackagings.length > 0 && (
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">Sedes ✓</Badge>
                    = las sedes pueden pedirlo en ese empaque
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-[#8B4513] hover:bg-[#6F370F]"
            onClick={handleSave}
            disabled={saving || loadingData}
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando…</>
              : <><Save className="h-4 w-4 mr-2" />Guardar Configuración</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
