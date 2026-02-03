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
import { Loader2, Search, Save, Check, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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
  preSelectedTargetType?: 'students' | 'teachers'; // Nueva prop desde wizard
  preSelectedCategoryName?: string; // Nueva prop desde wizard
}

// Componente Autocomplete interno
const AutocompleteInput = ({ 
  label, 
  value, 
  onChange, 
  type, 
  placeholder,
  icon: Icon
}: { 
  label: string, 
  value: string, 
  onChange: (val: string) => void, 
  type: string,
  placeholder: string,
  icon: any
}) => {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (value.length < 2) {
        setSuggestions([]);
        return;
      }
      
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('search_lunch_items', {
          p_type: type,
          p_query: value
        });
        if (!error && data) {
          setSuggestions(data.map((item: any) => item.name));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [value, type]);

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </Label>
      <div className="relative">
        <Popover open={open && suggestions.length > 0} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Input
                placeholder={placeholder}
                value={value}
                onChange={(e) => {
                  onChange(e.target.value);
                  setOpen(true);
                }}
                className="pr-10"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {suggestions.map((s) => (
                    <CommandItem
                      key={s}
                      value={s}
                      onSelect={(currentValue) => {
                        onChange(currentValue);
                        setOpen(false);
                      }}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      {s}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

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
  });

  // Cargar datos del menú si es edición
  useEffect(() => {
    if (menuId && isOpen) {
      loadMenuData();
    } else if (!menuId && isOpen) {
      // Modo creación: resetear formulario con datos del wizard
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
      });
      
      // Debug: verificar que se reciben los datos del wizard
      console.log('🎨 Wizard data recibido:', {
        preSelectedCategoryId,
        preSelectedTargetType,
        preSelectedCategoryName
      });
    }
  }, [menuId, isOpen, initialDate, userSchoolId, preSelectedCategoryId, preSelectedTargetType]);

  // Actualizar category_id cuando llegue del wizard (después de que el modal ya esté abierto)
  useEffect(() => {
    if (!menuId && isOpen && preSelectedCategoryId) {
      console.log('🔄 Actualizando category_id desde wizard:', preSelectedCategoryId);
      setFormData(prev => ({
        ...prev,
        category_id: preSelectedCategoryId,
        target_type: preSelectedTargetType || 'students',
      }));
    }
  }, [preSelectedCategoryId, preSelectedTargetType, isOpen, menuId]);

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
      });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.school_id || !formData.date || !formData.main_course.trim()) {
      toast({
        title: 'Campos incompletos',
        description: 'Por favor completa la sede, fecha y segundo plato',
        variant: 'destructive',
      });
      return;
    }

    console.log('📝 FormData al guardar:', formData);

    setLoading(true);
    try {
      // 1. Guardar platos en la librería para futuro autocomplete
      const libraryPromises = [
        supabase.rpc('upsert_lunch_item', { p_type: 'entrada', p_name: formData.starter.trim() }),
        supabase.rpc('upsert_lunch_item', { p_type: 'segundo', p_name: formData.main_course.trim() }),
        supabase.rpc('upsert_lunch_item', { p_type: 'bebida', p_name: formData.beverage.trim() }),
        supabase.rpc('upsert_lunch_item', { p_type: 'postre', p_name: formData.dessert.trim() }),
      ];
      await Promise.all(libraryPromises);

      // 2. Guardar el menú
      const payload: any = {
        school_id: formData.school_id,
        date: formData.date,
        starter: formData.starter.trim() || null,
        main_course: formData.main_course.trim(),
        beverage: formData.beverage.trim() || null,
        dessert: formData.dessert.trim() || null,
        notes: formData.notes.trim() || null,
        created_by: user?.id,
      };

      // Agregar category_id y target_type (convertir string vacío a null)
      if (formData.category_id && formData.category_id.trim() !== '') {
        payload.category_id = formData.category_id;
        payload.target_type = formData.target_type || 'students';
      } else {
        // Si no hay categoría, asegurarse de que sean null explícitamente
        payload.category_id = null;
        payload.target_type = 'students';
      }

      if (menuId) {
        // Actualizar
        const { error } = await supabase
          .from('lunch_menus')
          .update(payload)
          .eq('id', menuId);

        if (error) throw error;

        toast({
          title: 'Menú actualizado',
          description: 'El menú se actualizó correctamente',
        });
      } else {
        // Crear
        const { error } = await supabase
          .from('lunch_menus')
          .insert([payload]);

        if (error) throw error;

        toast({
          title: 'Menú creado',
          description: 'El menú se creó correctamente',
        });
      }

      onSuccess();
    } catch (error: any) {
      console.error('Error saving menu:', error);
      
      let errorMessage = 'No se pudo guardar el menú';
      if (error.code === '23505') {
        errorMessage = 'Ya existe un menú para esta sede en esta fecha';
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
            {menuId ? 'Editar Menú' : 'Nuevo Menú de Almuerzo'}
          </DialogTitle>
          <div className="space-y-2 pt-1">
            {formattedDate && (
              <p className="font-bold text-green-700 capitalize text-sm">{formattedDate}</p>
            )}
            {preSelectedCategoryName && (
              <Badge variant="outline" className="gap-1">
                <Tag className="h-3 w-3" />
                {preSelectedCategoryName} - {preSelectedTargetType === 'students' ? 'Alumnos' : 'Profesores'}
              </Badge>
            )}
            <DialogDescription>
              Completa los platos del día. Solo el segundo es obligatorio.
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
            <AutocompleteInput 
              label="🥗 Entrada"
              value={formData.starter}
              onChange={(v) => setFormData(p => ({ ...p, starter: v }))}
              type="entrada"
              placeholder="Ej: Ensalada de verduras frescas"
              icon={Search}
            />

            <AutocompleteInput 
              label="🍲 Segundo Plato *"
              value={formData.main_course}
              onChange={(v) => setFormData(p => ({ ...p, main_course: v }))}
              type="segundo"
              placeholder="Ej: Arroz con pollo"
              icon={UtensilsCrossed}
            />

            <AutocompleteInput 
              label="🥤 Bebida"
              value={formData.beverage}
              onChange={(v) => setFormData(p => ({ ...p, beverage: v }))}
              type="bebida"
              placeholder="Ej: Refresco de maracuyá"
              icon={Search}
            />

            <AutocompleteInput 
              label="🍰 Postre"
              value={formData.dessert}
              onChange={(v) => setFormData(p => ({ ...p, dessert: v }))}
              type="postre"
              placeholder="Ej: Gelatina de fresa"
              icon={Search}
            />
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
                'Crear Menú'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// Necesario para que UtensilsCrossed esté disponible en AutocompleteInput
import { UtensilsCrossed } from 'lucide-react';
