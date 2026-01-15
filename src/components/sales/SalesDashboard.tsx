import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  TrendingUp, 
  TrendingDown, 
  ShoppingCart, 
  DollarSign, 
  Users, 
  Package,
  Download,
  Calendar,
  BarChart3
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import * as XLSX from 'xlsx';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';

interface SaleMetrics {
  total_sales: number;
  total_amount: number;
  avg_ticket: number;
  total_products_sold: number;
  top_product: string;
  growth_percentage: number;
}

interface SalesByProduct {
  product_name: string;
  quantity: number;
  total_amount: number;
}

interface SalesByDay {
  date: string;
  total_sales: number;
  total_amount: number;
}

interface SalesByStudent {
  student_name: string;
  total_purchases: number;
  total_spent: number;
}

const COLORS = ['#8B4513', '#D2691E', '#CD853F', '#DEB887', '#F4A460', '#8B7355', '#A0522D'];

interface SalesDashboardProps {
  selectedSchool?: string;
  canViewAllSchools: boolean;
}

export function SalesDashboard({ selectedSchool = 'all', canViewAllSchools }: SalesDashboardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { role } = useRole();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<SaleMetrics | null>(null);
  const [salesByProduct, setSalesByProduct] = useState<SalesByProduct[]>([]);
  const [salesByDay, setSalesByDay] = useState<SalesByDay[]>([]);
  const [salesByStudent, setSalesByStudent] = useState<SalesByStudent[]>([]);
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');

  useEffect(() => {
    loadDashboardData();
  }, [timeRange, selectedSchool]);

  const getDateRange = () => {
    const now = new Date();
    let start, end;

    switch (timeRange) {
      case 'today':
        start = startOfDay(now);
        end = endOfDay(now);
        break;
      case 'week':
        start = startOfWeek(now, { locale: es });
        end = endOfWeek(now, { locale: es });
        break;
      case 'month':
        start = startOfMonth(now);
        end = endOfMonth(now);
        break;
      default:
        start = startOfDay(now);
        end = endOfDay(now);
    }

    return { start, end };
  };

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const { start, end } = getDateRange();

      // Construir query base
      let transactionsQuery = supabase
        .from('transactions')
        .select(`
          *,
          student:students(full_name, school_id, school:schools(name)),
          items:transaction_items(quantity, price, product:products(name))
        `)
        .eq('type', 'sale')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

      // Filtrar por sede si no es "all"
      if (selectedSchool && selectedSchool !== 'all') {
        transactionsQuery = transactionsQuery.eq('students.school_id', selectedSchool);
      }

      const { data: transactions, error } = await transactionsQuery;

      if (error) throw error;

      // Calcular métricas
      const totalSales = transactions?.length || 0;
      const totalAmount = transactions?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0;
      const avgTicket = totalSales > 0 ? totalAmount / totalSales : 0;

      // Productos más vendidos
      const productSales: { [key: string]: { quantity: number; amount: number } } = {};
      let totalProductsSold = 0;

      transactions?.forEach(t => {
        t.items?.forEach((item: any) => {
          const productName = item.product?.name || 'Sin nombre';
          if (!productSales[productName]) {
            productSales[productName] = { quantity: 0, amount: 0 };
          }
          productSales[productName].quantity += item.quantity || 0;
          productSales[productName].amount += (item.quantity || 0) * (item.price || 0);
          totalProductsSold += item.quantity || 0;
        });
      });

      const salesByProductData = Object.entries(productSales)
        .map(([name, data]) => ({
          product_name: name,
          quantity: data.quantity,
          total_amount: data.amount
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

      setSalesByProduct(salesByProductData);

      // Ventas por día
      const salesByDayMap: { [key: string]: { sales: number; amount: number } } = {};
      transactions?.forEach(t => {
        const day = format(new Date(t.created_at), 'dd/MM', { locale: es });
        if (!salesByDayMap[day]) {
          salesByDayMap[day] = { sales: 0, amount: 0 };
        }
        salesByDayMap[day].sales += 1;
        salesByDayMap[day].amount += t.amount || 0;
      });

      const salesByDayData = Object.entries(salesByDayMap)
        .map(([date, data]) => ({
          date,
          total_sales: data.sales,
          total_amount: data.amount
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setSalesByDay(salesByDayData);

      // Ventas por estudiante (top 10)
      const studentSales: { [key: string]: { purchases: number; spent: number } } = {};
      transactions?.forEach(t => {
        const studentName = t.student?.full_name || 'Sin nombre';
        if (!studentSales[studentName]) {
          studentSales[studentName] = { purchases: 0, spent: 0 };
        }
        studentSales[studentName].purchases += 1;
        studentSales[studentName].spent += t.amount || 0;
      });

      const salesByStudentData = Object.entries(studentSales)
        .map(([name, data]) => ({
          student_name: name,
          total_purchases: data.purchases,
          total_spent: data.spent
        }))
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, 10);

      setSalesByStudent(salesByStudentData);

      // Calcular crecimiento (comparar con período anterior)
      // TODO: Implementar comparación con período anterior
      const growthPercentage = 0;

      const topProduct = salesByProductData[0]?.product_name || 'N/A';

      setMetrics({
        total_sales: totalSales,
        total_amount: totalAmount,
        avg_ticket: avgTicket,
        total_products_sold: totalProductsSold,
        top_product: topProduct,
        growth_percentage: growthPercentage
      });

    } catch (error: any) {
      console.error('Error loading sales dashboard:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las métricas de ventas',
      });
    } finally {
      setLoading(false);
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
      'Total Ventas': metrics.total_sales,
      'Monto Total (S/)': metrics.total_amount.toFixed(2),
      'Ticket Promedio (S/)': metrics.avg_ticket.toFixed(2),
      'Productos Vendidos': metrics.total_products_sold,
      'Producto Top': metrics.top_product,
      'Período': timeRange === 'today' ? 'Hoy' : timeRange === 'week' ? 'Esta Semana' : 'Este Mes'
    }];

    // Hoja 2: Ventas por Producto
    const productData = salesByProduct.map(p => ({
      'Producto': p.product_name,
      'Cantidad Vendida': p.quantity,
      'Monto Total (S/)': p.total_amount.toFixed(2)
    }));

    // Hoja 3: Ventas por Estudiante
    const studentData = salesByStudent.map(s => ({
      'Estudiante': s.student_name,
      'Total Compras': s.total_purchases,
      'Total Gastado (S/)': s.total_spent.toFixed(2)
    }));

    // Crear libro de Excel
    const wb = XLSX.utils.book_new();
    
    const ws1 = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

    const ws2 = XLSX.utils.json_to_sheet(productData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Por Producto');

    const ws3 = XLSX.utils.json_to_sheet(studentData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Por Estudiante');

    XLSX.writeFile(wb, `reporte_ventas_${new Date().toISOString().split('T')[0]}.xlsx`);
    
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
            Dashboard de Ventas
            {selectedSchool === 'all' ? ' - Global' : ' - Por Sede'}
          </h2>
          <p className="text-slate-400 font-medium mt-1">
            {selectedSchool === 'all' 
              ? '📊 Vista consolidada de todas las ventas del sistema' 
              : '🏫 Vista filtrada por sede seleccionada'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeRange('today')}
            className={timeRange === 'today' ? 'bg-[#8B4513] text-white' : ''}
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeRange('week')}
            className={timeRange === 'week' ? 'bg-[#8B4513] text-white' : ''}
          >
            Esta Semana
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeRange('month')}
            className={timeRange === 'month' ? 'bg-[#8B4513] text-white' : ''}
          >
            Este Mes
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
                <ShoppingCart className="h-4 w-4" />
                Total Ventas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{metrics.total_sales}</div>
              <p className="text-xs text-slate-400 mt-1">Transacciones realizadas</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Monto Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">
                S/ {metrics.total_amount.toFixed(2)}
              </div>
              <p className="text-xs text-slate-400 mt-1">Ingresos generados</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Ticket Promedio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">
                S/ {metrics.avg_ticket.toFixed(2)}
              </div>
              <p className="text-xs text-slate-400 mt-1">Por transacción</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Productos Vendidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{metrics.total_products_sold}</div>
              <p className="text-xs text-slate-400 mt-1">Unidades totales</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs para diferentes vistas */}
      <Tabs defaultValue="products" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="products">Por Producto</TabsTrigger>
          <TabsTrigger value="timeline">Por Día</TabsTrigger>
          <TabsTrigger value="students">Por Cliente</TabsTrigger>
        </TabsList>

        {/* Pestaña: Ventas por Producto */}
        <TabsContent value="products" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Top 10 Productos Más Vendidos</CardTitle>
                <CardDescription>Por cantidad de unidades</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={salesByProduct}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="product_name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="quantity" fill="#8B4513" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Distribución de Ventas</CardTitle>
                <CardDescription>Por monto generado</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={salesByProduct.slice(0, 5)}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ product_name, percent }) => `${product_name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="total_amount"
                    >
                      {salesByProduct.slice(0, 5).map((entry, index) => (
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
              <CardTitle>Detalle de Productos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 font-black">Producto</th>
                      <th className="text-center p-3 font-black">Cantidad</th>
                      <th className="text-right p-3 font-black">Monto Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesByProduct.map((product, idx) => (
                      <tr key={idx} className="border-b hover:bg-slate-50">
                        <td className="p-3 font-bold">{product.product_name}</td>
                        <td className="p-3 text-center">{product.quantity}</td>
                        <td className="p-3 text-right font-bold text-green-600">
                          S/ {product.total_amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestaña: Ventas por Día */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle>Evolución de Ventas</CardTitle>
              <CardDescription>Ventas diarias en el período seleccionado</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={salesByDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="total_sales" stroke="#8B4513" name="Cantidad de Ventas" />
                  <Line yAxisId="right" type="monotone" dataKey="total_amount" stroke="#82ca9d" name="Monto (S/)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestaña: Ventas por Estudiante */}
        <TabsContent value="students">
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Clientes</CardTitle>
              <CardDescription>Estudiantes con mayor consumo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {salesByStudent.map((student, idx) => (
                  <Card key={idx} className="border-l-4 border-l-green-500">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-black text-slate-800">{student.student_name}</p>
                          <p className="text-sm text-slate-500">{student.total_purchases} compras</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-green-600">
                            S/ {student.total_spent.toFixed(2)}
                          </p>
                          <p className="text-xs text-slate-400">Total gastado</p>
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
