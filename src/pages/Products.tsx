import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Package, Tag, Percent, UtensilsCrossed, Plus, Pencil, Trash2, ArrowLeft, Camera, BarChart3, Download, TrendingUp, AlertTriangle, DollarSign, ShoppingCart, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { MenusTab } from '@/components/products/MenusTab';

interface Product {
  id: string;
  name: string;
  code: string;
  price_cost: number;
  price_sale: number;
  category: string;
  has_stock: boolean;
  stock_initial?: number;
  stock_min?: number;
  has_expiry?: boolean;
  expiry_days?: number;
  has_igv: boolean;
  has_wholesale: boolean;
  wholesale_qty?: number;
  wholesale_price?: number;
  active: boolean;
  school_ids: string[];
}

interface School {
  id: string;
  name: string;
}

interface DashboardStats {
  totalProducts: number;
  activeProducts: number;
  totalValue: number;
  lowStock: number;
  topSelling: Array<{name: string; sales: number}>;
  byCategory: Array<{category: string; count: number}>;
}

const Products = () => {
  const { user, signOut } = useAuth();
  const { role } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [categories, setCategories] = useState<string[]>(['bebidas', 'snacks', 'menu', 'otros']);
  const [showProductModal, setShowProductModal] = useState(false);
  const [formMode, setFormMode] = useState<'wizard' | 'form'>('wizard');
  const [wizardStep, setWizardStep] = useState(1);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dashStats, setDashStats] = useState<DashboardStats>({
    totalProducts: 0,
    activeProducts: 0,
    totalValue: 0,
    lowStock: 0,
    topSelling: [],
    byCategory: [],
  });
  
  // Form state con useRef para evitar re-renders
  const formRef = useRef({
    name: '',
    code: '',
    hasCode: true,
    price_cost: '',
    price_sale: '',
    category: 'bebidas',
    newCategory: '',
    has_stock: false,
    stock_initial: '',
    stock_min: '',
    has_expiry: false,
    expiry_days: '',
    has_igv: true,
    has_wholesale: false,
    wholesale_qty: '',
    wholesale_price: '',
    school_ids: [] as string[],
    applyToAllSchools: true,
  });

  const [, forceUpdate] = useState({});

  useEffect(() => {
    fetchProducts();
    fetchSchools();
  }, []);

  useEffect(() => {
    calculateDashStats();
  }, [products]);

  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').order('name');
    setProducts(data || []);
    setLoading(false);
  };

  const fetchSchools = async () => {
    const { data } = await supabase.from('schools').select('id, name').order('name');
    setSchools(data || []);
  };

  const calculateDashStats = () => {
    const active = products.filter(p => p.active).length;
    const totalVal = products.reduce((sum, p) => sum + (p.price_sale || 0) * (p.stock_initial || 0), 0);
    const lowStockCount = products.filter(p => p.has_stock && (p.stock_initial || 0) <= (p.stock_min || 0)).length;
    
    const categoryCounts = products.reduce((acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byCategory = Object.entries(categoryCounts).map(([category, count]) => ({ category, count }));

    setDashStats({
      totalProducts: products.length,
      activeProducts: active,
      totalValue: totalVal,
      lowStock: lowStockCount,
      topSelling: [], // Placeholder
      byCategory,
    });
  };

  const generateAutoCode = () => `PRD${Date.now().toString().slice(-8)}`;

  const resetForm = () => {
    formRef.current = {
      name: '',
      code: '',
      hasCode: true,
      price_cost: '',
      price_sale: '',
      category: 'bebidas',
      newCategory: '',
      has_stock: false,
      stock_initial: '',
      stock_min: '',
      has_expiry: false,
      expiry_days: '',
      has_igv: true,
      has_wholesale: false,
      wholesale_qty: '',
      wholesale_price: '',
      school_ids: [],
      applyToAllSchools: true,
    };
    setWizardStep(1);
    forceUpdate({});
  };

  const canAdvance = (step: number): boolean => {
    const f = formRef.current;
    switch (step) {
      case 1:
        return !!(f.name.trim());
      case 2:
        return !!(f.price_cost && f.price_sale);
      case 3:
        if (f.hasCode && !f.code.trim()) return false;
        if (f.has_stock && !f.stock_initial) return false;
        if (f.has_stock && !f.stock_min) return false;
        if (f.has_expiry && !f.expiry_days) return false;
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleSaveProduct = async () => {
    const f = formRef.current;
    if (!f.name || !f.price_cost || !f.price_sale) {
      toast({ variant: 'destructive', title: 'Error', description: 'Nombre, precio costo y precio venta son obligatorios' });
      return;
    }

    try {
      const finalCode = f.hasCode ? f.code : generateAutoCode();
      const finalCategory = f.newCategory || f.category;
      
      if (f.newCategory && !categories.includes(f.newCategory)) {
        setCategories([...categories, f.newCategory]);
      }

      const selectedSchools = f.applyToAllSchools ? schools.map(s => s.id) : f.school_ids;

      const newProduct = {
        name: f.name,
        code: finalCode,
        price: parseFloat(f.price_sale),
        category: finalCategory,
        active: true,
        price_cost: parseFloat(f.price_cost),
        price_sale: parseFloat(f.price_sale),
        has_stock: f.has_stock,
        stock_initial: f.has_stock ? parseInt(f.stock_initial) : null,
        stock_min: f.has_stock ? parseInt(f.stock_min) : null,
        has_expiry: f.has_expiry,
        expiry_days: f.has_expiry ? parseInt(f.expiry_days) : null,
        has_igv: f.has_igv,
        has_wholesale: f.has_wholesale,
        wholesale_qty: f.has_wholesale ? parseInt(f.wholesale_qty) : null,
        wholesale_price: f.has_wholesale ? parseFloat(f.wholesale_price) : null,
        school_ids: selectedSchools,
      };

      const { error } = await supabase.from('products').insert(newProduct);
      if (error) throw error;

      toast({ title: '✅ Producto creado', description: 'El producto se ha guardado correctamente' });
      setShowProductModal(false);
      resetForm();
      fetchProducts();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const WizardContent = () => {
    const f = formRef.current;
    
    switch (wizardStep) {
      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold">📦 Información Básica</h3>
            <div>
              <Label>Nombre del Producto *</Label>
              <Input 
                defaultValue={f.name}
                onChange={e => { f.name = e.target.value; }}
                placeholder="Ej: Coca Cola 500ml" 
                autoFocus
              />
            </div>
            <div>
              <Label>Categoría</Label>
              <Select 
                value={f.category} 
                onValueChange={v => { f.category = v; forceUpdate({}); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input 
                className="mt-2" 
                placeholder="O crea una nueva categoría" 
                defaultValue={f.newCategory}
                onChange={e => { f.newCategory = e.target.value; }}
              />
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold">💰 Precios</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Precio Costo *</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  defaultValue={f.price_cost}
                  onChange={e => { f.price_cost = e.target.value; }}
                  placeholder="0.00" 
                  autoFocus
                />
              </div>
              <div>
                <Label>Precio Venta *</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  defaultValue={f.price_sale}
                  onChange={e => { f.price_sale = e.target.value; }}
                  placeholder="0.00" 
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.has_igv} onCheckedChange={v => { f.has_igv = v; forceUpdate({}); }} />
              <Label>Incluye IGV (18%)</Label>
            </div>
            <div className="border rounded p-3">
              <div className="flex items-center gap-2 mb-3">
                <Switch checked={f.has_wholesale} onCheckedChange={v => { f.has_wholesale = v; forceUpdate({}); }} />
                <Label className="font-semibold">Activar Precio Mayorista</Label>
              </div>
              {f.has_wholesale && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">A partir de (unidades)</Label>
                    <Input 
                      type="number" 
                      defaultValue={f.wholesale_qty}
                      onChange={e => { f.wholesale_qty = e.target.value; }}
                      placeholder="10" 
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Precio Mayorista</Label>
                    <Input 
                      type="number" 
                      step="0.01" 
                      defaultValue={f.wholesale_price}
                      onChange={e => { f.wholesale_price = e.target.value; }}
                      placeholder="0.00" 
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold">🏷️ Código y Stock</h3>
            <div>
              <Label>¿Tiene Código de Barras?</Label>
              <Select 
                value={f.hasCode ? 'yes' : 'no'} 
                onValueChange={v => { f.hasCode = v === 'yes'; forceUpdate({}); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Con Código de Barras</SelectItem>
                  <SelectItem value="no">Sin Código (Sistema lo asigna)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {f.hasCode && (
              <div>
                <Label>Código de Barras *</Label>
                <div className="flex gap-2">
                  <Input 
                    defaultValue={f.code}
                    onChange={e => { f.code = e.target.value; }}
                    placeholder="Escanea o escribe el código"
                    autoFocus
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowCamera(true)}>
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            <div className="border rounded p-3">
              <div className="flex items-center gap-2 mb-3">
                <Switch checked={f.has_stock} onCheckedChange={v => { f.has_stock = v; forceUpdate({}); }} />
                <Label className="font-semibold">Controlar Stock</Label>
              </div>
              {f.has_stock && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Stock Inicial *</Label>
                      <Input 
                        type="number" 
                        defaultValue={f.stock_initial}
                        onChange={e => { f.stock_initial = e.target.value; }}
                        placeholder="100" 
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Stock Mínimo (Alerta) *</Label>
                      <Input 
                        type="number" 
                        defaultValue={f.stock_min}
                        onChange={e => { f.stock_min = e.target.value; }}
                        placeholder="10" 
                      />
                    </div>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Switch checked={f.has_expiry} onCheckedChange={v => { f.has_expiry = v; forceUpdate({}); }} />
                      <Label className="text-sm">Controlar Tiempo de Vida</Label>
                    </div>
                    {f.has_expiry && (
                      <div>
                        <Label className="text-xs">Días de Vida Útil *</Label>
                        <Input 
                          type="number" 
                          defaultValue={f.expiry_days}
                          onChange={e => { f.expiry_days = e.target.value; }}
                          placeholder="30" 
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold">🏫 Sedes</h3>
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded">
              <Checkbox 
                checked={f.applyToAllSchools} 
                onCheckedChange={v => { f.applyToAllSchools = !!v; forceUpdate({}); }} 
              />
              <Label>Aplicar a todas las sedes</Label>
            </div>
            {!f.applyToAllSchools && (
              <div className="space-y-2 border rounded p-3 max-h-48 overflow-y-auto">
                {schools.map(school => (
                  <div key={school.id} className="flex items-center gap-2">
                    <Checkbox 
                      checked={f.school_ids.includes(school.id)} 
                      onCheckedChange={() => {
                        if (f.school_ids.includes(school.id)) {
                          f.school_ids = f.school_ids.filter(id => id !== school.id);
                        } else {
                          f.school_ids = [...f.school_ids, school.id];
                        }
                        forceUpdate({});
                      }} 
                    />
                    <Label>{school.name}</Label>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const canViewAllSchools = role === 'admin_general';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Gestión de Productos</h1>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => signOut()}>Salir</Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard"><BarChart3 className="h-4 w-4 mr-2" />Dashboard</TabsTrigger>
            <TabsTrigger value="productos"><Package className="h-4 w-4 mr-2" />Productos</TabsTrigger>
            <TabsTrigger value="promociones"><Percent className="h-4 w-4 mr-2" />Promociones</TabsTrigger>
            <TabsTrigger value="menus"><UtensilsCrossed className="h-4 w-4 mr-2" />Menús</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            {loading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <CardDescription>Total Productos</CardDescription>
                        <Package className="h-5 w-5 text-blue-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{dashStats.totalProducts}</div>
                      <p className="text-xs text-green-600 mt-1">
                        {dashStats.activeProducts} activos
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <CardDescription>Valor Inventario</CardDescription>
                        <DollarSign className="h-5 w-5 text-green-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">S/ {dashStats.totalValue.toFixed(2)}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        Valor total estimado
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <CardDescription>Stock Bajo</CardDescription>
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-red-600">{dashStats.lowStock}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        Productos por reabastecer
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <CardDescription>Categorías</CardDescription>
                        <Tag className="h-5 w-5 text-purple-600" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">{dashStats.byCategory.length}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        Tipos de productos
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Productos por Categoría</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dashStats.byCategory.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${
                                idx === 0 ? 'bg-blue-500' : 
                                idx === 1 ? 'bg-green-500' : 
                                idx === 2 ? 'bg-yellow-500' : 'bg-purple-500'
                              }`} />
                              <span className="font-medium capitalize">{item.category}</span>
                            </div>
                            <Badge variant="secondary">{item.count}</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Productos Más Vendidos</CardTitle>
                      <CardDescription>Top 5 del mes</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {[1,2,3,4,5].map((item) => (
                          <div key={item} className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm">
                                {item}
                              </div>
                              <span className="text-gray-500">🚧 Próximamente</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Exportar */}
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle>Reportes y Exportación</CardTitle>
                        <CardDescription>Descarga reportes de inventario</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline">
                          <Download className="h-4 w-4 mr-2" />Excel
                        </Button>
                        <Button variant="outline">
                          <Download className="h-4 w-4 mr-2" />PDF
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <h4 className="font-semibold mb-1">Inventario Completo</h4>
                        <p className="text-xs text-gray-500">Todos los productos y stocks</p>
                      </div>
                      <div className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <h4 className="font-semibold mb-1">Productos por Vencer</h4>
                        <p className="text-xs text-gray-500">Control de fechas de vida</p>
                      </div>
                      <div className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                        <h4 className="font-semibold mb-1">Análisis de Ventas</h4>
                        <p className="text-xs text-gray-500">Productos más/menos vendidos</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="productos">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Lista de Productos</CardTitle>
                    <CardDescription>{products.length} productos registrados</CardDescription>
                  </div>
                  <Button onClick={() => { setShowProductModal(true); resetForm(); }}>
                    <Plus className="h-4 w-4 mr-2" />Crear Producto
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {products.map(product => (
                    <Card key={product.id} className="hover:shadow-lg transition">
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <CardTitle className="text-lg">{product.name}</CardTitle>
                          <Badge>{product.category}</Badge>
                        </div>
                        <CardDescription>Código: {product.code}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-green-600 mb-2">
                          S/ {product.price_sale?.toFixed(2) || product.price?.toFixed(2)}
                        </div>
                        {product.has_stock && (
                          <div className="text-sm text-gray-500 mb-2">
                            Stock: {product.stock_initial || 0} | Mín: {product.stock_min || 0}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline"><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="destructive"><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="promociones">
            <Card>
              <CardHeader>
                <CardTitle>Promociones</CardTitle>
                <CardDescription>🚧 Próximamente - Crear combos y ofertas</CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>

          <TabsContent value="menus">
            <MenusTab schools={schools} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Modal */}
      <Dialog open={showProductModal} onOpenChange={setShowProductModal}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Producto</DialogTitle>
          </DialogHeader>
          
          <div className="mb-4 flex gap-2">
            <Button variant={formMode === 'wizard' ? 'default' : 'outline'} onClick={() => setFormMode('wizard')}>🧙 Pasarela</Button>
            <Button variant={formMode === 'form' ? 'default' : 'outline'} onClick={() => setFormMode('form')}>📋 Formulario Completo</Button>
          </div>

          {formMode === 'wizard' ? (
            <>
              <div className="mb-4 flex gap-2">
                {[1,2,3,4].map(step => (
                  <div key={step} className={`flex-1 h-2 rounded ${wizardStep >= step ? 'bg-blue-500' : 'bg-gray-200'}`} />
                ))}
              </div>
              <WizardContent />
              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setWizardStep(Math.max(1, wizardStep - 1))} disabled={wizardStep === 1}>
                  Anterior
                </Button>
                {wizardStep < 4 ? (
                  <Button 
                    onClick={() => setWizardStep(wizardStep + 1)}
                    disabled={!canAdvance(wizardStep)}
                  >
                    Siguiente
                  </Button>
                ) : (
                  <Button onClick={handleSaveProduct}>Guardar Producto</Button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              🚧 Vista de formulario completo próximamente
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Cámara */}
      <Dialog open={showCamera} onOpenChange={setShowCamera}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escanear Código de Barras</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center h-64 bg-gray-100 rounded">
            <Camera className="h-24 w-24 text-gray-400" />
          </div>
          <p className="text-center text-sm text-gray-500">🚧 Función de escaneo próximamente</p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Products;
