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
import { Package, Tag, Percent, Plus, Pencil, Trash2, ArrowLeft, Camera, BarChart3, Download, TrendingUp, AlertTriangle, DollarSign, ShoppingCart, Loader2, Building2, FileSpreadsheet, BadgeCheck, ClipboardList, FolderOpen, MoveRight, X, Check, Power, PowerOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import { PriceMatrix } from '@/components/products/PriceMatrix';
import { BulkProductUpload } from '@/components/products/BulkProductUpload';
import { CombosPromotionsManager } from '@/components/products/CombosPromotionsManager';
import { ProductRequestModal } from '@/components/products/ProductRequestModal';
import {
  saveProductScopeAndPrices,
  isPriceScopeRelatedError,
  getPriceScopeFriendlyToast,
  getSupabaseErrorBlob,
  type ProductSchoolPricePayload,
} from '@/services/productScopePricingService';

interface Product {
  id: string;
  name: string;
  description?: string;
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
  school_ids: string[] | null;
  stock_control_enabled: boolean;
  is_verified?: boolean;
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
  expiringProducts: Array<{name: string; days_left: number; expiry_date: string}>;
  topSelling: Array<{name: string; sales: number}>;
  byCategory: Array<{category: string; count: number}>;
}

const Products = () => {
  const { user, signOut } = useAuth();
  const { role, canViewAllSchools } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const maintenance = useMaintenanceGuard('productos_admin');
  
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [schools, setSchools] = useState<School[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [productSchoolPrices, setProductSchoolPrices] = useState<Record<string, { price_sale: number }>>({});
  const [showProductModal, setShowProductModal] = useState(false);
  const [formMode, setFormMode] = useState<'wizard' | 'form'>('wizard');
  const [wizardStep, setWizardStep] = useState(1);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isCheckingCode, setIsCheckingCode] = useState(false);
  const [codeStatus, setCodeStatus] = useState<'none' | 'available' | 'exists'>('none');
  const [currentCode, setCurrentCode] = useState('');
  const [showPriceMatrix, setShowPriceMatrix] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Modal de solicitudes para gestor_unidad
  const [showProductRequestModal, setShowProductRequestModal] = useState(false);

  // ─── Gestor de Categorías ────────────────────────────────────────────────────
  const [showCatManager, setShowCatManager] = useState(false);
  // Renombrar
  const [catEditTarget, setCatEditTarget] = useState<string | null>(null);
  const [catEditName, setCatEditName] = useState('');
  // Eliminar (con o sin migración)
  const [catDeleteTarget, setCatDeleteTarget] = useState<string | null>(null);
  const [catMoveTarget, setCatMoveTarget] = useState('');
  const [catSaving, setCatSaving] = useState(false);

  // Stock control per school
  const [productStockLevels, setProductStockLevels] = useState<Record<string, number>>({});
  const [showStockControlModal, setShowStockControlModal] = useState(false);
  const [stockControlTarget, setStockControlTarget] = useState<Product | null>(null);
  const [stockControlInitial, setStockControlInitial] = useState('0');
  const [stockControlLoading, setStockControlLoading] = useState(false);

  const [dashStats, setDashStats] = useState<DashboardStats>({
    totalProducts: 0,
    activeProducts: 0,
    totalValue: 0,
    lowStock: 0,
    expiringProducts: [],
    topSelling: [],
    byCategory: [],
  });
  
  // Form state con useRef para evitar re-renders
  const formRef = useRef({
    name: '',
    description: '',
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
    // 'global' = disponible para todas las sedes (school_ids = null en BD)
    // 'specific' = solo para sedes seleccionadas
    productScope: 'global' as 'global' | 'specific',
  });

  const [, forceUpdate] = useState({});

  useEffect(() => {
    fetchSchools();
    fetchUserSchool();
    fetchCategories();
  }, []);

  // Cargar productos una vez que sepamos la sede del usuario
  // canViewAllSchools cubre: admin_general, supervisor_red, superadmin
  useEffect(() => {
    if (userSchoolId !== null || canViewAllSchools) {
      fetchProducts();
    }
  }, [userSchoolId, role, canViewAllSchools]);

  // Normaliza texto para búsqueda tolerante a tildes y mayúsculas
  const normalizeSearch = (str: string) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Filtrar productos cuando cambia la búsqueda
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProducts(products);
    } else {
      const query = normalizeSearch(searchQuery);
      const filtered = products.filter(p =>
        normalizeSearch(p.name).includes(query) ||
        normalizeSearch(p.code).includes(query) ||
        normalizeSearch(p.category).includes(query) ||
        normalizeSearch(p.description || '').includes(query)
      );
      setFilteredProducts(filtered);
    }
  }, [searchQuery, products]);

  // Cargar precios personalizados cuando el userSchoolId esté disponible
  useEffect(() => {
    if (userSchoolId) {
      fetchProductSchoolPrices();
    }
  }, [userSchoolId]);

  useEffect(() => {
    calculateDashStats();
  }, [products]);

  // Validar código de barras
  useEffect(() => {
    const f = formRef.current;
    if (!f.hasCode || !currentCode.trim()) {
      setCodeStatus('none');
      return;
    }

      const checkCode = async () => {
      setIsCheckingCode(true);
      try {
        // Normalizar: trim + uppercase para evitar duplicados invisibles por espacios o casing
        const normalizedCode = currentCode.trim().toUpperCase();

        // Solo verificar contra productos ACTIVOS — los inactivos (fusionados) no deben bloquear
        let query = supabase
          .from('products')
          .select('id')
          .ilike('code', normalizedCode)   // case-insensitive: abc-1 == ABC-1
          .eq('active', true);

        // Si estamos editando, excluir el producto actual (su propio código no es "duplicado")
        if (editingProductId) {
          query = query.neq('id', editingProductId);
        }

        const { data, error } = await query.maybeSingle();
        
        if (error) throw error;
        setCodeStatus(data ? 'exists' : 'available');
      } catch (err) {
        console.error('Error validando código:', err);
        setCodeStatus('none');
      } finally {
        setIsCheckingCode(false);
      }
    };

    const timer = setTimeout(checkCode, 500);
    return () => clearTimeout(timer);
  }, [currentCode, editingProductId]);

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('product_categories')
      .select('name')
      .order('name');
    if (!error && data && data.length > 0) {
      setCategories(data.map(c => c.name));
    } else {
      // Fallback: tabla aún no existe en BD o está vacía
      setCategories([
        'bebidas','chocolates','dulces','frutas','galletas',
        'golosinas','jugos','menu','otros','postres',
        'refrescos','sandwiches','snack','snacks',
      ]);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);

    let productsData: Product[] = [];

    if (canViewAllSchools) {
      // Admin general / supervisor ven TODOS (activos e inactivos) para poder reactivar
      const { data } = await supabase.from('products').select('*').order('name');
      productsData = (data || []) as Product[];
    } else if (userSchoolId) {
      // Incluir productos globales (school_ids IS NULL) + los específicos de esta sede
      // Logística ve todos (activos e inactivos) para poder reactivar
      const { data } = await supabase
        .from('products')
        .select('*')
        .or(`school_ids.is.null,school_ids.cs.{${userSchoolId}}`)
        .order('name');
      productsData = (data || []) as Product[];
    } else {
      productsData = [];
    }

    setProducts(productsData);
    setFilteredProducts(productsData);
    
    // Cargar niveles de stock si hay una sede
    if (userSchoolId) {
      const productIds = productsData.map(p => p.id);
      if (productIds.length > 0) {
        const { data: stockData } = await supabase
          .from('product_stock')
          .select('product_id, current_stock')
          .eq('school_id', userSchoolId)
          .in('product_id', productIds);
        const levels: Record<string, number> = {};
        (stockData || []).forEach(s => { levels[s.product_id] = s.current_stock; });
        setProductStockLevels(levels);
      }
    }

    setLoading(false);
  };

  const fetchSchools = async () => {
    const { data } = await supabase.from('schools').select('id, name').order('name');
    setSchools(data || []);
  };

  const fetchUserSchool = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      
      if (error) {
        console.error('❌ Error al obtener school_id del usuario:', error);
        return;
      }
      
      console.log('✅ School ID del usuario:', data?.school_id);
      setUserSchoolId(data?.school_id || null);
    } catch (err) {
      console.error('❌ Error en fetchUserSchool:', err);
    }
  };

  const fetchProductSchoolPrices = async () => {
    if (!userSchoolId) return;
    // Lectura de solo lectura: puebla el mapa visual de precios en el listado de productos.
    // No es una escritura; el canal de escritura único es el RPC save_product_scope_and_prices.
    try {
      const { data, error } = await supabase
        .from('product_school_prices')
        .select('product_id, price_sale')
        .eq('school_id', userSchoolId);
      
      if (error) {
        console.error('❌ Error al obtener precios por sede:', error);
        return;
      }
      
      // Crear un mapa: product_id -> { price_sale }
      const pricesMap: Record<string, { price_sale: number }> = {};
      data?.forEach(item => {
        pricesMap[item.product_id] = { price_sale: item.price_sale };
      });
      
      console.log('✅ Precios personalizados por sede:', pricesMap);
      setProductSchoolPrices(pricesMap);
    } catch (err) {
      console.error('❌ Error en fetchProductSchoolPrices:', err);
    }
  };

  const calculateDashStats = async () => {
    const active = products.filter(p => p.active).length;
    const totalVal = products.reduce((sum, p) => sum + (p.price_sale || 0) * (p.stock_initial || 0), 0);
    const lowStockCount = products.filter(p => p.has_stock && (p.stock_initial || 0) <= (p.stock_min || 0)).length;
    
    const categoryCounts = products.reduce((acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byCategory = Object.entries(categoryCounts).map(([category, count]) => ({ category, count }));

    // 🆕 Calcular productos próximos a vencer
    const expiringProducts: Array<{name: string; days_left: number; expiry_date: string}> = [];
    const today = new Date();
    
    products.forEach(product => {
      if (product.has_expiry && product.expiry_days) {
        // Calcular fecha de vencimiento (asumiendo que se ingresó hoy)
        // En producción, esto debería venir de un campo created_at o purchase_date
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + product.expiry_days);
        
        const daysLeft = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        // Solo mostrar productos que vencen en 7 días o menos
        if (daysLeft <= 7 && daysLeft >= 0) {
          expiringProducts.push({
            name: product.name,
            days_left: daysLeft,
            expiry_date: expiryDate.toLocaleDateString('es-PE'),
          });
        }
      }
    });

    // Ordenar por días restantes (más urgente primero)
    expiringProducts.sort((a, b) => a.days_left - b.days_left);

    // Obtener los más vendidos reales desde la BD
    const { data: topData } = await supabase
      .from('products')
      .select('name, total_sales')
      .order('total_sales', { ascending: false })
      .limit(5);

    setDashStats({
      totalProducts: products.length,
      activeProducts: active,
      totalValue: totalVal,
      lowStock: lowStockCount,
      expiringProducts: expiringProducts.slice(0, 5),
      topSelling: topData?.map(p => ({ name: p.name, sales: p.total_sales || 0 })) || [],
      byCategory,
    });
  };

  const generateAutoCode = () => `PRD${Date.now().toString().slice(-8)}`;

  const resetForm = () => {
    formRef.current = {
      name: '',
      description: '',
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
      productScope: 'global' as 'global' | 'specific',
    };
    setCurrentCode('');
    setCodeStatus('none');
    setWizardStep(1);
    setEditingProductId(null);
    forceUpdate({});
  };

  const handleEditProduct = (product: Product) => {
    formRef.current = {
      name: product.name,
      description: product.description || '',
      code: product.code,
      hasCode: !!product.code,
      price_cost: String(product.price_cost || ''),
      price_sale: String(product.price_sale || ''),
      category: product.category,
      newCategory: '',
      has_stock: product.has_stock,
      stock_initial: String(product.stock_initial || ''),
      stock_min: String(product.stock_min || ''),
      has_expiry: product.has_expiry || false,
      expiry_days: String(product.expiry_days || ''),
      has_igv: product.has_igv,
      has_wholesale: product.has_wholesale || false,
      wholesale_qty: String(product.wholesale_qty || ''),
      wholesale_price: String(product.wholesale_price || ''),
      school_ids: product.school_ids || [],
      applyToAllSchools: (product.school_ids || []).length === schools.length,
      // Si school_ids es null o vacío → era global
      productScope: (!product.school_ids || product.school_ids.length === 0) ? 'global' : 'specific',
    };
    setCurrentCode(product.code || '');
    setEditingProductId(product.id);
    setWizardStep(1);
    setShowProductModal(true);
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
        if (f.hasCode) {
          if (!f.code.trim()) return false;
          if (codeStatus === 'exists') return false;
          if (isCheckingCode) return false;
        }
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

    // Advertencia si el precio de venta es 0 (producto activo con precio cero es un error humano)
    const parsedSale = parseFloat(f.price_sale);
    if (parsedSale === 0) {
      toast({ variant: 'destructive', title: '⚠️ Precio de venta es 0', description: 'El producto quedará activo con precio S/ 0.00. Verifica que sea intencional.' });
      // No bloqueamos — solo advertimos. El usuario puede guardar igual.
    }

    try {
      // Trim + uppercase del código para evitar duplicados invisibles por espacios o casing
      const finalCode = f.hasCode ? f.code.trim().toUpperCase() : generateAutoCode();
      const finalCategory = f.newCategory || f.category;
      
      if (f.newCategory && !categories.includes(f.newCategory)) {
        setCategories([...categories, f.newCategory]);
      }

      // Determinar school_ids según el alcance elegido:
      // - Global (logistica o admin_general con scope='global'): school_ids = null → aparece en TODAS las sedes
      // - Todas las sedes (admin_general con applyToAllSchools): school_ids = null
      // - Sedes específicas: array de IDs
      // - Otros roles: solo su propia sede
      let selectedSchools: string[] | null;
      if (canCreateGlobal && f.productScope === 'global') {
        selectedSchools = null;
      } else if (isAdminGeneral) {
        selectedSchools = f.applyToAllSchools ? null : f.school_ids;
      } else {
        selectedSchools = userSchoolId ? [userSchoolId] : [];
      }

      const productData = {
        name: f.name,
        description: f.description || null,
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

      /** Admin / supervisor al editar: alcance + precios por sede en un solo RPC tras guardar el resto (sin school_ids duplicado). */
      const canAtomicScopePrices =
        !!editingProductId && (role === 'admin_general' || role === 'supervisor_red');

      if (editingProductId && canAtomicScopePrices) {
        const { school_ids: _scopeFromForm, ...restProductFields } = productData;

        // Lectura de solo lectura: recupera los precios vigentes para re-enviarlos al RPC
        // filtrando solo los que siguen dentro del nuevo alcance.
        // El canal de escritura único sigue siendo el RPC; esta query no modifica nada.
        const { data: existingPsp, error: pspFetchErr } = await supabase
          .from('product_school_prices')
          .select('school_id, price_sale, price_cost, is_available')
          .eq('product_id', editingProductId);

        if (pspFetchErr) throw pspFetchErr;

        const inScope = (schoolId: string) => {
          if (selectedSchools === null) return true;
          if (selectedSchools.length === 0) return false;
          return selectedSchools.includes(schoolId);
        };

        const pricesPayload: ProductSchoolPricePayload[] = (existingPsp || [])
          .filter(row => inScope(row.school_id))
          .map(row => ({
            school_id: row.school_id,
            price_sale: Number(row.price_sale),
            price_cost: row.price_cost != null ? Number(row.price_cost) : null,
            is_available: row.is_available ?? true,
          }));

        const { error: updateErr } = await supabase
          .from('products')
          .update(restProductFields)
          .eq('id', editingProductId);
        if (updateErr) throw updateErr;

        await saveProductScopeAndPrices({
          productId: editingProductId,
          schoolIds: selectedSchools,
          prices: pricesPayload,
        });

        toast({
          title: '✅ Producto actualizado',
          description: 'Datos y disponibilidad/precios por sede guardados en una sola operación.',
        });
      } else if (editingProductId) {
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProductId);
        if (error) throw error;
        toast({ title: '✅ Producto actualizado', description: 'Los cambios se han guardado correctamente' });
      } else {
        const { error } = await supabase.from('products').insert(productData);
        if (error) throw error;
        toast({ title: '✅ Producto creado', description: 'El producto se ha guardado correctamente' });
      }

      setShowProductModal(false);
      resetForm();
      fetchProducts();
    } catch (error: unknown) {
      if (isPriceScopeRelatedError(error)) {
        const fb = getPriceScopeFriendlyToast();
        toast({ variant: 'destructive', title: fb.title, description: fb.description });
      } else {
        const blob = getSupabaseErrorBlob(error);
        toast({ variant: 'destructive', title: 'Error', description: blob || 'Error al guardar' });
      }
    }
  };

  const WizardContent = () => {
    const f = formRef.current;
    
    switch (wizardStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2 pb-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-2">
                <Package className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold">Información Básica</h3>
              <p className="text-sm text-muted-foreground">Comienza con el nombre y categoría del producto</p>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-base font-semibold">Nombre del Producto *</Label>
                <Input 
                  defaultValue={f.name}
                  onChange={e => { f.name = e.target.value; forceUpdate({}); }}
                  placeholder="Ej: Coca Cola 500ml" 
                  autoFocus
                  className="h-14 text-lg mt-2"
                />
              </div>
              <div>
                <Label className="text-base font-semibold">Descripción</Label>
                <textarea 
                  defaultValue={f.description}
                  onChange={e => { f.description = e.target.value; forceUpdate({}); }}
                  placeholder="Ej: Gaseosa refrescante de 500ml, ideal para el refrigerio" 
                  className="w-full h-20 px-3 py-2 text-base border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 mt-2"
                />
              </div>
              <div>
                <Label className="text-base font-semibold">Categoría</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                  {['bebidas', 'dulces', 'frutas', 'menu'].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => { f.category = cat; forceUpdate({}); }}
                      className={`p-4 border-2 rounded-lg transition-all ${
                        f.category === cat 
                          ? 'border-primary bg-primary/10 font-semibold' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-2xl mb-1">
                        {cat === 'bebidas' ? '🥤' : cat === 'dulces' ? '🍬' : cat === 'frutas' ? '🍎' : '🍽️'}
                      </div>
                      <div className="text-sm capitalize">{cat}</div>
                    </button>
                  ))}
                </div>
                <Select 
                  value={f.category} 
                  onValueChange={v => { f.category = v; forceUpdate({}); }}
                >
                  <SelectTrigger className="h-12 mt-3"><SelectValue placeholder="Más categorías..." /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat} className="capitalize">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input 
                  placeholder="O escribe una nueva categoría" 
                  defaultValue={f.newCategory}
                  onChange={e => { f.newCategory = e.target.value; forceUpdate({}); }}
                  className="h-12 mt-3"
                />
                {f.newCategory.trim() !== '' && (
                  <Button 
                    type="button"
                    size="lg"
                    className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700"
                    onClick={async () => {
                      const newCat = f.newCategory.trim().toLowerCase();
                      if (!newCat) return;
                      if (categories.includes(newCat)) {
                        f.category = newCat;
                        f.newCategory = '';
                        forceUpdate({});
                        return;
                      }
                      // Guardar en BD para que persista
                      const { error } = await supabase
                        .from('product_categories')
                        .insert({ name: newCat });
                      if (error && !error.message.includes('duplicate')) {
                        toast({ variant: 'destructive', title: 'Error', description: error.message });
                        return;
                      }
                      setCategories(prev => [...prev, newCat].sort());
                      f.category = newCat;
                      f.newCategory = '';
                      forceUpdate({});
                      toast({ title: "✅ Categoría creada", description: `"${newCat}" guardada y seleccionada` });
                    }}
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Agregar "{f.newCategory}"
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2 pb-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-2">
                <DollarSign className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold">Configuración de Precios</h3>
              <p className="text-sm text-muted-foreground">Define el costo y precio de venta</p>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-base font-semibold">Precio Costo *</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-muted-foreground">S/</span>
                  <Input 
                    type="number" 
                    step="0.01" 
                    defaultValue={f.price_cost}
                    onChange={e => { f.price_cost = e.target.value; forceUpdate({}); }}
                    placeholder="0.00" 
                    autoFocus
                    className="h-16 text-2xl pl-14"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">Precio Venta *</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-muted-foreground">S/</span>
                  <Input 
                    type="number" 
                    step="0.01" 
                    defaultValue={f.price_sale}
                    onChange={e => { f.price_sale = e.target.value; forceUpdate({}); }}
                    placeholder="0.00" 
                    className="h-16 text-2xl pl-14 border-primary"
                  />
                </div>
              </div>
            </div>
            {f.price_cost && f.price_sale && parseFloat(f.price_sale) > parseFloat(f.price_cost) && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-900">Margen de Ganancia</p>
                    <p className="text-2xl font-bold text-green-600">
                      {(((parseFloat(f.price_sale) - parseFloat(f.price_cost)) / parseFloat(f.price_cost)) * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-green-900">Ganancia por Unidad</p>
                    <p className="text-2xl font-bold text-green-600">
                      S/ {(parseFloat(f.price_sale) - parseFloat(f.price_cost)).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {f.price_cost && f.price_sale && parseFloat(f.price_sale) <= parseFloat(f.price_cost) && (
              <div className="bg-red-50 border border-red-300 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                  <div>
                    <p className="text-base font-bold text-red-900">⚠️ Advertencia: Precio de Venta Menor al Costo</p>
                    <p className="text-sm text-red-700 mt-1">
                      El precio de venta debe ser mayor al costo para obtener ganancias.
                      {parseFloat(f.price_sale) < parseFloat(f.price_cost) && (
                        <span className="font-semibold"> Pérdida: S/ {(parseFloat(f.price_cost) - parseFloat(f.price_sale)).toFixed(2)} por unidad</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
              <Switch 
                checked={f.has_igv} 
                onCheckedChange={v => { f.has_igv = v; forceUpdate({}); }} 
                className="data-[state=checked]:bg-primary"
              />
              <div className="flex-1">
                <Label className="text-base font-semibold cursor-pointer">Incluye IGV (18%)</Label>
                <p className="text-xs text-muted-foreground">El precio ya incluye el impuesto</p>
              </div>
            </div>
            <div className="border-2 border-dashed rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <Switch 
                  checked={f.has_wholesale} 
                  onCheckedChange={v => { f.has_wholesale = v; forceUpdate({}); }}
                  className="data-[state=checked]:bg-purple-600"
                />
                <div className="flex-1">
                  <Label className="text-base font-semibold cursor-pointer">Precio Mayorista</Label>
                  <p className="text-xs text-muted-foreground">Precio especial por cantidad</p>
                </div>
              </div>
              {f.has_wholesale && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <Label>A partir de (unidades)</Label>
                    <Input 
                      type="number" 
                      defaultValue={f.wholesale_qty}
                      onChange={e => { f.wholesale_qty = e.target.value; forceUpdate({}); }}
                      placeholder="10" 
                      className="h-12 text-lg"
                    />
                  </div>
                  <div>
                    <Label>Precio Mayorista</Label>
                    <Input 
                      type="number" 
                      step="0.01" 
                      defaultValue={f.wholesale_price}
                      onChange={e => { f.wholesale_price = e.target.value; forceUpdate({}); }}
                      placeholder="0.00" 
                      className="h-12 text-lg"
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
              <div className="space-y-2">
                <Label>Código de Barras *</Label>
                <div className="flex gap-2">
                  <Input 
                    value={currentCode}
                    onChange={e => { 
                      const newCode = e.target.value;
                      setCurrentCode(newCode);
                      f.code = newCode;
                    }}
                    placeholder="Escanea o escribe el código"
                    autoFocus
                    className={
                      codeStatus === 'exists' ? 'border-red-500 focus-visible:ring-red-500' : 
                      codeStatus === 'available' ? 'border-green-500 focus-visible:ring-green-500' : ''
                    }
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowCamera(true)}>
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
                
                {isCheckingCode && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Verificando código...
                  </p>
                )}
                
                {!isCheckingCode && codeStatus === 'exists' && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Este código ya está registrado en otro producto.
                  </p>
                )}
                
                {!isCheckingCode && codeStatus === 'available' && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold border border-green-600 rounded-full">✓</span>
                    Código aceptado y disponible.
                  </p>
                )}
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
                        onChange={e => { f.stock_initial = e.target.value; forceUpdate({}); }}
                        placeholder="100" 
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Stock Mínimo (Alerta) *</Label>
                      <Input 
                        type="number" 
                        defaultValue={f.stock_min}
                        onChange={e => { f.stock_min = e.target.value; forceUpdate({}); }}
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
                          onChange={e => { f.expiry_days = e.target.value; forceUpdate({}); }}
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
        // Solo usuarios que pueden elegir alcance ven el paso 4
        if (!canCreateGlobal) return null;
        return (
          <div className="space-y-5">
            <div className="text-center space-y-1 pb-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-100 mb-1">
                <Building2 className="h-7 w-7 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold">Disponibilidad del Producto</h3>
              <p className="text-sm text-muted-foreground">¿En qué sedes estará disponible este producto?</p>
            </div>

            {/* Opción 1: Global */}
            <button
              type="button"
              onClick={() => { f.productScope = 'global'; forceUpdate({}); }}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                f.productScope === 'global'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  f.productScope === 'global' ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'
                }`}>
                  {f.productScope === 'global' && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">🌐 Global — Disponible para todas las sedes</p>
                  <p className="text-sm text-gray-500 mt-0.5">El producto aparecerá en el POS y lista de productos de todas las sedes automáticamente.</p>
                </div>
              </div>
            </button>

            {/* Opción 2: Sede específica */}
            <button
              type="button"
              onClick={() => { f.productScope = 'specific'; forceUpdate({}); }}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                f.productScope === 'specific'
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  f.productScope === 'specific' ? 'border-amber-500 bg-amber-500' : 'border-gray-300'
                }`}>
                  {f.productScope === 'specific' && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">🏫 Sede específica</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {isAdminGeneral
                      ? 'El producto solo aparecerá en las sedes que selecciones abajo.'
                      : 'El producto se asignará únicamente a tu sede.'}
                  </p>
                </div>
              </div>
            </button>

            {/* Selector de sedes (solo admin_general en modo specific) */}
            {f.productScope === 'specific' && isAdminGeneral && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <Checkbox
                    checked={f.applyToAllSchools}
                    onCheckedChange={v => { f.applyToAllSchools = !!v; forceUpdate({}); }}
                  />
                  <Label className="font-medium cursor-pointer">Seleccionar todas las sedes</Label>
                </div>
                {!f.applyToAllSchools && (
                  <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto bg-gray-50">
                    <p className="text-xs text-gray-500 mb-2">Elige las sedes donde aparecerá el producto:</p>
                    {schools.map(school => (
                      <div key={school.id} className="flex items-center gap-2 py-1">
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
                        <Label className="cursor-pointer">{school.name}</Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Aviso para logistica en modo specific */}
            {f.productScope === 'specific' && isLogistica && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <p><strong>Tu sede:</strong> El producto se asignará automáticamente a tu sede actual.</p>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // ─── Renombrar categoría: actualiza la tabla de categorías y todos los productos ─
  const handleRenameCategory = async () => {
    if (!catEditTarget || !catEditName.trim()) return;
    const newName = catEditName.trim().toLowerCase();
    if (newName === catEditTarget) { setCatEditTarget(null); return; }
    if (categories.includes(newName)) {
      toast({ variant: 'destructive', title: 'Error', description: `La categoría "${newName}" ya existe.` });
      return;
    }
    setCatSaving(true);
    try {
      // 1. Renombrar en product_categories
      const { error: errCat } = await supabase
        .from('product_categories')
        .update({ name: newName })
        .eq('name', catEditTarget);
      if (errCat) throw errCat;

      // 2. Actualizar todos los productos que tenían esa categoría
      const { error: errProd } = await supabase
        .from('products')
        .update({ category: newName })
        .eq('category', catEditTarget);
      if (errProd) throw errProd;

      toast({ title: '✅ Categoría renombrada', description: `"${catEditTarget}" → "${newName}"` });
      setCatEditTarget(null);
      setCatEditName('');
      await fetchCategories();
      await fetchProducts();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setCatSaving(false);
    }
  };

  // ─── Eliminar categoría (con migración si tiene productos) ───────────────────
  const handleDeleteCategory = async () => {
    if (!catDeleteTarget) return;
    const productosEnCategoria = products.filter(p => p.category === catDeleteTarget);
    if (productosEnCategoria.length > 0 && !catMoveTarget) {
      toast({ variant: 'destructive', title: 'Elige categoría destino', description: 'Debes seleccionar a dónde mover los productos antes de eliminar.' });
      return;
    }
    setCatSaving(true);
    try {
      // 1. Mover productos si los hay
      if (productosEnCategoria.length > 0 && catMoveTarget) {
        const { error } = await supabase
          .from('products')
          .update({ category: catMoveTarget })
          .eq('category', catDeleteTarget);
        if (error) throw error;
      }

      // 2. Borrar de la tabla product_categories (esto es lo que faltaba)
      const { error: errCat } = await supabase
        .from('product_categories')
        .delete()
        .eq('name', catDeleteTarget);
      if (errCat) throw errCat;

      toast({
        title: '✅ Categoría eliminada',
        description: productosEnCategoria.length > 0
          ? `${productosEnCategoria.length} producto(s) movido(s) a "${catMoveTarget}"`
          : 'Categoría eliminada correctamente',
      });
      setCatDeleteTarget(null);
      setCatMoveTarget('');
      await fetchCategories();
      await fetchProducts();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('¿Está seguro de eliminar este producto?')) return;
    
    // Actualización optimista: marcar como inactivo en la UI al instante
    setProducts(prev => prev.map(p => p.id === id ? { ...p, active: false, is_active: false } : p));
    setFilteredProducts(prev => prev.map(p => p.id === id ? { ...p, active: false, is_active: false } : p));

    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      
      toast({ title: '✅ Producto eliminado' });
      await fetchProducts(); // refrescar desde la BD para sincronizar estado real
    } catch (error: any) {
      // Revertir actualización optimista si hubo error
      await fetchProducts();
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  // ─── STOCK CONTROL: activar / desactivar por sede ───────────────────────────
  const openStockControlModal = (product: Product) => {
    const current = productStockLevels[product.id] ?? 0;
    setStockControlTarget(product);
    setStockControlInitial(product.stock_control_enabled ? String(current) : '0');
    setShowStockControlModal(true);
  };

  const handleSaveStockControl = async (enable: boolean) => {
    if (!stockControlTarget || !userSchoolId) return;
    setStockControlLoading(true);
    try {
      // 1. Actualizar flag en products
      const { error: err1 } = await supabase
        .from('products')
        .update({ stock_control_enabled: enable })
        .eq('id', stockControlTarget.id);
      if (err1) throw err1;

      // 2. Si se activa, crear/actualizar registro en product_stock
      if (enable) {
        const qty = parseInt(stockControlInitial) || 0;
        const { error: err2 } = await supabase
          .from('product_stock')
          .upsert(
            { product_id: stockControlTarget.id, school_id: userSchoolId, current_stock: qty },
            { onConflict: 'product_id,school_id' }
          );
        if (err2) throw err2;
      }

      toast({
        title: enable ? '✅ Control de stock activado' : '✅ Control de stock desactivado',
        description: enable
          ? `Stock inicial registrado: ${stockControlInitial} unidades`
          : 'El producto vuelve a venderse libremente',
      });
      setShowStockControlModal(false);
      setStockControlTarget(null);
      fetchProducts();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setStockControlLoading(false);
    }
  };

  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);

  const handleToggleActive = async (product: Product) => {
    if (togglingActiveId) return; // guard contra doble clic
    const newValue = !product.active;
    const action = newValue ? 'habilitar' : 'deshabilitar';
    if (!confirm(`¿Confirmas ${action} el producto "${product.name}"?`)) return;
    setTogglingActiveId(product.id);
    try {
      const { error } = await supabase
        .from('products')
        .update({ active: newValue })
        .eq('id', product.id);
      if (error) throw error;
      toast({
        title: newValue ? '✅ Producto habilitado' : '⛔ Producto deshabilitado',
        description: newValue
          ? `"${product.name}" vuelve a estar disponible en el POS`
          : `"${product.name}" ya no aparece en el POS`,
      });
      fetchProducts();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setTogglingActiveId(null);
    }
  };

  const handleToggleVerified = async (product: Product) => {
    const newValue = !product.is_verified;
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_verified: newValue })
        .eq('id', product.id);
      if (error) throw error;
      toast({
        title: newValue ? '✅ Sello Verde activado' : '⭕ Verificación removida',
        description: newValue
          ? `"${product.name}" ahora es un artículo oficial verificado`
          : `"${product.name}" ya no está marcado como verificado`,
      });
      fetchProducts();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const exportToCSV = () => {
    if (products.length === 0) return;
    
    const headers = ['Nombre', 'Código', 'Precio Venta', 'Costo', 'Categoría', 'Stock', 'Estado'];
    const rows = products.map(p => [
      p.name,
      p.code,
      p.price_sale,
      p.price_cost,
      p.category,
      p.has_stock ? p.stock_initial : 'N/A',
      p.active ? 'Activo' : 'Inactivo'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `inventario_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({ title: '✅ Excel/CSV generado', description: 'El reporte se ha descargado correctamente' });
  };

  const isAdminGeneral = role === 'admin_general';
  // Logística y admin_general pueden crear productos globales (sin sede)
  const isLogistica = role === 'logistica';
  const canCreateGlobal = isAdminGeneral || isLogistica;
  // El wizard tiene 4 pasos cuando el usuario puede elegir alcance de sede
  // y 3 pasos para otros roles (la sede se asigna automáticamente)
  const totalWizardSteps = canCreateGlobal ? 4 : 3;

  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600">{maintenance.message}</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Volver al Panel
          </Button>
        </div>
      </div>
    );
  }

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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dashboard"><BarChart3 className="h-4 w-4 mr-2" />Dashboard</TabsTrigger>
            <TabsTrigger value="productos"><Package className="h-4 w-4 mr-2" />Productos</TabsTrigger>
            <TabsTrigger value="promociones"><Percent className="h-4 w-4 mr-2" />Promociones</TabsTrigger>
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
                  {/* 🆕 Card de Productos Próximos a Vencer */}
                  <Card className="border-orange-200 bg-orange-50/50">
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-orange-900">Próximos a Vencer</CardTitle>
                        <AlertTriangle className="h-5 w-5 text-orange-600" />
                      </div>
                      <CardDescription>Productos con fecha de vencimiento cercana</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dashStats.expiringProducts.length > 0 ? (
                          dashStats.expiringProducts.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center p-3 bg-white rounded-lg border border-orange-200">
                              <div className="flex-1">
                                <span className="font-semibold text-gray-900">{item.name}</span>
                                <p className="text-xs text-gray-500">Vence: {item.expiry_date}</p>
                              </div>
                              <Badge 
                                variant="outline" 
                                className={`font-bold ${
                                  item.days_left <= 2 
                                    ? 'bg-red-100 text-red-800 border-red-300' 
                                    : item.days_left <= 5 
                                    ? 'bg-orange-100 text-orange-800 border-orange-300'
                                    : 'bg-yellow-100 text-yellow-800 border-yellow-300'
                                }`}
                              >
                                {item.days_left === 0 ? '¡HOY!' : item.days_left === 1 ? '1 día' : `${item.days_left} días`}
                              </Badge>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-8 text-gray-500">
                            <div className="mb-3">✅</div>
                            <p className="text-sm">No hay productos próximos a vencer</p>
                            <p className="text-xs text-gray-400 mt-1">Productos con control de vencimiento aparecerán aquí</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

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
                </div>

                {/* Segunda fila de charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Productos Más Vendidos</CardTitle>
                      <CardDescription>Top 5 histórico</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dashStats.topSelling.length > 0 ? (
                          dashStats.topSelling.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm">
                                  {idx + 1}
                                </div>
                                <span className="font-medium">{item.name}</span>
                              </div>
                              <Badge variant="outline">{item.sales} ventas</Badge>
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-gray-500 py-4">No hay datos de ventas aún</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Card de Reportes */}
                  <Card>
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <div>
                          <CardTitle>Reportes y Exportación</CardTitle>
                          <CardDescription>Descarga reportes de inventario</CardDescription>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={exportToCSV}>
                            <Download className="h-4 w-4 mr-2" />Excel/CSV
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer" onClick={exportToCSV}>
                          <h4 className="font-semibold mb-1">Inventario Completo</h4>
                          <p className="text-xs text-gray-500">Todos los productos y stocks</p>
                        </div>
                        <div className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                          <h4 className="font-semibold mb-1">Análisis de Ventas</h4>
                          <p className="text-xs text-gray-500">Reporte de productos más vendidos</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="productos">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <CardTitle>Lista de Productos</CardTitle>
                    <CardDescription>{filteredProducts.length} de {products.length} productos</CardDescription>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {isAdminGeneral && (
                      <Button
                        variant="outline"
                        onClick={() => { setCatEditTarget(null); setCatDeleteTarget(null); setCatMoveTarget(''); setShowCatManager(true); }}
                        className="border-purple-200 text-purple-700 hover:bg-purple-50"
                      >
                        <Tag className="h-4 w-4 mr-2" />
                        Categorías
                      </Button>
                    )}
                    {isAdminGeneral && (
                      <Button 
                        variant="outline" 
                        onClick={() => setShowBulkUpload(true)}
                        className="border-green-200 text-green-700 hover:bg-green-50"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Carga Masiva
                      </Button>
                    )}
                    {isAdminGeneral && (
                      <Button onClick={() => { setShowProductModal(true); resetForm(); }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Crear Producto
                      </Button>
                    )}
                    {role === 'gestor_unidad' && (
                      <Button
                        variant="outline"
                        onClick={() => setShowProductRequestModal(true)}
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      >
                        <ClipboardList className="h-4 w-4 mr-2" />
                        Solicitudes
                      </Button>
                    )}
                  </div>
                </div>
                {/* Buscador */}
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="🔍 Buscar productos por nombre, código o categoría..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-12 text-base pl-4 pr-10"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">
                      {searchQuery 
                        ? `No se encontraron productos con "${searchQuery}"` 
                        : 'No hay productos registrados'}
                    </p>
                    {searchQuery && (
                      <Button 
                        variant="outline" 
                        onClick={() => setSearchQuery('')}
                        className="mt-4"
                      >
                        Limpiar búsqueda
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredProducts.map(product => (
                    <Card key={product.id} className="hover:shadow-lg transition">
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <CardTitle className={`text-lg flex items-center gap-1.5 ${!product.active ? 'text-gray-400' : ''}`}>
                            {product.name}
                            {product.is_verified && (
                              <BadgeCheck className="h-4 w-4 text-green-500 shrink-0" title="Producto Verificado — Sello Verde" />
                            )}
                          </CardTitle>
                          <div className="flex items-center gap-1 flex-wrap justify-end">
                            {!product.active && (
                              <Badge className="bg-red-100 text-red-600 border border-red-200 text-[10px] px-1.5 py-0 h-5">
                                Inactivo
                              </Badge>
                            )}
                            {product.is_verified && (
                              <Badge className="bg-green-100 text-green-700 border border-green-200 text-[10px] px-1.5 py-0 h-5">
                                Verificado
                              </Badge>
                            )}
                            <Badge>{product.category}</Badge>
                          </div>
                        </div>
                        <CardDescription>Código: {product.code}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1 mb-2">
                          {(() => {
                            const customPrice = productSchoolPrices[product.id];
                            const hasCustomPrice = customPrice && customPrice.price_sale !== product.price_sale;
                            const displayPrice = hasCustomPrice ? customPrice.price_sale : product.price_sale;
                            // Alerta: precio de venta (de sede o base) por debajo del costo → venta a pérdida
                            const isBelowCost = product.price_cost > 0 && displayPrice < product.price_cost;
                            
                            return (
                              <>
                                <div className={`text-2xl font-bold ${isBelowCost ? 'text-red-600' : 'text-green-600'}`}>
                                  S/ {displayPrice?.toFixed(2)}
                                  {isBelowCost && (
                                    <span className="ml-1 text-xs font-normal text-red-500 align-middle" title="El precio de venta está por debajo del costo — ¡se vende a pérdida!">
                                      ⚠️ bajo costo
                                    </span>
                                  )}
                                </div>
                                {hasCustomPrice && (
                                  <div className="text-xs text-gray-500 flex items-center gap-1">
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">Tu Sede</Badge>
                                    <span>Precio base: S/ {product.price_sale?.toFixed(2)}</span>
                                  </div>
                                )}
                                {isBelowCost && (
                                  <div className="text-xs text-red-500 flex items-center gap-1 bg-red-50 rounded px-1.5 py-0.5">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Costo: S/ {product.price_cost?.toFixed(2)} — precio menor al costo
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        {product.has_stock && (
                          <div className="text-sm text-gray-500 mb-2">
                            Stock: {product.stock_initial || 0} | Mín: {product.stock_min || 0}
                          </div>
                        )}
                        {/* Badge de stock controlado por sede */}
                        {product.stock_control_enabled && (
                          <div className="flex items-center gap-2 mb-2 p-2 rounded-md bg-blue-50 border border-blue-200">
                            <Package className="h-3 w-3 text-blue-600" />
                            <span className="text-xs font-semibold text-blue-700">
                              Stock en sede: {productStockLevels[product.id] ?? '–'} uds.
                            </span>
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          {/* Toggle habilitar/deshabilitar: admin_general y logistica */}
                          {(isAdminGeneral || isLogistica) && (
                            <Button
                              size="sm"
                              variant={product.active ? 'outline' : 'secondary'}
                              onClick={() => handleToggleActive(product)}
                              disabled={togglingActiveId === product.id}
                              className={product.active
                                ? 'text-green-600 border-green-300 hover:bg-green-50'
                                : 'text-red-500 border-red-200 bg-red-50 hover:bg-red-100'}
                              title={product.active ? 'Deshabilitar producto' : 'Habilitar producto'}
                            >
                              {togglingActiveId === product.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : product.active
                                  ? <><Power className="h-3 w-3 mr-1" />Activo</>
                                  : <><PowerOff className="h-3 w-3 mr-1" />Inactivo</>}
                            </Button>
                          )}
                          {/* Botón de precios: solo admin_general puede editar precios */}
                          {isAdminGeneral && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                setSelectedProduct(product);
                                setShowPriceMatrix(true);
                              }}
                              className="flex-1"
                              title="Configurar precios por sede"
                            >
                              <Building2 className="h-3 w-3 mr-1" />
                              Precios
                            </Button>
                          )}
                          {/* Toggle Stock Control: solo admin_general puede modificar stock */}
                          {isAdminGeneral && userSchoolId && (
                            <Button
                              size="sm"
                              variant={product.stock_control_enabled ? 'default' : 'outline'}
                              onClick={() => openStockControlModal(product)}
                              className={product.stock_control_enabled ? 'bg-blue-600 hover:bg-blue-700' : ''}
                              title="Controlar stock de este producto en tu sede"
                            >
                              <Package className="h-3 w-3 mr-1" />
                              Stock
                            </Button>
                          )}
                          {/* Botón Verificar (Sello Verde): solo admin_general y superadmin */}
                          {(isAdminGeneral || role === 'superadmin') && (
                            <Button
                              size="sm"
                              variant={product.is_verified ? 'default' : 'outline'}
                              onClick={() => handleToggleVerified(product)}
                              className={product.is_verified
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'text-green-600 border-green-300 hover:bg-green-50'}
                              title={product.is_verified ? 'Quitar Sello Verde' : 'Dar Sello Verde (verificar producto)'}
                            >
                              <BadgeCheck className="h-3 w-3 mr-1" />
                              {product.is_verified ? 'Verde ✓' : 'Verificar'}
                            </Button>
                          )}
                          {/* Editar y Eliminar: solo admin_general (modifica producto global) */}
                          {isAdminGeneral && (
                            <>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleEditProduct(product)}
                                title="Editar producto (afecta todas las sedes)"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive" 
                                onClick={() => handleDeleteProduct(product.id)}
                                title="Eliminar producto"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="promociones">
            <CombosPromotionsManager />
          </TabsContent>
        </Tabs>
      </main>

      {/* Modal */}
      <Dialog open={showProductModal} onOpenChange={setShowProductModal}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editingProductId ? 'Editar Producto' : 'Crear Nuevo Producto'}</DialogTitle>
          </DialogHeader>
          
          <div className="mb-4">
            <div className="flex gap-2 mb-6">
              {Array.from({ length: totalWizardSteps }, (_, i) => i + 1).map(step => (
                <div 
                  key={step} 
                  className={`flex-1 h-3 rounded-full transition-all ${
                    wizardStep >= step ? 'bg-primary' : 'bg-gray-200'
                  }`} 
                />
              ))}
            </div>
            {WizardContent()}
            <div className="flex justify-between mt-8 gap-4">
              <Button 
                type="button"
                variant="outline" 
                size="lg"
                onClick={() => setWizardStep(Math.max(1, wizardStep - 1))} 
                disabled={wizardStep === 1}
                className="px-8"
              >
                ← Anterior
              </Button>
              {wizardStep < totalWizardSteps ? (
                <Button 
                  type="button"
                  size="lg"
                  onClick={() => setWizardStep(wizardStep + 1)}
                  disabled={!canAdvance(wizardStep)}
                  className="px-8 flex-1"
                >
                  Siguiente →
                </Button>
              ) : (
                <Button 
                  type="button"
                  size="lg"
                  onClick={handleSaveProduct}
                  className="px-8 flex-1 bg-green-600 hover:bg-green-700"
                >
                  {editingProductId ? '✓ Guardar Cambios' : '✓ Guardar Producto'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Cámara */}
      <Dialog open={showCamera} onOpenChange={setShowCamera}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Escanear Código de Barras</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center h-64 bg-gray-100 rounded space-y-4">
            <Camera className="h-24 w-24 text-gray-400" />
            <p className="text-center text-sm text-gray-500">
              Para usar el escáner, asegúrese de tener una cámara conectada.
              <br />
              <span className="font-mono text-xs mt-2">Navegador detectando hardware...</span>
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Precios por Sede */}
      <PriceMatrix
        isOpen={showPriceMatrix}
        onClose={() => {
          setShowPriceMatrix(false);
          setSelectedProduct(null);
          fetchProducts(); // Refrescar productos después de cambios
          fetchProductSchoolPrices(); // 🆕 Refrescar precios personalizados
        }}
        product={selectedProduct}
      />

      {/* Modal de Carga Masiva */}
      <BulkProductUpload
        isOpen={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onSuccess={fetchProducts}
        categories={categories}
        schools={schools}
      />

      {/* Modal: Control de Stock por Sede */}
      <Dialog open={showStockControlModal} onOpenChange={setShowStockControlModal}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" />
              Control de Stock — {stockControlTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {stockControlTarget?.stock_control_enabled ? (
              <>
                <p className="text-sm text-gray-600">
                  Este producto tiene control de stock activado.
                  Stock actual: <strong>{productStockLevels[stockControlTarget.id] ?? 0} unidades</strong>.
                </p>
                <div className="space-y-2">
                  <Label>Ajustar stock a:</Label>
                  <Input
                    type="number"
                    min="0"
                    value={stockControlInitial}
                    onChange={e => setStockControlInitial(e.target.value)}
                    placeholder="Cantidad"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                    onClick={() => handleSaveStockControl(true)}
                    disabled={stockControlLoading}
                  >
                    {stockControlLoading ? 'Guardando...' : 'Actualizar Stock'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleSaveStockControl(false)}
                    disabled={stockControlLoading}
                  >
                    Desactivar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Al activar el control de stock, el POS descontará unidades automáticamente 
                  cada vez que se venda este producto en tu sede.
                </p>
                <div className="space-y-2">
                  <Label>Stock inicial (unidades disponibles ahora):</Label>
                  <Input
                    type="number"
                    min="0"
                    value={stockControlInitial}
                    onChange={e => setStockControlInitial(e.target.value)}
                    placeholder="Ej: 50"
                  />
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={() => handleSaveStockControl(true)}
                  disabled={stockControlLoading}
                >
                  {stockControlLoading ? 'Activando...' : 'Activar Control de Stock'}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de solicitudes para gestor_unidad */}
      <ProductRequestModal
        open={showProductRequestModal}
        onClose={() => setShowProductRequestModal(false)}
        schoolId={userSchoolId}
        schoolName={schools.find(s => s.id === userSchoolId)?.name}
      />

      {/* ── Gestor de Categorías ────────────────────────────────────────────── */}
      <Dialog open={showCatManager} onOpenChange={open => {
        if (!open) { setCatEditTarget(null); setCatDeleteTarget(null); setCatMoveTarget(''); }
        setShowCatManager(open);
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Tag className="h-5 w-5 text-purple-600" />
              Gestionar Categorías
            </DialogTitle>
          </DialogHeader>

          {/* ── Crear nueva categoría directamente ── */}
          <div className="flex gap-2 pb-2 border-b">
            <Input
              placeholder="Nueva categoría (ej: snacks, bebidas...)"
              className="h-9 text-sm"
              id="new-cat-input"
              onKeyDown={async (e) => {
                if (e.key !== 'Enter') return;
                const val = (e.target as HTMLInputElement).value.trim().toLowerCase();
                if (!val) return;
                if (categories.includes(val)) {
                  toast({ variant: 'destructive', title: 'Ya existe', description: `La categoría "${val}" ya está en la lista.` });
                  return;
                }
                const { error } = await supabase.from('product_categories').insert({ name: val });
                if (error) { toast({ variant: 'destructive', title: 'Error', description: error.message }); return; }
                (e.target as HTMLInputElement).value = '';
                await fetchCategories();
                toast({ title: '✅ Categoría creada', description: `"${val}" agregada correctamente` });
              }}
            />
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
              onClick={async () => {
                const input = document.getElementById('new-cat-input') as HTMLInputElement;
                const val = input?.value.trim().toLowerCase();
                if (!val) return;
                if (categories.includes(val)) {
                  toast({ variant: 'destructive', title: 'Ya existe', description: `La categoría "${val}" ya está en la lista.` });
                  return;
                }
                const { error } = await supabase.from('product_categories').insert({ name: val });
                if (error) { toast({ variant: 'destructive', title: 'Error', description: error.message }); return; }
                input.value = '';
                await fetchCategories();
                toast({ title: '✅ Categoría creada', description: `"${val}" agregada correctamente` });
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Crear
            </Button>
          </div>

          <div className="space-y-3 pt-2">
            {categories.map(cat => {
              const count = products.filter(p => p.category === cat).length;
              const isEditing = catEditTarget === cat;
              const isDeleting = catDeleteTarget === cat;

              return (
                <div key={cat} className="border rounded-xl overflow-hidden">
                  {/* ── Fila principal ── */}
                  <div className={`flex items-center gap-3 px-4 py-3 ${isDeleting ? 'bg-red-50' : isEditing ? 'bg-blue-50' : 'bg-white'}`}>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={catEditName}
                          onChange={e => setCatEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(); if (e.key === 'Escape') setCatEditTarget(null); }}
                          className="h-8 text-sm"
                          placeholder="Nuevo nombre..."
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold capitalize text-gray-900">{cat}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            count === 0 ? 'bg-gray-100 text-gray-500' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {count} {count === 1 ? 'producto' : 'productos'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={handleRenameCategory} disabled={catSaving} className="h-8 bg-blue-600 hover:bg-blue-700 px-3">
                            {catSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setCatEditTarget(null)} className="h-8 px-2">
                            <X className="h-3 w-3" />
                          </Button>
                        </>
                      ) : isDeleting ? (
                        <Button size="sm" variant="ghost" onClick={() => { setCatDeleteTarget(null); setCatMoveTarget(''); }} className="h-8 px-2 text-gray-500">
                          <X className="h-3 w-3" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => { setCatEditTarget(cat); setCatEditName(cat); setCatDeleteTarget(null); }}
                            className="h-8 px-3 border-blue-200 text-blue-700 hover:bg-blue-50"
                            title="Renombrar categoría"
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Editar
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => { setCatDeleteTarget(cat); setCatMoveTarget(''); setCatEditTarget(null); }}
                            className="h-8 px-3 border-red-200 text-red-600 hover:bg-red-50"
                            title="Eliminar categoría"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Eliminar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Panel de migración (cuando se va a eliminar y tiene productos) ── */}
                  {isDeleting && (
                    <div className="border-t bg-red-50 px-4 py-3 space-y-3">
                      {count > 0 ? (
                        <>
                          {/* Lista de productos en esta categoría */}
                          <div>
                            <p className="text-xs font-semibold text-red-700 mb-2">
                              ⚠️ Esta categoría tiene {count} producto(s). Debes moverlos a otra categoría antes de eliminar:
                            </p>
                            <div className="max-h-32 overflow-y-auto space-y-1 mb-3 border border-red-200 rounded-lg bg-white p-2">
                              {products.filter(p => p.category === cat).map(p => (
                                <div key={p.id} className="flex items-center gap-2 text-xs text-gray-700 py-0.5">
                                  <Package className="h-3 w-3 text-gray-400 shrink-0" />
                                  <span className="truncate">{p.name}</span>
                                  <span className="text-gray-400 shrink-0">S/ {p.price_sale?.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <MoveRight className="h-4 w-4 text-red-500 shrink-0" />
                              <Select value={catMoveTarget} onValueChange={setCatMoveTarget}>
                                <SelectTrigger className="h-9 text-sm flex-1">
                                  <SelectValue placeholder="Mover a categoría..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {categories.filter(c => c !== cat).map(c => (
                                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="w-full bg-red-600 hover:bg-red-700 text-white"
                            onClick={handleDeleteCategory}
                            disabled={catSaving || !catMoveTarget}
                          >
                            {catSaving
                              ? <><Loader2 className="h-3 w-3 animate-spin mr-2" />Procesando...</>
                              : `Mover productos y eliminar "${cat}"`}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-red-700">
                            Esta categoría no tiene productos. Se eliminará sin afectar ningún producto.
                          </p>
                          <Button
                            size="sm"
                            className="w-full bg-red-600 hover:bg-red-700 text-white"
                            onClick={handleDeleteCategory}
                            disabled={catSaving}
                          >
                            {catSaving
                              ? <><Loader2 className="h-3 w-3 animate-spin mr-2" />Eliminando...</>
                              : `Eliminar "${cat}"`}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {categories.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No hay categorías registradas</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Products;
