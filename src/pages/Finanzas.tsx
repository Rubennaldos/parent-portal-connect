import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { UserProfileMenu } from '@/components/admin/UserProfileMenu';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Building2,
  CreditCard,
  Banknote,
  Coins,
  Receipt,
  UserCheck,
  Calendar,
  Filter,
  RefreshCw,
  Eye,
  Clock,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  PiggyBank,
  LineChart,
  ArrowLeft,
  Home
} from 'lucide-react';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';

interface Sale {
  id: string;
  transaction_id: string;
  total: number;
  payment_method: string;
  cashier_name: string;
  school_name: string;
  student_name: string;
  created_at: string;
  items: any[];
  cash_received?: number;
  change_given?: number;
}

interface DashboardMetrics {
  totalCashToday: number;
  totalSalesToday: number;
  totalTransactionsToday: number;
  cashBySchool: { school: string; amount: number }[];
  paymentMethods: { method: string; amount: number; count: number }[];
  topCashiers: { name: string; amount: number; sales: number }[];
  insights: string[];
}

export default function Finanzas() {
  const { user, signOut } = useAuth();
  const { full_name } = useUserProfile();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Filtros
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'today' | '7days' | '30days' | 'custom'>('today');
  const [startDate, setStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Data
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSaleDetails, setSelectedSaleDetails] = useState<Sale | null>(null);
  const [dailySales, setDailySales] = useState<{ date: string; sales: number; amount: number; transactions: Sale[] }[]>([]);

  useEffect(() => {
    fetchSchools();
    fetchData();

    // Auto-refresh cada 10 segundos si está activado
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchData();
        setLastUpdate(new Date());
      }, 10000); // 10 segundos
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedSchool, selectedPaymentMethod, dateRange, startDate, endDate, autoRefresh]);

  const fetchSchools = async () => {
    const { data } = await supabase
      .from('schools')
      .select('id, name')
      .eq('is_active', true)
      .order('name');
    
    setSchools(data || []);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchDashboardMetrics(),
        fetchSales()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDashboardMetrics = async () => {
    // Determinar rango de fechas
    let startDateTime, endDateTime;
    if (dateRange === 'today') {
      startDateTime = startOfDay(new Date());
      endDateTime = endOfDay(new Date());
    } else if (dateRange === '7days') {
      startDateTime = startOfDay(subDays(new Date(), 7));
      endDateTime = endOfDay(new Date());
    } else if (dateRange === '30days') {
      startDateTime = startOfDay(subDays(new Date(), 30));
      endDateTime = endOfDay(new Date());
    } else {
      startDateTime = new Date(startDate + 'T00:00:00');
      endDateTime = new Date(endDate + 'T23:59:59');
    }

    // Query base
    let query = supabase
      .from('sales')
      .select(`
        *,
        profiles!sales_cashier_id_fkey(full_name),
        schools(name),
        students(full_name)
      `)
      .gte('created_at', startDateTime.toISOString())
      .lte('created_at', endDateTime.toISOString());

    if (selectedSchool !== 'all') {
      query = query.eq('school_id', selectedSchool);
    }

    if (selectedPaymentMethod !== 'all') {
      query = query.eq('payment_method', selectedPaymentMethod);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Calcular métricas
    const totalCashToday = data
      ?.filter(s => s.payment_method === 'cash')
      .reduce((sum, s) => sum + s.total, 0) || 0;

    const totalSalesToday = data?.reduce((sum, s) => sum + s.total, 0) || 0;
    const totalTransactionsToday = data?.length || 0;

    // Cash por sede
    const cashBySchoolMap = new Map<string, number>();
    data?.forEach(sale => {
      if (sale.payment_method === 'cash') {
        const schoolName = sale.schools?.name || 'Sin sede';
        cashBySchoolMap.set(schoolName, (cashBySchoolMap.get(schoolName) || 0) + sale.total);
      }
    });

    const cashBySchool = Array.from(cashBySchoolMap.entries())
      .map(([school, amount]) => ({ school, amount }))
      .sort((a, b) => b.amount - a.amount);

    // Métodos de pago
    const paymentMethodsMap = new Map<string, { amount: number; count: number }>();
    data?.forEach(sale => {
      const method = sale.payment_method || 'unknown';
      const current = paymentMethodsMap.get(method) || { amount: 0, count: 0 };
      paymentMethodsMap.set(method, {
        amount: current.amount + sale.total,
        count: current.count + 1
      });
    });

    const paymentMethods = Array.from(paymentMethodsMap.entries())
      .map(([method, data]) => ({ method, ...data }))
      .sort((a, b) => b.amount - a.amount);

    // Top cajeros
    const cashiersMap = new Map<string, { amount: number; sales: number }>();
    data?.forEach(sale => {
      const cashierName = sale.profiles?.full_name || 'Desconocido';
      const current = cashiersMap.get(cashierName) || { amount: 0, sales: 0 };
      cashiersMap.set(cashierName, {
        amount: current.amount + sale.total,
        sales: current.sales + 1
      });
    });

    const topCashiers = Array.from(cashiersMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Generar insights automáticos
    const insights: string[] = [];
    
    if (cashBySchool.length > 0) {
      const topSchool = cashBySchool[0];
      const percentage = ((topSchool.amount / totalCashToday) * 100).toFixed(0);
      insights.push(`🏆 ${topSchool.school} lidera en ventas en efectivo con S/ ${topSchool.amount.toFixed(2)} (${percentage}%)`);
    }

    const cashPercentage = ((totalCashToday / totalSalesToday) * 100).toFixed(0);
    insights.push(`💵 ${cashPercentage}% de las ventas fueron en efectivo (S/ ${totalCashToday.toFixed(2)} de S/ ${totalSalesToday.toFixed(2)})`);

    if (topCashiers.length > 0) {
      insights.push(`👤 Mejor cajero: ${topCashiers[0].name} con ${topCashiers[0].sales} ventas y S/ ${topCashiers[0].amount.toFixed(2)}`);
    }

    const avgSale = totalTransactionsToday > 0 ? totalSalesToday / totalTransactionsToday : 0;
    insights.push(`📊 Ticket promedio: S/ ${avgSale.toFixed(2)}`);

    setMetrics({
      totalCashToday,
      totalSalesToday,
      totalTransactionsToday,
      cashBySchool,
      paymentMethods,
      topCashiers,
      insights
    });
  };

  const fetchSales = async () => {
    // Similar query para tabla de ventas
    let startDateTime, endDateTime;
    if (dateRange === 'today') {
      startDateTime = startOfDay(new Date());
      endDateTime = endOfDay(new Date());
    } else if (dateRange === '7days') {
      startDateTime = startOfDay(subDays(new Date(), 7));
      endDateTime = endOfDay(new Date());
    } else if (dateRange === '30days') {
      startDateTime = startOfDay(subDays(new Date(), 30));
      endDateTime = endOfDay(new Date());
    } else {
      startDateTime = new Date(startDate + 'T00:00:00');
      endDateTime = new Date(endDate + 'T23:59:59');
    }

    let query = supabase
      .from('sales')
      .select(`
        *,
        profiles!sales_cashier_id_fkey(full_name),
        schools(name),
        students(full_name)
      `)
      .gte('created_at', startDateTime.toISOString())
      .lte('created_at', endDateTime.toISOString());

    if (selectedSchool !== 'all') {
      query = query.eq('school_id', selectedSchool);
    }

    if (selectedPaymentMethod !== 'all') {
      query = query.eq('payment_method', selectedPaymentMethod);
    }

    const { data } = await query.order('created_at', { ascending: false });

    const formattedSales: Sale[] = data?.map(sale => ({
      id: sale.id,
      transaction_id: sale.transaction_id,
      total: sale.total,
      payment_method: sale.payment_method,
      cashier_name: sale.profiles?.full_name || 'Desconocido',
      school_name: sale.schools?.name || 'Sin sede',
      student_name: sale.students?.full_name || 'Desconocido',
      created_at: sale.created_at,
      items: sale.items || [],
      cash_received: sale.cash_received,
      change_given: sale.change_given
    })) || [];

    setSales(formattedSales);
    
    // Agrupar por día
    const dailyMap = new Map<string, { sales: number; amount: number; transactions: Sale[] }>();
    formattedSales.forEach(sale => {
      const dateKey = format(new Date(sale.created_at), 'yyyy-MM-dd');
      const current = dailyMap.get(dateKey) || { sales: 0, amount: 0, transactions: [] };
      dailyMap.set(dateKey, {
        sales: current.sales + 1,
        amount: current.amount + sale.total,
        transactions: [...current.transactions, sale]
      });
    });

    const dailySalesArray = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.date.localeCompare(a.date));

    setDailySales(dailySalesArray);
  };

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      yape: 'Yape',
      plin: 'Plin',
      transfer: 'Transferencia',
      debt: 'Fiado'
    };
    return labels[method] || method;
  };

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case 'cash':
        return <Banknote className="h-4 w-4" />;
      case 'card':
        return <CreditCard className="h-4 w-4" />;
      case 'yape':
      case 'plin':
      case 'transfer':
        return <Wallet className="h-4 w-4" />;
      default:
        return <DollarSign className="h-4 w-4" />;
    }
  };

  if (loading && !metrics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Cargando módulo de finanzas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-3 sm:p-6">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/dashboard')}
              className="gap-2 flex-shrink-0"
            >
              <Home className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Volver al Panel</span>
              <span className="sm:hidden">Volver</span>
            </Button>
            <div className="flex-1 sm:flex-initial">
              <h1 className="text-xl sm:text-3xl font-black text-gray-900 flex items-center gap-2 sm:gap-3">
                <div className="p-2 sm:p-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl sm:rounded-2xl shadow-lg">
                  <LineChart className="h-5 w-5 sm:h-8 sm:w-8 text-white" />
                </div>
                <span className="hidden sm:inline">Finanzas y Tesorería</span>
                <span className="sm:hidden text-lg">Finanzas</span>
              </h1>
              <p className="text-gray-600 mt-1 sm:mt-2 flex items-center gap-1 sm:gap-2 text-xs sm:text-base">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Última actualización: {format(lastUpdate, 'HH:mm:ss', { locale: es })}</span>
                <span className="sm:hidden">{format(lastUpdate, 'HH:mm', { locale: es })}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <UserProfileMenu
              userEmail={user?.email || ''}
              userName={full_name || undefined}
              onLogout={signOut}
            />
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="gap-2 text-xs sm:text-sm"
            >
              <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{autoRefresh ? 'Auto-actualización ON' : 'Auto-actualización OFF'}</span>
              <span className="sm:hidden">{autoRefresh ? 'Auto ON' : 'Auto OFF'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              className="gap-2 text-xs sm:text-sm"
            >
              <RefreshCw className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Actualizar ahora</span>
              <span className="sm:hidden">Actualizar</span>
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <Card className="border-2">
          <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
            <CardTitle className="text-xs sm:text-sm flex items-center gap-2">
              <Filter className="h-3 w-3 sm:h-4 sm:w-4" />
              Filtros Avanzados
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <Label className="text-xs">Sede</Label>
                <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                  <SelectTrigger className="h-9 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sedes</SelectItem>
                    {schools.map(school => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Medio de Pago</Label>
                <Select value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
                  <SelectTrigger className="h-9 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                    <SelectItem value="yape">Yape</SelectItem>
                    <SelectItem value="plin">Plin</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Label className="text-xs">Rango de Fecha</Label>
                <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                  <SelectTrigger className="h-9 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Hoy</SelectItem>
                    <SelectItem value="7days">Últimos 7 días</SelectItem>
                    <SelectItem value="30days">Últimos 30 días</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {dateRange === 'custom' && (
                <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
                  <div>
                    <Label className="text-xs">Desde</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-9 sm:h-10"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Hasta</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-9 sm:h-10"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 mb-4 sm:mb-6 h-auto">
          <TabsTrigger value="dashboard" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2">
            <LineChart className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Dashboard</span>
            <span className="sm:hidden">Panel</span>
          </TabsTrigger>
          <TabsTrigger value="movimientos" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2">
            <Receipt className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Movimientos</span>
            <span className="sm:hidden">Mov</span>
          </TabsTrigger>
          <TabsTrigger value="auditoria" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2">
            <Eye className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Auditoría</span>
            <span className="sm:hidden">Audit</span>
          </TabsTrigger>
          <TabsTrigger value="ventas-dia" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2">
            <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Ventas/Día</span>
            <span className="sm:hidden">Días</span>
          </TabsTrigger>
        </TabsList>

        {/* DASHBOARD TAB */}
        <TabsContent value="dashboard">
          {metrics && (
            <div className="space-y-3 sm:space-y-4">
              {/* Insights Automáticos - MÁS COMPACTO */}
              <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200">
                <CardHeader className="pb-2 px-3 sm:px-4 py-2 sm:py-3">
                  <CardTitle className="flex items-center gap-2 text-xs sm:text-sm">
                    <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 text-blue-600" />
                    Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 sm:px-4 pb-2 sm:pb-3">
                  <div className="space-y-1.5">
                    {metrics.insights.map((insight, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs bg-white p-1.5 sm:p-2 rounded shadow-sm">
                        <CheckCircle2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700 leading-tight">{insight}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Métricas principales - MÁS PEQUEÑAS */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0 shadow-md">
                  <CardContent className="p-2 sm:p-3">
                    <div className="text-[9px] sm:text-[10px] text-white/90 flex items-center gap-1 mb-1">
                      <Banknote className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      Efectivo
                    </div>
                    <div className="text-lg sm:text-2xl font-black">
                      S/ {metrics.totalCashToday.toFixed(2)}
                    </div>
                    <div className="text-[8px] sm:text-[9px] text-white/70">En vivo</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0 shadow-md">
                  <CardContent className="p-2 sm:p-3">
                    <div className="text-[9px] sm:text-[10px] text-white/90 flex items-center gap-1 mb-1">
                      <DollarSign className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      Total Ventas
                    </div>
                    <div className="text-lg sm:text-2xl font-black">
                      S/ {metrics.totalSalesToday.toFixed(2)}
                    </div>
                    <div className="text-[8px] sm:text-[9px] text-white/70">{metrics.totalTransactionsToday} ventas</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-500 to-pink-600 text-white border-0 shadow-md col-span-2 lg:col-span-1">
                  <CardContent className="p-2 sm:p-3">
                    <div className="text-[9px] sm:text-[10px] text-white/90 flex items-center gap-1 mb-1">
                      <TrendingUp className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      Promedio
                    </div>
                    <div className="text-lg sm:text-2xl font-black">
                      S/ {(metrics.totalSalesToday / (metrics.totalTransactionsToday || 1)).toFixed(2)}
                    </div>
                    <div className="text-[8px] sm:text-[9px] text-white/70">Por venta</div>
                  </CardContent>
                </Card>
              </div>

              {/* EFECTIVO POR SEDE - COMPACTO */}
              <Card className="border-2 border-green-500 shadow-lg">
                <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b-2 border-green-200 px-3 sm:px-4 py-2 sm:py-3">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <PiggyBank className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
                    💵 Efectivo por Sede
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2 sm:p-4">
                  <div className="space-y-2">
                    {metrics.cashBySchool.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 sm:p-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200"
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-sm sm:text-lg font-black text-green-600">#{idx + 1}</div>
                          <div>
                            <div className="font-bold text-xs sm:text-sm text-gray-900 flex items-center gap-1">
                              <Building2 className="h-3 w-3 sm:h-4 sm:w-4 text-green-600" />
                              {item.school}
                            </div>
                            <div className="text-[9px] sm:text-xs text-gray-600">
                              {((item.amount / metrics.totalCashToday) * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-base sm:text-xl font-black text-green-600">
                            S/ {item.amount.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Grid de métricas adicionales - MÁS COMPACTO */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
                {/* Medios de pago - COMPACTO */}
                <Card>
                  <CardHeader className="pb-2 px-3 sm:px-4 py-2 sm:py-3">
                    <CardTitle className="flex items-center gap-2 text-xs sm:text-sm">
                      <CreditCard className="h-3 w-3 sm:h-4 sm:w-4" />
                      Medios de Pago
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 sm:px-4 pb-2 sm:pb-3">
                    <div className="space-y-1.5 sm:space-y-2">
                      {metrics.paymentMethods.map((pm, idx) => (
                        <div key={idx} className="flex items-center justify-between p-1.5 sm:p-2 bg-gray-50 rounded">
                          <div className="flex items-center gap-1.5">
                            {getPaymentMethodIcon(pm.method)}
                            <div>
                              <div className="font-semibold text-[10px] sm:text-xs">{getPaymentMethodLabel(pm.method)}</div>
                              <div className="text-[9px] sm:text-[10px] text-gray-500">{pm.count} ops</div>
                            </div>
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-gray-900">
                            S/ {pm.amount.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Top cajeros - COMPACTO */}
                <Card>
                  <CardHeader className="pb-2 px-3 sm:px-4 py-2 sm:py-3">
                    <CardTitle className="flex items-center gap-2 text-xs sm:text-sm">
                      <UserCheck className="h-3 w-3 sm:h-4 sm:w-4" />
                      Top Cajeros
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 sm:px-4 pb-2 sm:pb-3">
                    <div className="space-y-1.5 sm:space-y-2">
                      {metrics.topCashiers.map((cashier, idx) => (
                        <div key={idx} className="flex items-center justify-between p-1.5 sm:p-2 bg-gray-50 rounded">
                          <div className="flex items-center gap-1.5">
                            <div className="text-xs sm:text-sm font-black text-gray-600">#{idx + 1}</div>
                            <div>
                              <div className="font-semibold text-[10px] sm:text-xs">{cashier.name}</div>
                              <div className="text-[9px] sm:text-[10px] text-gray-500">{cashier.sales} ventas</div>
                            </div>
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-gray-900">
                            S/ {cashier.amount.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* MOVIMIENTOS DE CAJA TAB */}
        <TabsContent value="movimientos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Movimientos de Caja - Auditoría por Cajero
              </CardTitle>
              <CardDescription>
                Seguimiento detallado de movimientos de efectivo por cada cajero
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metrics && metrics.topCashiers.length > 0 ? (
                <div className="space-y-4">
                  {metrics.topCashiers.map((cashier, idx) => {
                    const cashierSales = sales.filter(s => s.cashier_name === cashier.name);
                    const cashSales = cashierSales.filter(s => s.payment_method === 'cash');
                    const totalCash = cashSales.reduce((sum, s) => sum + s.total, 0);
                    const totalCashReceived = cashSales.reduce((sum, s) => sum + (s.cash_received || 0), 0);
                    const totalChange = cashSales.reduce((sum, s) => sum + (s.change_given || 0), 0);

                    return (
                      <details key={idx} className="group bg-white border-2 rounded-xl overflow-hidden">
                        <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50">
                          <div className="flex items-center gap-4">
                            <div className="text-2xl font-black text-gray-600 min-w-[40px]">
                              #{idx + 1}
                            </div>
                            <div>
                              <div className="font-black text-lg text-gray-900">{cashier.name}</div>
                              <div className="text-sm text-gray-600">
                                {cashierSales.length} ventas • {cashSales.length} en efectivo
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Total Ventas</div>
                              <div className="text-xl font-bold text-gray-900">
                                S/ {cashier.amount.toFixed(2)}
                              </div>
                            </div>
                            <div className="text-right bg-green-50 px-4 py-2 rounded-lg">
                              <div className="text-xs text-green-700 font-semibold">Efectivo</div>
                              <div className="text-2xl font-black text-green-600">
                                S/ {totalCash.toFixed(2)}
                              </div>
                            </div>
                            <ArrowDownRight className="h-6 w-6 text-gray-400 group-open:rotate-180 transition-transform" />
                          </div>
                        </summary>

                        <div className="p-4 bg-gray-50 border-t-2">
                          {/* Resumen de efectivo */}
                          <div className="grid grid-cols-3 gap-4 mb-4">
                            <Card className="bg-white">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-xs text-gray-600">Efectivo Recibido</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-xl font-black text-gray-900">
                                  S/ {totalCashReceived.toFixed(2)}
                                </div>
                              </CardContent>
                            </Card>
                            <Card className="bg-white">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-xs text-gray-600">Vueltos Dados</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-xl font-black text-orange-600">
                                  S/ {totalChange.toFixed(2)}
                                </div>
                              </CardContent>
                            </Card>
                            <Card className="bg-green-50">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-xs text-green-700">Efectivo Neto en Caja</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-xl font-black text-green-600">
                                  S/ {totalCash.toFixed(2)}
                                </div>
                              </CardContent>
                            </Card>
                          </div>

                          {/* Lista de ventas */}
                          <div className="space-y-2">
                            <div className="font-semibold text-sm text-gray-700 mb-2">
                              Ventas en Efectivo ({cashSales.length})
                            </div>
                            {cashSales.map(sale => (
                              <div
                                key={sale.id}
                                className="flex items-center justify-between p-3 bg-white rounded-lg border hover:border-green-300 cursor-pointer"
                                onClick={() => setSelectedSaleDetails(sale)}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="text-xs text-gray-600 min-w-[130px]">
                                    {format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    {sale.transaction_id}
                                  </Badge>
                                  <div className="text-sm">
                                    {sale.student_name} • {sale.school_name}
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  {sale.cash_received && (
                                    <div className="text-right text-xs">
                                      <div className="text-gray-500">Recibido: S/ {sale.cash_received.toFixed(2)}</div>
                                      {sale.change_given && sale.change_given > 0 && (
                                        <div className="text-orange-600">Vuelto: S/ {sale.change_given.toFixed(2)}</div>
                                      )}
                                    </div>
                                  )}
                                  <div className="text-lg font-bold text-green-600 min-w-[100px] text-right">
                                    S/ {sale.total.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <UserCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay movimientos de caja en el período seleccionado</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUDITORÍA DE BOLETAS TAB - COMPACTO */}
        <TabsContent value="auditoria">
          <Card>
            <CardHeader className="pb-2 px-3 sm:px-4 py-2 sm:py-3">
              <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
                Auditoría de Boletas
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                {sales.length} venta(s). Clic para detalles.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:px-4 pb-2 sm:pb-4">
              <div className="space-y-1.5 sm:space-y-2">
                {sales.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm">No hay ventas</p>
                  </div>
                ) : (
                  sales.map(sale => (
                    <div
                      key={sale.id}
                      className="flex items-center justify-between p-2 sm:p-3 bg-white border rounded-lg hover:shadow-md hover:border-green-300 transition-all cursor-pointer"
                      onClick={() => setSelectedSaleDetails(sale)}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        <div className="text-center min-w-[60px] sm:min-w-[70px]">
                          <div className="text-[9px] sm:text-[10px] text-gray-500">Fecha</div>
                          <div className="font-bold text-[10px] sm:text-xs">
                            {format(new Date(sale.created_at), 'dd/MM/yy')}
                          </div>
                          <div className="text-[9px] sm:text-[10px] text-gray-600">
                            {format(new Date(sale.created_at), 'HH:mm')}
                          </div>
                        </div>

                        <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 mb-0.5">
                            <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1 py-0">
                              {sale.transaction_id}
                            </Badge>
                            <Badge className={`text-[8px] sm:text-[9px] px-1 py-0 ${
                              sale.payment_method === 'cash' ? 'bg-green-600' :
                              sale.payment_method === 'card' ? 'bg-blue-600' :
                              'bg-purple-600'
                            }`}>
                              {getPaymentMethodLabel(sale.payment_method).slice(0, 4)}
                            </Badge>
                          </div>
                          <div className="text-[10px] sm:text-xs text-gray-700 truncate">
                            <strong>{sale.student_name}</strong>
                          </div>
                          <div className="text-[8px] sm:text-[9px] text-gray-500 truncate">
                            {sale.cashier_name} • {sale.items.length} items
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs sm:text-lg font-black text-gray-900">
                            S/ {sale.total.toFixed(2)}
                          </div>
                        </div>

                        <Button variant="outline" size="sm" className="ml-1 sm:ml-2 h-6 w-6 sm:h-8 sm:w-8 p-0">
                          <Eye className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VENTAS POR DÍA TAB */}
        <TabsContent value="ventas-dia">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Ventas por Día - Resumen Diario
              </CardTitle>
              <CardDescription>
                {dailySales.length} día(s) con ventas. Haz clic para expandir detalles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dailySales.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No se encontraron ventas en el rango seleccionado</p>
                  </div>
                ) : (
                  dailySales.map((day) => (
                    <details key={day.date} className="group bg-white border-2 rounded-xl overflow-hidden hover:shadow-lg transition-all">
                      <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50">
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[120px]">
                            <div className="text-xs text-gray-500">Fecha</div>
                            <div className="font-black text-lg text-gray-900">
                              {format(new Date(day.date), 'dd/MM/yyyy', { locale: es })}
                            </div>
                            <div className="text-xs text-gray-600">
                              {format(new Date(day.date), 'EEEE', { locale: es })}
                            </div>
                          </div>

                          <div className="h-12 w-px bg-gray-200"></div>

                          <div>
                            <div className="text-xs text-gray-500">Ventas</div>
                            <div className="text-2xl font-black text-gray-900">
                              {day.sales}
                            </div>
                            <div className="text-xs text-gray-600">transacciones</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-gray-500">Total del Día</div>
                            <div className="text-3xl font-black text-green-600">
                              S/ {day.amount.toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-600">
                              Ticket promedio: S/ {(day.amount / day.sales).toFixed(2)}
                            </div>
                          </div>
                          <ArrowDownRight className="h-6 w-6 text-gray-400 group-open:rotate-180 transition-transform" />
                        </div>
                      </summary>

                      <div className="p-4 bg-gray-50 border-t-2 space-y-2">
                        {day.transactions.map(sale => (
                          <div
                            key={sale.id}
                            className="flex items-center justify-between p-3 bg-white rounded-lg border hover:border-green-300 cursor-pointer"
                            onClick={() => setSelectedSaleDetails(sale)}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="text-xs text-gray-600 min-w-[60px]">
                                {format(new Date(sale.created_at), 'HH:mm')}
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {sale.transaction_id}
                              </Badge>
                              <Badge className={
                                sale.payment_method === 'cash' ? 'bg-green-600' :
                                sale.payment_method === 'card' ? 'bg-blue-600' :
                                'bg-purple-600'
                              }>
                                {getPaymentMethodLabel(sale.payment_method)}
                              </Badge>
                              <div className="text-sm">
                                <strong>{sale.student_name}</strong> • {sale.cashier_name}
                              </div>
                            </div>
                            <div className="text-lg font-bold text-gray-900 min-w-[100px] text-right">
                              S/ {sale.total.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* MODAL DE DETALLES DE VENTA */}
      {selectedSaleDetails && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedSaleDetails(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-gradient-to-r from-green-600 to-emerald-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-black mb-2">Detalles de Venta</h2>
                  <div className="flex items-center gap-2 text-sm text-white/90">
                    <Badge variant="secondary" className="bg-white/20">
                      {selectedSaleDetails.transaction_id}
                    </Badge>
                    <span>•</span>
                    <span>{format(new Date(selectedSaleDetails.created_at), "dd/MM/yyyy HH:mm", { locale: es })}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={() => setSelectedSaleDetails(null)}
                >
                  ✕
                </Button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Info general */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Estudiante</div>
                  <div className="font-bold text-gray-900">{selectedSaleDetails.student_name}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Sede</div>
                  <div className="font-bold text-gray-900">{selectedSaleDetails.school_name}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Cajero</div>
                  <div className="font-bold text-gray-900">{selectedSaleDetails.cashier_name}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Medio de Pago</div>
                  <Badge className={
                    selectedSaleDetails.payment_method === 'cash' ? 'bg-green-600' :
                    selectedSaleDetails.payment_method === 'card' ? 'bg-blue-600' :
                    'bg-purple-600'
                  }>
                    {getPaymentMethodLabel(selectedSaleDetails.payment_method)}
                  </Badge>
                </div>
              </div>

              {/* Productos */}
              <div>
                <div className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Productos Vendidos
                </div>
                <div className="space-y-2">
                  {selectedSaleDetails.items.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{item.product_name}</div>
                        {item.barcode && (
                          <div className="text-xs text-gray-500">Código: {item.barcode}</div>
                        )}
                      </div>
                      <div className="text-right mr-4">
                        <div className="text-sm text-gray-600">
                          {item.quantity} × S/ {item.price.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-lg font-bold text-gray-900 min-w-[80px] text-right">
                        S/ {(item.quantity * item.price).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resumen de pago */}
              <div className="border-t-2 pt-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-lg">
                    <span className="font-semibold">Subtotal:</span>
                    <span>S/ {selectedSaleDetails.total.toFixed(2)}</span>
                  </div>
                  
                  {selectedSaleDetails.payment_method === 'cash' && selectedSaleDetails.cash_received && (
                    <>
                      <div className="flex items-center justify-between text-gray-600">
                        <span>Efectivo recibido:</span>
                        <span className="font-semibold">S/ {selectedSaleDetails.cash_received.toFixed(2)}</span>
                      </div>
                      {selectedSaleDetails.change_given && selectedSaleDetails.change_given > 0 && (
                        <div className="flex items-center justify-between text-orange-600">
                          <span>Vuelto:</span>
                          <span className="font-semibold">S/ {selectedSaleDetails.change_given.toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex items-center justify-between text-2xl font-black text-green-600 pt-2 border-t-2">
                    <span>TOTAL:</span>
                    <span>S/ {selectedSaleDetails.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Botones */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setSelectedSaleDetails(null)}
                >
                  Cerrar
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600"
                  onClick={() => {
                    toast({
                      title: '🖨️ Imprimiendo boleta',
                      description: 'Funcionalidad en desarrollo',
                    });
                  }}
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  Imprimir Boleta
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
