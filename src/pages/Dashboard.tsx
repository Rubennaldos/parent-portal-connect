import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ShoppingCart, 
  DollarSign, 
  Users, 
  FileSearch, 
  TrendingUp, 
  Package,
  LogOut,
  Lock,
  CheckCircle2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
  TrendingUp,
  Package,
};

const COLOR_MAP: { [key: string]: string } = {
  green: 'bg-green-500/10 text-green-600 border-green-500/30',
  red: 'bg-red-500/10 text-red-600 border-red-500/30',
  blue: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  purple: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  orange: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
};

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { role, isStaff } = useRole();
  const navigate = useNavigate();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserModules();
  }, [user]);

  const fetchUserModules = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Si es superadmin, tiene todos los módulos
      if (role === 'superadmin') {
        setModules([
          {
            id: '1',
            code: 'pos',
            name: 'Punto de Venta',
            description: 'Sistema de cobro y ventas',
            icon: 'ShoppingCart',
            color: 'green',
            route: '/pos',
            is_active: true,
            is_enabled: true,
            status: 'functional',
          },
          {
            id: '2',
            code: 'cobranzas',
            name: 'Cobranzas',
            description: 'Gestión de cuentas por cobrar',
            icon: 'DollarSign',
            color: 'red',
            route: '/cobranzas',
            is_active: true,
            is_enabled: true,
            status: 'coming_soon',
          },
          {
            id: '3',
            code: 'config_padres',
            name: 'Configuración Padres',
            description: 'Gestión de padres y estudiantes',
            icon: 'Users',
            color: 'blue',
            route: '/config-padres',
            is_active: true,
            is_enabled: true,
            status: 'coming_soon',
          },
          {
            id: '4',
            code: 'auditoria',
            name: 'Auditoría',
            description: 'Logs y seguimiento del sistema',
            icon: 'FileSearch',
            color: 'purple',
            route: '/auditoria',
            is_active: true,
            is_enabled: true,
            status: 'coming_soon',
          },
          {
            id: '5',
            code: 'finanzas',
            name: 'Finanzas',
            description: 'Reportes financieros y análisis',
            icon: 'TrendingUp',
            color: 'yellow',
            route: '/finanzas',
            is_active: true,
            is_enabled: true,
            status: 'coming_soon',
          },
          {
            id: '6',
            code: 'logistica',
            name: 'Logística',
            description: 'Inventario y compras',
            icon: 'Package',
            color: 'orange',
            route: '/logistica',
            is_active: true,
            is_enabled: true,
            status: 'coming_soon',
          },
        ]);
      } else {
        // TODO: Consultar módulos asignados desde la BD
        // Por ahora, solo POS para admin_general
        setModules([
          {
            id: '1',
            code: 'pos',
            name: 'Punto de Venta',
            description: 'Sistema de cobro y ventas',
            icon: 'ShoppingCart',
            color: 'green',
            route: '/pos',
            is_active: true,
            is_enabled: true,
            status: 'functional',
          },
        ]);
      }
    } catch (error) {
      console.error('Error fetching modules:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleClick = (module: Module) => {
    if (!module.is_enabled) {
      return; // No hacer nada si no tiene permiso
    }

    if (module.status === 'coming_soon') {
      alert(`El módulo "${module.name}" estará disponible próximamente.`);
      return;
    }

    navigate(module.route);
  };

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Dashboard de Módulos</h1>
            <p className="text-sm text-gray-500">
              {role === 'superadmin' ? 'Acceso Total - Dueño' : 'Admin General'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Módulos Disponibles</h2>
          <p className="text-sm text-gray-500">
            Selecciona un módulo para acceder a sus funcionalidades
          </p>
        </div>

        {/* Modules Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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

        {/* Info Card */}
        <Card className="mt-8 bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-800">ℹ️ Información del Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-blue-700">
              <li>✅ <strong>Módulo POS:</strong> Completamente funcional</li>
              <li>🚧 <strong>Otros módulos:</strong> En desarrollo</li>
              <li>🔐 <strong>Acceso:</strong> Los módulos habilitados son configurados por el SuperAdmin</li>
              {role === 'superadmin' && (
                <li>👑 <strong>SuperAdmin:</strong> Tienes acceso total a todos los módulos</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;

