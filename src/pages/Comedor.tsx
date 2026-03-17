import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
  ChefHat,
  Loader2,
  RefreshCw,
  ArrowLeft,
  LogOut,
  Flame,
  Salad,
  Coffee,
  IceCream2,
  AlertTriangle,
  Building2,
  Printer,
  UtensilsCrossed,
  GraduationCap,
  Briefcase,
  WifiOff,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  notes?: string | null;
  parent_notes?: string | null;
  category_name: string;
  category_target_type: string;
  category_color: string;
  menu_main_course: string;
  menu_starter: string | null;
  menu_beverage: string | null;
  menu_dessert: string | null;
  menu_notes: string | null;
  student_name: string | null;
  student_grade: string | null;
  student_section: string | null;
  teacher_name: string | null;
}

interface PrepCategory {
  key: string;
  category_id: string;
  category_name: string;
  category_color: string;
  category_target_type: string;
  menu_main_course: string;
  menu_starter: string | null;
  menu_beverage: string | null;
  menu_dessert: string | null;
  menu_notes: string | null;
  total: number;
  variations: { label: string; count: number }[];
  garnishes: { name: string; count: number }[];
  // Selecciones de plato configurable: agrupadas por grupo (PROTEÍNAS, GUARNICIONES)
  plate_selections: { group: string; items: { name: string; count: number }[] }[];
  special_notes: { person: string; note: string }[];
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
const getPeruTodayStr = (): string => {
  const s = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const AUTO_REFRESH = 30;

/** Agrupa una lista de pedidos en categorías de preparación */
function aggregateOrders(orders: RawOrder[]): PrepCategory[] {
  const map = new Map<string, PrepCategory>();

  for (const o of orders) {
    // Clave única: menu_id si existe, o category_id + plato principal para no mezclar menús distintos
    const key = o.menu_id
      ? o.menu_id
      : `${o.category_id || 'sin-cat'}__${(o.menu_main_course || '').toLowerCase().trim()}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        category_id: o.category_id || key,
        category_name: o.category_name,
        category_color: o.category_color,
        category_target_type: o.category_target_type,
        menu_main_course: o.menu_main_course,
        menu_starter: o.menu_starter,
        menu_beverage: o.menu_beverage,
        menu_dessert: o.menu_dessert,
        menu_notes: o.menu_notes,
        total: 0,
        variations: [],
        garnishes: [],
        plate_selections: [],
        special_notes: [],
      });
    }
    const cat = map.get(key)!;
    const qty = o.quantity;
    cat.total += qty;

    // ── Selecciones de plato configurable (PROTEÍNAS, GUARNICIONES, etc.) ──
    const configSels = (o.configurable_selections || []).filter(
      (sel: any) => sel.group_name && sel.selected && String(sel.selected).trim() !== ''
    );
    if (configSels.length > 0) {
      for (const sel of configSels) {
        if (!sel.group_name || !sel.selected) continue;
        const items = sel.selected.split(', ').filter(Boolean);
        for (const item of items) {
          let group = cat.plate_selections.find(g => g.group === sel.group_name);
          if (!group) {
            group = { group: sel.group_name, items: [] };
            cat.plate_selections.push(group);
          }
          const existing = group.items.find(i => i.name === item);
          if (existing) existing.count += qty;
          else group.items.push({ name: item, count: qty });
        }
      }
      for (const g of cat.plate_selections) {
        g.items.sort((a, b) => b.count - a.count);
      }
    }

    // ── Variaciones (modifiers normales) ──
    const varMap = new Map<string, number>();
    for (const v of cat.variations) varMap.set(v.label, v.count);
    for (const mod of (o.selected_modifiers || [])) {
      const lbl = `${mod.group_name}: ${mod.selected_name}`;
      varMap.set(lbl, (varMap.get(lbl) || 0) + qty);
    }
    cat.variations = Array.from(varMap.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

    // ── Guarniciones ──
    const garnMap = new Map<string, number>();
    for (const g of cat.garnishes) garnMap.set(g.name, g.count);
    for (const g of (o.selected_garnishes || [])) garnMap.set(g, (garnMap.get(g) || 0) + qty);
    cat.garnishes = Array.from(garnMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    // ── Observaciones de padres ──
    const obs = o.parent_notes?.trim() || o.notes?.trim();
    if (obs) {
      const person = o.student_name || o.teacher_name || o.manual_name || 'Desconocido';
      cat.special_notes.push({ person, note: obs });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// ══════════════════════════════════════
// COMPACT CARD
// ══════════════════════════════════════
function MenuCard({ cat, idx }: { cat: PrepCategory; idx: number }) {
  // Descripción compacta de acompañamientos
  const sides = [cat.menu_starter, cat.menu_beverage, cat.menu_dessert].filter(Boolean);
  const hasDetails = cat.variations.length > 0 || cat.garnishes.length > 0 || cat.special_notes.length > 0;

  return (
    <div
      className="bg-white rounded-xl border overflow-hidden shadow-sm print:break-inside-avoid print:shadow-none"
      style={{ borderColor: `${cat.category_color}40` }}
    >
      {/* Cabecera: nombre categoría + plato + conteo */}
      <div
        className="px-3 py-2 flex items-center justify-between gap-2"
        style={{ backgroundColor: `${cat.category_color}10` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider opacity-50" style={{ color: cat.category_color }}>
              #{idx + 1}
            </span>
            <span className="text-sm font-bold text-gray-900 leading-tight truncate">{cat.category_name}</span>
          </div>
          {cat.menu_main_course && (
            <p className="text-xs text-gray-600 font-medium truncate flex items-center gap-1 mt-0.5">
              <Flame className="h-3 w-3 text-orange-500 flex-shrink-0" />
              {cat.menu_main_course}
            </p>
          )}
        </div>
        <div
          className="w-11 h-11 rounded-lg flex flex-col items-center justify-center flex-shrink-0"
          style={{ backgroundColor: cat.category_color }}
        >
          <span className="text-lg font-black text-white leading-none">{cat.total}</span>
          <span className="text-[7px] text-white/80 font-bold uppercase">platos</span>
        </div>
      </div>

      {/* Detalles: solo si hay algo que mostrar */}
      {(sides.length > 0 || hasDetails || cat.menu_notes) && (
        <div className="px-3 py-1.5 space-y-1.5">

          {/* Acompañamientos en una línea */}
          {sides.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
              {cat.menu_starter && <span className="flex items-center gap-0.5"><Salad className="h-2.5 w-2.5 text-green-500" />{cat.menu_starter}</span>}
              {cat.menu_beverage && <span className="flex items-center gap-0.5"><Coffee className="h-2.5 w-2.5 text-amber-500" />{cat.menu_beverage}</span>}
              {cat.menu_dessert && <span className="flex items-center gap-0.5"><IceCream2 className="h-2.5 w-2.5 text-pink-500" />{cat.menu_dessert}</span>}
            </div>
          )}

          {/* ── Selecciones de plato configurable (PROTEÍNAS, GUARNICIONES, etc.) ── */}
          {cat.plate_selections.length > 0 && (
            <div className="space-y-1.5">
              {cat.plate_selections.map((group, gi) => (
                <div key={gi} className="bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                  <p className="text-[9px] font-bold text-indigo-700 uppercase tracking-wider mb-1">
                    🍽️ {group.group}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item, ii) => (
                      <div key={ii} className="flex items-center justify-between bg-white rounded px-2 py-1 border border-indigo-100">
                        <span className="text-xs font-medium text-gray-800">{item.name}</span>
                        <span className="text-lg font-black text-indigo-700 leading-none ml-2">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Variaciones compactas (modifiers estándar) */}
          {cat.variations.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-purple-600 uppercase tracking-wider mb-0.5">Variaciones</p>
              <div className="flex flex-wrap gap-1">
                {cat.variations.map((v, i) => (
                  <span key={i} className="text-[11px] bg-purple-50 text-purple-700 border border-purple-100 rounded px-1.5 py-0.5">
                    {v.label}: <strong>{v.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Guarniciones compactas (del menú estándar) */}
          {cat.garnishes.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-green-600 uppercase tracking-wider mb-0.5">Guarniciones</p>
              <div className="flex flex-wrap gap-1">
                {cat.garnishes.map((g, i) => (
                  <span key={i} className="text-[11px] bg-green-50 text-green-700 border border-green-100 rounded px-1.5 py-0.5">
                    {g.name}: <strong>{g.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Nota del menú */}
          {cat.menu_notes && (
            <div className="flex items-start gap-1.5 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
              <AlertTriangle className="h-3 w-3 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-yellow-700">{cat.menu_notes}</p>
            </div>
          )}

          {/* ── Pedidos especiales de padres (SIEMPRE VISIBLE) ── */}
          {cat.special_notes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
              <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Pedidos especiales ({cat.special_notes.length})
              </p>
              <div className="space-y-0.5">
                {cat.special_notes.map((n, i) => (
                  <div key={i} className="text-[11px] text-amber-900 bg-white border border-amber-100 rounded px-2 py-1 flex items-start gap-1">
                    <span className="font-bold text-amber-700 flex-shrink-0">{n.person}:</span>
                    <span>{n.note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════
const Comedor = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { role } = useRole();
  const { isOnline } = useOnlineStatus();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getPeruTodayStr());
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const maintenance = useMaintenanceGuard('comedor_admin', schoolId);
  const [schoolName, setSchoolName] = useState('');
  const [allSchools, setAllSchools] = useState<{ id: string; name: string }[]>([]);
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState('all');
  const isAdminGeneral = role === 'admin_general';
  const [rawOrders, setRawOrders] = useState<RawOrder[]>([]);
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [selectedSection, setSelectedSection] = useState('all');
  // 'all' = alumnos + profesores | 'teachers' = solo profesores
  const [viewMode, setViewMode] = useState<'all' | 'teachers'>('all');
  const [countdown, setCountdown] = useState(AUTO_REFRESH);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load school ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (isAdminGeneral) {
        const { data } = await supabase.from('schools').select('id, name').order('name');
        setAllSchools(data || []);
        setSchoolId(null);
        setSchoolName('Todas las sedes');
        return;
      }
      const { data } = await supabase.from('profiles').select('school_id, schools(name)').eq('id', user.id).single();
      if (data?.school_id) {
        setSchoolId(data.school_id);
        setSchoolName((data as any).schools?.name || '');
      }
    })();
  }, [user, isAdminGeneral]);

  const effectiveSchoolName = useMemo(() => {
    if (!isAdminGeneral) return schoolName;
    if (selectedSchoolFilter === 'all') return 'Todas las sedes';
    return allSchools.find(s => s.id === selectedSchoolFilter)?.name || '';
  }, [isAdminGeneral, selectedSchoolFilter, allSchools, schoolName]);

  // ── Fetch orders (con fallback offline) ──
  const loadOrders = useCallback(async () => {
    if (!isAdminGeneral && !schoolId) return;

    // Si no hay internet, intentar cargar desde caché
    if (!navigator.onLine) {
      try {
        const cacheKey = `comedor_${selectedDate}_${selectedSchoolFilter || schoolId || 'all'}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as RawOrder[];
          setRawOrders(parsed);
          console.log(`📱 Cocina offline: ${parsed.length} pedidos desde caché`);
          return;
        }
      } catch {}
      console.warn('⚠️ Sin conexión y sin datos en caché para esta fecha');
      return;
    }

    let allData: any[] = [];
    let from = 0;
    const PAGE = 1000;

    while (true) {
      let q = supabase
        .from('lunch_orders')
        .select(`
          id, order_date, status, quantity, is_cancelled,
          student_id, teacher_id, manual_name,
          category_id, menu_id, notes, parent_notes,
          selected_modifiers, configurable_selections, selected_garnishes,
          students(full_name, grade, section), teacher_profiles(full_name),
          lunch_menus(main_course, starter, beverage, dessert, notes, category_id)
        `)
        .eq('order_date', selectedDate)
        .eq('is_cancelled', false)
        .range(from, from + PAGE - 1);

      if (isAdminGeneral && selectedSchoolFilter !== 'all') q = q.eq('school_id', selectedSchoolFilter);
      else if (!isAdminGeneral && schoolId) q = q.eq('school_id', schoolId);

      const { data, error } = await q;
      if (error) { console.error('Error cargando pedidos:', error); setRawOrders([]); return; }

      allData = [...allData, ...(data || [])];
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const categoryIds = [
      ...new Set(
        allData
          .map((o: any) => (o.lunch_menus as any)?.category_id || o.category_id)
          .filter(Boolean) as string[]
      ),
    ];

    const categoriesMap = new Map<string, { name: string; color: string; target_type: string }>();
    if (categoryIds.length > 0) {
      const { data: cats } = await supabase
        .from('lunch_categories')
        .select('id, name, color, target_type')
        .in('id', categoryIds);
      if (cats) cats.forEach(c => categoriesMap.set(c.id, {
        name: c.name,
        color: c.color || '#6B7280',
        target_type: c.target_type || 'both',
      }));
    }

    const mapped: RawOrder[] = allData.map((o: any) => {
      const resolvedCatId: string | null =
        (o.lunch_menus as any)?.category_id || o.category_id || null;
      const cat = resolvedCatId ? categoriesMap.get(resolvedCatId) : null;
      return {
        id: o.id,
        order_date: o.order_date,
        status: o.status,
        quantity: o.quantity || 1,
        is_cancelled: o.is_cancelled,
        student_id: o.student_id,
        teacher_id: o.teacher_id,
        manual_name: o.manual_name,
        category_id: resolvedCatId,
        menu_id: o.menu_id,
        notes: o.notes || null,
        parent_notes: o.parent_notes || null,
        selected_modifiers: o.selected_modifiers || [],
        configurable_selections: o.configurable_selections || [],
        selected_garnishes: o.selected_garnishes || [],
        category_name: cat?.name || 'Sin categoría',
        category_target_type: cat?.target_type || 'both',
        category_color: cat?.color || '#6B7280',
        menu_main_course: (o.lunch_menus as any)?.main_course || '',
        menu_starter: (o.lunch_menus as any)?.starter || null,
        menu_beverage: (o.lunch_menus as any)?.beverage || null,
        menu_dessert: (o.lunch_menus as any)?.dessert || null,
        menu_notes: (o.lunch_menus as any)?.notes || null,
        student_name: o.students?.full_name || null,
        student_grade: o.students?.grade || null,
        student_section: o.students?.section || null,
        teacher_name: o.teacher_profiles?.full_name || null,
      };
    });
    setRawOrders(mapped);

    // ── Cachear para uso offline ──
    try {
      const cacheKey = `comedor_${selectedDate}_${selectedSchoolFilter || schoolId || 'all'}`;
      localStorage.setItem(cacheKey, JSON.stringify(mapped));
      console.log(`💾 Cocina: ${mapped.length} pedidos cacheados para offline`);
    } catch {}
  }, [schoolId, selectedDate, isAdminGeneral, selectedSchoolFilter]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
    setCountdown(AUTO_REFRESH);
  }, [loadOrders]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadOrders();
      setLoading(false);
    })();
  }, [loadOrders]);

  useEffect(() => {
    if (!isAdminGeneral) return;
    (async () => {
      setLoading(true);
      await loadOrders();
      setLoading(false);
    })();
  }, [selectedSchoolFilter]);

  // Auto-refresh countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { loadOrders(); return AUTO_REFRESH; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loadOrders]);

  // ── Grados disponibles (únicos, solo alumnos con grado definido) ──
  const availableGrades = useMemo(() => {
    const grades = new Set<string>();
    for (const o of rawOrders) {
      if (o.student_grade) grades.add(o.student_grade);
    }
    return Array.from(grades).sort();
  }, [rawOrders]);

  // ── Reset de grado, aula y modo cuando cambian sede o fecha ──
  useEffect(() => {
    setSelectedGrade('all');
    setSelectedSection('all');
    setViewMode('all');
  }, [selectedDate, selectedSchoolFilter]);

  // ── Reset de aula cuando cambia el grado ──
  useEffect(() => {
    setSelectedSection('all');
  }, [selectedGrade]);

  // ── Aulas disponibles según el grado seleccionado ──
  const availableSections = useMemo(() => {
    if (selectedGrade === 'all') return [];
    const sections = new Set<string>();
    for (const o of rawOrders) {
      if (o.student_grade === selectedGrade && o.student_section) {
        sections.add(o.student_section);
      }
    }
    return Array.from(sections).sort();
  }, [rawOrders, selectedGrade]);

  // ══════════════════════════════════════
  // CORRIENTES SEPARADAS: Alumnos y Profesores
  // ══════════════════════════════════════

  // Pedidos de ALUMNOS: filtrados por grado y aula
  const filteredStudentOrders = useMemo(() => {
    if (viewMode === 'teachers') return [];
    return rawOrders.filter(o => {
      if (!o.student_id) return false; // excluir profesores
      if (selectedGrade !== 'all' && o.student_grade !== selectedGrade) return false;
      if (selectedSection !== 'all' && o.student_section !== selectedSection) return false;
      return true;
    });
  }, [rawOrders, viewMode, selectedGrade, selectedSection]);

  // Pedidos de PROFESORES: siempre completos, sin filtro de grado/aula
  const teacherOnlyOrders = useMemo(() => {
    return rawOrders.filter(o => !o.student_id);
  }, [rawOrders]);

  // Categorías agrupadas por separado
  const studentMenus = useMemo(() => aggregateOrders(filteredStudentOrders), [filteredStudentOrders]);
  const teacherMenus = useMemo(() => aggregateOrders(teacherOnlyOrders), [teacherOnlyOrders]);

  // Combinado para secciones globales (observaciones, "sin pedidos", etc.)
  const allMenus = useMemo(() => [...studentMenus, ...teacherMenus], [studentMenus, teacherMenus]);

  const totalAlumnos = useMemo(() => studentMenus.reduce((s, c) => s + c.total, 0), [studentMenus]);
  const totalProfesores = useMemo(() => teacherMenus.reduce((s, c) => s + c.total, 0), [teacherMenus]);
  const totalPlatos = useMemo(() => totalAlumnos + totalProfesores, [totalAlumnos, totalProfesores]);

  const formattedDate = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return format(new Date(y, m - 1, d), "EEEE d 'de' MMMM, yyyy", { locale: es });
  }, [selectedDate]);

  // ══════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════
  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600">{maintenance.message}</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Volver al Panel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">

      {/* ── HEADER ── */}
      <header className="bg-white border-b sticky top-0 z-20 print:hidden shadow-sm">
        <div className="w-full px-3 sm:px-6 lg:px-8 py-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="h-8 w-8 p-0 flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center shadow flex-shrink-0">
              <ChefHat className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-sm leading-none">Reporte de Cocina</h1>
              <p className="text-[10px] text-gray-400 truncate">{effectiveSchoolName}</p>
            </div>
          </div>

          {isAdminGeneral && allSchools.length > 0 && (
            <Select value={selectedSchoolFilter} onValueChange={setSelectedSchoolFilter}>
              <SelectTrigger className="h-8 w-[140px] lg:w-[180px] text-xs flex-shrink-0">
                <Building2 className="h-3 w-3 mr-1 text-orange-500 flex-shrink-0" />
                <SelectValue placeholder="Sede" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🏫 Todas</SelectItem>
                {allSchools.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {/* Botón Solo Profesores */}
          <button
            onClick={() => {
              setViewMode(prev => prev === 'teachers' ? 'all' : 'teachers');
              setSelectedGrade('all');
              setSelectedSection('all');
            }}
            className={`h-8 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1 flex-shrink-0 border transition-all ${
              viewMode === 'teachers'
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
            }`}
            title="Ver solo profesores"
          >
            <Briefcase className="h-3 w-3" />
            <span className="hidden sm:inline">Profes</span>
          </button>

          {/* Filtro por grado — solo cuando modo normal y hay grados */}
          {viewMode === 'all' && availableGrades.length > 0 && (
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger className="h-8 w-[110px] lg:w-[130px] text-xs flex-shrink-0">
                <GraduationCap className="h-3 w-3 mr-1 text-blue-500 flex-shrink-0" />
                <SelectValue placeholder="Grado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">📚 Todos</SelectItem>
                {availableGrades.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Filtro por aula — aparece solo en modo normal, con grado elegido y secciones disponibles */}
          {viewMode === 'all' && selectedGrade !== 'all' && availableSections.length > 0 && (
            <Select value={selectedSection} onValueChange={setSelectedSection}>
              <SelectTrigger className="h-8 w-[90px] lg:w-[110px] text-xs flex-shrink-0">
                <span className="mr-1 text-violet-500 flex-shrink-0">🚪</span>
                <SelectValue placeholder="Aula" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {availableSections.map(s => (
                  <SelectItem key={s} value={s}>Aula {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white h-8 w-[110px] flex-shrink-0"
          />

          <Button variant="outline" size="sm" onClick={doRefresh} disabled={refreshing}
            className="h-8 w-8 p-0 flex-shrink-0 relative" title={`Actualizar (${countdown}s)`}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {!refreshing && (
              <span className="absolute -bottom-1 -right-1 text-[8px] bg-orange-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {countdown}
              </span>
            )}
          </Button>

          <Button variant="outline" size="sm" onClick={() => window.print()} className="h-8 w-8 p-0 flex-shrink-0" title="Imprimir">
            <Printer className="h-3.5 w-3.5" />
          </Button>

          <Button variant="ghost" size="sm" onClick={() => signOut()} className="h-8 w-8 p-0 flex-shrink-0 text-gray-400 hover:text-red-500" title="Salir">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* ── Banner offline ── */}
      {!isOnline && (
        <div className="bg-red-600 text-white px-3 py-1.5 flex items-center gap-2 text-xs print:hidden">
          <WifiOff className="h-3.5 w-3.5 animate-pulse" />
          <span className="font-medium">Sin conexión — Mostrando datos desde caché local</span>
        </div>
      )}

      {/* ── MAIN ── */}
      <main className="w-full px-3 sm:px-6 lg:px-8 py-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
            <p className="text-sm text-gray-400">Cargando reporte...</p>
          </div>
        ) : (
          <>
            {/* ── PRINT HEADER ── */}
            <div className="hidden print:block mb-6 text-center">
              <h1 className="text-2xl font-bold">Reporte de Cocina — {effectiveSchoolName}</h1>
              <p className="text-gray-600 capitalize mt-1">{formattedDate}</p>
              <p className="text-sm text-gray-500 mt-1">Total: <strong>{totalPlatos} platos</strong> (Alumnos: {totalAlumnos} / Profesores: {totalProfesores})</p>
              <hr className="mt-3" />
            </div>

            {/* ── BANNER COMPACTO ── */}
            <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-3 lg:p-4 text-white mb-3 print:hidden shadow flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] lg:text-xs font-semibold uppercase tracking-widest opacity-80 capitalize">{formattedDate}</p>
                <p className="text-base lg:text-xl font-bold leading-tight truncate">
                  {effectiveSchoolName}
                  {viewMode === 'teachers' && (
                    <span className="ml-2 text-sm bg-white/20 px-2 py-0.5 rounded-full font-medium">
                      Solo Profesores
                    </span>
                  )}
                  {viewMode === 'all' && selectedGrade !== 'all' && (
                    <span className="ml-2 text-sm bg-white/20 px-2 py-0.5 rounded-full font-medium">
                      {selectedGrade}{selectedSection !== 'all' ? ` — Aula ${selectedSection}` : ''}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 lg:gap-5 flex-shrink-0">
                <div className="text-center">
                  <p className="text-2xl lg:text-4xl font-black leading-none">{totalAlumnos}</p>
                  <p className="text-[9px] lg:text-[10px] opacity-80">Alumnos</p>
                </div>
                <div className="w-px h-8 bg-white/30" />
                <div className="text-center">
                  <p className="text-2xl lg:text-4xl font-black leading-none">{totalProfesores}</p>
                  <p className="text-[9px] lg:text-[10px] opacity-80">Profesores</p>
                </div>
                <div className="w-px h-8 bg-white/30" />
                <div className="text-center">
                  <p className="text-3xl lg:text-5xl font-black leading-none">{totalPlatos}</p>
                  <p className="text-[9px] lg:text-[10px] opacity-80">Total</p>
                </div>
              </div>
            </div>

            {/* ── SIN PEDIDOS ── */}
            {allMenus.length === 0 ? (
              <div className="text-center py-16">
                <ChefHat className="h-14 w-14 mx-auto mb-3 opacity-15 text-gray-400" />
                <p className="text-gray-500 font-semibold">Sin pedidos para preparar</p>
                <p className="text-gray-400 text-sm mt-1 capitalize">{formattedDate}</p>
              </div>
            ) : (
              <>
                {/* ═══════════════════════════════════════════
                    LAYOUT: 2 COLUMNAS (Alumnos | Profesores)
                    ═══════════════════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">

                  {/* ── COLUMNA ALUMNOS ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center">
                        <GraduationCap className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-gray-900 leading-none">Alumnos</h2>
                        <p className="text-[10px] text-gray-400">{studentMenus.length} menú{studentMenus.length !== 1 ? 's' : ''} · {totalAlumnos} platos</p>
                      </div>
                    </div>
                    {studentMenus.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <p className="text-xs text-gray-400">Sin pedidos de alumnos</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {studentMenus.map((cat, idx) => (
                          <MenuCard key={cat.key} cat={cat} idx={idx} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── COLUMNA PROFESORES ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center">
                        <Briefcase className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-gray-900 leading-none">Profesores</h2>
                        <p className="text-[10px] text-gray-400">{teacherMenus.length} menú{teacherMenus.length !== 1 ? 's' : ''} · {totalProfesores} platos</p>
                      </div>
                    </div>
                    {teacherMenus.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <p className="text-xs text-gray-400">Sin pedidos de profesores</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {teacherMenus.map((cat, idx) => (
                          <MenuCard key={cat.key} cat={cat} idx={idx} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── RESUMEN COMPACTO (debajo de ambas columnas) ── */}
                <div className="mt-4 bg-gray-900 text-white rounded-xl p-3 lg:p-4 print:border print:bg-white print:text-black">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 print:text-gray-600 mb-2">
                    ✅ Resumen total del día
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                    {/* Alumnos */}
                    {studentMenus.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">🎓 Alumnos</p>
                        {studentMenus.map(cat => (
                          <div key={cat.key} className="flex items-center justify-between py-0.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.category_color }} />
                              <span className="text-xs text-gray-300 print:text-gray-700 truncate">
                                {cat.category_name}{cat.menu_main_course ? ` — ${cat.menu_main_course}` : ''}
                              </span>
                            </div>
                            <span className="text-lg font-black text-white print:text-gray-900 flex-shrink-0 ml-2">{cat.total}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Profesores */}
                    {teacherMenus.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">👨‍🏫 Profesores</p>
                        {teacherMenus.map(cat => (
                          <div key={cat.key} className="flex items-center justify-between py-0.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.category_color }} />
                              <span className="text-xs text-gray-300 print:text-gray-700 truncate">
                                {cat.category_name}{cat.menu_main_course ? ` — ${cat.menu_main_course}` : ''}
                              </span>
                            </div>
                            <span className="text-lg font-black text-white print:text-gray-900 flex-shrink-0 ml-2">{cat.total}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-gray-700 print:border-gray-300 mt-2 pt-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-300 print:text-gray-700">TOTAL A PREPARAR</span>
                    <span className="text-3xl font-black text-orange-400 print:text-gray-900">{totalPlatos}</span>
                  </div>
                </div>

                {/* ── Observaciones globales (debajo del resumen) ── */}
                {allMenus.some(c => c.special_notes.length > 0) && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Todas las observaciones especiales
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {allMenus.filter(c => c.special_notes.length > 0).map(cat => (
                        <div key={cat.key}>
                          <p className="text-[10px] font-bold mb-0.5" style={{ color: cat.category_color }}>
                            {cat.category_name} — {cat.menu_main_course}
                          </p>
                          {cat.special_notes.map((n, i) => (
                            <div key={i} className="text-[11px] text-amber-800 bg-white border border-amber-100 rounded px-2 py-1 mb-1">
                              <span className="font-semibold">{n.person}:</span> {n.note}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Auto-refresh info */}
                <div className="mt-2 text-center print:hidden">
                  <p className="text-[10px] text-gray-400">
                    Actualización en <span className="font-bold text-orange-500">{countdown}s</span>
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Comedor;
