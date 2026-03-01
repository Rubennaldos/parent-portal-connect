import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  UtensilsCrossed,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Users,
  GraduationCap,
  SortAsc,
  LayoutGrid,
  X,
  Eye,
  ArrowLeft,
  RotateCcw,
  Filter,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ==========================================
// INTERFACES
// ==========================================

interface LunchDeliveryDashboardProps {
  schoolId: string;
  userId: string;
  onClose: () => void;
}

interface DeliveryOrder {
  id: string;
  order_date: string;
  status: string;
  is_cancelled: boolean;
  created_at: string;
  delivered_at: string | null;
  delivered_by: string | null;
  menu_id: string | null;
  category_id: string | null;
  quantity: number;
  base_price: number | null;
  final_price: number | null;
  is_no_order_delivery: boolean;
  // Student data (null if teacher)
  student_id: string | null;
  student_name: string | null;
  student_photo: string | null;
  student_grade: string | null;
  student_section: string | null;
  // Teacher data (null if student)
  teacher_id: string | null;
  teacher_name: string | null;
  // Menu data
  category_name: string | null;
  menu_starter: string | null;
  menu_main_course: string | null;
  menu_beverage: string | null;
  menu_dessert: string | null;
  menu_notes: string | null;
  // Ticket code
  ticket_code: string | null;
  // Addons
  addons: string[];
  // Observations from parent (configurable selections etc)
  observations: string | null;
}

type DeliveryMode = 'by_classroom' | 'by_grade' | 'alphabetical' | 'all';
type PersonType = 'students' | 'teachers';
type StatusFilter = 'all' | 'pending' | 'delivered';

// ==========================================
// COMPONENT
// ==========================================

export function LunchDeliveryDashboard({ schoolId, userId, onClose }: LunchDeliveryDashboardProps) {
  const { toast } = useToast();

  // Setup state
  const [setupDone, setSetupDone] = useState(false);
  const [mode, setMode] = useState<DeliveryMode | null>(null);
  const [personType, setPersonType] = useState<PersonType>('students');

  // Data
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Lists (for by_classroom and by_grade modes)
  const [availableLists, setAvailableLists] = useState<string[]>([]);
  const [currentListIndex, setCurrentListIndex] = useState(0);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Photo viewer
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  // Summary stats
  const [summary, setSummary] = useState({ totalStudents: 0, totalTeachers: 0, classrooms: 0, grades: 0 });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const todayStr = useMemo(() => {
    const now = new Date();
    const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    return format(peruTime, 'yyyy-MM-dd');
  }, []);

  // ==========================================
  // FETCH TODAY'S ORDERS
  // ==========================================

  const fetchTodayOrders = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all active orders for today
      const { data: ordersData, error } = await supabase
        .from('lunch_orders')
        .select(`
          id, order_date, status, is_cancelled, created_at,
          delivered_at, delivered_by, menu_id, category_id,
          quantity, base_price, final_price, is_no_order_delivery,
          student_id, teacher_id,
          student:students (
            full_name, photo_url, grade, section
          ),
          teacher:teacher_profiles (
            full_name
          ),
          lunch_menus (
            starter, main_course, beverage, dessert, notes, category_id
          ),
          lunch_order_addons (
            addon_name, quantity
          )
        `)
        .eq('order_date', todayStr)
        .eq('is_cancelled', false)
        .eq('school_id', schoolId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch categories in batch
      const categoryIds = [...new Set(
        (ordersData || [])
          .map(o => o.lunch_menus?.category_id || o.category_id)
          .filter(Boolean) as string[]
      )];

      let categoriesMap = new Map<string, string>();
      if (categoryIds.length > 0) {
        const { data: cats } = await supabase
          .from('lunch_categories')
          .select('id, name')
          .in('id', categoryIds);
        if (cats) cats.forEach(c => categoriesMap.set(c.id, c.name));
      }

      // Fetch ticket codes from transactions
      const orderIds = (ordersData || []).map(o => o.id);
      let ticketMap = new Map<string, string>();
      if (orderIds.length > 0) {
        const { data: txData } = await supabase
          .from('transactions')
          .select('metadata, ticket_code')
          .eq('type', 'purchase')
          .not('metadata', 'is', null);
        if (txData) {
          txData.forEach((tx: any) => {
            const loid = tx.metadata?.lunch_order_id;
            if (loid && orderIds.includes(loid) && tx.ticket_code) {
              ticketMap.set(loid, tx.ticket_code);
            }
          });
        }
      }

      // Map to DeliveryOrder
      const mapped: DeliveryOrder[] = (ordersData || []).map((o: any) => {
        const catId = o.lunch_menus?.category_id || o.category_id;
        return {
          id: o.id,
          order_date: o.order_date,
          status: o.status,
          is_cancelled: o.is_cancelled,
          created_at: o.created_at,
          delivered_at: o.delivered_at,
          delivered_by: o.delivered_by,
          menu_id: o.menu_id,
          category_id: o.category_id,
          quantity: o.quantity || 1,
          base_price: o.base_price,
          final_price: o.final_price,
          is_no_order_delivery: o.is_no_order_delivery || false,
          student_id: o.student_id,
          student_name: o.student?.full_name || null,
          student_photo: o.student?.photo_url || null,
          student_grade: o.student?.grade || null,
          student_section: o.student?.section || null,
          teacher_id: o.teacher_id,
          teacher_name: o.teacher?.full_name || null,
          category_name: catId ? categoriesMap.get(catId) || null : null,
          menu_starter: o.lunch_menus?.starter || null,
          menu_main_course: o.lunch_menus?.main_course || null,
          menu_beverage: o.lunch_menus?.beverage || null,
          menu_dessert: o.lunch_menus?.dessert || null,
          menu_notes: o.lunch_menus?.notes || null,
          ticket_code: ticketMap.get(o.id) || null,
          addons: (o.lunch_order_addons || []).map((a: any) => `${a.addon_name}${a.quantity > 1 ? ` x${a.quantity}` : ''}`),
          observations: o.lunch_menus?.notes || null,
        };
      });

      setOrders(mapped);

      // Calculate summary
      const studentOrders = mapped.filter(o => o.student_id);
      const teacherOrders = mapped.filter(o => o.teacher_id);
      const uniqueClassrooms = new Set(studentOrders.map(o => `${o.student_grade}-${o.student_section}`).filter(Boolean));
      const uniqueGrades = new Set(studentOrders.map(o => o.student_grade).filter(Boolean));

      setSummary({
        totalStudents: studentOrders.length,
        totalTeachers: teacherOrders.length,
        classrooms: uniqueClassrooms.size,
        grades: uniqueGrades.size,
      });

    } catch (error: any) {
      console.error('❌ Error cargando pedidos:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los pedidos del día.' });
    } finally {
      setLoading(false);
    }
  }, [todayStr, schoolId]);

  useEffect(() => {
    fetchTodayOrders();
  }, [fetchTodayOrders]);

  // ==========================================
  // SETUP: Build lists based on mode
  // ==========================================

  const startDelivery = () => {
    if (!mode) return;

    const typeOrders = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if (typeOrders.length === 0) {
      toast({ variant: 'destructive', title: 'Sin pedidos', description: `No hay pedidos de ${personType === 'students' ? 'alumnos' : 'profesores'} para hoy.` });
      return;
    }

    if (mode === 'by_classroom') {
      const classrooms = [...new Set(typeOrders.map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim()).filter(Boolean))].sort();
      if (classrooms.length === 0) {
        setAvailableLists(['Todos']);
      } else {
        setAvailableLists(classrooms);
      }
    } else if (mode === 'by_grade') {
      const grades = [...new Set(typeOrders.map(o => o.student_grade).filter(Boolean) as string[])].sort();
      if (grades.length === 0) {
        setAvailableLists(['Todos']);
      } else {
        setAvailableLists(grades);
      }
    } else {
      // alphabetical or all
      setAvailableLists(['Todos']);
    }

    setCurrentListIndex(0);
    setSearchTerm('');
    setStatusFilter('all');
    setSetupDone(true);
  };

  // ==========================================
  // FILTERED ORDERS for current list
  // ==========================================

  const currentListOrders = useMemo(() => {
    // Base: filter by person type
    let filtered = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    // Filter by current list (classroom/grade)
    if (mode === 'by_classroom' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const currentClassroom = availableLists[currentListIndex];
      filtered = filtered.filter(o => {
        const classroom = `${o.student_grade || ''} ${o.student_section || ''}`.trim();
        return classroom === currentClassroom;
      });
    } else if (mode === 'by_grade' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const currentGrade = availableLists[currentListIndex];
      filtered = filtered.filter(o => o.student_grade === currentGrade);
    }

    // Sort alphabetically
    if (mode === 'alphabetical' || mode === 'all') {
      filtered.sort((a, b) => {
        const nameA = (a.student_name || a.teacher_name || '').toLowerCase();
        const nameB = (b.student_name || b.teacher_name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(o => {
        const name = (o.student_name || o.teacher_name || '').toLowerCase();
        const ticket = (o.ticket_code || '').toLowerCase();
        return name.includes(q) || ticket.includes(q);
      });
    }

    // Status filter
    if (statusFilter === 'pending') {
      filtered = filtered.filter(o => o.status !== 'delivered');
    } else if (statusFilter === 'delivered') {
      filtered = filtered.filter(o => o.status === 'delivered');
    }

    return filtered;
  }, [orders, personType, mode, availableLists, currentListIndex, searchTerm, statusFilter]);

  // Progress stats for current list
  const listProgress = useMemo(() => {
    // Get all orders for this list (without search/status filters)
    let base = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if (mode === 'by_classroom' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const currentClassroom = availableLists[currentListIndex];
      base = base.filter(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim() === currentClassroom);
    } else if (mode === 'by_grade' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const currentGrade = availableLists[currentListIndex];
      base = base.filter(o => o.student_grade === currentGrade);
    }

    const total = base.length;
    const delivered = base.filter(o => o.status === 'delivered').length;
    return { total, delivered, pct: total > 0 ? Math.round((delivered / total) * 100) : 0 };
  }, [orders, personType, mode, availableLists, currentListIndex]);

  // ==========================================
  // TOGGLE DELIVERED
  // ==========================================

  const toggleDelivered = async (order: DeliveryOrder) => {
    setTogglingId(order.id);
    const isDelivered = order.status === 'delivered';
    const newStatus = isDelivered ? 'pending' : 'delivered';

    try {
      const updateData: any = {
        status: newStatus,
        delivered_at: isDelivered ? null : new Date().toISOString(),
        delivered_by: isDelivered ? null : userId,
      };

      const { error } = await supabase
        .from('lunch_orders')
        .update(updateData)
        .eq('id', order.id);

      if (error) throw error;

      // Optimistic update
      setOrders(prev => prev.map(o =>
        o.id === order.id
          ? { ...o, status: newStatus, delivered_at: updateData.delivered_at, delivered_by: updateData.delivered_by }
          : o
      ));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo actualizar.' });
    } finally {
      setTogglingId(null);
    }
  };

  // ==========================================
  // REALTIME SUBSCRIPTION
  // ==========================================

  useEffect(() => {
    const channel = supabase
      .channel('delivery-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lunch_orders',
          filter: `order_date=eq.${todayStr}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setOrders(prev => prev.map(o =>
            o.id === updated.id
              ? {
                  ...o,
                  status: updated.status,
                  delivered_at: updated.delivered_at,
                  delivered_by: updated.delivered_by,
                  is_cancelled: updated.is_cancelled,
                }
              : o
          ));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [todayStr]);

  // ==========================================
  // RENDER: SETUP WIZARD
  // ==========================================

  if (!setupDone) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 p-3 sm:p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="icon" onClick={onClose}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                <UtensilsCrossed className="h-6 w-6 text-orange-600" />
                Entrega de Almuerzos
              </h1>
              <p className="text-sm text-gray-500">
                {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })}
              </p>
            </div>
          </div>

          {loading ? (
            <Card>
              <CardContent className="py-12 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary */}
              <Card className="mb-6 bg-white/80 backdrop-blur">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">📊 Resumen del día</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-black text-blue-700">{summary.totalStudents}</p>
                      <p className="text-[10px] text-blue-600 font-medium">Alumnos</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-black text-purple-700">{summary.totalTeachers}</p>
                      <p className="text-[10px] text-purple-600 font-medium">Profesores</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-black text-green-700">{summary.classrooms}</p>
                      <p className="text-[10px] text-green-600 font-medium">Aulas</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-black text-amber-700">{summary.totalStudents + summary.totalTeachers}</p>
                      <p className="text-[10px] text-amber-600 font-medium">Total</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Person type */}
              <Card className="mb-6 bg-white/80 backdrop-blur">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">¿A quiénes vas a entregar?</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setPersonType('students')}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all text-center",
                        personType === 'students'
                          ? "border-blue-500 bg-blue-50 shadow-lg scale-[1.02]"
                          : "border-gray-200 hover:border-blue-300"
                      )}
                    >
                      <Users className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                      <p className="font-bold text-blue-800">Alumnos</p>
                      <p className="text-xs text-gray-500">{summary.totalStudents} pedidos</p>
                    </button>
                    <button
                      onClick={() => setPersonType('teachers')}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all text-center",
                        personType === 'teachers'
                          ? "border-purple-500 bg-purple-50 shadow-lg scale-[1.02]"
                          : "border-gray-200 hover:border-purple-300"
                      )}
                    >
                      <GraduationCap className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                      <p className="font-bold text-purple-800">Profesores</p>
                      <p className="text-xs text-gray-500">{summary.totalTeachers} pedidos</p>
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Delivery mode */}
              <Card className="mb-6 bg-white/80 backdrop-blur">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">¿Cómo vas a repartir?</p>
                  <div className="grid grid-cols-2 gap-3">
                    {personType === 'students' && (
                      <>
                        <button
                          onClick={() => setMode('by_classroom')}
                          className={cn(
                            "p-4 rounded-xl border-2 transition-all text-center",
                            mode === 'by_classroom'
                              ? "border-orange-500 bg-orange-50 shadow-lg"
                              : "border-gray-200 hover:border-orange-300"
                          )}
                        >
                          <LayoutGrid className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                          <p className="font-bold text-sm">Por Aulas</p>
                          <p className="text-[10px] text-gray-500">Una lista por aula</p>
                        </button>
                        <button
                          onClick={() => setMode('by_grade')}
                          className={cn(
                            "p-4 rounded-xl border-2 transition-all text-center",
                            mode === 'by_grade'
                              ? "border-orange-500 bg-orange-50 shadow-lg"
                              : "border-gray-200 hover:border-orange-300"
                          )}
                        >
                          <GraduationCap className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                          <p className="font-bold text-sm">Por Grados</p>
                          <p className="text-[10px] text-gray-500">Una lista por grado</p>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setMode('alphabetical')}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all text-center",
                        mode === 'alphabetical'
                          ? "border-orange-500 bg-orange-50 shadow-lg"
                          : "border-gray-200 hover:border-orange-300"
                      )}
                    >
                      <SortAsc className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                      <p className="font-bold text-sm">Alfabético</p>
                      <p className="text-[10px] text-gray-500">A-Z por nombre</p>
                    </button>
                    <button
                      onClick={() => setMode('all')}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all text-center",
                        mode === 'all'
                          ? "border-orange-500 bg-orange-50 shadow-lg"
                          : "border-gray-200 hover:border-orange-300"
                      )}
                    >
                      <Users className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                      <p className="font-bold text-sm">Todos a la vez</p>
                      <p className="text-[10px] text-gray-500">Con filtros</p>
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Start button */}
              <Button
                onClick={startDelivery}
                disabled={!mode}
                className="w-full h-14 text-lg font-bold bg-orange-600 hover:bg-orange-700 rounded-xl shadow-lg"
              >
                <UtensilsCrossed className="h-5 w-5 mr-2" />
                🚀 Iniciar Entrega
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: DELIVERY LIST
  // ==========================================

  const currentListName = availableLists[currentListIndex] || 'Todos';
  const isLastList = currentListIndex >= availableLists.length - 1;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── TOP BAR ── */}
      <div className="bg-white border-b shadow-sm sticky top-0 z-30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => setSetupDone(false)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm sm:text-base truncate">
                {personType === 'students' ? '👦 Alumnos' : '👨‍🏫 Profesores'}
                {currentListName !== 'Todos' && ` — ${currentListName}`}
              </h1>
              {availableLists.length > 1 && (
                <Badge variant="outline" className="text-[10px] flex-shrink-0">
                  Lista {currentListIndex + 1}/{availableLists.length}
                </Badge>
              )}
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    listProgress.pct === 100 ? "bg-green-500" : "bg-orange-500"
                  )}
                  style={{ width: `${listProgress.pct}%` }}
                />
              </div>
              <span className={cn(
                "text-xs font-bold flex-shrink-0",
                listProgress.pct === 100 ? "text-green-600" : "text-orange-600"
              )}>
                {listProgress.delivered}/{listProgress.total}
              </span>
            </div>
          </div>

          {/* Refresh */}
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={fetchTodayOrders}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              ref={searchInputRef}
              placeholder="Buscar por nombre o ticket..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Status filter buttons */}
          <div className="flex gap-1">
            <Button
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-9 px-2 text-[10px] sm:text-xs"
              onClick={() => setStatusFilter('all')}
            >
              Todos
            </Button>
            <Button
              variant={statusFilter === 'pending' ? 'default' : 'outline'}
              size="sm"
              className="h-9 px-2 text-[10px] sm:text-xs"
              onClick={() => setStatusFilter('pending')}
            >
              <Clock className="h-3 w-3 mr-1" />
              Pendientes
            </Button>
            <Button
              variant={statusFilter === 'delivered' ? 'default' : 'outline'}
              size="sm"
              className="h-9 px-2 text-[10px] sm:text-xs"
              onClick={() => setStatusFilter('delivered')}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Entregados
            </Button>
          </div>
        </div>
      </div>

      {/* ── ORDER LIST ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {currentListOrders.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <UtensilsCrossed className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">
              {searchTerm ? 'Sin resultados' : 'No hay pedidos en esta lista'}
            </p>
            <p className="text-xs mt-1">
              {searchTerm ? `No se encontró "${searchTerm}"` : 'Pasa a la siguiente lista o cambia los filtros.'}
            </p>
          </div>
        ) : (
          currentListOrders.map(order => {
            const name = order.student_name || order.teacher_name || 'Sin nombre';
            const isDelivered = order.status === 'delivered';
            const isToggling = togglingId === order.id;

            return (
              <div
                key={order.id}
                className={cn(
                  "bg-white rounded-lg border shadow-sm transition-all",
                  isDelivered
                    ? "border-green-200 bg-green-50/50"
                    : "border-gray-200 hover:border-orange-300"
                )}
              >
                <div className="flex items-center gap-2 p-2 sm:p-3">
                  {/* Photo / Avatar */}
                  <div className="flex-shrink-0">
                    {order.student_photo ? (
                      <button onClick={() => setViewingPhoto(order.student_photo)}>
                        <img
                          src={order.student_photo}
                          alt={name}
                          className="h-10 w-10 sm:h-12 sm:w-12 rounded-full object-cover border-2 border-gray-200"
                        />
                      </button>
                    ) : (
                      <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200">
                        <span className="text-gray-500 font-bold text-sm sm:text-base">
                          {name[0]?.toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn(
                        "font-bold text-xs sm:text-sm truncate",
                        isDelivered ? "text-green-800 line-through opacity-70" : "text-gray-900"
                      )}>
                        {name}
                      </p>
                      {order.ticket_code && (
                        <Badge variant="outline" className="text-[8px] sm:text-[9px] flex-shrink-0 font-mono">
                          🎫 {order.ticket_code}
                        </Badge>
                      )}
                    </div>

                    {/* Grade + Category */}
                    <div className="flex items-center gap-2 mt-0.5">
                      {personType === 'students' && order.student_grade && (
                        <span className="text-[10px] sm:text-xs text-gray-500 font-medium">
                          {order.student_grade} {order.student_section}
                        </span>
                      )}
                      {order.category_name && (
                        <Badge className="text-[8px] sm:text-[9px] bg-orange-100 text-orange-700 hover:bg-orange-100 border border-orange-200">
                          {order.category_name}
                        </Badge>
                      )}
                      {order.quantity > 1 && (
                        <Badge className="text-[8px] bg-blue-100 text-blue-700">x{order.quantity}</Badge>
                      )}
                    </div>

                    {/* Plate detail */}
                    <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 truncate">
                      {order.menu_main_course || 'Sin detalle de menú'}
                    </p>

                    {/* Observations */}
                    {order.observations && (
                      <div className="mt-1 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        <p className="text-[9px] sm:text-[10px] text-amber-800">
                          📝 {order.observations}
                        </p>
                      </div>
                    )}

                    {/* Addons */}
                    {order.addons.length > 0 && (
                      <p className="text-[9px] text-purple-600 mt-0.5">
                        ➕ {order.addons.join(', ')}
                      </p>
                    )}
                  </div>

                  {/* DELIVER BUTTON — big, single tap */}
                  <button
                    onClick={() => toggleDelivered(order)}
                    disabled={isToggling}
                    className={cn(
                      "flex-shrink-0 h-12 w-12 sm:h-14 sm:w-14 rounded-xl flex items-center justify-center transition-all active:scale-90",
                      isToggling && "opacity-50",
                      isDelivered
                        ? "bg-green-500 text-white shadow-lg shadow-green-200"
                        : "bg-gray-100 text-gray-400 hover:bg-orange-100 hover:text-orange-600 border-2 border-dashed border-gray-300"
                    )}
                  >
                    {isToggling ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : isDelivered ? (
                      <CheckCircle2 className="h-6 w-6 sm:h-7 sm:w-7" />
                    ) : (
                      <CheckCircle2 className="h-6 w-6 sm:h-7 sm:w-7" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── BOTTOM BAR: Navigation ── */}
      {availableLists.length > 1 && (
        <div className="bg-white border-t shadow-lg px-3 py-2 flex items-center justify-between sticky bottom-0 z-30">
          <Button
            variant="outline"
            size="sm"
            disabled={currentListIndex === 0}
            onClick={() => { setCurrentListIndex(i => i - 1); setSearchTerm(''); }}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>

          <div className="text-center">
            <p className="text-xs font-bold text-gray-700">
              {currentListName}
            </p>
            <p className="text-[10px] text-gray-500">
              {currentListIndex + 1} de {availableLists.length}
            </p>
          </div>

          <Button
            size="sm"
            disabled={isLastList}
            onClick={() => { setCurrentListIndex(i => i + 1); setSearchTerm(''); }}
            className={cn(
              "gap-1",
              isLastList
                ? "bg-green-600 hover:bg-green-700"
                : "bg-orange-600 hover:bg-orange-700"
            )}
          >
            {isLastList ? 'Última' : 'Siguiente'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── PHOTO VIEWER ── */}
      <Dialog open={!!viewingPhoto} onOpenChange={() => setViewingPhoto(null)}>
        <DialogContent className="max-w-xs p-2">
          <DialogHeader>
            <DialogTitle className="text-sm">Foto del alumno</DialogTitle>
          </DialogHeader>
          {viewingPhoto && (
            <img src={viewingPhoto} alt="Foto" className="w-full rounded-lg object-cover max-h-[60vh]" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
