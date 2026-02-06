import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface PermissionProtectedRouteProps {
  children: React.ReactNode;
  moduleCode: string; // Código del módulo (ej: 'ventas', 'pos', 'config_padres')
}

export function PermissionProtectedRoute({ children, moduleCode }: PermissionProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, getDefaultRoute } = useRole();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkModulePermission();
  }, [user, role, moduleCode]);

  const checkModulePermission = async () => {
    if (!user || !role) {
      setChecking(false);
      return;
    }

    try {
      console.log(`🔍 Verificando permiso para módulo: ${moduleCode}, rol: ${role}`);

      // Admin General siempre tiene acceso
      if (role === 'admin_general') {
        console.log('✅ Admin General - Acceso total');
        setHasPermission(true);
        setChecking(false);
        return;
      }

      // Consultar permisos del rol en la base de datos
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
        setHasPermission(false);
        setChecking(false);
        return;
      }

      // Verificar si tiene el permiso del módulo
      // Mapear códigos de módulo a nombres en permissions
      const moduleMap: { [key: string]: string } = {
        'cierre_caja': 'cash_register',
        'cash_register': 'cash_register',
        'pos': 'pos',
        'ventas': 'ventas',
        'cobranzas': 'cobranzas',
        'almuerzos': 'almuerzos',
        'productos': 'productos',
        'config_padres': 'config_padres',
        'admin_sede': 'admin_sede',
        'promociones': 'promociones',
        'logistica': 'logistica',
        'finanzas': 'finanzas'
      };
      
      const permissionModule = moduleMap[moduleCode] || moduleCode;
      
      const hasModuleAccess = data?.some((perm: any) => {
        return perm.permissions?.module === permissionModule && perm.permissions?.action === 'access';
      });

      console.log(`${hasModuleAccess ? '✅' : '❌'} Permiso para ${moduleCode} (module: ${permissionModule}):`, hasModuleAccess);
      console.log('📊 Data recibida:', data);
      console.log('🔑 Estableciendo hasPermission a:', hasModuleAccess);
      setHasPermission(hasModuleAccess || false);
      setChecking(false);

    } catch (error) {
      console.error('Error checking module permission:', error);
      setHasPermission(false);
      setChecking(false);
    }
  };

  // Mostrar loader mientras se autentica o verifica permisos
  if (authLoading || roleLoading || checking) {
    console.log('⏳ Cargando...', { authLoading, roleLoading, checking });
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirigir si no está autenticado
  if (!user) {
    console.log('❌ Usuario no autenticado');
    return <Navigate to="/auth" replace />;
  }

  // Mostrar mensaje de acceso denegado si no tiene permiso
  if (hasPermission === false) {
    console.log('🚫 Mostrando pantalla de acceso denegado. hasPermission:', hasPermission);
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 p-6 flex items-center justify-center">
        <Card className="border-red-200 max-w-md">
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
            <p className="text-gray-600 mb-6">
              No tienes permisos para acceder a este módulo.
              <br />
              Contacta al administrador del sistema si necesitas acceso.
            </p>
            <button
              onClick={() => window.location.href = '/#/dashboard'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Volver al Dashboard
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Si tiene permiso, renderizar el componente hijo
  console.log('✅ Renderizando componente hijo. hasPermission:', hasPermission);
  return <>{children}</>;
}

