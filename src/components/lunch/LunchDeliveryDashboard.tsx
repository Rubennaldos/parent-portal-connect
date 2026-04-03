import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { BILLING_EXCLUDED } from '@/lib/billingUtils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  ArrowLeft,
  RotateCcw,
  PenLine,
  Plus,
  Columns2,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Save,
  Camera,
  FileText,
  Download,
  Flag,
  Wifi,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ==========================================
// HELPERS
// ==========================================

/** Normaliza texto: quita acentos/tildes y pasa a minúsculas */
const normalize = (text: string) =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ==========================================
// INTERFACES
// ==========================================

interface LunchDeliveryDashboardProps {
  schoolId: string;
  userId: string;
  userName?: string;
  selectedDate?: string; // yyyy-MM-dd — si no se pasa, usa la fecha de hoy (hora Perú)
  onClose: () => void;
}

interface DeliveryReport {
  sessionDate: string;
  startedAt: string;
  endedAt: string;
  totalOrders: number;
  totalDelivered: number;
  totalNotCollected: number;
  totalModified: number;
  totalAddedWithoutOrder: number;
  totalStudents: number;
  totalTeachers: number;
  byCategory: Array<{ name: string; delivered: number; pending: number }>;
  byClassroom: Array<{ name: string; delivered: number; pending: number }>;
  deliveredList: Array<{ name: string; category: string; plate: string; time: string }>;
  notCollectedList: Array<{ name: string; category: string; plate: string }>;
  addedWithoutOrderList: Array<{ name: string; category: string; plate: string }>;
}

interface PresenceUser {
  id: string;
  name: string;
  joinedAt: string;
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
  student_id: string | null;
  student_name: string | null;
  student_photo: string | null;
  student_grade: string | null;
  student_section: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  category_name: string | null;
  menu_starter: string | null;
  menu_main_course: string | null;
  menu_beverage: string | null;
  menu_dessert: string | null;
  menu_notes: string | null;
  ticket_code: string | null;
  addons: string[];
  observations: string | null;
  payment_status: 'paid' | 'unpaid'; // Si tiene transacción vinculada
  // Selecciones de plato armado
  selected_modifiers: Array<{ group_name: string; selected_name: string }> | null;
  configurable_selections: Array<{ group_name: string; selected_name: string }> | null;
  selected_garnishes: string[] | null;
}

type PaymentFilter = 'all' | 'paid' | 'unpaid';

interface AvailableMenu {
  id: string;
  main_course: string | null;
  starter: string | null;
  beverage: string | null;
  dessert: string | null;
  notes: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  price: number;
}

type DeliveryMode = 'by_classroom' | 'by_grade' | 'by_grade_classroom' | 'alphabetical' | 'all';
type PersonType = 'students' | 'teachers';
type StatusFilter = 'all' | 'pending' | 'delivered';

// ==========================================
// DELIVERY LIST PANEL (reusable for split-screen)
// ==========================================

interface DeliveryPanelProps {
  panelId: string;
  orders: DeliveryOrder[];
  personType: PersonType;
  mode: DeliveryMode;
  availableLists: string[];
  schoolId: string;
  userId: string;
  todayStr: string;
  onToggleDelivered: (order: DeliveryOrder) => Promise<void>;
  onModifyOrder: (order: DeliveryOrder) => void;
  onAddWithoutOrder: () => void;
  onViewPhoto: (url: string) => void;
  compact?: boolean;
  initialListIndex?: number;
}

function DeliveryPanel({
  panelId,
  orders,
  personType,
  mode,
  availableLists,
  schoolId,
  userId,
  todayStr,
  onToggleDelivered,
  onModifyOrder,
  onAddWithoutOrder,
  onViewPhoto,
  compact = false,
  initialListIndex = 0,
}: DeliveryPanelProps) {
  const [currentListIndex, setCurrentListIndex] = useState(initialListIndex);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [showListPicker, setShowListPicker] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentListName = availableLists[currentListIndex] || 'Todos';
  const isLastList = currentListIndex >= availableLists.length - 1;

  // Filtered orders
  const currentListOrders = useMemo(() => {
    let filtered = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if ((mode === 'by_classroom' || mode === 'by_grade_classroom') && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const cc = availableLists[currentListIndex];
      filtered = filtered.filter(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim() === cc);
    } else if (mode === 'by_grade' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const cg = availableLists[currentListIndex];
      filtered = filtered.filter(o => o.student_grade === cg);
    }

    if (mode === 'alphabetical' || mode === 'all') {
      filtered.sort((a, b) => {
        const nameA = (a.student_name || a.teacher_name || '').toLowerCase();
        const nameB = (b.student_name || b.teacher_name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }

    if (searchTerm.trim()) {
      const q = normalize(searchTerm.trim());
      filtered = filtered.filter(o => {
        const name = normalize(o.student_name || o.teacher_name || '');
        const ticket = (o.ticket_code || '').toLowerCase();
        return name.includes(q) || ticket.includes(q);
      });
    }

    if (statusFilter === 'pending') {
      filtered = filtered.filter(o => o.status !== 'delivered');
    } else if (statusFilter === 'delivered') {
      filtered = filtered.filter(o => o.status === 'delivered');
    }

    return filtered;
  }, [orders, personType, mode, availableLists, currentListIndex, searchTerm, statusFilter]);

  // Progress
  const listProgress = useMemo(() => {
    let base = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if ((mode === 'by_classroom' || mode === 'by_grade_classroom') && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const cc = availableLists[currentListIndex];
      base = base.filter(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim() === cc);
    } else if (mode === 'by_grade' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
      const cg = availableLists[currentListIndex];
      base = base.filter(o => o.student_grade === cg);
    }

    const total = base.length;
    const delivered = base.filter(o => o.status === 'delivered').length;
    return { total, delivered, pct: total > 0 ? Math.round((delivered / total) * 100) : 0 };
  }, [orders, personType, mode, availableLists, currentListIndex]);

  const handleToggle = async (order: DeliveryOrder) => {
    setTogglingId(order.id);
    await onToggleDelivered(order);
    setTogglingId(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* TOP BAR */}
      <div className="bg-white border-b px-2 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className={cn("font-bold truncate", compact ? "text-xs" : "text-sm")}>
                {personType === 'students' ? '👦' : '👨‍🏫'}
                {currentListName !== 'Todos' ? ` ${currentListName}` : ` ${personType === 'students' ? 'Alumnos' : 'Profesores'}`}
              </h2>
              {availableLists.length > 1 && (
                <Badge variant="outline" className="text-[8px] flex-shrink-0">
                  {currentListIndex + 1}/{availableLists.length}
                </Badge>
              )}
            </div>
            {/* Progress bar */}
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    listProgress.pct === 100 ? "bg-green-500" : "bg-orange-500"
                  )}
                  style={{ width: `${listProgress.pct}%` }}
                />
              </div>
              <span className={cn(
                "text-[10px] font-bold flex-shrink-0",
                listProgress.pct === 100 ? "text-green-600" : "text-orange-600"
              )}>
                {listProgress.delivered}/{listProgress.total}
              </span>
            </div>
          </div>

          {/* Add without order */}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 flex-shrink-0 border-green-300 text-green-700 hover:bg-green-50"
            onClick={onAddWithoutOrder}
            title="Agregar alumno sin pedido"
          >
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              ref={searchInputRef}
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={cn("pl-7 h-7 text-xs", compact && "text-[10px]")}
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="h-3 w-3 text-gray-400" />
              </button>
            )}
          </div>
          <div className="flex gap-0.5">
            {(['all', 'pending', 'delivered'] as StatusFilter[]).map(f => (
              <Button
                key={f}
                variant={statusFilter === f ? 'default' : 'outline'}
                size="sm"
                className={cn("h-7 px-1.5 text-[9px]", compact && "text-[8px] px-1")}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'all' ? '📋' : f === 'pending' ? '⏳' : '✅'}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* ORDER LIST */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-1">
        {currentListOrders.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs font-semibold">{searchTerm ? 'Sin resultados' : 'Lista vacía'}</p>
          </div>
        ) : (
          currentListOrders.map(order => {
            const name = order.student_name || order.teacher_name || 'Sin nombre';
            const isDelivered = order.status === 'delivered';
            const isToggling = togglingId === order.id;
            const isExpanded = expandedOrderId === order.id;

            return (
              <div
                key={order.id}
                className={cn(
                  "bg-white rounded-lg border shadow-sm transition-all",
                  isDelivered
                    ? "border-green-200 bg-green-50/50"
                    : "border-gray-200"
                )}
              >
                <div className="flex items-center gap-1.5 p-1.5 sm:p-2">
                  {/* Photo / Avatar */}
                  <div className="flex-shrink-0">
                    {order.student_photo ? (
                      <button onClick={() => onViewPhoto(order.student_photo!)}>
                        <img
                          src={order.student_photo}
                          alt={name}
                          className={cn(
                            "rounded-full object-cover border-2 border-gray-200",
                            compact ? "h-8 w-8" : "h-10 w-10 sm:h-11 sm:w-11"
                          )}
                        />
                      </button>
                    ) : (
                      <div className={cn(
                        "rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200",
                        compact ? "h-8 w-8" : "h-10 w-10 sm:h-11 sm:w-11"
                      )}>
                        <span className={cn("text-gray-500 font-bold", compact ? "text-[10px]" : "text-xs")}>
                          {name[0]?.toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className={cn(
                        "font-bold truncate",
                        compact ? "text-[10px]" : "text-xs sm:text-sm",
                        isDelivered ? "text-green-800 line-through opacity-70" : "text-gray-900"
                      )}>
                        {name}
                      </p>
                      {order.ticket_code && (
                        <Badge variant="outline" className="text-[7px] flex-shrink-0 font-mono px-1 py-0">
                          🎫{order.ticket_code}
                        </Badge>
                      )}
                      <Badge
                        className={cn(
                          "text-[7px] flex-shrink-0 px-1 py-0 border",
                          order.payment_status === 'paid'
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        )}
                      >
                        {order.payment_status === 'paid' ? '✅ Pagado' : '⏳ Sin pagar'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {personType === 'students' && order.student_grade && (
                        <span className="text-[9px] text-gray-500 font-medium">
                          {order.student_grade} {order.student_section}
                        </span>
                      )}
                      {order.category_name && (
                        <Badge className="text-[7px] bg-orange-100 text-orange-700 hover:bg-orange-100 border border-orange-200 px-1 py-0">
                          {order.category_name}
                        </Badge>
                      )}
                      {order.is_no_order_delivery && (
                        <Badge className="text-[7px] bg-red-100 text-red-700 border border-red-200 px-1 py-0">
                          Sin pedido
                        </Badge>
                      )}
                    </div>
                    <p className={cn("text-gray-600 mt-0.5 truncate", compact ? "text-[9px]" : "text-[10px]")}>
                      {order.menu_main_course || 'Sin detalle'}
                    </p>
                    {/* Selecciones del plato armado */}
                    {order.selected_modifiers && order.selected_modifiers.length > 0 && (
                      <p className="text-[8px] text-blue-600 mt-0.5 truncate" title={order.selected_modifiers.map(m => `${m.group_name}: ${m.selected_name}`).join(' | ')}>
                        🍽️ {order.selected_modifiers.map(m => m.selected_name).join(', ')}
                      </p>
                    )}
                    {order.configurable_selections && order.configurable_selections.length > 0 && (
                      <p className="text-[8px] text-indigo-600 mt-0.5 truncate" title={order.configurable_selections.map(c => `${c.group_name}: ${(c as any).selected ?? c.selected_name}`).join(' | ')}>
                        🔧 {order.configurable_selections.map(c => (c as any).selected ?? c.selected_name).join(', ')}
                      </p>
                    )}
                    {order.selected_garnishes && order.selected_garnishes.length > 0 && (
                      <p className="text-[8px] text-green-600 mt-0.5 truncate" title={`Guarniciones: ${order.selected_garnishes.join(', ')}`}>
                        🥗 {order.selected_garnishes.join(', ')}
                      </p>
                    )}
                    {order.addons.length > 0 && (
                      <p className="text-[8px] text-purple-600 mt-0.5 truncate">
                        ➕ {order.addons.join(', ')}
                      </p>
                    )}
                    {order.observations && (
                      <p className="text-[8px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded mt-0.5 truncate" title={order.observations}>
                        📝 {order.observations}
                      </p>
                    )}
                  </div>

                  {/* Actions: Modify + Deliver */}
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    {/* Toggle delivered */}
                    <button
                      onClick={() => handleToggle(order)}
                      disabled={isToggling}
                      className={cn(
                        "rounded-lg flex items-center justify-center transition-all active:scale-90",
                        compact ? "h-10 w-10" : "h-11 w-11 sm:h-12 sm:w-12",
                        isToggling && "opacity-50",
                        isDelivered
                          ? "bg-green-500 text-white shadow-md shadow-green-200"
                          : "bg-gray-100 text-gray-400 hover:bg-orange-100 hover:text-orange-600 border-2 border-dashed border-gray-300"
                      )}
                    >
                      {isToggling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className={cn(compact ? "h-5 w-5" : "h-5 w-5 sm:h-6 sm:w-6")} />
                      )}
                    </button>

                    {/* Modify button */}
                    {!isDelivered && (
                      <button
                        onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                        className="h-6 w-full flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors rounded"
                        title="Modificar pedido"
                      >
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* EXPANDED: Inline modify */}
                {isExpanded && (
                  <InlineModify
                    order={order}
                    schoolId={schoolId}
                    todayStr={todayStr}
                    onSave={(updatedOrder) => {
                      onModifyOrder(updatedOrder);
                      setExpandedOrderId(null);
                    }}
                    onCancel={() => setExpandedOrderId(null)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* BOTTOM NAV */}
      {availableLists.length > 1 && (
        <div className="bg-white border-t px-2 py-1.5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={currentListIndex === 0}
              onClick={() => { setCurrentListIndex(i => i - 1); setSearchTerm(''); setShowListPicker(false); }}
              className="h-7 text-[10px] gap-1"
            >
              <ChevronLeft className="h-3 w-3" />
              Ant.
            </Button>
            <button
              onClick={() => setShowListPicker(!showListPicker)}
              className="text-center hover:bg-gray-50 rounded px-2 py-0.5 transition-colors"
            >
              <p className="text-[10px] font-bold text-gray-700">{currentListName}</p>
              <p className="text-[8px] text-blue-500 underline">{currentListIndex + 1}/{availableLists.length} · Ir a...</p>
            </button>
            <Button
              size="sm"
              disabled={isLastList}
              onClick={() => { setCurrentListIndex(i => i + 1); setSearchTerm(''); setShowListPicker(false); }}
              className={cn("h-7 text-[10px] gap-1", isLastList ? "bg-green-600 hover:bg-green-700" : "bg-orange-600 hover:bg-orange-700")}
            >
              {isLastList ? '✅ Listo' : 'Sig.'}
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>

          {/* Picker de lista rápida */}
          {showListPicker && (
            <div className="mt-1.5 p-2 bg-gray-50 rounded-lg border max-h-40 overflow-y-auto">
              <p className="text-[9px] font-semibold text-gray-500 mb-1.5">Ir directamente a:</p>
              <div className="grid grid-cols-3 gap-1">
                {availableLists.map((listName, idx) => (
                  <button
                    key={listName}
                    onClick={() => { setCurrentListIndex(idx); setSearchTerm(''); setShowListPicker(false); }}
                    className={cn(
                      "text-[10px] p-1.5 rounded border transition-all text-center truncate",
                      idx === currentListIndex
                        ? "bg-orange-100 border-orange-400 font-bold text-orange-800"
                        : "bg-white border-gray-200 hover:border-orange-300 hover:bg-orange-50"
                    )}
                  >
                    {listName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// INLINE MODIFY COMPONENT
// ==========================================

interface InlineModifyProps {
  order: DeliveryOrder;
  schoolId: string;
  todayStr: string;
  onSave: (updatedOrder: DeliveryOrder) => void;
  onCancel: () => void;
}

function InlineModify({ order, schoolId, todayStr, onSave, onCancel }: InlineModifyProps) {
  const { toast } = useToast();
  const [alternativeMenus, setAlternativeMenus] = useState<AvailableMenu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState(order.menu_id || '');
  const [saving, setSaving] = useState(false);
  const [loadingMenus, setLoadingMenus] = useState(true);

  useEffect(() => {
    fetchAlternativeMenus();
  }, []);

  const fetchAlternativeMenus = async () => {
    try {
      const categoryId = order.category_id;
      if (!categoryId) {
        setAlternativeMenus([]);
        setLoadingMenus(false);
        return;
      }

      const { data, error } = await supabase
        .from('lunch_menus')
        .select('id, main_course, starter, beverage, dessert, notes')
        .eq('school_id', schoolId)
        .eq('category_id', categoryId)
        .eq('date', order.order_date || todayStr);

      if (error) throw error;
      setAlternativeMenus(data || []);
    } catch (err) {
      console.error('Error fetching menus:', err);
    } finally {
      setLoadingMenus(false);
    }
  };

  const handleSave = async () => {
    if (selectedMenuId === order.menu_id) {
      onCancel();
      return;
    }

    setSaving(true);
    try {
      const newMenu = alternativeMenus.find(m => m.id === selectedMenuId);
      if (!newMenu) return;

      const { error } = await supabase
        .from('lunch_orders')
        .update({ menu_id: selectedMenuId })
        .eq('id', order.id);

      if (error) throw error;

      toast({ title: '✅ Menú modificado', description: `Cambiado a: ${newMenu.main_course || 'N/A'}` });

      onSave({
        ...order,
        menu_id: selectedMenuId,
        menu_main_course: newMenu.main_course,
        menu_starter: newMenu.starter,
        menu_beverage: newMenu.beverage,
        menu_dessert: newMenu.dessert,
        menu_notes: newMenu.notes,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo modificar.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t bg-blue-50/50 p-2 space-y-2">
      <p className="text-[10px] font-semibold text-blue-800">✏️ Cambiar plato (misma categoría):</p>

      {loadingMenus ? (
        <div className="space-y-1.5 animate-pulse">
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando platos disponibles...
          </div>
          {[1, 2].map(i => (
            <div key={i} className="h-12 bg-blue-100/50 rounded-lg border border-blue-200/50" />
          ))}
        </div>
      ) : alternativeMenus.length <= 1 ? (
        <p className="text-[10px] text-gray-500">No hay opciones alternativas en esta categoría.</p>
      ) : (
        <div className="space-y-1.5">
          {alternativeMenus.map(menu => (
            <button
              key={menu.id}
              onClick={() => setSelectedMenuId(menu.id)}
              className={cn(
                "w-full text-left p-2 rounded-lg border text-[10px] sm:text-xs transition-all",
                selectedMenuId === menu.id
                  ? "border-blue-500 bg-blue-100 shadow"
                  : "border-gray-200 hover:border-blue-300 bg-white"
              )}
            >
              <p className="font-semibold">{menu.main_course || 'Sin detalle'}</p>
              {menu.starter && <p className="text-gray-500">Entrada: {menu.starter}</p>}
              {menu.beverage && <p className="text-gray-500">Bebida: {menu.beverage}</p>}
              {menu.dessert && <p className="text-gray-500">Postre: {menu.dessert}</p>}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onCancel} className="h-7 text-[10px] flex-1">
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || selectedMenuId === order.menu_id}
          className="h-7 text-[10px] flex-1 bg-blue-600 hover:bg-blue-700"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
          Guardar cambio
        </Button>
      </div>
    </div>
  );
}

// ==========================================
// ADD WITHOUT ORDER MODAL
// ==========================================

interface AddWithoutOrderModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  userId: string;
  todayStr: string;
  personType: PersonType;
  onOrderCreated: () => void;
}

function AddWithoutOrderModal({ open, onClose, schoolId, userId, todayStr, personType, onOrderCreated }: AddWithoutOrderModalProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; full_name: string; grade?: string; section?: string; photo_url?: string }>>([]);
  const [selectedPerson, setSelectedPerson] = useState<{ id: string; full_name: string } | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [menus, setMenus] = useState<AvailableMenu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMenus, setLoadingMenus] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout>();

  // Reset on open
  useEffect(() => {
    if (open) {
      setSearchTerm('');
      setSearchResults([]);
      setSelectedPerson(null);
      setSelectedCategoryId('');
      setSelectedMenuId('');
      setMenus([]);
      fetchCategories();
    }
  }, [open]);

  const fetchCategories = async () => {
    try {
      const { data } = await supabase
        .from('lunch_categories')
        .select('id, name, price')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .neq('is_kitchen_sale', true)
        .order('name');
      setCategories((data || []).map(c => ({ id: c.id, name: c.name, price: c.price || 0 })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (term.trim().length < 2) { setSearchResults([]); return; }

    searchTimeout.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (personType === 'students') {
          const { data } = await supabase
            .from('students')
            .select('id, full_name, grade, section, photo_url')
            .eq('school_id', schoolId)
            .ilike('full_name', `%${term}%`)
            .limit(10);
          setSearchResults(data || []);
        } else {
          const { data } = await supabase
            .from('teacher_profiles')
            .select('id, full_name')
            .eq('school_id_1', schoolId)
            .ilike('full_name', `%${term}%`)
            .limit(10);
          setSearchResults((data || []).map(t => ({ id: t.id, full_name: t.full_name })));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleCategoryChange = async (catId: string) => {
    setSelectedCategoryId(catId);
    setSelectedMenuId('');
    setLoadingMenus(true);
    try {
      const targetType = personType === 'students' ? 'students' : 'teachers';
      const { data } = await supabase
        .from('lunch_menus')
        .select('id, main_course, starter, beverage, dessert, notes')
        .eq('school_id', schoolId)
        .eq('category_id', catId)
        .eq('date', todayStr)
        .or(`target_type.eq.${targetType},target_type.eq.both,target_type.is.null`);
      setMenus(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMenus(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedPerson || !selectedCategoryId || !selectedMenuId) return;
    setSubmitting(true);

    try {
      const category = categories.find(c => c.id === selectedCategoryId);
      if (!category) throw new Error('Categoría no encontrada');

      // Create lunch order as delivered + no_order
      const orderData: any = {
        menu_id: selectedMenuId,
        order_date: todayStr,
        status: 'delivered',
        category_id: selectedCategoryId,
        school_id: schoolId,
        quantity: 1,
        base_price: category.price,
        final_price: category.price,
        is_no_order_delivery: true,
        delivered_at: new Date().toISOString(),
        delivered_by: userId,
      };

      if (personType === 'students') {
        orderData.student_id = selectedPerson.id;
      } else {
        orderData.teacher_id = selectedPerson.id;
      }

      const { data: inserted, error: orderErr } = await supabase
        .from('lunch_orders')
        .insert([orderData])
        .select('id')
        .single();

      if (orderErr) throw orderErr;

      if (category.price > 0) {
        const txData: any = {
          type: 'purchase',
          amount: -Math.abs(category.price),
          description: `Almuerzo (sin pedido) - ${category.name} - ${format(new Date(todayStr + 'T00:00:00'), "d 'de' MMMM", { locale: es })}`,
          payment_status: 'pending',
          school_id: schoolId,
          created_by: userId,
          metadata: {
            lunch_order_id: inserted.id,
            source: 'delivery_no_order',
            order_date: todayStr,
            category_name: category.name,
            quantity: 1,
          },
          ...BILLING_EXCLUDED,
        };

        if (personType === 'students') {
          txData.student_id = selectedPerson.id;
        } else {
          txData.teacher_id = selectedPerson.id;
        }

        await supabase.from('transactions').insert([txData]);
      }

      toast({ title: '✅ Almuerzo registrado', description: `${selectedPerson.full_name} — ${category.name} (entregado + deuda generada)` });
      onOrderCreated();
      onClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo registrar.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5 text-green-600" />
            Agregar almuerzo sin pedido
          </DialogTitle>
          <DialogDescription className="text-xs">
            Entrega un almuerzo a alguien que no hizo pedido previo. Se generará una deuda pendiente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 1: Search person */}
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">
              1. Buscar {personType === 'students' ? 'alumno' : 'profesor'}
            </label>
            {selectedPerson ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-2">
                <p className="text-sm font-bold text-green-800 flex-1">{selectedPerson.full_name}</p>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedPerson(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder={`Nombre del ${personType === 'students' ? 'alumno' : 'profesor'}...`}
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                {loading && <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Buscando...</div>}
                {searchResults.length > 0 && (
                  <div className="mt-1 border rounded-lg max-h-40 overflow-y-auto divide-y">
                    {searchResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPerson({ id: p.id, full_name: p.full_name }); setSearchResults([]); setSearchTerm(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                      >
                        {p.photo_url ? (
                          <img src={p.photo_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500">
                            {p.full_name[0]}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-xs">{p.full_name}</p>
                          {p.grade && <p className="text-[10px] text-gray-500">{p.grade} {p.section}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Step 2: Select category */}
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">2. Categoría</label>
            <Select value={selectedCategoryId} onValueChange={handleCategoryChange}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Seleccionar categoría..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — S/{c.price.toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 3: Select menu */}
          {selectedCategoryId && (
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">3. Menú del día</label>
              {loadingMenus ? (
                <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" /> Cargando...</div>
              ) : menus.length === 0 ? (
                <p className="text-xs text-red-500">⚠️ No hay menús disponibles para esta categoría hoy.</p>
              ) : (
                <div className="space-y-1">
                  {menus.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMenuId(m.id)}
                      className={cn(
                        "w-full text-left p-2 rounded-lg border text-xs transition-all",
                        selectedMenuId === m.id
                          ? "border-green-500 bg-green-50 shadow"
                          : "border-gray-200 hover:border-green-300 bg-white"
                      )}
                    >
                      <p className="font-semibold">{m.main_course || 'Sin detalle'}</p>
                      {m.starter && <p className="text-gray-500 text-[10px]">Entrada: {m.starter}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} className="h-9 text-xs">Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedPerson || !selectedCategoryId || !selectedMenuId || submitting}
            className="h-9 text-xs bg-green-600 hover:bg-green-700"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            Entregar y generar deuda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export function LunchDeliveryDashboard({ schoolId, userId, userName, selectedDate: propDate, onClose }: LunchDeliveryDashboardProps) {
  const { toast } = useToast();

  // SessionStorage key
  const SESSION_KEY = `delivery_session_${schoolId}`;

  // Setup state
  const [setupDone, setSetupDone] = useState(false);
  const [mode, setMode] = useState<DeliveryMode | null>(null);
  const [personType, setPersonType] = useState<PersonType>('students');
  const [hasPendingSession, setHasPendingSession] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  
  // Starting point selection
  const [startingListIndex, setStartingListIndex] = useState(0);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<string>(''); // para modo by_grade_classroom

  // Data
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // Lists
  const [availableLists, setAvailableLists] = useState<string[]>([]);
  const [initialListIndex, setInitialListIndex] = useState(0);

  // Split-screen
  const [splitMode, setSplitMode] = useState(false);
  const [splitPersonType2, setSplitPersonType2] = useState<PersonType>('teachers');
  const [splitMode2, setSplitMode2] = useState<DeliveryMode>('all');
  const [splitLists2, setSplitLists2] = useState<string[]>(['Todos']);

  // Add without order
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalPersonType, setAddModalPersonType] = useState<PersonType>('students');

  // Photo viewer
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  // Summary
  const [summary, setSummary] = useState({ totalStudents: 0, totalTeachers: 0, classrooms: 0, grades: 0 });

  // Session tracking
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);

  // Presence (multi-admin)
  const [activeAdmins, setActiveAdmins] = useState<PresenceUser[]>([]);

  // Report
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  // Modification counter
  const modifyCountRef = useRef(0);

  // ==========================================
  // SESSION PERSISTENCE: save/restore from sessionStorage
  // ==========================================

  const saveSessionToStorage = useCallback(() => {
    if (!setupDone) return;
    try {
      // Calcular la fecha objetivo (igual que todayStr)
      let dateToSave = propDate;
      if (!dateToSave) {
        const now = new Date();
        const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
        dateToSave = format(peruTime, 'yyyy-MM-dd');
      }
      const data = {
        date: dateToSave,
        mode,
        personType,
        paymentFilter,
        sessionId,
        sessionStartedAt,
        modifyCount: modifyCountRef.current,
        selectedGradeFilter,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {}
  }, [setupDone, mode, personType, sessionId, sessionStartedAt, SESSION_KEY, propDate, paymentFilter, selectedGradeFilter]);

  const clearSessionStorage = useCallback(() => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }, [SESSION_KEY]);

  // Save session state on every relevant change
  useEffect(() => {
    if (setupDone) saveSessionToStorage();
  }, [setupDone, saveSessionToStorage]);

  // Save before browser close/refresh
  useEffect(() => {
    const handleBeforeUnload = () => { saveSessionToStorage(); };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveSessionToStorage]);

  // Check for pending session on mount — comparar con la fecha seleccionada (no solo hoy)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        // Calcular la fecha objetivo
        let targetDate = propDate;
        if (!targetDate) {
          const now = new Date();
          const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
          targetDate = format(peruTime, 'yyyy-MM-dd');
        }
        if (data.date === targetDate && data.mode) {
          setHasPendingSession(true);
          setMode(data.mode);
          setPersonType(data.personType || 'students');
          if (data.paymentFilter) setPaymentFilter(data.paymentFilter);
          if (data.sessionId) setSessionId(data.sessionId);
          if (data.sessionStartedAt) setSessionStartedAt(data.sessionStartedAt);
          if (data.modifyCount) modifyCountRef.current = data.modifyCount;
          if (data.selectedGradeFilter) setSelectedGradeFilter(data.selectedGradeFilter);
        } else {
          // Session from a different day, remove
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
    } catch {}
  }, [SESSION_KEY, propDate]);

  // Si se pasa selectedDate como prop, usarla; sino, calcular la fecha actual (hora Perú)
  const todayStr = useMemo(() => {
    if (propDate) return propDate;
    const now = new Date();
    const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    return format(peruTime, 'yyyy-MM-dd');
  }, [propDate]);

  // Pedidos filtrados según el filtro de pago elegido en el setup
  const deliveryOrders = useMemo(() => {
    if (paymentFilter === 'paid') return orders.filter(o => o.payment_status === 'paid');
    if (paymentFilter === 'unpaid') return orders.filter(o => o.payment_status === 'unpaid');
    return orders;
  }, [orders, paymentFilter]);

  // Conteos rápidos para mostrar en el resumen y setup
  const paymentCounts = useMemo(() => ({
    paid: orders.filter(o => o.payment_status === 'paid').length,
    unpaid: orders.filter(o => o.payment_status === 'unpaid').length,
    total: orders.length,
  }), [orders]);

  // Pre-calcular grados y aulas disponibles para el setup
  const availableGrades = useMemo(() => {
    const studentOrders = deliveryOrders.filter(o => o.student_id);
    return [...new Set(studentOrders.map(o => o.student_grade).filter(Boolean) as string[])].sort();
  }, [deliveryOrders]);

  const availableClassrooms = useMemo(() => {
    const studentOrders = deliveryOrders.filter(o => o.student_id);
    return [...new Set(studentOrders.map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim()).filter(Boolean))].sort();
  }, [deliveryOrders]);

  // Aulas del grado seleccionado (para modo by_grade_classroom)
  const classroomsInGrade = useMemo(() => {
    if (!selectedGradeFilter) return [];
    const studentOrders = deliveryOrders.filter(o => o.student_id && o.student_grade === selectedGradeFilter);
    return [...new Set(studentOrders.map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim()).filter(Boolean))].sort();
  }, [deliveryOrders, selectedGradeFilter]);

  // Preview de la lista según el modo actual (para el selector de punto de inicio)
  const previewLists = useMemo(() => {
    if (!mode || personType !== 'students') return [];
    if (mode === 'by_classroom') return availableClassrooms;
    if (mode === 'by_grade') return availableGrades;
    if (mode === 'by_grade_classroom') return classroomsInGrade;
    return [];
  }, [mode, personType, availableClassrooms, availableGrades, classroomsInGrade]);

  // Resetear startingListIndex si queda fuera de rango al cambiar de modo/grado
  useEffect(() => {
    if (startingListIndex >= previewLists.length && previewLists.length > 0) {
      setStartingListIndex(0);
    }
  }, [previewLists, startingListIndex]);

  // ==========================================
  // PRESENCE: Multi-admin awareness
  // ==========================================

  useEffect(() => {
    if (!setupDone) return;

    const presenceChannel = supabase.channel(`delivery-presence-${schoolId}-${todayStr}`, {
      config: { presence: { key: userId } },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const users: PresenceUser[] = [];
        Object.values(state).forEach((presences: any) => {
          presences.forEach((p: any) => {
            if (p.id !== userId) {
              users.push({ id: p.id, name: p.name, joinedAt: p.joinedAt });
            }
          });
        });
        setActiveAdmins(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            id: userId,
            name: userName || 'Admin',
            joinedAt: new Date().toISOString(),
          });
        }
      });

    return () => {
      presenceChannel.untrack();
      supabase.removeChannel(presenceChannel);
    };
  }, [setupDone, schoolId, todayStr, userId, userName]);

  // ==========================================
  // SESSION: Create on start, update on finish
  // ==========================================

  const createSession = async () => {
    try {
      const { data, error } = await supabase
        .from('delivery_sessions')
        .insert([{
          school_id: schoolId,
          session_date: todayStr,
          started_by: userId,
          status: 'in_progress',
        }])
        .select('id')
        .single();

      if (error) throw error;
      if (data) {
        setSessionId(data.id);
        setSessionStartedAt(new Date().toISOString());
      }
    } catch (err) {
      // Non-critical: session tracking is optional
      console.error('Error creating delivery session:', err);
    }
  };

  // ==========================================
  // GENERATE REPORT
  // ==========================================

  const generateReport = useCallback((): DeliveryReport => {
    const endedAt = new Date().toISOString();
    const studentOrders = deliveryOrders.filter(o => o.student_id);
    const teacherOrders = deliveryOrders.filter(o => o.teacher_id);
    const allOrders = deliveryOrders;

    const delivered = allOrders.filter(o => o.status === 'delivered');
    const notCollected = allOrders.filter(o => o.status !== 'delivered');
    const addedNoOrder = allOrders.filter(o => o.is_no_order_delivery);

    // By category
    const catMap = new Map<string, { delivered: number; pending: number }>();
    allOrders.forEach(o => {
      const cat = o.category_name || 'Sin categoría';
      const entry = catMap.get(cat) || { delivered: 0, pending: 0 };
      if (o.status === 'delivered') entry.delivered++;
      else entry.pending++;
      catMap.set(cat, entry);
    });

    // By classroom
    const clsMap = new Map<string, { delivered: number; pending: number }>();
    studentOrders.forEach(o => {
      const cls = `${o.student_grade || ''} ${o.student_section || ''}`.trim() || 'Sin aula';
      const entry = clsMap.get(cls) || { delivered: 0, pending: 0 };
      if (o.status === 'delivered') entry.delivered++;
      else entry.pending++;
      clsMap.set(cls, entry);
    });

    return {
      sessionDate: todayStr,
      startedAt: sessionStartedAt || new Date().toISOString(),
      endedAt,
      totalOrders: allOrders.length,
      totalDelivered: delivered.length,
      totalNotCollected: notCollected.length,
      totalModified: modifyCountRef.current,
      totalAddedWithoutOrder: addedNoOrder.length,
      totalStudents: studentOrders.length,
      totalTeachers: teacherOrders.length,
      byCategory: Array.from(catMap.entries()).map(([name, data]) => ({ name, ...data })),
      byClassroom: Array.from(clsMap.entries()).map(([name, data]) => ({ name, ...data })),
      deliveredList: delivered.map(o => {
        const selParts: string[] = [];
        if (o.selected_modifiers?.length) selParts.push(o.selected_modifiers.map(m => m.selected_name).join(', '));
        if (o.configurable_selections?.length) selParts.push(o.configurable_selections.map(c => (c as any).selected ?? c.selected_name ?? '').join(', '));
        if (o.selected_garnishes?.length) selParts.push(o.selected_garnishes.join(', '));
        const plateDetail = [o.menu_main_course, selParts.length > 0 ? `(${selParts.join(' | ')})` : ''].filter(Boolean).join(' ');
        return {
          name: o.student_name || o.teacher_name || 'N/A',
          category: o.category_name || '',
          plate: plateDetail || '',
          time: o.delivered_at ? format(new Date(o.delivered_at), 'HH:mm') : '',
        };
      }),
      notCollectedList: notCollected.map(o => {
        const selParts: string[] = [];
        if (o.selected_modifiers?.length) selParts.push(o.selected_modifiers.map(m => m.selected_name).join(', '));
        if (o.configurable_selections?.length) selParts.push(o.configurable_selections.map(c => (c as any).selected ?? c.selected_name ?? '').join(', '));
        if (o.selected_garnishes?.length) selParts.push(o.selected_garnishes.join(', '));
        const plateDetail = [o.menu_main_course, selParts.length > 0 ? `(${selParts.join(' | ')})` : ''].filter(Boolean).join(' ');
        return {
          name: o.student_name || o.teacher_name || 'N/A',
          category: o.category_name || '',
          plate: plateDetail || '',
        };
      }),
      addedWithoutOrderList: addedNoOrder.map(o => ({
        name: o.student_name || o.teacher_name || 'N/A',
        category: o.category_name || '',
        plate: o.menu_main_course || '',
      })),
    };
  }, [deliveryOrders, todayStr, sessionStartedAt]);

  // ==========================================
  // FINISH DELIVERY + SAVE REPORT
  // ==========================================

  const handleFinishDelivery = async () => {
    setSavingReport(true);
    try {
      const reportData = generateReport();
      setReport(reportData);

      // Save to DB
      if (sessionId) {
        await supabase
          .from('delivery_sessions')
          .update({
            ended_at: reportData.endedAt,
            ended_by: userId,
            status: 'completed',
            total_orders: reportData.totalOrders,
            total_delivered: reportData.totalDelivered,
            total_not_collected: reportData.totalNotCollected,
            total_modified: reportData.totalModified,
            total_added_without_order: reportData.totalAddedWithoutOrder,
            total_students: reportData.totalStudents,
            total_teachers: reportData.totalTeachers,
            report_data: reportData,
          })
          .eq('id', sessionId);
      } else {
        // Create + complete in one go
        await supabase.from('delivery_sessions').insert([{
          school_id: schoolId,
          session_date: todayStr,
          started_by: userId,
          ended_by: userId,
          started_at: reportData.startedAt,
          ended_at: reportData.endedAt,
          status: 'completed',
          total_orders: reportData.totalOrders,
          total_delivered: reportData.totalDelivered,
          total_not_collected: reportData.totalNotCollected,
          total_modified: reportData.totalModified,
          total_added_without_order: reportData.totalAddedWithoutOrder,
          total_students: reportData.totalStudents,
          total_teachers: reportData.totalTeachers,
          report_data: reportData,
        }]);
      }

      setShowFinishConfirm(false);
      setShowReport(true);
      clearSessionStorage();
      toast({ title: '✅ Entrega finalizada', description: 'Reporte generado y guardado correctamente.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo guardar el reporte.' });
    } finally {
      setSavingReport(false);
    }
  };

  // ==========================================
  // DOWNLOAD PDF REPORT
  // ==========================================

  const downloadPDFReport = (reportData: DeliveryReport) => {
    try {
      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();

      // Header
      doc.setFillColor(234, 88, 12); // orange-600
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('REPORTE DE ENTREGA DE ALMUERZOS', pageW / 2, 12, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(
        format(new Date(reportData.sessionDate + 'T00:00:00'), "EEEE d 'de' MMMM, yyyy", { locale: es }),
        pageW / 2, 22, { align: 'center' }
      );

      // Summary section
      let y = 38;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('RESUMEN GENERAL', 14, y);

      y += 3;
      autoTable(doc, {
        startY: y,
        head: [['Concepto', 'Cantidad']],
        body: [
          ['Total Pedidos', reportData.totalOrders.toString()],
          ['Entregados', reportData.totalDelivered.toString()],
          ['No Recogidos', reportData.totalNotCollected.toString()],
          ['Modificados', reportData.totalModified.toString()],
          ['Agregados sin Pedido', reportData.totalAddedWithoutOrder.toString()],
          ['Pedidos de Alumnos', reportData.totalStudents.toString()],
          ['Pedidos de Profesores', reportData.totalTeachers.toString()],
        ],
        theme: 'grid',
        headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'center', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 },
      });

      // By category
      y = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('DESGLOSE POR CATEGORIA', 14, y);

      y += 3;
      autoTable(doc, {
        startY: y,
        head: [['Categoria', 'Entregados', 'Pendientes', 'Total']],
        body: reportData.byCategory.map(c => [
          c.name,
          c.delivered.toString(),
          c.pending.toString(),
          (c.delivered + c.pending).toString(),
        ]),
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 },
      });

      // By classroom
      if (reportData.byClassroom.length > 0) {
        y = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('DESGLOSE POR AULA', 14, y);

        y += 3;
        autoTable(doc, {
          startY: y,
          head: [['Aula', 'Entregados', 'Pendientes', 'Total']],
          body: reportData.byClassroom.map(c => [
            c.name,
            c.delivered.toString(),
            c.pending.toString(),
            (c.delivered + c.pending).toString(),
          ]),
          theme: 'grid',
          headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold', fontSize: 9 },
          bodyStyles: { fontSize: 9 },
          columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center', fontStyle: 'bold' } },
          margin: { left: 14, right: 14 },
        });
      }

      // Not collected list
      if (reportData.notCollectedList.length > 0) {
        y = (doc as any).lastAutoTable.finalY + 10;
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(220, 38, 38);
        doc.text('NO RECOGIDOS', 14, y);
        doc.setTextColor(0, 0, 0);

        y += 3;
        autoTable(doc, {
          startY: y,
          head: [['Nombre', 'Categoria', 'Plato']],
          body: reportData.notCollectedList.map(o => [o.name, o.category, o.plate]),
          theme: 'grid',
          headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold', fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
      }

      // Added without order
      if (reportData.addedWithoutOrderList.length > 0) {
        y = (doc as any).lastAutoTable.finalY + 10;
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('AGREGADOS SIN PEDIDO (DEUDA GENERADA)', 14, y);

        y += 3;
        autoTable(doc, {
          startY: y,
          head: [['Nombre', 'Categoria', 'Plato']],
          body: reportData.addedWithoutOrderList.map(o => [o.name, o.category, o.plate]),
          theme: 'grid',
          headStyles: { fillColor: [147, 51, 234], textColor: 255, fontStyle: 'bold', fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
      }

      // Footer
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(160, 160, 160);
        doc.text(
          `Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")} · ERP Profesional · Lima Cafe 28`,
          pageW / 2,
          doc.internal.pageSize.height - 6,
          { align: 'center' }
        );
        doc.text(`Pag. ${i}/${pageCount}`, pageW - 14, doc.internal.pageSize.height - 6, { align: 'right' });
      }

      doc.save(`Reporte_Entrega_${reportData.sessionDate}.pdf`);
      toast({ title: '✅ PDF descargado' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo generar el PDF.' });
    }
  };

  // ==========================================
  // FETCH ORDERS
  // ==========================================

  const fetchTodayOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { data: ordersData, error } = await supabase
        .from('lunch_orders')
        .select(`
          id, order_date, status, is_cancelled, created_at,
          delivered_at, delivered_by, menu_id, category_id,
          quantity, base_price, final_price, is_no_order_delivery,
          student_id, teacher_id, parent_notes,
          selected_modifiers, configurable_selections, selected_garnishes,
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

      // Categories
      const categoryIds = [...new Set(
        (ordersData || []).map(o => (o.lunch_menus as any)?.category_id || o.category_id).filter(Boolean) as string[]
      )];

      let categoriesMap = new Map<string, string>();
      if (categoryIds.length > 0) {
        const { data: cats } = await supabase.from('lunch_categories').select('id, name').in('id', categoryIds);
        if (cats) cats.forEach(c => categoriesMap.set(c.id, c.name));
      }

      // Ticket codes + estado de pago — filtrado por school_id para performance
      const orderIds = (ordersData || []).map(o => o.id);
      let ticketMap = new Map<string, string>();
      let paidOrderIds = new Set<string>();

      if (orderIds.length > 0) {
        // 1. Transacciones tipo 'purchase' (pago en caja/POS)
        const { data: txData } = await supabase
          .from('transactions')
          .select('metadata, ticket_code, type')
          .in('type', ['purchase', 'debit'])
          .eq('school_id', schoolId)
          .eq('is_deleted', false)
          .neq('payment_status', 'cancelled')
          .not('metadata', 'is', null);

        if (txData) {
          txData.forEach((tx: any) => {
            const loid = tx.metadata?.lunch_order_id;
            if (loid && orderIds.includes(loid)) {
              paidOrderIds.add(loid);
              if (tx.ticket_code) ticketMap.set(loid, tx.ticket_code);
            }
          });
        }

        // 2. Vouchers aprobados (pago por imagen de voucher)
        // Nota: recharge_requests NO tiene columna 'metadata', usa 'lunch_order_ids' (array)
        const { data: voucherData } = await supabase
          .from('recharge_requests')
          .select('lunch_order_ids, status')
          .eq('status', 'approved')
          .eq('school_id', schoolId)
          .in('request_type', ['lunch_payment', 'debt_payment'])
          .not('lunch_order_ids', 'is', null);

        if (voucherData) {
          voucherData.forEach((vr: any) => {
            const loids: string[] = vr.lunch_order_ids || [];
            loids.forEach((id: string) => { if (orderIds.includes(id)) paidOrderIds.add(id); });
          });
        }
      }

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
          observations: [o.parent_notes, o.lunch_menus?.notes].filter(Boolean).join(' | ') || null,
          payment_status: paidOrderIds.has(o.id) ? 'paid' : 'unpaid',
          selected_modifiers: o.selected_modifiers || null,
          configurable_selections: o.configurable_selections || null,
          selected_garnishes: o.selected_garnishes || null,
        };
      });

      setOrders(mapped);

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
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los pedidos.' });
    } finally {
      setLoading(false);
    }
  }, [todayStr, schoolId]);

  useEffect(() => { fetchTodayOrders(); }, [fetchTodayOrders]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`delivery-realtime-${schoolId}-${todayStr}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'lunch_orders',
        filter: `order_date=eq.${todayStr}`,
      }, (payload) => {
        const updated = payload.new as any;
        setOrders(prev => prev.map(o =>
          o.id === updated.id
            ? { ...o, status: updated.status, delivered_at: updated.delivered_at, delivered_by: updated.delivered_by, is_cancelled: updated.is_cancelled }
            : o
        ));
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'lunch_orders',
        filter: `order_date=eq.${todayStr}`,
      }, () => {
        // Re-fetch on inserts (new orders from add-without-order)
        fetchTodayOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [todayStr, fetchTodayOrders]);

  // ==========================================
  // TOGGLE DELIVERED
  // ==========================================

  const toggleDelivered = async (order: DeliveryOrder) => {
    const isDelivered = order.status === 'delivered';
    const newStatus = isDelivered ? 'pending' : 'delivered';

    // Optimistic update FIRST
    setOrders(prev => prev.map(o =>
      o.id === order.id
        ? { ...o, status: newStatus, delivered_at: isDelivered ? null : new Date().toISOString(), delivered_by: isDelivered ? null : userId }
        : o
    ));

    try {
      const { error } = await supabase
        .from('lunch_orders')
        .update({
          status: newStatus,
          delivered_at: isDelivered ? null : new Date().toISOString(),
          delivered_by: isDelivered ? null : userId,
        })
        .eq('id', order.id);

      if (error) throw error;
    } catch (error: any) {
      // Revert optimistic
      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, status: order.status, delivered_at: order.delivered_at, delivered_by: order.delivered_by } : o
      ));
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo actualizar.' });
    }
  };

  // ==========================================
  // MODIFY ORDER (from inline)
  // ==========================================

  const handleModifyOrder = (updatedOrder: DeliveryOrder) => {
    setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    modifyCountRef.current += 1;
  };

  // ==========================================
  // START DELIVERY
  // ==========================================

  const buildLists = (pType: PersonType, dMode: DeliveryMode, sourceOrders?: DeliveryOrder[], gradeFilter?: string): string[] => {
    const base = sourceOrders ?? deliveryOrders;
    const typeOrders = pType === 'students'
      ? base.filter(o => o.student_id)
      : base.filter(o => o.teacher_id);

    if (dMode === 'by_classroom') {
      const cls = [...new Set(typeOrders.map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim()).filter(Boolean))].sort();
      return cls.length > 0 ? cls : ['Todos'];
    } else if (dMode === 'by_grade') {
      const gr = [...new Set(typeOrders.map(o => o.student_grade).filter(Boolean) as string[])].sort();
      return gr.length > 0 ? gr : ['Todos'];
    } else if (dMode === 'by_grade_classroom') {
      // Filtrar solo aulas del grado seleccionado
      const gf = gradeFilter || selectedGradeFilter;
      if (!gf) {
        // Sin grado seleccionado, mostrar todas las aulas agrupadas por grado
        const cls = [...new Set(typeOrders.map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim()).filter(Boolean))].sort();
        return cls.length > 0 ? cls : ['Todos'];
      }
      const cls = [...new Set(
        typeOrders
          .filter(o => o.student_grade === gf)
          .map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim())
          .filter(Boolean)
      )].sort();
      return cls.length > 0 ? cls : ['Todos'];
    }
    return ['Todos'];
  };

  const startDelivery = (isResume = false) => {
    if (!mode) return;

    const typeOrders = personType === 'students'
      ? deliveryOrders.filter(o => o.student_id)
      : deliveryOrders.filter(o => o.teacher_id);

    if (typeOrders.length === 0) {
      const filterLabel = paymentFilter === 'paid' ? ' pagados' : paymentFilter === 'unpaid' ? ' sin pagar' : '';
      toast({ variant: 'destructive', title: 'Sin pedidos', description: `No hay pedidos${filterLabel} de ${personType === 'students' ? 'alumnos' : 'profesores'} para ${format(new Date(todayStr + 'T12:00:00'), "d 'de' MMMM", { locale: es })}.` });
      return;
    }

    const lists = buildLists(personType, mode);
    setAvailableLists(lists);
    setSplitLists2(buildLists(splitPersonType2, splitMode2));
    setInitialListIndex(startingListIndex < lists.length ? startingListIndex : 0);
    setSetupDone(true);
    if (!isResume) createSession();
  };

  // ==========================================
  // SPLIT SCREEN TOGGLE
  // ==========================================

  const handleToggleSplit = () => {
    if (!splitMode) {
      // Entering split: set secondary panel defaults
      const newType: PersonType = personType === 'students' ? 'teachers' : 'students';
      setSplitPersonType2(newType);
      setSplitMode2('all');
      setSplitLists2(buildLists(newType, 'all'));
    }
    setSplitMode(!splitMode);
  };

  // ==========================================
  // RENDER: SETUP
  // ==========================================

  if (!setupDone) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 p-3 sm:p-6">
        <div className="max-w-2xl mx-auto">
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
                {format(new Date(todayStr + 'T12:00:00'), "EEEE d 'de' MMMM, yyyy", { locale: es })}
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
              {/* PENDING SESSION BANNER */}
              {hasPendingSession && (
                <Card className="mb-6 border-2 border-orange-400 bg-orange-50/80 backdrop-blur shadow-lg animate-in fade-in-0 slide-in-from-top-2">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="bg-orange-200 rounded-full p-2 flex-shrink-0">
                        <RotateCcw className="h-5 w-5 text-orange-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-orange-800">
                          Tienes una entrega en curso
                        </p>
                        <p className="text-xs text-orange-600 mt-0.5">
                          {sessionStartedAt
                            ? `Iniciada a las ${format(new Date(sessionStartedAt), 'HH:mm')}`
                            : 'Sesión anterior no finalizada'}
                          {' · '}
                          {deliveryOrders.filter(o => o.status === 'delivered').length}/{deliveryOrders.length} entregados
                          {paymentFilter !== 'all' && ` (${paymentFilter === 'paid' ? 'pagados' : 'sin pagar'})`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button
                        className="flex-1 h-10 text-sm font-bold bg-orange-600 hover:bg-orange-700"
                        onClick={() => startDelivery(true)}
                      >
                        <RotateCcw className="h-4 w-4 mr-1.5" />
                        Continuar donde me quedé
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10 text-xs border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => setShowFinishConfirm(true)}
                      >
                        <Flag className="h-3.5 w-3.5 mr-1" />
                        Finalizar
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-10 text-xs text-gray-500"
                        onClick={() => { setHasPendingSession(false); clearSessionStorage(); setSessionId(null); setSessionStartedAt(null); modifyCountRef.current = 0; }}
                      >
                        Descartar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

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
                      onClick={() => { setPersonType('students'); }}
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
                      onClick={() => { setPersonType('teachers'); setMode(null); setSelectedGradeFilter(''); setStartingListIndex(0); }}
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

              {/* Mode */}
              <Card className="mb-6 bg-white/80 backdrop-blur">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">¿Cómo vas a repartir?</p>
                  <div className="grid grid-cols-2 gap-3">
                    {personType === 'students' && (
                      <>
                        <button
                          onClick={() => { setMode('by_classroom'); setStartingListIndex(0); setSelectedGradeFilter(''); }}
                          className={cn(
                            "p-4 rounded-xl border-2 transition-all text-center",
                            mode === 'by_classroom' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
                          )}
                        >
                          <LayoutGrid className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                          <p className="font-bold text-sm">Por Aulas</p>
                          <p className="text-[10px] text-gray-500">Una lista por aula</p>
                        </button>
                        <button
                          onClick={() => { setMode('by_grade'); setStartingListIndex(0); setSelectedGradeFilter(''); }}
                          className={cn(
                            "p-4 rounded-xl border-2 transition-all text-center",
                            mode === 'by_grade' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
                          )}
                        >
                          <GraduationCap className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                          <p className="font-bold text-sm">Por Grados</p>
                          <p className="text-[10px] text-gray-500">Una lista por grado</p>
                        </button>
                        <button
                          onClick={() => { setMode('by_grade_classroom'); setStartingListIndex(0); setSelectedGradeFilter(''); }}
                          className={cn(
                            "p-4 rounded-xl border-2 transition-all text-center col-span-2",
                            mode === 'by_grade_classroom' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
                          )}
                        >
                          <div className="flex items-center justify-center gap-1 mb-1">
                            <GraduationCap className="h-5 w-5 text-orange-600" />
                            <span className="text-orange-600 font-bold">+</span>
                            <LayoutGrid className="h-5 w-5 text-orange-600" />
                          </div>
                          <p className="font-bold text-sm">Grado y Aula</p>
                          <p className="text-[10px] text-gray-500">Elige el grado y luego sus aulas</p>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setMode('alphabetical'); setStartingListIndex(0); setSelectedGradeFilter(''); }}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all text-center",
                        mode === 'alphabetical' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
                      )}
                    >
                      <SortAsc className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                      <p className="font-bold text-sm">Alfabético</p>
                      <p className="text-[10px] text-gray-500">A-Z por nombre</p>
                    </button>
                    <button
                      onClick={() => { setMode('all'); setStartingListIndex(0); setSelectedGradeFilter(''); }}
                      className={cn(
                        "p-4 rounded-xl border-2 transition-all text-center",
                        mode === 'all' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
                      )}
                    >
                      <Users className="h-6 w-6 mx-auto mb-1 text-orange-600" />
                      <p className="font-bold text-sm">Todos a la vez</p>
                      <p className="text-[10px] text-gray-500">Con filtros</p>
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Selector de grado (para modo by_grade_classroom) */}
              {mode === 'by_grade_classroom' && personType === 'students' && (
                <Card className="mb-6 bg-white/80 backdrop-blur border-2 border-orange-200">
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">📚 Selecciona el grado</p>
                    <div className="grid grid-cols-3 gap-2">
                      {availableGrades.map(grade => {
                        const count = deliveryOrders.filter(o => o.student_id && o.student_grade === grade).length;
                        return (
                          <button
                            key={grade}
                            onClick={() => { setSelectedGradeFilter(grade); setStartingListIndex(0); }}
                            className={cn(
                              "p-3 rounded-lg border-2 transition-all text-center",
                              selectedGradeFilter === grade
                                ? "border-orange-500 bg-orange-50 shadow-md"
                                : "border-gray-200 hover:border-orange-300"
                            )}
                          >
                            <p className="font-bold text-sm">{grade}</p>
                            <p className="text-[10px] text-gray-500">{count} pedidos</p>
                          </button>
                        );
                      })}
                    </div>
                    {selectedGradeFilter && classroomsInGrade.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-semibold text-gray-600 mb-2">
                          🏫 Aulas en {selectedGradeFilter} ({classroomsInGrade.length}):
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {classroomsInGrade.map(cls => {
                            const count = deliveryOrders.filter(o => 
                              o.student_id && `${o.student_grade || ''} ${o.student_section || ''}`.trim() === cls
                            ).length;
                            return (
                              <Badge key={cls} className="bg-orange-100 text-orange-700 text-[10px]">
                                {cls} ({count})
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Selector de punto de inicio */}
              {mode && (mode === 'by_classroom' || mode === 'by_grade' || (mode === 'by_grade_classroom' && selectedGradeFilter)) && personType === 'students' && previewLists.length > 1 && (
                <Card className="mb-6 bg-white/80 backdrop-blur border-2 border-blue-200">
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">
                      🎯 ¿Por dónde quieres empezar?
                    </p>
                    <Select
                      value={String(startingListIndex)}
                      onValueChange={(v) => setStartingListIndex(Number(v))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecciona el aula o grado inicial" />
                      </SelectTrigger>
                      <SelectContent>
                        {previewLists.map((list, idx) => {
                          const count = mode === 'by_grade'
                            ? deliveryOrders.filter(o => o.student_id && o.student_grade === list).length
                            : deliveryOrders.filter(o => o.student_id && `${o.student_grade || ''} ${o.student_section || ''}`.trim() === list).length;
                          return (
                            <SelectItem key={list} value={String(idx)}>
                              {list} — {count} pedido{count !== 1 ? 's' : ''}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-gray-400 mt-2">
                      Empezarás en <strong>{previewLists[startingListIndex] || previewLists[0]}</strong> y luego avanzarás a las siguientes.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Filtro de estado de pago */}
              <Card className="mb-6 bg-white/80 backdrop-blur">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-1">¿Qué pedidos quieres ver?</p>
                  <p className="text-xs text-gray-400 mb-3">
                    Pagados: <span className="font-bold text-green-600">{paymentCounts.paid}</span>
                    {' · '}
                    Sin pagar: <span className="font-bold text-red-500">{paymentCounts.unpaid}</span>
                    {' · '}
                    Total: <span className="font-bold text-gray-700">{paymentCounts.total}</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setPaymentFilter('all')}
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all text-center",
                        paymentFilter === 'all'
                          ? "border-orange-500 bg-orange-50 shadow-md scale-[1.02]"
                          : "border-gray-200 hover:border-orange-300"
                      )}
                    >
                      <div className="text-xl mb-1">📋</div>
                      <p className="font-bold text-xs text-gray-800">Todos</p>
                      <p className="text-[10px] text-gray-500">{paymentCounts.total} pedidos</p>
                    </button>
                    <button
                      onClick={() => setPaymentFilter('paid')}
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all text-center",
                        paymentFilter === 'paid'
                          ? "border-green-500 bg-green-50 shadow-md scale-[1.02]"
                          : "border-gray-200 hover:border-green-300"
                      )}
                    >
                      <div className="text-xl mb-1">✅</div>
                      <p className="font-bold text-xs text-green-700">Pagados</p>
                      <p className="text-[10px] text-gray-500">{paymentCounts.paid} pedidos</p>
                    </button>
                    <button
                      onClick={() => setPaymentFilter('unpaid')}
                      className={cn(
                        "p-3 rounded-xl border-2 transition-all text-center",
                        paymentFilter === 'unpaid'
                          ? "border-red-500 bg-red-50 shadow-md scale-[1.02]"
                          : "border-gray-200 hover:border-red-300"
                      )}
                    >
                      <div className="text-xl mb-1">⏳</div>
                      <p className="font-bold text-xs text-red-600">Sin pagar</p>
                      <p className="text-[10px] text-gray-500">{paymentCounts.unpaid} pedidos</p>
                    </button>
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={() => startDelivery()}
                disabled={!mode || (mode === 'by_grade_classroom' && !selectedGradeFilter)}
                className="w-full h-14 text-lg font-bold bg-orange-600 hover:bg-orange-700 rounded-xl shadow-lg"
              >
                <UtensilsCrossed className="h-5 w-5 mr-2" />
                🚀 Iniciar Entrega
                {mode === 'by_grade_classroom' && selectedGradeFilter && (
                  <span className="ml-2 text-sm font-normal opacity-80">({selectedGradeFilter})</span>
                )}
                {paymentFilter !== 'all' && (
                  <span className="ml-2 text-sm font-normal opacity-80">
                    ({paymentFilter === 'paid' ? `${paymentCounts.paid} pagados` : `${paymentCounts.unpaid} sin pagar`})
                  </span>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: DELIVERY VIEW (with split support)
  // ==========================================

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* GLOBAL TOP BAR */}
      <div className="bg-white border-b shadow-sm px-3 py-1.5 flex items-center gap-2 flex-shrink-0 z-40">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSetupDone(false)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-sm truncate">
              🍽️ Entrega
            </h1>
            <Badge className="bg-orange-100 text-orange-700 text-[9px] flex-shrink-0">
              {format(new Date(todayStr + 'T12:00:00'), "d MMM", { locale: es })}
            </Badge>
            {/* Filtro de pago activo */}
            {paymentFilter === 'paid' && (
              <Badge className="bg-green-100 text-green-700 text-[8px] flex-shrink-0">✅ Pagados</Badge>
            )}
            {paymentFilter === 'unpaid' && (
              <Badge className="bg-red-100 text-red-600 text-[8px] flex-shrink-0">⏳ Sin pagar</Badge>
            )}
            {/* Active admins indicator */}
            {activeAdmins.length > 0 && (
              <Badge className="bg-green-100 text-green-700 text-[8px] flex-shrink-0 gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 [animation:pulse_3s_ease-in-out_infinite]" />
                {activeAdmins.length} admin{activeAdmins.length > 1 ? 's' : ''} en línea
              </Badge>
            )}
          </div>
        </div>

        {/* Split toggle */}
        <Button
          variant={splitMode ? 'default' : 'outline'}
          size="sm"
          className={cn("h-7 text-[10px] gap-1", splitMode && "bg-purple-600 hover:bg-purple-700")}
          onClick={handleToggleSplit}
        >
          <Columns2 className="h-3.5 w-3.5" />
          {splitMode ? 'Única' : 'Dividir'}
        </Button>

        {/* Finish delivery */}
        <Button
          size="sm"
          className="h-7 text-[10px] gap-1 bg-red-600 hover:bg-red-700"
          onClick={() => setShowFinishConfirm(true)}
        >
          <Flag className="h-3 w-3" />
          Finalizar
        </Button>

        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={fetchTodayOrders}>
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* PANELS */}
      <div className={cn("flex-1 flex overflow-hidden", splitMode ? "gap-0.5" : "")}>
        {/* Panel 1 */}
        <div className={cn(
          "bg-white flex flex-col overflow-hidden",
          splitMode ? "flex-1 border-r" : "flex-1"
        )}>
          <DeliveryPanel
            panelId="panel-1"
            orders={deliveryOrders}
            personType={personType}
            mode={mode!}
            availableLists={availableLists}
            schoolId={schoolId}
            userId={userId}
            todayStr={todayStr}
            onToggleDelivered={toggleDelivered}
            onModifyOrder={handleModifyOrder}
            onAddWithoutOrder={() => { setAddModalPersonType(personType); setShowAddModal(true); }}
            onViewPhoto={(url) => setViewingPhoto(url)}
            compact={splitMode}
            initialListIndex={initialListIndex}
          />
        </div>

        {/* Panel 2 (split mode) */}
        {splitMode && (
          <div className="flex-1 bg-white flex flex-col overflow-hidden">
            {/* Panel 2 config bar */}
            <div className="bg-purple-50 border-b px-2 py-1 flex items-center gap-1.5 flex-shrink-0">
              <Select
                value={splitPersonType2}
                onValueChange={(v: PersonType) => {
                  setSplitPersonType2(v);
                  setSplitLists2(buildLists(v, splitMode2));
                }}
              >
                <SelectTrigger className="h-6 text-[10px] w-24 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="students">👦 Alumnos</SelectItem>
                  <SelectItem value="teachers">👨‍🏫 Profesores</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={splitMode2}
                onValueChange={(v: DeliveryMode) => {
                  setSplitMode2(v);
                  setSplitLists2(buildLists(splitPersonType2, v));
                }}
              >
                <SelectTrigger className="h-6 text-[10px] w-28 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {splitPersonType2 === 'students' && (
                    <>
                      <SelectItem value="by_classroom">Por Aulas</SelectItem>
                      <SelectItem value="by_grade">Por Grados</SelectItem>
                    </>
                  )}
                  <SelectItem value="alphabetical">Alfabético</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DeliveryPanel
              panelId="panel-2"
              orders={deliveryOrders}
              personType={splitPersonType2}
              mode={splitMode2}
              availableLists={splitLists2}
              schoolId={schoolId}
              userId={userId}
              todayStr={todayStr}
              onToggleDelivered={toggleDelivered}
              onModifyOrder={handleModifyOrder}
              onAddWithoutOrder={() => { setAddModalPersonType(splitPersonType2); setShowAddModal(true); }}
              onViewPhoto={(url) => setViewingPhoto(url)}
              compact={true}
            />
          </div>
        )}
      </div>

      {/* ADD WITHOUT ORDER MODAL */}
      <AddWithoutOrderModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        schoolId={schoolId}
        userId={userId}
        todayStr={todayStr}
        personType={addModalPersonType}
        onOrderCreated={fetchTodayOrders}
      />

      {/* PHOTO VIEWER */}
      <Dialog open={!!viewingPhoto} onOpenChange={() => setViewingPhoto(null)}>
        <DialogContent className="max-w-xs p-2">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Camera className="h-4 w-4" /> Foto
            </DialogTitle>
          </DialogHeader>
          {viewingPhoto && (
            <img src={viewingPhoto} alt="Foto" className="w-full rounded-lg object-cover max-h-[60vh]" />
          )}
        </DialogContent>
      </Dialog>

      {/* FINISH DELIVERY CONFIRMATION */}
      <Dialog open={showFinishConfirm} onOpenChange={setShowFinishConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Flag className="h-5 w-5" />
              Finalizar Entrega
            </DialogTitle>
            <DialogDescription className="text-xs">
              Se generará un reporte automático con el resumen de la entrega de hoy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(() => {
              const total = deliveryOrders.length;
              const delivered = deliveryOrders.filter(o => o.status === 'delivered').length;
              const pending = total - delivered;
              const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;
              return (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Progreso</span>
                    <span className="font-bold">{pct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        pct === 100 ? "bg-green-500" : pct >= 70 ? "bg-orange-500" : "bg-red-500"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-green-50 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-green-700">{delivered}</p>
                      <p className="text-[9px] text-green-600">Entregados</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-amber-700">{pending}</p>
                      <p className="text-[9px] text-amber-600">No recogidos</p>
                    </div>
                  </div>
                  {pending > 0 && (
                    <p className="text-[10px] text-amber-600 bg-amber-50 rounded p-1.5 text-center">
                      ⚠️ Hay {pending} pedido(s) sin entregar. Quedarán como "no recogido".
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setShowFinishConfirm(false)} className="text-xs">
              Seguir entregando
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-xs gap-1"
              onClick={handleFinishDelivery}
              disabled={savingReport}
            >
              {savingReport ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flag className="h-3 w-3" />}
              Finalizar y ver reporte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REPORT DIALOG */}
      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <FileText className="h-5 w-5" />
              Reporte de Entrega — {report ? format(new Date(report.sessionDate + 'T00:00:00'), "d 'de' MMMM, yyyy", { locale: es }) : ''}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Resumen automático. El reporte ha sido guardado en el sistema.
            </DialogDescription>
          </DialogHeader>

          {report && (
            <div className="space-y-4 py-2">
              {/* Timing */}
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 flex flex-wrap gap-4">
                <span>🕐 Inicio: {format(new Date(report.startedAt), 'HH:mm')}</span>
                <span>🏁 Fin: {format(new Date(report.endedAt), 'HH:mm')}</span>
                <span>⏱️ Duración: {
                  Math.round((new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime()) / 60000)
                } min</span>
              </div>

              {/* Big numbers */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {[
                  { label: 'Total', value: report.totalOrders, color: 'bg-blue-50 text-blue-700' },
                  { label: 'Entregados', value: report.totalDelivered, color: 'bg-green-50 text-green-700' },
                  { label: 'No recogidos', value: report.totalNotCollected, color: 'bg-amber-50 text-amber-700' },
                  { label: 'Modificados', value: report.totalModified, color: 'bg-indigo-50 text-indigo-700' },
                  { label: 'Sin pedido', value: report.totalAddedWithoutOrder, color: 'bg-purple-50 text-purple-700' },
                  { label: 'Alumnos', value: report.totalStudents, color: 'bg-cyan-50 text-cyan-700' },
                  { label: 'Profesores', value: report.totalTeachers, color: 'bg-pink-50 text-pink-700' },
                ].map(item => (
                  <div key={item.label} className={cn("rounded-lg p-2 text-center", item.color)}>
                    <p className="text-xl font-bold">{item.value}</p>
                    <p className="text-[8px]">{item.label}</p>
                  </div>
                ))}
              </div>

              {/* By category */}
              {report.byCategory.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold mb-1.5 flex items-center gap-1">
                    <UtensilsCrossed className="h-3.5 w-3.5 text-blue-500" /> Por Categoría
                  </h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-blue-50">
                        <tr>
                          <th className="text-left px-2 py-1">Categoría</th>
                          <th className="text-center px-2 py-1 text-green-700">Entregados</th>
                          <th className="text-center px-2 py-1 text-amber-700">Pendientes</th>
                          <th className="text-center px-2 py-1 font-bold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byCategory.map((c, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-2 py-1">{c.name}</td>
                            <td className="text-center px-2 py-1 text-green-600 font-medium">{c.delivered}</td>
                            <td className="text-center px-2 py-1 text-amber-600 font-medium">{c.pending}</td>
                            <td className="text-center px-2 py-1 font-bold">{c.delivered + c.pending}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* By classroom */}
              {report.byClassroom.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold mb-1.5 flex items-center gap-1">
                    <GraduationCap className="h-3.5 w-3.5 text-green-500" /> Por Aula
                  </h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-green-50">
                        <tr>
                          <th className="text-left px-2 py-1">Aula</th>
                          <th className="text-center px-2 py-1 text-green-700">Entregados</th>
                          <th className="text-center px-2 py-1 text-amber-700">Pendientes</th>
                          <th className="text-center px-2 py-1 font-bold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byClassroom.map((c, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-2 py-1">{c.name}</td>
                            <td className="text-center px-2 py-1 text-green-600 font-medium">{c.delivered}</td>
                            <td className="text-center px-2 py-1 text-amber-600 font-medium">{c.pending}</td>
                            <td className="text-center px-2 py-1 font-bold">{c.delivered + c.pending}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Not collected list */}
              {report.notCollectedList.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold mb-1.5 text-red-600 flex items-center gap-1">
                    ⚠️ No Recogidos ({report.notCollectedList.length})
                  </h3>
                  <div className="border border-red-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-red-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1">Nombre</th>
                          <th className="text-left px-2 py-1">Categoría</th>
                          <th className="text-left px-2 py-1">Plato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.notCollectedList.map((o, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-red-50/30'}>
                            <td className="px-2 py-1">{o.name}</td>
                            <td className="px-2 py-1 text-gray-500">{o.category}</td>
                            <td className="px-2 py-1 text-gray-500">{o.plate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Added without order */}
              {report.addedWithoutOrderList.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold mb-1.5 text-purple-600 flex items-center gap-1">
                    <UserPlus className="h-3.5 w-3.5" /> Agregados sin Pedido ({report.addedWithoutOrderList.length})
                  </h3>
                  <div className="border border-purple-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-purple-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1">Nombre</th>
                          <th className="text-left px-2 py-1">Categoría</th>
                          <th className="text-left px-2 py-1">Plato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.addedWithoutOrderList.map((o, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-purple-50/30'}>
                            <td className="px-2 py-1">{o.name}</td>
                            <td className="px-2 py-1 text-gray-500">{o.category}</td>
                            <td className="px-2 py-1 text-gray-500">{o.plate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={() => report && downloadPDFReport(report)}
            >
              <Download className="h-3 w-3" /> Descargar PDF
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1 bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                setShowReport(false);
                onClose();
              }}
            >
              <CheckCircle2 className="h-3 w-3" /> Cerrar y salir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ACTIVE ADMINS TOOLTIP */}
      {activeAdmins.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="bg-green-600 text-white rounded-lg shadow-lg p-2 text-xs animate-in slide-in-from-bottom-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Wifi className="h-3 w-3" />
              <span className="font-semibold">Admins activos</span>
            </div>
            {activeAdmins.map(admin => (
              <div key={admin.id} className="flex items-center gap-1 text-green-100 text-[10px]">
                <span className="w-1.5 h-1.5 bg-green-300 rounded-full" />
                {admin.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
