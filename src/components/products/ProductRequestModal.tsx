import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { MessageSquarePlus, Send, ClipboardList, CheckCircle2 } from 'lucide-react';

interface ProductRequestModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string | null;
  schoolName?: string;
}

const REQUEST_TYPES = [
  { value: 'cambio_precio', label: 'Cambio de precio', description: 'Quiero cambiar el precio de un producto' },
  { value: 'cambio_stock', label: 'Ajuste de stock', description: 'Necesito corregir el stock de un producto' },
  { value: 'nuevo_producto', label: 'Nuevo producto', description: 'Quiero agregar un producto que no está en la lista' },
  { value: 'dar_de_baja', label: 'Dar de baja', description: 'Quiero retirar un producto de mi sede' },
  { value: 'otro', label: 'Otra solicitud', description: 'Consulta o sugerencia general' },
];

export function ProductRequestModal({ open, onClose, schoolId, schoolName }: ProductRequestModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [requestType, setRequestType] = useState('');
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const selectedType = REQUEST_TYPES.find(t => t.value === requestType);

  const handleSubmit = async () => {
    if (!requestType || !description.trim()) {
      toast({ title: 'Faltan datos', description: 'Por favor completa el tipo de solicitud y la descripción.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('product_requests').insert({
        school_id: schoolId,
        user_id: user?.id,
        user_email: user?.email,
        school_name: schoolName || null,
        request_type: requestType,
        product_name: productName.trim() || null,
        description: description.trim(),
        status: 'pendiente',
      });

      if (error) throw error;

      setSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast({ title: 'No se pudo enviar', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setRequestType('');
    setProductName('');
    setDescription('');
    setSent(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-700">
            <ClipboardList className="h-5 w-5" />
            Solicitud de cambio
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div>
              <p className="text-lg font-semibold text-green-700">¡Solicitud enviada!</p>
              <p className="text-sm text-gray-500 mt-1">
                El administrador general recibirá tu pedido y te dará una respuesta.
              </p>
            </div>
            <Button onClick={handleClose} className="mt-2">
              Cerrar
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
              <p className="font-medium flex items-center gap-1.5">
                <MessageSquarePlus className="h-4 w-4" />
                ¿Qué necesitas cambiar?
              </p>
              <p className="mt-1 text-blue-600">
                Describe tu pedido y el administrador general lo revisará y tomará acción.
              </p>
            </div>

            {schoolName && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Sede:</span>
                <Badge variant="outline">{schoolName}</Badge>
              </div>
            )}

            <div className="space-y-2">
              <Label>Tipo de solicitud <span className="text-red-500">*</span></Label>
              <Select value={requestType} onValueChange={setRequestType}>
                <SelectTrigger>
                  <SelectValue placeholder="¿Qué tipo de cambio necesitas?" />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType && (
                <p className="text-xs text-gray-500">{selectedType.description}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nombre del producto (opcional)</Label>
              <Input
                placeholder="Ej: Agua mineral 500ml, Alfajor de chocolate..."
                value={productName}
                onChange={e => setProductName(e.target.value)}
              />
              <p className="text-xs text-gray-500">Si tu solicitud es sobre un producto específico, escribe su nombre aquí.</p>
            </div>

            <div className="space-y-2">
              <Label>Descripción del pedido <span className="text-red-500">*</span></Label>
              <Textarea
                placeholder="Explica con detalle qué necesitas cambiar, por qué y cualquier información adicional que ayude al administrador..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                maxLength={1000}
              />
              <p className="text-xs text-gray-400 text-right">{description.length}/1000</p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={handleClose} className="flex-1" disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={loading || !requestType || !description.trim()}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    Enviando...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Enviar solicitud
                  </span>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
