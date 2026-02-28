import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
// Tabs de Radix removido - se usa tabs nativo para evitar error removeChild en algunos navegadores
import { UserProfileMenu } from '@/components/admin/UserProfileMenu';
import { 
  DollarSign, 
  Calendar,
  Users,
  FileText,
  Settings,
  Loader2,
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Wallet
} from 'lucide-react';

// Importar los componentes de cada tab
import { BillingDashboard } from '@/components/billing/BillingDashboard';
import { BillingCollection } from '@/components/billing/BillingCollection';
import { BillingReports } from '@/components/billing/BillingReports';
import { BillingConfig } from '@/components/billing/BillingConfig';
import { PaymentStatistics } from '@/components/admin/PaymentStatistics';
import { VoucherApproval } from '@/components/billing/VoucherApproval';

interface TabPermissions {
  dashboard: boolean;
  collect: boolean;
  reports: boolean;
  statistics: boolean;
  config: boolean;
  vouchers: boolean;
  pagos_realizados: boolean; // Historial de pagos — visible para todos los que pueden cobrar
  config_sede: boolean;      // Configuración de sede — solo para gestores de unidad
}

const Cobranzas = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { role } = useRole();
  const { full_name } = useUserProfile();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [permissions, setPermissions] = useState<TabPermissions>({
    dashboard: false,
    collect: false,
    reports: false,
    statistics: false,
    config: false,
    vouchers: false,
    pagos_realizados: false,
    config_sede: false,
  });
  const [pendingVouchers, setPendingVouchers] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkPermissions();
  }, [user, role]);

  const checkPermissions = async () => {
    if (!user || !role) return;

    try {
      setLoading(true);
      console.log('🔍 Verificando permisos de Cobranzas para rol:', role);

      // Admin General tiene todos los permisos siempre
      if (role === 'admin_general') {
        setPermissions({
          dashboard: true,
          collect: true,
          reports: true,
          statistics: true,
          config: true,
          vouchers: true,
          pagos_realizados: true,
          config_sede: false, // admin_general usa BillingConfig completo, no la versión de sede
        });
        setActiveTab('dashboard');
        fetchPendingVouchers();
        setLoading(false);
        return;
      }

      // Para otros roles, consultar la BD
      const { data, error } = await supabase
        .from('role_permissions')
        .select(`
          granted,
          permissions (
            module,
            action
          )
        `)
        .eq('role', role)
        .eq('granted', true);

      if (error) {
        console.error('❌ Error consultando permisos:', error);
        throw error;
      }

      console.log('📦 Permisos obtenidos de BD:', data);

      // Inicializar todos los permisos en false
      const perms: TabPermissions = {
        dashboard: false,
        collect: false,
        reports: false,
        statistics: false,
        config: false,
        vouchers: false,
        pagos_realizados: false,
        config_sede: false,
      };

      // Mapear los permisos de la BD a las pestañas
      data?.forEach((perm: any) => {
        const permission = perm.permissions;
        if (permission?.module === 'cobranzas') {
          switch (permission.action) {
            case 'ver_dashboard':
              perms.dashboard = true;
              break;
            case 'cobrar_su_sede':
            case 'cobrar_todas_sedes':
            case 'cobrar_personalizado':
              perms.collect = true;
              perms.vouchers = true; // Admins que cobran también aprueban recargas
              perms.pagos_realizados = true; // Historial de pagos
              perms.config_sede = true; // Configuración de su sede
              break;
            case 'sacar_reportes':
              perms.reports = true;
              break;
            case 'ver_estadisticas':
              perms.statistics = true;
              break;
            case 'configuracion':
              perms.config = true;
              break;
          }
        }
      });

      console.log('✅ Permisos finales de Cobranzas:', perms);
      setPermissions(perms);
      if (perms.vouchers) fetchPendingVouchers();

      // Establecer la primera pestaña disponible
      if (perms.dashboard) setActiveTab('dashboard');
      else if (perms.collect) setActiveTab('collect');
      else if (perms.pagos_realizados) setActiveTab('pagos_realizados');
      else if (perms.config_sede) setActiveTab('config_sede');
      else if (perms.vouchers) setActiveTab('vouchers');
      else if (perms.reports) setActiveTab('reports');
      else if (perms.statistics) setActiveTab('statistics');
      else if (perms.config) setActiveTab('config');

    } catch (error) {
      console.error('Error checking permissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingVouchers = async () => {
    try {
      const { count } = await supabase
        .from('recharge_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      setPendingVouchers(count || 0);
    } catch (err) {
      console.error('Error al contar vouchers:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Si no tiene ningún permiso
  const hasAnyPermission = Object.values(permissions).some(p => p);
  if (!hasAnyPermission) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 p-6">
        <div className="max-w-7xl mx-auto">
          <Card className="border-red-200">
            <CardContent className="p-12 text-center">
              <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Sin Permisos de Acceso</h2>
              <p className="text-gray-600">
                No tienes permisos para acceder a ninguna funcionalidad del módulo de Cobranzas.
                <br />
                Contacta al administrador del sistema.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Pestañas visibles (Reportes eliminado de la UI)
  const visibleTabCount = [
    permissions.dashboard,
    permissions.collect,
    permissions.pagos_realizados,
    // permissions.reports — eliminado de la UI
    permissions.vouchers,
    permissions.config_sede,
    permissions.config,
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* Header — responsivo */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Volver</span>
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
                <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-red-600 shrink-0" />
                <span className="truncate">Módulo de Cobranzas</span>
              </h1>
              <p className="text-gray-600 mt-0.5 text-xs sm:text-base hidden sm:block">
                Gestión integral de cuentas por cobrar y períodos de facturación
              </p>
            </div>
          </div>
          <div className="self-end sm:self-auto">
            <UserProfileMenu
              userEmail={user?.email || ''}
              userName={full_name || undefined}
              onLogout={signOut}
            />
          </div>
        </div>

        {/* Tabs Principal */}
        <Card>
          <CardContent className="p-2 sm:p-6">
            {/* Tabs nativo - sin Radix para evitar removeChild */}
            <div>
              {/* ── Barra de tabs: scroll horizontal en mobile, grid en desktop ── */}
              <div className="overflow-x-auto -mx-1 px-1 pb-1 sm:pb-0 sm:overflow-visible">
                <div
                  className="hidden sm:grid w-full h-auto bg-muted p-1 rounded-lg"
                  style={{ gridTemplateColumns: `repeat(${visibleTabCount}, 1fr)` }}
                >
                  {permissions.dashboard && (
                    <button
                      onClick={() => setActiveTab('dashboard')}
                      className={`flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all ${
                        activeTab === 'dashboard'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <DollarSign className="h-4 w-4" />
                      Dashboard
                    </button>
                  )}
                  {permissions.collect && (
                    <button
                      onClick={() => setActiveTab('collect')}
                      className={`flex items-center justify-center gap-2 py-3 text-sm font-bold rounded-md transition-all ${
                        activeTab === 'collect'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Users className="h-4 w-4" />
                      ¡Cobrar!
                    </button>
                  )}
                  {permissions.pagos_realizados && (
                    <button
                      onClick={() => setActiveTab('pagos_realizados')}
                      className={`flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all ${
                        activeTab === 'pagos_realizados'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <FileText className="h-4 w-4" />
                      Pagos
                    </button>
                  )}
                  {permissions.config_sede && (
                    <button
                      onClick={() => setActiveTab('config_sede')}
                      className={`flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all ${
                        activeTab === 'config_sede'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Settings className="h-4 w-4" />
                      Configuración
                    </button>
                  )}
                  {permissions.vouchers && (
                    <button
                      onClick={() => setActiveTab('vouchers')}
                      className={`flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all relative ${
                        activeTab === 'vouchers'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Wallet className="h-4 w-4" />
                      Pagos
                      {pendingVouchers > 0 && (
                        <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {pendingVouchers > 9 ? '9+' : pendingVouchers}
                        </span>
                      )}
                    </button>
                  )}
                  {permissions.config && (
                    <button
                      onClick={() => setActiveTab('config')}
                      className={`flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all ${
                        activeTab === 'config'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Settings className="h-4 w-4" />
                      Config
                    </button>
                  )}
                </div>

                {/* ── Tabs en mobile: flex horizontal con scroll ── */}
                <div className="flex sm:hidden gap-1 bg-muted p-1 rounded-lg w-max min-w-full">
                  {permissions.dashboard && (
                    <button
                      onClick={() => setActiveTab('dashboard')}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                        activeTab === 'dashboard'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <DollarSign className="h-3.5 w-3.5" />
                      Dashboard
                    </button>
                  )}
                  {permissions.collect && (
                    <button
                      onClick={() => setActiveTab('collect')}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold rounded-md transition-all whitespace-nowrap ${
                        activeTab === 'collect'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Users className="h-3.5 w-3.5" />
                      ¡Cobrar!
                    </button>
                  )}
                  {permissions.pagos_realizados && (
                    <button
                      onClick={() => setActiveTab('pagos_realizados')}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                        activeTab === 'pagos_realizados'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Pagos
                    </button>
                  )}
                  {permissions.config_sede && (
                    <button
                      onClick={() => setActiveTab('config_sede')}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                        activeTab === 'config_sede'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Configuración
                    </button>
                  )}
                  {permissions.vouchers && (
                    <button
                      onClick={() => setActiveTab('vouchers')}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-md transition-all whitespace-nowrap relative ${
                        activeTab === 'vouchers'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      Pagos
                      {pendingVouchers > 0 && (
                        <span className="ml-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                          {pendingVouchers > 9 ? '9+' : pendingVouchers}
                        </span>
                      )}
                    </button>
                  )}
                  {permissions.config && (
                    <button
                      onClick={() => setActiveTab('config')}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                        activeTab === 'config'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Config
                    </button>
                  )}
                </div>
              </div>

              {/* Dashboard Tab (Incluye Estadísticas) */}
              {activeTab === 'dashboard' && permissions.dashboard && (
                <div className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
                  <BillingDashboard />
                  
                  {/* Separador visual */}
                  <div className="border-t pt-4 sm:pt-6">
                    <h2 className="text-lg sm:text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-red-600" />
                      Estadísticas de Pago
                    </h2>
                    <PaymentStatistics />
                  </div>
                </div>
              )}

              {/* Cobrar / Pagos Realizados / Configuración Sede — misma instancia, distinta sección */}
              {(activeTab === 'collect' || activeTab === 'pagos_realizados' || activeTab === 'config_sede') && permissions.collect && (
                <div className="mt-4 sm:mt-6">
                  <BillingCollection
                    section={
                      activeTab === 'pagos_realizados' ? 'pagos' :
                      activeTab === 'config_sede' ? 'config' :
                      'cobrar'
                    }
                  />
                </div>
              )}

              {/* Recargas / Vouchers Tab */}
              {activeTab === 'vouchers' && permissions.vouchers && (
                <div className="mt-4 sm:mt-6">
                  <VoucherApproval />
                </div>
              )}

              {/* Configuración Tab */}
              {activeTab === 'config' && permissions.config && (
                <div className="mt-4 sm:mt-6">
                  <BillingConfig />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Cobranzas;

