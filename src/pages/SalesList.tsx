import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, ArrowLeft, BarChart3, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SalesList as SalesListGrid } from '@/components/admin/SalesList';
import { SalesDashboard } from '@/components/sales/SalesDashboard';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface School {
  id: string;
  name: string;
}

const SalesList = () => {
  const { signOut, user } = useAuth();
  const { role, canViewAllSchools } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [canViewDashboard, setCanViewDashboard] = useState(false);

  useEffect(() => {
    checkPermissions();
    if (canViewAllSchools) {
      loadSchools();
    }
  }, [user, role]);

  const checkPermissions = async () => {
    if (!user) return;

    // Admin General siempre puede ver el dashboard
    if (role === 'admin_general') {
      setCanViewDashboard(true);
      return;
    }

    // Verificar permiso específico
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select(`
          granted,
          permissions(module, action)
        `)
        .eq('role', role)
        .eq('granted', true);

      if (error) throw error;

      const hasDashboardPermission = data?.some((perm: any) => 
        perm.permissions?.module === 'ventas' && 
        perm.permissions?.action === 'ver_dashboard'
      );

      setCanViewDashboard(hasDashboardPermission || false);
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  const loadSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error loading schools:', error);
    }
  };

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
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white border rounded-xl p-1 mb-6">
            <TabsTrigger value="list" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <FileText className="h-4 w-4 mr-2" />
              Lista de Ventas
            </TabsTrigger>
            {canViewDashboard && (
              <TabsTrigger value="dashboard" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
                <BarChart3 className="h-4 w-4 mr-2" />
                Dashboard & Analytics
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="list">
            <SalesListGrid />
          </TabsContent>

          {canViewDashboard && (
            <TabsContent value="dashboard">
              {/* Filtro por Sede */}
              {canViewAllSchools && schools.length > 0 && (
                <Card className="mb-4">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <label className="font-bold text-slate-700">Filtrar por Sede:</label>
                      <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                        <SelectTrigger className="w-[300px]">
                          <SelectValue placeholder="Seleccionar sede" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">📊 Todas las Sedes (Global)</SelectItem>
                          {schools.map((school) => (
                            <SelectItem key={school.id} value={school.id}>
                              {school.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              )}

              <SalesDashboard selectedSchool={selectedSchool} canViewAllSchools={canViewAllSchools} />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
};

export default SalesList;

