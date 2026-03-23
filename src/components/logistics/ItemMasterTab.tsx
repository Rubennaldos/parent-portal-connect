import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BadgeCheck, Search, Loader2, RefreshCw, Tag, DollarSign,
  Building2, Box, Settings, Layers, AlertTriangle, ArrowDownToLine
} from 'lucide-react';
import { FamilyManagerModal } from '@/components/logistics/FamilyManagerModal';
import { ProductLogisticsModal } from '@/components/logistics/ProductLogisticsModal';

interface VerifiedProduct {
  id: string;
  name: string;
  code: string;
  category: string;
  price_sale: number;
  price_cost: number;
  school_ids: string[];
  stock_control_enabled: boolean;
  moq: number;
  min_stock: number;
  family_id: string | null;
  subfamily_id: string | null;
  active: boolean;
  family?: { name: string } | null;
  subfamily?: { name: string } | null;
}

interface AllProduct {
  id: string;
  name: string;
  code: string;
  category: string;
  price_sale: number;
  is_verified: boolean;
}

export const ItemMasterTab = () => {
  const { toast } = useToast();

  const [products, setProducts]     = useState<VerifiedProduct[]>([]);
  const [allProducts, setAllProducts] = useState<AllProduct[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');

  // Modales
  const [showFamilyManager, setShowFamilyManager]     = useState(false);
  const [logisticsTarget, setLogisticsTarget]         = useState<VerifiedProduct | null>(null);
  const [absorbMaster, setAbsorbMaster]               = useState<VerifiedProduct | null>(null);
  const [absorbMinorId, setAbsorbMinorId]             = useState('');
  const [absorbConfirm, setAbsorbConfirm]             = useState(false);
  const [absorbing, setAbsorbing]                     = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [{ data: verified, error: e1 }, { data: all, error: e2 }] = await Promise.all([
        supabase
          .from('products')
          .select(`id, name, code, category, price_sale, price_cost, school_ids,
                   stock_control_enabled, moq, min_stock, family_id, subfamily_id, active,
                   family:product_families(name),
                   subfamily:product_subfamilies(name)`)
          .eq('is_verified', true)
          .eq('active', true)
          .order('name'),
        supabase
          .from('products')
          .select('id, name, code, category, price_sale, is_verified')
          .eq('active', true)
          .order('name'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setProducts(verified || []);
      setAllProducts(all || []);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al cargar el Maestro', description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.code.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.family?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const margin = (p: VerifiedProduct) => {
    if (!p.price_cost || p.price_cost === 0) return null;
    return (((p.price_sale - p.price_cost) / p.price_sale) * 100).toFixed(1);
  };

  // Productos disponibles para absorber (no el master, no ya verificados)
  const absorbCandidates = allProducts.filter(p =>
    p.id !== absorbMaster?.id && !p.is_verified
  );

  const handleAbsorb = async () => {
    if (!absorbMaster || !absorbMinorId) return;
    setAbsorbing(true);
    try {
      const { error } = await supabase.rpc('absorb_product', {
        p_master_id: absorbMaster.id,
        p_minor_id:  absorbMinorId,
      });
      if (error) throw error;
      const minor = allProducts.find(p => p.id === absorbMinorId);
      toast({
        title: '✅ Producto absorbido',
        description: `"${minor?.name}" ahora tiene su historial redirigido a "${absorbMaster.name}". Ambos siguen activos.`,
      });
      setAbsorbConfirm(false);
      setAbsorbMaster(null);
      setAbsorbMinorId('');
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setAbsorbing(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="h-6 w-6 text-green-600" />
                Maestro de Artículos
                <Badge className="bg-green-100 text-green-700 border border-green-200 ml-1">
                  Sello Verde
                </Badge>
              </CardTitle>
              <CardDescription>
                Catálogo oficial verificado. Configura familias, empaques y absorbe productos menores.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowFamilyManager(true)}>
                <Layers className="h-4 w-4 mr-2" /> Gestionar Familias
              </Button>
              <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-black text-green-700">{products.length}</p>
              <p className="text-xs text-green-600 font-medium">Artículos Verificados</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-black text-blue-700">
                {new Set(products.map(p => p.category)).size}
              </p>
              <p className="text-xs text-blue-600 font-medium">Categorías</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-black text-amber-700">
                {products.filter(p => p.stock_control_enabled).length}
              </p>
              <p className="text-xs text-amber-600 font-medium">Con Control de Stock</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-black text-purple-700">
                {products.filter(p => p.family_id).length}
              </p>
              <p className="text-xs text-purple-600 font-medium">Con Familia Asignada</p>
            </div>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, código, categoría o familia..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-green-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <BadgeCheck className="h-14 w-14 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">
                {search
                  ? 'Sin resultados'
                  : 'No hay productos verificados. Usa el tab "Match" o el botón "Verificar" en /products.'}
              </p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="font-bold">Producto</TableHead>
                    <TableHead className="font-bold">
                      <span className="flex items-center gap-1"><Tag className="h-3 w-3" />Categoría</span>
                    </TableHead>
                    <TableHead className="font-bold">
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />Familia</span>
                    </TableHead>
                    <TableHead className="font-bold text-right">
                      <span className="flex items-center gap-1 justify-end"><DollarSign className="h-3 w-3" />P. Venta</span>
                    </TableHead>
                    <TableHead className="font-bold text-right">Margen</TableHead>
                    <TableHead className="font-bold text-center">
                      <span className="flex items-center gap-1 justify-center"><Box className="h-3 w-3" />MOQ</span>
                    </TableHead>
                    <TableHead className="font-bold text-center">Stock Mín.</TableHead>
                    <TableHead className="font-bold text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => {
                    const m = margin(p);
                    return (
                      <TableRow key={p.id} className="hover:bg-green-50/40 transition">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <BadgeCheck className="h-4 w-4 text-green-500 shrink-0" />
                            <div>
                              <p className="font-semibold text-slate-800 text-sm">{p.name}</p>
                              <p className="text-xs text-slate-400 font-mono">{p.code}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{p.category}</Badge>
                        </TableCell>
                        <TableCell>
                          {p.family ? (
                            <div>
                              <p className="text-xs font-medium text-slate-700">{p.family.name}</p>
                              {p.subfamily && <p className="text-xs text-slate-400">{p.subfamily.name}</p>}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300 italic">Sin familia</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-green-600">
                          S/ {p.price_sale?.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          {m !== null ? (
                            <Badge className={`text-xs ${parseFloat(m) >= 30 ? 'bg-green-100 text-green-700' : parseFloat(m) >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                              {m}%
                            </Badge>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm text-slate-600">
                          {p.moq ?? 1}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm text-slate-500">
                          {p.min_stock ?? 0}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              title="Configurar familia, MOQ y empaques"
                              onClick={() => setLogisticsTarget(p)}
                            >
                              <Settings className="h-3 w-3 mr-1" />
                              Config.
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-purple-600 border-purple-200 hover:bg-purple-50"
                              title="Absorber un producto menor (redirige su historial a este master)"
                              onClick={() => { setAbsorbMaster(p); setAbsorbMinorId(''); }}
                            >
                              <ArrowDownToLine className="h-3 w-3 mr-1" />
                              Absorber
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {filtered.length > 0 && (
            <p className="text-xs text-slate-400 mt-3 text-right">
              {filtered.length} artículo(s) verificado(s){search && ` · Filtrado de ${products.length} total`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Modal: Gestionar Familias */}
      <FamilyManagerModal
        open={showFamilyManager}
        onClose={() => setShowFamilyManager(false)}
      />

      {/* Modal: Configurar Logística del Producto */}
      {logisticsTarget && (
        <ProductLogisticsModal
          product={logisticsTarget}
          open={!!logisticsTarget}
          onClose={() => setLogisticsTarget(null)}
          onSaved={loadData}
        />
      )}

      {/* Modal: Absorber producto menor */}
      <Dialog open={!!absorbMaster && !absorbConfirm} onOpenChange={v => { if (!v) { setAbsorbMaster(null); setAbsorbMinorId(''); setAbsorbConfirm(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5 text-purple-600" />
              Absorber Producto Menor
            </DialogTitle>
            <DialogDescription>
              El producto <strong>"{absorbMaster?.name}"</strong> (master) absorberá el historial de ventas y stock de otro producto.
              El producto menor <span className="text-green-700 font-medium">permanecerá activo</span> — solo su historial quedará unificado con el master.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Producto menor a absorber</Label>
              <Select value={absorbMinorId} onValueChange={setAbsorbMinorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto…" />
                </SelectTrigger>
                <SelectContent>
                  {absorbCandidates.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-slate-400 ml-1">({p.code}) — S/ {p.price_sale?.toFixed(2)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {absorbCandidates.length === 0 && (
                <p className="text-xs text-slate-400">No hay productos no verificados disponibles para absorber.</p>
              )}
            </div>
            <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-purple-500" />
              <span>
                El historial de ventas, compras y stock del menor se unificará con el master.
                El menor seguirá visible y vendible — esta acción <strong>no lo desactiva</strong>.
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setAbsorbMaster(null); setAbsorbMinorId(''); }}>
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-purple-600 hover:bg-purple-700"
                disabled={!absorbMinorId}
                onClick={() => setAbsorbConfirm(true)}
              >
                <ArrowDownToLine className="h-4 w-4 mr-2" />
                Continuar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación de absorción */}
      <AlertDialog open={absorbConfirm} onOpenChange={setAbsorbConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-purple-500" />
              Confirmar Absorción
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>Master:</strong> {absorbMaster?.name}
                </p>
                <p>
                  <strong>Menor:</strong> {allProducts.find(p => p.id === absorbMinorId)?.name}
                </p>
                <p className="text-slate-500 mt-2">
                  Se redirigirá todo el historial del menor al master.
                  Ambos productos seguirán activos en el sistema.
                  Esta acción no se puede deshacer fácilmente.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAbsorbConfirm(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-purple-600 hover:bg-purple-700"
              onClick={handleAbsorb}
              disabled={absorbing}
            >
              {absorbing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowDownToLine className="h-4 w-4 mr-2" />}
              Confirmar Absorción
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
