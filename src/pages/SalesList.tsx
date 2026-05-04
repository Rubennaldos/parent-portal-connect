import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, ArrowLeft, BarChart3, FileText, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SalesList as SalesListGrid } from '@/components/admin/SalesList';
import { DashboardInteligente } from '@/components/admin/DashboardInteligente';
import { supabase } from '@/lib/supabase';

interface School {
  id: string;
  name: string;
}

// Solo estos roles acceden al dashboard analítico
const DASHBOARD_ROLES = ['admin_general', 'superadmin', 'gestor_unidad'] as const;

const SalesList = () => {
  const { signOut, user } = useAuth();
  const { role, canViewAllSchools } = useRole();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);

  const canViewDashboard = role ? (DASHBOARD_ROLES as readonly string[]).includes(role) : false;
  // gestor_unidad SOLO ve su propia sede — el selector está bloqueado
  const isGestorUnidad = role === 'gestor_unidad';

  // Número de columnas del TabsList
  const tabCols = 1 + (canViewDashboard ? 1 : 0);

  useEffect(() => {
    if (canViewAllSchools) loadSchools();
    loadUserSchool();
  }, [user, role]);

  // Si es gestor_unidad, fijar automáticamente selectedSchool a su sede
  useEffect(() => {
    if (isGestorUnidad && userSchoolId) {
      setSelectedSchool(userSchoolId);
    }
  }, [isGestorUnidad, userSchoolId]);

  const loadUserSchool = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      setUserSchoolId(data?.school_id || null);
    } catch { /* silencioso */ }
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

  const handleLogout = async () => { await signOut(); };

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
              <p className="text-xs text-gray-500">Operación de ventas y monitoreo en tiempo real</p>
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
          <TabsList
            className={`grid w-full bg-white border rounded-xl p-1 mb-6 ${
              tabCols === 3 ? 'grid-cols-3' : tabCols === 2 ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            <TabsTrigger
              value="list"
              className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white"
            >
              <FileText className="h-4 w-4 mr-2" />
              Lista de Ventas
            </TabsTrigger>

            {canViewDashboard && (
              <TabsTrigger
                value="dashboard"
                className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white"
              >
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
              <Card className="mb-4">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <label className="font-bold text-slate-700">Filtrar por Sede:</label>

                    {isGestorUnidad ? (
                      /* Gestor de sede: selector bloqueado, solo ve su concesión */
                      <div className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-amber-50 border-amber-300 text-amber-900 text-sm font-semibold">
                        <Lock className="h-4 w-4 text-amber-600" />
                        {schools.find(s => s.id === userSchoolId)?.name ?? 'Tu sede'}
                        <span className="text-xs font-normal text-amber-600 ml-1">(vista limitada)</span>
                      </div>
                    ) : canViewAllSchools && schools.length > 0 ? (
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
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <DashboardInteligente
                schoolId={
                  isGestorUnidad
                    ? userSchoolId
                    : selectedSchool === 'all' ? null : selectedSchool
                }
              />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
};

export default SalesList;
