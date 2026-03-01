import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
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
}

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

type DeliveryMode = 'by_classroom' | 'by_grade' | 'alphabetical' | 'all';
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
}: DeliveryPanelProps) {
  const [currentListIndex, setCurrentListIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentListName = availableLists[currentListIndex] || 'Todos';
  const isLastList = currentListIndex >= availableLists.length - 1;

  // Filtered orders
  const currentListOrders = useMemo(() => {
    let filtered = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if (mode === 'by_classroom' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
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
      const q = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(o => {
        const name = (o.student_name || o.teacher_name || '').toLowerCase();
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

    if (mode === 'by_classroom' && availableLists.length > 0 && availableLists[0] !== 'Todos') {
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
                    {order.addons.length > 0 && (
                      <p className="text-[8px] text-purple-600 mt-0.5 truncate">
                        ➕ {order.addons.join(', ')}
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
        <div className="bg-white border-t px-2 py-1.5 flex items-center justify-between flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            disabled={currentListIndex === 0}
            onClick={() => { setCurrentListIndex(i => i - 1); setSearchTerm(''); }}
            className="h-7 text-[10px] gap-1"
          >
            <ChevronLeft className="h-3 w-3" />
            Ant.
          </Button>
          <div className="text-center">
            <p className="text-[10px] font-bold text-gray-700">{currentListName}</p>
            <p className="text-[8px] text-gray-500">{currentListIndex + 1}/{availableLists.length}</p>
          </div>
          <Button
            size="sm"
            disabled={isLastList}
            onClick={() => { setCurrentListIndex(i => i + 1); setSearchTerm(''); }}
            className={cn("h-7 text-[10px] gap-1", isLastList ? "bg-green-600 hover:bg-green-700" : "bg-orange-600 hover:bg-orange-700")}
          >
            {isLastList ? '✅' : 'Sig.'}
            <ChevronRight className="h-3 w-3" />
          </Button>
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
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando opciones...
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

      // Create pending transaction (generates debt)
      if (category.price > 0) {
        const txData: any = {
          type: 'purchase',
          amount: -Math.abs(category.price),
          description: `Almuerzo (sin pedido) - ${category.name} - ${format(new Date(todayStr + 'T00:00:00'), "d 'de' MMMM", { locale: es })}`,
          payment_status: 'pending',
          school_id: schoolId,
          metadata: {
            lunch_order_id: inserted.id,
            source: 'delivery_no_order',
            order_date: todayStr,
            category_name: category.name,
            quantity: 1,
          },
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

export function LunchDeliveryDashboard({ schoolId, userId, onClose }: LunchDeliveryDashboardProps) {
  const { toast } = useToast();

  // Setup state
  const [setupDone, setSetupDone] = useState(false);
  const [mode, setMode] = useState<DeliveryMode | null>(null);
  const [personType, setPersonType] = useState<PersonType>('students');

  // Data
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // Lists
  const [availableLists, setAvailableLists] = useState<string[]>([]);

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

  const todayStr = useMemo(() => {
    const now = new Date();
    const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    return format(peruTime, 'yyyy-MM-dd');
  }, []);

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

      // Categories
      const categoryIds = [...new Set(
        (ordersData || []).map(o => (o.lunch_menus as any)?.category_id || o.category_id).filter(Boolean) as string[]
      )];

      let categoriesMap = new Map<string, string>();
      if (categoryIds.length > 0) {
        const { data: cats } = await supabase.from('lunch_categories').select('id, name').in('id', categoryIds);
        if (cats) cats.forEach(c => categoriesMap.set(c.id, c.name));
      }

      // Ticket codes
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
            if (loid && orderIds.includes(loid) && tx.ticket_code) ticketMap.set(loid, tx.ticket_code);
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
          observations: o.lunch_menus?.notes || null,
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
      .channel('delivery-realtime')
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
  };

  // ==========================================
  // START DELIVERY
  // ==========================================

  const buildLists = (pType: PersonType, dMode: DeliveryMode): string[] => {
    const typeOrders = pType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if (dMode === 'by_classroom') {
      const cls = [...new Set(typeOrders.map(o => `${o.student_grade || ''} ${o.student_section || ''}`.trim()).filter(Boolean))].sort();
      return cls.length > 0 ? cls : ['Todos'];
    } else if (dMode === 'by_grade') {
      const gr = [...new Set(typeOrders.map(o => o.student_grade).filter(Boolean) as string[])].sort();
      return gr.length > 0 ? gr : ['Todos'];
    }
    return ['Todos'];
  };

  const startDelivery = () => {
    if (!mode) return;

    const typeOrders = personType === 'students'
      ? orders.filter(o => o.student_id)
      : orders.filter(o => o.teacher_id);

    if (typeOrders.length === 0) {
      toast({ variant: 'destructive', title: 'Sin pedidos', description: `No hay pedidos de ${personType === 'students' ? 'alumnos' : 'profesores'} para hoy.` });
      return;
    }

    setAvailableLists(buildLists(personType, mode));
    setSplitLists2(buildLists(splitPersonType2, splitMode2));
    setSetupDone(true);
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

              {/* Mode */}
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
                            mode === 'by_classroom' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
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
                            mode === 'by_grade' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
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
                        mode === 'alphabetical' ? "border-orange-500 bg-orange-50 shadow-lg" : "border-gray-200 hover:border-orange-300"
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
  // RENDER: DELIVERY VIEW (with split support)
  // ==========================================

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* GLOBAL TOP BAR */}
      <div className="bg-white border-b shadow-sm px-3 py-1.5 flex items-center gap-2 flex-shrink-0 z-40">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSetupDone(false)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-sm flex items-center gap-2">
            🍽️ Entrega de Almuerzos
            <Badge className="bg-orange-100 text-orange-700 text-[9px]">
              {format(new Date(), "d MMM", { locale: es })}
            </Badge>
          </h1>
        </div>

        {/* Split toggle */}
        <Button
          variant={splitMode ? 'default' : 'outline'}
          size="sm"
          className={cn("h-7 text-[10px] gap-1", splitMode && "bg-purple-600 hover:bg-purple-700")}
          onClick={handleToggleSplit}
        >
          <Columns2 className="h-3.5 w-3.5" />
          {splitMode ? 'Vista única' : 'Dividir'}
        </Button>

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchTodayOrders}>
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
            orders={orders}
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
              orders={orders}
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
    </div>
  );
}
