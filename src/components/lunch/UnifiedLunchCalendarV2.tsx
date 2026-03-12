import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  CreditCard as CreditCardIcon,
  PlusCircle,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
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
  onGoToCart?: () => void;
}

interface LunchCategory {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  price: number | null;
  target_type: 'students' | 'teachers' | 'both';
  menu_mode?: 'standard' | 'configurable';
}

interface ConfigPlateGroup {
  id: string;
  name: string;
  is_required: boolean;
  max_selections: number;
  options: Array<{ id: string; name: string }>;
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
  allows_modifiers?: boolean;
  garnishes?: string[];
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
  /** payment_status de la transacción vinculada (null si no tiene transacción) */
  transaction_payment_status?: string | null;
  // Selecciones del plato armado
  configurable_selections?: Array<{ group_name: string; selected?: string; selected_name?: string }> | null;
  selected_garnishes?: string[] | null;
  selected_modifiers?: Array<{ group_name: string; selected_name: string }> | null;
  parent_notes?: string | null;
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
export function UnifiedLunchCalendarV2({ userType, userId, userSchoolId, onGoToCart }: UnifiedLunchCalendarV2Props) {
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
  const [wizardStep, setWizardStep] = useState<'idle' | 'category' | 'select_menu' | 'modifiers' | 'configurable_select' | 'confirm' | 'done'>('idle');
  const [selectedCategory, setSelectedCategory] = useState<LunchCategory | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<LunchMenu | null>(null);
  const [categoryMenuOptions, setCategoryMenuOptions] = useState<LunchMenu[]>([]); // Menús disponibles para la categoría seleccionada
  const [quantity, setQuantity] = useState<number>(1);
  const [ordersCreated, setOrdersCreated] = useState<number>(0);

  // ── Modificadores (personalización) ──
  const [menuModifierGroups, setMenuModifierGroups] = useState<Array<{
    id: string; name: string; is_required: boolean; max_selections: number;
    options: Array<{ id: string; name: string; is_default: boolean }>;
  }>>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<Array<{
    group_id: string; group_name: string; selected_option_id: string; selected_name: string;
  }>>([]);
  const [modifierFavorites, setModifierFavorites] = useState<Array<{
    id: string; favorite_name: string; modifiers: any[];
  }>>([]);

  // ── Guarniciones ──
  const [availableGarnishes, setAvailableGarnishes] = useState<string[]>([]);
  const [selectedGarnishes, setSelectedGarnishes] = useState<Set<string>>(new Set());

  // ── Plato Configurable ──
  const [configPlateGroups, setConfigPlateGroups] = useState<ConfigPlateGroup[]>([]);
  const [configSelections, setConfigSelections] = useState<Array<{ group_name: string; selected: string }>>([]);

  // View existing orders modal
  const [viewOrdersModal, setViewOrdersModal] = useState(false);
  const [viewOrdersDate, setViewOrdersDate] = useState<string | null>(null);

  // Cancellation
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // Payment flow (parents only)
  const [createdOrderIds, setCreatedOrderIds] = useState<string[]>([]);
  const [createdTransactionIds, setCreatedTransactionIds] = useState<string[]>([]);
  const [totalOrderAmount, setTotalOrderAmount] = useState(0);
  const [orderDescriptions, setOrderDescriptions] = useState<string[]>([]);

  // UI State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false); // 🔒 Lock sincrónico anti doble-clic

  // ── Confirmación de cancelación ──
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ── "Pedir todo el mes" ──
  const [showBulkOrderModal, setShowBulkOrderModal] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<LunchCategory | null>(null);
  const [bulkAvailableCategories, setBulkAvailableCategories] = useState<LunchCategory[]>([]);
  const [bulkDaysCount, setBulkDaysCount] = useState(0);
  const [bulkEstimatedTotal, setBulkEstimatedTotal] = useState(0);
  const [bulkDateRange, setBulkDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [bulkMenuMode, setBulkMenuMode] = useState<'auto' | 'manual'>('auto'); // auto=aleatorio, manual=elegir cada día
  const [bulkValidDates, setBulkValidDates] = useState<string[]>([]); // cache de días válidos

  // ── Categoría pre-seleccionada del bulk (para auto-seleccionar en el wizard) ──
  const [bulkPreselectedCategory, setBulkPreselectedCategory] = useState<LunchCategory | null>(null);
  // ── Flag para permitir cambio manual de categoría (evita que el auto-select re-lance) ──
  const [skipAutoSelect, setSkipAutoSelect] = useState(false);

  // ── Observaciones del padre (solo para pedidos individuales) ──
  const [parentNotes, setParentNotes] = useState('');

  // ── Feedback visual al avanzar entre días ──
  const [showDayTransition, setShowDayTransition] = useState(false);

  // ── Nuevo diseño: Carrusel de días + pedido inline ──
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [isInlineOrdering, setIsInlineOrdering] = useState(false);
  const [showNotesField, setShowNotesField] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const expandedSectionRef = useRef<HTMLDivElement>(null);
  // Prevents stale fetch responses from overwriting newer data (race condition guard)
  const fetchGenerationRef = useRef(0);
  // Mirror ref so the inline-order useEffect always reads the latest totalOrderAmount
  const totalOrderAmountRef = useRef(0);

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

  // ⚠️ IMPORTANTE: Incluir selectedStudent?.id para que al cambiar de hijo (hermanos en la misma sede)
  // se recarguen los pedidos existentes del nuevo hijo
  useEffect(() => {
    if (effectiveSchoolId) {
      // Collapse any open inline order form when student or month changes
      setExpandedCategoryId(null);
      setIsInlineOrdering(false);
      setWizardStep('idle');
      setSelectedDay(null);
      fetchMonthlyData();
    }
  }, [currentDate, effectiveSchoolId, selectedStudent?.id]);

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
    // Increment generation so any in-flight older fetch is ignored when it resolves
    const generation = ++fetchGenerationRef.current;

    try {
      setLoading(true);
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');
      const targetType = userType === 'parent' ? 'students' : 'teachers';
      const personField = userType === 'parent' ? 'student_id' : 'teacher_id';
      const personId = userType === 'parent' ? selectedStudent?.id : userId;

      // Run independent queries in parallel for speed
      const [configResult, categoriesResult, specialResult, ordersResult] = await Promise.all([
        supabase
          .from('lunch_configuration')
          .select('lunch_price, orders_enabled, order_deadline_time, order_deadline_days, cancellation_deadline_time, cancellation_deadline_days')
          .eq('school_id', effectiveSchoolId)
          .maybeSingle(),
        supabase
          .from('lunch_categories')
          .select('*')
          .eq('school_id', effectiveSchoolId)
          .or(`target_type.eq.${targetType},target_type.eq.both`),
        supabase
          .from('special_days')
          .select('date, type, title')
          .eq('school_id', effectiveSchoolId)
          .gte('date', startStr)
          .lte('date', endStr),
        personId
          ? supabase
              .from('lunch_orders')
              .select('id, order_date, status, category_id, quantity, is_cancelled, created_at, created_by, delivered_by, cancelled_by, configurable_selections, selected_garnishes, selected_modifiers, parent_notes')
              .eq(personField, personId)
              .gte('order_date', startStr)
              .lte('order_date', endStr)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (configResult.error) console.error('Error loading config:', configResult.error);
      // Guard: if a newer fetch was triggered while awaiting, discard this stale response
      if (generation !== fetchGenerationRef.current) return;
      setConfig(configResult.data);

      if (categoriesResult.error) console.error('Error loading categories:', categoriesResult.error);

      const lunchCategories = (categoriesResult.data || []).filter(
        (cat: any) => cat.is_kitchen_sale !== true
      );

      const categoriesMap = new Map<string, LunchCategory>();
      lunchCategories.forEach((cat: any) => {
        categoriesMap.set(cat.id, { ...cat, menu_mode: cat.menu_mode || 'standard' });
      });

      // Menus query depends on categories
      const validCategoryIds = [...categoriesMap.keys()];
      let menusData: any[] = [];
      if (validCategoryIds.length > 0) {
        const { data, error: menusError } = await supabase
          .from('lunch_menus')
          .select('id, date, starter, main_course, beverage, dessert, notes, category_id, target_type, allows_modifiers, garnishes')
          .eq('school_id', effectiveSchoolId)
          .gte('date', startStr)
          .lte('date', endStr)
          .or(`category_id.in.(${validCategoryIds.join(',')}),category_id.is.null`)
          .order('date', { ascending: true });
        if (menusError) throw menusError;
        menusData = data || [];
      } else {
        const { data, error: menusError } = await supabase
          .from('lunch_menus')
          .select('id, date, starter, main_course, beverage, dessert, notes, category_id, target_type, allows_modifiers, garnishes')
          .eq('school_id', effectiveSchoolId)
          .gte('date', startStr)
          .lte('date', endStr)
          .is('category_id', null)
          .order('date', { ascending: true });
        if (menusError) throw menusError;
        menusData = data || [];
      }

      const menusMap = new Map<string, LunchMenu[]>();
      (menusData || []).forEach(menu => {
        if (menu.category_id && !categoriesMap.has(menu.category_id)) return;
        const menuWithCat = {
          ...menu,
          category: menu.category_id ? categoriesMap.get(menu.category_id) || null : null
        };
        const existing = menusMap.get(menu.date) || [];
        existing.push(menuWithCat);
        menusMap.set(menu.date, existing);
      });
      setMenus(menusMap);

      const specialMap = new Map<string, SpecialDay>();
      (specialResult.data || []).forEach(day => specialMap.set(day.date, day));
      setSpecialDays(specialMap);

      if (personId && ordersResult.data) {
        const orders: ExistingOrder[] = (ordersResult.data || []).map((o: any) => ({
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
          cancelled_by: o.cancelled_by,
          transaction_payment_status: null,
          configurable_selections: o.configurable_selections || null,
          selected_garnishes: o.selected_garnishes || null,
          selected_modifiers: o.selected_modifiers || null,
          parent_notes: o.parent_notes || null,
        }));

        if (orders.length > 0) {
          const { data: txData } = await supabase
            .from('transactions')
            .select('payment_status, metadata')
            .eq(personField, personId)
            .eq('is_deleted', false)
            .in('payment_status', ['pending', 'paid', 'cancelled', 'partial']);

          if (txData && txData.length > 0) {
            const txPaymentMap = new Map<string, string>();
            txData.forEach(tx => {
              if (tx.metadata?.lunch_order_id) {
                txPaymentMap.set(tx.metadata.lunch_order_id, tx.payment_status);
              }
            });
            orders.forEach(o => {
              o.transaction_payment_status = txPaymentMap.get(o.id) ?? null;
            });
          }
        }
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
    if (!config) return { canOrder: true };
    if (!config.orders_enabled) return { canOrder: false, reason: 'Pedidos deshabilitados' };
    if (!config.order_deadline_time) return { canOrder: true };

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
  // CAROUSEL: Auto-select today & scroll
  // ==========================================

  // Compute carousel days for current month
  const carouselDays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    const peruTodayStr = getPeruTodayStr();

    return days.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayMenus = menus.get(dateStr) || [];
      const dayOrders = existingOrders.filter(o => o.date === dateStr && !o.is_cancelled);
      const isPast = dateStr < peruTodayStr;
      const isToday = dateStr === peruTodayStr;
      const hasMenus = dayMenus.length > 0;
      const hasOrders = dayOrders.length > 0;
      const isSpecial = specialDays.has(dateStr);
      const validation = hasMenus ? canOrderForDate(dateStr) : { canOrder: false };
      const isBlocked = hasMenus && !validation.canOrder && !hasOrders;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

      return {
        date,
        dateStr,
        dayMenus,
        dayOrders,
        isPast,
        isToday,
        hasMenus,
        hasOrders,
        isSpecial,
        isBlocked,
        isWeekend,
        canOrder: validation.canOrder,
      };
    });
  }, [currentDate, menus, existingOrders, specialDays, canOrderForDate]);

  // Auto-select first available day when data loads
  useEffect(() => {
    if (!loading && menus.size > 0 && !selectedDay) {
      const peruTodayStr = getPeruTodayStr();
      const firstAvailable = carouselDays.find(d => d.dateStr >= peruTodayStr && d.hasMenus);
      if (firstAvailable) {
        setSelectedDay(firstAvailable.dateStr);
      } else if (carouselDays.length > 0) {
        // If no available day, select first with menus
        const first = carouselDays.find(d => d.hasMenus);
        if (first) setSelectedDay(first.dateStr);
      }
    }
  }, [loading, menus, carouselDays]);

  // Reset selectedDay when changing months
  useEffect(() => {
    setSelectedDay(null);
    setExpandedCategoryId(null);
    setIsInlineOrdering(false);
    setWizardStep('idle');
  }, [currentDate]);

  // Scroll carousel to selected day
  useEffect(() => {
    if (selectedDay && carouselRef.current) {
      const el = carouselRef.current.querySelector(`[data-date="${selectedDay}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedDay]);

  // Auto-scroll when a category expands (only on expand, not on every wizardStep change)
  useEffect(() => {
    if (expandedCategoryId && expandedSectionRef.current) {
      setTimeout(() => {
        expandedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }, [expandedCategoryId]); // intentionally excludes wizardStep to avoid re-scroll on every step

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({
        left: direction === 'left' ? -200 : 200,
        behavior: 'smooth',
      });
    }
  };

  // Handle carousel day click
  const handleCarouselDayClick = (dateStr: string) => {
    const dayData = carouselDays.find(d => d.dateStr === dateStr);
    if (!dayData) return;

    if (multiSelectMode) {
      // In multi-select: toggle for batch ordering
      if (dayData.hasOrders) {
        toast({ title: '📋 Ya tiene pedido', description: 'Este día ya tiene un pedido registrado.' });
        return;
      }
      if (!dayData.hasMenus) {
        toast({ title: '📭 Sin menú', description: 'No hay menú disponible para este día.' });
        return;
      }
      if (dayData.isSpecial) {
        toast({ title: '⭐ Día especial', description: 'Este día está marcado como especial y no permite pedidos.' });
        return;
      }
      if (!dayData.canOrder) {
        toast({ variant: 'destructive', title: '🔒 Plazo vencido', description: 'Ya pasó la hora límite para pedir este día.' });
        return;
      }
      toggleDateSelection(dateStr);
      setSelectedDay(dateStr);
    } else {
      // Single mode: just view menus
      if (dateStr === selectedDay && dayData.hasOrders) {
        // Double-tap on same day with orders → view orders
        setViewOrdersDate(dateStr);
        setViewOrdersModal(true);
        return;
      }
      setSelectedDay(dateStr);
      setExpandedCategoryId(null);
      setIsInlineOrdering(false);
      setWizardStep('idle');
    }
  };

  // Handle category card tap (inline ordering)
  const handleCategoryCardTap = async (category: LunchCategory) => {
    if (!selectedDay) return;

    // If already expanded, collapse
    if (expandedCategoryId === category.id && isInlineOrdering) {
      setExpandedCategoryId(null);
      setIsInlineOrdering(false);
      setWizardStep('idle');
      return;
    }

    // Check for existing orders
    const dayOrders = existingOrders.filter(o => o.date === selectedDay && !o.is_cancelled);
    const hasOrderForCategory = dayOrders.some(o => o.categoryId === category.id);
    if (hasOrderForCategory) {
      toast({ title: '⚠️ Ya tienes pedido', description: `Ya pediste "${category.name}" para este día. Toca el día para ver/cancelar.` });
      return;
    }

    // Check deadline
    const validation = canOrderForDate(selectedDay);
    if (!validation.canOrder) {
      toast({ variant: 'destructive', title: '🔒 Plazo vencido', description: validation.reason });
      return;
    }

    // Setup inline ordering
    setExpandedCategoryId(category.id);
    setIsInlineOrdering(true);

    // Setup wizard state
    setWizardDates([selectedDay]);
    setWizardCurrentIndex(0);
    setCreatedOrderIds([]);
    setCreatedTransactionIds([]);
    setTotalOrderAmount(0);
    setOrderDescriptions([]);
    setSelectedMenu(null);
    setQuantity(1);
    setMenuModifierGroups([]);
    setSelectedModifiers([]);
    setModifierFavorites([]);
    setParentNotes('');
    setShowNotesField(false);
    setBulkPreselectedCategory(null);
    setShowDayTransition(false);
    setOrdersCreated(0);

    // handleCategorySelect sets wizardStep and loads data
    await handleCategorySelect(category);
  };

  // Handle direct menu tap (skip category step - go straight to menu/confirm)
  const handleDirectMenuTap = async (category: LunchCategory, menu: LunchMenu) => {
    if (!selectedDay) return;

    // If same menu already expanded, collapse
    if (expandedCategoryId === category.id && isInlineOrdering) {
      setExpandedCategoryId(null);
      setIsInlineOrdering(false);
      setWizardStep('idle');
      return;
    }

    const dayOrders = existingOrders.filter(o => o.date === selectedDay && !o.is_cancelled);
    const hasOrderForCategory = dayOrders.some(o => o.categoryId === category.id);
    if (hasOrderForCategory) {
      toast({ title: '⚠️ Ya tienes pedido', description: `Ya pediste "${category.name}" para este día.` });
      return;
    }

    const validation = canOrderForDate(selectedDay);
    if (!validation.canOrder) {
      toast({ variant: 'destructive', title: '🔒 Plazo vencido', description: validation.reason });
      return;
    }

    setExpandedCategoryId(category.id);
    setIsInlineOrdering(true);
    setWizardDates([selectedDay]);
    setWizardCurrentIndex(0);
    setCreatedOrderIds([]);
    setCreatedTransactionIds([]);
    setTotalOrderAmount(0);
    setOrderDescriptions([]);
    setQuantity(1);
    setMenuModifierGroups([]);
    setSelectedModifiers([]);
    setModifierFavorites([]);
    setParentNotes('');
    setShowNotesField(false);
    setBulkPreselectedCategory(null);
    setShowDayTransition(false);
    setOrdersCreated(0);

    // Set category context
    setSelectedCategory(category);
    setSkipAutoSelect(true);

    // Jump straight to menu selection (skipping category step)
    await handleMenuSelect(menu);
  };

  // Handle inline order success → close wizard (NO abrir pago automáticamente)
  useEffect(() => {
    if (isInlineOrdering && wizardStep === 'done' && ordersCreated > 0) {
      const timer = setTimeout(() => {
        // Capture amount BEFORE resetting the ref
        const pendingAmount = totalOrderAmountRef.current;

        setExpandedCategoryId(null);
        setIsInlineOrdering(false);
        setWizardStep('idle');
        setWizardDates([]);
        setSelectedDates(new Set());
        // Do NOT reset totalOrderAmount / createdOrderIds here — the payment banner stays visible
        fetchMonthlyData();

        if (userType === 'parent' && pendingAmount > 0) {
          toast({
            title: '✅ Pedido agregado',
            description: `Puedes seguir eligiendo días o pagar S/ ${pendingAmount.toFixed(2)} ahora.`,
            duration: 4000,
          });
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isInlineOrdering, wizardStep, ordersCreated]);

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

  const startWizard = (dates?: string[], preselectedCategory?: LunchCategory | null) => {
    const datesToProcess = dates || Array.from(selectedDates).sort();
    if (datesToProcess.length === 0) return;

    setWizardDates(datesToProcess);
    setWizardCurrentIndex(0);
    setCreatedOrderIds([]);
    setTotalOrderAmount(0);
    setOrderDescriptions([]);
    setSelectedMenu(null);
    setQuantity(1);
    setOrdersCreated(0);
    setMenuModifierGroups([]);
    setSelectedModifiers([]);
    setModifierFavorites([]);
    setShowDayTransition(false);

    // Si hay categoría pre-seleccionada (desde "Pedir todo el mes"), guardarla
    if (preselectedCategory) {
      setBulkPreselectedCategory(preselectedCategory);
      setSelectedCategory(null);
      setWizardStep('category'); // Se auto-seleccionará en el useEffect
    } else {
      setBulkPreselectedCategory(null);
      setSelectedCategory(null);
      setWizardStep('category');
    }
  };

  // ── Auto-seleccionar categoría cuando hay bulk pre-seleccionada ──
  useEffect(() => {
    if (wizardStep !== 'category' || !bulkPreselectedCategory) return;
    // Si el usuario pidió cambiar categoría manualmente, NO auto-seleccionar
    if (skipAutoSelect) return;

    const currentDateStr = wizardDates[wizardCurrentIndex];
    if (!currentDateStr) return;

    const dayMenus = menus.get(currentDateStr) || [];
    const hasCategoryMenu = dayMenus.some(m => m.category_id === bulkPreselectedCategory.id);

    if (hasCategoryMenu) {
      // Auto-seleccionar la categoría del bulk para este día
      // Pequeño delay para que el render muestre el día antes de avanzar
      const timer = setTimeout(() => {
        handleCategorySelect(bulkPreselectedCategory);
      }, bulkMenuMode === 'auto' ? 100 : 0);
      return () => clearTimeout(timer);
    }
  }, [wizardStep, wizardCurrentIndex, bulkPreselectedCategory, skipAutoSelect]);

  // ── Auto-avanzar en modo automático (bulk "rápido") ──
  useEffect(() => {
    if (bulkMenuMode !== 'auto' || !bulkPreselectedCategory) return;

    // 1. select_menu → seleccionar el primer menú disponible
    if (wizardStep === 'select_menu' && categoryMenuOptions.length > 0) {
      handleMenuSelect(categoryMenuOptions[0]);
      return;
    }

    // 2. modifiers → saltar con las selecciones por defecto ya pre-cargadas
    if (wizardStep === 'modifiers' && selectedMenu && !submitting) {
      const timer = setTimeout(() => {
        setWizardStep('confirm');
      }, 150);
      return () => clearTimeout(timer);
    }

    // 3. configurable_select → saltar con las selecciones por defecto ya pre-cargadas
    if (wizardStep === 'configurable_select' && selectedMenu && !submitting) {
      const timer = setTimeout(() => {
        setWizardStep('confirm');
      }, 150);
      return () => clearTimeout(timer);
    }

    // 4. confirm → confirmar automáticamente
    if (wizardStep === 'confirm' && selectedMenu && !submitting) {
      const timer = setTimeout(() => {
        handleConfirmOrder();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [wizardStep, bulkMenuMode, bulkPreselectedCategory, categoryMenuOptions, selectedMenu, submitting]);

  // ── Cargar modificadores de un menú ──
  const loadMenuModifiers = async (menuId: string): Promise<boolean> => {
    try {
      const { data: groups, error } = await supabase
        .from('menu_modifier_groups')
        .select('id, name, is_required, max_selections')
        .eq('menu_id', menuId)
        .order('display_order', { ascending: true });

      if (error || !groups || groups.length === 0) {
        setMenuModifierGroups([]);
        return false;
      }

      const groupIds = groups.map(g => g.id);
      const { data: options } = await supabase
        .from('menu_modifier_options')
        .select('id, group_id, name, is_default')
        .in('group_id', groupIds)
        .order('display_order', { ascending: true });

      const enrichedGroups = groups.map(g => ({
        ...g,
        options: (options || []).filter(o => o.group_id === g.id),
      }));

      setMenuModifierGroups(enrichedGroups);

      // Pre-seleccionar opciones por defecto
      const defaults = enrichedGroups.map(g => {
        const defaultOpt = g.options.find(o => o.is_default) || g.options[0];
        return {
          group_id: g.id,
          group_name: g.name,
          selected_option_id: defaultOpt?.id || '',
          selected_name: defaultOpt?.name || '',
        };
      });
      setSelectedModifiers(defaults);

      return true;
    } catch (err) {
      console.error('Error loading menu modifiers:', err);
      return false;
    }
  };

  // ── Cargar favoritos del usuario para una categoría ──
  const loadFavorites = async (categoryId: string) => {
    try {
      const personId = userType === 'parent' ? selectedStudent?.id : userId;
      let query = supabase
        .from('modifier_favorites')
        .select('id, favorite_name, modifiers')
        .eq('user_id', userId)
        .eq('category_id', categoryId)
        .order('use_count', { ascending: false })
        .limit(5);

      if (userType === 'parent' && personId) {
        query = query.eq('student_id', personId);
      }

      const { data } = await query;
      setModifierFavorites(data || []);
    } catch (err) {
      console.error('Error loading favorites:', err);
    }
  };

  // ── Aplicar un favorito ──
  const applyFavorite = (favorite: { id: string; modifiers: any[] }) => {
    setSelectedModifiers(favorite.modifiers);
  };

  // ── Guardar como favorito ──
  const saveAsFavorite = async () => {
    if (!selectedCategory || selectedModifiers.length === 0) return;
    try {
      const personId = userType === 'parent' ? selectedStudent?.id : null;
      await supabase.from('modifier_favorites').insert({
        user_id: userId,
        student_id: personId,
        category_id: selectedCategory.id,
        favorite_name: 'Mi Favorito',
        modifiers: selectedModifiers,
      });
      toast({ title: '⭐ Favorito guardado', description: 'Se usará como sugerencia la próxima vez' });
      if (selectedCategory) loadFavorites(selectedCategory.id);
    } catch (err) {
      console.error('Error saving favorite:', err);
    }
  };

  const handleCategorySelect = async (category: LunchCategory) => {
    setSelectedCategory(category);
    // Resetear flag de cambio manual — el usuario ya eligió, para los días siguientes
    // el auto-select puede funcionar normalmente
    if (skipAutoSelect) setSkipAutoSelect(false);

    // ── Plato Configurable: flujo especial ──
    if (category.menu_mode === 'configurable') {
      const currentDateStr = wizardDates[wizardCurrentIndex];
      const dayMenus = menus.get(currentDateStr) || [];
      const categoryMenus = dayMenus.filter(m => m.category_id === category.id);
      
      // Auto-seleccionar el primer menú (es un placeholder)
      if (categoryMenus.length > 0) {
        setSelectedMenu(categoryMenus[0]);
      } else {
        // Si no hay menú para este día en esta categoría, no se puede pedir
        toast({ variant: 'destructive', title: '⚠️ Sin menú', description: `No hay menú disponible para "${category.name}" este día` });
        return;
      }

      // 🧹 Limpiar estados de modifiers/garnishes (no aplican para plato configurable)
      setMenuModifierGroups([]);
      setSelectedModifiers([]);
      setModifierFavorites([]);
      setAvailableGarnishes([]);
      setSelectedGarnishes(new Set());

      // Cargar grupos de opciones configurables
      await loadConfigurableGroups(category.id);
      setWizardStep('configurable_select');
      return;
    }

    // ── Categoría estándar: flujo normal ──
    const currentDateStr = wizardDates[wizardCurrentIndex];
    const dayMenus = menus.get(currentDateStr) || [];
    const categoryMenus = dayMenus.filter(m => m.category_id === category.id);

    setCategoryMenuOptions(categoryMenus);

    if (categoryMenus.length === 1) {
      // Solo 1 menú → mostrar detalle para que el padre lo vea antes de confirmar
      setSelectedMenu(null);
      setWizardStep('select_menu');
    } else if (categoryMenus.length > 1) {
      // Múltiples menús → mostrar paso de selección
      setSelectedMenu(null);
      setWizardStep('select_menu');
    }
  };

  // ── Cargar opciones configurables de la categoría ──
  const loadConfigurableGroups = async (categoryId: string) => {
    try {
      const { data: groups } = await supabase
        .from('configurable_plate_groups')
        .select('id, name, is_required, max_selections')
        .eq('category_id', categoryId)
        .order('display_order', { ascending: true });

      if (!groups || groups.length === 0) {
        setConfigPlateGroups([]);
        setConfigSelections([]);
        return;
      }

      const groupIds = groups.map(g => g.id);
      const { data: options } = await supabase
        .from('configurable_plate_options')
        .select('id, group_id, name')
        .in('group_id', groupIds)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      const fullGroups: ConfigPlateGroup[] = groups.map(g => ({
        ...g,
        options: (options || []).filter(o => o.group_id === g.id),
      }));

      setConfigPlateGroups(fullGroups);
      // Inicializar selecciones: single-select pre-selecciona la primera, multi-select empieza vacío
      setConfigSelections(fullGroups.map(g => ({
        group_name: g.name,
        selected: (g.max_selections || 1) > 1
          ? '' // Multi-select: empieza sin selección
          : (g.options.length > 0 ? g.options[0].name : ''),
      })));
    } catch (err) {
      console.error('Error loading configurable groups:', err);
      setConfigPlateGroups([]);
      setConfigSelections([]);
    }
  };

  const handleMenuSelect = async (menu: LunchMenu) => {
    setSelectedMenu(menu);

    // Cargar guarniciones disponibles
    const garnishes = (menu.garnishes as string[]) || [];
    setAvailableGarnishes(garnishes);
    setSelectedGarnishes(new Set()); // Reset selección

    // ¿Tiene modificadores habilitados?
    if (menu.allows_modifiers) {
      const hasGroups = await loadMenuModifiers(menu.id);
      if (hasGroups) {
        if (selectedCategory) await loadFavorites(selectedCategory.id);
        setWizardStep('modifiers');
        return;
      }
    }
    setMenuModifierGroups([]);
    setSelectedModifiers([]);
    setWizardStep('confirm');
  };

  const handleConfirmOrder = async () => {
    if (!config || !selectedCategory || !selectedMenu) return;

    // 🔒 Lock sincrónico: previene doble-clic / doble envío
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const currentDateStr = wizardDates[wizardCurrentIndex];

    // Re-validate deadline at submit time (user may have left form open past the cutoff)
    const deadlineCheck = canOrderForDate(currentDateStr);
    if (!deadlineCheck.canOrder) {
      toast({ variant: 'destructive', title: '🔒 Plazo vencido', description: deadlineCheck.reason || 'Ya no es posible pedir para este día.' });
      setExpandedCategoryId(null);
      setIsInlineOrdering(false);
      setWizardStep('idle');
      isSubmittingRef.current = false;
      return;
    }

    setSubmitting(true);

    try {
      const personField = userType === 'parent' ? 'student_id' : 'teacher_id';
      const personId = userType === 'parent' ? selectedStudent?.id : userId;

      if (!personId) throw new Error('No se encontró el usuario');

      // ── Verificar si ya existe un pedido activo para esta categoría + fecha ──
      const { data: existingOrder } = await supabase
        .from('lunch_orders')
        .select('id')
        .eq(personField, personId)
        .eq('order_date', currentDateStr)
        .eq('category_id', selectedCategory.id)
        .eq('is_cancelled', false)
        .maybeSingle();

      if (existingOrder) {
        toast({
          variant: 'destructive',
          title: '⚠️ Pedido duplicado',
          description: `Ya tienes un pedido de "${selectedCategory.name}" para este día. Puedes cancelarlo primero si deseas cambiarlo.`,
        });
        setSubmitting(false);
        isSubmittingRef.current = false;
        return;
      }

      const unitPrice = selectedCategory.price || config.lunch_price;

      // 1. Create lunch_order (con modificadores si los hay)
      // Solo incluir columnas opcionales si tienen datos (evita error si la migración no se ejecutó)
      const orderPayload: Record<string, any> = {
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
      };
      if (selectedModifiers.length > 0) {
        orderPayload.selected_modifiers = selectedModifiers;
      }
      if (selectedGarnishes.size > 0) {
        orderPayload.selected_garnishes = Array.from(selectedGarnishes);
      }
      if (configSelections.length > 0) {
        orderPayload.configurable_selections = configSelections;
      }
      // Solo agregar observaciones del padre si es pedido individual (no bulk)
      if (parentNotes.trim() && wizardDates.length <= 1) {
        orderPayload.parent_notes = parentNotes.trim();
      }

      let insertedOrder: { id: string } | null = null;

      // Intentar insertar con columnas opcionales
      const { data: orderData, error: orderError } = await supabase
        .from('lunch_orders')
        .insert([orderPayload])
        .select('id')
        .single();

      if (orderError) {
        // Handle unique constraint violation gracefully
        if (orderError.code === '23505') {
          toast({
            variant: 'destructive',
            title: '⚠️ Pedido duplicado',
            description: `Ya existe un pedido para esta categoría en este día.`,
          });
          setSubmitting(false);
          isSubmittingRef.current = false;
          return;
        }

        // 🔧 Si falla por columna no encontrada (migración no ejecutada), reintentar sin columnas opcionales
        if (orderError.code === 'PGRST204' || orderError.message?.includes('column')) {
          delete orderPayload.selected_modifiers;
          delete orderPayload.selected_garnishes;
          delete orderPayload.configurable_selections;

          const { data: retryData, error: retryError } = await supabase
            .from('lunch_orders')
            .insert([orderPayload])
            .select('id')
            .single();

          if (retryError) {
            if (retryError.code === '23505') {
              toast({ variant: 'destructive', title: '⚠️ Pedido duplicado', description: 'Ya existe un pedido para esta categoría en este día.' });
              setSubmitting(false);
              isSubmittingRef.current = false;
              return;
            }
            throw retryError;
          }
          insertedOrder = retryData;
        } else {
          throw orderError;
        }
      } else {
        insertedOrder = orderData;
      }

      if (!insertedOrder) throw new Error('No se pudo crear el pedido');

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
        // ticket_code generation failed silently
      }

      const { data: txData, error: txError } = await supabase
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
        }])
        .select('id')
        .single();

      if (txError) console.error('❌ Error creating transaction:', txError);

      const newCount = ordersCreated + 1;
      setOrdersCreated(newCount);

      // Track for payment (parents) — incluir tanto order IDs como transaction IDs
      if (userType === 'parent' && insertedOrder?.id) {
        setCreatedOrderIds(prev => [...prev, insertedOrder.id]);
        if (txData?.id) setCreatedTransactionIds(prev => [...prev, txData.id]);
        setTotalOrderAmount(prev => {
          const next = prev + (unitPrice * quantity);
          totalOrderAmountRef.current = next;
          return next;
        });
        setOrderDescriptions(prev => [...prev, `${quantity}x ${selectedCategory.name} - ${dateFormatted}`]);
      }

      toast({
        title: userType === 'parent' ? '✅ Agregado' : '✅ Pedido registrado',
        description: `${quantity}x ${selectedCategory.name} - ${dateFormatted}`,
      });

      // ── Auto-guardar progreso al confirmar cada pedido (por si refresca la página) ──
      if (selectedStudent) {
        const nextIndex2 = wizardCurrentIndex + 1;
        const remainingDates = wizardDates.slice(nextIndex2);
        if (remainingDates.length > 0) {
          const progress = {
            dates: remainingDates,
            studentId: selectedStudent.id,
            ordersCreatedSoFar: newCount,
            createdOrderIds: [...createdOrderIds, ...(insertedOrder?.id ? [insertedOrder.id] : [])],
            createdTransactionIds: [...createdTransactionIds, ...(txData?.id ? [txData.id] : [])],
            totalOrderAmount: totalOrderAmount + (unitPrice * quantity),
            orderDescriptions: [...orderDescriptions, `${quantity}x ${selectedCategory.name} - ${dateFormatted}`],
            savedAt: new Date().toISOString(),
            bulkCategory: bulkPreselectedCategory ?? null,
            bulkMenuMode: bulkPreselectedCategory ? bulkMenuMode : null,
          };
          sessionStorage.setItem(`lunch_wizard_${selectedStudent.id}`, JSON.stringify(progress));
        }
      }

      // Advance to next day or finish
      const nextIndex = wizardCurrentIndex + 1;
      if (nextIndex < wizardDates.length) {
        // Feedback visual: mostrar transición entre días
        setShowDayTransition(true);
        setTimeout(() => {
          setWizardCurrentIndex(nextIndex);
          setWizardStep('category');
          setSelectedCategory(null);
          setSelectedMenu(null);
          setCategoryMenuOptions([]);
          setQuantity(1);
          setMenuModifierGroups([]);
          setSelectedModifiers([]);
          setModifierFavorites([]);
          setAvailableGarnishes([]);
          setSelectedGarnishes(new Set());
          setConfigPlateGroups([]);
          setConfigSelections([]);
          setShowDayTransition(false);
        }, 600); // Breve pausa visual
      } else {
        setWizardStep('done');
      }

    } catch (error: any) {
      console.error('❌ Error confirmando pedido:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo registrar el pedido' });
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false; // 🔓 Liberar lock
    }
  };

  const closeWizard = () => {
    // Limpiar progreso guardado
    if (selectedStudent) {
      sessionStorage.removeItem(`lunch_wizard_${selectedStudent.id}`);
    }

    setWizardStep('idle');
    setWizardDates([]);
    setWizardCurrentIndex(0);
    setSelectedCategory(null);
    setSelectedMenu(null);
    setCategoryMenuOptions([]);
    setQuantity(1);
    setSelectedDates(new Set());
    setMenuModifierGroups([]);
    setSelectedModifiers([]);
    setModifierFavorites([]);
    setAvailableGarnishes([]);
    setSelectedGarnishes(new Set());
    setConfigPlateGroups([]);
    setConfigSelections([]);
    setParentNotes('');
    setShowCancelConfirm(false);
    setBulkPreselectedCategory(null);
    setShowDayTransition(false);

      // Refresh data if any orders were created
    if (ordersCreated > 0) {
      fetchMonthlyData();
    }
    setOrdersCreated(0);
    // Limpiar progreso guardado al cerrar correctamente
    if (selectedStudent) {
      sessionStorage.removeItem(`lunch_wizard_${selectedStudent.id}`);
    }
  };

  // ── Guardar progreso para "Continuar después" ──
  const saveWizardProgress = () => {
    if (!selectedStudent) return;
    const remainingDates = wizardDates.slice(wizardCurrentIndex);
    if (remainingDates.length === 0) return;

    const progress = {
      dates: remainingDates,
      studentId: selectedStudent.id,
      ordersCreatedSoFar: ordersCreated,
      createdOrderIds,
      createdTransactionIds,
      totalOrderAmount,
      orderDescriptions,
      savedAt: new Date().toISOString(),
      // ── Datos del bulk order para restaurar modo automático ──
      bulkCategory: bulkPreselectedCategory ?? null,
      bulkMenuMode: bulkPreselectedCategory ? bulkMenuMode : null,
    };
    sessionStorage.setItem(`lunch_wizard_${selectedStudent.id}`, JSON.stringify(progress));
  };

  // ── Restaurar progreso guardado ──
  const restoreWizardProgress = () => {
    if (!selectedStudent) return false;
    const saved = sessionStorage.getItem(`lunch_wizard_${selectedStudent.id}`);
    if (!saved) return false;

    try {
      const progress = JSON.parse(saved);
      // Verificar que no sea muy viejo (max 24h)
      const savedAt = new Date(progress.savedAt);
      const hoursDiff = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
      if (hoursDiff > 24) {
        sessionStorage.removeItem(`lunch_wizard_${selectedStudent.id}`);
        return false;
      }

      // Filtrar solo fechas que aún se pueden pedir
      const validDates = (progress.dates as string[]).filter(d => canOrderForDate(d).canOrder);
      if (validDates.length === 0) {
        sessionStorage.removeItem(`lunch_wizard_${selectedStudent.id}`);
        return false;
      }

      setWizardDates(validDates);
      setWizardCurrentIndex(0);
      setWizardStep('category');
      setSelectedCategory(null);
      setSelectedMenu(null);
      setCategoryMenuOptions([]);
      setQuantity(1);
      setOrdersCreated(progress.ordersCreatedSoFar || 0);
      setCreatedOrderIds(progress.createdOrderIds || []);
      setCreatedTransactionIds(progress.createdTransactionIds || []);
      setTotalOrderAmount(progress.totalOrderAmount || 0);
      setOrderDescriptions(progress.orderDescriptions || []);

      // ── Restaurar modo bulk (automático/manual) si era un pedido de todo el mes ──
      if (progress.bulkCategory) {
        setBulkPreselectedCategory(progress.bulkCategory);
        setBulkMenuMode(progress.bulkMenuMode || 'manual');
      } else {
        setBulkPreselectedCategory(null);
        setBulkMenuMode('auto');
      }

      return true;
    } catch {
      sessionStorage.removeItem(`lunch_wizard_${selectedStudent.id}`);
      return false;
    }
  };

  // ── Manejar intento de cancelar el wizard ──
  const handleCancelWizard = () => {
    // Si ya se crearon pedidos o hay progreso, mostrar confirmación
    if (ordersCreated > 0 || wizardCurrentIndex > 0) {
      setShowCancelConfirm(true);
    } else {
      closeWizard();
    }
  };

  // ── Continuar después: guardar y cerrar ──
  const handleContinueLater = () => {
    saveWizardProgress();
    setShowCancelConfirm(false);

    // Si hay pedidos ya creados, mostrar el modal de pago
    if (ordersCreated > 0 && userType === 'parent' && totalOrderAmount > 0) {
      setWizardStep('done');
    } else {
      setWizardStep('idle');
      setWizardDates([]);
      setWizardCurrentIndex(0);
      setSelectedDates(new Set());
      if (ordersCreated > 0) fetchMonthlyData();
      setOrdersCreated(0);
      toast({
        title: '💾 Progreso guardado',
        description: 'Puedes continuar con tu pedido cuando quieras.',
      });
    }
  };

  // ── "Pedir todo el mes" — calcula días disponibles una sola vez ──
  const getAvailableBulkDates = useCallback(() => {
    const peruTodayStr = getPeruTodayStr();
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });

    const availableDates: string[] = [];
    const categoriesSet = new Map<string, LunchCategory>();

    for (const date of days) {
      const dateStr = format(date, 'yyyy-MM-dd');
      if (dateStr < peruTodayStr) continue;
      const dayMenus = menus.get(dateStr);
      if (!dayMenus || dayMenus.length === 0) continue;
      if (existingOrders.some(o => o.date === dateStr && !o.is_cancelled)) continue;
      if (!canOrderForDate(dateStr).canOrder) continue;
      if (specialDays.has(dateStr)) continue;

      availableDates.push(dateStr);
      dayMenus.forEach(m => {
        if (m.category_id && m.category) categoriesSet.set(m.category_id, m.category);
      });
    }
    return { availableDates, categories: Array.from(categoriesSet.values()) };
  }, [currentDate, menus, existingOrders, canOrderForDate, specialDays]);

  const handleBulkOrderMonth = () => {
    const { availableDates, categories } = getAvailableBulkDates();

    if (availableDates.length === 0) {
      toast({
        title: '📅 Sin días por pedir',
        description: 'Todos los días disponibles de este mes ya tienen pedido. Puedes avanzar al siguiente mes con las flechas del calendario.',
      });
      return;
    }

    setBulkValidDates(availableDates);
    setBulkAvailableCategories(categories);
    setBulkDaysCount(availableDates.length);
    setBulkCategory(null);
    setBulkMenuMode('auto');
    setBulkDateRange({ from: availableDates[0], to: availableDates[availableDates.length - 1] });
    setBulkEstimatedTotal(0);
    setShowBulkOrderModal(true);
  };

  const confirmBulkOrder = () => {
    if (!bulkCategory) return;

    // Filtrar solo días con la categoría seleccionada (usando cache)
    const validDates = bulkValidDates.filter(dateStr => {
      const dayMenus = menus.get(dateStr);
      return dayMenus?.some(m => m.category_id === bulkCategory.id);
    });

    if (validDates.length === 0) {
      toast({ variant: 'destructive', title: 'Sin días', description: `No hay días con "${bulkCategory.name}" disponible.` });
      return;
    }

    // Guardar modo seleccionado (auto/manual) para que el wizard lo use
    setBulkMenuMode(bulkMenuMode);
    setSelectedDates(new Set(validDates));
    setShowBulkOrderModal(false);

    // Iniciar wizard con categoría pre-seleccionada
    startWizard(validDates, bulkCategory);
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

  // ==========================================
  // DAY CAROUSEL (replaces calendar grid)
  // ==========================================

  const renderDayCarousel = () => {
    return (
      <div className="relative">
        {/* Left arrow (PC only) */}
        <button
          onClick={() => scrollCarousel('left')}
          className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 shadow-lg rounded-full p-1.5 border hover:bg-gray-50 transition-all"
          style={{ marginLeft: -6 }}
        >
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>

        {/* Scrollable day strip */}
        <div
          ref={carouselRef}
          className="flex gap-2 overflow-x-auto px-1 py-2 snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          <style>{`.carousel-scroll::-webkit-scrollbar { display: none; }`}</style>
          {carouselDays.map(day => {
            const isActive = !multiSelectMode && selectedDay === day.dateStr;
            const isMultiSelected = multiSelectMode && selectedDates.has(day.dateStr);
            const isInteractive = day.hasMenus || day.hasOrders;
            // In multi-select: highlight available days to guide the user
            const isMultiSelectable = multiSelectMode && day.hasMenus && day.canOrder && !day.hasOrders && !day.isSpecial;

            return (
              <button
                key={day.dateStr}
                data-date={day.dateStr}
                onClick={() => (isInteractive || (multiSelectMode && day.hasMenus)) && handleCarouselDayClick(day.dateStr)}
                disabled={!isInteractive && !day.isSpecial && !multiSelectMode}
                className={cn(
                  "flex-shrink-0 snap-center flex flex-col items-center justify-center",
                  "w-14 h-[72px] sm:w-16 sm:h-20 rounded-xl border-2 transition-all duration-200",
                  "disabled:opacity-30 disabled:cursor-not-allowed",
                  // Active state (only in single mode)
                  isActive && "bg-purple-600 border-purple-600 text-white shadow-lg shadow-purple-200 scale-105",
                  // Multi-selected (blue check)
                  isMultiSelected && "bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-200 scale-105",
                  // Multi-select available: pulsing blue border
                  isMultiSelectable && !isMultiSelected && "border-blue-400 bg-blue-50 hover:bg-blue-100 hover:border-blue-500",
                  // Today ring
                  day.isToday && !isActive && !isMultiSelected && !isMultiSelectable && "ring-2 ring-purple-400 ring-offset-1",
                  // Has orders (green)
                  !isActive && !isMultiSelected && !isMultiSelectable && day.hasOrders && "bg-green-50 border-green-400 hover:border-green-500",
                  // Available (white, interactive) — single mode only
                  !multiSelectMode && !isActive && !day.hasOrders && day.canOrder && day.hasMenus && "bg-white border-gray-200 hover:border-purple-400 hover:bg-purple-50",
                  // Blocked (red tint)
                  !isActive && !isMultiSelected && !isMultiSelectable && day.isBlocked && !day.hasOrders && "bg-red-50 border-red-200",
                  // Special day
                  !isActive && !isMultiSelected && !isMultiSelectable && day.isSpecial && "bg-amber-50 border-amber-200",
                  // No menus / weekend empty
                  !isActive && !isMultiSelected && !isMultiSelectable && !day.hasMenus && !day.isSpecial && !day.hasOrders && "bg-gray-50 border-gray-100",
                  // In multi-select: dim days that can't be selected
                  multiSelectMode && !isMultiSelected && !isMultiSelectable && day.hasMenus && "opacity-50",
                )}
              >
                {/* Day name */}
                <span className={cn(
                  "text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider",
                  isActive ? "text-purple-200" : isMultiSelected ? "text-blue-200" : isMultiSelectable ? "text-blue-500" : "text-gray-400",
                )}>
                  {WEEKDAYS[day.date.getDay()]}
                </span>

                {/* Day number */}
                <span className={cn(
                  "text-lg sm:text-xl font-black leading-tight",
                  isActive ? "text-white" : isMultiSelected ? "text-white" :
                  isMultiSelectable ? "text-blue-700" :
                  day.hasOrders ? "text-green-700" :
                  day.canOrder && day.hasMenus ? "text-gray-800" :
                  day.isBlocked ? "text-red-400" : "text-gray-300",
                )}>
                  {format(day.date, 'd')}
                </span>

                {/* Status indicator */}
                <div className="flex items-center gap-0.5 mt-0.5">
                  {isMultiSelected && (
                    <Check className="h-3.5 w-3.5 text-white" />
                  )}
                  {isMultiSelectable && !isMultiSelected && (
                    <PlusCircle className="h-3 w-3 text-blue-500" />
                  )}
                  {!isMultiSelected && !isMultiSelectable && day.hasOrders && (
                    <div className={cn("flex items-center gap-0.5", isActive ? "text-green-300" : "text-green-600")}>
                      <CheckCircle2 className="h-3 w-3" />
                      <span className="text-[8px] font-bold">{day.dayOrders.reduce((s, o) => s + o.quantity, 0)}</span>
                    </div>
                  )}
                  {!multiSelectMode && !isMultiSelected && !day.hasOrders && day.canOrder && day.hasMenus && (
                    <UtensilsCrossed className={cn("h-3 w-3", isActive ? "text-purple-300" : "text-blue-400")} />
                  )}
                  {!isMultiSelected && !isMultiSelectable && day.isBlocked && !day.hasOrders && (
                    <Lock className={cn("h-3 w-3", isActive ? "text-red-300" : "text-red-400")} />
                  )}
                  {!isMultiSelected && !isMultiSelectable && day.isSpecial && (
                    <span className="text-[8px]">⭐</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right arrow (PC only) */}
        <button
          onClick={() => scrollCarousel('right')}
          className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 shadow-lg rounded-full p-1.5 border hover:bg-gray-50 transition-all"
          style={{ marginRight: -6 }}
        >
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
      </div>
    );
  };

  // ==========================================
  // MENU CARDS (below selected day)
  // ==========================================

  const renderMenuCards = () => {
    if (!selectedDay) return null;

    const dayData = carouselDays.find(d => d.dateStr === selectedDay);
    if (!dayData) return null;

    const dayMenus = dayData.dayMenus;
    const dayOrders = dayData.dayOrders;

    // Group menus by category
    const categoriesMap = new Map<string, { category: LunchCategory; menus: LunchMenu[] }>();
    dayMenus.forEach(menu => {
      if (menu.category_id && menu.category) {
        const existing = categoriesMap.get(menu.category_id);
        if (existing) {
          existing.menus.push(menu);
        } else {
          categoriesMap.set(menu.category_id, { category: menu.category, menus: [menu] });
        }
      }
    });
    const categories = Array.from(categoriesMap.values());

    const formattedDate = format(getPeruDateOnly(selectedDay), "EEEE d 'de' MMMM", { locale: es });

    return (
      <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {/* Day header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base sm:text-lg text-gray-900 capitalize">{formattedDate}</h3>
            {dayData.isSpecial && (
              <p className="text-xs text-amber-600">⭐ {specialDays.get(selectedDay)?.title || 'Día especial'}</p>
            )}
          </div>
          {dayOrders.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="text-green-700 border-green-300 hover:bg-green-50"
              onClick={() => { setViewOrdersDate(selectedDay); setViewOrdersModal(true); }}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              {dayOrders.length} pedido{dayOrders.length > 1 ? 's' : ''}
            </Button>
          )}
        </div>

        {/* No menus message */}
        {categories.length === 0 && (
          <div className="text-center py-6 text-gray-400">
            <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No hay menús disponibles este día</p>
          </div>
        )}

        {/* Menus shown directly, grouped by category */}
        {categories.map(({ category, menus: catMenus }) => {
          const IconComponent = ICON_MAP[category.icon || 'utensils'] || UtensilsCrossed;
          const price = category.price || config?.lunch_price || 0;
          const isExpanded = expandedCategoryId === category.id && isInlineOrdering;
          const hasOrderForThis = dayOrders.some(o => o.categoryId === category.id);
          const canOrderNow = dayData.canOrder && !hasOrderForThis;
          const isConfigurable = category.is_configurable;

          return (
            <div key={category.id} className="space-y-2">
              {/* Category header (compact) */}
              <div className="flex items-center gap-2">
                <div
                  className="h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: (category.color || '#8B5CF6') + '20' }}
                >
                  <IconComponent className="h-3.5 w-3.5" style={{ color: category.color || '#8B5CF6' }} />
                </div>
                <span className="font-bold text-sm" style={{ color: category.color || '#8B5CF6' }}>{category.name}</span>
                <span className="text-sm font-black text-purple-700">S/ {price.toFixed(2)}</span>
                {hasOrderForThis && (
                  <Badge className="bg-green-500 text-[10px] px-1.5 py-0 ml-auto">✓ Pedido</Badge>
                )}
              </div>

              {/* Configurable category: single compact button */}
              {isConfigurable && (
                <button
                  onClick={() => canOrderNow ? handleCategoryCardTap(category) : hasOrderForThis ? (() => { setViewOrdersDate(selectedDay); setViewOrdersModal(true); })() : null}
                  disabled={!canOrderNow && !hasOrderForThis}
                  className={cn(
                    "w-full text-left rounded-lg border-2 p-2.5 transition-all",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    isExpanded && "border-amber-400 bg-amber-50",
                    !isExpanded && canOrderNow && "bg-white border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 active:scale-[0.98]",
                    !isExpanded && hasOrderForThis && "bg-green-50 border-green-300",
                  )}
                >
                  <p className="text-xs font-semibold text-amber-800">🍽️ Arma tu plato personalizado</p>
                  {canOrderNow && !isExpanded && <p className="text-[10px] text-amber-600 mt-0.5">Toca para personalizar →</p>}
                </button>
              )}

              {/* Standard menus: show each menu directly */}
              {!isConfigurable && (
                <div className={cn(
                  "grid gap-2",
                  catMenus.length > 1 ? "grid-cols-2" : "grid-cols-1"
                )}>
                  {catMenus.map((menu) => (
                    <button
                      key={menu.id}
                      onClick={() => canOrderNow ? handleDirectMenuTap(category, menu) : hasOrderForThis ? (() => { setViewOrdersDate(selectedDay); setViewOrdersModal(true); })() : null}
                      disabled={!canOrderNow && !hasOrderForThis}
                      className={cn(
                        "w-full text-left rounded-lg border-2 p-2.5 transition-all",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        canOrderNow && "bg-white border-gray-200 hover:border-purple-400 hover:bg-purple-50/50 active:scale-[0.98]",
                        hasOrderForThis && "bg-green-50 border-green-300",
                      )}
                    >
                      <p className="font-bold text-sm text-gray-900">{menu.main_course}</p>
                      {menu.starter && <p className="text-[11px] text-gray-500 mt-0.5">🥗 {menu.starter}</p>}
                      {menu.beverage && <p className="text-[11px] text-gray-500">🥤 {menu.beverage}</p>}
                      {menu.dessert && <p className="text-[11px] text-gray-500">🍮 {menu.dessert}</p>}
                      {menu.notes && <p className="text-[10px] text-gray-400 mt-0.5 italic">{menu.notes}</p>}
                      {canOrderNow && (
                        <p className="text-[10px] text-purple-600 font-semibold mt-1">Pedir →</p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Inline expanded ordering form */}
              {isExpanded && (
                <div ref={expandedSectionRef} className="bg-white rounded-xl border-2 border-purple-200 p-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  {wizardStep === 'done' && (
                    <div className="text-center py-3">
                      <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-1 animate-bounce" />
                      <p className="font-bold text-green-700 text-sm">¡Pedido registrado!</p>
                      <p className="text-xs text-gray-500">{userType === 'parent' ? 'Puedes seguir pidiendo otros días' : 'Listo ✓'}</p>
                    </div>
                  )}

                  {showDayTransition && (
                    <div className="text-center py-3 animate-pulse">
                      <CheckCircle2 className="h-7 w-7 text-green-500 mx-auto mb-1" />
                      <p className="text-sm font-bold text-green-700">✅ Registrado</p>
                    </div>
                  )}

                  {/* Configurable plate step */}
                  {!showDayTransition && wizardStep === 'configurable_select' && selectedCategory && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-amber-700">🍽️ Arma tu plato</span>
                        <span className="text-[10px] text-gray-400">Elige tus opciones y toca Confirmar</span>
                      </div>
                      {configPlateGroups.map((group) => {
                        const currentSelection = configSelections.find(s => s.group_name === group.name);
                        const isMultiSelect = (group.max_selections || 1) > 1;
                        const selectedItems = currentSelection?.selected ? currentSelection.selected.split(', ').filter(Boolean) : [];
                        const maxSel = group.max_selections || 1;
                        const hasSelection = selectedItems.length > 0 || (!isMultiSelect && !!currentSelection?.selected);
                        const isSatisfied = !group.is_required || hasSelection;

                        return (
                          <div key={group.id} className={cn(
                            "rounded-lg p-2.5 space-y-2 border-2 transition-all",
                            isSatisfied ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"
                          )}>
                            {/* Group header */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-bold text-gray-800">{group.name}</p>
                                {group.is_required && !hasSelection && (
                                  <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">Requerido</span>
                                )}
                                {hasSelection && (
                                  <span className="text-[9px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-semibold">✓</span>
                                )}
                              </div>
                              {isMultiSelect && (
                                <span className={cn(
                                  "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                  selectedItems.length === maxSel
                                    ? "bg-amber-500 text-white"
                                    : "bg-gray-100 text-gray-500"
                                )}>
                                  {selectedItems.length}/{maxSel}
                                </span>
                              )}
                            </div>
                            {/* Options */}
                            <div className="flex flex-wrap gap-1.5">
                              {group.options.map(option => {
                                const isSelected = isMultiSelect ? selectedItems.includes(option.name) : currentSelection?.selected === option.name;
                                const isDisabledOpt = isMultiSelect && !isSelected && selectedItems.length >= maxSel;
                                return (
                                  <button
                                    key={option.id}
                                    disabled={isDisabledOpt}
                                    onClick={() => {
                                      if (isMultiSelect) {
                                        setConfigSelections(prev => prev.map(s => {
                                          if (s.group_name !== group.name) return s;
                                          const current = s.selected ? s.selected.split(', ').filter(Boolean) : [];
                                          let updated: string[];
                                          if (current.includes(option.name)) { updated = current.filter(n => n !== option.name); }
                                          else if (current.length < maxSel) { updated = [...current, option.name]; }
                                          else { return s; }
                                          return { ...s, selected: updated.join(', ') };
                                        }));
                                      } else {
                                        setConfigSelections(prev => prev.map(s => s.group_name === group.name ? { ...s, selected: option.name } : s));
                                      }
                                    }}
                                    className={cn(
                                      "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-all active:scale-95",
                                      isSelected
                                        ? "border-amber-500 bg-amber-400 text-white shadow-sm"
                                        : isDisabledOpt
                                          ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                                          : "border-gray-200 bg-white hover:border-amber-400 hover:bg-amber-50 text-gray-700"
                                    )}
                                  >
                                    {isSelected && '✓ '}{option.name}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Hint for multi-select */}
                            {isMultiSelect && selectedItems.length < maxSel && (
                              <p className="text-[10px] text-amber-600">
                                {maxSel === 2 ? 'Elige hasta 2 opciones' : `Puedes elegir hasta ${maxSel} opciones`}
                              </p>
                            )}
                          </div>
                        );
                      })}
                      <Button
                        size="sm"
                        onClick={() => setWizardStep('confirm')}
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm h-10"
                        disabled={configPlateGroups.some(g => g.is_required && !configSelections.find(s => s.group_name === g.name)?.selected)}
                      >
                        Confirmar opciones →
                      </Button>
                    </div>
                  )}

                  {/* Menu selection step (only if entered via old path) */}
                  {!showDayTransition && wizardStep === 'select_menu' && selectedCategory && (
                    <div className="space-y-2">
                      {categoryMenuOptions.map((menu) => (
                        <button
                          key={menu.id}
                          onClick={() => handleMenuSelect(menu)}
                          className="w-full text-left rounded-lg border-2 p-2.5 border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition-all"
                        >
                          <p className="font-bold text-sm">{menu.main_course}</p>
                          {menu.starter && <p className="text-xs text-gray-600">🥗 {menu.starter}</p>}
                          {menu.beverage && <p className="text-xs text-gray-600">🥤 {menu.beverage}</p>}
                          {menu.dessert && <p className="text-xs text-gray-600">🍮 {menu.dessert}</p>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Modifiers step */}
                  {!showDayTransition && wizardStep === 'modifiers' && selectedCategory && selectedMenu && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-purple-700">✨ Personaliza tu pedido:</p>

                      {modifierFavorites.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {modifierFavorites.map(fav => (
                            <Button key={fav.id} type="button" variant="outline" size="sm"
                              onClick={() => applyFavorite(fav)}
                              className="text-[10px] h-7 border-yellow-300 hover:bg-yellow-50"
                            >
                              ⭐ {fav.favorite_name}
                            </Button>
                          ))}
                        </div>
                      )}

                      {menuModifierGroups.map(group => {
                        const currentSel = selectedModifiers.find(m => m.group_id === group.id);
                        const isSkipped = currentSel?.selected_option_id === 'skip';
                        return (
                          <div key={group.id} className="bg-purple-50 rounded-lg p-2 space-y-1.5">
                            <p className="text-xs font-semibold text-purple-900">{group.name}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {group.options.map(option => {
                                const isSelected = !isSkipped && currentSel?.selected_option_id === option.id;
                                return (
                                  <button
                                    key={option.id}
                                    onClick={() => setSelectedModifiers(prev => prev.map(m => m.group_id === group.id ? { ...m, selected_option_id: option.id, selected_name: option.name } : m))}
                                    className={cn(
                                      "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-all",
                                      isSelected ? "border-purple-500 bg-purple-100 text-purple-900" : "border-gray-200 hover:border-purple-300 text-gray-600"
                                    )}
                                  >
                                    {isSelected && '✓ '}{option.name}
                                  </button>
                                );
                              })}
                              <button
                                onClick={() => setSelectedModifiers(prev => prev.map(m => m.group_id === group.id ? { ...m, selected_option_id: 'skip', selected_name: `Sin ${group.name.toLowerCase()}` } : m))}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 border-dashed transition-all",
                                  isSkipped ? "border-gray-500 bg-gray-100 text-gray-700" : "border-gray-300 hover:border-gray-400 text-gray-400"
                                )}
                              >
                                Sin {group.name.toLowerCase()}
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={saveAsFavorite} className="text-xs text-yellow-700 border-yellow-300 flex-1">
                          ⭐ Guardar
                        </Button>
                        <Button size="sm" onClick={() => setWizardStep('confirm')} className="bg-purple-600 hover:bg-purple-700 text-xs flex-1">
                          Continuar →
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Confirm step */}
                  {!showDayTransition && wizardStep === 'confirm' && selectedCategory && (
                    <div className="space-y-2">
                      {selectedMenu && (
                        <div className="bg-gray-50 rounded-lg p-2 border border-gray-200">
                          <p className="font-bold text-sm text-gray-800">{selectedMenu.main_course}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            {selectedMenu.starter && <span className="text-[11px] text-gray-500">🥗 {selectedMenu.starter}</span>}
                            {selectedMenu.beverage && <span className="text-[11px] text-gray-500">🥤 {selectedMenu.beverage}</span>}
                            {selectedMenu.dessert && <span className="text-[11px] text-gray-500">🍮 {selectedMenu.dessert}</span>}
                          </div>
                        </div>
                      )}

                      {(configSelections.filter(s => s.selected).length > 0 || selectedModifiers.filter(m => m.selected_name).length > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {configSelections.filter(s => s.selected).map((sel, i) => (
                            <span key={`c${i}`} className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{sel.selected}</span>
                          ))}
                          {selectedModifiers.filter(m => m.selected_name).map((mod, i) => (
                            <span key={`m${i}`} className="text-[9px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">{mod.selected_name}</span>
                          ))}
                        </div>
                      )}

                      {availableGarnishes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] text-orange-600 font-semibold mr-0.5">🍟</span>
                          {availableGarnishes.map(g => {
                            const isSel = selectedGarnishes.has(g);
                            return (
                              <button key={g} onClick={() => setSelectedGarnishes(prev => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; })}
                                className={cn("px-1.5 py-0.5 rounded-full text-[10px] border transition-all", isSel ? "bg-orange-600 text-white border-orange-700" : "bg-white text-orange-600 border-orange-200 hover:border-orange-400")}
                              >
                                {isSel ? '✓ ' : ''}{g}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-gray-50 rounded-lg border px-2 py-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setQuantity(Math.max(1, quantity - 1))} disabled={quantity <= 1}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="text-sm font-black w-5 text-center">{quantity}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setQuantity(Math.min(10, quantity + 1))}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-lg font-black text-purple-700">
                          S/ {((selectedCategory.price || config?.lunch_price || 0) * quantity).toFixed(2)}
                        </span>
                      </div>

                      {userType === 'parent' && (
                        showNotesField ? (
                          <Textarea
                            placeholder="Escribe tus observaciones..."
                            value={parentNotes}
                            onChange={(e) => setParentNotes(e.target.value)}
                            maxLength={250}
                            rows={2}
                            autoFocus
                            className="resize-none text-xs"
                          />
                        ) : (
                          <button onClick={() => setShowNotesField(true)} className="text-[10px] text-gray-400 hover:text-gray-600 transition-all">
                            📝 Agregar nota
                          </button>
                        )
                      )}

                      <Button
                        className="w-full h-11 bg-purple-600 hover:bg-purple-700 font-bold text-sm shadow-lg active:scale-[0.98] transition-all"
                        disabled={submitting}
                        onClick={handleConfirmOrder}
                      >
                        {submitting ? (
                          <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Procesando...</>
                        ) : (
                          <>🍽️ Pedir — S/ {((selectedCategory.price || config?.lunch_price || 0) * quantity).toFixed(2)}</>
                        )}
                      </Button>
                      <button
                        className="w-full text-center text-[10px] text-gray-400 hover:text-gray-600 py-0.5"
                        onClick={() => {
                          setExpandedCategoryId(null);
                          setIsInlineOrdering(false);
                          setWizardStep('idle');
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  {wizardStep === 'category' && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
                      <span className="text-xs text-gray-500 ml-2">Cargando opciones...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
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
    // Skip dialog when ordering inline (single day)
    if (isInlineOrdering) return null;

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
      <Dialog open={wizardStep !== 'idle' && !showCancelConfirm} onOpenChange={(open) => { if (!open) handleCancelWizard(); }}>
        <DialogContent className="max-w-lg sm:max-w-2xl max-h-[90vh] overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => { e.preventDefault(); handleCancelWizard(); }}>
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

              {/* Resumen de pedidos para padres */}
              {userType === 'parent' && totalOrderAmount > 0 && (
                <div className="space-y-3 mt-4">
                  {/* Detalle de pedidos */}
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                    {orderDescriptions.map((desc, i) => (
                      <p key={i} className="text-sm text-gray-700">• {desc}</p>
                    ))}
                  </div>

                  {/* Total */}
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-xl p-4 flex justify-between items-center">
                    <span className="text-lg font-bold text-gray-900">Total a pagar:</span>
                    <span className="text-2xl font-black text-purple-700">S/ {totalOrderAmount.toFixed(2)}</span>
                  </div>

                  {/* Mensaje informativo */}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-800">
                      Para confirmar tu pedido, envía el comprobante de pago. 
                      Tu pedido quedará <strong>pendiente</strong> hasta que el administrador apruebe el pago.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col justify-center gap-3 mt-6">
                {userType === 'parent' && totalOrderAmount > 0 ? (
                  <>
                    <Button
                      onClick={closeWizard}
                      size="lg"
                      className="bg-green-600 hover:bg-green-700 text-white font-bold w-full"
                    >
                      <UtensilsCrossed className="h-5 w-5 mr-2" />
                      Seguir pidiendo
                    </Button>
                    <Button
                      onClick={() => {
                        closeWizard();
                        if (onGoToCart) {
                          setTotalOrderAmount(0);
                          setCreatedOrderIds([]);
                          setCreatedTransactionIds([]);
                          setOrderDescriptions([]);
                          totalOrderAmountRef.current = 0;
                          setTimeout(() => onGoToCart(), 300);
                        }
                      }}
                      variant="outline"
                      size="lg"
                      className="border-purple-300 text-purple-700 hover:bg-purple-50 w-full"
                      disabled={!onGoToCart}
                    >
                      <CreditCardIcon className="h-5 w-5 mr-2" />
                      Ir al Carrito
                    </Button>
                  </>
                ) : (
                  <Button 
                    onClick={closeWizard} 
                    size="lg" 
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Cerrar
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Transición visual entre días */}
          {showDayTransition && (
            <div className="flex flex-col items-center justify-center py-12 animate-pulse">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
              <p className="text-lg font-bold text-green-700">✅ ¡Pedido registrado!</p>
              <p className="text-sm text-gray-500 mt-1">Avanzando al siguiente día...</p>
            </div>
          )}

          {/* STEPS: CATEGORY / CONFIRM */}
          {!showDayTransition && wizardStep !== 'done' && currentDateStr && (
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
                  {wizardStep === 'category' && (bulkPreselectedCategory && !skipAutoSelect ? `Auto-seleccionando "${bulkPreselectedCategory.name}"...` : 'Selecciona la categoría del menú')}
                  {wizardStep === 'select_menu' && (categoryMenuOptions.length === 1 ? 'Revisa el menú del día y selecciónalo' : 'Elige el menú que deseas')}
                  {wizardStep === 'configurable_select' && '🍽️ Elige tus opciones'}
                  {wizardStep === 'modifiers' && '✨ Personaliza tu pedido'}
                  {wizardStep === 'confirm' && 'Confirma tu pedido'}
                </DialogDescription>
                {/* Barra de progreso multi-día */}
                {totalDays > 1 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>{ordersCreated} pedido(s) registrado(s)</span>
                      <span>{wizardCurrentIndex + 1}/{totalDays}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-purple-600 h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${(ordersCreated / totalDays) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
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

                {/* STEP: Select Menu (cuando hay múltiples menús en la misma categoría) */}
                {wizardStep === 'select_menu' && selectedCategory && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600 mb-2">
                      Hay <strong>{categoryMenuOptions.length} opciones</strong> en "{selectedCategory.name}". Elige una:
                    </p>
                    {categoryMenuOptions.map((menu) => (
                      <Card
                        key={menu.id}
                        className="cursor-pointer hover:shadow-md transition-all hover:border-purple-300"
                        onClick={() => handleMenuSelect(menu)}
                      >
                        <CardContent className="p-4">
                          <div className="space-y-1">
                            <p className="text-lg font-bold text-gray-900">{menu.main_course}</p>
                            {menu.starter && (
                              <p className="text-sm text-gray-600">Entrada: {menu.starter}</p>
                            )}
                            {menu.beverage && (
                              <p className="text-sm text-gray-600">Bebida: {menu.beverage}</p>
                            )}
                            {menu.dessert && (
                              <p className="text-sm text-gray-600">Postre: {menu.dessert}</p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* STEP: Configurable Plate Selection (Plato Configurable) */}
                {wizardStep === 'configurable_select' && selectedCategory && (
                  <div className="space-y-4">
                    <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
                      <CardContent className="p-3 space-y-1">
                        <p className="text-xs text-amber-600 font-semibold uppercase tracking-wide">🍽️ {selectedCategory.name}</p>
                        <p className="text-sm text-gray-600">Elige tus opciones. El precio no cambia.</p>
                      </CardContent>
                    </Card>

                    {configPlateGroups.length === 0 ? (
                      <div className="text-center py-6 text-gray-500">
                        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No se han configurado opciones para este plato</p>
                      </div>
                    ) : (
                      configPlateGroups.map((group, gIdx) => {
                        const currentSelection = configSelections.find(s => s.group_name === group.name);
                        const isMultiSelect = (group.max_selections || 1) > 1;
                        const selectedItems = currentSelection?.selected ? currentSelection.selected.split(', ').filter(Boolean) : [];
                        const maxSel = group.max_selections || 1;

                        return (
                          <div key={group.id} className={cn(
                            "bg-white rounded-lg border-2 p-3 space-y-2 transition-all",
                            !group.is_required || (isMultiSelect ? selectedItems.length > 0 : !!currentSelection?.selected)
                              ? "border-amber-200"
                              : "border-red-300 bg-red-50"
                          )}>
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-sm text-amber-900">
                                {group.name}
                                {group.is_required && !(isMultiSelect ? selectedItems.length > 0 : !!currentSelection?.selected) && (
                                  <span className="ml-1.5 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">Requerido</span>
                                )}
                              </p>
                              {isMultiSelect ? (
                                <span className={cn(
                                  "text-xs font-bold px-2 py-0.5 rounded-full",
                                  selectedItems.length === maxSel
                                    ? "bg-amber-500 text-white"
                                    : "bg-gray-100 text-gray-500"
                                )}>
                                  {selectedItems.length}/{maxSel}
                                </span>
                              ) : (
                                <span className="text-xs font-normal text-gray-400">1 opción</span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {group.options.map(option => {
                                const isSelected = isMultiSelect
                                  ? selectedItems.includes(option.name)
                                  : currentSelection?.selected === option.name;
                                const isDisabled = isMultiSelect && !isSelected && selectedItems.length >= maxSel;

                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    disabled={isDisabled}
                                    onClick={() => {
                                      if (isMultiSelect) {
                                        // Toggle multi-select
                                        setConfigSelections(prev =>
                                          prev.map(s => {
                                            if (s.group_name !== group.name) return s;
                                            const current = s.selected ? s.selected.split(', ').filter(Boolean) : [];
                                            let updated: string[];
                                            if (current.includes(option.name)) {
                                              updated = current.filter(n => n !== option.name);
                                            } else if (current.length < maxSel) {
                                              updated = [...current, option.name];
                                            } else {
                                              return s;
                                            }
                                            return { ...s, selected: updated.join(', ') };
                                          })
                                        );
                                      } else {
                                        // Single select
                                        setConfigSelections(prev =>
                                          prev.map(s =>
                                            s.group_name === group.name
                                              ? { ...s, selected: option.name }
                                              : s
                                          )
                                        );
                                      }
                                    }}
                                    className={cn(
                                      "p-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left",
                                      isSelected
                                        ? "border-amber-500 bg-amber-50 text-amber-900"
                                        : isDisabled
                                          ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                                          : "border-gray-200 hover:border-amber-300 hover:bg-amber-50/50 text-gray-700"
                                    )}
                                  >
                                    <span className="flex items-center gap-2">
                                      {isMultiSelect ? (
                                        isSelected ? (
                                          <CheckCircle2 className="h-4 w-4 text-amber-600 flex-shrink-0" />
                                        ) : (
                                          <div className="h-4 w-4 rounded border-2 border-gray-300 flex-shrink-0" />
                                        )
                                      ) : (
                                        isSelected ? (
                                          <CheckCircle2 className="h-4 w-4 text-amber-600 flex-shrink-0" />
                                        ) : (
                                          <div className="h-4 w-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                                        )
                                      )}
                                      <span>{option.name}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Precio */}
                    <div className="bg-green-50 p-3 rounded-lg border border-green-200 flex justify-between items-center">
                      <span className="text-sm text-green-700">✓ El precio no cambia al personalizar</span>
                      <span className="font-bold text-green-800">
                        S/ {(selectedCategory.price || config?.lunch_price || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* STEP: Modifiers (Personalización) */}
                {wizardStep === 'modifiers' && selectedCategory && selectedMenu && (
                  <div className="space-y-4">
                    {/* Menú base */}
                    <Card className="bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200">
                      <CardContent className="p-3 space-y-1">
                        <p className="text-xs text-purple-600 font-semibold uppercase tracking-wide">Personaliza tu pedido</p>
                        <p className="font-bold text-gray-900">{selectedMenu.main_course}</p>
                        <p className="text-xs text-gray-500">Elige las opciones que prefieras. El precio no cambia.</p>
                      </CardContent>
                    </Card>

                    {/* Favoritos guardados */}
                    {modifierFavorites.length > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-yellow-800 mb-2">⭐ Mi Platito Favorito:</p>
                        <div className="flex flex-wrap gap-2">
                          {modifierFavorites.map(fav => (
                            <Button
                              key={fav.id}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => applyFavorite(fav)}
                              className="text-xs border-yellow-300 hover:bg-yellow-100"
                            >
                              ⭐ {fav.favorite_name}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Grupos de modificadores (uno por campo: Entrada, Segundo, Bebida, Postre) */}
                    {menuModifierGroups.map(group => {
                      const currentSelection = selectedModifiers.find(m => m.group_id === group.id);
                      const isSkipped = currentSelection?.selected_option_id === 'skip';

                      // Emoji por nombre de campo
                      const fieldEmoji: Record<string, string> = {
                        'Entrada': '🥗', 'Segundo Plato': '🍲', 'Bebida': '🥤', 'Postre': '🍰',
                      };
                      const emoji = fieldEmoji[group.name] || '🍽️';

                      return (
                        <div key={group.id} className="bg-white rounded-lg border-2 border-gray-200 p-3 space-y-2">
                          <p className="font-semibold text-sm text-gray-800">
                            {emoji} {group.name}
                            <span className="ml-2 text-xs font-normal text-gray-400">elige una opción</span>
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {/* Opciones del campo */}
                            {group.options.map(option => {
                              const isSelected = !isSkipped && currentSelection?.selected_option_id === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModifiers(prev =>
                                      prev.map(m =>
                                        m.group_id === group.id
                                          ? { ...m, selected_option_id: option.id, selected_name: option.name }
                                          : m
                                      )
                                    );
                                  }}
                                  className={cn(
                                    "p-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left",
                                    isSelected
                                      ? "border-purple-500 bg-purple-50 text-purple-900"
                                      : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/50 text-gray-700"
                                  )}
                                >
                                  <span className="flex items-center gap-2">
                                    {isSelected ? (
                                      <CheckCircle2 className="h-4 w-4 text-purple-600 flex-shrink-0" />
                                    ) : (
                                      <div className="h-4 w-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                                    )}
                                    <span>{option.name}</span>
                                  </span>
                                  {option.is_default && !isSelected && (
                                    <span className="text-xs text-gray-400 block mt-0.5 ml-6">por defecto</span>
                                  )}
                                </button>
                              );
                            })}

                            {/* Botón "Sin [campo]" — siempre disponible para quitar */}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedModifiers(prev =>
                                  prev.map(m =>
                                    m.group_id === group.id
                                      ? { ...m, selected_option_id: 'skip', selected_name: `Sin ${group.name.toLowerCase()}` }
                                      : m
                                  )
                                );
                              }}
                              className={cn(
                                "p-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left",
                                isSkipped
                                  ? "border-gray-500 bg-gray-100 text-gray-700"
                                  : "border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-400"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                {isSkipped ? (
                                  <CheckCircle2 className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                ) : (
                                  <Ban className="h-4 w-4 text-gray-300 flex-shrink-0" />
                                )}
                                Sin {group.name.toLowerCase()}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Precio (no cambia) */}
                    <div className="bg-green-50 p-3 rounded-lg border border-green-200 flex justify-between items-center">
                      <span className="text-sm text-green-700">✓ El precio no cambia al personalizar</span>
                      <span className="font-bold text-green-800">
                        S/ {(selectedCategory.price || config?.lunch_price || 0).toFixed(2)}
                      </span>
                    </div>
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

                        {/* Resumen de selecciones configurables */}
                        {configSelections.length > 0 && configSelections.some(s => s.selected) && (
                          <div className="border-t pt-2 mt-2 bg-amber-50 -mx-4 -mb-4 p-3 rounded-b-lg">
                            <p className="text-xs text-amber-700 font-semibold mb-1">🍽️ Tu selección:</p>
                            {configSelections.filter(s => s.selected).map((sel, i) => (
                              <p key={i} className="text-sm text-amber-900">
                                • {sel.group_name}: <strong>{sel.selected}</strong>
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Resumen de personalizaciones (menú estándar) */}
                        {selectedModifiers.length > 0 && selectedModifiers.some(m => m.selected_name) && (
                          <div className="border-t pt-2 mt-2 bg-purple-50 -mx-4 -mb-4 p-3 rounded-b-lg">
                            <p className="text-xs text-purple-700 font-semibold mb-1">✨ Personalización:</p>
                            {selectedModifiers.map((mod, i) => (
                              <p key={i} className="text-sm text-purple-900">
                                • {mod.group_name}: <strong>{mod.selected_name}</strong>
                              </p>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Guarniciones opcionales */}
                    {availableGarnishes.length > 0 && (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                        <p className="text-sm font-semibold text-orange-800">🍟 Guarniciones opcionales:</p>
                        <div className="flex flex-wrap gap-2">
                          {availableGarnishes.map((garnish) => {
                            const isSelected = selectedGarnishes.has(garnish);
                            return (
                              <button
                                key={garnish}
                                type="button"
                                onClick={() => {
                                  setSelectedGarnishes(prev => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(garnish)) {
                                      newSet.delete(garnish);
                                    } else {
                                      newSet.add(garnish);
                                    }
                                    return newSet;
                                  });
                                }}
                                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                                  isSelected
                                    ? 'bg-orange-600 text-white border-2 border-orange-700'
                                    : 'bg-white text-orange-700 border-2 border-orange-300 hover:border-orange-500'
                                }`}
                              >
                                {isSelected ? '✓ ' : ''}{garnish}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

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

                    {/* Observaciones del padre — solo en pedidos individuales (1 día) */}
                    {wizardDates.length <= 1 && userType === 'parent' && (
                      <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                          📝 Observaciones <span className="text-xs font-normal text-gray-400">(opcional)</span>
                        </label>
                        <Textarea
                          placeholder="Ej: Mi hijo es alérgico a los mariscos, sin picante, porción pequeña..."
                          value={parentNotes}
                          onChange={(e) => setParentNotes(e.target.value)}
                          maxLength={250}
                          rows={2}
                          className="resize-none text-sm"
                        />
                        <p className="text-[10px] text-gray-400 text-right">{parentNotes.length}/250</p>
                      </div>
                    )}

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
                {wizardStep === 'select_menu' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSkipAutoSelect(true); // Evitar que el auto-select re-lance
                      setWizardStep('category');
                      setSelectedCategory(null);
                      setSelectedMenu(null);
                      setCategoryMenuOptions([]);
                    }}
                  >
                    ← Cambiar categoría
                  </Button>
                )}
                {wizardStep === 'configurable_select' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSkipAutoSelect(true); // Evitar que el auto-select re-lance
                        setWizardStep('category');
                        setSelectedCategory(null);
                        setSelectedMenu(null);
                        setConfigPlateGroups([]);
                        setConfigSelections([]);
                      }}
                    >
                      ← Cambiar categoría
                    </Button>
                    <Button
                      onClick={() => setWizardStep('confirm')}
                      className="bg-amber-600 hover:bg-amber-700"
                      disabled={configPlateGroups.some(g => g.is_required && !configSelections.find(s => s.group_name === g.name)?.selected)}
                    >
                      Continuar →
                    </Button>
                  </>
                )}
                {wizardStep === 'modifiers' && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (categoryMenuOptions.length > 1) {
                          setWizardStep('select_menu');
                          setSelectedMenu(null);
                        } else {
                          setWizardStep('category');
                          setSelectedCategory(null);
                          setSelectedMenu(null);
                        }
                        setMenuModifierGroups([]);
                        setSelectedModifiers([]);
                      }}
                    >
                      ← Atrás
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={saveAsFavorite}
                      className="text-yellow-700 border-yellow-300"
                    >
                      ⭐ Guardar favorito
                    </Button>
                    <Button
                      onClick={() => setWizardStep('confirm')}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      Continuar →
                    </Button>
                  </>
                )}
                {wizardStep === 'confirm' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Si es plato configurable, volver a configurable_select
                      if (configPlateGroups.length > 0) {
                        setWizardStep('configurable_select');
                        setQuantity(1);
                      } else if (menuModifierGroups.length > 0) {
                        setWizardStep('modifiers');
                        setQuantity(1);
                      } else if (categoryMenuOptions.length > 1) {
                        setWizardStep('select_menu');
                        setSelectedMenu(null);
                        setQuantity(1);
                      } else {
                        setSkipAutoSelect(true); // Evitar que el auto-select re-lance
                        setWizardStep('category');
                        setSelectedCategory(null);
                        setSelectedMenu(null);
                        setQuantity(1);
                      }
                    }}
                    disabled={submitting}
                  >
                    ← {configPlateGroups.length > 0 ? 'Cambiar opciones' : menuModifierGroups.length > 0 ? 'Cambiar personalización' : categoryMenuOptions.length > 1 ? 'Cambiar menú' : 'Cambiar categoría'}
                  </Button>
                )}
                <Button variant="ghost" onClick={handleCancelWizard} disabled={submitting}>
                  Cancelar
                </Button>
                {wizardStep === 'confirm' && (
                  <Button
                    onClick={handleConfirmOrder}
                    disabled={submitting}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {submitting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Procesando...</>
                    ) : isLastDay ? (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar Pedido</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />Siguiente →</>
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

                  {/* Selecciones del plato armado */}
                  {(() => {
                    const cfgs = order.configurable_selections;
                    const garns = order.selected_garnishes;
                    const mods = order.selected_modifiers;
                    const hasCfgs = cfgs && cfgs.length > 0;
                    const hasGarns = garns && garns.length > 0;
                    const hasMods = mods && mods.length > 0;
                    if (!hasCfgs && !hasGarns && !hasMods && !order.parent_notes) return null;
                    return (
                      <div className="mt-2 space-y-1.5">
                        {hasMods && (
                          <div className="flex flex-wrap gap-1">
                            {mods!.map((m, i) => (
                              <span key={i} className="inline-flex items-center text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">
                                <strong className="mr-1">{m.group_name}:</strong> {m.selected_name}
                              </span>
                            ))}
                          </div>
                        )}
                        {hasCfgs && (
                          <div className="flex flex-wrap gap-1">
                            {cfgs!.map((c, i) => (
                              <span key={i} className="inline-flex items-center text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-0.5">
                                <strong className="mr-1">{c.group_name}:</strong> {c.selected ?? c.selected_name ?? ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {hasGarns && (
                          <div className="flex flex-wrap gap-1">
                            {garns!.map((g, i) => (
                              <span key={i} className="inline-flex items-center text-xs bg-green-50 text-green-700 border border-green-200 rounded px-2 py-0.5">
                                🥗 {g}
                              </span>
                            ))}
                          </div>
                        )}
                        {order.parent_notes && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            📝 <strong>Obs:</strong> {order.parent_notes}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Badge de pago si aplica */}
                  {!order.is_cancelled && order.transaction_payment_status && (
                    <div className="mt-2">
                      {order.transaction_payment_status === 'paid' && (
                        <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 border border-green-200 rounded px-2 py-0.5 font-semibold">
                          <CheckCircle2 className="h-3 w-3" /> Pago aprobado
                        </span>
                      )}
                      {order.transaction_payment_status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-2 py-0.5 font-semibold">
                          <Clock className="h-3 w-3" /> Pago pendiente
                        </span>
                      )}
                      {order.transaction_payment_status === 'cancelled' && (
                        <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 border border-red-200 rounded px-2 py-0.5">
                          <XCircle className="h-3 w-3" /> Pago cancelado
                        </span>
                      )}
                    </div>
                  )}

                  {/* Cancel button - only for pending orders within cancellation deadline */}
                  {!order.is_cancelled && order.status === 'pending' && canCancel && order.transaction_payment_status !== 'paid' && (
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

                  {/* Si ya está pagado, no se puede cancelar sin admin */}
                  {!order.is_cancelled && order.status === 'pending' && order.transaction_payment_status === 'paid' && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center gap-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      <Lock className="h-3 w-3 flex-shrink-0" />
                      Este pedido ya fue pagado. Contacta al administrador para anularlo.
                    </p>
                  )}

                  {!order.is_cancelled && order.status === 'pending' && !canCancel && order.transaction_payment_status !== 'paid' && (
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

  // No hay estudiantes vinculados a este padre
  if (userType === 'parent' && !loading && students.length === 0) {
    return (
      <Card className="bg-orange-50 border-orange-300">
        <CardContent className="py-10 text-center space-y-3">
          <div className="text-5xl">👦</div>
          <p className="text-orange-800 font-semibold text-lg">Sin estudiantes vinculados</p>
          <p className="text-orange-700 text-sm max-w-xs mx-auto">
            Tu cuenta no tiene ningún estudiante registrado. 
            Comunícate con el administrador del colegio para que vincule a tu hijo/a a tu cuenta.
          </p>
          <p className="text-orange-500 text-xs">
            (Código de cuenta: <span className="font-mono font-bold">{userId.slice(0, 8).toUpperCase()}</span>)
          </p>
        </CardContent>
      </Card>
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
    <div className="space-y-3">
      {/* STUDENT SELECTOR (parents only) */}
      {userType === 'parent' && students.length > 0 && (
        <Card className={cn(wizardStep !== 'idle' && !isInlineOrdering && "opacity-60")}>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">
              {wizardStep !== 'idle' && !isInlineOrdering
                ? `📌 Pidiendo para: ${selectedStudent?.full_name || ''}` 
                : students.length > 1 ? 'Selecciona tu hijo(a):' : `Pidiendo para: ${selectedStudent?.full_name || ''}`}
            </p>
            {students.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {students.map(student => (
                  <Button
                    key={student.id}
                    variant={selectedStudent?.id === student.id ? "default" : "outline"}
                    size="sm"
                    disabled={wizardStep !== 'idle' && !isInlineOrdering}
                    className={cn(
                      "gap-2",
                      selectedStudent?.id === student.id && "bg-purple-600 hover:bg-purple-700",
                    )}
                    onClick={() => {
                      if (wizardStep !== 'idle' && !isInlineOrdering) return;
                      setSelectedStudent(student);
                      setExistingOrders([]);
                      setSelectedDates(new Set());
                      setSelectedDay(null);
                      setExpandedCategoryId(null);
                      setIsInlineOrdering(false);
                      setWizardStep('idle');
                    }}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {student.full_name}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Restore progress banner */}
      {userType === 'parent' && selectedStudent && (() => {
        const saved = sessionStorage.getItem(`lunch_wizard_${selectedStudent.id}`);
        if (!saved) return null;
        try {
          const progress = JSON.parse(saved);
          const hoursDiff = (Date.now() - new Date(progress.savedAt).getTime()) / (1000 * 60 * 60);
          if (hoursDiff > 24) return null;
          const remainingDays = (progress.dates as string[]).length;
          return (
            <Button
              onClick={() => restoreWizardProgress()}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold"
            >
              <CalendarIcon className="h-4 w-4 mr-2" />
              Continuar pedido ({remainingDays} días pendientes)
            </Button>
          );
        } catch { return null; }
      })()}

      {/* DAY CAROUSEL + MONTH NAV (sticky para que siempre sea visible) */}
      <Card className="overflow-hidden sticky top-0 z-20 shadow-md">
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setCurrentDate(subMonths(currentDate, 1)); setSelectedDates(new Set()); }}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center flex-1">
              <CardTitle className="text-sm sm:text-base font-bold">
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </CardTitle>
              {!multiSelectMode && (
                <CardDescription className="text-[10px] sm:text-xs">
                  Desliza y elige un día
                </CardDescription>
              )}
              {multiSelectMode && (
                <CardDescription className="text-[10px] sm:text-xs text-blue-600 font-semibold">
                  Modo múltiple: toca los días para seleccionar
                </CardDescription>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setCurrentDate(addMonths(currentDate, 1)); setSelectedDates(new Set()); }}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Multi-select toggle */}
          <div className="flex items-center justify-between mt-2 px-1">
            <button
              onClick={() => {
                setMultiSelectMode(!multiSelectMode);
                if (multiSelectMode) setSelectedDates(new Set());
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                multiSelectMode
                  ? "bg-blue-600 text-white shadow-md"
                  : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              Pedido múltiple
            </button>
            {/* Legend mini */}
            <div className="flex items-center gap-2 text-[9px] text-gray-400">
              <span className="flex items-center gap-0.5"><UtensilsCrossed className="h-2.5 w-2.5 text-blue-400" />Menú</span>
              <span className="flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5 text-green-500" />Pedido</span>
              <span className="flex items-center gap-0.5"><Lock className="h-2.5 w-2.5 text-red-400" />Cerrado</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 px-2 pb-3">
          {renderDayCarousel()}
        </CardContent>
      </Card>

      {/* PAYMENT PENDING BANNER — visible after ordering, lets parent keep ordering or pay */}
      {userType === 'parent' && totalOrderAmount > 0 && !isInlineOrdering && createdOrderIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-purple-600 text-white rounded-xl px-4 py-3 shadow-lg">
          <div>
            <p className="text-xs font-semibold text-purple-200">Pedidos pendientes de pago</p>
            <p className="text-lg font-black">S/ {totalOrderAmount.toFixed(2)}</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-purple-200 hover:text-white hover:bg-white/20 text-xs h-8"
              onClick={() => {
                setTotalOrderAmount(0);
                setCreatedOrderIds([]);
                setCreatedTransactionIds([]);
                setOrderDescriptions([]);
              }}
            >
              Ignorar
            </Button>
            <Button
              size="sm"
              className="bg-white text-purple-700 hover:bg-purple-50 font-bold text-xs h-8 shadow"
              onClick={() => {
                if (onGoToCart) {
                  setTotalOrderAmount(0);
                  setCreatedOrderIds([]);
                  setCreatedTransactionIds([]);
                  setOrderDescriptions([]);
                  totalOrderAmountRef.current = 0;
                  onGoToCart();
                }
              }}
              disabled={!onGoToCart}
            >
              <CreditCardIcon className="h-3.5 w-3.5 mr-1" />
              Ir al Carrito
            </Button>
          </div>
        </div>
      )}

      {/* MENU CARDS (below selected day) */}
      {selectedDay && !multiSelectMode && renderMenuCards()}

      {/* Deadline info (compact) */}
      {config?.order_deadline_time && (
        <div className="flex items-center gap-2 text-[10px] sm:text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Límite: <strong>{config.order_deadline_time.substring(0, 5)}</strong>
            {(config.order_deadline_days ?? 0) > 0
              ? <>, {config.order_deadline_days}d antes</>
              : <> mismo día</>
            }
          </span>
        </div>
      )}

      {/* FLOATING ACTION BAR (multi-select mode) */}
      {multiSelectMode && (
        <div className="sticky bottom-20 sm:bottom-24 z-30">
          <Card className={cn(
            "border-0 shadow-xl rounded-2xl",
            selectedDates.size > 0
              ? "bg-gradient-to-r from-purple-600 to-blue-600"
              : "bg-gradient-to-r from-gray-500 to-gray-600"
          )}>
            <CardContent className="p-3 sm:p-4">
              {selectedDates.size === 0 ? (
                <div className="text-center text-white">
                  <p className="font-bold text-sm">👆 Toca los días disponibles para seleccionarlos</p>
                  <p className="text-xs text-gray-200 mt-0.5">Los días con 🍴 azul tienen menú disponible</p>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="text-white">
                    <p className="font-bold text-sm sm:text-base">
                      ✅ {selectedDates.size} día{selectedDates.size > 1 ? 's' : ''} seleccionado{selectedDates.size > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-purple-200">
                      Días: {Array.from(selectedDates).sort().map(d => parseInt(d.split('-')[2])).join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-white/20"
                      onClick={() => setSelectedDates(new Set())}
                    >
                      ✕
                    </Button>
                    <Button
                      size="sm"
                      className="bg-white text-purple-700 hover:bg-purple-50 font-bold shadow-lg"
                      onClick={() => {
                        setMultiSelectMode(false);
                        startWizard();
                      }}
                    >
                      🍽️ Hacer Pedido
                    </Button>
                  </div>
                </div>
              )}
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
            <p className="text-gray-400 text-sm mt-1">Prueba avanzando al siguiente mes →</p>
          </CardContent>
        </Card>
      )}

      {/* CANCEL CONFIRMATION DIALOG */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              ¿Deseas cancelar el proceso?
            </DialogTitle>
            <DialogDescription>
              {ordersCreated > 0
                ? `Ya registraste ${ordersCreated} pedido(s). Los pedidos ya creados se mantendrán.`
                : 'Tu progreso de selección se perderá.'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-4">
            {/* Opción 1: Continuar después */}
            <Button
              onClick={handleContinueLater}
              className="bg-amber-500 hover:bg-amber-600 text-white font-bold w-full"
            >
              💾 Continuar después
            </Button>
            {/* Opción 2: Cancelar todo */}
            <Button
              variant="destructive"
              onClick={() => { setShowCancelConfirm(false); closeWizard(); }}
              className="w-full"
            >
              🗑️ Cancelar todo el proceso
            </Button>
            {/* Opción 3: Volver al wizard */}
            <Button
              variant="outline"
              onClick={() => setShowCancelConfirm(false)}
              className="w-full"
            >
              ← Volver al pedido
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
