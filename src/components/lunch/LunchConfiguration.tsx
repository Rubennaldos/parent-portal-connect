import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  DollarSign,
  Clock,
  AlertCircle,
  Save,
  Settings,
  CheckCircle2
} from 'lucide-react';

interface LunchConfigurationProps {
  schoolId: string | null;
  canEdit: boolean;
}

interface LunchConfig {
  id: string;
  school_id: string;
  lunch_price: number;
  order_deadline_time: string;
  order_deadline_days: number;
  cancellation_deadline_time: string;
  cancellation_deadline_days: number;
  orders_enabled: boolean;
  delivery_start_time?: string;
  delivery_end_time?: string;
  auto_close_day?: boolean;
  auto_mark_as_delivered?: boolean;
}

export function LunchConfiguration({ schoolId, canEdit }: LunchConfigurationProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<LunchConfig | null>(null);

  useEffect(() => {
    if (schoolId) {
      loadConfiguration();
    }
  }, [schoolId]);

  const loadConfiguration = async () => {
    if (!schoolId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lunch_configuration')
        .select('*')
        .eq('school_id', schoolId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setConfig(data);
      } else {
        // Crear configuración por defecto
        const { data: newConfig, error: insertError } = await supabase
          .from('lunch_configuration')
          .insert({
            school_id: schoolId,
            lunch_price: 7.50,
            order_deadline_time: '20:00:00',
            order_deadline_days: 1,
            cancellation_deadline_time: '07:00:00',
            cancellation_deadline_days: 0,
            orders_enabled: true,
            delivery_start_time: '07:00:00',
            delivery_end_time: '17:00:00',
            auto_close_day: true,
            auto_mark_as_delivered: true,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        setConfig(newConfig);
      }
    } catch (error: any) {
      console.error('Error loading configuration:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la configuración',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config || !canEdit) return;

    setSaving(true);
    try {
      console.log('💾 Guardando configuración:', config);
      
      const { error } = await supabase
        .from('lunch_configuration')
        .update({
          lunch_price: config.lunch_price,
          order_deadline_time: config.order_deadline_time,
          order_deadline_days: config.order_deadline_days,
          cancellation_deadline_time: config.cancellation_deadline_time,
          cancellation_deadline_days: config.cancellation_deadline_days,
          orders_enabled: config.orders_enabled,
          delivery_start_time: config.delivery_start_time,
          delivery_end_time: config.delivery_end_time,
          auto_close_day: config.auto_close_day,
          auto_mark_as_delivered: config.auto_mark_as_delivered,
        })
        .eq('id', config.id);

      if (error) {
        console.error('❌ ERROR al guardar:', error);
        throw error;
      }

      console.log('✅ Configuración guardada exitosamente');
      
      toast({
        title: '✅ Configuración Guardada',
        description: 'Los cambios se aplicaron correctamente',
      });
    } catch (error: any) {
      console.error('❌ Error saving configuration:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar la configuración',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
        <p className="text-gray-500">Cargando configuración...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No se pudo cargar la configuración</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <Settings className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Configuración del Sistema de Almuerzos</h2>
        <p className="text-gray-500">
          Gestiona los precios, horarios y límites para pedidos de almuerzo
        </p>
      </div>

      {/* Estado del Sistema */}
      <Card className={config.orders_enabled ? 'border-green-500 border-2' : 'border-red-500 border-2'}>
        <CardHeader className={config.orders_enabled ? 'bg-green-50' : 'bg-red-50'}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {config.orders_enabled ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                )}
                Estado del Sistema
              </CardTitle>
              <CardDescription>
                {config.orders_enabled
                  ? 'Los padres pueden realizar pedidos de almuerzo'
                  : 'Sistema de pedidos deshabilitado'}
              </CardDescription>
            </div>
            <Switch
              checked={config.orders_enabled}
              onCheckedChange={(checked) =>
                setConfig({ ...config, orders_enabled: checked })
              }
              disabled={!canEdit}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Precio del Almuerzo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            Precio del Almuerzo
          </CardTitle>
          <CardDescription>
            Define el precio que pagarán los padres por cada almuerzo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="lunch_price">Precio (S/)</Label>
            <Input
              id="lunch_price"
              type="number"
              step="0.50"
              min="0"
              value={config.lunch_price}
              onChange={(e) =>
                setConfig({ ...config, lunch_price: parseFloat(e.target.value) || 0 })
              }
              disabled={!canEdit}
              className="text-lg font-bold"
            />
            <p className="text-sm text-gray-500">
              Ejemplo: Con S/ {config.lunch_price.toFixed(2)}, si un padre pide 5 almuerzos para 2 hijos, pagará{' '}
              <span className="font-bold">S/ {(config.lunch_price * 5 * 2).toFixed(2)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Límites para Pedidos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Límites para Realizar Pedidos
          </CardTitle>
          <CardDescription>
            Define hasta cuándo los padres pueden hacer pedidos de almuerzo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="order_deadline_time">Hora Límite</Label>
              <Input
                id="order_deadline_time"
                type="time"
                value={config.order_deadline_time.slice(0, 5)}
                onChange={(e) =>
                  setConfig({ ...config, order_deadline_time: e.target.value + ':00' })
                }
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="order_deadline_days">Días de Anticipación</Label>
              <Input
                id="order_deadline_days"
                type="number"
                min="0"
                max="7"
                value={config.order_deadline_days}
                onChange={(e) =>
                  setConfig({ ...config, order_deadline_days: parseInt(e.target.value) || 0 })
                }
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Ejemplo:</strong> Si configuras <strong>{config.order_deadline_time.slice(0, 5)}</strong> y{' '}
              <strong>{config.order_deadline_days} día(s)</strong> de anticipación, los padres podrán pedir almuerzos hasta las{' '}
              <strong>{config.order_deadline_time.slice(0, 5)}</strong> del día{' '}
              {config.order_deadline_days === 0
                ? 'mismo'
                : config.order_deadline_days === 1
                ? 'anterior'
                : `${config.order_deadline_days} días antes`}
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Límites para Cancelaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Límites para Cancelar Pedidos
          </CardTitle>
          <CardDescription>
            Define hasta cuándo los padres pueden cancelar pedidos ya realizados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cancellation_deadline_time">Hora Límite</Label>
              <Input
                id="cancellation_deadline_time"
                type="time"
                value={config.cancellation_deadline_time.slice(0, 5)}
                onChange={(e) =>
                  setConfig({ ...config, cancellation_deadline_time: e.target.value + ':00' })
                }
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancellation_deadline_days">Días de Anticipación</Label>
              <Input
                id="cancellation_deadline_days"
                type="number"
                min="0"
                max="7"
                value={config.cancellation_deadline_days}
                onChange={(e) =>
                  setConfig({ ...config, cancellation_deadline_days: parseInt(e.target.value) || 0 })
                }
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-orange-800">
              <strong>Ejemplo:</strong> Si configuras <strong>{config.cancellation_deadline_time.slice(0, 5)}</strong> y{' '}
              <strong>{config.cancellation_deadline_days} día(s)</strong>, los padres podrán cancelar hasta las{' '}
              <strong>{config.cancellation_deadline_time.slice(0, 5)}</strong> del{' '}
              {config.cancellation_deadline_days === 0
                ? 'mismo día'
                : config.cancellation_deadline_days === 1
                ? 'día anterior'
                : `${config.cancellation_deadline_days} días antes`}
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cierre Automático del Día */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-purple-600" />
            Cierre Automático del Día
          </CardTitle>
          <CardDescription>
            Configura el horario de entregas y el cierre automático al final del día
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Switch de cierre automático */}
          <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
            <div>
              <Label htmlFor="auto_close_day" className="text-base font-semibold">
                Cerrar día automáticamente
              </Label>
              <p className="text-sm text-gray-600 mt-1">
                Al llegar a la hora configurada, el sistema cierra el día y pasa al siguiente
              </p>
            </div>
            <Switch
              id="auto_close_day"
              checked={config.auto_close_day ?? true}
              onCheckedChange={(checked) =>
                setConfig({ ...config, auto_close_day: checked })
              }
              disabled={!canEdit}
            />
          </div>

          {/* Horario de entregas */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="delivery_start_time">Hora de Inicio de Entregas</Label>
              <Input
                id="delivery_start_time"
                type="time"
                value={(config.delivery_start_time ?? '07:00:00').slice(0, 5)}
                onChange={(e) =>
                  setConfig({ ...config, delivery_start_time: e.target.value + ':00' })
                }
                disabled={!canEdit}
              />
              <p className="text-xs text-gray-500">
                Hora en que comienza la entrega de almuerzos
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery_end_time">Hora de Cierre del Día</Label>
              <Input
                id="delivery_end_time"
                type="time"
                value={(config.delivery_end_time ?? '17:00:00').slice(0, 5)}
                onChange={(e) =>
                  setConfig({ ...config, delivery_end_time: e.target.value + ':00' })
                }
                disabled={!canEdit}
              />
              <p className="text-xs text-gray-500">
                Después de esta hora, el sistema pasa al día siguiente
              </p>
            </div>
          </div>

          {/* Opción de marcar como entregado */}
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
            <div className="flex-1">
              <Label htmlFor="auto_mark_as_delivered" className="text-base font-semibold">
                Marcar automáticamente como "Entregado"
              </Label>
              <p className="text-sm text-gray-600 mt-1">
                Al cerrar el día, los pedidos "Confirmados" se marcarán como "Entregados" automáticamente
              </p>
            </div>
            <Switch
              id="auto_mark_as_delivered"
              checked={config.auto_mark_as_delivered ?? true}
              onCheckedChange={(checked) =>
                setConfig({ ...config, auto_mark_as_delivered: checked })
              }
              disabled={!canEdit || !config.auto_close_day}
            />
          </div>

          {/* Ejemplo visual */}
          {config.auto_close_day && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-800">
                <strong>🕐 Funcionamiento:</strong>
              </p>
              <ul className="text-sm text-purple-800 mt-2 space-y-1 list-disc list-inside">
                <li>
                  Las entregas comienzan a las <strong>{(config.delivery_start_time ?? '07:00:00').slice(0, 5)}</strong>
                </li>
                <li>
                  A las <strong>{(config.delivery_end_time ?? '17:00:00').slice(0, 5)}</strong>, el sistema cierra el día automáticamente
                </li>
                {config.auto_mark_as_delivered && (
                  <li>
                    Los pedidos "Confirmados" se marcarán como "Entregados"
                  </li>
                )}
                <li>
                  La pantalla del admin pasará automáticamente a mostrar los pedidos del día siguiente
                </li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Botón Guardar */}
      {canEdit && (
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            size="lg"
            className="bg-green-600 hover:bg-green-700"
          >
            {saving ? (
              <>Guardando...</>
            ) : (
              <>
                <Save className="h-5 w-5 mr-2" />
                Guardar Configuración
              </>
            )}
          </Button>
        </div>
      )}

      {!canEdit && (
        <Card className="bg-gray-50">
          <CardContent className="py-4 text-center text-sm text-gray-600">
            <AlertCircle className="h-5 w-5 inline mr-2" />
            No tienes permisos para editar esta configuración
          </CardContent>
        </Card>
      )}
    </div>
  );
}
