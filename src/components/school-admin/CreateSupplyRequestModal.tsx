import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus,
  Trash2,
  ShoppingCart,
  Package,
  Search
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: {
    name: string;
    color: string;
  };
  unit: string;
  central_stock: number;
}

interface RequestItem {
  item_id: string;
  item_name: string;
  item_code: string;
  unit: string;
  quantity: number;
}

interface CreateSupplyRequestModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userSchoolId: string | null;
}

export function CreateSupplyRequestModal({
  open,
  onClose,
  onSuccess,
  userSchoolId
}: CreateSupplyRequestModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categories, setCategories] = useState<any[]>([]);
  const [requestItems, setRequestItems] = useState<RequestItem[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      loadInventoryItems();
      loadCategories();
    }
  }, [open]);

  const loadInventoryItems = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('inventory_items')
        .select(`
          id,
          code,
          name,
          unit,
          category:inventory_categories(name, color),
          central_stock:inventory_stock!inner(quantity)
        `)
        .eq('inventory_stock.school_id', null)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      const formattedItems = data?.map(item => ({
        ...item,
        central_stock: item.central_stock?.[0]?.quantity || 0
      })) || [];

      setInventoryItems(formattedItems);

    } catch (error: any) {
      console.error('Error loading inventory:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar el inventario',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('inventory_categories')
        .select('*')
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const handleAddItem = (item: InventoryItem) => {
    // Verificar si ya está en la lista
    if (requestItems.some(ri => ri.item_id === item.id)) {
      toast({
        variant: 'destructive',
        title: 'Item duplicado',
        description: 'Este producto ya está en tu pedido',
      });
      return;
    }

    const newItem: RequestItem = {
      item_id: item.id,
      item_name: item.name,
      item_code: item.code,
      unit: item.unit,
      quantity: 1
    };

    setRequestItems([...requestItems, newItem]);
  };

  const handleRemoveItem = (itemId: string) => {
    setRequestItems(requestItems.filter(item => item.item_id !== itemId));
  };

  const handleUpdateQuantity = (itemId: string, quantity: number) => {
    if (quantity < 0) return;
    
    setRequestItems(requestItems.map(item => 
      item.item_id === itemId 
        ? { ...item, quantity: Math.max(0, quantity) }
        : item
    ));
  };

  const handleSubmit = async () => {
    if (!userSchoolId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo identificar tu sede',
      });
      return;
    }

    if (requestItems.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Pedido vacío',
        description: 'Agrega al menos un producto a tu pedido',
      });
      return;
    }

    // Validar que todas las cantidades sean mayores a 0
    const invalidItems = requestItems.filter(item => item.quantity <= 0);
    if (invalidItems.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Cantidades inválidas',
        description: 'Todos los productos deben tener una cantidad mayor a 0',
      });
      return;
    }

    try {
      setSubmitting(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay usuario autenticado');

      // Generar número de pedido
      const requestNumber = await generateRequestNumber();

      // Crear el pedido
      const { data: requestData, error: requestError } = await supabase
        .from('supply_requests')
        .insert({
          request_number: requestNumber,
          requesting_school_id: userSchoolId,
          requested_by: user.id,
          status: 'pending',
          notes: notes || null
        })
        .select()
        .single();

      if (requestError) throw requestError;

      // Insertar los items del pedido
      const itemsToInsert = requestItems.map(item => ({
        request_id: requestData.id,
        item_id: item.item_id,
        quantity_requested: item.quantity,
        status: 'pending'
      }));

      const { error: itemsError } = await supabase
        .from('supply_request_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      toast({
        title: '✅ Pedido Creado',
        description: `Pedido ${requestNumber} enviado al almacén exitosamente`,
      });

      // Limpiar formulario
      setRequestItems([]);
      setNotes('');
      setSearchTerm('');
      
      onSuccess();
      onClose();

    } catch (error: any) {
      console.error('Error creating request:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear el pedido',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const generateRequestNumber = async (): Promise<string> => {
    const { data, error } = await supabase.rpc('generate_code', {
      prefix: 'SR',
      table_name: 'supply_requests',
      column_name: 'request_number'
    });

    if (error || !data) {
      // Fallback si la función falla
      return `SR-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    }

    return data;
  };

  const filteredItems = inventoryItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category.name === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ShoppingCart className="h-6 w-6 text-[#8B4513]" />
            Crear Pedido de Suministros
          </DialogTitle>
          <DialogDescription>
            Selecciona los productos que necesitas para tu sede
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          {/* Columna Izquierda: Inventario Disponible */}
          <div className="space-y-4">
            <h3 className="font-bold text-slate-700">Productos Disponibles</h3>
            
            {/* Búsqueda y Filtros */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Lista de Productos */}
            <div className="max-h-[500px] overflow-y-auto space-y-2">
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8B4513] mx-auto"></div>
                </div>
              ) : filteredItems.length > 0 ? (
                filteredItems.map(item => (
                  <Card key={item.id} className="border-l-4 border-l-blue-500">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-bold text-sm text-slate-800">{item.name}</p>
                          <p className="text-xs text-slate-500">{item.code}</p>
                          <Badge style={{ backgroundColor: item.category.color }} className="text-white text-xs mt-1">
                            {item.category.name}
                          </Badge>
                        </div>
                        <Button 
                          size="sm" 
                          onClick={() => handleAddItem(item)}
                          className="bg-[#8B4513] hover:bg-[#6F370F]"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <p className="text-center text-slate-400 py-8">No se encontraron productos</p>
              )}
            </div>
          </div>

          {/* Columna Derecha: Pedido Actual */}
          <div className="space-y-4">
            <h3 className="font-bold text-slate-700">Tu Pedido ({requestItems.length} items)</h3>
            
            {requestItems.length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {requestItems.map((item, index) => (
                  <Card key={item.item_id} className="border-l-4 border-l-green-500">
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <p className="font-bold text-sm text-slate-800">{item.item_name}</p>
                          <p className="text-xs text-slate-500">{item.item_code}</p>
                          
                          <div className="flex items-center gap-2 mt-2">
                            <Label className="text-xs">Cantidad:</Label>
                            <Input
                              type="number"
                              min="0"
                              value={item.quantity}
                              onChange={(e) => handleUpdateQuantity(item.item_id, parseFloat(e.target.value))}
                              className="w-20 h-8"
                            />
                            <span className="text-xs text-slate-500">{item.unit}</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveItem(item.item_id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-slate-50 rounded-lg">
                <Package className="h-12 w-12 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">Agrega productos desde la lista</p>
              </div>
            )}

            {/* Notas */}
            <div>
              <Label>Notas adicionales (opcional)</Label>
              <Textarea
                placeholder="Ej: Urgente para evento del viernes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={submitting || requestItems.length === 0}
            className="bg-[#8B4513] hover:bg-[#6F370F]"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Enviando...
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4 mr-2" />
                Enviar Pedido ({requestItems.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
