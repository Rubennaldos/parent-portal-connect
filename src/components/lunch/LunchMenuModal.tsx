import { useState, useEffect } from 'react';
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
import { Loader2, Save, Tag, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Configuración por campo (switch + alternativas) ──
interface FieldConfig {
  isCustomizable: boolean;   // Switch: los padres pueden elegir/quitar este componente
  extras: string[];          // Opciones alternativas añadidas con "+"
  groupId?: string;          // ID del grupo existente en BD (para updates)
}

const FIELD_DEFAULT: FieldConfig = { isCustomizable: false, extras: [], groupId: undefined };

// Mapeo: clave interna → nombre visible en BD
const FIELD_LABELS: Record<string, string> = {
  starter: 'Entrada',
  main_course: 'Segundo Plato',
  beverage: 'Bebida',
  dessert: 'Postre',
};
const FIELD_ORDER: Record<string, number> = {
  starter: 0, main_course: 1, beverage: 2, dessert: 3,
};

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
  preSelectedCategoryId?: string;
  preSelectedTargetType?: 'students' | 'teachers' | 'both';
  preSelectedCategoryName?: string;
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
  const [categoryTypeResolved, setCategoryTypeResolved] = useState(false); // Evita flash visual
  const [isKitchenProduct, setIsKitchenProduct] = useState(false);
  const [isConfigurablePlate, setIsConfigurablePlate] = useState(false); // 🍽️ Plato Configurable
  const [configurableGroups, setConfigurableGroups] = useState<Array<{ name: string; options: string[] }>>([]);
  const [categoryToppings, setCategoryToppings] = useState<Array<{name: string, price: number}>>([]);
  const [garnishesInput, setGarnishesInput] = useState(''); // Campo de texto simple: "Papas fritas, Ensalada extra, Salsa"

  // ── Estado de personalización por campo ──
  const [fieldConfigs, setFieldConfigs] = useState({
    starter:    { ...FIELD_DEFAULT },
    main_course: { ...FIELD_DEFAULT },
    beverage:   { ...FIELD_DEFAULT },
    dessert:    { ...FIELD_DEFAULT },
  });

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
    product_name: '',
    product_price: '',
  });

  // ─────────────────────────────────────────────────────
  // Helpers de estado para fieldConfigs
  // ─────────────────────────────────────────────────────
  const toggleFieldCustomizable = (field: keyof typeof fieldConfigs) => {
    setFieldConfigs(prev => ({
      ...prev,
      [field]: { ...prev[field], isCustomizable: !prev[field].isCustomizable },
    }));
  };

  const addFieldExtra = (field: keyof typeof fieldConfigs) => {
    setFieldConfigs(prev => ({
      ...prev,
      [field]: { ...prev[field], extras: [...prev[field].extras, ''] },
    }));
  };

  const updateFieldExtra = (field: keyof typeof fieldConfigs, idx: number, value: string) => {
    setFieldConfigs(prev => ({
      ...prev,
      [field]: {
        ...prev[field],
        extras: prev[field].extras.map((e, i) => i === idx ? value : e),
      },
    }));
  };

  const removeFieldExtra = (field: keyof typeof fieldConfigs, idx: number) => {
    setFieldConfigs(prev => ({
      ...prev,
      [field]: {
        ...prev[field],
        extras: prev[field].extras.filter((_, i) => i !== idx),
      },
    }));
  };

  // ─────────────────────────────────────────────────────
  // Computed: ¿hay personalización activa?
  // ─────────────────────────────────────────────────────
  const hasCustomization = Object.values(fieldConfigs).some(
    fc => fc.isCustomizable || fc.extras.length > 0
  );

  // ─────────────────────────────────────────────────────
  // useEffect: cargar datos al abrir
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    // ── SIEMPRE resetear estados de tipo de categoría al abrir ──
    // Esto evita que el estado "configurable" persista de una apertura anterior
    setIsKitchenProduct(false);
    setIsConfigurablePlate(false);
    setConfigurableGroups([]);
    setCategoryToppings([]);
    setCategoryTypeResolved(false); // Se resolverá cuando checkIfKitchenCategory termine

    if (menuId) {
      loadMenuData();
    } else {
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
      setFieldConfigs({
        starter:    { ...FIELD_DEFAULT },
        main_course: { ...FIELD_DEFAULT },
        beverage:   { ...FIELD_DEFAULT },
        dessert:    { ...FIELD_DEFAULT },
      });
      setGarnishesInput('');
      if (preSelectedCategoryId) {
        checkIfKitchenCategory(preSelectedCategoryId);
      } else {
        setCategoryTypeResolved(true); // No hay categoría que verificar
      }
    }
  }, [menuId, isOpen, preSelectedCategoryId]);

  // ─────────────────────────────────────────────────────
  // Verificar tipo de categoría
  // ─────────────────────────────────────────────────────
  const checkIfKitchenCategory = async (categoryId: string) => {
    try {
      const { data, error } = await supabase
        .from('lunch_categories')
        .select('is_kitchen_sale, target_type, menu_mode')
        .eq('id', categoryId)
        .single();
      if (error) throw error;
      setIsKitchenProduct(data?.is_kitchen_sale === true);
      const isConfigurable = data?.menu_mode === 'configurable';
      setIsConfigurablePlate(isConfigurable);
      if (data?.target_type) {
        setFormData(prev => ({ ...prev, target_type: data.target_type }));
      }
      if (!data?.is_kitchen_sale) {
        loadCategoryToppings(categoryId);
      } else {
        setCategoryToppings([]);
      }
      // Si es configurable, cargar los grupos de opciones para mostrar info
      if (isConfigurable) {
        loadConfigurableInfo(categoryId);
      } else {
        setConfigurableGroups([]);
      }
      setCategoryTypeResolved(true);
    } catch {
      setIsKitchenProduct(false);
      setIsConfigurablePlate(false);
      setCategoryToppings([]);
      setConfigurableGroups([]);
      setCategoryTypeResolved(true);
    }
  };

  const loadConfigurableInfo = async (categoryId: string) => {
    try {
      const { data: groups } = await supabase
        .from('configurable_plate_groups')
        .select('id, name')
        .eq('category_id', categoryId)
        .order('display_order', { ascending: true });

      if (groups && groups.length > 0) {
        const groupIds = groups.map(g => g.id);
        const { data: options } = await supabase
          .from('configurable_plate_options')
          .select('group_id, name')
          .in('group_id', groupIds)
          .eq('is_active', true)
          .order('display_order', { ascending: true });

        setConfigurableGroups(groups.map(g => ({
          name: g.name,
          options: (options || []).filter(o => o.group_id === g.id).map(o => o.name),
        })));
      } else {
        setConfigurableGroups([]);
      }
    } catch {
      setConfigurableGroups([]);
    }
  };

  const loadCategoryToppings = async (categoryId: string) => {
    try {
      const { data } = await supabase
        .from('lunch_category_addons')
        .select('name, price')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      setCategoryToppings(data || []);
    } catch {
      setCategoryToppings([]);
    }
  };

  // ─────────────────────────────────────────────────────
  // Cargar datos del menú (modo edición)
  // ─────────────────────────────────────────────────────
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

      // ── Determinar tipo de categoría (configurable, cocina, estándar) ──
      if (data.category_id) {
        await checkIfKitchenCategory(data.category_id);
      }

      // Cargar configuración de campos si tiene personalización
      if (data.allows_modifiers) {
        await loadFieldConfigs(menuId);
      } else {
        setFieldConfigs({
          starter:    { ...FIELD_DEFAULT },
          main_course: { ...FIELD_DEFAULT },
          beverage:   { ...FIELD_DEFAULT },
          dessert:    { ...FIELD_DEFAULT },
        });
      }

      // Cargar guarniciones
      const garnishes = (data.garnishes as string[]) || [];
      setGarnishesInput(garnishes.join(', '));
    } catch (error) {
      toast({ title: 'Error', description: 'No se pudo cargar el menú', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────
  // Cargar configuración de campos desde BD
  // ─────────────────────────────────────────────────────
  const loadFieldConfigs = async (mId: string) => {
    try {
      const { data: groups } = await supabase
        .from('menu_modifier_groups')
        .select('id, name, is_required')
        .eq('menu_id', mId);

      if (!groups?.length) return;

      const groupIds = groups.map(g => g.id);
      const { data: options } = await supabase
        .from('menu_modifier_options')
        .select('group_id, name, is_default, display_order')
        .in('group_id', groupIds)
        .order('display_order', { ascending: true });

      // Mapeo inverso: nombre del grupo → clave de campo
      const LABEL_TO_FIELD: Record<string, keyof typeof fieldConfigs> = {
        'Entrada': 'starter',
        'Segundo Plato': 'main_course',
        'Bebida': 'beverage',
        'Postre': 'dessert',
      };

      const newConfigs = {
        starter:    { ...FIELD_DEFAULT },
        main_course: { ...FIELD_DEFAULT },
        beverage:   { ...FIELD_DEFAULT },
        dessert:    { ...FIELD_DEFAULT },
      };

      for (const group of groups) {
        const fieldKey = LABEL_TO_FIELD[group.name];
        if (!fieldKey) continue;

        const groupOptions = (options || [])
          .filter(o => o.group_id === group.id)
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
          .map(o => o.name);

        // Primera opción = valor principal (ya en formData), el resto son extras
        newConfigs[fieldKey] = {
          isCustomizable: true, // Si hay un grupo, el campo es personalizable
          extras: groupOptions.slice(1),
          groupId: group.id,
        };
      }

      setFieldConfigs(newConfigs);
    } catch (error) {
      console.error('Error loading field configs:', error);
    }
  };

  // ─────────────────────────────────────────────────────
  // Guardar configuración de campos en BD
  // ─────────────────────────────────────────────────────
  const saveFieldModifiers = async (menuIdToSave: string) => {
    const fieldValues: Record<string, string> = {
      starter: formData.starter,
      main_course: formData.main_course,
      beverage: formData.beverage,
      dessert: formData.dessert,
    };

    for (const [fieldKey, config] of Object.entries(fieldConfigs)) {
      const hasCustomization = config.isCustomizable || config.extras.length > 0;

      if (!hasCustomization) {
        // Eliminar grupo existente si no hay personalización
        if (config.groupId) {
          await supabase.from('menu_modifier_groups').delete().eq('id', config.groupId);
        }
        continue;
      }

      const groupName = FIELD_LABELS[fieldKey];
      let groupId = config.groupId;

      if (groupId) {
        // Actualizar grupo existente
        await supabase.from('menu_modifier_groups').update({
          name: groupName,
          is_required: false, // siempre false: el padre puede omitir O elegir alternativa
          max_selections: 1,
          display_order: FIELD_ORDER[fieldKey] ?? 0,
        }).eq('id', groupId);

        // Borrar y recrear opciones
        await supabase.from('menu_modifier_options').delete().eq('group_id', groupId);
      } else {
        // Crear nuevo grupo
        const { data: newGroup, error: gErr } = await supabase
          .from('menu_modifier_groups')
          .insert({
            menu_id: menuIdToSave,
            name: groupName,
            is_required: false,
            max_selections: 1,
            display_order: FIELD_ORDER[fieldKey] ?? 0,
          })
          .select('id')
          .single();

        if (gErr || !newGroup) {
          console.error('Error creando grupo para campo', fieldKey, gErr);
          continue;
        }
        groupId = newGroup.id;
      }

      // Opciones: valor principal + extras
      const mainValue = fieldValues[fieldKey] || '';
      const allOptions = [mainValue, ...config.extras].filter(o => o.trim());

      for (let i = 0; i < allOptions.length; i++) {
        await supabase.from('menu_modifier_options').insert({
          group_id: groupId,
          name: allOptions[i].trim(),
          is_default: i === 0,
          display_order: i,
        });
      }
    }
  };

  // ─────────────────────────────────────────────────────
  // Guardar menú
  // ─────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isKitchenProduct) {
      if (!formData.school_id || !formData.date || !formData.product_name.trim() || !formData.product_price) {
        toast({ title: 'Campos incompletos', description: 'Completa sede, fecha, nombre del producto y precio', variant: 'destructive' });
        return;
      }
    } else if (isConfigurablePlate) {
      if (!formData.school_id || !formData.date) {
        toast({ title: 'Campos incompletos', description: 'Completa sede y fecha', variant: 'destructive' });
        return;
      }
    } else {
      if (!formData.school_id || !formData.date || !formData.main_course.trim()) {
        toast({ title: 'Campos incompletos', description: 'Completa sede, fecha y segundo plato', variant: 'destructive' });
        return;
      }
    }

    setLoading(true);
    try {
      if (!isKitchenProduct && !isConfigurablePlate) {
        await Promise.all([
          supabase.rpc('upsert_lunch_item', { p_type: 'entrada',  p_name: formData.starter.trim() }),
          supabase.rpc('upsert_lunch_item', { p_type: 'segundo',  p_name: formData.main_course.trim() }),
          supabase.rpc('upsert_lunch_item', { p_type: 'bebida',   p_name: formData.beverage.trim() }),
          supabase.rpc('upsert_lunch_item', { p_type: 'postre',   p_name: formData.dessert.trim() }),
        ]);
      }

      const payload: any = {
        school_id: formData.school_id,
        date: formData.date,
        created_by: user?.id,
      };

      if (isKitchenProduct) {
        payload.is_kitchen_product = true;
        payload.product_name = formData.product_name.trim();
        payload.product_price = parseFloat(formData.product_price);
        payload.main_course = formData.product_name.trim();
        payload.starter = null;
        payload.beverage = null;
        payload.dessert = null;
        payload.notes = formData.notes.trim() || null;
        payload.allows_modifiers = false;
      } else if (isConfigurablePlate) {
        // Plato configurable: no tiene entrada/segundo/bebida/postre fijos
        // El main_course se usa como nombre descriptivo del plato del día
        payload.is_kitchen_product = false;
        payload.main_course = formData.main_course.trim() || preSelectedCategoryName || 'Plato del día';
        payload.starter = null;
        payload.beverage = null;
        payload.dessert = null;
        payload.notes = formData.notes.trim() || null;
        payload.product_name = null;
        payload.product_price = null;
        payload.allows_modifiers = false; // Las opciones están en la categoría, no en modifiers
      } else {
        payload.is_kitchen_product = false;
        payload.starter = formData.starter.trim() || null;
        payload.main_course = formData.main_course.trim();
        payload.beverage = formData.beverage.trim() || null;
        payload.dessert = formData.dessert.trim() || null;
        payload.notes = formData.notes.trim() || null;
        payload.product_name = null;
        payload.product_price = null;
        payload.allows_modifiers = hasCustomization;
      }

      // category_id y target_type
      if (formData.category_id?.trim()) {
        payload.category_id = formData.category_id;
        const { data: catData } = await supabase
          .from('lunch_categories').select('target_type').eq('id', formData.category_id).single();
        payload.target_type = catData?.target_type || formData.target_type || 'students';
      } else {
        payload.category_id = null;
        payload.target_type = 'both';
      }

      // Guarniciones: convertir string separado por comas a array JSONB
      const garnishesArray = garnishesInput
        .split(',')
        .map(g => g.trim())
        .filter(g => g.length > 0);
      payload.garnishes = garnishesArray;

      if (menuId) {
        const { error } = await supabase.from('lunch_menus').update(payload).eq('id', menuId);
        if (error) throw error;

        if (!isConfigurablePlate && hasCustomization) {
          await saveFieldModifiers(menuId);
        } else if (!isConfigurablePlate) {
          // Limpiar grupos existentes si se desactivó toda personalización
          await supabase.from('menu_modifier_groups').delete().eq('menu_id', menuId);
        }

        toast({ title: 'Menú actualizado', description: 'Los cambios se guardaron correctamente' });
      } else {
        const { data: newMenu, error } = await supabase
          .from('lunch_menus').insert([payload]).select('id').single();
        if (error) throw error;

        if (!isConfigurablePlate && hasCustomization && newMenu) {
          await saveFieldModifiers(newMenu.id);
        }

        toast({
          title: isKitchenProduct ? 'Producto creado' : 'Menú creado',
          description: hasCustomization
            ? 'Menú creado con opciones de personalización ✨'
            : (isKitchenProduct ? 'Producto creado correctamente' : 'Menú creado correctamente'),
        });
      }

      onSuccess();
    } catch (error: any) {
      let msg = isKitchenProduct ? 'No se pudo guardar el producto' : 'No se pudo guardar el menú';
      if (error.code === '23505') {
        const catName = preSelectedCategoryName || 'esta categoría';
        msg = `Ya existe un menú para "${catName}" en esta sede y fecha. Edita el existente en lugar de crear uno nuevo.`;
      }
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!menuId) return;
    setLoading(true);
    try {
      // 1. Verificar si hay pedidos vinculados (activos o pasados)
      const { count: totalOrders } = await supabase
        .from('lunch_orders')
        .select('*', { count: 'exact', head: true })
        .eq('menu_id', menuId)
        .eq('is_cancelled', false);

      // 2. Mostrar advertencia apropiada y pedir confirmación
      let mensaje = '¿Estás seguro de eliminar este menú?';
      if (totalOrders && totalOrders > 0) {
        mensaje =
          `⚠️ Este menú tiene ${totalOrders} pedido(s) registrado(s).\n\n` +
          `Los pedidos existentes NO se eliminarán ni modificarán.\n` +
          `Solo se borrará el menú. Los pedidos pasados quedan intactos.\n\n` +
          `¿Estás seguro de continuar?`;
      }

      if (!window.confirm(mensaje)) {
        setLoading(false);
        return;
      }

      // 3. Eliminar solo las personalizaciones del menú (grupos y opciones)
      const { data: modifierGroups } = await supabase
        .from('menu_modifier_groups')
        .select('id')
        .eq('menu_id', menuId);

      if (modifierGroups && modifierGroups.length > 0) {
        const groupIds = modifierGroups.map(g => g.id);
        await supabase.from('menu_modifier_options').delete().in('group_id', groupIds);
        await supabase.from('menu_modifier_groups').delete().eq('menu_id', menuId);
      }

      // 4. Eliminar únicamente el menú — pedidos y transacciones NO se tocan
      const { error } = await supabase.from('lunch_menus').delete().eq('id', menuId);
      if (error) throw error;

      toast({ title: 'Menú eliminado', description: 'El menú se eliminó. Los pedidos existentes permanecen intactos.' });
      onSuccess();
    } catch {
      toast({ title: 'Error', description: 'No se pudo eliminar el menú', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────
  // Render helper: campo de menú con switch + opciones
  // ─────────────────────────────────────────────────────
  const renderMenuField = (
    fieldKey: keyof typeof fieldConfigs,
    emoji: string,
    labelText: string,
    placeholder: string,
    isRequired = false,
  ) => {
    const cfg = fieldConfigs[fieldKey];
    const totalOptions = cfg.extras.length + 1; // +1 por el valor principal

    return (
      <div className="space-y-1.5">
        {/* Fila: label + controles */}
        <div className="flex items-center justify-between">
          <Label htmlFor={fieldKey} className="text-sm font-medium">
            {emoji} {labelText} {isRequired && <span className="text-red-500">*</span>}
          </Label>
          <div className="flex items-center gap-2">
            {/* Switch "Activar opciones" */}
            <div className="flex items-center gap-1">
              <span className={`text-xs ${cfg.isCustomizable ? 'text-purple-600 font-semibold' : 'text-gray-400'}`}>
                {cfg.isCustomizable ? 'Personalizable' : 'Fijo'}
              </span>
              <Switch
                checked={cfg.isCustomizable}
                onCheckedChange={() => toggleFieldCustomizable(fieldKey)}
                disabled={loading}
                className="scale-[0.8]"
              />
            </div>
            {/* Botón + agregar alternativa */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => addFieldExtra(fieldKey)}
              disabled={loading}
              title="Agregar opción alternativa"
              className="h-7 w-7 p-0 rounded-full border border-green-300 text-green-600 hover:bg-green-50 hover:text-green-700 flex-shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Input principal */}
        <Input
          id={fieldKey}
          value={formData[fieldKey as keyof typeof formData] as string}
          onChange={(e) => setFormData(p => ({ ...p, [fieldKey]: e.target.value }))}
          placeholder={placeholder}
          disabled={loading}
          className={cfg.isCustomizable ? 'border-purple-200 bg-purple-50/30' : ''}
        />

        {/* Opciones alternativas */}
        {cfg.extras.length > 0 && (
          <div className="pl-3 border-l-2 border-purple-200 space-y-1.5 mt-1">
            <p className="text-xs text-purple-600 font-medium">Opción 1: {formData[fieldKey as keyof typeof formData] || `(${labelText} principal)`}</p>
            {cfg.extras.map((extra, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs text-purple-400 w-16 flex-shrink-0">Opción {idx + 2}:</span>
                <Input
                  value={extra}
                  onChange={(e) => updateFieldExtra(fieldKey, idx, e.target.value)}
                  placeholder={`Alternativa de ${labelText.toLowerCase()}`}
                  disabled={loading}
                  className="text-sm h-8 flex-1 border-purple-200"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFieldExtra(fieldKey, idx)}
                  disabled={loading}
                  className="h-6 w-6 p-0 text-red-400 hover:text-red-600 flex-shrink-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Indicador de estado */}
        {(cfg.isCustomizable || cfg.extras.length > 0) && (
          <p className="text-xs text-purple-500 pl-0.5">
            {cfg.extras.length === 0 && cfg.isCustomizable && `✓ Los padres pueden elegir o quitar ${labelText.toLowerCase()}`}
            {cfg.extras.length > 0 && `✓ ${totalOptions} opciones disponibles + pueden quitar`}
          </p>
        )}
      </div>
    );
  };

  const formattedDate = initialDate ? format(initialDate, "EEEE d 'de' MMMM, yyyy", { locale: es }) : '';

  // ─────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5 text-green-600" />
            {menuId
              ? (isKitchenProduct ? 'Editar Producto de Cocina' : isConfigurablePlate ? 'Editar Plato Configurable' : 'Editar Menú')
              : (isKitchenProduct ? 'Nuevo Producto de Cocina' : isConfigurablePlate ? 'Nuevo Plato Configurable' : 'Nuevo Menú de Almuerzo')}
          </DialogTitle>
          <div className="space-y-2 pt-1">
            {formattedDate && (
              <p className="font-bold text-green-700 capitalize text-sm">{formattedDate}</p>
            )}
            {preSelectedCategoryName && (
              <div className="space-y-2">
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3 w-3" />
                  {preSelectedCategoryName} — {preSelectedTargetType === 'students' ? 'Alumnos' : preSelectedTargetType === 'teachers' ? 'Profesores' : 'Todos'}
                </Badge>
                {categoryToppings.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3">
                    <p className="text-xs font-semibold text-green-800 mb-2">✨ Toppings disponibles:</p>
                    <div className="flex flex-wrap gap-2">
                      {categoryToppings.map((t, i) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-green-100 text-green-700">
                          {t.name} - S/ {t.price.toFixed(2)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogDescription>
              {isKitchenProduct
                ? 'Configura el producto individual disponible en cocina'
                : 'Activa el switch de un campo para que los padres puedan elegir o quitar ese componente. Usa + para agregar alternativas.'}
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Sede + Fecha */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="school_id">Sede *</Label>
              <Select
                value={formData.school_id}
                onValueChange={(v) => setFormData(p => ({ ...p, school_id: v }))}
                disabled={loading || !!userSchoolId}
              >
                <SelectTrigger className="bg-muted/30 mt-1">
                  <SelectValue placeholder="Selecciona una sede" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        {s.color && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />}
                        {s.name}
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
                  id="date" type="date" value={formData.date}
                  onChange={(e) => setFormData(p => ({ ...p, date: e.target.value }))}
                  disabled={loading} required className="mt-1"
                />
              </div>
            )}
          </div>

          {/* Formulario según tipo */}
          {(loading || !categoryTypeResolved) ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-green-500" />
              <span className="ml-2 text-sm text-muted-foreground">Cargando configuración...</span>
            </div>
          ) : isKitchenProduct ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="product_name">🍽️ Nombre del Producto *</Label>
                <Input
                  id="product_name" value={formData.product_name}
                  onChange={(e) => setFormData(p => ({ ...p, product_name: e.target.value }))}
                  placeholder="Ej: Arroz blanco, Ensalada verde"
                  disabled={loading} className="mt-1" required
                />
              </div>
              <div>
                <Label htmlFor="product_price">💰 Precio (S/) *</Label>
                <Input
                  id="product_price" type="number" step="0.01" min="0.01"
                  value={formData.product_price}
                  onChange={(e) => setFormData(p => ({ ...p, product_price: e.target.value }))}
                  placeholder="0.00" disabled={loading} className="mt-1" required
                />
              </div>
            </div>
          ) : isConfigurablePlate ? (
            /* ── Plato Configurable: form simplificado ── */
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🍽️</span>
                  <div>
                    <p className="font-semibold text-amber-900">Plato Configurable</p>
                    <p className="text-xs text-amber-700">Los padres elegirán sus opciones al pedir. Las opciones se configuran en la categoría.</p>
                  </div>
                </div>

                {/* Mostrar resumen de las opciones configuradas */}
                {configurableGroups.length > 0 ? (
                  <div className="space-y-2 mt-2">
                    {configurableGroups.map((g, i) => (
                      <div key={i} className="bg-white rounded-lg p-2.5 border border-amber-200">
                        <p className="text-sm font-semibold text-amber-800">{g.name}:</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {g.options.map((opt, oi) => (
                            <Badge key={oi} variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                              {opt}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700">
                    ⚠️ No se han configurado opciones para esta categoría. Ve a <strong>Gestionar Categorías → ⚙️</strong> para agregar opciones.
                  </div>
                )}
              </div>

              {/* Nombre del plato del día (opcional pero útil) */}
              <div>
                <Label htmlFor="main_course">🍲 Nombre del plato del día (opcional)</Label>
                <Input
                  id="main_course"
                  value={formData.main_course}
                  onChange={(e) => setFormData(p => ({ ...p, main_course: e.target.value }))}
                  placeholder={`Ej: ${preSelectedCategoryName || 'Menú Light'} del día`}
                  disabled={loading}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Si lo dejas vacío, se usará el nombre de la categoría.
                </p>
              </div>
            </div>
          ) : (
            /* ── Menú normal: campos con switch + "+" integrados ── */
            <div className="space-y-4">
              {/* Indicación */}
              {hasCustomization && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 flex items-center gap-2">
                  <span className="text-sm text-purple-700 font-medium">✨ Este menú tiene personalización activa</span>
                  <span className="text-xs text-purple-500">— Los padres elegirán al pedir</span>
                </div>
              )}

              {renderMenuField('starter', '🥗', 'Entrada', 'Ej: Ensalada de verduras frescas')}
              {renderMenuField('main_course', '🍲', 'Segundo Plato', 'Ej: Arroz con pollo', true)}
              {renderMenuField('beverage', '🥤', 'Bebida', 'Ej: Refresco de maracuyá')}
              {renderMenuField('dessert', '🍰', 'Postre', 'Ej: Gelatina de fresa')}
            </div>
          )}

          {/* Notas */}
          <div>
            <Label htmlFor="notes">📝 Notas adicionales</Label>
            <Textarea
              id="notes" placeholder="Observaciones, alergias, etc."
              value={formData.notes}
              onChange={(e) => setFormData(p => ({ ...p, notes: e.target.value }))}
              disabled={loading} rows={2} className="mt-1"
            />
          </div>

          {/* Guarniciones (solo para menús normales, no configurables ni cocina) */}
          {!isKitchenProduct && !isConfigurablePlate && (
            <div>
              <Label htmlFor="garnishes">🍟 Guarniciones opcionales</Label>
              <Input
                id="garnishes"
                value={garnishesInput}
                onChange={(e) => setGarnishesInput(e.target.value)}
                placeholder="Ej: Papas fritas, Ensalada extra, Salsa extra"
                disabled={loading}
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Separa las guarniciones con comas. Los padres podrán seleccionarlas al hacer el pedido.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-4 border-t">
            {menuId && (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Eliminar'}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700">
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Guardando...</>
              ) : menuId ? 'Actualizar' : (isKitchenProduct ? 'Crear Producto' : 'Crear Menú')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
