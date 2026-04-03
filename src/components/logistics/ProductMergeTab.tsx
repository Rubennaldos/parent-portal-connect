import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Merge, Search, Plus, X, ArrowRight, Package, Loader2,
  AlertTriangle, CheckCircle2, Building2, BadgeCheck, RefreshCw,
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  code: string;
  category: string;
  price_sale: number;
  price_cost: number;
  active: boolean;
  school_ids: string[];
  is_verified?: boolean;
}

interface School {
  id: string;
  name: string;
}

interface SchoolPrice {
  school_id: string;
  price_sale: string;
}

// Normaliza texto: quita tildes y pasa a minúsculas para búsqueda tolerante
const normalize = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const ProductMergeTab = () => {
  const { toast } = useToast();

  // Data
  const [products, setProducts]     = useState<Product[]>([]);
  const [schools, setSchools]       = useState<School[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [merging, setMerging]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Left column search
  const [search, setSearch] = useState('');

  // Right column: selected products
  const [selected, setSelected] = useState<Product[]>([]);

  // New product form
  const [newName, setNewName]           = useState('');
  const [newCategory, setNewCategory]   = useState('otros');
  const [newCode, setNewCode]           = useState('');
  const [newPriceSale, setNewPriceSale] = useState('');
  const [newPriceCost, setNewPriceCost] = useState('');
  const [schoolPrices, setSchoolPrices] = useState<SchoolPrice[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [{ data: prods }, { data: schs }, { data: cats }] = await Promise.all([
      supabase
        .from('products')
        .select('id,name,code,category,price_sale,price_cost,active,school_ids,is_verified')
        .eq('active', true)
        .order('name'),
      supabase.from('schools').select('id,name').order('name'),
      supabase.from('product_categories').select('name').order('name'),
    ]);
    setProducts(prods || []);
    setSchools(schs || []);
    // Siempre inicializar precios por sede para TODAS las sedes
    setSchoolPrices((schs || []).map(s => ({ school_id: s.id, price_sale: '' })));
    // Categorías desde BD; fallback a lista base si la tabla no existe aún
    if (cats && cats.length > 0) {
      setCategories(cats.map(c => c.name));
    } else {
      setCategories([
        'bebidas','chocolates','dulces','frutas','galletas',
        'golosinas','jugos','menu','otros','postres',
        'refrescos','sandwiches','snack','snacks',
      ]);
    }
    setLoading(false);
  };

  // Normalización de búsqueda: ignora tildes y mayúsculas
  const availableProducts = useMemo(() => {
    const selectedIds = new Set(selected.map(p => p.id));
    const q = normalize(search);
    return products.filter(p =>
      !selectedIds.has(p.id) &&
      (!q ||
        normalize(p.name).includes(q) ||
        normalize(p.code).includes(q) ||
        normalize(p.category).includes(q))
    );
  }, [products, selected, search]);

  const addToMerge = (product: Product) => {
    setSelected(prev => {
      if (prev.length === 0) {
        setNewName(product.name);
        setNewCategory(product.category);
        setNewCode(product.code);
        setNewPriceSale(String(product.price_sale));
        setNewPriceCost(String(product.price_cost));
      }
      return [...prev, product];
    });
  };

  const removeFromMerge = (id: string) => {
    setSelected(prev => prev.filter(p => p.id !== id));
  };

  // Sanitiza un input de precio: reemplaza coma por punto, elimina todo lo que no sea dígito o punto
  const sanitizePrice = (raw: string): string =>
    raw.replace(',', '.').replace(/[^0-9.]/g, '');

  const updateSchoolPrice = (schoolId: string, value: string) => {
    const clean = sanitizePrice(value);
    setSchoolPrices(prev =>
      prev.map(sp => sp.school_id === schoolId ? { ...sp, price_sale: clean } : sp)
    );
  };

  // Generar código de barras automático — timestamp completo + 4 chars random = sin colisiones
  const generateCode = () => {
    const random = Math.random().toString(36).slice(-4).toUpperCase();
    const code = `PRD${Date.now()}${random}`;
    setNewCode(code);
  };

  const handleMerge = async () => {
    if (selected.length < 2) {
      toast({ variant: 'destructive', title: 'Se necesitan al menos 2 productos', description: 'La fusión requiere mínimo 2 productos para tener sentido.' });
      return;
    }
    if (!newName.trim()) {
      toast({ variant: 'destructive', title: 'Falta el nombre', description: 'El nombre del producto maestro es obligatorio.' });
      return;
    }
    const cleanPrice = sanitizePrice(newPriceSale);
    if (!cleanPrice || isNaN(parseFloat(cleanPrice)) || parseFloat(cleanPrice) <= 0) {
      toast({ variant: 'destructive', title: 'Precio inválido', description: 'El precio base debe ser mayor a 0.' });
      return;
    }
    setShowConfirm(true);
  };

  const executeMerge = async () => {
    setMerging(true);
    setShowConfirm(false);
    try {
      // Sanitizar antes de enviar a BD — elimina comas, espacios, texto
      const validSchoolPrices = schoolPrices
        .filter(sp => {
          const clean = sanitizePrice(sp.price_sale);
          return clean !== '' && !isNaN(parseFloat(clean)) && parseFloat(clean) > 0;
        })
        .map(sp => ({ school_id: sp.school_id, price_sale: parseFloat(sanitizePrice(sp.price_sale)) }));

      // Código: trim + uppercase para evitar duplicados invisibles (abc-1 vs ABC-1)
      const finalCode = newCode.trim().toUpperCase();

      const { error } = await supabase.rpc('merge_products', {
        p_old_product_ids: selected.map(p => p.id),
        p_new_product_data: {
          name:       newName.trim(),
          code:       finalCode,
          category:   newCategory,
          price_sale: parseFloat(sanitizePrice(newPriceSale)),
          price_cost: parseFloat(sanitizePrice(newPriceCost)) || 0,
        },
        p_school_prices: validSchoolPrices,
      });

      if (error) throw error;

      toast({
        title: '✅ Producto fusionado y verificado (Sello Verde)',
        description: `${selected.length} producto(s) fusionados en "${newName.trim()}". Ahora es el estándar oficial del catálogo.`,
      });

      // Reset
      setSelected([]);
      setNewName('');
      setNewCategory('otros');
      setNewCode('');
      setNewPriceSale('');
      setNewPriceCost('');
      setSearch('');
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error en la fusión', description: e.message });
    } finally {
      setMerging(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <Loader2 className="h-10 w-10 animate-spin text-[#8B4513]" />
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Merge className="h-6 w-6 text-[#8B4513]" />
            Match / Fusión de Productos
          </CardTitle>
          <CardDescription>
            Selecciona productos duplicados o similares de la izquierda, defínelos en uno solo a la derecha y ejecuta la fusión.
            El historial de ventas se conserva íntegro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ── COLUMNA IZQUIERDA: Buscador ──────────────────────────────── */}
            <div className="space-y-3">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Productos disponibles
                <Badge variant="outline">{availableProducts.length}</Badge>
              </h3>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, código o categoría..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Lista más alta para ver más productos */}
              <div className="border rounded-lg overflow-y-auto max-h-[520px] divide-y">
                {availableProducts.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    {search ? 'Sin resultados para tu búsqueda' : 'Todos los productos han sido seleccionados'}
                  </div>
                ) : (
                  availableProducts.map(product => (
                    <div
                      key={product.id}
                      className={`flex items-center justify-between px-3 py-2.5 transition border-l-4 ${
                        product.is_verified
                          ? 'bg-green-50/90 border-green-500 hover:bg-green-50'
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {product.is_verified && (
                            <BadgeCheck className="h-4 w-4 text-green-600 shrink-0" aria-hidden />
                          )}
                          <p className="font-medium text-sm text-slate-800 truncate">{product.name}</p>
                          {product.is_verified && (
                            <Badge className="shrink-0 bg-green-100 text-green-800 border-green-200 text-[9px] px-1 py-0 h-4">
                              Verificado
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-400 font-mono">{product.code}</span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{product.category}</Badge>
                          <span className="text-xs font-semibold text-green-600">S/ {product.price_sale?.toFixed(2)}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-2 h-7 w-7 p-0 rounded-full bg-[#8B4513] hover:bg-[#6F370F] text-white shrink-0"
                        onClick={() => addToMerge(product)}
                        title="Agregar a la fusión"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── COLUMNA DERECHA: Seleccionados + Formulario ──────────────── */}
            <div className="space-y-4">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-[#8B4513]" />
                Productos a fusionar
                {selected.length > 0 && (
                  <Badge className="bg-[#8B4513]">{selected.length}</Badge>
                )}
              </h3>

              {/* Lista de seleccionados — altura aumentada */}
              <div className="border rounded-lg overflow-y-auto max-h-[240px] divide-y bg-orange-50 min-h-[80px]">
                {selected.length === 0 ? (
                  <p className="text-center py-6 text-slate-400 text-sm">
                    Presiona "+" en un producto de la izquierda para agregarlo aquí
                  </p>
                ) : (
                  selected.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-orange-100">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          {p.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />}
                          <p className="text-sm font-medium text-slate-700 truncate">{p.name}</p>
                        </div>
                        <span className="text-xs text-slate-400">{p.code} · S/ {p.price_sale?.toFixed(2)}</span>
                      </div>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => removeFromMerge(p.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Separador visual */}
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="flex-1 h-px bg-slate-200" />
                <span>Nuevo Producto Renacido</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Formulario del nuevo producto */}
              <div className="space-y-3 bg-blue-50 rounded-lg p-4 border border-blue-100">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Nombre Oficial <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="Nombre definitivo del producto"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className="bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Categoría</Label>
                    <Select value={newCategory} onValueChange={setNewCategory}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(c => (
                          <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Código de barras con botón generar */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Código de Barras</Label>
                    <div className="flex gap-1.5">
                      <Input
                        placeholder="Ej: 7751234567890"
                        value={newCode}
                        onChange={e => setNewCode(e.target.value)}
                        className="bg-white flex-1 min-w-0"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={generateCode}
                        title="Generar código automáticamente"
                        className="shrink-0 h-9 w-9 p-0 bg-white"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <p className="text-[10px] text-slate-400">Deja vacío o usa <RefreshCw className="inline h-2.5 w-2.5" /> para generar uno automático</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Precio Base (S/) <span className="text-red-500">*</span></Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={newPriceSale} onChange={e => setNewPriceSale(e.target.value)} className="bg-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Costo (S/)</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={newPriceCost} onChange={e => setNewPriceCost(e.target.value)} className="bg-white" />
                  </div>
                </div>

                {/* Precios por sede — SIEMPRE muestra todas las sedes */}
                {schools.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> Precio por sede <span className="font-normal text-slate-400">(opcional — vacío = usa precio base)</span>
                    </Label>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                      {schools.map(school => (
                        <div key={school.id} className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 flex-1 truncate">{school.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs text-slate-400">S/</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder={newPriceSale || '0.00'}
                              value={schoolPrices.find(sp => sp.school_id === school.id)?.price_sale || ''}
                              onChange={e => updateSchoolPrice(school.id, e.target.value)}
                              className="w-24 h-7 text-sm bg-white"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Advertencia */}
              {selected.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                  <span>
                    Los <strong>{selected.length} producto(s)</strong> seleccionados quedarán como <strong>inactivos</strong>.
                    Su historial de ventas y stock se transferirá al nuevo producto. Esta acción no se puede deshacer.
                  </span>
                </div>
              )}

              {/* Botón de acción */}
              <Button
                className="w-full bg-[#8B4513] hover:bg-[#6F370F] h-11 font-bold"
                onClick={handleMerge}
                disabled={merging || selected.length === 0}
              >
                {merging
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Fusionando...</>
                  : <><Merge className="h-4 w-4 mr-2" />Fusionar y Reemplazar ({selected.length} seleccionados)</>
                }
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modal de confirmación */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar Fusión de Productos
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  ¿Estás seguro de fusionar estos <strong>{selected.length} productos</strong> en{' '}
                  <strong>"{newName}"</strong>?{' '}
                  Esta acción <span className="text-red-600 font-semibold">desactivará los otros {selected.length - 1} producto(s)</span> permanentemente.
                </p>
                <div className="bg-slate-50 rounded-lg p-3 space-y-1">
                  <p><strong>Producto maestro:</strong> {newName} — S/ {parseFloat(sanitizePrice(newPriceSale) || '0').toFixed(2)}</p>
                  <p className="text-slate-500">Código: {newCode.trim().toUpperCase() || '(sin código)'} · Categoría: {newCategory}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-red-600 font-semibold text-xs">Se desactivarán ({selected.length} productos):</p>
                  {selected.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs text-slate-600">
                      <X className="h-3 w-3 text-red-400" />
                      {p.name} ({p.code})
                    </div>
                  ))}
                </div>
                <p className="font-medium text-amber-700">⚠️ Esta acción no se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#8B4513] hover:bg-[#6F370F]"
              onClick={executeMerge}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Confirmar Fusión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
