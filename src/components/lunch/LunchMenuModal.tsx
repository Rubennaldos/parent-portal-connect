import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, Tag, Settings2, Plus, Trash2, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Interfaces para modificadores ──
interface ModifierOption {
  id?: string;
  name: string;
  is_default: boolean;
  display_order: number;
}

interface ModifierGroup {
  id?: string;
  name: string;
  is_required: boolean;
  max_selections: number;
  display_order: number;
  options: ModifierOption[];
}

interface School {
  id: string;
  name: string;
  color?: string;
}

interface LunchMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuId?: string | null;
  initialDate?: Date;
  schools: School[];
  userSchoolId?: string | null;
  onSuccess: () => void;
  preSelectedCategoryId?: string; // Nueva prop desde wizard
  preSelectedTargetType?: 'students' | 'teachers' | 'both'; // Nueva prop desde wizard
  preSelectedCategoryName?: string; // Nueva prop desde wizard
}

export const LunchMenuModal = ({
  isOpen,
  onClose,
  menuId,
  initialDate,
  schools,
  userSchoolId,
  onSuccess,
  preSelectedCategoryId,
  preSelectedTargetType,
  preSelectedCategoryName,
}: LunchMenuModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [isKitchenProduct, setIsKitchenProduct] = useState(false);
  const [categoryToppings, setCategoryToppings] = useState<Array<{name: string, price: number}>>([]);
  const [allowsModifiers, setAllowsModifiers] = useState(false);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [savedMenuId, setSavedMenuId] = useState<string | null>(menuId || null);
  const [formData, setFormData] = useState({
    school_id: userSchoolId || '',
    date: initialDate ? initialDate.toISOString().split('T')[0] : '',
    starter: '',
    main_course: '',
    beverage: '',
    dessert: '',
    notes: '',
    category_id: preSelectedCategoryId || '',
    target_type: preSelectedTargetType || 'students',
    // Campos para productos de cocina
    product_name: '',
    product_price: '',
  });

  // Cargar datos del menú si es edición o inicializar formulario para creación
  useEffect(() => {
    if (!isOpen) return;
    
    if (menuId) {
      // Modo edición: cargar datos del menú
      loadMenuData();
    } else {
      // Modo creación: resetear formulario con datos del wizard
      console.log('🎨 Inicializando nuevo menú con datos del wizard:', {
        preSelectedCategoryId,
        preSelectedTargetType,
        preSelectedCategoryName
      });
      
      setFormData({
        school_id: userSchoolId || '',
        date: initialDate ? initialDate.toISOString().split('T')[0] : '',
        starter: '',
        main_course: '',
        beverage: '',
        dessert: '',
        notes: '',
        category_id: preSelectedCategoryId || '',
        target_type: preSelectedTargetType || 'students',
        product_name: '',
        product_price: '',
      });
      
      // Verificar si es una categoría de venta de cocina
      if (preSelectedCategoryId) {
        checkIfKitchenCategory(preSelectedCategoryId);
      }
    }
  }, [menuId, isOpen, preSelectedCategoryId]);

  const checkIfKitchenCategory = async (categoryId: string) => {
    try {
      const { data, error } = await supabase
        .from('lunch_categories')
        .select('is_kitchen_sale, target_type')
        .eq('id', categoryId)
        .single();

      if (error) throw error;
      setIsKitchenProduct(data?.is_kitchen_sale === true);
      
      // FIXED: Auto-set target_type from category to prevent mismatches
      if (data?.target_type) {
        setFormData(prev => ({ ...prev, target_type: data.target_type }));
        console.log('🎯 [LunchMenuModal] target_type auto-set from category:', data.target_type);
      }
      
      // Cargar toppings de la categoría
      if (!data?.is_kitchen_sale) {
        loadCategoryToppings(categoryId);
      } else {
        setCategoryToppings([]);
      }
    } catch (error) {
      console.error('Error checking category type:', error);
      setIsKitchenProduct(false);
      setCategoryToppings([]);
    }
  };

  const loadCategoryToppings = async (categoryId: string) => {
    try {
      const { data, error } = await supabase
        .from('lunch_category_addons')
        .select('name, price')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;
      setCategoryToppings(data || []);
    } catch (error) {
      console.error('Error loading category toppings:', error);
      setCategoryToppings([]);
    }
  };

  const loadMenuData = async () => {
    if (!menuId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lunch_menus')
        .select('*')
        .eq('id', menuId)
        .single();

      if (error) throw error;

      setFormData({
        school_id: data.school_id,
        date: data.date,
        starter: data.starter || '',
        main_course: data.main_course || '',
        beverage: data.beverage || '',
        dessert: data.dessert || '',
        notes: data.notes || '',
        category_id: data.category_id || '',
        target_type: data.target_type || 'students',
        product_name: data.product_name || '',
        product_price: data.product_price?.toString() || '',
      });

      // Cargar estado de modificadores
      setAllowsModifiers(data.allows_modifiers === true);
      setSavedMenuId(menuId);
      if (data.allows_modifiers) {
        await loadModifierGroups(menuId);
      }
    } catch (error) {
      console.error('Error loading menu:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar el menú',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Cargar grupos de modificadores existentes ──
  const loadModifierGroups = async (mId: string) => {
    try {
      const { data: groups, error } = await supabase
        .from('menu_modifier_groups')
        .select('id, name, is_required, max_selections, display_order')
        .eq('menu_id', mId)
        .order('display_order', { ascending: true });

      if (error) throw error;
      if (!groups || groups.length === 0) {
        setModifierGroups([]);
        return;
      }

      // Cargar opciones para cada grupo
      const groupIds = groups.map(g => g.id);
      const { data: options, error: optError } = await supabase
        .from('menu_modifier_options')
        .select('id, group_id, name, is_default, display_order')
        .in('group_id', groupIds)
        .order('display_order', { ascending: true });

      if (optError) throw optError;

      const groupsWithOptions: ModifierGroup[] = groups.map(g => ({
        ...g,
        options: (options || []).filter(o => o.group_id === g.id),
      }));

      setModifierGroups(groupsWithOptions);
    } catch (error) {
      console.error('Error loading modifier groups:', error);
    }
  };

  // ── Agregar un grupo de modificadores ──
  const addModifierGroup = () => {
    setModifierGroups(prev => [
      ...prev,
      {
        name: '',
        is_required: true,
        max_selections: 1,
        display_order: prev.length,
        options: [{ name: '', is_default: true, display_order: 0 }],
      },
    ]);
  };

  // ── Eliminar un grupo ──
  const removeModifierGroup = async (index: number) => {
    const group = modifierGroups[index];
    if (group.id) {
      // Eliminar de la BD
      await supabase.from('menu_modifier_groups').delete().eq('id', group.id);
    }
    setModifierGroups(prev => prev.filter((_, i) => i !== index));
  };

  // ── Actualizar un grupo ──
  const updateModifierGroup = (index: number, field: string, value: any) => {
    setModifierGroups(prev => prev.map((g, i) => i === index ? { ...g, [field]: value } : g));
  };

  // ── Agregar opción a un grupo ──
  const addOptionToGroup = (groupIndex: number) => {
    setModifierGroups(prev => prev.map((g, i) => {
      if (i !== groupIndex) return g;
      return {
        ...g,
        options: [...g.options, { name: '', is_default: false, display_order: g.options.length }],
      };
    }));
  };

  // ── Eliminar opción de un grupo ──
  const removeOptionFromGroup = async (groupIndex: number, optionIndex: number) => {
    const option = modifierGroups[groupIndex]?.options[optionIndex];
    if (option?.id) {
      await supabase.from('menu_modifier_options').delete().eq('id', option.id);
    }
    setModifierGroups(prev => prev.map((g, i) => {
      if (i !== groupIndex) return g;
      return { ...g, options: g.options.filter((_, oi) => oi !== optionIndex) };
    }));
  };

  // ── Actualizar opción ──
  const updateOption = (groupIndex: number, optionIndex: number, field: string, value: any) => {
    setModifierGroups(prev => prev.map((g, gi) => {
      if (gi !== groupIndex) return g;
      return {
        ...g,
        options: g.options.map((o, oi) => {
          if (oi !== optionIndex) return field === 'is_default' && value ? { ...o, is_default: false } : o;
          return { ...o, [field]: value };
        }),
      };
    }));
  };

  // ── Guardar modificadores en la BD ──
  const saveModifiers = async (menuIdToSave: string) => {
    if (!allowsModifiers || modifierGroups.length === 0) return;

    for (const group of modifierGroups) {
      if (!group.name.trim()) continue;

      let groupId = group.id;

      if (groupId) {
        // Actualizar grupo existente
        await supabase.from('menu_modifier_groups').update({
          name: group.name.trim(),
          is_required: group.is_required,
          max_selections: group.max_selections,
          display_order: group.display_order,
        }).eq('id', groupId);
      } else {
        // Crear nuevo grupo
        const { data: newGroup, error } = await supabase
          .from('menu_modifier_groups')
          .insert({
            menu_id: menuIdToSave,
            name: group.name.trim(),
            is_required: group.is_required,
            max_selections: group.max_selections,
            display_order: group.display_order,
          })
          .select('id')
          .single();

        if (error) {
          console.error('Error creating modifier group:', error);
          continue;
        }
        groupId = newGroup.id;
      }

      // Guardar opciones del grupo
      for (const option of group.options) {
        if (!option.name.trim()) continue;

        if (option.id) {
          await supabase.from('menu_modifier_options').update({
            name: option.name.trim(),
            is_default: option.is_default,
            display_order: option.display_order,
          }).eq('id', option.id);
        } else {
          await supabase.from('menu_modifier_options').insert({
            group_id: groupId,
            name: option.name.trim(),
            is_default: option.is_default,
            display_order: option.display_order,
          });
        }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validación diferente según el tipo
    if (isKitchenProduct) {
      // Para productos de cocina: nombre y precio obligatorios
      if (!formData.school_id || !formData.date || !formData.product_name.trim() || !formData.product_price) {
        toast({
          title: 'Campos incompletos',
          description: 'Por favor completa la sede, fecha, nombre del producto y precio',
          variant: 'destructive',
        });
        return;
      }
    } else {
      // Para menús normales: segundo plato obligatorio
      if (!formData.school_id || !formData.date || !formData.main_course.trim()) {
        toast({
          title: 'Campos incompletos',
          description: 'Por favor completa la sede, fecha y segundo plato',
          variant: 'destructive',
        });
        return;
      }
    }

    console.log('📝 FormData al guardar:', formData);

    setLoading(true);
    try {
      // 1. Guardar platos en la librería para futuro autocomplete (solo si NO es producto de cocina)
      if (!isKitchenProduct) {
        const libraryPromises = [
          supabase.rpc('upsert_lunch_item', { p_type: 'entrada', p_name: formData.starter.trim() }),
          supabase.rpc('upsert_lunch_item', { p_type: 'segundo', p_name: formData.main_course.trim() }),
          supabase.rpc('upsert_lunch_item', { p_type: 'bebida', p_name: formData.beverage.trim() }),
          supabase.rpc('upsert_lunch_item', { p_type: 'postre', p_name: formData.dessert.trim() }),
        ];
        await Promise.all(libraryPromises);
      }

      // 2. Guardar el menú/producto
      const payload: any = {
        school_id: formData.school_id,
        date: formData.date,
        created_by: user?.id,
      };

      if (isKitchenProduct) {
        // Es un producto de cocina
        payload.is_kitchen_product = true;
        payload.product_name = formData.product_name.trim();
        payload.product_price = parseFloat(formData.product_price);
        payload.main_course = formData.product_name.trim(); // Por compatibilidad
        payload.starter = null;
        payload.beverage = null;
        payload.dessert = null;
        payload.notes = formData.notes.trim() || null;
      } else {
        // Es un menú normal
        payload.is_kitchen_product = false;
        payload.starter = formData.starter.trim() || null;
        payload.main_course = formData.main_course.trim();
        payload.beverage = formData.beverage.trim() || null;
        payload.dessert = formData.dessert.trim() || null;
        payload.notes = formData.notes.trim() || null;
        payload.product_name = null;
        payload.product_price = null;
      }

      // Agregar category_id y target_type
      // FIXED: Siempre heredar target_type de la categoría para evitar desincronización
      if (formData.category_id && formData.category_id.trim() !== '') {
        payload.category_id = formData.category_id;
        
        // Consultar el target_type real de la categoría para asegurar consistencia
        const { data: catData } = await supabase
          .from('lunch_categories')
          .select('target_type')
          .eq('id', formData.category_id)
          .single();
        
        payload.target_type = catData?.target_type || formData.target_type || 'students';
        console.log('🎯 [Save] target_type from category:', payload.target_type);
      } else {
        // Si no hay categoría, asegurarse de que sean null explícitamente
        payload.category_id = null;
        payload.target_type = 'both'; // Sin categoría = visible para todos
      }

      // Agregar allows_modifiers al payload (solo para menús normales)
      if (!isKitchenProduct) {
        payload.allows_modifiers = allowsModifiers;
      }

      if (menuId) {
        // Actualizar
        const { error } = await supabase
          .from('lunch_menus')
          .update(payload)
          .eq('id', menuId);

        if (error) throw error;

        // Guardar modificadores si están habilitados
        if (allowsModifiers) {
          await saveModifiers(menuId);
        }

        toast({
          title: isKitchenProduct ? 'Producto actualizado' : 'Menú actualizado',
          description: isKitchenProduct ? 'El producto se actualizó correctamente' : 'El menú se actualizó correctamente',
        });
      } else {
        // Crear
        const { data: newMenu, error } = await supabase
          .from('lunch_menus')
          .insert([payload])
          .select('id')
          .single();

        if (error) throw error;

        // Guardar modificadores si están habilitados
        if (allowsModifiers && newMenu) {
          await saveModifiers(newMenu.id);
        }

        toast({
          title: isKitchenProduct ? 'Producto creado' : 'Menú creado',
          description: isKitchenProduct
            ? 'El producto se creó correctamente'
            : allowsModifiers
              ? 'Menú creado con personalización habilitada ✨'
              : 'El menú se creó correctamente',
        });
      }

      onSuccess();
    } catch (error: any) {
      console.error('Error saving menu:', error);
      
      let errorMessage = isKitchenProduct ? 'No se pudo guardar el producto' : 'No se pudo guardar el menú';
      if (error.code === '23505') {
        errorMessage = 'Ya existe un menú/producto para esta sede en esta fecha';
      }

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!menuId) return;

    const confirmDelete = window.confirm('¿Estás seguro de eliminar este menú?');
    if (!confirmDelete) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('lunch_menus')
        .delete()
        .eq('id', menuId);

      if (error) throw error;

      toast({
        title: 'Menú eliminado',
        description: 'El menú se eliminó correctamente',
      });

      onSuccess();
    } catch (error) {
      console.error('Error deleting menu:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el menú',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const formattedDate = initialDate ? format(initialDate, "EEEE d 'de' MMMM, yyyy", { locale: es }) : '';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5 text-green-600" />
            {menuId ? (isKitchenProduct ? 'Editar Producto de Cocina' : 'Editar Menú') : (isKitchenProduct ? 'Nuevo Producto de Cocina' : 'Nuevo Menú de Almuerzo')}
          </DialogTitle>
          <div className="space-y-2 pt-1">
            {formattedDate && (
              <p className="font-bold text-green-700 capitalize text-sm">{formattedDate}</p>
            )}
            {preSelectedCategoryName && (
              <div className="space-y-2">
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3 w-3" />
                  {preSelectedCategoryName} - {preSelectedTargetType === 'students' ? 'Alumnos' : 'Profesores'}
                </Badge>
                
                {/* Mostrar toppings disponibles */}
                {categoryToppings.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3">
                    <p className="text-xs font-semibold text-green-800 mb-2">✨ Toppings disponibles para esta categoría:</p>
                    <div className="flex flex-wrap gap-2">
                      {categoryToppings.map((topping, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs bg-green-100 text-green-700">
                          {topping.name} - S/ {topping.price.toFixed(2)}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-green-600 mt-2">Los usuarios podrán seleccionar estos toppings al hacer su pedido</p>
                  </div>
                )}
              </div>
            )}
            <DialogDescription>
              {isKitchenProduct 
                ? 'Configura el producto individual disponible en cocina (arroz, bebida, ensalada, etc.)'
                : 'Completa los platos del día. Solo el segundo es obligatorio.'
              }
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="school_id">Sede *</Label>
              <Select
                value={formData.school_id}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, school_id: value }))
                }
                disabled={loading || !!userSchoolId}
              >
                <SelectTrigger className="bg-muted/30">
                  <SelectValue placeholder="Selecciona una sede" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      <div className="flex items-center gap-2">
                        {school.color && (
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: school.color }}
                          />
                        )}
                        {school.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!initialDate && (
              <div>
                <Label htmlFor="date">Fecha *</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, date: e.target.value }))
                  }
                  disabled={loading}
                  required
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isKitchenProduct ? (
              // Formulario para productos de cocina
              <>
                <div>
                  <Label htmlFor="product_name">🍽️ Nombre del Producto *</Label>
                  <Input
                    id="product_name"
                    value={formData.product_name}
                    onChange={(e) => setFormData(p => ({ ...p, product_name: e.target.value }))}
                    placeholder="Ej: Arroz blanco, Ensalada verde, Refresco"
                    disabled={loading}
                    className="mt-2"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="product_price">💰 Precio (S/) *</Label>
                  <Input
                    id="product_price"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.product_price}
                    onChange={(e) => setFormData(p => ({ ...p, product_price: e.target.value }))}
                    placeholder="0.00"
                    disabled={loading}
                    className="mt-2"
                    required
                  />
                </div>
              </>
            ) : (
              // Formulario para menús normales
              <>
                <div>
                  <Label htmlFor="starter">🥗 Entrada</Label>
                  <Input
                    id="starter"
                    value={formData.starter}
                    onChange={(e) => setFormData(p => ({ ...p, starter: e.target.value }))}
                    placeholder="Ej: Ensalada de verduras frescas"
                    disabled={loading}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="main_course">🍲 Segundo Plato *</Label>
                  <Input
                    id="main_course"
                    value={formData.main_course}
                    onChange={(e) => setFormData(p => ({ ...p, main_course: e.target.value }))}
                    placeholder="Ej: Arroz con pollo"
                    disabled={loading}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="beverage">🥤 Bebida</Label>
                  <Input
                    id="beverage"
                    value={formData.beverage}
                    onChange={(e) => setFormData(p => ({ ...p, beverage: e.target.value }))}
                    placeholder="Ej: Refresco de maracuyá"
                    disabled={loading}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="dessert">🍰 Postre</Label>
                  <Input
                    id="dessert"
                    value={formData.dessert}
                    onChange={(e) => setFormData(p => ({ ...p, dessert: e.target.value }))}
                    placeholder="Ej: Gelatina de fresa"
                    disabled={loading}
                    className="mt-2"
                  />
                </div>
              </>
            )}
          </div>

          <div>
            <Label htmlFor="notes">📝 Notas adicionales</Label>
            <Textarea
              id="notes"
              placeholder="Observaciones, alergias, etc."
              value={formData.notes}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, notes: e.target.value }))
              }
              disabled={loading}
              rows={3}
              className="mt-2"
            />
          </div>

          {/* ── Sección de Personalización (solo menús normales) ── */}
          {!isKitchenProduct && (
            <div className="border rounded-lg p-4 space-y-4 bg-gradient-to-r from-purple-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-purple-600" />
                  <div>
                    <Label className="text-sm font-semibold text-purple-900">
                      Permitir personalización
                    </Label>
                    <p className="text-xs text-purple-600">
                      Los padres podrán cambiar componentes del menú (sin cambio de precio)
                    </p>
                  </div>
                </div>
                <Switch
                  checked={allowsModifiers}
                  onCheckedChange={setAllowsModifiers}
                  disabled={loading}
                />
              </div>

              {allowsModifiers && (
                <div className="space-y-3 pt-2 border-t border-purple-200">
                  <p className="text-xs text-purple-700 font-medium">
                    Configura los grupos de opciones. Ej: "Proteína" → Pollo, Pescado, Res
                  </p>

                  {modifierGroups.map((group, gi) => (
                    <div key={gi} className="bg-white rounded-lg border border-purple-200 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-gray-400" />
                        <Input
                          placeholder="Nombre del grupo (ej: Proteína)"
                          value={group.name}
                          onChange={(e) => updateModifierGroup(gi, 'name', e.target.value)}
                          className="text-sm font-semibold flex-1"
                          disabled={loading}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeModifierGroup(gi)}
                          className="text-red-500 hover:text-red-700 h-8 w-8 p-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Opciones del grupo */}
                      <div className="pl-6 space-y-1">
                        {group.options.map((option, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`default-${gi}`}
                              checked={option.is_default}
                              onChange={() => updateOption(gi, oi, 'is_default', true)}
                              className="text-purple-600"
                              title="Marcar como opción por defecto"
                            />
                            <Input
                              placeholder="Nombre de opción (ej: Pollo)"
                              value={option.name}
                              onChange={(e) => updateOption(gi, oi, 'name', e.target.value)}
                              className="text-sm flex-1 h-8"
                              disabled={loading}
                            />
                            {group.options.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeOptionFromGroup(gi, oi)}
                                className="text-red-400 hover:text-red-600 h-6 w-6 p-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => addOptionToGroup(gi)}
                          className="text-purple-600 hover:text-purple-800 h-7 text-xs"
                        >
                          <Plus className="h-3 w-3 mr-1" /> Agregar opción
                        </Button>
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addModifierGroup}
                    className="w-full border-dashed border-purple-300 text-purple-700 hover:bg-purple-50"
                  >
                    <Plus className="h-4 w-4 mr-2" /> Agregar grupo de personalización
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-4 border-t">
            {menuId && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Eliminar'
                )}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : menuId ? (
                'Actualizar'
              ) : (
                isKitchenProduct ? 'Crear Producto' : 'Crear Menú'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
