import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { 
  UtensilsCrossed, 
  TrendingUp, 
  Calendar, 
  Users,
  Download,
  Award,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';

interface LunchMetrics {
  total_menus: number;
  active_schools: number;
  most_popular_dish: string;
  busiest_day: string;
  avg_dishes_per_day: number;
}

interface DishPopularity {
  dish_name: string;
  category: string;
  frequency: number;
  schools_count: number;
}

interface MenusByDay {
  day_of_week: string;
  total_menus: number;
  schools_served: number;
}

interface SchoolMenuStats {
  school_name: string;
  total_menus: number;
  unique_dishes: number;
}

const COLORS = ['#8B4513', '#D2691E', '#CD853F', '#DEB887', '#F4A460', '#8B7355', '#A0522D'];
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

interface LunchAnalyticsDashboardProps {
  selectedSchool?: string;
  canViewAllSchools: boolean;
}

export function LunchAnalyticsDashboard({ selectedSchool = 'all', canViewAllSchools }: LunchAnalyticsDashboardProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<LunchMetrics | null>(null);
  const [dishPopularity, setDishPopularity] = useState<DishPopularity[]>([]);
  const [menusByDay, setMenusByDay] = useState<MenusByDay[]>([]);
  const [schoolStats, setSchoolStats] = useState<SchoolMenuStats[]>([]);
  const [timeRange, setTimeRange] = useState<'month' | 'all'>('month');

  useEffect(() => {
    loadAnalyticsData();
  }, [timeRange, selectedSchool]);

  const loadAnalyticsData = async () => {
    try {
      setLoading(true);
      const { start, end } = getDateRange();

      // Construir query base
      let menusQuery = supabase
        .from('lunch_menus')
        .select(`
          *,
          school:schools(name)
        `)
        .gte('date', start.toISOString())
        .lte('date', end.toISOString());

      // Filtrar por sede si no es "all"
      if (selectedSchool && selectedSchool !== 'all') {
        menusQuery = menusQuery.eq('school_id', selectedSchool);
      }

      const { data: menus, error } = await menusQuery;

      if (error) throw error;

      // Calcular métricas
      const totalMenus = menus?.length || 0;
      const uniqueSchools = new Set(menus?.map(m => m.school_id)).size;

      // Popularidad de platos por categoría
      const dishCount: { [key: string]: { category: string; frequency: number; schools: Set<string> } } = {};
      
      menus?.forEach(menu => {
        // Entrada
        if (menu.starter) {
          const key = menu.starter.toLowerCase();
          if (!dishCount[key]) {
            dishCount[key] = { category: 'Entrada', frequency: 0, schools: new Set() };
          }
          dishCount[key].frequency += 1;
          dishCount[key].schools.add(menu.school_id);
        }
        // Segundo
        if (menu.main_course) {
          const key = menu.main_course.toLowerCase();
          if (!dishCount[key]) {
            dishCount[key] = { category: 'Segundo', frequency: 0, schools: new Set() };
          }
          dishCount[key].frequency += 1;
          dishCount[key].schools.add(menu.school_id);
        }
        // Bebida
        if (menu.beverage) {
          const key = menu.beverage.toLowerCase();
          if (!dishCount[key]) {
            dishCount[key] = { category: 'Bebida', frequency: 0, schools: new Set() };
          }
          dishCount[key].frequency += 1;
          dishCount[key].schools.add(menu.school_id);
        }
        // Postre
        if (menu.dessert) {
          const key = menu.dessert.toLowerCase();
          if (!dishCount[key]) {
            dishCount[key] = { category: 'Postre', frequency: 0, schools: new Set() };
          }
          dishCount[key].frequency += 1;
          dishCount[key].schools.add(menu.school_id);
        }
      });

      const dishPopularityData = Object.entries(dishCount)
        .map(([name, data]) => ({
          dish_name: name.charAt(0).toUpperCase() + name.slice(1),
          category: data.category,
          frequency: data.frequency,
          schools_count: data.schools.size
        }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 15);

      setDishPopularity(dishPopularityData);

      // Menús por día de la semana
      const dayCount: { [key: number]: { menus: number; schools: Set<string> } } = {};
      
      menus?.forEach(menu => {
        const dayOfWeek = new Date(menu.date).getDay();
        if (!dayCount[dayOfWeek]) {
          dayCount[dayOfWeek] = { menus: 0, schools: new Set() };
        }
        dayCount[dayOfWeek].menus += 1;
        dayCount[dayOfWeek].schools.add(menu.school_id);
      });

      const menusByDayData = Object.entries(dayCount)
        .map(([day, data]) => ({
          day_of_week: DAY_NAMES[parseInt(day)],
          total_menus: data.menus,
          schools_served: data.schools.size
        }))
        .sort((a, b) => {
          const dayOrder = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
          return dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week);
        });

      setMenusByDay(menusByDayData);

      // Estadísticas por escuela
      const schoolMenuCount: { [key: string]: { name: string; menus: number; dishes: Set<string> } } = {};
      
      menus?.forEach(menu => {
        const schoolName = menu.school?.name || 'Sin nombre';
        if (!schoolMenuCount[schoolName]) {
          schoolMenuCount[schoolName] = { name: schoolName, menus: 0, dishes: new Set() };
        }
        schoolMenuCount[schoolName].menus += 1;
        if (menu.starter) schoolMenuCount[schoolName].dishes.add(menu.starter.toLowerCase());
        if (menu.main_course) schoolMenuCount[schoolName].dishes.add(menu.main_course.toLowerCase());
        if (menu.beverage) schoolMenuCount[schoolName].dishes.add(menu.beverage.toLowerCase());
        if (menu.dessert) schoolMenuCount[schoolName].dishes.add(menu.dessert.toLowerCase());
      });

      const schoolStatsData = Object.values(schoolMenuCount)
        .map(s => ({
          school_name: s.name,
          total_menus: s.menus,
          unique_dishes: s.dishes.size
        }))
        .sort((a, b) => b.total_menus - a.total_menus);

      setSchoolStats(schoolStatsData);

      // Calcular métricas generales
      const mostPopularDish = dishPopularityData[0]?.dish_name || 'N/A';
      const busiestDay = menusByDayData.reduce((max, curr) => 
        curr.total_menus > max.total_menus ? curr : max, 
        menusByDayData[0] || { day_of_week: 'N/A', total_menus: 0, schools_served: 0 }
      ).day_of_week;
      const avgDishesPerDay = totalMenus / (menusByDayData.length || 1);

      setMetrics({
        total_menus: totalMenus,
        active_schools: uniqueSchools,
        most_popular_dish: mostPopularDish,
        busiest_day: busiestDay,
        avg_dishes_per_day: avgDishesPerDay
      });

    } catch (error: any) {
      console.error('Error loading lunch analytics:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las métricas de almuerzos',
      });
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = () => {
    const now = new Date();
    if (timeRange === 'month') {
      return {
        start: startOfMonth(now),
        end: endOfMonth(now)
      };
    } else {
      // Últimos 6 meses
      const start = new Date(now);
      start.setMonth(start.getMonth() - 6);
      return { start, end: now };
    }
  };

  const exportToExcel = () => {
    if (!metrics) {
      toast({
        title: 'Sin datos',
        description: 'No hay datos para exportar',
      });
      return;
    }

    // Hoja 1: Resumen
    const summaryData = [{
      'Total Menús': metrics.total_menus,
      'Sedes Activas': metrics.active_schools,
      'Plato Más Popular': metrics.most_popular_dish,
      'Día Más Solicitado': metrics.busiest_day,
      'Promedio Menús/Día': metrics.avg_dishes_per_day.toFixed(1),
      'Período': timeRange === 'month' ? 'Este Mes' : 'Últimos 6 Meses'
    }];

    // Hoja 2: Popularidad de Platos
    const dishData = dishPopularity.map(d => ({
      'Plato': d.dish_name,
      'Categoría': d.category,
      'Veces Servido': d.frequency,
      'Sedes': d.schools_count
    }));

    // Hoja 3: Por Día de Semana
    const dayData = menusByDay.map(d => ({
      'Día': d.day_of_week,
      'Total Menús': d.total_menus,
      'Sedes Atendidas': d.schools_served
    }));

    // Hoja 4: Por Sede
    const schoolData = schoolStats.map(s => ({
      'Sede': s.school_name,
      'Total Menús': s.total_menus,
      'Platos Únicos': s.unique_dishes
    }));

    // Crear libro de Excel
    const wb = XLSX.utils.book_new();
    
    const ws1 = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

    const ws2 = XLSX.utils.json_to_sheet(dishData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Platos Populares');

    const ws3 = XLSX.utils.json_to_sheet(dayData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Por Día');

    const ws4 = XLSX.utils.json_to_sheet(schoolData);
    XLSX.utils.book_append_sheet(wb, ws4, 'Por Sede');

    XLSX.writeFile(wb, `reporte_almuerzos_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    toast({
      title: '✅ Exportado',
      description: 'El reporte se descargó exitosamente',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con filtros */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-800">
            Analytics de Almuerzos
            {selectedSchool === 'all' ? ' - Global' : ' - Por Sede'}
          </h2>
          <p className="text-slate-400 font-medium mt-1">
            {selectedSchool === 'all' 
              ? '📊 Vista consolidada de todos los menús del sistema' 
              : '🏫 Vista filtrada por sede seleccionada'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeRange('month')}
            className={timeRange === 'month' ? 'bg-[#8B4513] text-white' : ''}
          >
            Este Mes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeRange('all')}
            className={timeRange === 'all' ? 'bg-[#8B4513] text-white' : ''}
          >
            Últimos 6 Meses
          </Button>
          <Button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700">
            <Download className="h-4 w-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Métricas principales (KPIs) */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4" />
                Total Menús
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{metrics.total_menus}</div>
              <p className="text-xs text-slate-400 mt-1">Menús programados</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Sedes Activas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{metrics.active_schools}</div>
              <p className="text-xs text-slate-400 mt-1">Con menús programados</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <Award className="h-4 w-4" />
                Plato Más Popular
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-black text-slate-800">{metrics.most_popular_dish}</div>
              <p className="text-xs text-slate-400 mt-1">Favorito de las sedes</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Día Más Solicitado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-slate-800">{metrics.busiest_day}</div>
              <p className="text-xs text-slate-400 mt-1">Mayor demanda</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs para diferentes vistas */}
      <Tabs defaultValue="dishes" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="dishes">Platos Populares</TabsTrigger>
          <TabsTrigger value="days">Por Día</TabsTrigger>
          <TabsTrigger value="schools">Por Sede</TabsTrigger>
        </TabsList>

        {/* Pestaña: Platos Populares */}
        <TabsContent value="dishes" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Top 15 Platos Más Servidos</CardTitle>
                <CardDescription>Por frecuencia de aparición</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={dishPopularity.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="dish_name" type="category" width={100} />
                    <Tooltip />
                    <Bar dataKey="frequency" fill="#8B4513" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Distribución por Categoría</CardTitle>
                <CardDescription>Top 8 platos por categoría</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={dishPopularity.slice(0, 8)}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ dish_name, percent }) => `${dish_name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="frequency"
                    >
                      {dishPopularity.slice(0, 8).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Tabla detallada */}
          <Card>
            <CardHeader>
              <CardTitle>Detalle de Platos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 font-black">Plato</th>
                      <th className="text-center p-3 font-black">Categoría</th>
                      <th className="text-center p-3 font-black">Veces Servido</th>
                      <th className="text-center p-3 font-black">Sedes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dishPopularity.map((dish, idx) => (
                      <tr key={idx} className="border-b hover:bg-slate-50">
                        <td className="p-3 font-bold">{dish.dish_name}</td>
                        <td className="p-3 text-center">
                          <Badge className="bg-[#8B4513] text-white">{dish.category}</Badge>
                        </td>
                        <td className="p-3 text-center font-bold text-green-600">{dish.frequency}</td>
                        <td className="p-3 text-center">{dish.schools_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestaña: Por Día */}
        <TabsContent value="days">
          <Card>
            <CardHeader>
              <CardTitle>Demanda por Día de Semana</CardTitle>
              <CardDescription>Análisis de menús programados por día</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={menusByDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day_of_week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total_menus" fill="#8B4513" name="Total Menús" />
                  <Bar dataKey="schools_served" fill="#82ca9d" name="Sedes Atendidas" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestaña: Por Sede */}
        <TabsContent value="schools">
          <Card>
            <CardHeader>
              <CardTitle>Estadísticas por Sede</CardTitle>
              <CardDescription>Variedad y frecuencia de menús</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {schoolStats.map((school, idx) => (
                  <Card key={idx} className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-black text-slate-800">{school.school_name}</p>
                          <p className="text-sm text-slate-500">{school.unique_dishes} platos únicos</p>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-black text-blue-600">{school.total_menus}</p>
                          <p className="text-xs text-slate-400">Menús totales</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
