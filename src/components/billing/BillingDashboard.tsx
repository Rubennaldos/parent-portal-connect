import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSync } from '@/stores/billingSync';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Users, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Building2,
  Loader2,
  Lightbulb,
  AlertTriangle,
  Clock,
  CreditCard,
  RefreshCw,
  Zap,
  ShieldAlert,
  UserCheck,
  UtensilsCrossed,
  Coffee,
  Trophy,
  Medal,
  Activity,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface School {
  id: string;
  name: string;
  code: string;
}

type DebtCategory = 'all' | 'almuerzo' | 'cafeteria';

// UnifiedDebt eliminada — el RPC devuelve las métricas ya calculadas

interface AdminRankEntry {
  admin_id: string;
  name: string;
  role: string;
  school_name: string;
  amountCollected: number;
  ticketsCollected: number;
  timeline: Array<{ hour: string; amount: number; count: number }>;
}

interface DashboardStats {
  totalPending: number;
  lunchPending: number;
  cafeteriaPending: number;
  totalCollectedToday: number;
  totalCollectedWeek: number;
  totalCollectedMonth: number;
  totalDebtors: number;
  totalTicketsPending: number;
  totalTicketsPaid: number;
  lunchDebtors: number;
  cafeteriaDebtors: number;
  totalTeacherDebt: number;
  totalStudentDebt: number;
  totalManualDebt: number;
  teacherDebtors: number;
  studentDebtors: number;
  manualDebtors: number;
  collectedYesterday: number;
  debtByAge: {
    today: number;
    days1to3: number;
    days4to7: number;
    days8to15: number;
    daysOver15: number;
    countToday: number;
    count1to3: number;
    count4to7: number;
    count8to15: number;
    countOver15: number;
  };
  paymentMethods: {
    efectivo: number;
    tarjeta: number;
    yape: number;
    transferencia: number;
    plin: number;
    otro: number;
  };
  topDebtors: Array<{
    name: string;
    type: 'student' | 'teacher' | 'manual';
    amount: number;
    school_name: string;
    days_overdue: number;
    count: number;
    category: 'almuerzo' | 'cafeteria' | 'mixed';
  }>;
  pendingRefunds: number;
  pendingRefundAmount: number;
  collectionBySchool: Array<{
    school_name: string;
    pending: number;
    lunchPending: number;
    cafeteriaPending: number;
    collected: number;
    debtors: number;
  }>;
}

const emptyStats: DashboardStats = {
  totalPending: 0,
  lunchPending: 0,
  cafeteriaPending: 0,
  totalCollectedToday: 0,
  totalCollectedWeek: 0,
  totalCollectedMonth: 0,
  totalDebtors: 0,
  totalTicketsPending: 0,
  totalTicketsPaid: 0,
  lunchDebtors: 0,
  cafeteriaDebtors: 0,
  totalTeacherDebt: 0,
  totalStudentDebt: 0,
  totalManualDebt: 0,
  teacherDebtors: 0,
  studentDebtors: 0,
  manualDebtors: 0,
  collectedYesterday: 0,
  debtByAge: { today: 0, days1to3: 0, days4to7: 0, days8to15: 0, daysOver15: 0, countToday: 0, count1to3: 0, count4to7: 0, count8to15: 0, countOver15: 0 },
  paymentMethods: { efectivo: 0, tarjeta: 0, yape: 0, transferencia: 0, plin: 0, otro: 0 },
  topDebtors: [],
  pendingRefunds: 0,
  pendingRefundAmount: 0,
  collectionBySchool: [],
};

// isLunchTransaction eliminada — la categorización ocurre en el RPC get_billing_dashboard_stats

// fetchAllPaginated eliminado — las stats se calculan en Postgres via get_billing_dashboard_stats RPC

export const BillingDashboard = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const dashboardSyncTs = useDebouncedSync('dashboard', 800);
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [debtCategory, setDebtCategory] = useState<DebtCategory>('all');
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [adminRanking, setAdminRanking] = useState<AdminRankEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingExpanded, setRankingExpanded] = useState(false);
  const [selectedAdminTimeline, setSelectedAdminTimeline] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Helpers de fecha
  const todayDateStr = () => new Date().toISOString().split('T')[0];
  const mondayDateStr = (base?: string) => {
    const d = base ? new Date(base + 'T12:00:00') : new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d.toISOString().split('T')[0];
  };

  // Estados del input (lo que el usuario está escribiendo)
  const [dateFrom, setDateFrom] = useState<string>(mondayDateStr());
  const [dateTo, setDateTo] = useState<string>(todayDateStr());
  // Estados aplicados (los que realmente disparan el fetch — solo cambian al presionar Buscar o un atajo)
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>(mondayDateStr());
  const [appliedDateTo, setAppliedDateTo] = useState<string>(todayDateStr());

  const canViewAllSchools = role === 'admin_general';

  // ── Atajos de rango de fechas — aplican inmediatamente (1 clic = 2 valores definidos) ──
  const applyRange = (range: 'today' | 'yesterday' | 'week' | 'month' | 'lastmonth') => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    let from = fmt(now);
    let to = fmt(now);
    if (range === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = fmt(y); to = fmt(y);
    } else if (range === 'week') {
      const mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      from = fmt(mon); to = fmt(now);
    } else if (range === 'month') {
      from = fmt(new Date(now.getFullYear(), now.getMonth(), 1)); to = fmt(now);
    } else if (range === 'lastmonth') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      from = fmt(first); to = fmt(last);
    }
    // Actualiza inputs Y estados aplicados al mismo tiempo
    setDateFrom(from); setDateTo(to);
    setAppliedDateFrom(from); setAppliedDateTo(to);
  };

  // ── Aplicar filtro manual (botón Buscar) ──
  const aplicarFiltroFecha = () => {
    if (!dateFrom || !dateTo) return;
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
  };

  useEffect(() => {
    fetchUserSchool();
    fetchSchools();
  }, [user]);

  useEffect(() => {
    if (userSchoolId || canViewAllSchools) {
      fetchDashboardStats();
      fetchAdminRanking();
    }
  }, [selectedSchool, appliedDateFrom, appliedDateTo, userSchoolId, canViewAllSchools]);

  useEffect(() => {
    if (dashboardSyncTs > 0 && (userSchoolId || canViewAllSchools)) {
      fetchDashboardStats();
      toast({ title: '🔄 Dashboard actualizado', description: 'Se detectaron cambios en cobranzas.', duration: 3000 });
    }
  }, [dashboardSyncTs]);

  const fetchUserSchool = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single();
    if (data?.school_id) {
      setUserSchoolId(data.school_id);
      if (!canViewAllSchools) {
        setSelectedSchool(data.school_id);
      }
    }
  };

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const fetchAdminRanking = async () => {
    setRankingLoading(true);
    try {
      const periodStart = appliedDateFrom + 'T00:00:00-05:00';
      const periodEnd   = appliedDateTo   + 'T23:59:59-05:00';
      const schoolIdFilter = (!canViewAllSchools || selectedSchool !== 'all')
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;

      // Traer cobros aprobados en recharge_requests — sin join de FK nombrado para evitar 400
      let rrQuery = supabase
        .from('recharge_requests')
        .select('id, amount, approved_by, approved_at, school_id, request_type, schools:school_id(name)')
        .eq('status', 'approved')
        .not('approved_by', 'is', null)
        .gte('approved_at', periodStart)
        .lte('approved_at', periodEnd);
      if (schoolIdFilter) rrQuery = rrQuery.eq('school_id', schoolIdFilter);
      const { data: rrData } = await rrQuery.limit(2000);

      // Traer transacciones de cobro manual — sin join de FK nombrado para evitar 400
      let txQuery = supabase
        .from('transactions')
        .select('id, amount, created_by, created_at, school_id, metadata, schools:school_id(name)')
        .eq('type', 'purchase')
        .eq('payment_status', 'paid')
        .eq('is_deleted', false)
        .not('created_by', 'is', null)
        .gte('created_at', periodStart)
        .lte('created_at', periodEnd);
      if (schoolIdFilter) txQuery = txQuery.eq('school_id', schoolIdFilter);
      const { data: txData } = await txQuery.limit(2000);
      const nonPosTxData = (txData || []).filter((t: any) => t.metadata?.source !== 'pos');

      // Recolectar IDs únicos de admins y hacer UNA sola consulta de perfiles
      const adminIds = new Set<string>();
      rrData?.forEach((r: any) => { if (r.approved_by) adminIds.add(r.approved_by); });
      nonPosTxData.forEach((t: any) => { if (t.created_by) adminIds.add(t.created_by); });

      const profilesMap = new Map<string, { full_name: string; role: string }>();
      if (adminIds.size > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .in('id', Array.from(adminIds));
        profilesData?.forEach((p: any) => profilesMap.set(p.id, p));
      }

      // Construir mapa admin_id → stats
      const map = new Map<string, AdminRankEntry>();

      const addEntry = (adminId: string, amount: number, timestamp: string, schoolName: string) => {
        if (!adminId) return;
        const profile = profilesMap.get(adminId);
        if (!profile) return;
        if (!map.has(adminId)) {
          map.set(adminId, {
            admin_id: adminId,
            name: profile.full_name || 'Sin nombre',
            role: profile.role || 'admin',
            school_name: schoolName || 'Sin sede',
            amountCollected: 0,
            ticketsCollected: 0,
            timeline: Array.from({ length: 24 }, (_, h) => ({ hour: String(h).padStart(2, '0') + ':00', amount: 0, count: 0 })),
          });
        }
        const entry = map.get(adminId)!;
        const amt = Math.abs(amount || 0);
        entry.amountCollected += amt;
        entry.ticketsCollected++;
        // timezone Lima UTC-5
        const hour = new Date(new Date(timestamp).getTime() - 5 * 3600000).getUTCHours();
        entry.timeline[hour].amount += amt;
        entry.timeline[hour].count++;
      };

      rrData?.forEach((r: any) => {
        addEntry(r.approved_by, r.amount, r.approved_at, (r.schools as any)?.name || '');
      });
      nonPosTxData.forEach((t: any) => {
        addEntry(t.created_by, Math.abs(t.amount || 0), t.created_at, (t.schools as any)?.name || '');
      });

      const ranking = Array.from(map.values()).sort((a, b) => b.amountCollected - a.amountCollected);
      setAdminRanking(ranking);
    } catch (e) {
      console.error('Error fetching admin ranking:', e);
    } finally {
      setRankingLoading(false);
    }
  };

  const fetchDashboardStats = async () => {
    const currentRequestId = ++requestIdRef.current;
    try {
      setLoading(true);
      const schoolIdFilter = (!canViewAllSchools || selectedSchool !== 'all')
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;

      const { data: rpcData, error } = await supabase.rpc('get_billing_dashboard_stats', {
        p_school_id: schoolIdFilter ?? null,
        p_date_from: appliedDateFrom,
        p_date_to:   appliedDateTo,
      });

      if (error) {
        console.error('Error fetching dashboard stats RPC:', error);
        return;
      }

      if (currentRequestId !== requestIdRef.current) return;

      const s = rpcData as DashboardStats & {
        debtByAge: DashboardStats['debtByAge'];
        paymentMethods: DashboardStats['paymentMethods'];
        topDebtors: DashboardStats['topDebtors'];
        collectionBySchool: DashboardStats['collectionBySchool'];
      };

      setStats({
        totalPending:        Number(s.totalPending        ?? 0),
        lunchPending:        Number(s.lunchPending        ?? 0),
        cafeteriaPending:    Number(s.cafeteriaPending    ?? 0),
        totalCollectedToday: Number(s.totalCollectedToday ?? 0),
        totalCollectedWeek:  Number(s.totalCollectedWeek  ?? 0),
        totalCollectedMonth: Number(s.totalCollectedMonth ?? 0),
        collectedYesterday:  Number(s.collectedYesterday  ?? 0),
        totalDebtors:        Number(s.totalDebtors        ?? 0),
        totalTicketsPending: Number(s.totalTicketsPending ?? 0),
        totalTicketsPaid:    Number(s.totalTicketsPaid    ?? 0),
        lunchDebtors:        Number(s.lunchDebtors        ?? 0),
        cafeteriaDebtors:    Number(s.cafeteriaDebtors    ?? 0),
        totalTeacherDebt:    Number(s.totalTeacherDebt    ?? 0),
        totalStudentDebt:    Number(s.totalStudentDebt    ?? 0),
        totalManualDebt:     Number(s.totalManualDebt     ?? 0),
        teacherDebtors:      Number(s.teacherDebtors      ?? 0),
        studentDebtors:      Number(s.studentDebtors      ?? 0),
        manualDebtors:       Number(s.manualDebtors       ?? 0),
        debtByAge:           s.debtByAge        ?? emptyStats.debtByAge,
        paymentMethods:      s.paymentMethods   ?? emptyStats.paymentMethods,
        topDebtors:          s.topDebtors       ?? [],
        pendingRefunds:      Number(s.pendingRefunds      ?? 0),
        pendingRefundAmount: Number(s.pendingRefundAmount ?? 0),
        collectionBySchool:  s.collectionBySchool ?? [],
      });
      setLastRefresh(new Date());

    } catch (error) {
      if (currentRequestId !== requestIdRef.current) return;
      console.error('Error fetching dashboard stats:', error);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const getRecommendations = () => {
    const recs: Array<{ icon: any; color: string; bgColor: string; borderColor: string; title: string; description: string; priority: 'urgent' | 'warning' | 'info' | 'success' }> = [];

    if (stats.debtByAge.daysOver15 > 0) {
      recs.push({
        icon: ShieldAlert, color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-300',
        title: `${stats.debtByAge.countOver15} deuda(s) con más de 15 días sin pagar`,
        description: `Total: S/ ${stats.debtByAge.daysOver15.toFixed(2)}. Contacta urgentemente a estos deudores para evitar acumulación.`,
        priority: 'urgent',
      });
    }

    if (stats.debtByAge.days8to15 > 0) {
      recs.push({
        icon: AlertTriangle, color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-300',
        title: `${stats.debtByAge.count8to15} deuda(s) de 8 a 15 días pendientes`,
        description: `Total: S/ ${stats.debtByAge.days8to15.toFixed(2)}. Envía recordatorios antes de que se vuelvan críticas.`,
        priority: 'warning',
      });
    }

    if (stats.teacherDebtors > 0) {
      recs.push({
        icon: UserCheck, color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-300',
        title: `${stats.teacherDebtors} profesor(es) con deuda pendiente`,
        description: `Total: S/ ${stats.totalTeacherDebt.toFixed(2)}. Los profesores suelen pagar rápido si les envías un recordatorio.`,
        priority: 'warning',
      });
    }

    if (stats.manualDebtors > 0) {
      recs.push({
        icon: Users, color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-300',
        title: `${stats.manualDebtors} cliente(s) manual(es) con deuda`,
        description: `Total: S/ ${stats.totalManualDebt.toFixed(2)}. Verifica que los datos de contacto estén actualizados.`,
        priority: 'warning',
      });
    }

    if (stats.pendingRefunds > 0) {
      recs.push({
        icon: RefreshCw, color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-300',
        title: `${stats.pendingRefunds} reembolso(s) pendiente(s) de devolución`,
        description: `Total: S/ ${stats.pendingRefundAmount.toFixed(2)}. Pedidos anulados que ya habían sido pagados.`,
        priority: 'urgent',
      });
    }

    if (stats.collectedYesterday > 0) {
      const diff = stats.totalCollectedToday - stats.collectedYesterday;
      const pct = ((diff / stats.collectedYesterday) * 100).toFixed(0);
      if (diff > 0) {
        recs.push({
          icon: TrendingUp, color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-300',
          title: `Has cobrado ${pct}% más que ayer`,
          description: `Hoy: S/ ${stats.totalCollectedToday.toFixed(2)} vs Ayer: S/ ${stats.collectedYesterday.toFixed(2)}. ¡Buen ritmo!`,
          priority: 'success',
        });
      } else if (diff < 0) {
        recs.push({
          icon: TrendingDown, color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-300',
          title: `Hoy llevas ${Math.abs(Number(pct))}% menos que ayer`,
          description: `Hoy: S/ ${stats.totalCollectedToday.toFixed(2)} vs Ayer: S/ ${stats.collectedYesterday.toFixed(2)}. Revisa la pestaña "¡Cobrar!" para gestionar pagos.`,
          priority: 'info',
        });
      }
    }

    if (stats.totalPending === 0 && stats.totalDebtors === 0) {
      recs.push({
        icon: CheckCircle2, color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-300',
        title: '¡Todas las cuentas están al día!',
        description: 'No hay deudas pendientes. Excelente gestión de cobranza.',
        priority: 'success',
      });
    }

    if (stats.totalDebtors > 5) {
      recs.push({
        icon: Lightbulb, color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-300',
        title: 'Consejo: Prioriza los montos grandes',
        description: `Tienes ${stats.totalDebtors} deudores. Enfócate primero en los 5 mayores deudores que representan la mayor parte del monto pendiente.`,
        priority: 'info',
      });
    }

    const priorityOrder = { urgent: 0, warning: 1, info: 2, success: 3 };
    recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    return recs;
  };

  const getDebtorTypeBadge = (type: 'student' | 'teacher' | 'manual') => {
    switch (type) {
      case 'teacher': return <Badge className="bg-green-600 text-xs">Profesor</Badge>;
      case 'student': return <Badge className="bg-blue-600 text-xs">Alumno</Badge>;
      case 'manual': return <Badge className="bg-orange-600 text-xs">Manual</Badge>;
    }
  };

  const getCategoryBadge = (cat: 'almuerzo' | 'cafeteria' | 'mixed') => {
    switch (cat) {
      case 'almuerzo': return <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 bg-amber-50">Almuerzo</Badge>;
      case 'cafeteria': return <Badge variant="outline" className="text-[10px] border-sky-400 text-sky-700 bg-sky-50">Cafetería</Badge>;
      case 'mixed': return <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700 bg-purple-50">Mixto</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-red-600" />
        <p className="text-gray-600 font-medium">Analizando datos de cobranza...</p>
        <p className="text-xs text-gray-400">Incluyendo deudas de almuerzos y cafetería</p>
      </div>
    );
  }

  const recommendations = getRecommendations();
  const totalPayments = Object.values(stats.paymentMethods).reduce((a, b) => a + b, 0);

  // Valores filtrados por categoría seleccionada
  const displayPending = debtCategory === 'all' ? stats.totalPending
    : debtCategory === 'almuerzo' ? stats.lunchPending
    : stats.cafeteriaPending;

  const displayDebtors = debtCategory === 'all' ? stats.totalDebtors
    : debtCategory === 'almuerzo' ? stats.lunchDebtors
    : stats.cafeteriaDebtors;

  const filteredTopDebtors = debtCategory === 'all' ? stats.topDebtors
    : stats.topDebtors.filter(d => d.category === debtCategory || d.category === 'mixed');

  return (
    <div className="space-y-6">
      {/* ===== HEADER CON FILTROS ===== */}
      <div className="space-y-3">

        {/* Fila 1: Sede + Actualizar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {canViewAllSchools && schools.length > 1 && (
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-red-600" />
                <select
                  value={selectedSchool}
                  onChange={(e) => setSelectedSchool(e.target.value)}
                  className="bg-white flex h-10 rounded-md border border-input px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">Todas las Sedes</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => { fetchDashboardStats(); fetchAdminRanking(); }}
            className="text-xs gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Actualizar
            <span className="text-gray-400 ml-1">
              {lastRefresh.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </Button>
        </div>

        {/* Fila 2: Rango de fechas */}
        <div className="space-y-2">
          {/* Atajos de rango */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { label: 'Hoy',         range: 'today'      },
              { label: 'Ayer',        range: 'yesterday'  },
              { label: 'Esta semana', range: 'week'       },
              { label: 'Este mes',    range: 'month'      },
              { label: 'Mes anterior',range: 'lastmonth'  },
            ] as const).map(({ label, range }) => (
              <button
                key={range}
                onClick={() => applyRange(range)}
                className="px-2.5 py-1 text-xs rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors font-medium"
              >
                {label}
              </button>
            ))}
          </div>
          {/* Inputs de fecha + botón Buscar */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-xs text-gray-500">Desde</p>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aplicarFiltroFecha()}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-500">Hasta</p>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aplicarFiltroFecha()}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <Button
            onClick={aplicarFiltroFecha}
            disabled={!dateFrom || !dateTo}
            size="sm"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            <Search className="h-4 w-4" />
            Buscar
          </Button>
        </div>
      </div>

      {/* ===== FILTRO CATEGORÍA: ALMUERZO / CAFETERÍA / TOTAL ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Filtrar deuda:</span>
        {([
          { key: 'all' as DebtCategory, label: 'Total', icon: DollarSign, amount: stats.totalPending, color: 'red' },
          { key: 'almuerzo' as DebtCategory, label: 'Almuerzos', icon: UtensilsCrossed, amount: stats.lunchPending, color: 'amber' },
          { key: 'cafeteria' as DebtCategory, label: 'Cafetería', icon: Coffee, amount: stats.cafeteriaPending, color: 'sky' },
        ]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setDebtCategory(opt.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all border",
              debtCategory === opt.key
                ? opt.color === 'red' ? "bg-red-100 border-red-400 text-red-800 shadow-sm"
                  : opt.color === 'amber' ? "bg-amber-100 border-amber-400 text-amber-800 shadow-sm"
                  : "bg-sky-100 border-sky-400 text-sky-800 shadow-sm"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            )}
          >
            <opt.icon className="h-4 w-4" />
            {opt.label}
            <span className="font-black ml-1">S/ {opt.amount.toFixed(2)}</span>
          </button>
        ))}
      </div>

      {/* ===== SECCIÓN 1: RESUMEN EJECUTIVO ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Por Cobrar (filtrado por categoría) */}
        <Card className="border-l-4 border-red-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 uppercase tracking-wide">
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              {debtCategory === 'all' ? 'Total Por Cobrar' : debtCategory === 'almuerzo' ? 'Deuda Almuerzos' : 'Deuda Cafetería'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-red-600">
              S/ {displayPending.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 mt-1">{displayDebtors} deudor(es) · periodo seleccionado</p>
            {debtCategory === 'all' && (stats.lunchPending > 0 || stats.cafeteriaPending > 0) && (
              <div className="flex gap-3 mt-2 text-[10px]">
                <span className="text-amber-700 font-semibold">Almuerzos: S/ {stats.lunchPending.toFixed(2)}</span>
                <span className="text-sky-700 font-semibold">Cafetería: S/ {stats.cafeteriaPending.toFixed(2)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cobrado (deudas cobradas del período) */}
        <Card className="border-l-4 border-green-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 uppercase tracking-wide">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              Deudas Cobradas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-green-600">
              S/ {stats.totalCollectedWeek.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Pagos recibidos en el período (excluye ventas al contado del kiosco)
            </p>
          </CardContent>
        </Card>

        {/* Tickets Pendientes */}
        <Card className="border-l-4 border-blue-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 uppercase tracking-wide">
              <Calendar className="h-3.5 w-3.5 text-blue-500" />
              Tickets Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-blue-600">
              {stats.totalTicketsPending}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {stats.totalDebtors} deudor(es) · {stats.totalTicketsPending} ticket(s) sin pagar
            </p>
            {stats.totalTicketsPending > 0 && (
              <p className="text-[10px] text-blue-500 mt-1">
                Promedio S/ {stats.totalDebtors > 0 ? (stats.totalPending / stats.totalDebtors).toFixed(2) : '0.00'} por deudor
              </p>
            )}
          </CardContent>
        </Card>

        {/* Eficiencia */}
        <Card className="border-l-4 border-purple-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 uppercase tracking-wide">
              <TrendingUp className="h-3.5 w-3.5 text-purple-500" />
              Eficiencia de Cobro
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const cobrado  = stats.totalCollectedWeek;   // deudas cobradas del período
              const pendiente = stats.totalPending;         // deudas sin cobrar del período
              const vendido  = cobrado + pendiente;
              const pct = vendido > 0 ? Math.round((cobrado / vendido) * 100) : 100;
              const color = pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600';
              return (
                <>
                  <div className={cn('text-2xl font-black', color)}>{pct}%</div>
                  <p className="text-xs text-gray-500 mt-1">
                    Cobrado S/ {cobrado.toFixed(2)} de S/ {vendido.toFixed(2)} generado
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Pendiente S/ {pendiente.toFixed(2)} · {pct < 100 ? `Falta cobrar ${100 - pct}%` : '¡Todo cobrado!'}
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* ===== SECCIÓN 2: RECOMENDACIONES ===== */}
      {recommendations.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50 border-b pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-indigo-900">
              <Zap className="h-5 w-5 text-indigo-600" />
              Recomendaciones y Alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {recommendations.map((rec, i) => (
                <div key={i} className={cn("flex items-start gap-3 p-4", rec.bgColor)}>
                  <div className={cn("h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 border", rec.borderColor, rec.bgColor)}>
                    <rec.icon className={cn("h-4.5 w-4.5", rec.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-semibold text-sm", rec.color)}>{rec.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{rec.description}</p>
                  </div>
                  {rec.priority === 'urgent' && (
                    <Badge variant="destructive" className="text-[10px] flex-shrink-0">URGENTE</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== SECCIÓN 3: DESGLOSE + ANTIGÜEDAD ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deuda por tipo */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
              <Users className="h-4 w-4 text-gray-600" />
              Deuda por Tipo de Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-lg">👨‍🎓</span>
                <div>
                  <p className="font-semibold text-sm text-blue-900">Alumnos</p>
                  <p className="text-xs text-blue-600">{stats.studentDebtors} deudor(es)</p>
                </div>
              </div>
              <p className="font-bold text-blue-800">S/ {stats.totalStudentDebt.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-lg">👨‍🏫</span>
                <div>
                  <p className="font-semibold text-sm text-green-900">Profesores</p>
                  <p className="text-xs text-green-600">{stats.teacherDebtors} deudor(es)</p>
                </div>
              </div>
              <p className="font-bold text-green-800">S/ {stats.totalTeacherDebt.toFixed(2)}</p>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-lg">👤</span>
                <div>
                  <p className="font-semibold text-sm text-orange-900">Clientes Manuales</p>
                  <p className="text-xs text-orange-600">{stats.manualDebtors} deudor(es)</p>
                </div>
              </div>
              <p className="font-bold text-orange-800">S/ {stats.totalManualDebt.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Antigüedad */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
              <Clock className="h-4 w-4 text-gray-600" />
              Antigüedad de Deudas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Hoy', amount: stats.debtByAge.today, count: stats.debtByAge.countToday, color: 'bg-green-100 text-green-800 border-green-300' },
              { label: '1-3 días', amount: stats.debtByAge.days1to3, count: stats.debtByAge.count1to3, color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
              { label: '4-7 días', amount: stats.debtByAge.days4to7, count: stats.debtByAge.count4to7, color: 'bg-orange-100 text-orange-800 border-orange-300' },
              { label: '8-15 días', amount: stats.debtByAge.days8to15, count: stats.debtByAge.count8to15, color: 'bg-red-100 text-red-800 border-red-300' },
              { label: '+15 días', amount: stats.debtByAge.daysOver15, count: stats.debtByAge.countOver15, color: 'bg-red-200 text-red-900 border-red-400' },
            ].map((tier, i) => (
              <div key={i} className={cn("flex items-center justify-between p-2.5 rounded-lg border", tier.color)}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm min-w-[70px]">{tier.label}</span>
                  <Badge variant="outline" className="text-[10px]">{tier.count} tx</Badge>
                </div>
                <p className="font-bold text-sm">S/ {tier.amount.toFixed(2)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ===== SECCIÓN 4: MÉTODOS DE PAGO ===== */}
      {totalPayments > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
              <CreditCard className="h-4 w-4 text-gray-600" />
              Métodos de Pago Recibidos (Este Mes)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Efectivo', icon: '💵', amount: stats.paymentMethods.efectivo, color: 'bg-green-50 border-green-200' },
                { label: 'Yape', icon: '📱', amount: stats.paymentMethods.yape, color: 'bg-purple-50 border-purple-200' },
                { label: 'Tarjeta', icon: '💳', amount: stats.paymentMethods.tarjeta, color: 'bg-blue-50 border-blue-200' },
                { label: 'Transferencia', icon: '🏦', amount: stats.paymentMethods.transferencia, color: 'bg-cyan-50 border-cyan-200' },
                { label: 'Plin', icon: '📲', amount: stats.paymentMethods.plin, color: 'bg-teal-50 border-teal-200' },
              ].filter(m => m.amount > 0).map((method, i) => (
                <div key={i} className={cn("text-center p-3 rounded-lg border", method.color)}>
                  <span className="text-2xl">{method.icon}</span>
                  <p className="font-bold text-sm mt-1">S/ {method.amount.toFixed(2)}</p>
                  <p className="text-xs text-gray-600">{method.label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {totalPayments > 0 ? ((method.amount / totalPayments) * 100).toFixed(0) : 0}%
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== SECCIÓN 5: TOP DEUDORES ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
            <TrendingUp className="h-4 w-4 text-red-600" />
            Top 15 Deudores
            {debtCategory !== 'all' && (
              <Badge variant="outline" className="ml-2 text-xs">
                {debtCategory === 'almuerzo' ? 'Solo Almuerzos' : 'Solo Cafetería'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTopDebtors.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">¡Excelente! No hay deudas pendientes.</p>
              <p className="text-xs text-gray-400 mt-1">Todas las cuentas están al día.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTopDebtors.map((debtor, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg hover:shadow-sm transition-all",
                    debtor.days_overdue > 15 ? "bg-red-50 border border-red-200" :
                    debtor.days_overdue > 7 ? "bg-orange-50 border border-orange-200" :
                    "bg-gray-50 border border-gray-200"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm border",
                      debtor.days_overdue > 15 ? "bg-red-200 text-red-800 border-red-300" :
                      debtor.days_overdue > 7 ? "bg-orange-200 text-orange-800 border-orange-300" :
                      "bg-gray-200 text-gray-700 border-gray-300"
                    )}>
                      {index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm text-gray-900">{debtor.name}</p>
                        {getDebtorTypeBadge(debtor.type)}
                        {getCategoryBadge(debtor.category)}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {canViewAllSchools && (
                          <p className="text-xs text-gray-500">{debtor.school_name}</p>
                        )}
                        <p className="text-xs text-gray-400">•</p>
                        <p className={cn("text-xs font-medium",
                          debtor.days_overdue > 15 ? "text-red-600" :
                          debtor.days_overdue > 7 ? "text-orange-600" :
                          "text-gray-500"
                        )}>
                          {debtor.days_overdue === 0 ? 'Hoy' : `${debtor.days_overdue} día(s)`}
                        </p>
                        <p className="text-xs text-gray-400">• {debtor.count} transacción(es)</p>
                      </div>
                    </div>
                  </div>
                  <p className={cn("text-base font-bold",
                    debtor.days_overdue > 15 ? "text-red-700" :
                    debtor.days_overdue > 7 ? "text-orange-700" :
                    "text-gray-800"
                  )}>
                    S/ {debtor.amount.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== SECCIÓN 6: POR SEDE ===== */}
      {canViewAllSchools && selectedSchool === 'all' && stats.collectionBySchool.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
              <Building2 className="h-4 w-4 text-blue-600" />
              Cobranza por Sede
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.collectionBySchool.map((school, index) => {
              const total = school.pending + school.collected;
              const pct = total > 0 ? (school.collected / total) * 100 : 0;
              return (
                <div key={index} className="space-y-2 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm text-gray-900">{school.school_name}</p>
                      <p className="text-xs text-gray-500">{school.debtors} deudor(es)</p>
                    </div>
                    <div className="flex gap-4 text-xs">
                      <span className="text-red-600 font-bold">
                        Pend: S/ {school.pending.toFixed(2)}
                      </span>
                      <span className="text-green-600 font-bold">
                        Cobrado: S/ {school.collected.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  {/* Desglose almuerzo/cafetería por sede */}
                  <div className="flex gap-3 text-[10px]">
                    <span className="text-amber-700 font-semibold">
                      <UtensilsCrossed className="h-3 w-3 inline mr-0.5" />
                      Almuerzos: S/ {school.lunchPending.toFixed(2)}
                    </span>
                    <span className="text-sky-700 font-semibold">
                      <Coffee className="h-3 w-3 inline mr-0.5" />
                      Cafetería: S/ {school.cafeteriaPending.toFixed(2)}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className={cn(
                        "h-2.5 rounded-full transition-all",
                        pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500"
                      )}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 text-right">{pct.toFixed(0)}% cobrado</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      {/* ===== SECCIÓN 7: RANKING DE ADMINS POR COBRANZA ===== */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-yellow-50 to-orange-50 border-b pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-yellow-900">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Ranking de Cobranza — Admins
            </CardTitle>
            <div className="flex items-center gap-2">
              {rankingLoading && <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />}
              <button
                onClick={() => setRankingExpanded(!rankingExpanded)}
                className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-800"
              >
                {rankingExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {rankingExpanded ? 'Ocultar' : 'Ver todo'}
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {adminRanking.length === 0 && !rankingLoading && (
            <p className="text-sm text-gray-400 text-center py-4">Sin actividad en el período seleccionado</p>
          )}

          {/* ── Alertas automáticas ── */}
          {adminRanking.length >= 2 && (() => {
            const top = adminRanking[0];
            const avg = adminRanking.reduce((s, a) => s + a.amountCollected, 0) / adminRanking.length;
            const topPct = avg > 0 ? Math.round((top.amountCollected / avg - 1) * 100) : 0;
            const zero = adminRanking.filter(a => a.amountCollected === 0);
            return (
              <div className="space-y-2">
                {topPct >= 20 && (
                  <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <Trophy className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-green-800 font-medium">
                      🥇 <strong>{top.name}</strong> está cobrando <strong>{topPct}% más</strong> que el promedio del equipo (S/ {avg.toFixed(0)} promedio · S/ {top.amountCollected.toFixed(0)} ella/él)
                    </p>
                  </div>
                )}
                {zero.length > 0 && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-800 font-medium">
                      ⚠️ {zero.map(a => <strong key={a.admin_id}>{a.name}</strong>).reduce((a: any, b: any, i) => [a, i > 0 ? ', ' : '', b], [] as any)} no registra cobros en este período.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Lista ranking ── */}
          <div className="space-y-2">
            {(rankingExpanded ? adminRanking : adminRanking.slice(0, 5)).map((admin, idx) => {
              const maxAmt = adminRanking[0]?.amountCollected || 1;
              const barPct = Math.round((admin.amountCollected / maxAmt) * 100);
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
              const isSelected = selectedAdminTimeline === admin.admin_id;
              return (
                <div key={admin.admin_id} className="space-y-1">
                  <div
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                      isSelected ? 'bg-yellow-50 border border-yellow-300' : 'hover:bg-gray-50'
                    )}
                    onClick={() => setSelectedAdminTimeline(isSelected ? null : admin.admin_id)}
                  >
                    <span className="text-base w-7 text-center flex-shrink-0">{medal}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-800 truncate">{admin.name}</span>
                        <span className="text-sm font-black text-green-700 flex-shrink-0">S/ {admin.amountCollected.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">{admin.school_name} · {admin.ticketsCollected} cobros</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                        <div
                          className={cn(
                            'h-1.5 rounded-full transition-all',
                            idx === 0 ? 'bg-yellow-400' : idx === 1 ? 'bg-gray-400' : idx === 2 ? 'bg-amber-600' : 'bg-blue-400'
                          )}
                          style={{ width: `${Math.max(barPct, 2)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Línea de tiempo por hora (se abre al hacer click) */}
                  {isSelected && (
                    <div className="ml-10 bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2 flex items-center gap-1">
                        <Activity className="h-3 w-3" /> Actividad por hora — {admin.name}
                      </p>
                      <div className="flex items-end gap-0.5 h-16">
                        {admin.timeline.map((slot, h) => {
                          const maxSlot = Math.max(...admin.timeline.map(s => s.amount), 1);
                          const ht = Math.max(Math.round((slot.amount / maxSlot) * 100), slot.amount > 0 ? 8 : 0);
                          const isWork = h >= 7 && h <= 18;
                          return (
                            <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={`${slot.hour}: S/${slot.amount.toFixed(0)} (${slot.count} cobros)`}>
                              <div
                                className={cn(
                                  'w-full rounded-sm transition-all',
                                  slot.amount > 0 ? 'bg-green-500' : isWork ? 'bg-gray-200' : 'bg-gray-100'
                                )}
                                style={{ height: `${ht}%`, minHeight: slot.amount > 0 ? '4px' : '2px' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {admin.timeline.filter(s => s.count > 0).map(s => (
                          <span key={s.hour} className="text-[10px] bg-green-100 text-green-800 rounded px-1.5 py-0.5 font-medium">
                            {s.hour} → S/ {s.amount.toFixed(0)} ({s.count} cobros)
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {!rankingExpanded && adminRanking.length > 5 && (
              <button onClick={() => setRankingExpanded(true)} className="text-xs text-blue-600 hover:underline w-full text-center pt-1">
                Ver {adminRanking.length - 5} admins más...
              </button>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
};
