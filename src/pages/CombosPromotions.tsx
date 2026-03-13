import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { CombosPromotionsManager } from '@/components/products/CombosPromotionsManager';
import { Button } from '@/components/ui/button';
import { Package, Percent, AlertTriangle } from 'lucide-react';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';

const CombosPromotions = () => {
  const navigate = useNavigate();
  const maintenance = useMaintenanceGuard('promociones_admin');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      navigate('/');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, permissions')
      .eq('id', session.user.id)
      .single();

    // Solo admin_general y supervisor_red pueden gestionar combos/promociones
    if (!['admin_general', 'supervisor_red'].includes(profile?.role || '')) {
      navigate('/dashboard');
      return;
    }

    setIsLoading(false);
  };

  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600">{maintenance.message}</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Volver al Panel
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
            <Package className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Combos y Promociones</h1>
            <p className="text-muted-foreground">
              Crea combos especiales y promociones para aumentar tus ventas
            </p>
          </div>
        </div>
      </div>

      <CombosPromotionsManager />
    </div>
  );
};

export default CombosPromotions;
