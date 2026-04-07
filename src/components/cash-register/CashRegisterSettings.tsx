import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Save, Clock, MessageSquare } from 'lucide-react';
import type { CashRegisterConfig } from '@/types/cashRegister';

interface CashRegisterSettingsProps {
  schoolId: string;
  onClose: () => void;
}

export function CashRegisterSettings({ schoolId, onClose }: CashRegisterSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<CashRegisterConfig | null>(null);
  const [error, setError] = useState('');

  // Estados del formulario
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(true);
  const [autoCloseTime, setAutoCloseTime] = useState('18:00');
  const [alertOnDifference, setAlertOnDifference] = useState(true);
  const [alertThreshold, setAlertThreshold] = useState('10.00');
  const [whatsappNumber, setWhatsappNumber] = useState('991236870');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [printOnClose, setPrintOnClose] = useState(true);
  const [includeSignatures, setIncludeSignatures] = useState(true);

  useEffect(() => {
    loadConfig();
  }, [schoolId]);

  const loadConfig = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('cash_register_config')
        .select('*')
        .eq('school_id', schoolId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading config:', error);
        return;
      }

      if (data) {
        setConfig(data);
        setAutoCloseEnabled(data.auto_close_enabled);
        setAutoCloseTime(data.auto_close_time.substring(0, 5)); // HH:MM
        setAlertOnDifference(data.alert_on_difference);
        setAlertThreshold(data.alert_threshold.toString());
        setWhatsappNumber(data.whatsapp_number || '991236870');
        setWhatsappEnabled(data.whatsapp_enabled);
        setPrintOnClose(data.print_on_close);
        setIncludeSignatures(data.include_signatures);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError('');

    // Validaciones
    if (!autoCloseTime) {
      setError('Debe especificar una hora de cierre');
      return;
    }

    if (alertThreshold && parseFloat(alertThreshold) < 0) {
      setError('El umbral de alerta debe ser positivo');
      return;
    }

    if (whatsappEnabled && !whatsappNumber) {
      setError('Debe especificar un número de WhatsApp');
      return;
    }

    try {
      setSaving(true);

      const configData = {
        school_id: schoolId,
        auto_close_enabled: autoCloseEnabled,
        auto_close_time: autoCloseTime + ':00',
        alert_on_difference: alertOnDifference,
        alert_threshold: parseFloat(alertThreshold) || 10,
        whatsapp_number: whatsappNumber,
        whatsapp_enabled: whatsappEnabled,
        print_on_close: printOnClose,
        include_signatures: includeSignatures,
        updated_at: new Date().toISOString(),
      };

      if (config) {
        // Actualizar
        const { error } = await supabase
          .from('cash_register_config')
          .update(configData)
          .eq('id', config.id);

        if (error) throw error;
      } else {
        // Crear
        const { error } = await supabase
          .from('cash_register_config')
          .insert(configData);

        if (error) throw error;
      }

      alert('Configuración guardada correctamente');
      onClose();
    } catch (error) {
      console.error('Error saving config:', error);
      setError('Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Configuración de Cierre de Caja</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            Cargando configuración...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuración de Cierre de Caja</DialogTitle>
          <DialogDescription>
            Configure el comportamiento del sistema de cierre de caja
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Cierre Automático */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Cierre Automático
                  </CardTitle>
                  <CardDescription>
                    Cierre automático de caja al final del día
                  </CardDescription>
                </div>
                <Switch
                  checked={autoCloseEnabled}
                  onCheckedChange={setAutoCloseEnabled}
                />
              </div>
            </CardHeader>
            {autoCloseEnabled && (
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="autoCloseTime">Hora de cierre automático</Label>
                    <Input
                      id="autoCloseTime"
                      type="time"
                      value={autoCloseTime}
                      onChange={(e) => setAutoCloseTime(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      La caja se cerrará automáticamente a esta hora si no se ha cerrado manualmente
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Alertas de Diferencia */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Alertas de Diferencia
                  </CardTitle>
                  <CardDescription>
                    Notificaciones cuando hay diferencias en el cierre
                  </CardDescription>
                </div>
                <Switch
                  checked={alertOnDifference}
                  onCheckedChange={setAlertOnDifference}
                />
              </div>
            </CardHeader>
            {alertOnDifference && (
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="alertThreshold">Umbral de alerta (S/)</Label>
                  <Input
                    id="alertThreshold"
                    type="number"
                    step="0.01"
                    min="0"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Se mostrará una alerta si la diferencia supera este monto
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Configuración de WhatsApp */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Envío por WhatsApp
                  </CardTitle>
                  <CardDescription>
                    Enviar reportes de cierre por WhatsApp
                  </CardDescription>
                </div>
                <Switch
                  checked={whatsappEnabled}
                  onCheckedChange={setWhatsappEnabled}
                />
              </div>
            </CardHeader>
            {whatsappEnabled && (
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="whatsappNumber">Número de WhatsApp</Label>
                  <div className="flex gap-2">
                    <Input
                      id="whatsappNumber"
                      type="tel"
                      placeholder="991236870"
                      value={whatsappNumber}
                      onChange={(e) => setWhatsappNumber(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Número al que se enviarán los reportes de cierre (incluir código de país si es necesario)
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Configuración de Impresión */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Opciones de Impresión</CardTitle>
              <CardDescription>
                Configure cómo se imprimen los reportes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Imprimir al cerrar</p>
                  <p className="text-sm text-muted-foreground">
                    Imprime automáticamente el reporte al cerrar la caja
                  </p>
                </div>
                <Switch
                  checked={printOnClose}
                  onCheckedChange={setPrintOnClose}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Incluir firmas</p>
                  <p className="text-sm text-muted-foreground">
                    Incluye espacio para firmas en los comprobantes
                  </p>
                </div>
                <Switch
                  checked={includeSignatures}
                  onCheckedChange={setIncludeSignatures}
                />
              </div>
            </CardContent>
          </Card>

          {/* Advertencia */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Los cambios en la configuración afectarán a todos los usuarios de esta sede.
              Solo los administradores pueden modificar estas opciones.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Guardando...' : 'Guardar Configuración'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
