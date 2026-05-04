import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, Package, Percent, X, Check, ShoppingCart, Sparkles, Zap, Gift, Tag, Building2, Pencil, Archive } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

interface Product {
  id: string;
  name: string;
  price_sale: number;
  category: string;
  has_stock: boolean;
}

interface ComboProduct {
  product_id: string;
  quantity: number;
}

interface Combo {
  id?: string;
  name: string;
  combo_price: number;
  products: ComboProduct[];
  school_ids: string[];
  applyToAllSchools: boolean;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

interface Promotion {
  id?: string;
  name: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  applies_to: 'product' | 'category' | 'all';
  target_ids: string[];
  school_ids: string[];
  applyToAllSchools: boolean;
  active: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
}

export const CombosPromotionsManager = () => {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  
  const [showComboModal, setShowComboModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  
  const [comboForm, setComboForm] = useState<Combo>({
    name: '',
    combo_price: 0,
    products: [],
    school_ids: [],
    applyToAllSchools: true,
    active: true,
    valid_from: null,
    valid_until: null,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [promoSearchQuery, setPromoSearchQuery] = useState('');
  const [filteredPromoProducts, setFilteredPromoProducts] = useState<Product[]>([]);
  const [filteredCategories, setFilteredCategories] = useState<string[]>([]);

  const [promoForm, setPromoForm] = useState<Promotion>({
    name: '',
    discount_type: 'percentage',
    discount_value: 0,
    applies_to: 'category',
    target_ids: [],
    school_ids: [],
    applyToAllSchools: true,
    active: true,
  });

  const [step, setStep] = useState(1);
  const [comboStatusFilter, setComboStatusFilter] = useState<string>('all');
  const [comboSchoolFilter, setComboSchoolFilter] = useState<string>('all');
  const [promoStatusFilter, setPromoStatusFilter] = useState<string>('all');
  const [promoSchoolFilter, setPromoSchoolFilter] = useState<string>('all');

  useEffect(() => {
    fetchProducts();
    fetchCombos();
    fetchPromotions();
    fetchSchools();
  }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').eq('active', true);
    setProducts(data || []);
    setFilteredProducts(data || []);
    setFilteredPromoProducts(data || []);
    const cats = Array.from(new Set((data || []).map(p => p.category)));
    setCategories(cats);
    setFilteredCategories(cats);
  };

  // Filtrar productos cuando cambia la búsqueda del combo
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProducts(products);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = products.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
      );
      setFilteredProducts(filtered);
    }
  }, [searchQuery, products]);

  // Filtrar productos de promoción
  useEffect(() => {
    if (!promoSearchQuery.trim()) {
      setFilteredPromoProducts(products);
    } else {
      const query = promoSearchQuery.toLowerCase();
      const filtered = products.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
      );
      setFilteredPromoProducts(filtered);
    }
  }, [promoSearchQuery, products]);

  // Filtrar categorías de promoción
  useEffect(() => {
    if (!promoSearchQuery.trim()) {
      setFilteredCategories(categories);
    } else {
      const query = promoSearchQuery.toLowerCase();
      const filtered = categories.filter(cat => 
        cat.toLowerCase().includes(query)
      );
      setFilteredCategories(filtered);
    }
  }, [promoSearchQuery, categories]);

  const fetchSchools = async () => {
    const { data } = await supabase.from('schools').select('id, name').eq('is_active', true);
    setSchools(data || []);
  };

  const fetchCombos = async () => {
    try {
      const [{ data, error }, { data: runtimeData }] = await Promise.all([
        supabase.from('combos').select('*').order('created_at', { ascending: false }),
        supabase.from('v_combos_runtime_status').select('id, runtime_status, is_sellable_now'),
      ]);

      if (error) {
        console.error('Error fetching combos:', error);
        return;
      }

      const runtimeById = new Map<string, { runtime_status: string; is_sellable_now: boolean }>();
      (runtimeData || []).forEach((row: any) => {
        runtimeById.set(row.id, {
          runtime_status: row.runtime_status,
          is_sellable_now: Boolean(row.is_sellable_now),
        });
      });

      // Cargar items de cada combo por separado
      const combosWithItems = await Promise.all(
        (data || []).map(async (combo) => {
          const { data: items } = await supabase
            .from('combo_items')
            .select('quantity, product_id')
            .eq('combo_id', combo.id);

          // Cargar productos
          const productIds = (items || []).map(item => item.product_id);
          
          if (productIds.length === 0) {
            return { ...combo, combo_items: [] };
          }

          const { data: products } = await supabase
            .from('products')
            .select('id, name, price_sale, has_stock')
            .in('id', productIds);

          // Combinar items con productos
          const combo_items = (items || []).map(item => ({
            quantity: item.quantity,
            product: products?.find(p => p.id === item.product_id)
          }));

          const runtime = runtimeById.get(combo.id);
          return {
            ...combo,
            runtime_status: runtime?.runtime_status ?? getComboRuntimeStatus(combo),
            is_sellable_now: runtime?.is_sellable_now ?? false,
            combo_items,
          };
        })
      );

      setCombos(combosWithItems);
    } catch (error) {
      console.error('Error cargando combos:', error);
    }
  };

  const fetchPromotions = async () => {
    const [{ data }, { data: runtimeData }] = await Promise.all([
      supabase
        .from('promotions')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('v_promotions_runtime_status')
        .select('id, runtime_status, is_active_now'),
    ]);

    const runtimeById = new Map<string, { runtime_status: string; is_active_now: boolean }>();
    (runtimeData || []).forEach((row: any) => {
      runtimeById.set(row.id, {
        runtime_status: row.runtime_status,
        is_active_now: Boolean(row.is_active_now),
      });
    });

    const promotionsWithRuntime = (data || []).map((promo: any) => {
      const runtime = runtimeById.get(promo.id);
      return {
        ...promo,
        runtime_status: runtime?.runtime_status ?? getPromotionRuntimeStatus(promo),
        is_active_now: runtime?.is_active_now ?? false,
      };
    });

    setPromotions(promotionsWithRuntime);
  };

  const addProductToCombo = () => {
    setSearchQuery(''); // Limpiar búsqueda al agregar nuevo producto
    setComboForm({
      ...comboForm,
      products: [...comboForm.products, { product_id: '', quantity: 1 }],
    });
  };

  const removeProductFromCombo = (index: number) => {
    setComboForm({
      ...comboForm,
      products: comboForm.products.filter((_, i) => i !== index),
    });
  };

  const updateComboProduct = (index: number, field: 'product_id' | 'quantity', value: any) => {
    const newProducts = [...comboForm.products];
    newProducts[index][field] = value;
    setComboForm({ ...comboForm, products: newProducts });
  };

  const calculateComboTotal = () => {
    return comboForm.products.reduce((total, item) => {
      const product = products.find(p => p.id === item.product_id);
      return total + (product?.price_sale || 0) * item.quantity;
    }, 0);
  };

  const saveCombo = async () => {
    if (!comboForm.name || comboForm.products.length === 0 || comboForm.combo_price <= 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Completa todos los campos' });
      return;
    }

    if (comboForm.valid_from && comboForm.valid_until && comboForm.valid_from > comboForm.valid_until) {
      toast({
        variant: 'destructive',
        title: 'Rango inválido',
        description: 'La fecha de inicio no puede ser mayor que la fecha fin.',
      });
      return;
    }

    const selectedSchools = comboForm.applyToAllSchools ? schools.map(s => s.id) : comboForm.school_ids;

    if (selectedSchools.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona al menos una sede' });
      return;
    }

    try {
      let shouldCreateNewVersion = false;
      if (editingComboId) {
        const { data: hasSales, error: salesCheckError } = await supabase.rpc('combo_has_sales', {
          p_combo_id: editingComboId,
        });

        if (!salesCheckError && hasSales === true) {
          const shouldUpdateCurrent = window.confirm(
            'Este combo ya tiene ventas históricas.\n\nAceptar: actualizar este mismo combo.\nCancelar: crear un combo nuevo basado en este.'
          );
          shouldCreateNewVersion = !shouldUpdateCurrent;
        }
      }

      const comboPayload = {
        name: comboForm.name,
        combo_price: comboForm.combo_price,
        active: comboForm.active,
        school_ids: selectedSchools,
        school_id: selectedSchools[0] || null,
        valid_from: comboForm.valid_from,
        valid_until: comboForm.valid_until,
        is_archived: false,
      };

      const isEditingInPlace = Boolean(editingComboId && !shouldCreateNewVersion);
      const comboQuery = isEditingInPlace
        ? supabase
            .from('combos')
            .update(comboPayload)
            .eq('id', editingComboId)
        : supabase
            .from('combos')
            .insert(comboPayload);

      const { data: combo, error: comboError } = await comboQuery
        .select()
        .single();

      if (comboError) throw comboError;

      // En edición, reemplazamos la receta del combo por la nueva.
      if (isEditingInPlace) {
        const { error: deleteItemsError } = await supabase
          .from('combo_items')
          .delete()
          .eq('combo_id', editingComboId);
        if (deleteItemsError) throw deleteItemsError;
      }

      const items = comboForm.products.map(p => ({
        combo_id: combo.id,
        product_id: p.product_id,
        quantity: p.quantity,
      }));

      const { error: itemsError } = await supabase.from('combo_items').insert(items);
      if (itemsError) throw itemsError;

      toast({
        title: editingComboId
          ? (shouldCreateNewVersion ? '🧬 Nuevo combo creado' : '✅ Combo actualizado')
          : '🎉 ¡Combo creado!',
        description: editingComboId
          ? (shouldCreateNewVersion
            ? 'Se creó una nueva versión y se preservó el historial del combo anterior.'
            : 'Se guardaron los cambios correctamente')
          : 'Listo para vender',
      });
      setShowComboModal(false);
      resetComboForm();
      fetchCombos();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const savePromotion = async () => {
    if (!promoForm.name || promoForm.discount_value <= 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Completa todos los campos' });
      return;
    }

    if (promoForm.applies_to !== 'all' && promoForm.target_ids.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona productos o categorías' });
      return;
    }

    const selectedSchools = promoForm.applyToAllSchools ? schools.map(s => s.id) : promoForm.school_ids;

    if (selectedSchools.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona al menos una sede' });
      return;
    }

    try {
      // NO enviar applyToAllSchools al backend
      const { applyToAllSchools, ...promoData } = promoForm;
      
      const { error } = await supabase.from('promotions').insert({
        ...promoData,
        school_ids: selectedSchools
      });
      if (error) throw error;

      toast({ title: '🎉 ¡Promoción creada!', description: 'Se aplicará automáticamente' });
      setShowPromoModal(false);
      resetPromoForm();
      fetchPromotions();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const toggleComboStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('combos').update({ active: !currentStatus }).eq('id', id);
    if (!error) {
      toast({ title: currentStatus ? '⏸️ Combo pausado' : '✅ Combo activado' });
      fetchCombos();
    }
  };

  const editCombo = (combo: any) => {
    const comboProducts = (combo.combo_items || [])
      .filter((item: any) => item?.product?.id)
      .map((item: any) => ({
        product_id: item.product.id,
        quantity: Number(item.quantity) || 1,
      }));

    const schoolsFromCombo: string[] = Array.isArray(combo.school_ids) ? combo.school_ids : [];
    setEditingComboId(combo.id);
    setComboForm({
      name: combo.name || '',
      combo_price: Number(combo.combo_price) || 0,
      products: comboProducts,
      school_ids: schoolsFromCombo,
      applyToAllSchools: schoolsFromCombo.length === 0 || schoolsFromCombo.length === schools.length,
      active: Boolean(combo.active),
      valid_from: combo.valid_from || null,
      valid_until: combo.valid_until || null,
    });
    setSearchQuery('');
    setStep(1);
    setShowComboModal(true);
  };

  const archiveCombo = async (combo: any) => {
    const ok = window.confirm(`¿Archivar el combo "${combo.name}"?\nDejará de aparecer en la lista activa y en ventas vigentes.`);
    if (!ok) return;

    const { error } = await supabase
      .from('combos')
      .update({ is_archived: true, active: false })
      .eq('id', combo.id);

    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return;
    }

    toast({ title: '🗂️ Combo archivado', description: 'El combo ya no se mostrará en la lista activa.' });
    fetchCombos();
  };

  const togglePromoStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('promotions').update({ active: !currentStatus }).eq('id', id);
    if (!error) {
      toast({ title: currentStatus ? '⏸️ Promoción pausada' : '✅ Promoción activada' });
      fetchPromotions();
    }
  };

  const resetComboForm = () => {
    setEditingComboId(null);
    setComboForm({ 
      name: '', 
      combo_price: 0, 
      products: [], 
      school_ids: [],
      applyToAllSchools: true,
      active: true,
      valid_from: null,
      valid_until: null,
    });
    setSearchQuery(''); // Limpiar búsqueda al resetear
    setStep(1);
  };

  const resetPromoForm = () => {
    setPromoForm({
      name: '',
      discount_type: 'percentage',
      discount_value: 0,
      applies_to: 'category',
      target_ids: [],
      school_ids: [],
      applyToAllSchools: true,
      active: true,
    });
    setPromoSearchQuery(''); // Limpiar búsqueda
  };

  // Emojis por categoría
  const getCategoryEmoji = (category: string) => {
    const map: any = {
      bebidas: '🥤', snacks: '🍪', menu: '🍽️', sandwiches: '🥪',
      postres: '🍰', frutas: '🍎', lacteos: '🥛', otros: '📦'
    };
    return map[category] || '📦';
  };

  const todayLima = () =>
    new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));

  const getComboRuntimeStatus = (combo: any): string => {
    if (combo?.is_archived) return 'archivado';
    if (!combo?.active) return 'pausado';

    const now = todayLima();
    const start = combo?.valid_from ? new Date(`${combo.valid_from}T00:00:00`) : null;
    const end = combo?.valid_until ? new Date(`${combo.valid_until}T23:59:59`) : null;

    if (start && now < start) return 'programado';
    if (end && now > end) return 'vencido';
    return 'vigente';
  };

  const getPromotionRuntimeStatus = (promo: any): string => {
    if (!promo?.active) return 'pausada';

    const now = todayLima();
    const start = promo?.valid_from ? new Date(`${promo.valid_from}T00:00:00`) : null;
    const end = promo?.valid_until ? new Date(`${promo.valid_until}T23:59:59`) : null;

    if (start && now < start) return 'programada';
    if (end && now > end) return 'vencida';
    return 'vigente';
  };

  const statusBadgeClass = (status: string): string => {
    switch (status) {
      case 'vigente':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'programado':
      case 'programada':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'vencido':
      case 'vencida':
        return 'bg-gray-100 text-gray-700 border-gray-300';
      case 'pausado':
      case 'pausada':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'archivado':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return '';
    }
  };

  const getSchoolNames = (schoolIds: string[] | null | undefined): string[] => {
    if (!schoolIds || schoolIds.length === 0) return ['Todas las sedes'];
    return schoolIds
      .map((id) => schools.find((s) => s.id === id)?.name)
      .filter(Boolean);
  };

  const filteredCombos = useMemo(() => {
    return combos.filter((combo) => {
      const status = combo.runtime_status || getComboRuntimeStatus(combo);
      const schoolIds: string[] = Array.isArray(combo.school_ids) ? combo.school_ids : [];
      const matchStatus = comboStatusFilter === 'all' || status === comboStatusFilter;
      const matchSchool =
        comboSchoolFilter === 'all'
          ? true
          : schoolIds.length === 0
            ? comboSchoolFilter === 'global'
            : schoolIds.includes(comboSchoolFilter);
      return matchStatus && matchSchool;
    });
  }, [combos, comboStatusFilter, comboSchoolFilter, schools]);

  const filteredPromotions = useMemo(() => {
    return promotions.filter((promo) => {
      const status = promo.runtime_status || getPromotionRuntimeStatus(promo);
      const schoolIds: string[] = Array.isArray(promo.school_ids) ? promo.school_ids : [];
      const matchStatus = promoStatusFilter === 'all' || status === promoStatusFilter;
      const matchSchool =
        promoSchoolFilter === 'all'
          ? true
          : schoolIds.length === 0
            ? promoSchoolFilter === 'global'
            : schoolIds.includes(promoSchoolFilter);
      return matchStatus && matchSchool;
    });
  }, [promotions, promoStatusFilter, promoSchoolFilter, schools]);

  const comboCounts = useMemo(() => {
    const counts = {
      total: combos.length,
      visible: filteredCombos.length,
      vigente: 0,
      programado: 0,
      pausado: 0,
      vencido: 0,
      archivado: 0,
    };

    combos.forEach((combo) => {
      const status = combo.runtime_status || getComboRuntimeStatus(combo);
      if (status in counts) {
        counts[status as keyof typeof counts] += 1;
      }
    });

    return counts;
  }, [combos, filteredCombos]);

  const promotionCounts = useMemo(() => {
    const counts = {
      total: promotions.length,
      visible: filteredPromotions.length,
      vigente: 0,
      programada: 0,
      pausada: 0,
      vencida: 0,
    };

    promotions.forEach((promo) => {
      const status = promo.runtime_status || getPromotionRuntimeStatus(promo);
      if (status in counts) {
        counts[status as keyof typeof counts] += 1;
      }
    });

    return counts;
  }, [promotions, filteredPromotions]);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="combos" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-14">
          <TabsTrigger value="combos" className="text-lg">
            <Gift className="h-5 w-5 mr-2" />
            Combos
          </TabsTrigger>
          <TabsTrigger value="promociones" className="text-lg">
            <Zap className="h-5 w-5 mr-2" />
            Promociones
          </TabsTrigger>
        </TabsList>

        {/* TAB: COMBOS */}
        <TabsContent value="combos" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-2xl font-bold">Combos Especiales</h3>
              <p className="text-muted-foreground">Agrupa productos con precios únicos</p>
            </div>
            <Button onClick={() => setShowComboModal(true)} size="lg" className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
              <Plus className="h-5 w-5 mr-2" />
              Crear Combo
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm text-muted-foreground">Filtrar por estado</Label>
              <Select value={comboStatusFilter} onValueChange={setComboStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="vigente">Vigentes</SelectItem>
                  <SelectItem value="programado">Programados</SelectItem>
                  <SelectItem value="pausado">Pausados</SelectItem>
                  <SelectItem value="vencido">Vencidos</SelectItem>
                  <SelectItem value="archivado">Archivados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Filtrar por sede</Label>
              <Select value={comboSchoolFilter} onValueChange={setComboSchoolFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las sedes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sedes</SelectItem>
                  <SelectItem value="global">Global (todas)</SelectItem>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <Badge variant="outline" className="justify-center py-2">Total: {comboCounts.total}</Badge>
            <Badge variant="outline" className="justify-center py-2">Viendo: {comboCounts.visible}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('vigente')}`}>Vigentes: {comboCounts.vigente}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('programado')}`}>Programados: {comboCounts.programado}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('pausado')}`}>Pausados: {comboCounts.pausado}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('vencido')}`}>Vencidos: {comboCounts.vencido}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('archivado')}`}>Archivados: {comboCounts.archivado}</Badge>
          </div>

          {filteredCombos.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-16 text-center">
                <Gift className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No hay combos para ese filtro</h3>
                <p className="text-muted-foreground mb-4">Ajusta filtros o crea un combo nuevo</p>
                <Button onClick={() => setShowComboModal(true)} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Crear Combo
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCombos.map(combo => (
                <Card key={combo.id} className={`hover:shadow-xl transition-all duration-300 ${combo.active ? 'border-2 border-purple-200' : 'opacity-60'}`}>
                  <CardHeader className="bg-gradient-to-br from-purple-50 to-pink-50 pb-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Gift className="h-5 w-5 text-purple-600" />
                          <CardTitle className="text-xl">{combo.name}</CardTitle>
                        </div>
                        <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
                          S/ {combo.combo_price?.toFixed(2)}
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-xs ${statusBadgeClass(combo.runtime_status)}`}>
                        {combo.runtime_status || getComboRuntimeStatus(combo)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {getSchoolNames(combo.school_ids).slice(0, 3).map((schoolName) => (
                        <Badge key={`${combo.id}-${schoolName}`} variant="secondary" className="text-[10px]">
                          {schoolName}
                        </Badge>
                      ))}
                      {getSchoolNames(combo.school_ids).length > 3 && (
                        <Badge variant="secondary" className="text-[10px]">
                          +{getSchoolNames(combo.school_ids).length - 3}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="space-y-2 mb-4">
                      {combo.combo_items?.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                          <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-bold">
                            {item.quantity}
                          </div>
                          <span className="flex-1 text-sm font-medium">{item.product?.name}</span>
                          {item.product?.has_stock && (
                            <Package className="h-3 w-3 text-green-600" />
                          )}
                        </div>
                      ))}
                    </div>
                    <Button
                      variant={combo.active ? 'outline' : 'default'}
                      size="sm"
                      className="w-full"
                      onClick={() => toggleComboStatus(combo.id, combo.active)}
                    >
                      {combo.active ? '⏸ Pausar' : '▶ Activar'}
                    </Button>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => editCombo(combo)}
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => archiveCombo(combo)}
                      >
                        <Archive className="h-4 w-4 mr-1" />
                        Eliminar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB: PROMOCIONES */}
        <TabsContent value="promociones" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-2xl font-bold">Promociones y Descuentos</h3>
              <p className="text-muted-foreground">Aplica descuentos automáticos</p>
            </div>
            <Button onClick={() => setShowPromoModal(true)} size="lg" className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700">
              <Sparkles className="h-5 w-5 mr-2" />
              Crear Promoción
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm text-muted-foreground">Filtrar por estado</Label>
              <Select value={promoStatusFilter} onValueChange={setPromoStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="vigente">Vigentes</SelectItem>
                  <SelectItem value="programada">Programadas</SelectItem>
                  <SelectItem value="pausada">Pausadas</SelectItem>
                  <SelectItem value="vencida">Vencidas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Filtrar por sede</Label>
              <Select value={promoSchoolFilter} onValueChange={setPromoSchoolFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las sedes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sedes</SelectItem>
                  <SelectItem value="global">Global (todas)</SelectItem>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Badge variant="outline" className="justify-center py-2">Total: {promotionCounts.total}</Badge>
            <Badge variant="outline" className="justify-center py-2">Viendo: {promotionCounts.visible}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('vigente')}`}>Vigentes: {promotionCounts.vigente}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('programada')}`}>Programadas: {promotionCounts.programada}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('pausada')}`}>Pausadas: {promotionCounts.pausada}</Badge>
            <Badge variant="outline" className={`justify-center py-2 ${statusBadgeClass('vencida')}`}>Vencidas: {promotionCounts.vencida}</Badge>
          </div>

          {filteredPromotions.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-16 text-center">
                <Percent className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No hay promociones para ese filtro</h3>
                <p className="text-muted-foreground mb-4">Ajusta filtros o crea una promoción nueva</p>
                <Button onClick={() => setShowPromoModal(true)} variant="outline">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Crear Promoción
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredPromotions.map(promo => (
                <Card key={promo.id} className={`hover:shadow-lg transition-all duration-300 ${promo.active ? 'border-l-4 border-orange-500' : 'opacity-60'}`}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                          <Zap className="h-8 w-8 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-lg">{promo.name}</h3>
                            <Badge variant="outline" className={statusBadgeClass(promo.runtime_status)}>
                              {promo.runtime_status || getPromotionRuntimeStatus(promo)}
                            </Badge>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              <span className="font-semibold text-orange-600">
                                {promo.discount_type === 'percentage' 
                                  ? `${promo.discount_value}% OFF` 
                                  : `S/ ${promo.discount_value} OFF`}
                              </span>
                            </div>
                            <div className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium capitalize">
                              {promo.applies_to === 'all' ? 'Todos los productos' : promo.applies_to}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {getSchoolNames(promo.school_ids).slice(0, 2).map((schoolName) => (
                                <Badge key={`${promo.id}-${schoolName}`} variant="secondary" className="text-[10px]">
                                  {schoolName}
                                </Badge>
                              ))}
                              {getSchoolNames(promo.school_ids).length > 2 && (
                                <Badge variant="secondary" className="text-[10px]">
                                  +{getSchoolNames(promo.school_ids).length - 2}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant={promo.active ? 'outline' : 'default'}
                        onClick={() => togglePromoStatus(promo.id, promo.active)}
                      >
                        {promo.active ? '⏸ Pausar' : '▶ Activar'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* MODAL: CREAR COMBO */}
      <Dialog open={showComboModal} onOpenChange={(open) => {
        setShowComboModal(open);
        if (!open) resetComboForm();
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Gift className="h-6 w-6 text-purple-600" />
              {editingComboId ? 'Editar Combo Especial' : 'Crear Combo Especial'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Paso 1: Nombre */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-pink-100 mb-4">
                    <Package className="h-10 w-10 text-purple-600" />
                  </div>
                  <h3 className="text-2xl font-bold">Dale un nombre atractivo</h3>
                </div>
                <div>
                  <Input
                    value={comboForm.name}
                    onChange={(e) => setComboForm({ ...comboForm, name: e.target.value })}
                    placeholder="Ej: Combo Recreo Completo 🎒"
                    className="h-16 text-xl text-center font-semibold"
                    autoFocus
                  />
                </div>
                <Button onClick={() => setStep(2)} disabled={!comboForm.name} className="w-full h-14 text-lg">
                  Siguiente → Agregar Productos
                </Button>
              </div>
            )}

            {/* Paso 2: Productos */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 mb-4">
                    <ShoppingCart className="h-10 w-10 text-blue-600" />
                  </div>
                  <h3 className="text-2xl font-bold">Selecciona los productos</h3>
                  <p className="text-gray-500 text-sm mt-2">Busca y selecciona cada producto para tu combo</p>
                </div>
                
                {comboForm.products.map((item, index) => (
                  <div key={index} className="space-y-2">
                    {/* Producto seleccionado o buscador */}
                    {item.product_id ? (
                      <div className="flex gap-2 items-center p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border-2 border-purple-200">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold">
                              {getCategoryEmoji(products.find(p => p.id === item.product_id)?.category || '')} 
                              {products.find(p => p.id === item.product_id)?.name}
                            </span>
                            <Badge variant="secondary">
                              S/ {products.find(p => p.id === item.product_id)?.price_sale}
                            </Badge>
                          </div>
                        </div>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateComboProduct(index, 'quantity', parseInt(e.target.value))}
                          className="w-20 h-12 text-center text-lg font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12"
                          onClick={() => updateComboProduct(index, 'product_id', '')}
                        >
                          <X className="h-5 w-5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-12 w-12"
                          onClick={() => removeProductFromCombo(index)}
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed rounded-lg p-4">
                        {/* Input de búsqueda */}
                        <div className="relative mb-2">
                          <Input
                            type="text"
                            placeholder="🔍 Escribe para buscar productos..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-12 text-base pl-4 pr-10"
                            autoFocus
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

                        {/* Lista de productos filtrados */}
                        {searchQuery && (
                          <div className="max-h-64 overflow-y-auto space-y-1 mt-2">
                            {filteredProducts.length === 0 ? (
                              <div className="p-4 text-center text-gray-500 text-sm">
                                No se encontraron productos con "{searchQuery}"
                              </div>
                            ) : (
                              filteredProducts.map(p => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    updateComboProduct(index, 'product_id', p.id);
                                    setSearchQuery('');
                                  }}
                                  className="w-full flex items-center justify-between p-3 hover:bg-purple-50 rounded-lg border border-transparent hover:border-purple-200 transition-all text-left"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl">{getCategoryEmoji(p.category)}</span>
                                    <div>
                                      <p className="font-semibold text-sm">{p.name}</p>
                                      <p className="text-xs text-gray-500 capitalize">{p.category}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">S/ {p.price_sale}</Badge>
                                    {p.has_stock && <Package className="h-4 w-4 text-green-600" />}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        )}

                        {!searchQuery && (
                          <p className="text-sm text-gray-400 text-center mt-2">
                            Empieza a escribir para buscar productos
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <Button variant="outline" onClick={addProductToCombo} className="w-full h-12 border-dashed border-2">
                  <Plus className="h-5 w-5 mr-2" />
                  Agregar otro producto
                </Button>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                    ← Anterior
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={comboForm.products.length === 0} className="flex-1">
                    Siguiente → Precio
                  </Button>
                </div>
              </div>
            )}

            {/* Paso 3: Precio */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 mb-4">
                    <Tag className="h-10 w-10 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-bold">Define el precio del combo</h3>
                </div>
                
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-2xl space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Precio individual total:</span>
                    <span className="text-2xl font-bold text-gray-400 line-through">S/ {calculateComboTotal().toFixed(2)}</span>
                  </div>
                  <div className="border-t-2 border-dashed pt-4">
                    <Label className="text-lg font-semibold mb-2 block">Precio del Combo</Label>
                    <div className="relative">
                      <span className="absolute left-8 top-1/2 -translate-y-1/2 text-6xl font-black text-gray-400">S/</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={comboForm.combo_price || ''}
                        onChange={(e) => {
                          const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                          setComboForm({ ...comboForm, combo_price: value });
                        }}
                        placeholder="0.00"
                        className="h-28 text-7xl font-black pl-32 text-center bg-white border-4 border-purple-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </div>

                  {/* Advertencia si precio es mayor */}
                  {comboForm.combo_price > 0 && comboForm.combo_price > calculateComboTotal() && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <div className="text-4xl">⚠️</div>
                        <div>
                          <p className="font-bold text-red-900 text-lg">El precio del combo es mayor que comprarlo por separado</p>
                          <p className="text-red-700 text-sm mt-1">
                            Precio individual: S/ {calculateComboTotal().toFixed(2)} | 
                            Precio combo: S/ {comboForm.combo_price.toFixed(2)} | 
                            Diferencia: <span className="font-bold">+S/ {(comboForm.combo_price - calculateComboTotal()).toFixed(2)}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Mostrar ahorro si es menor */}
                  {comboForm.combo_price > 0 && comboForm.combo_price < calculateComboTotal() && (
                    <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm opacity-90">Ahorro por combo</p>
                          <p className="text-3xl font-black">S/ {(calculateComboTotal() - comboForm.combo_price).toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm opacity-90">Descuento</p>
                          <p className="text-3xl font-black">{(((calculateComboTotal() - comboForm.combo_price) / calculateComboTotal()) * 100).toFixed(0)}%</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Selector de Sedes */}
                <div className="border-2 border-dashed rounded-xl p-4 bg-blue-50">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    <Label className="text-base font-semibold">¿Dónde estará disponible?</Label>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <Checkbox
                      checked={comboForm.applyToAllSchools}
                      onCheckedChange={(checked) => 
                        setComboForm({ ...comboForm, applyToAllSchools: checked as boolean })
                      }
                    />
                    <Label className="text-sm">Todas las sedes</Label>
                  </div>
                  {!comboForm.applyToAllSchools && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {schools.map(school => (
                        <div key={school.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={comboForm.school_ids.includes(school.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setComboForm({ ...comboForm, school_ids: [...comboForm.school_ids, school.id] });
                              } else {
                                setComboForm({ ...comboForm, school_ids: comboForm.school_ids.filter(id => id !== school.id) });
                              }
                            }}
                          />
                          <Label className="text-sm">{school.name}</Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vigencia */}
                <div className="border-2 border-dashed rounded-xl p-4 bg-purple-50">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="h-5 w-5 text-purple-600" />
                    <Label className="text-base font-semibold">Vigencia del combo</Label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm text-muted-foreground">Fecha inicio</Label>
                      <Input
                        type="date"
                        value={comboForm.valid_from || ''}
                        onChange={(e) => setComboForm({
                          ...comboForm,
                          valid_from: e.target.value || null,
                        })}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Fecha fin (opcional)</Label>
                      <Input
                        type="date"
                        value={comboForm.valid_until || ''}
                        disabled={comboForm.valid_until === null}
                        onChange={(e) => setComboForm({
                          ...comboForm,
                          valid_until: e.target.value || null,
                        })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Checkbox
                      checked={comboForm.valid_until === null}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setComboForm({ ...comboForm, valid_until: null });
                        } else {
                          const today = new Date().toISOString().slice(0, 10);
                          setComboForm({ ...comboForm, valid_until: comboForm.valid_from || today });
                        }
                      }}
                    />
                    <Label className="text-sm">Indefinida (sin fecha de vencimiento)</Label>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    ← Anterior
                  </Button>
                  <Button onClick={saveCombo} disabled={comboForm.combo_price <= 0} className="flex-1 h-14 text-lg bg-gradient-to-r from-purple-600 to-pink-600">
                    <Check className="h-5 w-5 mr-2" />
                    {editingComboId ? 'Guardar Cambios' : 'Guardar Combo'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: CREAR PROMOCIÓN */}
      <Dialog open={showPromoModal} onOpenChange={setShowPromoModal}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Zap className="h-6 w-6 text-orange-600" />
              Crear Promoción
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-lg font-semibold">Nombre de la Promoción</Label>
              <Input
                value={promoForm.name}
                onChange={(e) => setPromoForm({ ...promoForm, name: e.target.value })}
                placeholder="Ej: Viernes de Sándwiches 🥪"
                className="h-14 text-lg mt-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-base font-semibold">Tipo de Descuento</Label>
                <Select
                  value={promoForm.discount_type}
                  onValueChange={(v: 'percentage' | 'fixed') => setPromoForm({ ...promoForm, discount_type: v })}
                >
                  <SelectTrigger className="h-12 mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                    <SelectItem value="fixed">Monto Fijo (S/)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-base font-semibold">Valor</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={promoForm.discount_value}
                  onChange={(e) => setPromoForm({ ...promoForm, discount_value: parseFloat(e.target.value) })}
                  placeholder={promoForm.discount_type === 'percentage' ? '20' : '5.00'}
                  className="h-12 text-2xl font-bold text-orange-600 mt-2"
                />
              </div>
            </div>

            <div>
              <Label className="text-base font-semibold">Aplica a</Label>
              <Select
                value={promoForm.applies_to}
                onValueChange={(v: 'product' | 'category' | 'all') => 
                  setPromoForm({ ...promoForm, applies_to: v, target_ids: [] })
                }
              >
                <SelectTrigger className="h-12 mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🎯 Todos los Productos</SelectItem>
                  <SelectItem value="category">📁 Categoría Específica</SelectItem>
                  <SelectItem value="product">📦 Productos Específicos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {promoForm.applies_to === 'category' && (
              <div className="space-y-3">
                {/* Buscador de categorías */}
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="🔍 Buscar categorías..."
                    value={promoSearchQuery}
                    onChange={(e) => setPromoSearchQuery(e.target.value)}
                    className="h-12 text-base pl-4 pr-10"
                  />
                  {promoSearchQuery && (
                    <button
                      onClick={() => setPromoSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Grid de categorías filtradas */}
                {filteredCategories.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm border-2 border-dashed rounded-lg">
                    No se encontraron categorías con "{promoSearchQuery}"
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {filteredCategories.map(cat => (
                      <Button
                        key={cat}
                        type="button"
                        variant={promoForm.target_ids.includes(cat) ? 'default' : 'outline'}
                        className="h-12"
                        onClick={() => {
                          if (promoForm.target_ids.includes(cat)) {
                            setPromoForm({ ...promoForm, target_ids: promoForm.target_ids.filter(id => id !== cat) });
                          } else {
                            setPromoForm({ ...promoForm, target_ids: [...promoForm.target_ids, cat] });
                          }
                        }}
                      >
                        {getCategoryEmoji(cat)} <span className="capitalize ml-2">{cat}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {promoForm.applies_to === 'product' && (
              <div className="space-y-3">
                {/* Buscador de productos */}
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="🔍 Buscar productos..."
                    value={promoSearchQuery}
                    onChange={(e) => setPromoSearchQuery(e.target.value)}
                    className="h-12 text-base pl-4 pr-10"
                  />
                  {promoSearchQuery && (
                    <button
                      onClick={() => setPromoSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Lista de productos filtrados */}
                {filteredPromoProducts.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm border-2 border-dashed rounded-lg">
                    No se encontraron productos con "{promoSearchQuery}"
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                    {filteredPromoProducts.map(prod => (
                      <Button
                        key={prod.id}
                        type="button"
                        variant={promoForm.target_ids.includes(prod.id) ? 'default' : 'ghost'}
                        className="w-full justify-start h-10"
                        onClick={() => {
                          if (promoForm.target_ids.includes(prod.id)) {
                            setPromoForm({ ...promoForm, target_ids: promoForm.target_ids.filter(id => id !== prod.id) });
                          } else {
                            setPromoForm({ ...promoForm, target_ids: [...promoForm.target_ids, prod.id] });
                          }
                        }}
                      >
                        {getCategoryEmoji(prod.category)} {prod.name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Selector de Sedes */}
            <div className="border-2 border-dashed rounded-xl p-4 bg-blue-50">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-5 w-5 text-blue-600" />
                <Label className="text-base font-semibold">¿En qué sedes aplicará?</Label>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Checkbox
                  checked={promoForm.applyToAllSchools}
                  onCheckedChange={(checked) => 
                    setPromoForm({ ...promoForm, applyToAllSchools: checked as boolean })
                  }
                />
                <Label className="text-sm">Todas las sedes</Label>
              </div>
              {!promoForm.applyToAllSchools && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {schools.map(school => (
                    <div key={school.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={promoForm.school_ids.includes(school.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setPromoForm({ ...promoForm, school_ids: [...promoForm.school_ids, school.id] });
                          } else {
                            setPromoForm({ ...promoForm, school_ids: promoForm.school_ids.filter(id => id !== school.id) });
                          }
                        }}
                      />
                      <Label className="text-sm">{school.name}</Label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={savePromotion} className="w-full h-14 text-lg bg-gradient-to-r from-orange-600 to-red-600">
              <Sparkles className="h-5 w-5 mr-2" />
              Crear Promoción
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
