import { useState, useEffect, useCallback } from 'react';
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
  Plus,
  Minus,
  Calendar as CalendarIcon,
  Clock,
  Lock,
  Sparkles,
  Users,
  Package,
  ShoppingCart,
  XCircle,
  Eye,
  Check,
  Ban,
  Trash2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// ==========================================
// INTERFACES
// ==========================================

interface UnifiedLunchCalendarV2Props {
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

// FIXED: Column names match ACTUAL database columns
interface LunchConfig {
  lunch_price: number;
  orders_enabled: boolean;
  order_deadline_time: string;   // "HH:MM:SS"
  order_deadline_days: number;
  cancellation_deadline_time: string;  // FIXED: was "cancel_deadline_time"
  cancellation_deadline_days: number;  // FIXED: was "cancel_deadline_days"
}

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  school_id: string;
  free_account: boolean;
  balance: number;
}

interface ExistingOrder {
  id: string;
  date: string;
  categoryName: string | null;
  categoryId: string | null;
  quantity: number;
  status: string;
  is_cancelled: boolean;
  created_at: string;
  created_by: string | null;
  delivered_by: string | null;
  cancelled_by: string | null;
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

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ==========================================
// TIMEZONE HELPERS (Peru UTC-5) - FIXED
// ==========================================

/**
 * Returns a Date whose .getHours(), .getDate(), etc. return Peru local values.
 * Works by formatting current time in Peru timezone and parsing back.
 * This creates a "fake local" Date that's safe for comparison with
 * dates created via `new Date(year, month, day, ...)`.
 */
const getPeruNow = (): Date => {
  const peruStr = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
  return new Date(peruStr);
};

/**
 * Returns a Date from "YYYY-MM-DD" using local Date constructor.
 * Compatible with getPeruNow() for deadline comparisons.
 */
const getPeruDateOnly = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

/** Get today's date string in Peru timezone as "YYYY-MM-DD" */
const getPeruTodayStr = (): string => {
  const now = getPeruNow();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ==========================================
// COMPONENT
// ==========================================
export function UnifiedLunchCalendarV2({ userType, userId, userSchoolId }: UnifiedLunchCalendarV2Props) {
  const { toast } = useToast();

  // Navigation
  const [currentDate, setCurrentDate] = useState(new Date());

  // Data
  const [menus, setMenus] = useState<Map<string, LunchMenu[]>>(new Map());
  const [specialDays, setSpecialDays] = useState<Map<string, SpecialDay>>(new Map());
  const [existingOrders, setExistingOrders] = useState<ExistingOrder[]>([]);
  const [config, setConfig] = useState<LunchConfig | null>(null);

  // Parent-specific
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Multi-day selection (NEW)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  // Wizard state - processes days sequentially (REDESIGNED)
  const [wizardDates, setWizardDates] = useState<string[]>([]);
  const [wizardCurrentIndex, setWizardCurrentIndex] = useState(0);
  const [wizardStep, setWizardStep] = useState<'idle' | 'category' | 'confirm' | 'done'>('idle');
  const [selectedCategory, setSelectedCategory] = useState<LunchCategory | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<LunchMenu | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [ordersCreated, setOrdersCreated] = useState<number>(0);

  // View existing orders modal
  const [viewOrdersModal, setViewOrdersModal] = useState(false);
  const [viewOrdersDate, setViewOrdersDate] = useState<string | null>(null);

  // Cancellation
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // UI State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // ==========================================
  // COMPUTED
  // ==========================================
  const effectiveSchoolId = userType === 'parent' && selectedStudent ? selectedStudent.school_id : userSchoolId;

  // ==========================================
  // DATA FETCHING
  // ==========================================

  useEffect(() => {
    if (userType === 'parent') fetchStudents();
  }, [userType, userId]);

  useEffect(() => {
    if (effectiveSchoolId) fetchMonthlyData();
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
      if (data && data.length > 0) setSelectedStudent(data[0]);
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

      // 1. Configuration - FIXED: correct column names from DB
      console.log(`🏫 [V2-DEBUG] effectiveSchoolId = ${effectiveSchoolId}`);
      const { data: configData, error: configError } = await supabase
        .from('lunch_configuration')
        .select('lunch_price, orders_enabled, order_deadline_time, order_deadline_days, cancellation_deadline_time, cancellation_deadline_days')
        .eq('school_id', effectiveSchoolId)
        .maybeSingle();

      if (configError) {
        console.error('❌ [V2-DEBUG] Error loading config:', configError);
      }
      console.log('⚙️ [V2-DEBUG] Config loaded:', JSON.stringify(configData));
      if (configData) {
        console.log(`  ⏰ order_deadline_time: ${configData.order_deadline_time}`);
        console.log(`  📅 order_deadline_days: ${configData.order_deadline_days}`);
        console.log(`  🟢 orders_enabled: ${configData.orders_enabled}`);
        const peruNowDebug = getPeruNow();
        console.log(`  🕐 Peru Now: ${peruNowDebug.toString()}`);
        console.log(`  🕐 Peru Date: ${getPeruTodayStr()}`);
      } else {
        console.warn('⚠️ [V2-DEBUG] NO CONFIG found for school', effectiveSchoolId);
      }
      setConfig(configData);

      // 2. Menus - FIXED: include target_type='both' AND target_type IS NULL
      // NULL = menú creado sin target_type (carga masiva), visible para todos
      const targetType = userType === 'parent' ? 'students' : 'teachers';
      const { data: menusData, error: menusError } = await supabase
        .from('lunch_menus')
        .select('id, date, starter, main_course, beverage, dessert, notes, category_id, target_type')
        .eq('school_id', effectiveSchoolId)
        .or(`target_type.eq.${targetType},target_type.eq.both,target_type.is.null`)
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date', { ascending: true });

      if (menusError) throw menusError;

      // 3. Categories - FIXED v1.21.1: filter by school_id + is_active + exclude kitchen sales
      const categoryIds = [...new Set((menusData || []).map(m => m.category_id).filter(Boolean))] as string[];
      let categoriesMap = new Map<string, LunchCategory>();

      if (categoryIds.length > 0) {
        const { data: categoriesData, error: catError } = await supabase
          .from('lunch_categories')
          .select('*')
          .in('id', categoryIds)
          .eq('school_id', effectiveSchoolId)
          .eq('is_active', true);

        if (catError) {
          console.error('❌ [V2-DEBUG] Error loading categories:', catError);
        }

        // Filter out kitchen-sale categories (POS products, not lunch menus)
        const lunchCategories = (categoriesData || []).filter(
          (cat: any) => cat.is_kitchen_sale !== true
        );

        console.log(`📦 [V2-DEBUG] Categories: ${categoriesData?.length || 0} total, ${lunchCategories.length} after filtering (removed kitchen_sale & inactive)`);
        lunchCategories.forEach((cat: any) => {
          console.log(`  📂 Category: ${cat.name} | school_id: ${cat.school_id} | target: ${cat.target_type} | active: ${cat.is_active} | kitchen: ${cat.is_kitchen_sale}`);
          categoriesMap.set(cat.id, cat);
        });
      }

      // Build menus map - skip menus whose categories don't belong to this school
      const menusMap = new Map<string, LunchMenu[]>();
      let menusIncluded = 0;
      let menusSkipped = 0;
      (menusData || []).forEach(menu => {
        if (menu.category_id && !categoriesMap.has(menu.category_id)) {
          menusSkipped++;
          return;
        }

        menusIncluded++;
        const menuWithCat = {
          ...menu,
          category: menu.category_id ? categoriesMap.get(menu.category_id) || null : null
        };
        const existing = menusMap.get(menu.date) || [];
        existing.push(menuWithCat);
        menusMap.set(menu.date, existing);
      });
      console.log(`🍽️ [V2-DEBUG] Menus: ${menusIncluded} included, ${menusSkipped} skipped (category not in school). Days with menus: ${menusMap.size}`);
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
          .select('id, order_date, status, category_id, quantity, is_cancelled, created_at, created_by, delivered_by, cancelled_by')
          .eq(personField, personId)
          .gte('order_date', startStr)
          .lte('order_date', endStr)
          .order('created_at', { ascending: false });

        const orders: ExistingOrder[] = (ordersData || []).map(o => ({
          id: o.id,
          date: o.order_date,
          categoryName: o.category_id ? categoriesMap.get(o.category_id)?.name || null : null,
          categoryId: o.category_id,
          quantity: o.quantity || 1,
          status: o.status,
          is_cancelled: o.is_cancelled || false,
          created_at: o.created_at,
          created_by: o.created_by,
          delivered_by: o.delivered_by,
          cancelled_by: o.cancelled_by
        }));
        setExistingOrders(orders);
      }

    } catch (error: any) {
      console.error('❌ [UnifiedCalendarV2] Error:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos del mes' });
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // DEADLINE VALIDATION - COMPLETELY FIXED
  // ==========================================

  /**
   * Checks if ordering is allowed for a given date.
   * Both getPeruNow() and the deadline Date use the same "fake local" timezone frame,
   * so the comparison is always correct regardless of the user's actual timezone.
   */
  const canOrderForDate = useCallback((dateStr: string): { canOrder: boolean; reason?: string } => {
    if (!config) {
      console.log(`🔓 [V2-DEADLINE] ${dateStr}: No config → allowed`);
      return { canOrder: true };
    }
    if (!config.orders_enabled) return { canOrder: false, reason: 'Pedidos deshabilitados' };
    if (!config.order_deadline_time) {
      console.log(`🔓 [V2-DEADLINE] ${dateStr}: No deadline time → allowed`);
      return { canOrder: true };
    }

    const peruNow = getPeruNow();
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = config.order_deadline_time.split(':').map(Number);
    const deadlineDays = config.order_deadline_days ?? 0;

    // Deadline: (target day - deadlineDays) at HH:MM
    // Example: target = Feb 12, deadlineDays = 0, time = 10:30
    //   → deadline = Feb 12 at 10:30
    // Example: target = Feb 12, deadlineDays = 1, time = 20:00
    //   → deadline = Feb 11 at 20:00
    const deadlineDate = new Date(year, month - 1, day - deadlineDays, hours, minutes, 0, 0);

    const canOrder = peruNow <= deadlineDate;
    console.log(`🔍 [V2-DEADLINE] ${dateStr}: peruNow=${format(peruNow, 'dd/MM HH:mm')} | deadline=${format(deadlineDate, 'dd/MM HH:mm')} (days=${deadlineDays}, time=${config.order_deadline_time}) | canOrder=${canOrder}`);

    if (!canOrder) {
      // Show user-friendly message with the exact deadline
      const deadlineDateFormatted = format(deadlineDate, "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es });
      return {
        canOrder: false,
        reason: `El plazo venció el ${deadlineDateFormatted}. Config: ${deadlineDays}d antes a las ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
      };
    }

    return { canOrder: true };
  }, [config]);

  /**
   * Checks if cancellation is allowed for a given date.
   * Uses cancellation_deadline_time and cancellation_deadline_days from config.
   */
  const canCancelForDate = useCallback((dateStr: string): boolean => {
    if (!config?.cancellation_deadline_time) return false;

    const peruNow = getPeruNow();
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = config.cancellation_deadline_time.split(':').map(Number);
    const cancelDays = config.cancellation_deadline_days || 0;

    const cancelDeadline = new Date(year, month - 1, day - cancelDays, hours, minutes, 0, 0);
    return peruNow <= cancelDeadline;
  }, [config]);

  // ==========================================
  // MULTI-DAY SELECTION
  // ==========================================

  const toggleDateSelection = (dateStr: string) => {
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  const handleDateClick = (dateStr: string) => {
    // Days with existing orders → open view modal
    const dayOrders = existingOrders.filter(o => o.date === dateStr && !o.is_cancelled);
    if (dayOrders.length > 0) {
      setViewOrdersDate(dateStr);
      setViewOrdersModal(true);
      return;
    }

    // Special days → info toast
    if (specialDays.has(dateStr)) {
      toast({ title: 'Día especial', description: specialDays.get(dateStr)?.title || 'No disponible' });
      return;
    }

    // No menus → ignore
    if (!menus.has(dateStr)) return;

    // Check deadline
    const validation = canOrderForDate(dateStr);
    if (!validation.canOrder) {
      toast({ title: '🔒 Bloqueado', description: validation.reason || 'No se puede pedir', variant: 'destructive' });
      return;
    }

    // Toggle selection
    toggleDateSelection(dateStr);
  };

  // ==========================================
  // WIZARD FLOW (MULTI-DAY SEQUENTIAL)
  // ==========================================

  const startWizard = (dates?: string[]) => {
    const datesToProcess = dates || Array.from(selectedDates).sort();
    if (datesToProcess.length === 0) return;

    setWizardDates(datesToProcess);
    setWizardCurrentIndex(0);
    setWizardStep('category');
    setSelectedCategory(null);
    setSelectedMenu(null);
    setQuantity(1);
    setOrdersCreated(0);
  };

  const handleCategorySelect = (category: LunchCategory) => {
    setSelectedCategory(category);

    const currentDateStr = wizardDates[wizardCurrentIndex];
    const dayMenus = menus.get(currentDateStr) || [];
    const categoryMenus = dayMenus.filter(m => m.category_id === category.id);

    // Auto-select first menu (most days have 1 menu per category)
    if (categoryMenus.length >= 1) {
      setSelectedMenu(categoryMenus[0]);
    }
    setWizardStep('confirm');
  };

  const handleConfirmOrder = async () => {
    if (!config || !selectedCategory || !selectedMenu) return;

    const currentDateStr = wizardDates[wizardCurrentIndex];
    setSubmitting(true);

    try {
      const personField = userType === 'parent' ? 'student_id' : 'teacher_id';
      const personId = userType === 'parent' ? selectedStudent?.id : userId;

      if (!personId) throw new Error('No se encontró el usuario');

      const unitPrice = selectedCategory.price || config.lunch_price;

      // 1. Create lunch_order
      const { data: insertedOrder, error: orderError } = await supabase
        .from('lunch_orders')
        .insert([{
          [personField]: personId,
          order_date: currentDateStr,
          status: 'pending',
          category_id: selectedCategory.id,
          menu_id: selectedMenu.id,
          school_id: effectiveSchoolId,
          quantity,
          base_price: unitPrice,
          addons_total: 0,
          final_price: unitPrice * quantity,
          created_by: userId,
        }])
        .select('id')
        .single();

      if (orderError) throw orderError;

      // 2. Create transaction (pending)
      const dateFormatted = format(getPeruDateOnly(currentDateStr), "d 'de' MMMM", { locale: es });
      const description = `Almuerzo - ${selectedCategory.name} - ${dateFormatted}`;

      // 🎫 Generar ticket_code
      let ticketCode: string | null = null;
      try {
        const { data: ticketNumber, error: ticketErr } = await supabase
          .rpc('get_next_ticket_number', { p_user_id: userId });
        if (!ticketErr && ticketNumber) {
          ticketCode = ticketNumber;
        }
      } catch (err) {
        console.warn('⚠️ No se pudo generar ticket_code:', err);
      }

      const { error: txError } = await supabase
        .from('transactions')
        .insert([{
          [personField]: personId,
          type: 'purchase',
          amount: -Math.abs(unitPrice * quantity),
          description,
          payment_status: 'pending',
          payment_method: null,
          school_id: effectiveSchoolId,
          created_by: userId,
          ticket_code: ticketCode,
          metadata: {
            lunch_order_id: insertedOrder.id,
            source: `unified_calendar_v2_${userType}`,
            order_date: currentDateStr,
            category_name: selectedCategory.name,
            quantity,
          }
        }]);

      if (txError) console.error('❌ Error creating transaction:', txError);

      const newCount = ordersCreated + 1;
      setOrdersCreated(newCount);

      toast({
        title: '✅ Pedido registrado',
        description: `${quantity}x ${selectedCategory.name} - ${dateFormatted}`,
      });

      // Advance to next day or finish
      const nextIndex = wizardCurrentIndex + 1;
      if (nextIndex < wizardDates.length) {
        setWizardCurrentIndex(nextIndex);
        setWizardStep('category');
        setSelectedCategory(null);
        setSelectedMenu(null);
        setQuantity(1);
      } else {
        setWizardStep('done');
      }

    } catch (error: any) {
      console.error('❌ Error confirmando pedido:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo registrar el pedido' });
    } finally {
      setSubmitting(false);
    }
  };

  const closeWizard = () => {
    setWizardStep('idle');
    setWizardDates([]);
    setWizardCurrentIndex(0);
    setSelectedCategory(null);
    setSelectedMenu(null);
    setQuantity(1);
    setSelectedDates(new Set());

    // Refresh data if any orders were created
    if (ordersCreated > 0) {
      fetchMonthlyData();
    }
    setOrdersCreated(0);
  };

  // ==========================================
  // CANCEL ORDER
  // ==========================================

  const handleCancelOrder = async (orderId: string, orderDate: string) => {
    if (!canCancelForDate(orderDate)) {
      toast({ variant: 'destructive', title: '🔒 No se puede cancelar', description: 'Ya pasó el plazo de cancelación' });
      return;
    }

    setCancellingOrderId(orderId);
    try {
      // 1. Update lunch_order
      const { error: orderError } = await supabase
        .from('lunch_orders')
        .update({
          is_cancelled: true,
          status: 'cancelled',
          cancelled_by: userId,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (orderError) throw orderError;

      // 2. Update related transaction (find by metadata.lunch_order_id)
      const { error: txError } = await supabase
        .from('transactions')
        .update({ payment_status: 'cancelled' })
        .contains('metadata', { lunch_order_id: orderId });

      if (txError) console.error('⚠️ Error updating transaction:', txError);

      toast({ title: '✅ Pedido cancelado', description: 'El pedido fue anulado correctamente' });

      // Refresh data
      await fetchMonthlyData();

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo cancelar el pedido' });
    } finally {
      setCancellingOrderId(null);
    }
  };

  // ==========================================
  // CALENDAR RENDERING
  // ==========================================

  const getDayStatus = (dateStr: string): 'available' | 'has_orders' | 'special' | 'unavailable' | 'blocked' => {
    if (specialDays.has(dateStr)) return 'special';
    if (!menus.has(dateStr)) return 'unavailable';

    const validation = canOrderForDate(dateStr);
    if (!validation.canOrder) return 'blocked';

    const dayOrders = existingOrders.filter(o => o.date === dateStr && !o.is_cancelled);
    if (dayOrders.length > 0) return 'has_orders';

    return 'available';
  };

  const renderCalendar = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    const startDayOfWeek = start.getDay();
    const peruTodayStr = getPeruTodayStr();

    return (
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {WEEKDAYS.map(day => (
          <div key={day} className="text-center text-[10px] sm:text-xs font-medium text-gray-500 p-1 sm:p-2">{day}</div>
        ))}

        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {days.map(date => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const status = getDayStatus(dateStr);
          const isSelected = selectedDates.has(dateStr);
          const isToday = dateStr === peruTodayStr;
          const dayOrders = existingOrders.filter(o => o.date === dateStr && !o.is_cancelled);
          const dayMenus = menus.get(dateStr) || [];

          const isDisabled = status === 'unavailable' || status === 'special' ||
                             (status === 'blocked' && dayOrders.length === 0);

          return (
            <button
              key={dateStr}
              onClick={() => handleDateClick(dateStr)}
              disabled={isDisabled}
              className={cn(
                "aspect-square p-0.5 sm:p-1 rounded-lg border-2 transition-all relative flex flex-col items-center justify-start",
                "hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40",
                isToday && "ring-2 ring-blue-400",
                isSelected && "bg-blue-100 border-blue-500 ring-2 ring-blue-300",
                !isSelected && status === 'available' && "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                !isSelected && status === 'has_orders' && "bg-green-50 border-green-300 hover:border-green-400",
                !isSelected && status === 'special' && "bg-gray-100 border-gray-300",
                !isSelected && status === 'unavailable' && "bg-gray-50 border-gray-200",
                !isSelected && status === 'blocked' && "bg-red-50 border-red-200",
              )}
            >
              <span className={cn(
                "text-xs sm:text-sm font-medium",
                isSelected && "text-blue-700 font-bold",
                !isSelected && status === 'blocked' && "text-red-400",
                !isSelected && status === 'unavailable' && "text-gray-400",
                !isSelected && status === 'has_orders' && "text-green-700 font-bold",
              )}>
                {format(date, 'd')}
              </span>

              {isSelected && (
                <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-600 mt-0.5" />
              )}

              {!isSelected && status === 'blocked' && (
                <Lock className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-red-400 mt-0.5" />
              )}

              {!isSelected && status === 'available' && dayMenus.length > 0 && (
                <UtensilsCrossed className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-500 mt-0.5" />
              )}

              {dayOrders.length > 0 && (
                <Badge className="absolute top-0 right-0 h-3.5 w-3.5 sm:h-4 sm:w-4 p-0 flex items-center justify-center text-[8px] sm:text-[9px] bg-green-500">
                  {dayOrders.reduce((sum, o) => sum + o.quantity, 0)}
                </Badge>
              )}

              {!isSelected && dayMenus.length > 0 && status !== 'has_orders' && status !== 'blocked' && (
                <div className="flex gap-0.5 mt-0.5">
                  {Array.from(new Set(dayMenus.map(m => m.category?.color || '#3B82F6'))).slice(0, 3).map((color, idx) => (
                    <div key={idx} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
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
  // WIZARD DIALOG
  // ==========================================

  const renderWizardDialog = () => {
    if (wizardStep === 'idle') return null;

    const currentDateStr = wizardDates[wizardCurrentIndex];
    const totalDays = wizardDates.length;
    const dayMenus = currentDateStr ? (menus.get(currentDateStr) || []) : [];
    const uniqueCategories = Array.from(
      new Map(
        dayMenus
          .filter(m => m.category_id && m.category)
          .map(m => [m.category_id!, m.category!])
      ).values()
    );
    const isLastDay = wizardCurrentIndex >= totalDays - 1;

    return (
      <Dialog open={wizardStep !== 'idle'} onOpenChange={(open) => !open && closeWizard()}>
        <DialogContent className="max-w-lg sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {/* STEP: DONE */}
          {wizardStep === 'done' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-center">
                  🎉 ¡Pedidos completados!
                </DialogTitle>
                <DialogDescription className="text-center text-lg">
                  Se registraron <strong>{ordersCreated}</strong> pedido(s) correctamente
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-center mt-6">
                <Button onClick={closeWizard} size="lg" className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Cerrar
                </Button>
              </div>
            </>
          )}

          {/* STEPS: CATEGORY / CONFIRM */}
          {wizardStep !== 'done' && currentDateStr && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
                  <CalendarIcon className="h-5 w-5 text-purple-600 flex-shrink-0" />
                  <span>
                    {totalDays > 1
                      ? `Día ${wizardCurrentIndex + 1} de ${totalDays}: `
                      : 'Pedido del '}
                    {format(getPeruDateOnly(currentDateStr), "EEEE d 'de' MMMM", { locale: es })}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {wizardStep === 'category' && 'Selecciona la categoría del menú'}
                  {wizardStep === 'confirm' && 'Selecciona la cantidad y confirma tu pedido'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* STEP: Category Selection */}
                {wizardStep === 'category' && (
                  <div className="grid grid-cols-1 gap-3">
                    {uniqueCategories.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <AlertCircle className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p>No hay categorías disponibles para este día</p>
                      </div>
                    ) : (
                      uniqueCategories.map(category => {
                        const IconComponent = ICON_MAP[category.icon || 'utensils'] || UtensilsCrossed;
                        return (
                          <button
                            key={category.id}
                            onClick={() => handleCategorySelect(category)}
                            className="flex items-center gap-4 p-4 rounded-lg border-2 border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition-all text-left"
                          >
                            <div
                              className="h-12 w-12 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: (category.color || '#8B5CF6') + '20' }}
                            >
                              <IconComponent className="h-6 w-6" style={{ color: category.color || '#8B5CF6' }} />
                            </div>
                            <div className="flex-1">
                              <p className="font-bold text-lg">{category.name}</p>
                              {category.description && (
                                <p className="text-sm text-gray-600">{category.description}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-xl font-bold text-gray-900">
                                S/ {(category.price || config?.lunch_price || 0).toFixed(2)}
                              </p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* STEP: Confirm with Quantity */}
                {wizardStep === 'confirm' && selectedCategory && (
                  <div className="space-y-4">
                    <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
                      <CardContent className="p-4 space-y-2">
                        <p className="text-sm text-gray-600">Categoría:</p>
                        <p className="text-lg font-bold">{selectedCategory.name}</p>

                        {selectedMenu && (
                          <div className="border-t pt-2 mt-2">
                            <p className="text-xs text-gray-600 mb-1">Menú:</p>
                            {selectedMenu.starter && <p className="text-sm">• {selectedMenu.starter}</p>}
                            <p className="text-sm font-semibold">• {selectedMenu.main_course}</p>
                            {selectedMenu.beverage && <p className="text-sm">• {selectedMenu.beverage}</p>}
                            {selectedMenu.dessert && <p className="text-sm">• {selectedMenu.dessert}</p>}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Quantity Selector */}
                    <div className="flex items-center justify-between p-4 bg-white rounded-lg border-2">
                      <span className="font-semibold">Cantidad:</span>
                      <div className="flex items-center gap-3">
                        <Button variant="outline" size="sm" onClick={() => setQuantity(Math.max(1, quantity - 1))} disabled={quantity <= 1}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="text-2xl font-bold w-12 text-center">{quantity}</span>
                        <Button variant="outline" size="sm" onClick={() => setQuantity(Math.min(10, quantity + 1))}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Total */}
                    <div className="bg-green-50 p-4 rounded-lg border-2 border-green-300">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-900">Total:</span>
                        <span className="text-2xl font-bold text-green-700">
                          S/ {((selectedCategory.price || config?.lunch_price || 0) * quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 mt-4">
                {wizardStep === 'confirm' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setWizardStep('category');
                      setSelectedCategory(null);
                      setSelectedMenu(null);
                      setQuantity(1);
                    }}
                    disabled={submitting}
                  >
                    ← Cambiar categoría
                  </Button>
                )}
                <Button variant="ghost" onClick={closeWizard} disabled={submitting}>
                  Cancelar
                </Button>
                {wizardStep === 'confirm' && (
                  <Button
                    onClick={handleConfirmOrder}
                    disabled={submitting}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {submitting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Registrando...</>
                    ) : isLastDay ? (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />Registrar Pedido</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />Registrar y Siguiente →</>
                    )}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  };

  // ==========================================
  // VIEW EXISTING ORDERS MODAL
  // ==========================================

  const renderViewOrdersModal = () => {
    if (!viewOrdersDate) return null;

    const dayOrders = existingOrders.filter(o => o.date === viewOrdersDate);
    const activeOrders = dayOrders.filter(o => !o.is_cancelled);
    const canAddMore = canOrderForDate(viewOrdersDate).canOrder;
    const canCancel = canCancelForDate(viewOrdersDate);

    return (
      <Dialog open={viewOrdersModal} onOpenChange={setViewOrdersModal}>
        <DialogContent className="max-w-lg sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-600" />
              Pedidos del {format(getPeruDateOnly(viewOrdersDate), "EEEE d 'de' MMMM", { locale: es })}
            </DialogTitle>
            <DialogDescription>
              {activeOrders.length} pedido(s) activo(s)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            {dayOrders.length === 0 && (
              <div className="text-center py-6 text-gray-500">
                <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No hay pedidos para este día</p>
              </div>
            )}

            {dayOrders.map(order => (
              <Card key={order.id} className={cn(
                "border-2",
                order.is_cancelled ? "border-red-200 bg-red-50 opacity-60" : "border-blue-200"
              )}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-bold text-lg">{order.categoryName || 'Sin categoría'}</p>
                      <p className="text-sm text-gray-600">Cantidad: {order.quantity}</p>
                    </div>
                    <Badge className={cn(
                      order.is_cancelled && 'bg-red-500',
                      order.status === 'pending' && !order.is_cancelled && 'bg-yellow-500',
                      order.status === 'confirmed' && !order.is_cancelled && 'bg-blue-500',
                      order.status === 'delivered' && !order.is_cancelled && 'bg-green-500',
                    )}>
                      {order.is_cancelled ? 'Anulado' :
                       order.status === 'pending' ? 'Pendiente' :
                       order.status === 'confirmed' ? 'Confirmado' :
                       order.status === 'delivered' ? 'Entregado' : order.status}
                    </Badge>
                  </div>

                  <p className="text-xs text-gray-500">
                    Creado: {format(new Date(order.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                  </p>

                  {/* Cancel button - only for pending orders within cancellation deadline */}
                  {!order.is_cancelled && order.status === 'pending' && canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 text-red-600 border-red-300 hover:bg-red-50"
                      onClick={() => handleCancelOrder(order.id, order.date)}
                      disabled={cancellingOrderId === order.id}
                    >
                      {cancellingOrderId === order.id ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Cancelando...</>
                      ) : (
                        <><Trash2 className="h-3 w-3 mr-1" />Cancelar Pedido</>
                      )}
                    </Button>
                  )}

                  {!order.is_cancelled && order.status === 'pending' && !canCancel && (
                    <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      Ya pasó el plazo de cancelación
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setViewOrdersModal(false)}>
              Cerrar
            </Button>
            {canAddMore && (
              <Button
                onClick={() => {
                  setViewOrdersModal(false);
                  startWizard([viewOrdersDate!]);
                }}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Agregar Pedido
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  // Orders disabled by admin
  if (config && !config.orders_enabled) {
    return (
      <Card className="bg-amber-50 border-amber-300">
        <CardContent className="py-8 text-center">
          <Ban className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <p className="text-amber-800 font-medium text-lg">Pedidos deshabilitados</p>
          <p className="text-amber-600 text-sm mt-1">
            El administrador ha deshabilitado temporalmente los pedidos de almuerzos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* DEBUG INFO BANNER - Shows config being used (helps diagnose issues) */}
      {config && (
        <div className="text-[10px] text-gray-400 bg-gray-50 rounded px-2 py-1 flex flex-wrap gap-x-3">
          <span>🏫 Sede: {effectiveSchoolId?.substring(0, 8)}...</span>
          <span>⏰ Límite: {config.order_deadline_time?.substring(0, 5)} | {config.order_deadline_days ?? '?'}d antes</span>
          <span>🕐 Perú: {format(getPeruNow(), 'dd/MM HH:mm')}</span>
          <span>📋 Menús: {menus.size} días</span>
        </div>
      )}

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
                  className={cn("gap-2", selectedStudent?.id === student.id && "bg-purple-600 hover:bg-purple-700")}
                  onClick={() => {
                    setSelectedStudent(student);
                    setExistingOrders([]);
                    setSelectedDates(new Set());
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
            <Button variant="ghost" size="icon" onClick={() => { setCurrentDate(subMonths(currentDate, 1)); setSelectedDates(new Set()); }}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center">
              <CardTitle className="text-base sm:text-lg">
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Toca los días disponibles para seleccionarlos
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => { setCurrentDate(addMonths(currentDate, 1)); setSelectedDates(new Set()); }}>
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
              <Check className="h-3 w-3 text-blue-600" />
              <span>Seleccionado</span>
            </div>
            <div className="flex items-center gap-1">
              <Lock className="h-3 w-3 text-red-400" />
              <span>Bloqueado</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge className="h-3.5 w-3.5 p-0 flex items-center justify-center text-[7px] bg-green-500">1</Badge>
              <span>Ya pedido</span>
            </div>
          </div>

          {/* Deadline info - Enhanced with concrete example */}
          {config?.order_deadline_time && (
            <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5 border border-amber-200">
              <Clock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <div>
                <p>
                  Hora límite para pedir: <strong>{config.order_deadline_time.substring(0, 5)}</strong>
                  {(config.order_deadline_days ?? 0) > 0
                    ? <>, <strong>{config.order_deadline_days} día(s) antes</strong> del día del pedido</>
                    : <> <strong>del mismo día</strong></>
                  }
                </p>
                <p className="text-amber-600 mt-0.5">
                  {(() => {
                    const peruNow = getPeruNow();
                    const tomorrow = new Date(peruNow.getFullYear(), peruNow.getMonth(), peruNow.getDate() + 1);
                    const tomorrowStr = format(tomorrow, "EEEE d", { locale: es });
                    const deadlineDays = config.order_deadline_days ?? 0;
                    const deadlineForTomorrow = new Date(
                      tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() - deadlineDays,
                      ...config.order_deadline_time.split(':').slice(0, 2).map(Number), 0
                    );
                    return `Ej: Para pedir el ${tomorrowStr}, el límite es ${format(deadlineForTomorrow, "EEEE d 'a las' HH:mm", { locale: es })}`;
                  })()}
                </p>
              </div>
            </div>
          )}

          {/* Cancellation info */}
          {config?.cancellation_deadline_time && (
            <div className="mt-2 flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg p-2.5 border border-blue-200">
              <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Cancelar hasta: <strong>{config.cancellation_deadline_time.substring(0, 5)}</strong>
                {config.cancellation_deadline_days > 0 && <>, {config.cancellation_deadline_days} día(s) antes</>}
                {' '}del día del pedido
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* FLOATING ACTION BAR (when days are selected) */}
      {selectedDates.size > 0 && (
        <div className="sticky bottom-20 sm:bottom-24 z-30">
          <Card className="bg-gradient-to-r from-purple-600 to-blue-600 border-0 shadow-xl">
            <CardContent className="p-3 sm:p-4 flex items-center justify-between">
              <div className="text-white">
                <p className="font-bold text-sm sm:text-base">
                  {selectedDates.size} día{selectedDates.size > 1 ? 's' : ''} seleccionado{selectedDates.size > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-purple-200">
                  {Array.from(selectedDates).sort().map(d => {
                    const parts = d.split('-');
                    return parseInt(parts[2]);
                  }).join(', ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20"
                  onClick={() => setSelectedDates(new Set())}
                >
                  Limpiar
                </Button>
                <Button
                  size="sm"
                  className="bg-white text-purple-700 hover:bg-purple-50 font-bold"
                  onClick={() => startWizard()}
                >
                  Hacer Pedido
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* WIZARD DIALOG */}
      {renderWizardDialog()}

      {/* VIEW ORDERS MODAL */}
      {renderViewOrdersModal()}

      {/* EMPTY STATE */}
      {!loading && menus.size === 0 && (
        <Card className="bg-gray-50">
          <CardContent className="py-8 text-center">
            <CalendarIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No hay menús disponibles este mes</p>
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
                <li>Toca los días disponibles para seleccionarlos</li>
                <li>Presiona <strong>"Hacer Pedido"</strong> en la barra morada</li>
                <li>Elige categoría y cantidad para cada día</li>
                <li>Toca días verdes para ver o cancelar pedidos</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
