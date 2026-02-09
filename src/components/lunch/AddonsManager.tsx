import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Package
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface CategoryAddon {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  display_order: number;
}

interface AddonsManagerProps {
  categoryId: string;
  categoryName: string;
  open: boolean;
  onClose: () => void;
}

export function AddonsManager({
  categoryId,
  categoryName,
  open,
  onClose
}: AddonsManagerProps) {
  const { toast } = useToast();
  const [addons, setAddons] = useState<CategoryAddon[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingAddon, setEditingAddon] = useState<CategoryAddon | null>(null);
  const [showForm, setShowForm] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
  });

  useEffect(() => {
    if (open) {
      fetchAddons();
    }
  }, [open, categoryId]);

  const fetchAddons = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lunch_category_addons')
        .select('*')
        .eq('category_id', categoryId)
        .order('display_order', { ascending: true });

      if (error) throw error;
      setAddons(data || []);
    } catch (error: any) {
      console.error('Error fetching addons:', error);
      toast({
        variant: 'destructive',
        title: 'Error al cargar agregados',
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
        description: 'El nombre del agregado es obligatorio'
      });
      return;
    }

    if (!formData.price || parseFloat(formData.price) <= 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El precio debe ser mayor a 0'
      });
      return;
    }

    setLoading(true);
    try {
      const addonData = {
        category_id: categoryId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        price: parseFloat(formData.price),
        is_active: true,
        display_order: editingAddon ? editingAddon.display_order : addons.length,
      };

      if (editingAddon) {
        const { error } = await supabase
          .from('lunch_category_addons')
          .update(addonData)
          .eq('id', editingAddon.id);

        if (error) throw error;

        toast({
          title: '✅ Agregado actualizado',
          description: `"${formData.name}" se actualizó correctamente`
        });
      } else {
        const { error } = await supabase
          .from('lunch_category_addons')
          .insert([addonData]);

        if (error) throw error;

        toast({
          title: '✅ Agregado creado',
          description: `"${formData.name}" se creó correctamente`
        });
      }

      await fetchAddons();
      resetForm();
    } catch (error: any) {
      console.error('Error saving addon:', error);
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (addon: CategoryAddon) => {
    setEditingAddon(addon);
    setFormData({
      name: addon.name,
      description: addon.description || '',
      price: addon.price.toString(),
    });
    setShowForm(true);
  };

  const handleDelete = async (addon: CategoryAddon) => {
    if (!confirm(`¿Estás seguro de eliminar "${addon.name}"?`)) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('lunch_category_addons')
        .delete()
        .eq('id', addon.id);

      if (error) throw error;

      toast({
        title: '✅ Agregado eliminado',
        description: `"${addon.name}" se eliminó correctamente`
      });

      await fetchAddons();
    } catch (error: any) {
      console.error('Error deleting addon:', error);
      toast({
        variant: 'destructive',
        title: 'Error al eliminar',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (addon: CategoryAddon) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('lunch_category_addons')
        .update({ is_active: !addon.is_active })
        .eq('id', addon.id);

      if (error) throw error;

      await fetchAddons();
    } catch (error: any) {
      console.error('Error toggling addon:', error);
      toast({
        variant: 'destructive',
        title: 'Error al actualizar',
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
      price: '',
    });
    setEditingAddon(null);
    setShowForm(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Gestionar Agregados - {categoryName}
          </DialogTitle>
          <DialogDescription>
            Configura los extras/toppings disponibles para esta categoría (ej: doble porción, extras)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Botón para crear nuevo agregado */}
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Agregar Nuevo Extra/Topping
            </Button>
          )}

          {/* Formulario de crear/editar */}
          {showForm && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {editingAddon ? 'Editar Agregado' : 'Nuevo Agregado'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="addon-name">Nombre del Agregado *</Label>
                      <Input
                        id="addon-name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Ej: Doble Porción de Pollo"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="addon-price">Precio (S/) *</Label>
                      <Input
                        id="addon-price"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        placeholder="0.00"
                        required
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="addon-description">Descripción (opcional)</Label>
                      <Textarea
                        id="addon-description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Descripción breve del agregado..."
                        rows={2}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetForm}
                      disabled={loading}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={loading}>
                      <Save className="h-4 w-4 mr-1" />
                      {editingAddon ? 'Actualizar' : 'Crear'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Lista de agregados */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agregados Configurados</CardTitle>
            </CardHeader>
            <CardContent>
              {loading && addons.length === 0 ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
                  <p className="text-gray-600 mt-4">Cargando...</p>
                </div>
              ) : addons.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No hay agregados configurados aún</p>
                  <p className="text-sm mt-2">Crea el primer extra/topping para esta categoría</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Precio</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addons.map((addon) => (
                      <TableRow key={addon.id}>
                        <TableCell className="font-medium">{addon.name}</TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {addon.description || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">S/ {addon.price.toFixed(2)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={addon.is_active}
                            onCheckedChange={() => handleToggleActive(addon)}
                            disabled={loading}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(addon)}
                              disabled={loading}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDelete(addon)}
                              disabled={loading}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
