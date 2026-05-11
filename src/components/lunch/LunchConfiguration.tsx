import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  DollarSign,
  Clock,
  AlertCircle,
  Save,
  Settings,
  CheckCircle2,
  Globe,
  School,
} from 'lucide-react';

interface LunchConfigurationProps {
  schoolId: string | null;
  canEdit: boolean;
}

interface SchoolOption {
  id: string;
  name: string;
}

/** Configuración por sede (cancelaciones, delivery, precio). */
interface SedeLunchConfig {
  id: string;
  school_id: string;
  lunch_price: number;
  cancellation_deadline_time: string;
  cancellation_deadline_days: number;
  orders_enabled: boolean;
  force_prepayment?: boolean;
  delivery_start_time?: string;
  delivery_end_time?: string;
  auto_close_day?: boolean;
  auto_mark_as_delivered?: boolean;
}

/** Horario global de pedidos (system_status id=1). */
interface GlobalDeadlineConfig {
  global_lunch_deadline_time: string;
  global_lunch_deadline_days: number;
}

const GLOBAL_FALLBACK: GlobalDeadlineConfig = {
  global_lunch_deadline_time: '09:15:00',
  global_lunch_deadline_days: 0,
};

export function LunchConfiguration({ schoolId, canEdit }: LunchConfigurationProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [sedeConfig, setSedeConfig]     = useState<SedeLunchConfig | null>(null);
  const [globalDeadline, setGlobalDeadline] = useState<GlobalDeadlineConfig>(GLOBAL_FALLBACK);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(schoolId);

  useEffect(() => {
    setSelectedSchoolId(schoolId);
  }, [schoolId]);

  useEffect(() => {
    loadSchools();
  }, []);

  useEffect(() => {
    loadConfiguration(selectedSchoolId);
  }, [selectedSchoolId]);

  const loadSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id,name')
        .order('name', { ascending: true });

      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error loading schools:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las sedes' });
    }
  };

  const loadConfiguration = async (targetSchoolId: string | null) => {
    setLoading(true);
    try {
      // Siempre cargar deadline global, haya o no sede elegida
      const { data: globalData, error: globalError } = await supabase
        .from('system_status')
        .select('global_lunch_deadline_time,global_lunch_deadline_days')
        .eq('id', 1)
        .maybeSingle();

      if (!globalError && globalData) {
        setGlobalDeadline({
          global_lunch_deadline_time: globalData.global_lunch_deadline_time ?? GLOBAL_FALLBACK.global_lunch_deadline_time,
          global_lunch_deadline_days: globalData.global_lunch_deadline_days ?? GLOBAL_FALLBACK.global_lunch_deadline_days,
        });
      }

      if (!targetSchoolId) {
        setSedeConfig(null);
        return;
      }

      const { data: existingSedeConfig, error: sedeError } = await supabase
        .from('lunch_configuration')
        .select('id,school_id,lunch_price,cancellation_deadline_time,cancellation_deadline_days,orders_enabled,force_prepayment,delivery_start_time,delivery_end_time,auto_close_day,auto_mark_as_delivered')
        .eq('school_id', targetSchoolId)
        .single();

      if (sedeError && sedeError.code !== 'PGRST116') throw sedeError;

      if (existingSedeConfig) {
        setSedeConfig(existingSedeConfig);
      } else {
        // Crear config por defecto para la sede si no existe
        const { data: newConfig, error: insertError } = await supabase
          .from('lunch_configuration')
          .insert({
            school_id: targetSchoolId,
            lunch_price: 7.50,
            cancellation_deadline_time: '07:00:00',
            cancellation_deadline_days: 0,
            orders_enabled: true,
            force_prepayment: false,
            delivery_start_time: '07:00:00',
            delivery_end_time: '17:00:00',
            auto_close_day: true,
            auto_mark_as_delivered: true,
          })
          .select('id,school_id,lunch_price,cancellation_deadline_time,cancellation_deadline_days,orders_enabled,force_prepayment,delivery_start_time,delivery_end_time,auto_close_day,auto_mark_as_delivered')
          .single();
        if (insertError) throw insertError;
        setSedeConfig(newConfig);
      }
    } catch (error: any) {
      console.error('Error loading configuration:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar la configuración' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      // 1. Guardar deadline GLOBAL via RPC segura (valida rol admin_general/superadmin en servidor).
      //    Si el usuario no tiene el rol, la función devuelve {success: false, error: '...'}.
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_global_lunch_deadline',
        {
          p_deadline_time: globalDeadline.global_lunch_deadline_time,
          p_deadline_days: globalDeadline.global_lunch_deadline_days,
        }
      );

      if (rpcError) throw rpcError;

      if (rpcResult && !rpcResult.success) {
        toast({
          variant: 'destructive',
          title: 'Sin permisos',
          description: rpcResult.error ?? 'No se pudo actualizar el límite global.',
        });
        setSaving(false);
        return;
      }

      // 2. Guardar config de sede si hay sede seleccionada.
      if (selectedSchoolId && sedeConfig) {
        const { error: sedeError } = await supabase
          .from('lunch_configuration')
          .update({
            lunch_price:                sedeConfig.lunch_price,
            cancellation_deadline_time: sedeConfig.cancellation_deadline_time,
            cancellation_deadline_days: sedeConfig.cancellation_deadline_days,
            orders_enabled:             sedeConfig.orders_enabled,
            force_prepayment:           sedeConfig.force_prepayment ?? false,
            delivery_start_time:        sedeConfig.delivery_start_time,
            delivery_end_time:          sedeConfig.delivery_end_time,
            auto_close_day:             sedeConfig.auto_close_day,
            auto_mark_as_delivered:     sedeConfig.auto_mark_as_delivered,
          })
          .eq('id', sedeConfig.id);
        if (sedeError) throw sedeError;
      }

      toast({
        title: '✅ Configuración Guardada',
        description: selectedSchoolId
          ? 'El límite global y la configuración de sede se aplicaron correctamente.'
          : 'Se guardó la configuración global. Selecciona una sede para guardar opciones por sede.',
      });
    } catch (error: any) {
      console.error('❌ Error saving configuration:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la configuración' });
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

  const deadlineHHMM = globalDeadline.global_lunch_deadline_time.slice(0, 5);
  const deadlineDays  = globalDeadline.global_lunch_deadline_days;
  const canEditPerSede = canEdit && !!selectedSchoolId && !!sedeConfig;

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

      {/* ⚠️ Banner GLOBAL */}
      <div className="flex items-start gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3">
        <Globe className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm font-semibold text-amber-800">
          ⚠️ Configuración GLOBAL: La sección "Límites para Realizar Pedidos" aplica a{' '}
          <strong>todas las sedes, alumnos y profesores del sistema</strong>.
          Los cambios se propagan instantáneamente.
        </p>
      </div>

      {/* Selector de sede */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <School className="h-5 w-5 text-blue-600" />
            Sede a Configurar
          </CardTitle>
          <CardDescription>
            Selecciona la sede para editar las secciones marcadas como <strong>Por sede</strong>. Las secciones GLOBAL aplican a todo el sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedSchoolId ?? '__none__'}
            onValueChange={(value) => setSelectedSchoolId(value === '__none__' ? null : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona una sede" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin seleccionar</SelectItem>
              {schools.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!selectedSchoolId && (
        <Card className="border-dashed border-amber-300 bg-amber-50/50">
          <CardContent className="py-4 text-sm text-amber-800 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Por favor, selecciona una sede para configurar.
          </CardContent>
        </Card>
      )}

      {sedeConfig ? (
        <>
          {/* Estado del Sistema (por sede) */}
          <Card className={sedeConfig.orders_enabled ? 'border-green-500 border-2' : 'border-red-500 border-2'}>
            <CardHeader className={sedeConfig.orders_enabled ? 'bg-green-50' : 'bg-red-50'}>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {sedeConfig.orders_enabled ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                    Estado del Sistema
                  </CardTitle>
                  <CardDescription>
                    {sedeConfig.orders_enabled
                      ? 'Los padres pueden realizar pedidos de almuerzo'
                      : 'Sistema de pedidos deshabilitado'}
                  </CardDescription>
                </div>
                <Switch
                  checked={sedeConfig.orders_enabled}
                  onCheckedChange={(checked) => setSedeConfig((prev) => (prev ? { ...prev, orders_enabled: checked } : prev))}
                  disabled={!canEditPerSede}
                />
              </div>
            </CardHeader>
          </Card>

          {/* ── CONTROL DE PAGOS (por sede) ─────────────────────────────────────── */}
          <Card className={sedeConfig.force_prepayment ? 'border-amber-400 border-2' : ''}>
            <CardHeader className={sedeConfig.force_prepayment ? 'bg-amber-50' : ''}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-amber-600" />
                    Control de Pagos (Por Sede)
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Si se activa, los pedidos de esta sede nacerán "congelados" y solo pasarán a cocina cuando el pago sea confirmado por la pasarela o validado manualmente.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Label htmlFor="force_prepayment" className="text-sm font-medium">
                    Exigir pago al contado (Modo Prepago)
                  </Label>
                  <Switch
                    id="force_prepayment"
                    checked={sedeConfig.force_prepayment ?? false}
                    onCheckedChange={(checked) => setSedeConfig((prev) => (prev ? { ...prev, force_prepayment: checked } : prev))}
                    disabled={!canEditPerSede}
                  />
                </div>
              </div>
            </CardHeader>
          </Card>
        </>
      ) : (
        selectedSchoolId && (
          <Card className="border-dashed border-red-300 bg-red-50/40">
            <CardContent className="py-4 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              No se pudo cargar la configuración de la sede seleccionada.
            </CardContent>
          </Card>
        )
      )}

      {/* ── DEADLINE GLOBAL ─────────────────────────────────────────────────── */}
      <Card className="border-amber-300 border-2">
        <CardHeader className="bg-amber-50">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-amber-600" />
            Límites para Realizar Pedidos
            <span className="ml-2 text-xs font-normal bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">GLOBAL · Todas las sedes</span>
          </CardTitle>
          <CardDescription>
            Define hasta cuándo los padres y profesores pueden hacer pedidos de almuerzo en <strong>todo el sistema</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="global_deadline_time">Hora Límite</Label>
              <Input
                id="global_deadline_time"
                type="time"
                value={deadlineHHMM}
                onChange={(e) =>
                  setGlobalDeadline({ ...globalDeadline, global_lunch_deadline_time: e.target.value + ':00' })
                }
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="global_deadline_days">Días de Anticipación</Label>
              <Input
                id="global_deadline_days"
                type="number"
                min="0"
                max="7"
                value={deadlineDays}
                onChange={(e) =>
                  setGlobalDeadline({ ...globalDeadline, global_lunch_deadline_days: parseInt(e.target.value) || 0 })
                }
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Ejemplo:</strong> Si configuras <strong>{deadlineHHMM}</strong> y{' '}
              <strong>{deadlineDays} día(s)</strong> de anticipación, los padres podrán pedir almuerzos hasta las{' '}
              <strong>{deadlineHHMM}</strong> del día{' '}
              {deadlineDays === 0
                ? 'mismo'
                : deadlineDays === 1
                ? 'anterior'
                : `${deadlineDays} días antes`}
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── CANCELACIONES (por sede, sigue en lunch_configuration) ──────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Límites para Cancelar Pedidos
            <span className="ml-2 text-xs font-normal bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Por sede</span>
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
                value={sedeConfig?.cancellation_deadline_time?.slice(0, 5) ?? '07:00'}
                onChange={(e) =>
                  setSedeConfig((prev) => (prev ? { ...prev, cancellation_deadline_time: e.target.value + ':00' } : prev))
                }
                disabled={!canEditPerSede}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancellation_deadline_days">Días de Anticipación</Label>
              <Input
                id="cancellation_deadline_days"
                type="number"
                min="0"
                max="7"
                value={sedeConfig?.cancellation_deadline_days ?? 0}
                onChange={(e) =>
                  setSedeConfig((prev) => (prev ? { ...prev, cancellation_deadline_days: parseInt(e.target.value) || 0 } : prev))
                }
                disabled={!canEditPerSede}
              />
            </div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-orange-800">
              <strong>Ejemplo:</strong> Si configuras{' '}
              <strong>{sedeConfig?.cancellation_deadline_time?.slice(0, 5) ?? '07:00'}</strong> y{' '}
              <strong>{sedeConfig?.cancellation_deadline_days ?? 0} día(s)</strong>, los padres podrán cancelar hasta las{' '}
              <strong>{sedeConfig?.cancellation_deadline_time?.slice(0, 5) ?? '07:00'}</strong> del{' '}
              {(sedeConfig?.cancellation_deadline_days ?? 0) === 0
                ? 'mismo día'
                : (sedeConfig?.cancellation_deadline_days ?? 0) === 1
                ? 'día anterior'
                : `${sedeConfig?.cancellation_deadline_days ?? 0} días antes`}
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── CIERRE AUTOMÁTICO (por sede) ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-purple-600" />
            Cierre Automático del Día
            <span className="ml-2 text-xs font-normal bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Por sede</span>
          </CardTitle>
          <CardDescription>
            Configura el horario de entregas y el cierre automático al final del día
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
              checked={sedeConfig?.auto_close_day ?? true}
              onCheckedChange={(checked) => setSedeConfig((prev) => (prev ? { ...prev, auto_close_day: checked } : prev))}
              disabled={!canEditPerSede}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="delivery_start_time">Hora de Inicio de Entregas</Label>
              <Input
                id="delivery_start_time"
                type="time"
                value={(sedeConfig?.delivery_start_time ?? '07:00:00').slice(0, 5)}
                onChange={(e) => setSedeConfig((prev) => (prev ? { ...prev, delivery_start_time: e.target.value + ':00' } : prev))}
                disabled={!canEditPerSede}
              />
              <p className="text-xs text-gray-500">Hora en que comienza la entrega de almuerzos</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery_end_time">Hora de Cierre del Día</Label>
              <Input
                id="delivery_end_time"
                type="time"
                value={(sedeConfig?.delivery_end_time ?? '17:00:00').slice(0, 5)}
                onChange={(e) => setSedeConfig((prev) => (prev ? { ...prev, delivery_end_time: e.target.value + ':00' } : prev))}
                disabled={!canEditPerSede}
              />
              <p className="text-xs text-gray-500">Después de esta hora, el sistema pasa al día siguiente</p>
            </div>
          </div>

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
              checked={sedeConfig?.auto_mark_as_delivered ?? true}
              onCheckedChange={(checked) => setSedeConfig((prev) => (prev ? { ...prev, auto_mark_as_delivered: checked } : prev))}
              disabled={!canEditPerSede || !sedeConfig?.auto_close_day}
            />
          </div>

          {sedeConfig?.auto_close_day && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-800"><strong>🕐 Funcionamiento:</strong></p>
              <ul className="text-sm text-purple-800 mt-2 space-y-1 list-disc list-inside">
                <li>Las entregas comienzan a las <strong>{(sedeConfig?.delivery_start_time ?? '07:00:00').slice(0, 5)}</strong></li>
                <li>A las <strong>{(sedeConfig?.delivery_end_time ?? '17:00:00').slice(0, 5)}</strong>, el sistema cierra el día automáticamente</li>
                {sedeConfig?.auto_mark_as_delivered && (
                  <li>Los pedidos "Confirmados" se marcarán como "Entregados"</li>
                )}
                <li>La pantalla del admin pasará automáticamente a mostrar los pedidos del día siguiente</li>
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
