import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  UtensilsCrossed,
  LogOut,
  ArrowLeft,
  RefreshCw,
  ChefHat,
  Users,
  Clock,
  CheckCircle2,
  Package,
  BarChart3,
  Loader2,
  CalendarDays,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Interfaces ──
interface KitchenOrderGroup {
  category_name: string;
  menu_main_course: string;
  modifiers_summary: string;
  order_count: number;
  order_ids: string[];
}

interface OrderDetail {
  id: string;
  order_date: string;
  status: string;
  quantity: number;
  is_cancelled: boolean;
  student_name: string | null;
  teacher_name: string | null;
  manual_name: string | null;
  category_name: string;
  menu_name: string;
  selected_modifiers: any[];
  created_at: string;
}

interface ModifierStat {
  group_name: string;
  option_name: string;
  order_count: number;
  percentage: number;
}

// ── Helpers ──
const getPeruTodayStr = (): string => {
  const peruStr = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
  const now = new Date(peruStr);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const Comedor = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { role } = useRole();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getPeruTodayStr());
  const [activeTab, setActiveTab] = useState('kitchen');
  const [schoolId, setSchoolId] = useState<string | null>(null);

  // Vista Cocina data
  const [kitchenGroups, setKitchenGroups] = useState<KitchenOrderGroup[]>([]);
  const [orderDetails, setOrderDetails] = useState<OrderDetail[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  // Estadísticas
  const [modifierStats, setModifierStats] = useState<ModifierStat[]>([]);

  const handleLogout = async () => {
    await signOut();
  };

  // ── Cargar schoolId del perfil ──
  useEffect(() => {
    const loadSchoolId = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      if (data?.school_id) setSchoolId(data.school_id);
    };
    loadSchoolId();
  }, [user]);

  // ── Cargar resumen agrupado de cocina ──
  const loadKitchenSummary = useCallback(async () => {
    if (!schoolId) return;
    try {
      // Intentar usar la función RPC
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_kitchen_orders_summary', {
          p_school_id: schoolId,
          p_date: selectedDate,
        });

      if (!rpcError && rpcData) {
        setKitchenGroups(rpcData);
        const total = rpcData.reduce((sum: number, g: KitchenOrderGroup) => sum + g.order_count, 0);
        setTotalOrders(total);
      } else {
        // Fallback: consulta directa
        console.warn('RPC not available, using fallback query');
        await loadKitchenFallback();
      }
    } catch (err) {
      console.error('Error loading kitchen summary:', err);
      await loadKitchenFallback();
    }
  }, [schoolId, selectedDate]);

  // ── Fallback si la función RPC no existe aún ──
  const loadKitchenFallback = async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from('lunch_orders')
      .select(`
        id, order_date, status, quantity, is_cancelled, selected_modifiers,
        category_id, menu_id
      `)
      .eq('school_id', schoolId)
      .eq('order_date', selectedDate)
      .eq('is_cancelled', false)
      .neq('status', 'cancelled');

    if (error) {
      console.error('Fallback query error:', error);
      return;
    }

    // Agrupar manualmente
    const groupMap = new Map<string, KitchenOrderGroup>();
    for (const order of (data || [])) {
      const mods = order.selected_modifiers || [];
      const modSummary = mods.length > 0
        ? mods.map((m: any) => `${m.group_name}: ${m.selected_name}`).join(' | ')
        : 'Estándar (sin cambios)';
      const key = `${order.category_id}-${order.menu_id}-${modSummary}`;

      if (groupMap.has(key)) {
        const existing = groupMap.get(key)!;
        existing.order_count += order.quantity || 1;
        existing.order_ids.push(order.id);
      } else {
        groupMap.set(key, {
          category_name: order.category_id || 'Sin categoría',
          menu_main_course: '',
          modifiers_summary: modSummary,
          order_count: order.quantity || 1,
          order_ids: [order.id],
        });
      }
    }
    const groups = Array.from(groupMap.values());
    setKitchenGroups(groups);
    setTotalOrders(groups.reduce((s, g) => s + g.order_count, 0));
  };

  // ── Cargar detalle de pedidos ──
  const loadOrderDetails = useCallback(async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from('lunch_orders')
      .select(`
        id, order_date, status, quantity, is_cancelled, selected_modifiers, created_at,
        students(full_name),
        teacher_profiles(full_name),
        lunch_categories(name),
        lunch_menus(main_course)
      `)
      .eq('school_id', schoolId)
      .eq('order_date', selectedDate)
      .eq('is_cancelled', false)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading order details:', error);
      // Fallback sin joins
      const { data: fallbackData } = await supabase
        .from('lunch_orders')
        .select('id, order_date, status, quantity, is_cancelled, selected_modifiers, created_at, manual_name')
        .eq('school_id', schoolId)
        .eq('order_date', selectedDate)
        .eq('is_cancelled', false)
        .order('created_at', { ascending: true });

      const details: OrderDetail[] = (fallbackData || []).map((o: any) => ({
        id: o.id,
        order_date: o.order_date,
        status: o.status,
        quantity: o.quantity || 1,
        is_cancelled: o.is_cancelled,
        student_name: null,
        teacher_name: null,
        manual_name: o.manual_name || null,
        category_name: '',
        menu_name: '',
        selected_modifiers: o.selected_modifiers || [],
        created_at: o.created_at,
      }));

      setOrderDetails(details);
      setDeliveredCount(details.filter(o => o.status === 'delivered').length);
      setPendingCount(details.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length);
      return;
    }

    const details: OrderDetail[] = (data || []).map((o: any) => ({
      id: o.id,
      order_date: o.order_date,
      status: o.status,
      quantity: o.quantity || 1,
      is_cancelled: o.is_cancelled,
      student_name: o.students?.full_name || null,
      teacher_name: o.teacher_profiles?.full_name || null,
      manual_name: null,
      category_name: o.lunch_categories?.name || '',
      menu_name: o.lunch_menus?.main_course || '',
      selected_modifiers: o.selected_modifiers || [],
      created_at: o.created_at,
    }));

    setOrderDetails(details);
    setDeliveredCount(details.filter(o => o.status === 'delivered').length);
    setPendingCount(details.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length);
  }, [schoolId, selectedDate]);

  // ── Cargar estadísticas de modificadores ──
  const loadModifierStats = useCallback(async () => {
    if (!schoolId) return;
    try {
      const { data, error } = await supabase
        .rpc('get_modifier_stats', {
          p_school_id: schoolId,
          p_date_from: '2026-01-01',
          p_date_to: selectedDate,
        });

      if (!error && data) {
        setModifierStats(data);
      }
    } catch (err) {
      console.error('Error loading modifier stats:', err);
    }
  }, [schoolId, selectedDate]);

  // ── Marcar pedido como entregado ──
  const markAsDelivered = async (orderId: string) => {
    const { error } = await supabase
      .from('lunch_orders')
      .update({
        status: 'delivered',
        delivered_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (!error) {
      await refresh();
    }
  };

  // ── Refresh data ──
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadKitchenSummary(), loadOrderDetails(), loadModifierStats()]);
    setRefreshing(false);
  };

  // ── Load data on mount ──
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadKitchenSummary(), loadOrderDetails(), loadModifierStats()]);
      setLoading(false);
    };
    load();
  }, [loadKitchenSummary, loadOrderDetails, loadModifierStats]);

  // ── Auto-refresh cada 30 segundos ──
  useEffect(() => {
    const interval = setInterval(() => {
      loadKitchenSummary();
      loadOrderDetails();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadKitchenSummary, loadOrderDetails]);

  const formattedDate = (() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return format(new Date(y, m - 1, d), "EEEE d 'de' MMMM, yyyy", { locale: es });
  })();

  // ── Agrupar stats por grupo ──
  const statsGrouped = modifierStats.reduce((acc, stat) => {
    if (!acc[stat.group_name]) acc[stat.group_name] = [];
    acc[stat.group_name].push(stat);
    return acc;
  }, {} as Record<string, ModifierStat[]>);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-orange-50 to-background">
      {/* Header */}
      <header className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Volver
            </Button>
            <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center">
              <ChefHat className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Vista Cocina</h1>
              <p className="text-xs text-muted-foreground capitalize">{formattedDate}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm border rounded px-2 py-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            {/* Resumen rápido */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 text-center">
                  <Package className="h-6 w-6 mx-auto text-blue-600 mb-1" />
                  <p className="text-2xl font-bold text-blue-900">{totalOrders}</p>
                  <p className="text-xs text-blue-700">Total Pedidos</p>
                </CardContent>
              </Card>
              <Card className="bg-yellow-50 border-yellow-200">
                <CardContent className="p-3 text-center">
                  <Clock className="h-6 w-6 mx-auto text-yellow-600 mb-1" />
                  <p className="text-2xl font-bold text-yellow-900">{pendingCount}</p>
                  <p className="text-xs text-yellow-700">Pendientes</p>
                </CardContent>
              </Card>
              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-3 text-center">
                  <CheckCircle2 className="h-6 w-6 mx-auto text-green-600 mb-1" />
                  <p className="text-2xl font-bold text-green-900">{deliveredCount}</p>
                  <p className="text-xs text-green-700">Entregados</p>
                </CardContent>
              </Card>
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="p-3 text-center">
                  <UtensilsCrossed className="h-6 w-6 mx-auto text-purple-600 mb-1" />
                  <p className="text-2xl font-bold text-purple-900">{kitchenGroups.length}</p>
                  <p className="text-xs text-purple-700">Variaciones</p>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full mb-4">
                <TabsTrigger value="kitchen" className="flex-1 gap-1">
                  <ChefHat className="h-4 w-4" /> Vista Cocina
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex-1 gap-1">
                  <CalendarDays className="h-4 w-4" /> Detalle Pedidos
                </TabsTrigger>
                <TabsTrigger value="stats" className="flex-1 gap-1">
                  <BarChart3 className="h-4 w-4" /> Preferencias
                </TabsTrigger>
              </TabsList>

              {/* ── TAB: Vista Cocina (agrupado) ── */}
              <TabsContent value="kitchen">
                {kitchenGroups.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-gray-500">
                      <ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="text-lg font-medium">No hay pedidos para este día</p>
                      <p className="text-sm">Los pedidos aparecerán aquí agrupados por variación</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {kitchenGroups.map((group, idx) => (
                      <Card key={idx} className="border-2 hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">
                                  {group.category_name}
                                </Badge>
                              </div>
                              <p className="font-bold text-lg text-gray-900">
                                {group.menu_main_course || 'Menú'}
                              </p>
                              <p className={`text-sm mt-1 ${
                                group.modifiers_summary === 'Estándar (sin cambios)'
                                  ? 'text-gray-400 italic'
                                  : 'text-purple-700 font-medium'
                              }`}>
                                {group.modifiers_summary === 'Estándar (sin cambios)' ? (
                                  '📋 Estándar (sin cambios)'
                                ) : (
                                  <>✨ {group.modifiers_summary}</>
                                )}
                              </p>
                            </div>
                            <div className="text-right ml-4">
                              <div className="bg-orange-100 rounded-xl px-4 py-2">
                                <p className="text-3xl font-bold text-orange-700">{group.order_count}</p>
                                <p className="text-xs text-orange-600">unidades</p>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── TAB: Detalle de Pedidos ── */}
              <TabsContent value="orders">
                {orderDetails.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-gray-500">
                      <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>No hay pedidos para este día</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {orderDetails.map((order) => (
                      <Card key={order.id} className={`border ${
                        order.status === 'delivered' ? 'bg-green-50 border-green-200' : 'border-gray-200'
                      }`}>
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-sm">
                                {order.student_name || order.teacher_name || order.manual_name || 'Sin nombre'}
                              </p>
                              <Badge variant={
                                order.status === 'delivered' ? 'default' :
                                order.status === 'confirmed' ? 'secondary' : 'outline'
                              } className="text-xs">
                                {order.status === 'delivered' ? '✅ Entregado' :
                                 order.status === 'confirmed' ? '✔ Confirmado' :
                                 order.status === 'pending' ? '⏳ Pendiente' : order.status}
                              </Badge>
                              {order.quantity > 1 && (
                                <Badge variant="outline" className="text-xs">
                                  x{order.quantity}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-600">
                              {order.category_name} — {order.menu_name}
                            </p>
                            {order.selected_modifiers && order.selected_modifiers.length > 0 && (
                              <p className="text-xs text-purple-600 mt-1">
                                ✨ {order.selected_modifiers.map((m: any) => `${m.group_name}: ${m.selected_name}`).join(' | ')}
                              </p>
                            )}
                          </div>
                          {order.status !== 'delivered' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => markAsDelivered(order.id)}
                              className="text-green-700 border-green-300 hover:bg-green-50 ml-2"
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Entregar
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── TAB: Estadísticas de Preferencias ── */}
              <TabsContent value="stats">
                {Object.keys(statsGrouped).length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-gray-500">
                      <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="text-lg font-medium">Sin estadísticas aún</p>
                      <p className="text-sm">Las estadísticas aparecerán cuando los padres personalicen sus pedidos</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-purple-600" />
                          Preferencias de Personalización
                        </CardTitle>
                        <CardDescription>
                          Basado en todos los pedidos con personalización
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {Object.entries(statsGrouped).map(([groupName, stats]) => (
                          <div key={groupName} className="space-y-2">
                            <p className="font-semibold text-sm text-gray-800">{groupName}</p>
                            {stats.map((stat, idx) => (
                              <div key={idx} className="flex items-center gap-3">
                                <span className="text-sm w-28 text-gray-600 truncate">{stat.option_name}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-purple-400 to-purple-600 h-full rounded-full transition-all"
                                    style={{ width: `${Math.min(stat.percentage, 100)}%` }}
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
                                    {stat.percentage}% ({stat.order_count})
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
};

export default Comedor;
