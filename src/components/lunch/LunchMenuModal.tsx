import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { Loader2 } from 'lucide-react';

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
}

export const LunchMenuModal = ({
  isOpen,
  onClose,
  menuId,
  initialDate,
  schools,
  userSchoolId,
  onSuccess,
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
  });

  // Cargar datos del menú si es edición
  useEffect(() => {
    if (menuId && isOpen) {
      loadMenuData();
    } else if (!menuId && isOpen) {
      // Modo creación: resetear formulario
      setFormData({
        school_id: userSchoolId || '',
        date: initialDate ? initialDate.toISOString().split('T')[0] : '',
        starter: '',
        main_course: '',
        beverage: '',
        dessert: '',
        notes: '',
      });
    }
  }, [menuId, isOpen, initialDate, userSchoolId]);

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

    setLoading(true);
    try {
      const payload = {
        ...formData,
        starter: formData.starter.trim() || null,
        beverage: formData.beverage.trim() || null,
        dessert: formData.dessert.trim() || null,
        notes: formData.notes.trim() || null,
        created_by: user?.id,
      };

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {menuId ? 'Editar Menú' : 'Nuevo Menú de Almuerzo'}
          </DialogTitle>
          <DialogDescription>
            Completa los platos del día. Solo el segundo es obligatorio.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                <SelectTrigger>
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
          </div>

          <div>
            <Label htmlFor="starter">🥗 Entrada</Label>
            <Input
              id="starter"
              placeholder="Ej: Ensalada de verduras frescas"
              value={formData.starter}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, starter: e.target.value }))
              }
              disabled={loading}
            />
          </div>

          <div>
            <Label htmlFor="main_course">🍲 Segundo Plato *</Label>
            <Input
              id="main_course"
              placeholder="Ej: Arroz con pollo y ensalada"
              value={formData.main_course}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, main_course: e.target.value }))
              }
              disabled={loading}
              required
            />
          </div>

          <div>
            <Label htmlFor="beverage">🥤 Bebida</Label>
            <Input
              id="beverage"
              placeholder="Ej: Refresco de maracuyá"
              value={formData.beverage}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, beverage: e.target.value }))
              }
              disabled={loading}
            />
          </div>

          <div>
            <Label htmlFor="dessert">🍰 Postre</Label>
            <Input
              id="dessert"
              placeholder="Ej: Gelatina de fresa"
              value={formData.dessert}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, dessert: e.target.value }))
              }
              disabled={loading}
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
            />
          </div>

          <DialogFooter className="gap-2">
            {menuId && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  'Eliminar'
                )}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
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

