import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Wrench,
  Loader2,
  Save,
  Plus,
  X,
  AlertTriangle,
  ShieldCheck,
  Mail,
  UtensilsCrossed,
  CreditCard,
  School,
  Globe,
  Power,
  PowerOff,
  Clock,
} from 'lucide-react';

// Módulos disponibles para poner en mantenimiento
const AVAILABLE_MODULES = [
  // ── Portal de Padres ──
  {
    key: 'almuerzos_padres',
    label: 'Almuerzos (Portal Padres)',
    icon: UtensilsCrossed,
    description: 'Módulo de pedidos de almuerzos para padres de familia',
    group: 'padres',
  },
  {
    key: 'pagos_padres',
    label: 'Pagos (Portal Padres)',
    icon: CreditCard,
    description: 'Módulo de pagos y recargas para padres de familia',
    group: 'padres',
  },
  // ── Módulos de Administración (nombres exactos del Dashboard) ──
  {
    key: 'pos_admin',
    label: 'Punto de Venta',
    icon: CreditCard,
    description: 'Sistema de cobro y ventas',
    group: 'admin',
  },
  {
    key: 'ventas_admin',
    label: 'Lista de Ventas',
    icon: CreditCard,
    description: 'Historial y reportes del día',
    group: 'admin',
  },
  {
    key: 'cobranzas_admin',
    label: 'Cobranzas',
    icon: CreditCard,
    description: 'Gestión de cuentas por cobrar',
    group: 'admin',
  },
  {
    key: 'config_padres_admin',
    label: 'Config. Padres y Profesores',
    icon: CreditCard,
    description: 'Gestión de padres, profesores y estudiantes',
    group: 'admin',
  },
  {
    key: 'productos_admin',
    label: 'Productos',
    icon: CreditCard,
    description: 'Gestión de productos, promociones y menús',
    group: 'admin',
  },
  {
    key: 'almuerzos_admin',
    label: 'Calendario de Almuerzos',
    icon: UtensilsCrossed,
    description: 'Gestión de menús escolares',
    group: 'admin',
  },
  {
    key: 'admin_sede_admin',
    label: 'Administración de Sede',
    icon: CreditCard,
    description: 'Pedidos, calendario y tarjetas ID',
    group: 'admin',
  },
  {
    key: 'caja_admin',
    label: 'Cierre de Caja',
    icon: CreditCard,
    description: 'Gestión de caja, ingresos, egresos y cierre diario',
    group: 'admin',
  },
  {
    key: 'comedor_admin',
    label: 'Vista Cocina',
    icon: UtensilsCrossed,
    description: 'Pedidos del día, variaciones y estadísticas de preferencias',
    group: 'admin',
  },
  {
    key: 'logistica_admin',
    label: 'Logística / Almacén',
    icon: CreditCard,
    description: 'Gestión de inventario y almacén',
    group: 'admin',
  },
  {
    key: 'promociones_admin',
    label: 'Combos y Promociones',
    icon: CreditCard,
    description: 'Gestión de combos y ofertas',
    group: 'admin',
  },
  {
    key: 'facturacion_admin',
    label: 'Facturación Electrónica',
    icon: CreditCard,
    description: 'Emisión de boletas y facturas SUNAT',
    group: 'admin',
  },
  {
    key: 'finanzas_admin',
    label: 'Finanzas / Tesorería',
    icon: CreditCard,
    description: 'Reportes financieros y tesorería',
    group: 'admin',
  },
  {
    key: 'dashboard_admin',
    label: 'Dashboard (Panel Principal)',
    icon: CreditCard,
    description: 'Panel principal de módulos',
    group: 'admin',
  },
];

interface MaintenanceConfigData {
  id?: string;
  school_id: string;
  module_key: string;
  enabled: boolean;
  title: string;
  message: string;
  bypass_emails: string[];
  schedule_start: string | null;
  schedule_end: string | null;
}

interface Props {
  schoolId: string | null;
}

export function MaintenanceConfig({ schoolId: propSchoolId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configs, setConfigs] = useState<Record<string, MaintenanceConfigData>>({});
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [togglingGlobal, setTogglingGlobal] = useState(false);

  // ── Si admin_general no tiene sede, permitir seleccionar una ──
  const [allSchools, setAllSchools] = useState<{ id: string; name: string }[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(propSchoolId);
  const schoolId = propSchoolId || selectedSchoolId;

  useEffect(() => {
    if (!propSchoolId) {
      // Admin general: cargar lista de sedes
      supabase.from('schools').select('id, name').order('name').then(({ data }) => {
        setAllSchools(data || []);
        if (!selectedSchoolId && data && data.length > 0) {
          setSelectedSchoolId(data[0].id);
        }
        if (!data || data.length === 0) setLoading(false);
      });
    }
  }, [propSchoolId]);

  useEffect(() => {
    if (schoolId) {
      fetchConfigs();
    } else {
      setLoading(false);
    }
  }, [schoolId]);

  const fetchConfigs = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('maintenance_config')
        .select('*')
        .eq('school_id', schoolId);

      if (error) throw error;

      const configMap: Record<string, MaintenanceConfigData> = {};
      // Inicializar con defaults para todos los módulos
      AVAILABLE_MODULES.forEach((mod) => {
        configMap[mod.key] = {
          school_id: schoolId,
          module_key: mod.key,
          enabled: false,
          title: `Módulo de ${mod.label.split(' (')[0]} en Mantenimiento`,
          message: `Estamos preparando el módulo de ${mod.label.split(' (')[0].toLowerCase()} para ofrecerte la mejor experiencia. ¡Gracias por tu paciencia!`,
          bypass_emails: [],
          schedule_start: null,
          schedule_end: null,
        };
      });

      // Sobrescribir con datos de la DB
      data?.forEach((row: any) => {
        configMap[row.module_key] = {
          id: row.id,
          school_id: row.school_id,
          module_key: row.module_key,
          enabled: row.enabled,
          title: row.title,
          message: row.message,
          bypass_emails: row.bypass_emails || [],
          schedule_start: row.schedule_start || null,
          schedule_end: row.schedule_end || null,
        };
      });

      setConfigs(configMap);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar la configuración de mantenimiento.' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (moduleKey: string, enabled: boolean) => {
    if (!schoolId || !user) return;
    setConfigs((prev) => ({
      ...prev,
      [moduleKey]: { ...prev[moduleKey], enabled },
    }));

    try {
      const cfg = configs[moduleKey];
      const { error } = await supabase
        .from('maintenance_config')
        .upsert({
          school_id: schoolId,
          module_key: moduleKey,
          enabled,
          title: cfg?.title || `Módulo en Mantenimiento`,
          message: cfg?.message || 'Estamos trabajando para mejorar tu experiencia.',
          bypass_emails: cfg?.bypass_emails || [],
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'school_id,module_key' });

      if (error) throw error;
      toast({
        title: enabled ? '🔧 Mantenimiento activado' : '✅ Módulo habilitado',
        description: `${AVAILABLE_MODULES.find(m => m.key === moduleKey)?.label || moduleKey} ${enabled ? 'está ahora en mantenimiento' : 'ya está disponible para los padres'}.`,
      });
    } catch (e: any) {
      setConfigs((prev) => ({
        ...prev,
        [moduleKey]: { ...prev[moduleKey], enabled: !enabled },
      }));
      toast({ variant: 'destructive', title: 'Error', description: e?.message });
    }
  };

  const handleGlobalToggle = async (enabled: boolean) => {
    if (!user || allSchools.length === 0) return;
    setTogglingGlobal(true);
    try {
      const rows: any[] = [];
      for (const school of allSchools) {
        for (const mod of AVAILABLE_MODULES) {
          rows.push({
            school_id: school.id,
            module_key: mod.key,
            enabled,
            title: configs[mod.key]?.title || `Módulo de ${mod.label.split(' (')[0]} en Mantenimiento`,
            message: configs[mod.key]?.message || `Estamos preparando el módulo de ${mod.label.split(' (')[0].toLowerCase()} para ofrecerte la mejor experiencia.`,
            bypass_emails: configs[mod.key]?.bypass_emails || [],
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          });
        }
      }

      const { error } = await supabase
        .from('maintenance_config')
        .upsert(rows, { onConflict: 'school_id,module_key' });

      if (error) throw error;

      toast({
        title: enabled ? '🔧 Mantenimiento GLOBAL activado' : '✅ Todas las sedes habilitadas',
        description: enabled
          ? `Se activó mantenimiento en ${allSchools.length} sedes para todos los módulos.`
          : `Se desactivó mantenimiento en ${allSchools.length} sedes. Los padres ya pueden usar el sistema.`,
      });

      fetchConfigs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al aplicar globalmente', description: e?.message });
    } finally {
      setTogglingGlobal(false);
    }
  };

  const handleFieldChange = (moduleKey: string, field: 'title' | 'message', value: string) => {
    setConfigs((prev) => ({
      ...prev,
      [moduleKey]: { ...prev[moduleKey], [field]: value },
    }));
  };

  const handleScheduleChange = (moduleKey: string, field: 'schedule_start' | 'schedule_end', value: string | null) => {
    setConfigs((prev) => ({
      ...prev,
      [moduleKey]: { ...prev[moduleKey], [field]: value },
    }));
  };

  const handleAddEmail = (moduleKey: string) => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      toast({ variant: 'destructive', title: 'Correo inválido', description: 'Ingresa un correo válido.' });
      return;
    }
    const current = configs[moduleKey]?.bypass_emails || [];
    if (current.includes(email)) {
      toast({ variant: 'destructive', title: 'Ya existe', description: 'Este correo ya está en la lista.' });
      return;
    }
    setConfigs((prev) => ({
      ...prev,
      [moduleKey]: {
        ...prev[moduleKey],
        bypass_emails: [...current, email],
      },
    }));
    setNewEmail('');
  };

  const handleRemoveEmail = (moduleKey: string, email: string) => {
    setConfigs((prev) => ({
      ...prev,
      [moduleKey]: {
        ...prev[moduleKey],
        bypass_emails: prev[moduleKey].bypass_emails.filter((e) => e !== email),
      },
    }));
  };

  const handleSave = async () => {
    if (!schoolId || !user) return;
    setSaving(true);
    try {
      for (const moduleKey of Object.keys(configs)) {
        const cfg = configs[moduleKey];
        const payload = {
          school_id: schoolId,
          module_key: moduleKey,
          enabled: cfg.enabled,
          title: cfg.title,
          message: cfg.message,
          bypass_emails: cfg.bypass_emails,
          schedule_start: cfg.schedule_start || null,
          schedule_end: cfg.schedule_end || null,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from('maintenance_config')
          .upsert(payload, { onConflict: 'school_id,module_key' });

        if (error) throw error;
      }

      toast({ title: '✅ Configuración guardada', description: 'El modo mantenimiento se actualizó correctamente.' });
      fetchConfigs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        <p className="ml-3 text-gray-600">Cargando configuración de mantenimiento...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 bg-amber-500 rounded-lg">
              <Wrench className="h-6 w-6 text-white" />
            </div>
            Modo Mantenimiento
          </CardTitle>
          <CardDescription className="text-sm">
            Controla qué módulos del portal de padres están disponibles. Agrega tu correo de prueba para verlos tú solo.
          </CardDescription>
        </CardHeader>

        {/* Selector de sede para admin_general */}
        {!propSchoolId && allSchools.length > 0 && (
          <CardContent className="pt-0 space-y-4">
            <div className="flex items-center gap-3">
              <School className="h-5 w-5 text-amber-700 shrink-0" />
              <Select
                value={selectedSchoolId || ''}
                onValueChange={(val) => setSelectedSchoolId(val)}
              >
                <SelectTrigger className="border-2 border-amber-300 bg-white">
                  <SelectValue placeholder="Selecciona una sede" />
                </SelectTrigger>
                <SelectContent>
                  {allSchools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Toggle global único para TODAS las sedes */}
            <div className={`border-2 rounded-xl p-4 space-y-3 transition-colors ${
              allSchools.length > 0 && configs[AVAILABLE_MODULES[0].key]?.enabled
                ? 'border-red-400 bg-red-50'
                : 'border-green-400 bg-green-50'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className={`h-5 w-5 ${
                    configs[AVAILABLE_MODULES[0].key]?.enabled ? 'text-red-600' : 'text-green-600'
                  }`} />
                  <div>
                    <span className={`font-semibold text-sm ${
                      configs[AVAILABLE_MODULES[0].key]?.enabled ? 'text-red-800' : 'text-green-800'
                    }`}>
                      Control Global — {allSchools.length} sedes
                    </span>
                    <p className={`text-xs mt-0.5 ${
                      configs[AVAILABLE_MODULES[0].key]?.enabled ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {configs[AVAILABLE_MODULES[0].key]?.enabled
                        ? '🔧 Mantenimiento ACTIVO en todas las sedes'
                        : '✅ Todas las sedes operativas'}
                    </p>
                  </div>
                </div>
                <Button
                  variant={configs[AVAILABLE_MODULES[0].key]?.enabled ? 'destructive' : 'outline'}
                  className={`h-11 px-6 gap-2 font-semibold transition-all ${
                    !configs[AVAILABLE_MODULES[0].key]?.enabled
                      ? 'border-green-500 text-green-700 hover:bg-green-100'
                      : ''
                  }`}
                  disabled={togglingGlobal}
                  onClick={() => handleGlobalToggle(!configs[AVAILABLE_MODULES[0].key]?.enabled)}
                >
                  {togglingGlobal
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : configs[AVAILABLE_MODULES[0].key]?.enabled
                      ? <><PowerOff className="h-4 w-4" /> Desactivar todo</>
                      : <><Power className="h-4 w-4" /> Activar en todas</>
                  }
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                Activa o desactiva el mantenimiento en <strong>todas las sedes</strong> simultáneamente para todos los módulos.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Módulos por Mantenimiento */}
      {(['padres', 'admin'] as const).map((group) => {
        const groupModules = AVAILABLE_MODULES.filter(m => m.group === group);
        const groupLabel = group === 'padres' ? 'Portal de Padres' : 'Módulos de Administración';
        const groupDesc = group === 'padres'
          ? 'Controla qué módulos del portal de padres están disponibles.'
          : 'Controla qué módulos de administración están disponibles. Solo el Admin General puede acceder cuando están en mantenimiento.';

        return (
          <Card key={group} className="border-2 shadow-lg">
            <CardHeader className={`border-b-2 ${group === 'admin' ? 'bg-gradient-to-r from-red-50 to-orange-50' : 'bg-gradient-to-r from-gray-50 to-slate-50'}`}>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wrench className={`h-5 w-5 ${group === 'admin' ? 'text-red-600' : 'text-amber-600'}`} />
                {groupLabel}
              </CardTitle>
              <CardDescription>{groupDesc}</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {groupModules.map((mod) => {
                const cfg = configs[mod.key];
                const Icon = mod.icon;
                const isExpanded = expandedModule === mod.key;

                return (
                  <div key={mod.key} className="border-2 rounded-xl overflow-hidden transition-all">
                    {/* Módulo Header */}
                    <div
                      className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
                        cfg?.enabled
                          ? group === 'admin' ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'
                          : 'bg-white hover:bg-gray-50'
                      }`}
                      onClick={() => setExpandedModule(isExpanded ? null : mod.key)}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 text-gray-600" />
                        <span className="font-semibold text-gray-900">{mod.label}</span>
                        {cfg?.enabled && (
                          <Badge className={`${group === 'admin' ? 'bg-red-100 text-red-800 border-red-300' : 'bg-amber-100 text-amber-800 border-amber-300'} border`}>
                            <Wrench className="h-3 w-3 mr-1" />
                            En Mantenimiento
                          </Badge>
                        )}
                        {cfg?.schedule_start && cfg?.schedule_end && (
                          <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">
                            {cfg.schedule_start.slice(0, 5)} — {cfg.schedule_end.slice(0, 5)}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">
                          {cfg?.enabled ? 'Desactivar' : 'Activar'}
                        </span>
                        <Switch
                          checked={cfg?.enabled || false}
                          onCheckedChange={(checked) => {
                            handleToggle(mod.key, checked);
                            if (checked && !isExpanded) setExpandedModule(mod.key);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>

                    {/* Módulo Expandido */}
                    {isExpanded && (
                      <div className="border-t-2 p-4 bg-white space-y-5">
                        <div className="flex items-center gap-2 text-amber-700 font-semibold">
                          <Wrench className="h-4 w-4" />
                          Editar: {mod.label}
                        </div>

                        {/* Título */}
                        <div className="space-y-1">
                          <Label className="text-sm font-medium text-gray-700">Título que ven los usuarios</Label>
                          <Input
                            value={cfg?.title || ''}
                            onChange={(e) => handleFieldChange(mod.key, 'title', e.target.value)}
                            placeholder="Módulo en Mantenimiento"
                            className="border-2"
                          />
                        </div>

                        {/* Mensaje */}
                        <div className="space-y-1">
                          <Label className="text-sm font-medium text-gray-700">Mensaje</Label>
                          <Textarea
                            value={cfg?.message || ''}
                            onChange={(e) => handleFieldChange(mod.key, 'message', e.target.value)}
                            placeholder="Estamos trabajando para mejorar..."
                            rows={3}
                            className="border-2"
                          />
                        </div>

                        {/* Horario Automático */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-600" />
                            <Label className="text-sm font-medium text-gray-700">
                              Horario automático (opcional)
                            </Label>
                          </div>
                          <p className="text-xs text-gray-400">
                            Si configuras un horario, el mantenimiento se activa y desactiva automáticamente todos los días en ese rango (hora de Lima).
                          </p>
                          <div className="flex gap-3 items-center">
                            <div className="flex-1">
                              <Label className="text-xs text-gray-500">Inicio</Label>
                              <Input
                                type="time"
                                value={cfg?.schedule_start || ''}
                                onChange={(e) => handleScheduleChange(mod.key, 'schedule_start', e.target.value || null)}
                                className="border-2"
                              />
                            </div>
                            <span className="text-gray-400 mt-5">a</span>
                            <div className="flex-1">
                              <Label className="text-xs text-gray-500">Fin</Label>
                              <Input
                                type="time"
                                value={cfg?.schedule_end || ''}
                                onChange={(e) => handleScheduleChange(mod.key, 'schedule_end', e.target.value || null)}
                                className="border-2"
                              />
                            </div>
                            {(cfg?.schedule_start || cfg?.schedule_end) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-5 text-red-500 hover:text-red-700"
                                onClick={() => {
                                  handleScheduleChange(mod.key, 'schedule_start', null);
                                  handleScheduleChange(mod.key, 'schedule_end', null);
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Bypass Emails */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-green-600" />
                            <Label className="text-sm font-medium text-gray-700">
                              Correos bypass (ven el módulo aunque esté en mantenimiento)
                            </Label>
                          </div>

                          {cfg?.bypass_emails?.length === 0 ? (
                            <p className="text-xs text-amber-600 italic">Sin correos bypass</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {cfg?.bypass_emails?.map((email) => (
                                <Badge
                                  key={email}
                                  variant="secondary"
                                  className="bg-green-50 text-green-700 border border-green-200 pl-2 pr-1 py-1 text-xs"
                                >
                                  <Mail className="h-3 w-3 mr-1" />
                                  {email}
                                  <button
                                    onClick={() => handleRemoveEmail(mod.key, email)}
                                    className="ml-1 p-0.5 rounded-full hover:bg-red-100 transition-colors"
                                  >
                                    <X className="h-3 w-3 text-red-500" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Input
                              value={newEmail}
                              onChange={(e) => setNewEmail(e.target.value)}
                              placeholder="correo@ejemplo.com"
                              className="border-2 flex-1"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddEmail(mod.key);
                                }
                              }}
                            />
                            <Button
                              variant="outline"
                              onClick={() => handleAddEmail(mod.key)}
                              className="shrink-0"
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Agregar
                            </Button>
                          </div>
                        </div>

                        {/* Warning si está activo */}
                        {cfg?.enabled && (
                          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3 flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                            <p className="text-sm text-red-700">
                              <strong>Mantenimiento ACTIVO:</strong> Los usuarios {group === 'padres' ? 'padres' : 'de sede (excepto Admin General)'} verán la pantalla de mantenimiento.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {/* Botón Guardar */}
      <Button
        onClick={handleSave}
        disabled={saving || !schoolId}
        className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 h-12 text-base shadow-lg"
      >
        {saving ? (
          <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Guardando...</>
        ) : (
          <><Save className="h-5 w-5 mr-2" /> Guardar Configuración</>
        )}
      </Button>
    </div>
  );
}
