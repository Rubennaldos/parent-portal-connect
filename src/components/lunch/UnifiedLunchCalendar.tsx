import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ChevronLeft,
  ChevronRight,
  UtensilsCrossed,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CalendarDays,
  Clock,
  Lock,
  Sparkles,
  Users,
  Package
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, addMonths, subMonths, isBefore, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

// ==========================================
// INTERFACES
// ==========================================

interface UnifiedLunchCalendarProps {
  userType: 'teacher' | 'parent';
  userId: string;
  userSchoolId: string;
}

interface LunchCategory {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  price: number | null;
  target_type: 'students' | 'teachers' | 'both';
}

interface LunchMenu {
  id: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  notes: string | null;
  category_id: string | null;
  category?: LunchCategory | null;
}

interface SpecialDay {
  date: string;
  type: string;
  title: string;
}

interface LunchConfig {
  lunch_price: number;
  orders_enabled: boolean;
  order_deadline_time: string;
  order_deadline_days: number;
}

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  school_id: string;
  free_account: boolean;
  balance: number;
}

interface CartItem {
  date: string;
  menuId: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  price: number;
  quantity: number;
  menuDescription: string; // "Entrada + Segundo + ..."
}

interface ExistingOrder {
  date: string;
  categoryName: string | null;
  status: string;
}

// ==========================================
// ICON MAP
// ==========================================
const ICON_MAP: Record<string, any> = {
  utensils: UtensilsCrossed,
  salad: Sparkles,
  coins: ShoppingCart,
  leaf: Sparkles,
  briefcase: Users,
  sparkles: Sparkles,
  package: Package,
};

// ==========================================
// CONSTANTS
// ==========================================
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// ==========================================
// COMPONENT
// ==========================================
export function UnifiedLunchCalendar({ userType, userId, userSchoolId }: UnifiedLunchCalendarProps) {
  const { toast } = useToast();

  // Navigation
  const [currentDate, setCurrentDate] = useState(new Date());

  // Data
  const [menus, setMenus] = useState<Map<string, LunchMenu[]>>(new Map()); // date → menus[]
  const [specialDays, setSpecialDays] = useState<Map<string, SpecialDay>>(new Map());
  const [existingOrders, setExistingOrders] = useState<ExistingOrder[]>([]);
  const [config, setConfig] = useState<LunchConfig | null>(null);
  const [categories, setCategories] = useState<Map<string, LunchCategory>>(new Map()); // catId → category

  // Parent-specific
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Selection & Cart
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartItem[]>([]);

  // UI State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // ==========================================
  // DATA FETCHING
  // ==========================================

  // Get the effective school ID (for parents, depends on selected student)
  const effectiveSchoolId = useMemo(() => {
    if (userType === 'parent' && selectedStudent) {
      return selectedStudent.school_id;
    }
    return userSchoolId;
  }, [userType, selectedStudent, userSchoolId]);

  // Load students for parents
  useEffect(() => {
    if (userType === 'parent') {
      fetchStudents();
    }
  }, [userType, userId]);

  // Load monthly data when month or school changes
  useEffect(() => {
    if (effectiveSchoolId) {
      fetchMonthlyData();
    }
  }, [currentDate, effectiveSchoolId]);

  const fetchStudents = async () => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, photo_url, school_id, free_account, balance')
        .eq('parent_id', userId)
        .eq('is_active', true);

      if (error) throw error;
      setStudents(data || []);
      if (data && data.length > 0) {
        setSelectedStudent(data[0]);
      }
    } catch (error: any) {
      console.error('Error fetching students:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los estudiantes' });
    }
  };

  const fetchMonthlyData = async () => {
    try {
      setLoading(true);
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      console.log('📅 [UnifiedCalendar] Cargando datos del mes:', startStr, 'a', endStr);

      // 1. Configuration
      const { data: configData } = await supabase
        .from('lunch_configuration')
        .select('lunch_price, orders_enabled, order_deadline_time, order_deadline_days')
        .eq('school_id', effectiveSchoolId)
        .maybeSingle();

      setConfig(configData);

      // 2. Menus for the month (filtered by target_type)
      const targetType = userType === 'parent' ? 'students' : 'teachers';
      const { data: menusData, error: menusError } = await supabase
        .from('lunch_menus')
        .select('id, date, starter, main_course, beverage, dessert, notes, category_id, target_type')
        .eq('school_id', effectiveSchoolId)
        .eq('target_type', targetType)
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date', { ascending: true });

      if (menusError) throw menusError;

      // 3. Load categories for the menus
      const categoryIds = [...new Set((menusData || []).map(m => m.category_id).filter(Boolean))] as string[];
      let categoriesMap = new Map<string, LunchCategory>();

      if (categoryIds.length > 0) {
        const { data: categoriesData } = await supabase
          .from('lunch_categories')
          .select('*')
          .in('id', categoryIds);

        (categoriesData || []).forEach(cat => {
          categoriesMap.set(cat.id, cat);
        });
      }
      setCategories(categoriesMap);

      // Build menus map (date → menus with categories)
      const menusMap = new Map<string, LunchMenu[]>();
      (menusData || []).forEach(menu => {
        const menuWithCat = {
          ...menu,
          category: menu.category_id ? categoriesMap.get(menu.category_id) || null : null
        };
        const existing = menusMap.get(menu.date) || [];
        existing.push(menuWithCat);
        menusMap.set(menu.date, existing);
      });
      setMenus(menusMap);

      // 4. Special days
      const { data: specialDaysData } = await supabase
        .from('special_days')
        .select('date, type, title')
        .eq('school_id', effectiveSchoolId)
        .gte('date', startStr)
        .lte('date', endStr);

      const specialMap = new Map<string, SpecialDay>();
      (specialDaysData || []).forEach(day => specialMap.set(day.date, day));
      setSpecialDays(specialMap);

      // 5. Existing orders
      const personField = userType === 'parent' ? 'student_id' : 'teacher_id';
      const personId = userType === 'parent' ? selectedStudent?.id : userId;

      if (personId) {
        const { data: ordersData } = await supabase
          .from('lunch_orders')
          .select('order_date, status, category_id')
          .eq(personField, personId)
          .or('is_cancelled.eq.false,is_cancelled.is.null')
          .gte('order_date', startStr)
          .lte('order_date', endStr);

        const orders: ExistingOrder[] = (ordersData || []).map(o => ({
          date: o.order_date,
          categoryName: o.category_id ? categoriesMap.get(o.category_id)?.name || null : null,
          status: o.status
        }));
        setExistingOrders(orders);
      }

      console.log('✅ [UnifiedCalendar] Datos cargados:', {
        menus: menusMap.size, categories: categoriesMap.size,
        specialDays: specialMap.size, existingOrders: existingOrders.length
      });

    } catch (error: any) {
      console.error('❌ [UnifiedCalendar] Error:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos del mes' });
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // DEADLINE VALIDATION
  // ==========================================

  const canOrderForDate = (dateStr: string): { canOrder: boolean; reason?: string } => {
    const today = startOfDay(new Date());
    const target = new Date(dateStr + 'T12:00:00');

    // Block past days
    if (isBefore(target, today)) {
      return { canOrder: false, reason: 'Día pasado' };
    }

    // Block today if past deadline
    if (!config || !config.order_deadline_time || config.order_deadline_days === undefined) {
      return { canOrder: true };
    }

    const now = new Date();
    const targetDate = new Date(dateStr + 'T00:00:00-05:00');

    const deadlineDate = new Date(targetDate);
    deadlineDate.setDate(deadlineDate.getDate() - config.order_deadline_days);

    const [hours, minutes] = config.order_deadline_time.split(':').map(Number);
    deadlineDate.setHours(hours, minutes, 0, 0);

    if (now > deadlineDate) {
      return {
        canOrder: false,
        reason: `Límite: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
      };
    }

    return { canOrder: true };
  };

  // ==========================================
  // CALENDAR INTERACTIONS
  // ==========================================

  const handleDateClick = (dateStr: string) => {
    // Check if the day has menus
    if (!menus.has(dateStr)) {
      toast({ title: 'Sin menú', description: 'No hay menú disponible para este día', variant: 'destructive' });
      return;
    }

    // Check special day
    if (specialDays.has(dateStr)) {
      toast({ title: 'Día especial', description: specialDays.get(dateStr)?.title || 'No disponible' });
      return;
    }

    // Check deadline
    const validation = canOrderForDate(dateStr);
    if (!validation.canOrder) {
      toast({ title: '🔒 Bloqueado', description: validation.reason || 'No se puede pedir para este día', variant: 'destructive' });
      return;
    }

    // Toggle selection
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
        // Remove from cart too
        setCart(c => c.filter(item => item.date !== dateStr));
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  // ==========================================
  // CART MANAGEMENT
  // ==========================================

  const addToCart = (dateStr: string, menu: LunchMenu) => {
    if (!menu.category) return;

    setCart(prev => {
      const existing = prev.find(
        item => item.date === dateStr && item.categoryId === menu.category!.id
      );

      if (existing) {
        // Increase quantity
        return prev.map(item =>
          item.date === dateStr && item.categoryId === menu.category!.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      // Add new item
      const menuDesc = [menu.starter, menu.main_course, menu.beverage, menu.dessert]
        .filter(Boolean)
        .join(' • ');

      return [...prev, {
        date: dateStr,
        menuId: menu.id,
        categoryId: menu.category!.id,
        categoryName: menu.category!.name,
        categoryColor: menu.category!.color || '#3B82F6',
        price: menu.category!.price || config?.lunch_price || 0,
        quantity: 1,
        menuDescription: menuDesc,
      }];
    });
  };

  const removeFromCart = (dateStr: string, categoryId: string) => {
    setCart(prev => {
      const existing = prev.find(
        item => item.date === dateStr && item.categoryId === categoryId
      );

      if (existing && existing.quantity > 1) {
        return prev.map(item =>
          item.date === dateStr && item.categoryId === categoryId
            ? { ...item, quantity: item.quantity - 1 }
            : item
        );
      }

      return prev.filter(
        item => !(item.date === dateStr && item.categoryId === categoryId)
      );
    });
  };

  const getCartQuantity = (dateStr: string, categoryId: string): number => {
    return cart.find(item => item.date === dateStr && item.categoryId === categoryId)?.quantity || 0;
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }, [cart]);

  const cartItemCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // ==========================================
  // ORDER SUBMISSION
  // ==========================================

  const handleConfirmOrders = async () => {
    if (cart.length === 0) return;

    if (!config?.orders_enabled) {
      toast({ variant: 'destructive', title: 'Pedidos deshabilitados', description: 'Los pedidos no están activos en este momento' });
      return;
    }

    // Re-validate all dates
    for (const item of cart) {
      const validation = canOrderForDate(item.date);
      if (!validation.canOrder) {
        toast({
          variant: 'destructive',
          title: 'Fecha bloqueada',
          description: `No se puede pedir para el ${format(new Date(item.date + 'T12:00:00'), "d 'de' MMMM", { locale: es })}. ${validation.reason}`
        });
        return;
      }
    }

    setSubmitting(true);

    try {
      console.log('🛒 [UnifiedCalendar] Confirmando pedidos:', cart);

      const personField = userType === 'parent' ? 'student_id' : 'teacher_id';
      const personId = userType === 'parent' ? selectedStudent?.id : userId;

      if (!personId) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se encontró el usuario' });
        return;
      }

      let totalOrders = 0;

      for (const item of cart) {
        for (let i = 0; i < item.quantity; i++) {
          // 1. Create lunch_order
          const orderData: any = {
            [personField]: personId,
            order_date: item.date,
            status: 'pending',
            category_id: item.categoryId,
            menu_id: item.menuId,
            school_id: effectiveSchoolId,
            base_price: item.price,
            addons_total: 0,
            final_price: item.price,
          };

          const { data: insertedOrder, error: orderError } = await supabase
            .from('lunch_orders')
            .insert([orderData])
            .select('id')
            .single();

          if (orderError) {
            console.error('❌ Error creando lunch_order:', orderError);
            throw orderError;
          }

          // 2. Create transaction (pending)
          const dateFormatted = format(new Date(item.date + 'T12:00:00'), "d 'de' MMMM", { locale: es });
          const description = `Almuerzo - ${item.categoryName} - ${dateFormatted}`;

          const transactionData: any = {
            [personField]: personId,
            type: 'purchase',
            amount: -Math.abs(item.price),
            description,
            payment_status: 'pending',
            payment_method: null,
            school_id: effectiveSchoolId,
            created_by: userId,
            metadata: {
              lunch_order_id: insertedOrder.id,
              source: `unified_calendar_${userType}`,
              order_date: item.date,
              menu_name: item.categoryName,
            }
          };

          const { error: txError } = await supabase
            .from('transactions')
            .insert([transactionData]);

          if (txError) {
            console.error('❌ Error creando transaction:', txError);
            // Don't throw - the order was created, just log the error
          }

          totalOrders++;
        }
      }

      toast({
        title: '✅ ¡Pedidos confirmados!',
        description: `${totalOrders} almuerzo(s) registrado(s) por S/ ${cartTotal.toFixed(2)}`,
      });

      // Clear selection and cart, reload data
      setSelectedDates(new Set());
      setCart([]);
      await fetchMonthlyData();

    } catch (error: any) {
      console.error('❌ [UnifiedCalendar] Error confirmando pedidos:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudieron registrar los pedidos' });
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================
  // CALENDAR RENDERING
  // ==========================================

  const getDayStatus = (dateStr: string): 'available' | 'ordered' | 'special' | 'unavailable' | 'blocked' => {
    if (specialDays.has(dateStr)) return 'special';

    const validation = canOrderForDate(dateStr);
    if (!validation.canOrder) return 'blocked';

    if (!menus.has(dateStr)) return 'unavailable';

    return 'available';
  };

  const getExistingOrdersForDate = (dateStr: string) => {
    return existingOrders.filter(o => o.date === dateStr);
  };

  const renderCalendar = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    const startDayOfWeek = start.getDay();

    return (
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {/* Day headers */}
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-center text-[10px] sm:text-xs font-medium text-gray-500 p-1 sm:p-2">
            {day}
          </div>
        ))}

        {/* Empty cells before first day */}
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* Days */}
        {days.map((date) => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const status = getDayStatus(dateStr);
          const isSelected = selectedDates.has(dateStr);
          const todayCheck = isToday(date);
          const dayMenus = menus.get(dateStr) || [];
          const dayOrders = getExistingOrdersForDate(dateStr);
          const dayCartItems = cart.filter(item => item.date === dateStr);
          const dayCartCount = dayCartItems.reduce((sum, item) => sum + item.quantity, 0);

          return (
            <button
              key={dateStr}
              onClick={() => {
                if (status === 'available' || (status === 'ordered')) {
                  handleDateClick(dateStr);
                }
              }}
              disabled={status === 'unavailable' || status === 'blocked' || status === 'special'}
              className={cn(
                "aspect-square p-1 rounded-lg border-2 transition-all relative flex flex-col items-center justify-start",
                "hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50",
                todayCheck && "ring-2 ring-blue-400",
                isSelected && "ring-2 ring-purple-500 bg-purple-50 border-purple-300",
                !isSelected && status === 'available' && "bg-white border-blue-200 hover:border-blue-400 hover:bg-blue-50",
                status === 'special' && "bg-gray-100 border-gray-300",
                status === 'unavailable' && "bg-gray-50 border-gray-200",
                status === 'blocked' && "bg-red-50 border-red-200",
              )}
            >
              <span className={cn(
                "text-xs sm:text-sm font-medium",
                status === 'blocked' && "text-red-400",
                status === 'unavailable' && "text-gray-400",
                isSelected && "text-purple-700 font-bold",
              )}>
                {format(date, 'd')}
              </span>

              {/* Status indicators */}
              {status === 'blocked' && (
                <Lock className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-red-400 mt-0.5" />
              )}

              {status === 'available' && dayMenus.length > 0 && !isSelected && (
                <UtensilsCrossed className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-500 mt-0.5" />
              )}

              {/* Number of existing orders */}
              {dayOrders.length > 0 && (
                <Badge className="absolute top-0 right-0 h-3.5 w-3.5 sm:h-4 sm:w-4 p-0 flex items-center justify-center text-[8px] sm:text-[9px] bg-green-500">
                  {dayOrders.length}
                </Badge>
              )}

              {/* Cart count for this day */}
              {dayCartCount > 0 && (
                <Badge className="absolute bottom-0 right-0 h-3.5 w-3.5 sm:h-4 sm:w-4 p-0 flex items-center justify-center text-[8px] sm:text-[9px] bg-purple-600">
                  {dayCartCount}
                </Badge>
              )}

              {/* Category dots for available menus */}
              {dayMenus.length > 0 && !isSelected && status !== 'blocked' && (
                <div className="flex gap-0.5 mt-0.5">
                  {dayMenus.slice(0, 3).map((m, idx) => (
                    <div
                      key={idx}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: m.category?.color || '#3B82F6' }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  // ==========================================
  // CATEGORY SELECTOR FOR SELECTED DATES
  // ==========================================

  const renderCategorySelector = () => {
    const sortedDates = [...selectedDates].sort();

    if (sortedDates.length === 0) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <ShoppingCart className="h-4 w-4" />
          Selecciona tu menú para cada día
        </div>

        {sortedDates.map(dateStr => {
          const dayMenus = menus.get(dateStr) || [];
          const dayOrders = getExistingOrdersForDate(dateStr);

          return (
            <Card key={dateStr} className="border-purple-200 bg-purple-50/30">
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-purple-800">
                    📅 {format(new Date(dateStr + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                    onClick={() => {
                      setSelectedDates(prev => {
                        const next = new Set(prev);
                        next.delete(dateStr);
                        return next;
                      });
                      setCart(c => c.filter(item => item.date !== dateStr));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Show existing orders */}
                {dayOrders.length > 0 && (
                  <p className="text-xs text-green-700 mt-1">
                    ✅ Ya tienes {dayOrders.length} pedido(s): {dayOrders.map(o => o.categoryName || 'Menú').join(', ')}
                  </p>
                )}
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-2">
                {dayMenus.length === 0 ? (
                  <p className="text-xs text-gray-500">No hay menús disponibles</p>
                ) : (
                  dayMenus.map(menu => {
                    if (!menu.category) return null;
                    const qty = getCartQuantity(dateStr, menu.category.id);
                    const IconComponent = ICON_MAP[menu.category.icon || 'utensils'] || UtensilsCrossed;

                    return (
                      <div
                        key={menu.id}
                        className={cn(
                          "flex items-center gap-3 p-2.5 rounded-lg border-2 transition-all",
                          qty > 0
                            ? "border-purple-400 bg-white shadow-sm"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        )}
                      >
                        {/* Category icon */}
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: menu.category.color + '20' }}
                        >
                          <IconComponent
                            className="h-4 w-4"
                            style={{ color: menu.category.color }}
                          />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{menu.category.name}</p>
                          <p className="text-[10px] sm:text-xs text-gray-500 truncate">
                            {[menu.starter, menu.main_course, menu.beverage, menu.dessert]
                              .filter(Boolean)
                              .join(' • ')}
                          </p>
                        </div>

                        {/* Price */}
                        <div className="text-sm font-bold text-gray-700 whitespace-nowrap">
                          S/ {(menu.category.price || config?.lunch_price || 0).toFixed(2)}
                        </div>

                        {/* Quantity selector */}
                        <div className="flex items-center gap-1">
                          {qty > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromCart(dateStr, menu.category!.id);
                              }}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                          )}

                          {qty > 0 && (
                            <span className="w-6 text-center text-sm font-bold text-purple-700">{qty}</span>
                          )}

                          <Button
                            variant={qty > 0 ? "outline" : "default"}
                            size="sm"
                            className={cn(
                              "h-7 p-0",
                              qty > 0 ? "w-7" : "w-7 bg-purple-600 hover:bg-purple-700"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCart(dateStr, menu);
                            }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  // ==========================================
  // MAIN RENDER
  // ==========================================

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* STUDENT SELECTOR (parents only) */}
      {userType === 'parent' && students.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Selecciona tu hijo(a):</p>
            <div className="flex gap-2 flex-wrap">
              {students.map(student => (
                <Button
                  key={student.id}
                  variant={selectedStudent?.id === student.id ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "gap-2",
                    selectedStudent?.id === student.id && "bg-purple-600 hover:bg-purple-700"
                  )}
                  onClick={() => {
                    setSelectedStudent(student);
                    setSelectedDates(new Set());
                    setCart([]);
                  }}
                >
                  <Users className="h-3.5 w-3.5" />
                  {student.full_name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* CALENDAR */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setCurrentDate(subMonths(currentDate, 1));
                setSelectedDates(new Set());
                setCart([]);
              }}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div className="text-center">
              <CardTitle className="text-base sm:text-lg">
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Selecciona los días para hacer tu pedido
              </CardDescription>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setCurrentDate(addMonths(currentDate, 1));
                setSelectedDates(new Set());
                setCart([]);
              }}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {renderCalendar()}

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-3 text-[10px] sm:text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <UtensilsCrossed className="h-3 w-3 text-blue-500" />
              <span>Disponible</span>
            </div>
            <div className="flex items-center gap-1">
              <Lock className="h-3 w-3 text-red-400" />
              <span>Bloqueado</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded border-2 border-purple-400 bg-purple-50" />
              <span>Seleccionado</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge className="h-3.5 w-3.5 p-0 flex items-center justify-center text-[7px] bg-green-500">1</Badge>
              <span>Ya pedido</span>
            </div>
          </div>

          {/* Deadline info */}
          {config?.order_deadline_time && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5 border border-amber-200">
              <Clock className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Hora límite para pedir: <strong>{config.order_deadline_time.substring(0, 5)}</strong>
                {config.order_deadline_days > 0 && (
                  <>, con {config.order_deadline_days} día(s) de anticipación</>
                )}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CATEGORY SELECTOR */}
      {selectedDates.size > 0 && renderCategorySelector()}

      {/* ORDER SUMMARY & CONFIRM */}
      {cart.length > 0 && (
        <Card className="border-2 border-purple-400 bg-gradient-to-r from-purple-50 to-blue-50 sticky bottom-4 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-bold text-purple-800">
                  🛒 Tu Pedido ({cartItemCount} {cartItemCount === 1 ? 'almuerzo' : 'almuerzos'})
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {[...new Set(cart.map(c => c.date))].length} día(s) seleccionado(s)
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-purple-800">S/ {cartTotal.toFixed(2)}</p>
                <p className="text-[10px] text-gray-500">Total pendiente</p>
              </div>
            </div>

            {/* Cart items summary */}
            <div className="space-y-1 mb-3 max-h-32 overflow-y-auto">
              {cart.map((item, idx) => (
                <div key={idx} className="flex justify-between text-xs">
                  <span className="text-gray-700 truncate flex-1">
                    {format(new Date(item.date + 'T12:00:00'), "d MMM", { locale: es })} - {item.categoryName}
                    {item.quantity > 1 && <span className="font-bold text-purple-600"> x{item.quantity}</span>}
                  </span>
                  <span className="font-medium text-gray-900 ml-2">
                    S/ {(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <Button
              className="w-full bg-purple-600 hover:bg-purple-700 text-white gap-2"
              size="lg"
              disabled={submitting || !config?.orders_enabled}
              onClick={handleConfirmOrders}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmar {cartItemCount} Pedido(s)
                </>
              )}
            </Button>

            {!config?.orders_enabled && (
              <p className="text-xs text-red-600 text-center mt-2">
                ⚠️ Los pedidos están deshabilitados actualmente
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* EMPTY STATE */}
      {!loading && menus.size === 0 && (
        <Card className="bg-gray-50">
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No hay menús disponibles este mes</p>
            <p className="text-sm text-gray-500 mt-1">
              El administrador aún no ha publicado los menús
            </p>
          </CardContent>
        </Card>
      )}

      {/* INFO CARD */}
      <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-xs sm:text-sm">
              <p className="font-medium text-gray-900">¿Cómo funciona?</p>
              <ol className="text-gray-600 mt-1 space-y-0.5 list-decimal list-inside">
                <li>Selecciona los días en el calendario</li>
                <li>Elige el menú para cada día (puedes elegir varios)</li>
                <li>Confirma tu pedido</li>
                <li>El cobro se verá en el módulo de cobranzas</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
