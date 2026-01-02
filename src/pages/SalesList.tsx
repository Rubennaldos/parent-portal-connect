import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { LogOut, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SalesList as SalesListGrid } from '@/components/admin/SalesList';

const SalesList = () => {
  const { signOut, user } = useAuth();
  const { role } = useRole();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => navigate('/dashboard')}
              className="text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Módulo de Ventas</h1>
              <p className="text-xs text-gray-500">Historial y reportes</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 hidden md:inline">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <SalesListGrid />
      </main>
    </div>
  );
};

export default SalesList;

