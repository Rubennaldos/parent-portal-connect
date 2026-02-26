import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Utensils,
  Salad,
  Coins,
  Leaf,
  Briefcase,
  Sparkles,
  Plus,
  Edit,
  Trash2,
  Users,
  ArrowUp,
  ArrowDown,
  Save,
  X,
  Package
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AddonsManager } from './AddonsManager';

const AVAILABLE_ICONS = [
  { value: 'utensils', label: 'Cubiertos', icon: Utensils },
  { value: 'salad', label: 'Ensalada', icon: Salad },
  { value: 'coins', label: 'Monedas', icon: Coins },
  { value: 'leaf', label: 'Hoja', icon: Leaf },
  { value: 'briefcase', label: 'Maletín', icon: Briefcase },
  { value: 'sparkles', label: 'Estrellas', icon: Sparkles },
];

const AVAILABLE_COLORS = [
  { value: '#3B82F6', label: 'Azul' },
  { value: '#10B981', label: 'Verde' },
  { value: '#F59E0B', label: 'Naranja' },
  { value: '#EF4444', label: 'Rojo' },
  { value: '#8B5CF6', label: 'Púrpura' },
  { value: '#EC4899', label: 'Rosa' },
  { value: '#059669', label: 'Verde Oscuro' },
  { value: '#DC2626', label: 'Rojo Oscuro' },
];

interface LunchCategory {
  id: string;
  school_id: string;
  name: string;
  description: string | null;
  target_type: 'students' | 'teachers' | 'both';
  color: string;
  icon: string;
  price: number | null;
  is_active: boolean;
  display_order: number;
  is_kitchen_sale?: boolean;
  allows_addons?: boolean;
  menu_mode?: 'standard' | 'configurable';
}

interface ConfigurableGroup {
  id?: string;
  name: string;
  is_required: boolean;
  max_selections: number;
  display_order: number;
  options: ConfigurableOption[];
}

interface ConfigurableOption {
  id?: string;
  name: string;
  is_active: boolean;
  display_order: number;
}

interface CategoryManagerProps {
  schoolId: string;
  open: boolean;
  onClose: () => void;
}

export function CategoryManager({ schoolId, open, onClose }: CategoryManagerProps) {
  const { toast } = useToast();
  const [categories, setCategories] = useState<LunchCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingCategory, setEditingCategory] = useState<LunchCategory | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [managingAddonsForCategory, setManagingAddonsForCategory] = useState<LunchCategory | null>(null);
  const [addonsCount, setAddonsCount] = useState<Record<string, number>>({});

  // ── Estado para editor de Plato Configurable ──
  const [configuringCategory, setConfiguringCategory] = useState<LunchCategory | null>(null);
  const [configGroups, setConfigGroups] = useState<ConfigurableGroup[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);

  // Diálogos de confirmación con impacto
  const [deleteConfirmCategory, setDeleteConfirmCategory] = useState<LunchCategory | null>(null);
  const [toggleConfirmCategory, setToggleConfirmCategory] = useState<LunchCategory | null>(null);
  const [impactData, setImpactData] = useState<{ futureOrders: number; futureMenus: number } | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    target_type: 'students' as 'students' | 'teachers' | 'both',
    color: '#3B82F6',
    icon: 'utensils',
    price: '',
    is_active: true,
    menu_mode: 'standard' as 'standard' | 'configurable',
  });

  useEffect(() => {
    if (open) {
      fetchCategories();
    }
  }, [open, schoolId]);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lunch_categories')
        .select('*')
        .eq('school_id', schoolId)
        .order('display_order', { ascending: true });

      if (error) throw error;
      setCategories(data || []);
      
      // Cargar conteo de agregados para cada categoría
      if (data && data.length > 0) {
        const counts: Record<string, number> = {};
        for (const category of data) {
          if (!category.is_kitchen_sale) {
            const { count, error: countError } = await supabase
              .from('lunch_category_addons')
              .select('*', { count: 'exact', head: true })
              .eq('category_id', category.id)
              .eq('is_active', true);
            
            if (!countError && count !== null) {
              counts[category.id] = count;
            }
          }
        }
        setAddonsCount(counts);
      }
    } catch (error: any) {
      console.error('Error fetching categories:', error);
      toast({
        variant: 'destructive',
        title: 'Error al cargar categorías',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El nombre es obligatorio'
      });
      return;
    }

    if (!formData.price || parseFloat(formData.price) <= 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El precio es obligatorio y debe ser mayor a 0'
      });
      return;
    }

    setLoading(true);
    try {
      const categoryData = {
        school_id: schoolId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        target_type: formData.target_type,
        color: formData.color,
        icon: formData.icon,
        price: parseFloat(formData.price),
        is_active: formData.is_active,
        display_order: editingCategory ? editingCategory.display_order : categories.length,
        menu_mode: formData.menu_mode,
      };

      if (editingCategory) {
        // Actualizar
        const { error } = await supabase
          .from('lunch_categories')
          .update(categoryData)
          .eq('id', editingCategory.id);

        if (error) throw error;
        
        toast({
          title: '✅ Categoría actualizada',
          description: `"${formData.name}" se actualizó correctamente`
        });
      } else {
        // Crear nueva
        const { error } = await supabase
          .from('lunch_categories')
          .insert([categoryData]);

        if (error) throw error;
        
        toast({
          title: '✅ Categoría creada',
          description: `"${formData.name}" se creó correctamente`
        });
      }

      await fetchCategories();
      resetForm();
    } catch (error: any) {
      console.error('Error saving category:', error);
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (category: LunchCategory) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description || '',
      target_type: category.target_type,
      color: category.color,
      icon: category.icon,
      price: category.price?.toString() || '',
      is_active: category.is_active,
      menu_mode: category.menu_mode || 'standard',
    });
    setShowForm(true);
  };

  // Calcular el impacto de eliminar/desactivar una categoría
  const fetchImpact = async (category: LunchCategory) => {
    setLoadingImpact(true);
    setImpactData(null);
    try {
      const today = new Date().toISOString().split('T')[0];

      // Contar pedidos futuros activos de esta categoría
      const { count: ordersCount } = await supabase
        .from('lunch_orders')
        .select('*', { count: 'exact', head: true })
        .eq('category_id', category.id)
        .gte('order_date', today)
        .eq('is_cancelled', false);

      // Contar menús futuros de esta categoría
      const { count: menusCount } = await supabase
        .from('lunch_menus')
        .select('*', { count: 'exact', head: true })
        .eq('category_id', category.id)
        .gte('date', today);

      setImpactData({
        futureOrders: ordersCount || 0,
        futureMenus: menusCount || 0,
      });
    } catch (err) {
      console.error('Error calculando impacto:', err);
      setImpactData({ futureOrders: 0, futureMenus: 0 });
    } finally {
      setLoadingImpact(false);
    }
  };

  const handleDeleteClick = async (category: LunchCategory) => {
    setDeleteConfirmCategory(category);
    await fetchImpact(category);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmCategory) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('lunch_categories')
        .delete()
        .eq('id', deleteConfirmCategory.id);

      if (error) throw error;

      toast({
        title: '✅ Categoría eliminada',
        description: `"${deleteConfirmCategory.name}" se eliminó correctamente`
      });

      setDeleteConfirmCategory(null);
      setImpactData(null);
      await fetchCategories();
    } catch (error: any) {
      console.error('Error deleting category:', error);
      toast({
        variant: 'destructive',
        title: 'Error al eliminar',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActiveClick = async (category: LunchCategory) => {
    // Solo pedir confirmación si se está desactivando y hay pedidos futuros
    if (category.is_active) {
      setToggleConfirmCategory(category);
      await fetchImpact(category);
    } else {
      // Reactivar directamente, sin confirmación
      await doToggleActive(category);
    }
  };

  const doToggleActive = async (category: LunchCategory) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('lunch_categories')
        .update({ is_active: !category.is_active })
        .eq('id', category.id);

      if (error) throw error;

      await fetchCategories();
      toast({
        title: category.is_active ? '⚠️ Categoría desactivada' : '✅ Categoría activada',
        description: `"${category.name}" ahora está ${!category.is_active ? 'activa' : 'inactiva'}`
      });
    } catch (error: any) {
      console.error('Error toggling category:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const confirmToggleActive = async () => {
    if (!toggleConfirmCategory) return;
    await doToggleActive(toggleConfirmCategory);
    setToggleConfirmCategory(null);
    setImpactData(null);
  };

  const moveCategory = async (category: LunchCategory, direction: 'up' | 'down') => {
    const currentIndex = categories.findIndex(c => c.id === category.id);
    if (
      (direction === 'up' && currentIndex === 0) ||
      (direction === 'down' && currentIndex === categories.length - 1)
    ) {
      return;
    }

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const otherCategory = categories[newIndex];

    setLoading(true);
    try {
      await supabase
        .from('lunch_categories')
        .update({ display_order: otherCategory.display_order })
        .eq('id', category.id);

      await supabase
        .from('lunch_categories')
        .update({ display_order: category.display_order })
        .eq('id', otherCategory.id);

      await fetchCategories();
    } catch (error: any) {
      console.error('Error moving category:', error);
      toast({
        variant: 'destructive',
        title: 'Error al reordenar',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      target_type: 'students',
      color: '#3B82F6',
      icon: 'utensils',
      price: '',
      is_active: true,
      menu_mode: 'standard',
    });
    setEditingCategory(null);
    setShowForm(false);
  };

  const getIconComponent = (iconName: string) => {
    return AVAILABLE_ICONS.find(i => i.value === iconName)?.icon || Utensils;
  };

  // ── Funciones para editor de Plato Configurable ──
  const openConfigurableEditor = async (category: LunchCategory) => {
    setConfiguringCategory(category);
    setConfigGroups([]);

    // Cargar grupos existentes
    try {
      const { data: groups } = await supabase
        .from('configurable_plate_groups')
        .select('id, name, is_required, max_selections, display_order')
        .eq('category_id', category.id)
        .order('display_order', { ascending: true });

      if (groups && groups.length > 0) {
        const groupIds = groups.map(g => g.id);
        const { data: options } = await supabase
          .from('configurable_plate_options')
          .select('id, group_id, name, is_active, display_order')
          .in('group_id', groupIds)
          .order('display_order', { ascending: true });

        setConfigGroups(groups.map(g => ({
          ...g,
          options: (options || []).filter(o => o.group_id === g.id),
        })));
      } else {
        // Agregar un grupo por defecto
        setConfigGroups([{
          name: 'Proteína',
          is_required: true,
          max_selections: 1,
          display_order: 0,
          options: [{ name: '', is_active: true, display_order: 0 }],
        }]);
      }
    } catch (err) {
      console.error('Error loading configurable groups:', err);
    }
  };

  const addConfigGroup = () => {
    setConfigGroups(prev => [...prev, {
      name: '',
      is_required: true,
      max_selections: 1,
      display_order: prev.length,
      options: [{ name: '', is_active: true, display_order: 0 }],
    }]);
  };

  const removeConfigGroup = (idx: number) => {
    setConfigGroups(prev => prev.filter((_, i) => i !== idx));
  };

  const updateConfigGroup = (idx: number, field: string, value: any) => {
    setConfigGroups(prev => prev.map((g, i) => i === idx ? { ...g, [field]: value } : g));
  };

  const addConfigOption = (groupIdx: number) => {
    setConfigGroups(prev => prev.map((g, i) => i === groupIdx ? {
      ...g,
      options: [...g.options, { name: '', is_active: true, display_order: g.options.length }],
    } : g));
  };

  const removeConfigOption = (groupIdx: number, optIdx: number) => {
    setConfigGroups(prev => prev.map((g, i) => i === groupIdx ? {
      ...g,
      options: g.options.filter((_, oi) => oi !== optIdx),
    } : g));
  };

  const updateConfigOption = (groupIdx: number, optIdx: number, value: string) => {
    setConfigGroups(prev => prev.map((g, i) => i === groupIdx ? {
      ...g,
      options: g.options.map((o, oi) => oi === optIdx ? { ...o, name: value } : o),
    } : g));
  };

  const saveConfigurableGroups = async () => {
    if (!configuringCategory) return;

    // Validar
    const invalid = configGroups.some(g => !g.name.trim() || g.options.some(o => !o.name.trim()));
    if (invalid) {
      toast({ variant: 'destructive', title: 'Campos vacíos', description: 'Completa todos los nombres de grupos y opciones' });
      return;
    }

    if (configGroups.length === 0) {
      toast({ variant: 'destructive', title: 'Sin grupos', description: 'Agrega al menos un grupo de opciones' });
      return;
    }

    setSavingConfig(true);
    try {
      // Borrar grupos existentes (cascade borra opciones)
      await supabase.from('configurable_plate_groups').delete().eq('category_id', configuringCategory.id);

      // Insertar nuevos grupos y opciones
      for (let i = 0; i < configGroups.length; i++) {
        const group = configGroups[i];
        const { data: newGroup, error: gErr } = await supabase
          .from('configurable_plate_groups')
          .insert({
            category_id: configuringCategory.id,
            name: group.name.trim(),
            is_required: group.is_required,
            max_selections: group.max_selections,
            display_order: i,
          })
          .select('id')
          .single();

        if (gErr || !newGroup) {
          console.error('Error creating group:', gErr);
          continue;
        }

        // Insertar opciones
        const optionsToInsert = group.options
          .filter(o => o.name.trim())
          .map((o, oi) => ({
            group_id: newGroup.id,
            name: o.name.trim(),
            is_active: true,
            display_order: oi,
          }));

        if (optionsToInsert.length > 0) {
          await supabase.from('configurable_plate_options').insert(optionsToInsert);
        }
      }

      toast({ title: '✅ Opciones guardadas', description: `Se configuraron ${configGroups.length} grupo(s) de opciones para "${configuringCategory.name}"` });
      setConfiguringCategory(null);
    } catch (err: any) {
      console.error('Error saving configurable groups:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudieron guardar las opciones' });
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Gestionar Categorías de Almuerzos</DialogTitle>
          <DialogDescription>
            Crea y administra las diferentes categorías de almuerzos (Clásico, Light, Económico, etc.)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Botón para crear nueva categoría */}
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Crear Nueva Categoría
            </Button>
          )}

          {/* Formulario de crear/editar */}
          {showForm && (
            <Card>
              <CardHeader>
                <CardTitle>{editingCategory ? 'Editar Categoría' : 'Nueva Categoría'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nombre *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Ej: Almuerzo Clásico"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="target_type">Para quién *</Label>
                      <Select
                        value={formData.target_type}
                        onValueChange={(value: 'students' | 'teachers' | 'both') => {
                          setFormData(prev => ({ ...prev, target_type: value }));
                        }}
                      >
                        <SelectTrigger id="target_type">
                          <SelectValue placeholder="Selecciona..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="students">
                            <span className="flex items-center gap-2">
                              👨‍🎓 Alumnos
                            </span>
                          </SelectItem>
                          <SelectItem value="teachers">
                            <span className="flex items-center gap-2">
                              👨‍🏫 Profesores
                            </span>
                          </SelectItem>
                          <SelectItem value="both">
                            <span className="flex items-center gap-2">
                              👥 Ambos
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="description">Descripción</Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Descripción breve de esta categoría..."
                        rows={2}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="color">Color</Label>
                      <div className="flex gap-2">
                        {AVAILABLE_COLORS.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            onClick={() => setFormData({ ...formData, color: color.value })}
                            className={cn(
                              "w-10 h-10 rounded-full border-2 transition-all",
                              formData.color === color.value ? "border-black scale-110" : "border-gray-300"
                            )}
                            style={{ backgroundColor: color.value }}
                            title={color.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="icon">Icono</Label>
                      <div className="flex gap-2 flex-wrap">
                        {AVAILABLE_ICONS.map((icon) => {
                          const IconComponent = icon.icon;
                          return (
                            <button
                              key={icon.value}
                              type="button"
                              onClick={() => setFormData({ ...formData, icon: icon.value })}
                              className={cn(
                                "w-12 h-12 rounded-lg border-2 transition-all flex items-center justify-center",
                                formData.icon === icon.value ? "border-black bg-gray-100" : "border-gray-300"
                              )}
                              title={icon.label}
                            >
                              <IconComponent className="h-6 w-6" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="price">Precio (S/) <span className="text-red-500">*</span></Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        placeholder="15.00"
                        required
                      />
                      <p className="text-xs text-muted-foreground">El precio es obligatorio para cada categoría</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        id="is_active"
                        checked={formData.is_active}
                        onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                      />
                      <Label htmlFor="is_active">Categoría activa</Label>
                    </div>

                    <div className="md:col-span-2 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4 space-y-2">
                      <div className="flex items-center space-x-3">
                        <Switch
                          id="menu_mode"
                          checked={formData.menu_mode === 'configurable'}
                          onCheckedChange={(checked) => setFormData({ ...formData, menu_mode: checked ? 'configurable' : 'standard' })}
                        />
                        <div>
                          <Label htmlFor="menu_mode" className="text-base font-semibold text-amber-900">
                            🍽️ Plato Configurable
                          </Label>
                          <p className="text-xs text-amber-700 mt-0.5">
                            {formData.menu_mode === 'configurable'
                              ? 'Los padres eligen opciones (proteína, guarnición, etc.) en vez de ver un menú fijo.'
                              : 'Menú tradicional con Entrada, Segundo, Bebida y Postre.'}
                          </p>
                        </div>
                      </div>
                      {formData.menu_mode === 'configurable' && (
                        <p className="text-xs text-amber-600 ml-12">
                          ⚡ Después de guardar, usa el botón <strong>⚙️</strong> para configurar las opciones (Proteína, Guarnición, etc.)
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" disabled={loading} className="gap-2">
                      <Save className="h-4 w-4" />
                      {editingCategory ? 'Actualizar' : 'Crear'}
                    </Button>
                    <Button type="button" variant="outline" onClick={resetForm} disabled={loading} className="gap-2">
                      <X className="h-4 w-4" />
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Lista de categorías */}
          <Card>
            <CardHeader>
              <CardTitle>Categorías Existentes</CardTitle>
            </CardHeader>
            <CardContent>
              {loading && categories.length === 0 ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
                  <p className="text-gray-600 mt-4">Cargando...</p>
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Utensils className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No hay categorías creadas aún</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">Orden</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Para</TableHead>
                      <TableHead>Color/Icono</TableHead>
                      <TableHead>Precio</TableHead>
                      <TableHead>Toppings</TableHead>
                      <TableHead>Modo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((category, index) => {
                      const IconComponent = getIconComponent(category.icon);
                      return (
                        <TableRow key={category.id}>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => moveCategory(category, 'up')}
                                disabled={index === 0 || loading}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => moveCategory(category, 'down')}
                                disabled={index === categories.length - 1 || loading}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{category.name}</TableCell>
                          <TableCell>
                            <Badge variant={
                              category.target_type === 'students' ? 'default' :
                              category.target_type === 'teachers' ? 'secondary' : 'outline'
                            }>
                              {category.target_type === 'students' ? 'Alumnos' :
                               category.target_type === 'teachers' ? 'Profesores' : 'Ambos'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: `${category.color}20` }}
                              >
                                <IconComponent className="h-4 w-4" style={{ color: category.color }} />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {category.price ? `S/ ${category.price.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell>
                            {!category.is_kitchen_sale && addonsCount[category.id] !== undefined ? (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                                {addonsCount[category.id]} {addonsCount[category.id] === 1 ? 'topping' : 'toppings'}
                              </Badge>
                            ) : (
                              <span className="text-gray-400 text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {category.menu_mode === 'configurable' ? (
                              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                                🍽️ Configurable
                              </Badge>
                            ) : (
                              <span className="text-gray-400 text-xs">Estándar</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={category.is_active}
                                onCheckedChange={() => handleToggleActiveClick(category)}
                                disabled={loading}
                              />
                              {!category.is_active && (
                                <span className="text-xs text-orange-600 font-medium">Inactiva</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {/* Botón de configurar plato configurable */}
                              {category.menu_mode === 'configurable' && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => openConfigurableEditor(category)}
                                  disabled={loading}
                                  title="Configurar opciones del plato"
                                  className="bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-300"
                                >
                                  ⚙️
                                </Button>
                              )}

                              {/* Botón de Gestionar Agregados (solo para categorías normales, no venta de cocina) */}
                              {!category.is_kitchen_sale && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setManagingAddonsForCategory(category)}
                                  disabled={loading}
                                  title="Gestionar agregados/extras"
                                >
                                  <Package className="h-3 w-3" />
                                </Button>
                              )}
                              
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(category)}
                                disabled={loading}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteClick(category)}
                                disabled={loading}
                                title="Eliminar categoría"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
      
      {/* Modal de gestión de agregados */}
      {managingAddonsForCategory && (
        <AddonsManager
          categoryId={managingAddonsForCategory.id}
          categoryName={managingAddonsForCategory.name}
          open={!!managingAddonsForCategory}
          onClose={() => {
            setManagingAddonsForCategory(null);
            fetchCategories(); // Recargar para actualizar conteo
          }}
        />
      )}

      {/* ======================================================
          DIALOG DE CONFIRMACIÓN DE ELIMINACIÓN
          ====================================================== */}
      <Dialog open={!!deleteConfirmCategory} onOpenChange={() => { setDeleteConfirmCategory(null); setImpactData(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              ¿Eliminar categoría?
            </DialogTitle>
            <DialogDescription>
              Estás a punto de eliminar la categoría <strong>"{deleteConfirmCategory?.name}"</strong>.
              Esta acción <strong className="text-red-600">no se puede deshacer</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {loadingImpact ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                Calculando impacto...
              </div>
            ) : impactData ? (
              <div className="space-y-2">
                {impactData.futureOrders > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <span className="text-2xl">🚨</span>
                    <div>
                      <p className="font-semibold text-red-800">
                        {impactData.futureOrders} pedido(s) futuro(s) activo(s)
                      </p>
                      <p className="text-sm text-red-700 mt-1">
                        Estos pedidos perderán su referencia de categoría pero <strong>NO se eliminarán</strong>. Los alumnos/profesores aún verán "Sin categoría" en su historial.
                      </p>
                    </div>
                  </div>
                )}
                {impactData.futureMenus > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <span className="text-2xl">📅</span>
                    <div>
                      <p className="font-semibold text-orange-800">
                        {impactData.futureMenus} menú(s) futuro(s) afectado(s)
                      </p>
                      <p className="text-sm text-orange-700 mt-1">
                        Los menús quedarán sin categoría asignada pero <strong>seguirán existiendo</strong>.
                      </p>
                    </div>
                  </div>
                )}
                {impactData.futureOrders === 0 && impactData.futureMenus === 0 && (
                  <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <span className="text-2xl">✅</span>
                    <p className="text-sm text-green-700">No hay pedidos ni menús futuros afectados. Es seguro eliminar.</p>
                  </div>
                )}
                {impactData.futureOrders > 0 && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800 font-medium">💡 Alternativa recomendada:</p>
                    <p className="text-xs text-blue-700 mt-1">
                      Considera <strong>desactivar</strong> la categoría en lugar de eliminarla. Así los pedidos existentes conservan su referencia visible.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteConfirmCategory(null); setImpactData(null); }} disabled={loading}>
              Cancelar
            </Button>
            {impactData && impactData.futureOrders > 0 && (
              <Button
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => {
                  if (deleteConfirmCategory) doToggleActive({ ...deleteConfirmCategory, is_active: true });
                  setDeleteConfirmCategory(null);
                  setImpactData(null);
                }}
                disabled={loading}
              >
                Desactivar mejor
              </Button>
            )}
            <Button variant="destructive" onClick={confirmDelete} disabled={loading || loadingImpact}>
              {loading ? 'Eliminando...' : 'Sí, eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================
          DIALOG DE CONFIRMACIÓN DE DESACTIVACIÓN
          ====================================================== */}
      <Dialog open={!!toggleConfirmCategory} onOpenChange={() => { setToggleConfirmCategory(null); setImpactData(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Users className="h-5 w-5" />
              ¿Desactivar categoría?
            </DialogTitle>
            <DialogDescription>
              Vas a desactivar <strong>"{toggleConfirmCategory?.name}"</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {loadingImpact ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500" />
                Calculando impacto...
              </div>
            ) : impactData ? (
              <div className="space-y-2">
                {impactData.futureOrders > 0 ? (
                  <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <span className="text-2xl">⚠️</span>
                    <div>
                      <p className="font-semibold text-orange-800">
                        {impactData.futureOrders} pedido(s) activo(s) afectado(s)
                      </p>
                      <p className="text-sm text-orange-700 mt-1">
                        Los pedidos existentes <strong>no se borrarán</strong> y seguirán visibles en el historial. Sin embargo, <strong>no se podrán hacer nuevos pedidos</strong> para esta categoría.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <span className="text-2xl">✅</span>
                    <p className="text-sm text-green-700">No hay pedidos futuros activos. Es seguro desactivar.</p>
                  </div>
                )}
                <div className="p-3 bg-gray-50 border rounded-lg">
                  <p className="text-xs text-gray-600">
                    Puedes volver a activar la categoría en cualquier momento usando el mismo switch.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setToggleConfirmCategory(null); setImpactData(null); }} disabled={loading}>
              Cancelar
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={confirmToggleActive}
              disabled={loading || loadingImpact}
            >
              {loading ? 'Desactivando...' : 'Sí, desactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================
          DIALOG DE CONFIGURACIÓN DE PLATO CONFIGURABLE
          ====================================================== */}
      <Dialog open={!!configuringCategory} onOpenChange={() => setConfiguringCategory(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-800">
              🍽️ Configurar Plato: "{configuringCategory?.name}"
            </DialogTitle>
            <DialogDescription>
              Define los grupos de opciones. Ejemplo: "Proteína" con opciones Pollo, Pescado, Carne. Los padres elegirán una opción de cada grupo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {configGroups.map((group, gIdx) => (
              <Card key={gIdx} className="border-2 border-amber-200">
                <CardContent className="p-4 space-y-3">
                  {/* Cabecera del grupo */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Label className="text-xs text-gray-500">Nombre del grupo</Label>
                      <Input
                        value={group.name}
                        onChange={(e) => updateConfigGroup(gIdx, 'name', e.target.value)}
                        placeholder="Ej: Proteína, Guarnición, Ensalada"
                        className="font-semibold border-amber-200"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeConfigGroup(gIdx)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 mt-5"
                      disabled={savingConfig}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Opciones del grupo */}
                  <div className="pl-4 border-l-2 border-amber-200 space-y-2">
                    <p className="text-xs text-amber-700 font-medium">Opciones disponibles:</p>
                    {group.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-2">
                        <span className="text-xs text-amber-500 w-6">{oIdx + 1}.</span>
                        <Input
                          value={opt.name}
                          onChange={(e) => updateConfigOption(gIdx, oIdx, e.target.value)}
                          placeholder={`Opción ${oIdx + 1} (ej: Pollo a la plancha)`}
                          className="text-sm h-9 border-amber-200"
                          disabled={savingConfig}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeConfigOption(gIdx, oIdx)}
                          disabled={savingConfig || group.options.length <= 1}
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addConfigOption(gIdx)}
                      disabled={savingConfig}
                      className="text-amber-700 border-amber-300 hover:bg-amber-50"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Agregar opción
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Botón agregar grupo */}
            <Button
              variant="outline"
              onClick={addConfigGroup}
              disabled={savingConfig}
              className="w-full border-dashed border-2 border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              <Plus className="h-4 w-4 mr-2" />
              Agregar grupo de opciones
            </Button>
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfiguringCategory(null)} disabled={savingConfig}>
              Cancelar
            </Button>
            <Button
              onClick={saveConfigurableGroups}
              disabled={savingConfig}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {savingConfig ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Guardando...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" />Guardar opciones</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
