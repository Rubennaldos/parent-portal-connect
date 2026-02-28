import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  ChefHat,
  Users,
  Clock,
  CheckCircle2,
  Package,
  BarChart3,
  Loader2,
  RefreshCw,
  ArrowLeft,
  LogOut,
  UtensilsCrossed,
  GraduationCap,
  Printer,
  ClipboardList,
  Search,
  Salad,
  Flame,
  Coffee,
  IceCream2,
  AlertTriangle,
  TrendingUp,
  Hash,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ══════════════════════════════════════
// INTERFACES
// ══════════════════════════════════════
interface RawOrder {
  id: string;
  order_date: string;
  status: string;
  quantity: number;
  is_cancelled: boolean;
  student_id: string | null;
  teacher_id: string | null;
  manual_name: string | null;
  category_id: string | null;
  menu_id: string | null;
  selected_modifiers: any[];
  configurable_selections: any[];
  selected_garnishes: string[];
  created_at: string;
  base_price: number | null;
  final_price: number | null;
  notes?: string | null;
  // Joined
  student_name: string | null;
  teacher_name: string | null;
  category_name: string;
  category_target_type: string;
  category_color: string;
  category_icon: string;
  menu_main_course: string;
  menu_starter: string | null;
  menu_beverage: string | null;
  menu_dessert: string | null;
  menu_notes: string | null;
}

interface CategorySummary {
  category_id: string;
  category_name: string;
  category_color: string;
  category_target_type: string;
  menu_main_course: string;
  menu_starter: string | null;
  menu_beverage: string | null;
  menu_dessert: string | null;
  menu_notes: string | null;
  total_count: number;
  student_count: number;
  teacher_count: number;
  manual_count: number;
  delivered_count: number;
  pending_count: number;
  variations: VariationGroup[];
  garnish_summary: GarnishCount[];
  orders: RawOrder[];
}

interface VariationGroup {
  label: string;
  count: number;
}

interface GarnishCount {
  name: string;
  count: number;
}

interface ModifierStat {
  group_name: string;
  option_name: string;
  order_count: number;
  percentage: number;
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
const getPeruTodayStr = (): string => {
  const peruStr = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
  const now = new Date(peruStr);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getGreeting = (): string => {
  const peruStr = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
  const hour = new Date(peruStr).getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
};

const getTargetLabel = (type: string): string => {
  switch (type) {
    case 'students': return 'Alumnos';
    case 'teachers': return 'Profesores';
    case 'both': return 'Todos';
    default: return type;
  }
};

const getTargetBadgeColor = (type: string): string => {
  switch (type) {
    case 'students': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'teachers': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'both': return 'bg-purple-100 text-purple-800 border-purple-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

// ══════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════
const Comedor = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { role } = useRole();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getPeruTodayStr());
  const [activeTab, setActiveTab] = useState('preparation');
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // Raw orders
  const [rawOrders, setRawOrders] = useState<RawOrder[]>([]);
  // Modifier stats
  const [modifierStats, setModifierStats] = useState<ModifierStat[]>([]);

  const handleLogout = async () => {
    await signOut();
  };

  // ── Load school info ──
  useEffect(() => {
    const loadSchool = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('school_id, schools(name)')
        .eq('id', user.id)
        .single();
      if (data?.school_id) {
        setSchoolId(data.school_id);
        setSchoolName((data as any).schools?.name || '');
      }
    };
    loadSchool();
  }, [user]);

  // ══════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════
  const loadOrders = useCallback(async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from('lunch_orders')
      .select(`
        id, order_date, status, quantity, is_cancelled,
        student_id, teacher_id, manual_name,
        category_id, menu_id,
        selected_modifiers, configurable_selections, selected_garnishes,
        created_at, base_price, final_price, notes,
        students(full_name),
        teacher_profiles(full_name),
        lunch_categories(name, target_type, color, icon),
        lunch_menus(main_course, starter, beverage, dessert, notes)
      `)
      .eq('school_id', schoolId)
      .eq('order_date', selectedDate)
      .eq('is_cancelled', false)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading orders:', error);
      setRawOrders([]);
      return;
    }

    const orders: RawOrder[] = (data || []).map((o: any) => ({
      id: o.id,
      order_date: o.order_date,
      status: o.status,
      quantity: o.quantity || 1,
      is_cancelled: o.is_cancelled,
      student_id: o.student_id,
      teacher_id: o.teacher_id,
      manual_name: o.manual_name,
      category_id: o.category_id,
      menu_id: o.menu_id,
      selected_modifiers: o.selected_modifiers || [],
      configurable_selections: o.configurable_selections || [],
      selected_garnishes: o.selected_garnishes || [],
      created_at: o.created_at,
      base_price: o.base_price,
      final_price: o.final_price,
      notes: o.notes || null,
      student_name: o.students?.full_name || null,
      teacher_name: o.teacher_profiles?.full_name || null,
      category_name: o.lunch_categories?.name || 'Sin categoría',
      category_target_type: o.lunch_categories?.target_type || 'both',
      category_color: o.lunch_categories?.color || '#6B7280',
      category_icon: o.lunch_categories?.icon || 'utensils',
      menu_main_course: o.lunch_menus?.main_course || '',
      menu_starter: o.lunch_menus?.starter || null,
      menu_beverage: o.lunch_menus?.beverage || null,
      menu_dessert: o.lunch_menus?.dessert || null,
      menu_notes: o.lunch_menus?.notes || null,
    }));

    setRawOrders(orders);
  }, [schoolId, selectedDate]);

  const loadModifierStats = useCallback(async () => {
    if (!schoolId) return;
    try {
      const { data, error } = await supabase.rpc('get_modifier_stats', {
        p_school_id: schoolId,
        p_date_from: '2026-01-01',
        p_date_to: selectedDate,
      });
      if (!error && data) setModifierStats(data);
    } catch {
      // Stats RPC not available
    }
  }, [schoolId, selectedDate]);

  // ── Refresh ──
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadOrders(), loadModifierStats()]);
    setRefreshing(false);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadOrders(), loadModifierStats()]);
      setLoading(false);
    };
    load();
  }, [loadOrders, loadModifierStats]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => { loadOrders(); }, 30000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // ══════════════════════════════════════
  // COMPUTED DATA
  // ══════════════════════════════════════
  const totalOrders = useMemo(() => rawOrders.reduce((s, o) => s + o.quantity, 0), [rawOrders]);
  const studentOrders = useMemo(() => rawOrders.filter(o => o.student_id).reduce((s, o) => s + o.quantity, 0), [rawOrders]);
  const teacherOrders = useMemo(() => rawOrders.filter(o => o.teacher_id).reduce((s, o) => s + o.quantity, 0), [rawOrders]);
  const manualOrders = useMemo(() => rawOrders.filter(o => o.manual_name && !o.student_id && !o.teacher_id).reduce((s, o) => s + o.quantity, 0), [rawOrders]);
  const deliveredCount = useMemo(() => rawOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.quantity, 0), [rawOrders]);
  const pendingCount = useMemo(() => totalOrders - deliveredCount, [totalOrders, deliveredCount]);
  const progressPercent = useMemo(() => totalOrders > 0 ? Math.round((deliveredCount / totalOrders) * 100) : 0, [deliveredCount, totalOrders]);

  // Category summaries for preparation view
  const categorySummaries = useMemo((): CategorySummary[] => {
    const map = new Map<string, CategorySummary>();

    for (const order of rawOrders) {
      const key = order.category_id || 'sin-categoria';
      if (!map.has(key)) {
        map.set(key, {
          category_id: key,
          category_name: order.category_name,
          category_color: order.category_color,
          category_target_type: order.category_target_type,
          menu_main_course: order.menu_main_course,
          menu_starter: order.menu_starter,
          menu_beverage: order.menu_beverage,
          menu_dessert: order.menu_dessert,
          menu_notes: order.menu_notes,
          total_count: 0,
          student_count: 0,
          teacher_count: 0,
          manual_count: 0,
          delivered_count: 0,
          pending_count: 0,
          variations: [],
          garnish_summary: [],
          orders: [],
        });
      }

      const summary = map.get(key)!;
      const qty = order.quantity;
      summary.total_count += qty;
      if (order.student_id) summary.student_count += qty;
      else if (order.teacher_id) summary.teacher_count += qty;
      else summary.manual_count += qty;
      if (order.status === 'delivered') summary.delivered_count += qty;
      else summary.pending_count += qty;
      summary.orders.push(order);
    }

    // Now compute variations and garnish summaries for each category
    for (const [, summary] of map) {
      // Variation groups (configurable_selections + selected_modifiers)
      const varMap = new Map<string, number>();
      const garnMap = new Map<string, number>();

      for (const order of summary.orders) {
        const qty = order.quantity;

        // Configurable selections
        if (order.configurable_selections?.length > 0) {
          for (const sel of order.configurable_selections) {
            const label = `${sel.group_name}: ${sel.selected}`;
            varMap.set(label, (varMap.get(label) || 0) + qty);
          }
        }

        // Modifiers
        if (order.selected_modifiers?.length > 0) {
          for (const mod of order.selected_modifiers) {
            const label = `${mod.group_name}: ${mod.selected_name}`;
            varMap.set(label, (varMap.get(label) || 0) + qty);
          }
        }

        // Garnishes
        if (order.selected_garnishes?.length > 0) {
          for (const g of order.selected_garnishes) {
            garnMap.set(g, (garnMap.get(g) || 0) + qty);
          }
        }
      }

      summary.variations = Array.from(varMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      summary.garnish_summary = Array.from(garnMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    }

    return Array.from(map.values()).sort((a, b) => b.total_count - a.total_count);
  }, [rawOrders]);

  // Global garnish/variation aggregation
  const globalGarnishes = useMemo((): GarnishCount[] => {
    const garnMap = new Map<string, number>();
    for (const order of rawOrders) {
      const qty = order.quantity;
      if (order.selected_garnishes?.length > 0) {
        for (const g of order.selected_garnishes) {
          garnMap.set(g, (garnMap.get(g) || 0) + qty);
        }
      }
    }
    return Array.from(garnMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [rawOrders]);

  const globalVariations = useMemo((): VariationGroup[] => {
    const varMap = new Map<string, number>();
    for (const order of rawOrders) {
      const qty = order.quantity;
      if (order.configurable_selections?.length > 0) {
        for (const sel of order.configurable_selections) {
          const label = `${sel.group_name}: ${sel.selected}`;
          varMap.set(label, (varMap.get(label) || 0) + qty);
        }
      }
      if (order.selected_modifiers?.length > 0) {
        for (const mod of order.selected_modifiers) {
          const label = `${mod.group_name}: ${mod.selected_name}`;
          varMap.set(label, (varMap.get(label) || 0) + qty);
        }
      }
    }
    return Array.from(varMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [rawOrders]);

  // Filtered orders for search
  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return rawOrders;
    const term = searchTerm.toLowerCase();
    return rawOrders.filter(o =>
      (o.student_name?.toLowerCase().includes(term)) ||
      (o.teacher_name?.toLowerCase().includes(term)) ||
      (o.manual_name?.toLowerCase().includes(term)) ||
      (o.category_name?.toLowerCase().includes(term)) ||
      (o.menu_main_course?.toLowerCase().includes(term))
    );
  }, [rawOrders, searchTerm]);

  // Stats grouped
  const statsGrouped = useMemo(() => {
    return modifierStats.reduce((acc, stat) => {
      if (!acc[stat.group_name]) acc[stat.group_name] = [];
      acc[stat.group_name].push(stat);
      return acc;
    }, {} as Record<string, ModifierStat[]>);
  }, [modifierStats]);

  // ── Mark as delivered ──
  const markAsDelivered = async (orderId: string) => {
    const { error } = await supabase
      .from('lunch_orders')
      .update({
        status: 'delivered',
        delivered_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    if (!error) await refresh();
  };

  // ── Mark all in category as delivered ──
  const markCategoryDelivered = async (orderIds: string[]) => {
    const pendingIds = rawOrders
      .filter(o => orderIds.includes(o.id) && o.status !== 'delivered')
      .map(o => o.id);
    if (pendingIds.length === 0) return;
    const { error } = await supabase
      .from('lunch_orders')
      .update({
        status: 'delivered',
        delivered_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .in('id', pendingIds);
    if (!error) await refresh();
  };

  // ── Print preparation report ──
  const handlePrint = () => {
    window.print();
  };

  // ── Formatted date ──
  const formattedDate = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return format(new Date(y, m - 1, d), "EEEE d 'de' MMMM, yyyy", { locale: es });
  }, [selectedDate]);

  const isToday = selectedDate === getPeruTodayStr();

  // ══════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-background to-amber-50 print:bg-white">
      {/* ── Header ── */}
      <header className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10 print:hidden">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Volver
            </Button>
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
              <ChefHat className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Reporte de Cocina</h1>
              <p className="text-xs text-muted-foreground">{schoolName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white shadow-sm"
            />
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} title="Imprimir reporte">
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
            <p className="text-sm text-muted-foreground">Cargando reporte de cocina...</p>
          </div>
        ) : (
          <>
            {/* ── Greeting Banner ── */}
            {isToday && (
              <div className="mb-4 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 rounded-2xl p-4 text-white shadow-lg print:hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <ChefHat className="h-6 w-6" />
                      {getGreeting()}, Chef!
                    </h2>
                    <p className="text-orange-100 mt-1 capitalize">{formattedDate}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-4xl font-black">{totalOrders}</p>
                    <p className="text-orange-100 text-sm">platos hoy</p>
                  </div>
                </div>
                {totalOrders > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-orange-100 mb-1">
                      <span>Progreso de entrega</span>
                      <span>{deliveredCount}/{totalOrders} ({progressPercent}%)</span>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-2.5">
                      <div
                        className="bg-white rounded-full h-2.5 transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Print Header (only visible when printing) ── */}
            <div className="hidden print:block mb-6">
              <h1 className="text-2xl font-bold text-center">Reporte de Cocina - {schoolName}</h1>
              <p className="text-center text-gray-600 capitalize">{formattedDate}</p>
              <p className="text-center text-sm text-gray-500 mt-1">
                Total: {totalOrders} platos | Alumnos: {studentOrders} | Profesores: {teacherOrders}
                {manualOrders > 0 && ` | Externos: ${manualOrders}`}
              </p>
              <hr className="mt-3" />
            </div>

            {/* ── Summary Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 print:grid-cols-5">
              <Card className="bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200 shadow-sm">
                <CardContent className="p-3 text-center">
                  <Package className="h-5 w-5 mx-auto text-slate-600 mb-1" />
                  <p className="text-2xl font-black text-slate-900">{totalOrders}</p>
                  <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider">Total Platos</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 shadow-sm">
                <CardContent className="p-3 text-center">
                  <GraduationCap className="h-5 w-5 mx-auto text-blue-600 mb-1" />
                  <p className="text-2xl font-black text-blue-900">{studentOrders}</p>
                  <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wider">Alumnos</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200 shadow-sm">
                <CardContent className="p-3 text-center">
                  <Users className="h-5 w-5 mx-auto text-amber-600 mb-1" />
                  <p className="text-2xl font-black text-amber-900">{teacherOrders}</p>
                  <p className="text-[10px] font-medium text-amber-600 uppercase tracking-wider">Profesores</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 shadow-sm">
                <CardContent className="p-3 text-center">
                  <Clock className="h-5 w-5 mx-auto text-yellow-600 mb-1" />
                  <p className="text-2xl font-black text-yellow-900">{pendingCount}</p>
                  <p className="text-[10px] font-medium text-yellow-600 uppercase tracking-wider">Pendientes</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200 shadow-sm">
                <CardContent className="p-3 text-center">
                  <CheckCircle2 className="h-5 w-5 mx-auto text-green-600 mb-1" />
                  <p className="text-2xl font-black text-green-900">{deliveredCount}</p>
                  <p className="text-[10px] font-medium text-green-600 uppercase tracking-wider">Entregados</p>
                </CardContent>
              </Card>
            </div>

            {/* ── Main Tabs ── */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full mb-4 print:hidden">
                <TabsTrigger value="preparation" className="flex-1 gap-1.5">
                  <ClipboardList className="h-4 w-4" /> Preparación
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex-1 gap-1.5">
                  <UtensilsCrossed className="h-4 w-4" /> Pedidos
                </TabsTrigger>
                <TabsTrigger value="stats" className="flex-1 gap-1.5">
                  <BarChart3 className="h-4 w-4" /> Preferencias
                </TabsTrigger>
              </TabsList>

              {/* ══════════════════════════════════════ */}
              {/* TAB 1: REPORTE DE PREPARACIÓN         */}
              {/* ══════════════════════════════════════ */}
              <TabsContent value="preparation" className="print:block">
                {categorySummaries.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-16 text-center text-gray-400">
                      <ChefHat className="h-16 w-16 mx-auto mb-4 opacity-20" />
                      <p className="text-xl font-semibold text-gray-500">No hay pedidos para este día</p>
                      <p className="text-sm mt-1">Los pedidos aparecerán aquí cuando los padres o profesores realicen sus pedidos</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* Category Preparation Cards */}
                    {categorySummaries.map((cat) => (
                      <Card
                        key={cat.category_id}
                        className="border-2 shadow-md hover:shadow-lg transition-shadow print:shadow-none print:break-inside-avoid"
                        style={{ borderLeftColor: cat.category_color, borderLeftWidth: '4px' }}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <CardTitle className="text-lg">{cat.category_name}</CardTitle>
                                <Badge className={`text-[10px] border ${getTargetBadgeColor(cat.category_target_type)}`}>
                                  {getTargetLabel(cat.category_target_type)}
                                </Badge>
                                {cat.pending_count === 0 && cat.total_count > 0 && (
                                  <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">
                                    ✅ Todo entregado
                                  </Badge>
                                )}
                              </div>
                              {cat.menu_main_course && (
                                <CardDescription className="mt-1 flex items-center gap-1.5">
                                  <Flame className="h-3.5 w-3.5 text-orange-500" />
                                  <span className="font-medium text-gray-700">{cat.menu_main_course}</span>
                                </CardDescription>
                              )}
                            </div>
                            <div className="text-right ml-4 flex-shrink-0">
                              <div
                                className="rounded-xl px-5 py-2 shadow-inner"
                                style={{ backgroundColor: `${cat.category_color}15` }}
                              >
                                <p className="text-3xl font-black" style={{ color: cat.category_color }}>
                                  {cat.total_count}
                                </p>
                                <p className="text-[10px] font-medium" style={{ color: cat.category_color }}>
                                  platos
                                </p>
                              </div>
                            </div>
                          </div>
                        </CardHeader>

                        <CardContent className="pt-0 space-y-3">
                          {/* Menu Details */}
                          {(cat.menu_starter || cat.menu_beverage || cat.menu_dessert) && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 bg-gray-50 rounded-lg text-sm">
                              {cat.menu_starter && (
                                <div className="flex items-center gap-1.5">
                                  <Salad className="h-3.5 w-3.5 text-green-500" />
                                  <span className="text-gray-500 text-xs">Entrada:</span>
                                  <span className="font-medium text-gray-700 text-xs">{cat.menu_starter}</span>
                                </div>
                              )}
                              {cat.menu_beverage && (
                                <div className="flex items-center gap-1.5">
                                  <Coffee className="h-3.5 w-3.5 text-brown-500" />
                                  <span className="text-gray-500 text-xs">Bebida:</span>
                                  <span className="font-medium text-gray-700 text-xs">{cat.menu_beverage}</span>
                                </div>
                              )}
                              {cat.menu_dessert && (
                                <div className="flex items-center gap-1.5">
                                  <IceCream2 className="h-3.5 w-3.5 text-pink-500" />
                                  <span className="text-gray-500 text-xs">Postre:</span>
                                  <span className="font-medium text-gray-700 text-xs">{cat.menu_dessert}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Student/Teacher/Manual Breakdown */}
                          <div className="flex flex-wrap gap-3 text-sm">
                            {cat.student_count > 0 && (
                              <div className="flex items-center gap-1.5 bg-blue-50 px-3 py-1.5 rounded-full">
                                <GraduationCap className="h-3.5 w-3.5 text-blue-600" />
                                <span className="font-bold text-blue-900">{cat.student_count}</span>
                                <span className="text-blue-600 text-xs">alumnos</span>
                              </div>
                            )}
                            {cat.teacher_count > 0 && (
                              <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-full">
                                <Users className="h-3.5 w-3.5 text-amber-600" />
                                <span className="font-bold text-amber-900">{cat.teacher_count}</span>
                                <span className="text-amber-600 text-xs">profesores</span>
                              </div>
                            )}
                            {cat.manual_count > 0 && (
                              <div className="flex items-center gap-1.5 bg-gray-100 px-3 py-1.5 rounded-full">
                                <Hash className="h-3.5 w-3.5 text-gray-600" />
                                <span className="font-bold text-gray-900">{cat.manual_count}</span>
                                <span className="text-gray-600 text-xs">externos</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 bg-green-50 px-3 py-1.5 rounded-full">
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                              <span className="font-bold text-green-900">{cat.delivered_count}</span>
                              <span className="text-green-600 text-xs">entregados</span>
                            </div>
                            {cat.pending_count > 0 && (
                              <div className="flex items-center gap-1.5 bg-yellow-50 px-3 py-1.5 rounded-full">
                                <Clock className="h-3.5 w-3.5 text-yellow-600" />
                                <span className="font-bold text-yellow-900">{cat.pending_count}</span>
                                <span className="text-yellow-600 text-xs">pendientes</span>
                              </div>
                            )}
                          </div>

                          {/* Variations / Configurable Selections */}
                          {cat.variations.length > 0 && (
                            <div className="border rounded-lg p-3 bg-purple-50/50">
                              <p className="text-xs font-semibold text-purple-800 mb-2 flex items-center gap-1.5">
                                <UtensilsCrossed className="h-3.5 w-3.5" />
                                VARIACIONES Y PERSONALIZACIONES
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {cat.variations.map((v, i) => (
                                  <div key={i} className="flex items-center justify-between bg-white rounded px-2.5 py-1.5 text-sm border border-purple-100">
                                    <span className="text-gray-700 truncate flex-1">{v.label}</span>
                                    <Badge variant="secondary" className="ml-2 bg-purple-100 text-purple-800 font-bold">
                                      {v.count}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Garnish Summary */}
                          {cat.garnish_summary.length > 0 && (
                            <div className="border rounded-lg p-3 bg-green-50/50">
                              <p className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1.5">
                                <Salad className="h-3.5 w-3.5" />
                                GUARNICIONES
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {cat.garnish_summary.map((g, i) => (
                                  <div key={i} className="flex items-center gap-1.5 bg-white rounded-full px-3 py-1 text-sm border border-green-200">
                                    <span className="text-gray-700">{g.name}</span>
                                    <span className="font-bold text-green-700">{g.count}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Menu notes */}
                          {cat.menu_notes && (
                            <div className="flex items-start gap-2 p-2 bg-yellow-50 rounded-lg border border-yellow-200 text-sm">
                              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="font-semibold text-yellow-800 text-xs">NOTA DEL MENÚ</p>
                                <p className="text-yellow-700">{cat.menu_notes}</p>
                              </div>
                            </div>
                          )}

                          {/* Mark all as delivered button */}
                          {cat.pending_count > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full text-green-700 border-green-300 hover:bg-green-50 print:hidden"
                              onClick={() => markCategoryDelivered(cat.orders.map(o => o.id))}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1.5" />
                              Marcar todos como entregados ({cat.pending_count})
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}

                    {/* ── Global Garnish & Variation Summary ── */}
                    {(globalGarnishes.length > 0 || globalVariations.length > 0) && (
                      <Card className="border-2 border-dashed border-orange-300 bg-orange-50/30 print:break-inside-avoid">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-orange-600" />
                            Resumen General de Preparación
                          </CardTitle>
                          <CardDescription>
                            Totales globales de todas las categorías
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {globalVariations.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-purple-800 mb-2">
                                🎨 TODAS LAS VARIACIONES
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                                {globalVariations.map((v, i) => (
                                  <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 text-sm border">
                                    <span className="text-gray-700 truncate flex-1">{v.label}</span>
                                    <span className="font-bold text-purple-700 ml-2">{v.count}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {globalGarnishes.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-green-800 mb-2">
                                🥗 TODAS LAS GUARNICIONES
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {globalGarnishes.map((g, i) => (
                                  <div key={i} className="flex items-center gap-2 bg-white rounded-full px-4 py-1.5 border text-sm shadow-sm">
                                    <span className="text-gray-700">{g.name}</span>
                                    <span className="font-black text-green-700 text-lg">{g.count}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ══════════════════════════════════════ */}
              {/* TAB 2: DETALLE DE PEDIDOS             */}
              {/* ══════════════════════════════════════ */}
              <TabsContent value="orders">
                {/* Search bar */}
                <div className="mb-3 relative print:hidden">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Buscar por nombre, categoría, plato..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {filteredOrders.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center text-gray-400">
                      <Package className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p className="text-lg font-medium text-gray-500">
                        {searchTerm ? 'No se encontraron pedidos' : 'No hay pedidos para este día'}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-2">
                      {filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''} encontrado{filteredOrders.length !== 1 ? 's' : ''}
                    </p>
                    {filteredOrders.map((order) => {
                      const personName = order.student_name || order.teacher_name || order.manual_name || 'Sin nombre';
                      const isStudent = !!order.student_id;
                      const isTeacher = !!order.teacher_id;
                      return (
                        <Card
                          key={order.id}
                          className={`border transition-all ${
                            order.status === 'delivered'
                              ? 'bg-green-50/50 border-green-200'
                              : 'border-gray-200 hover:shadow-sm'
                          }`}
                        >
                          <CardContent className="p-3 flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  {isStudent && <GraduationCap className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                                  {isTeacher && <Users className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
                                  {!isStudent && !isTeacher && <Hash className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                                  <p className="font-semibold text-sm truncate">{personName}</p>
                                </div>
                                <Badge
                                  variant={order.status === 'delivered' ? 'default' : order.status === 'confirmed' ? 'secondary' : 'outline'}
                                  className="text-[10px]"
                                >
                                  {order.status === 'delivered' ? '✅ Entregado' :
                                   order.status === 'confirmed' ? '✔ Confirmado' :
                                   order.status === 'pending' ? '⏳ Pendiente' : order.status}
                                </Badge>
                                {order.quantity > 1 && (
                                  <Badge variant="outline" className="text-[10px]">x{order.quantity}</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-600">
                                <span className="font-medium">{order.category_name}</span>
                                {order.menu_main_course && <span> — {order.menu_main_course}</span>}
                              </p>
                              {order.configurable_selections?.length > 0 && (
                                <p className="text-[11px] text-amber-700 mt-0.5">
                                  🍽️ {order.configurable_selections.map((s: any) => `${s.group_name}: ${s.selected}`).join(' | ')}
                                </p>
                              )}
                              {order.selected_modifiers?.length > 0 && (
                                <p className="text-[11px] text-purple-600 mt-0.5">
                                  ✨ {order.selected_modifiers.map((m: any) => `${m.group_name}: ${m.selected_name}`).join(' | ')}
                                </p>
                              )}
                              {order.selected_garnishes?.length > 0 && (
                                <p className="text-[11px] text-green-600 mt-0.5">
                                  🥗 {order.selected_garnishes.join(', ')}
                                </p>
                              )}
                            </div>
                            {order.status !== 'delivered' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markAsDelivered(order.id)}
                                className="text-green-700 border-green-300 hover:bg-green-50 flex-shrink-0 print:hidden"
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Entregar
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* ══════════════════════════════════════ */}
              {/* TAB 3: ESTADÍSTICAS DE PREFERENCIAS   */}
              {/* ══════════════════════════════════════ */}
              <TabsContent value="stats">
                {Object.keys(statsGrouped).length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-16 text-center text-gray-400">
                      <BarChart3 className="h-16 w-16 mx-auto mb-4 opacity-20" />
                      <p className="text-xl font-semibold text-gray-500">Sin estadísticas aún</p>
                      <p className="text-sm mt-1">
                        Las estadísticas aparecerán cuando los padres personalicen sus pedidos
                      </p>
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
                          Basado en todos los pedidos con personalización (histórico)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {Object.entries(statsGrouped).map(([groupName, stats]) => (
                          <div key={groupName} className="space-y-2">
                            <p className="font-semibold text-sm text-gray-800 flex items-center gap-1.5">
                              <UtensilsCrossed className="h-4 w-4 text-purple-500" />
                              {groupName}
                            </p>
                            {stats.map((stat, idx) => (
                              <div key={idx} className="flex items-center gap-3">
                                <span className="text-sm w-32 text-gray-600 truncate">{stat.option_name}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-7 relative overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-purple-400 to-purple-600 h-full rounded-full transition-all"
                                    style={{ width: `${Math.min(stat.percentage, 100)}%` }}
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">
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
