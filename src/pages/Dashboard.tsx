import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WelcomeHeader } from '@/components/WelcomeHeader';
import { ViewAsSelector } from '@/components/ViewAsSelector';
import { VersionBadge } from '@/components/VersionBadge';
import { UserProfileMenu } from '@/components/admin/UserProfileMenu';
import {
  ShoppingCart,
  DollarSign,
  Users,
  FileSearch,
  FileText,
  TrendingUp,
  Package,
  LogOut,
  Lock,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  UtensilsCrossed,
  BarChart3,
  LineChart,
  Clock,
  RefreshCw,
  Loader2,
  Wifi,
  AlertTriangle,
  Eye,
  XCircle,
  Bell,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface Module {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  route: string;
  is_active: boolean;
  is_enabled: boolean; // Si el usuario tiene acceso
  status: 'functional' | 'coming_soon';
}

const ICON_MAP: { [key: string]: any } = {
  ShoppingCart,
  DollarSign,
  Users,
  FileSearch,
  FileText,
  TrendingUp,
  Package,
  ShieldCheck,
  CreditCard,
  UtensilsCrossed,
  BarChart3,
  LineChart,
};

const COLOR_MAP: { [key: string]: string } = {
  green: 'bg-green-500/10 text-green-600 border-green-500/30',
  emerald: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  red: 'bg-red-500/10 text-red-600 border-red-500/30',
  blue: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  purple: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  orange: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  indigo: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
  pink: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
};

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { role, isStaff } = useRole();
  const { full_name } = useUserProfile();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState<string>('');
  const [forcingUpdate, setForcingUpdate] = useState(false);
  const [cancellationAlerts, setCancellationAlerts] = useState<any[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);

  useEffect(() => {
    if (user && role) {
      fetchUserModules();
      fetchSchoolInfo();
      if (role === 'admin_general') {
        fetchCancellationAlerts();
      }
    }
  }, [user, role]);

  const fetchCancellationAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('cancellation_alerts')
        .select('*')
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!error && data) {
        setCancellationAlerts(data);
      }
    } catch (err) {
      console.error('Error cargando alertas:', err);
    }
  };

  const markAlertRead = async (alertId: string) => {
    const { error } = await supabase
      .from('cancellation_alerts')
      .update({ is_read: true, read_by: user?.id, read_at: new Date().toISOString() })
      .eq('id', alertId);
    if (!error) {
      setCancellationAlerts(prev => prev.filter(a => a.id !== alertId));
    }
  };

  const markAllAlertsRead = async () => {
    const ids = cancellationAlerts.map(a => a.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from('cancellation_alerts')
      .update({ is_read: true, read_by: user?.id, read_at: new Date().toISOString() })
      .in('id', ids);
    if (!error) {
      setCancellationAlerts([]);
      setShowAlerts(false);
    }
  };

  const fetchSchoolInfo = async () => {
    if (!user) return;

    try {
      // Obtener el school_id del perfil del usuario
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.warn('⚠️ No se pudo obtener school_id del usuario');
        return;
      }

      if (!profile?.school_id) {
        // console.log('ℹ️ Usuario sin sede asignada (posiblemente admin general o supervisor de red)');
        return;
      }

      // Obtener el nombre de la sede
      const { data: school, error: schoolError } = await supabase
        .from('schools')
        .select('name')
        .eq('id', profile.school_id)
        .single();

      if (schoolError) {
        console.error('❌ Error obteniendo nombre de sede:', schoolError);
        return;
      }

      if (school) {
        setSchoolName(school.name);
        // console.log('✅ Sede del usuario:', school.name);
      }
    } catch (error) {
      console.error('Error obteniendo información de sede:', error);
    }
  };

  const fetchUserModules = async () => {
    // ✅ FIX: Verificación más robusta
    if (!user || !role) {
      // console.log('⚠️ No se puede cargar módulos: user o role faltante');
      return;
    }

    try {
      setLoading(true);
      // console.log('🔍 Cargando módulos para usuario:', user.id, 'Rol:', role);

      // Definir todos los módulos disponibles
      const allModules = [
        {
          id: '1',
          code: 'pos',
          name: 'Punto de Venta',
          description: 'Sistema de cobro y ventas',
          icon: 'ShoppingCart',
          color: 'green',
          route: '/pos',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '2',
          code: 'ventas',
          name: 'Lista de Ventas',
          description: 'Historial y reportes del día',
          icon: 'FileSearch',
          color: 'blue',
          route: '/sales',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '3',
          code: 'cobranzas',
          name: 'Cobranzas',
          description: 'Gestión de cuentas por cobrar',
          icon: 'DollarSign',
          color: 'red',
          route: '/cobranzas',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '4',
          code: 'config_padres',
          name: 'Config. Padres y Profesores',
          description: 'Gestión de padres, profesores y estudiantes',
          icon: 'Users',
          color: 'purple',
          route: '/parents',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '5',
          code: 'control_acceso',
          name: 'Control de Acceso',
          description: 'Gestión de permisos y roles',
          icon: 'ShieldCheck',
          color: 'blue',
          route: '/access-control',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '8',
          code: 'productos',
          name: 'Productos',
          description: 'Gestión de productos, promociones y menús',
          icon: 'Package',
          color: 'purple',
          route: '/products',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '10',
          code: 'almuerzos',
          name: 'Calendario de Almuerzos',
          description: 'Gestión de menús escolares',
          icon: 'UtensilsCrossed',
          color: 'orange',
          route: '/lunch-calendar',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '11',
          code: 'logistica',
          name: 'Logística y Almacén',
          description: 'Inventarios, pedidos y órdenes de compra',
          icon: 'Package',
          color: 'blue',
          route: '/logistics',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '12',
          code: 'admin_sede',
          name: 'Administración de Sede',
          description: 'Pedidos, calendario y tarjetas ID',
          icon: 'ShoppingCart',
          color: 'purple',
          route: '/school-admin',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '13',
          code: 'promociones',
          name: 'Combos y Promociones',
          description: 'Crea combos especiales y descuentos',
          icon: 'TrendingUp',
          color: 'pink',
          route: '/combos-promotions',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '6',
          code: 'finanzas',
          name: 'Finanzas y Tesorería',
          description: 'Efectivo por sede, auditoría de caja y ventas',
          icon: 'LineChart',
          color: 'emerald',
          route: '/finanzas',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '7',
          code: 'logistica',
          name: 'Logística',
          description: 'Inventario y compras',
          icon: 'Package',
          color: 'orange',
          route: '/logistica',
          is_active: true,
          is_enabled: false,
          status: 'coming_soon' as const,
        },
        {
          id: '14',
          code: 'cash_register',
          name: 'Cierre de Caja',
          description: 'Gestión de caja, ingresos, egresos y cierre diario',
          icon: 'DollarSign',
          color: 'green',
          route: '/cash-register',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '15',
          code: 'comedor',
          name: 'Vista Cocina',
          description: 'Pedidos del día, variaciones y estadísticas de preferencias',
          icon: 'UtensilsCrossed',
          color: 'orange',
          route: '/comedor',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
        {
          id: '16',
          code: 'facturacion',
          name: 'Facturación Electrónica',
          description: 'Boletas, facturas SUNAT, reportes y configuración Nubefact',
          icon: 'FileText',
          color: 'indigo',
          route: '/facturacion',
          is_active: true,
          is_enabled: false,
          status: 'functional' as const,
        },
      ];

      // Admin General tiene acceso a TODO
      if (role === 'admin_general') {
        const enabledModules = allModules.map(m => ({ ...m, is_enabled: true }));
        console.log('👔 Admin General: Acceso total a todos los módulos');
        setModules(enabledModules);
        setLoading(false);
        return;
      }

      // Para otros roles, verificar permisos en la base de datos
      console.log('🔐 Verificando permisos desde base de datos...');
      
      // Obtener permisos del usuario desde la BD
      const { data: userPermissions, error: permError } = await supabase.rpc(
        'check_user_permission',
        {
          p_user_id: user.id,
          p_module: 'dummy', // Solo para inicializar
          p_action: 'dummy'
        }
      ).then(() => {
        // Si la función existe, obtener todos los permisos del rol
        return supabase
          .from('role_permissions')
          .select(`
            permission_id,
            granted,
            permissions (
              module,
              action,
              name
            )
          `)
          .eq('role', role)
          .eq('granted', true);
      });

      if (permError) {
        console.error('❌ Error obteniendo permisos:', permError);
        // Si hay error, dejar todos deshabilitados excepto para roles conocidos
        if (role === 'operador_caja') {
          const cajaModules = allModules.map(m => ({
            ...m,
            is_enabled: m.code === 'pos' || m.code === 'ventas'
          }));
          setModules(cajaModules);
        } else {
          setModules(allModules);
        }
        setLoading(false);
        return;
      }

      console.log('✅ Permisos obtenidos:', userPermissions?.length || 0);

      // Extraer los códigos de módulos a los que tiene acceso (permiso 'ver_modulo')
      const enabledModuleCodes = new Set<string>();
      userPermissions?.forEach((perm: any) => {
        const permission = perm.permissions;
        if (permission?.action === 'ver_modulo') {
          enabledModuleCodes.add(permission.module);
        }
      });

      console.log('📦 Módulos habilitados:', Array.from(enabledModuleCodes));

      // Control de Acceso SOLO para admin_general (verificar con string directo)
      const userRoleString = role as string;
      if (userRoleString !== 'admin_general') {
        enabledModuleCodes.delete('control_acceso');
      }

      // Filtrar módulos según permisos
      const filteredModules = allModules
        .filter(m => {
          // Mostrar solo módulos funcionales a los que tiene acceso
          if (m.status === 'functional') {
            return enabledModuleCodes.has(m.code);
          }
          // Los módulos "coming soon" no se muestran para roles no-admin
          return false;
        })
        .map(m => ({
          ...m,
          is_enabled: enabledModuleCodes.has(m.code)
        }));

      console.log('📊 Módulos finales para', role, ':', filteredModules.length);
      setModules(filteredModules);
      
    } catch (error) {
      console.error('❌ Error fetching modules:', error);
      setModules([]);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleClick = (module: Module) => {
    // console.log('🖱️ Clic en módulo:', module.name, '| Ruta:', module.route);
    
    if (!module.is_enabled) {
      // console.log('❌ Módulo deshabilitado');
      alert(`No tienes acceso al módulo "${module.name}"`);
      return;
    }

    if (module.status === 'coming_soon') {
      // console.log('🚧 Módulo en desarrollo');
      alert(`El módulo "${module.name}" estará disponible próximamente.`);
      return;
    }

    // console.log('✅ Navegando a:', module.route);
    navigate(module.route);
  };

  const handleLogout = async () => {
    await signOut();
  };

  /** 🔄 Forzar actualización de TODOS los usuarios conectados */
  const handleForceUpdate = async () => {
    if (forcingUpdate) return;
    
    const confirmed = window.confirm(
      '🔄 ¿Forzar actualización para TODOS los usuarios?\n\n' +
      'Esto recargará la app de todos los padres y admins que estén conectados en este momento.\n\n' +
      'Los que no estén conectados se actualizarán cuando abran la app.'
    );
    if (!confirmed) return;

    setForcingUpdate(true);
    try {
      const channel = supabase.channel('force-update');
      await channel.subscribe();
      
      // Enviar señal de recarga a todos los clientes conectados
      await channel.send({
        type: 'broadcast',
        event: 'reload',
        payload: {
          triggered_at: new Date().toISOString(),
          triggered_by: user?.email || 'admin',
        },
      });

      // Esperar un poco para que se envíe
      await new Promise(r => setTimeout(r, 1500));
      supabase.removeChannel(channel);

      toast({
        title: '✅ Señal de actualización enviada',
        description: 'Todos los usuarios conectados recargarán su app automáticamente en los próximos segundos.',
      });
    } catch (err: any) {
      console.error('Error forzando actualización:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo enviar la señal. Intenta de nuevo.',
      });
    } finally {
      setForcingUpdate(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <WelcomeHeader showRole={true} />
          <div className="flex items-center gap-3">
            <VersionBadge />
            <div className="text-right">
              <p className="text-sm text-gray-600">{user?.email}</p>
              {schoolName && (
                <p className="text-xs font-semibold text-emerald-600 mt-0.5">
                  📍 {schoolName}
                </p>
              )}
            </div>
            <UserProfileMenu
              userEmail={user?.email || ''}
              userName={full_name || undefined}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* ViewAsSelector - Solo para Admin General */}
        <ViewAsSelector />
        
        {/* Botón de Forzar Actualización — Solo admin_general */}
        {(role as string) === 'admin_general' && (
          <div className="mb-4 mt-4">
            <button
              onClick={handleForceUpdate}
              disabled={forcingUpdate}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-md hover:shadow-lg transition-all text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {forcingUpdate ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {forcingUpdate ? 'Enviando señal...' : '🔄 Forzar Actualización de Todos los Usuarios'}
            </button>
            <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
              <Wifi className="h-3 w-3" />
              Recarga la app de todos los padres y admins conectados al instante.
            </p>
          </div>
        )}

        {/* Alertas de anulación — Solo admin_general */}
        {(role as string) === 'admin_general' && cancellationAlerts.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="w-full flex items-center justify-between bg-red-50 border-2 border-red-200 rounded-xl p-4 hover:bg-red-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Bell className="h-6 w-6 text-red-600" />
                  <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {cancellationAlerts.length}
                  </span>
                </div>
                <div className="text-left">
                  <p className="font-bold text-red-800 text-sm">
                    {cancellationAlerts.length} {cancellationAlerts.length === 1 ? 'venta anulada' : 'ventas anuladas'} sin revisar
                  </p>
                  <p className="text-xs text-red-600">Toca para ver detalles</p>
                </div>
              </div>
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </button>

            {showAlerts && (
              <div className="mt-2 bg-white border-2 border-red-200 rounded-xl overflow-hidden shadow-lg">
                <div className="flex items-center justify-between p-3 bg-red-600 text-white">
                  <span className="font-bold text-sm">Anulaciones Pendientes</span>
                  <button onClick={markAllAlertsRead} className="text-xs bg-white/20 px-3 py-1 rounded-full hover:bg-white/30">
                    Marcar todas como leídas
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y">
                  {cancellationAlerts.map((alert) => (
                    <div key={alert.id} className="p-3 hover:bg-gray-50 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="destructive" className="text-[10px]">
                            S/ {Number(alert.amount).toFixed(2)}
                          </Badge>
                          {alert.payment_method && (
                            <Badge variant="outline" className="text-[10px]">
                              {alert.payment_method}
                            </Badge>
                          )}
                          {alert.refund_method && (
                            <Badge variant="secondary" className="text-[10px]">
                              Dev: {alert.refund_method}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-700 mt-1 truncate">
                          <strong>{alert.ticket_code}</strong> — {alert.client_name || 'Cliente'}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                          Motivo: {alert.cancellation_reason || '(sin motivo)'}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {alert.created_at ? new Date(alert.created_at).toLocaleString('es-PE') : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => markAlertRead(alert.id)}
                        className="text-gray-400 hover:text-green-600 p-1 flex-shrink-0"
                        title="Marcar como leída"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mb-6 mt-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Módulos Disponibles</h2>
          <p className="text-sm text-gray-500">
            Selecciona un módulo para acceder a sus funcionalidades
          </p>
        </div>

        {/* Modules Grid - Desktop: cuadrados, Móvil: bolitas */}
        
        {/* VISTA MÓVIL - Bolitas circulares */}
        <div className="grid grid-cols-3 gap-4 sm:hidden">
          {modules.map((module) => {
            const IconComponent = ICON_MAP[module.icon];
            const colorClass = COLOR_MAP[module.color];

            return (
              <div
                key={module.id}
                className={`flex flex-col items-center cursor-pointer transition-all ${
                  module.is_enabled ? 'opacity-100' : 'opacity-40'
                }`}
                onClick={() => handleModuleClick(module)}
              >
                {/* Círculo con icono */}
                <div
                  className={`w-20 h-20 rounded-full flex items-center justify-center mb-2 ${
                    module.is_enabled ? colorClass : 'bg-gray-300 text-gray-500'
                  } shadow-lg hover:scale-110 transition-transform relative`}
                >
                  <IconComponent className="h-8 w-8" />
                  
                  {/* Badge pequeño en esquina */}
                  {module.status === 'functional' && module.is_enabled && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="h-3 w-3 text-white" />
                    </div>
                  )}
                  {module.status === 'coming_soon' && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center">
                      <Clock className="h-3 w-3 text-white" />
                    </div>
                  )}
                  {!module.is_enabled && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                      <Lock className="h-3 w-3 text-white" />
                    </div>
                  )}
                </div>
                
                {/* Nombre del módulo */}
                <p className="text-xs font-semibold text-center text-gray-800 leading-tight">
                  {module.name}
                </p>
              </div>
            );
          })}
        </div>

        {/* VISTA DESKTOP - Cuadrados (original) */}
        <div className="hidden sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module) => {
            const IconComponent = ICON_MAP[module.icon];
            const colorClass = COLOR_MAP[module.color];

            return (
              <Card
                key={module.id}
                className={`relative cursor-pointer transition-all hover:shadow-lg ${
                  module.is_enabled
                    ? 'hover:scale-105 border-2'
                    : 'opacity-50 cursor-not-allowed'
                } ${module.is_enabled ? colorClass : 'border-gray-300'}`}
                onClick={() => handleModuleClick(module)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className={`p-3 rounded-lg ${colorClass}`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <div className="flex flex-col gap-1">
                      {module.status === 'functional' && module.is_enabled && (
                        <Badge variant="default" className="bg-green-500">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Activo
                        </Badge>
                      )}
                      {module.status === 'coming_soon' && (
                        <Badge variant="secondary">Próximamente</Badge>
                      )}
                      {!module.is_enabled && (
                        <Badge variant="destructive">
                          <Lock className="h-3 w-3 mr-1" />
                          Bloqueado
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardTitle className="text-lg mt-4">{module.name}</CardTitle>
                  <CardDescription className="text-sm">
                    {module.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {module.is_enabled && module.status === 'functional' && (
                    <p className="text-xs text-gray-500">
                      Haz clic para acceder →
                    </p>
                  )}
                  {module.is_enabled && module.status === 'coming_soon' && (
                    <p className="text-xs text-gray-500">
                      🚧 En desarrollo
                    </p>
                  )}
                  {!module.is_enabled && (
                    <p className="text-xs text-red-500">
                      No tienes acceso a este módulo
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

      </main>
    </div>
  );
};

export default Dashboard;

