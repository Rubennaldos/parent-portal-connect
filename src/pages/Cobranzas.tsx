import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  BarChart3
} from 'lucide-react';

// Importar los componentes de cada tab
import { BillingDashboard } from '@/components/billing/BillingDashboard';
import { BillingCollection } from '@/components/billing/BillingCollection';
import { BillingReports } from '@/components/billing/BillingReports';
import { BillingConfig } from '@/components/billing/BillingConfig';
import { PaymentStatistics } from '@/components/admin/PaymentStatistics';

interface TabPermissions {
  dashboard: boolean;
  collect: boolean;
  reports: boolean;
  statistics: boolean;
  config: boolean;
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
  });
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
        });
        setActiveTab('dashboard');
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

      // Establecer la primera pestaña disponible
      if (perms.dashboard) setActiveTab('dashboard');
      else if (perms.collect) setActiveTab('collect');
      else if (perms.reports) setActiveTab('reports');
      else if (perms.statistics) setActiveTab('statistics');
      else if (perms.config) setActiveTab('config');

    } catch (error) {
      console.error('Error checking permissions:', error);
    } finally {
      setLoading(false);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <DollarSign className="h-8 w-8 text-red-600" />
                Módulo de Cobranzas
              </h1>
              <p className="text-gray-600 mt-1">
                Gestión integral de cuentas por cobrar y períodos de facturación
              </p>
            </div>
          </div>
          <UserProfileMenu
            userEmail={user?.email || ''}
            userName={full_name || undefined}
            onLogout={signOut}
          />
        </div>

        {/* Tabs Principal */}
        <Card>
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full h-auto" style={{ gridTemplateColumns: `repeat(${Object.values(permissions).filter(Boolean).length}, 1fr)` }}>
                {permissions.dashboard && (
                  <TabsTrigger value="dashboard" className="flex items-center gap-2 py-3">
                    <DollarSign className="h-4 w-4" />
                    <span className="hidden sm:inline">Dashboard</span>
                  </TabsTrigger>
                )}
                {permissions.collect && (
                  <TabsTrigger value="collect" className="flex items-center gap-2 py-3 font-bold">
                    <Users className="h-4 w-4" />
                    <span className="hidden sm:inline">¡Cobrar!</span>
                  </TabsTrigger>
                )}
                {permissions.reports && (
                  <TabsTrigger value="reports" className="flex items-center gap-2 py-3">
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">Reportes</span>
                  </TabsTrigger>
                )}
                {permissions.config && (
                  <TabsTrigger value="config" className="flex items-center gap-2 py-3">
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">Config</span>
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Dashboard Tab (Incluye Estadísticas) */}
              {permissions.dashboard && (
                <TabsContent value="dashboard" className="mt-6 space-y-6">
                  <BillingDashboard />
                  
                  {/* Separador visual */}
                  <div className="border-t pt-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <BarChart3 className="h-6 w-6 text-red-600" />
                      Estadísticas de Pago
                    </h2>
                    <PaymentStatistics />
                  </div>
                </TabsContent>
              )}

              {/* Cobrar Tab */}
              {permissions.collect && (
                <TabsContent value="collect" className="mt-6">
                  <BillingCollection />
                </TabsContent>
              )}

              {/* Reportes Tab */}
              {permissions.reports && (
                <TabsContent value="reports" className="mt-6">
                  <BillingReports />
                </TabsContent>
              )}

              {/* Configuración Tab */}
              {permissions.config && (
                <TabsContent value="config" className="mt-6">
                  <BillingConfig />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Cobranzas;

