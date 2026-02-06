import { useState } from 'react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { 
  Clock, 
  Phone,
  Shield,
  AlertTriangle,
  DollarSign
} from 'lucide-react';
import { CashRegisterConfig } from '@/types/cashRegister';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface Props {
  config: CashRegisterConfig;
  onClose: () => void;
  onUpdated: () => void;
}

export default function CashConfigDialog({ config, onClose, onUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    auto_close_enabled: config.auto_close_enabled,
    auto_close_time: config.auto_close_time.substring(0, 5), // HH:MM
    whatsapp_phone: config.whatsapp_phone,
    require_admin_password: config.require_admin_password,
    alert_on_difference: config.alert_on_difference,
    difference_threshold: config.difference_threshold.toString(),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);

      const threshold = parseFloat(formData.difference_threshold);
      if (isNaN(threshold) || threshold < 0) {
        toast.error('Ingresa un umbral válido');
        return;
      }

      const { error } = await supabase
        .from('cash_register_config')
        .update({
          auto_close_enabled: formData.auto_close_enabled,
          auto_close_time: formData.auto_close_time + ':00',
          whatsapp_phone: formData.whatsapp_phone,
          require_admin_password: formData.require_admin_password,
          alert_on_difference: formData.alert_on_difference,
          difference_threshold: threshold,
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id);

      if (error) throw error;

      toast.success('Configuración actualizada exitosamente');
      onUpdated();
      onClose();
    } catch (error) {
      console.error('Error al actualizar configuración:', error);
      toast.error('Error al actualizar la configuración');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Configuración de Cierre de Caja
          </DialogTitle>
          <DialogDescription>
            Configura el comportamiento del sistema de caja
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Cierre automático */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-close" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Cierre Automático
                </Label>
                <p className="text-xs text-muted-foreground">
                  Cerrar caja automáticamente a una hora específica
                </p>
              </div>
              <Switch
                id="auto-close"
                checked={formData.auto_close_enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, auto_close_enabled: checked })
                }
              />
            </div>

            {formData.auto_close_enabled && (
              <div>
                <Label htmlFor="time">Hora de Cierre</Label>
                <Input
                  id="time"
                  type="time"
                  value={formData.auto_close_time}
                  onChange={(e) =>
                    setFormData({ ...formData, auto_close_time: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  La caja se cerrará automáticamente con los valores calculados
                </p>
              </div>
            )}
          </div>

          {/* WhatsApp */}
          <div>
            <Label htmlFor="whatsapp" className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Teléfono WhatsApp
            </Label>
            <Input
              id="whatsapp"
              type="tel"
              value={formData.whatsapp_phone}
              onChange={(e) =>
                setFormData({ ...formData, whatsapp_phone: e.target.value })
              }
              placeholder="991236870"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Número para enviar reportes de cierre automáticamente
            </p>
          </div>

          {/* Contraseña admin */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="password" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Requerir Contraseña Admin
              </Label>
              <p className="text-xs text-muted-foreground">
                Solicitar contraseña del administrador para cerrar caja
              </p>
            </div>
            <Switch
              id="password"
              checked={formData.require_admin_password}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, require_admin_password: checked })
              }
            />
          </div>

          {/* Alertas de diferencia */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="alert" className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Alertas de Diferencia
                </Label>
                <p className="text-xs text-muted-foreground">
                  Alertar cuando haya diferencias en el cierre
                </p>
              </div>
              <Switch
                id="alert"
                checked={formData.alert_on_difference}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, alert_on_difference: checked })
                }
              />
            </div>

            {formData.alert_on_difference && (
              <div>
                <Label htmlFor="threshold" className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Umbral de Alerta (S/)
                </Label>
                <Input
                  id="threshold"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.difference_threshold}
                  onChange={(e) =>
                    setFormData({ ...formData, difference_threshold: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Mostrar alerta crítica si la diferencia supera este monto
                </p>
              </div>
            )}
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={loading}
            >
              {loading ? 'Guardando...' : 'Guardar Configuración'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
