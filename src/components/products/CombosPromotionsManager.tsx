import { useState, useEffect } from 'react';
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
import { Plus, Trash2, Package, Percent, X, Check, ShoppingCart, Sparkles, Zap, Gift, Tag, Building2 } from 'lucide-react';
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
  
  const [comboForm, setComboForm] = useState<Combo>({
    name: '',
    combo_price: 0,
    products: [],
    school_ids: [],
    applyToAllSchools: true,
    active: true,
  });

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

  useEffect(() => {
    fetchProducts();
    fetchCombos();
    fetchPromotions();
    fetchSchools();
  }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').eq('active', true);
    setProducts(data || []);
    const cats = Array.from(new Set((data || []).map(p => p.category)));
    setCategories(cats);
  };

  const fetchSchools = async () => {
    const { data } = await supabase.from('schools').select('id, name').eq('is_active', true);
    setSchools(data || []);
  };

  const fetchCombos = async () => {
    try {
      const { data, error } = await supabase
        .from('combos')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching combos:', error);
        return;
      }

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

          return { ...combo, combo_items };
        })
      );

      setCombos(combosWithItems);
    } catch (error) {
      console.error('Error cargando combos:', error);
    }
  };

  const fetchPromotions = async () => {
    const { data } = await supabase
      .from('promotions')
      .select('*')
      .order('created_at', { ascending: false });
    setPromotions(data || []);
  };

  const addProductToCombo = () => {
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

    const selectedSchools = comboForm.applyToAllSchools ? schools.map(s => s.id) : comboForm.school_ids;

    if (selectedSchools.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona al menos una sede' });
      return;
    }

    try {
      const { data: combo, error: comboError } = await supabase
        .from('combos')
        .insert({ 
          name: comboForm.name, 
          combo_price: comboForm.combo_price, 
          active: comboForm.active,
          school_ids: selectedSchools
        })
        .select()
        .single();

      if (comboError) throw comboError;

      const items = comboForm.products.map(p => ({
        combo_id: combo.id,
        product_id: p.product_id,
        quantity: p.quantity,
      }));

      const { error: itemsError } = await supabase.from('combo_items').insert(items);
      if (itemsError) throw itemsError;

      toast({ title: '🎉 ¡Combo creado!', description: 'Listo para vender' });
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
      const { error } = await supabase.from('promotions').insert({
        ...promoForm,
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

  const togglePromoStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('promotions').update({ active: !currentStatus }).eq('id', id);
    if (!error) {
      toast({ title: currentStatus ? '⏸️ Promoción pausada' : '✅ Promoción activada' });
      fetchPromotions();
    }
  };

  const resetComboForm = () => {
    setComboForm({ 
      name: '', 
      combo_price: 0, 
      products: [], 
      school_ids: [],
      applyToAllSchools: true,
      active: true 
    });
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
  };

  // Emojis por categoría
  const getCategoryEmoji = (category: string) => {
    const map: any = {
      bebidas: '🥤', snacks: '🍪', menu: '🍽️', sandwiches: '🥪',
      postres: '🍰', frutas: '🍎', lacteos: '🥛', otros: '📦'
    };
    return map[category] || '📦';
  };

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

          {combos.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-16 text-center">
                <Gift className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No hay combos aún</h3>
                <p className="text-muted-foreground mb-4">Crea tu primer combo para aumentar ventas</p>
                <Button onClick={() => setShowComboModal(true)} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Crear Primer Combo
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {combos.map(combo => (
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
                      <Badge variant={combo.active ? 'default' : 'secondary'} className="text-xs">
                        {combo.active ? '✓ Activo' : '⏸ Pausado'}
                      </Badge>
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

          {promotions.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-16 text-center">
                <Percent className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No hay promociones aún</h3>
                <p className="text-muted-foreground mb-4">Crea descuentos para impulsar tus ventas</p>
                <Button onClick={() => setShowPromoModal(true)} variant="outline">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Crear Primera Promoción
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {promotions.map(promo => (
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
                            <Badge variant={promo.active ? 'default' : 'secondary'}>
                              {promo.active ? '✓ Activa' : '⏸ Pausada'}
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
      <Dialog open={showComboModal} onOpenChange={setShowComboModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Gift className="h-6 w-6 text-purple-600" />
              Crear Combo Especial
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
                </div>
                
                {comboForm.products.map((item, index) => (
                  <div key={index} className="flex gap-2 items-center p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <Select
                        value={item.product_id}
                        onValueChange={(v) => updateComboProduct(index, 'product_id', v)}
                      >
                        <SelectTrigger className="h-12">
                          <SelectValue placeholder="Selecciona producto" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {getCategoryEmoji(p.category)} {p.name} - S/ {p.price_sale}
                              {p.has_stock && ' 📦'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateComboProduct(index, 'quantity', parseInt(e.target.value))}
                      className="w-20 h-12 text-center text-lg font-bold"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-12 w-12"
                      onClick={() => removeProductFromCombo(index)}
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
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
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 text-4xl text-gray-400">S/</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={comboForm.combo_price}
                        onChange={(e) => setComboForm({ ...comboForm, combo_price: parseFloat(e.target.value) })}
                        className="h-20 text-5xl font-black pl-20 text-center bg-white border-4 border-purple-200"
                      />
                    </div>
                  </div>
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

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    ← Anterior
                  </Button>
                  <Button onClick={saveCombo} disabled={comboForm.combo_price <= 0} className="flex-1 h-14 text-lg bg-gradient-to-r from-purple-600 to-pink-600">
                    <Check className="h-5 w-5 mr-2" />
                    Guardar Combo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: CREAR PROMOCIÓN */}
      <Dialog open={showPromoModal} onOpenChange={setShowPromoModal}>
        <DialogContent className="max-w-2xl">
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
              <div className="grid grid-cols-2 gap-2">
                {categories.map(cat => (
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

            {promoForm.applies_to === 'product' && (
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                {products.map(prod => (
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
