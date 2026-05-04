import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  Users,
  CheckCircle2,
  RefreshCw,
  Search,
  Download,
  Clock,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Wifi,
  Lock,
  Database,
  HelpCircle,
  ClipboardCheck,
  BellRing,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Tipos ──────────────────────────────────────────────────────────────────

interface ErrorLog {
  id: string;
  source_id: string;
  source_table: 'error_logs' | 'system_error_logs';
  is_live_error: boolean;
  created_at: string;
  user_email: string | null;
  user_role: string | null;
  error_type: string | null;
  error_message: string | null;
  error_translated: string | null;
  page_url: string | null;
  component: string | null;
  action: string | null;
  user_agent: string | null;
  stack_trace: string | null;
  metadata: Record<string, unknown> | null;
  is_resolved: boolean;
  message?: string | null;
}

interface ErrorStatistic {
  error_type: string;
  total_count: number;
  affected_users: number;
  last_occurrence: string;
  avg_hours_ago: number;
}

// ── Helpers de traducción ─────────────────────────────────────────────────

function humanRole(role: string | null): string {
  const map: Record<string, string> = {
    parent: 'Padre / Madre de familia',
    admin: 'Administrador',
    admin_general: 'Administrador General',
    superadmin: 'Super Administrador',
    gestor_unidad: 'Gestor de Sede',
    contadora: 'Contadora',
    kiosk: 'Kiosco',
    guest: 'Visitante',
    unknown: 'Usuario desconocido',
  };
  return map[role ?? 'unknown'] ?? role ?? 'Usuario desconocido';
}

function humanComponent(component: string | null, pageUrl: string | null): string {
  const map: Record<string, string> = {
    RechargeModal: 'pantalla de recarga de saldo',
    UnifiedLunchCalendar: 'calendario de almuerzos',
    UnifiedLunchCalendarV2: 'calendario de almuerzos',
    LunchOrderCalendar: 'reserva de almuerzos',
    OrderLunchMenus: 'elección de menú de almuerzo',
    LunchDeliveryDashboard: 'entrega de almuerzos',
    PaymentsTab: 'historial de pagos',
    BalanceHero: 'resumen de saldo',
    VoucherApproval: 'aprobación de voucher',
    POS: 'caja / punto de venta',
    Index: 'página principal',
    ParentConfiguration: 'configuración de cuenta',
  };
  if (component && map[component]) return map[component];
  if (pageUrl) {
    const url = pageUrl.replace(/.*#\/?/, '').split('?')[0];
    if (url.includes('lunch')) return 'sección de almuerzos';
    if (url.includes('recharge')) return 'recarga de saldo';
    if (url.includes('onboarding')) return 'registro de cuenta';
    if (url.includes('dashboard')) return 'panel principal';
    if (url.includes('pos')) return 'caja';
    return url || 'la aplicación';
  }
  return 'la aplicación';
}

function humanAction(action: string | null, component: string | null): string {
  if (action) {
    const map: Record<string, string> = {
      recharge: 'recargar saldo',
      order_lunch: 'reservar almuerzo',
      cancel_order: 'cancelar reserva de almuerzo',
      approve_voucher: 'aprobar un voucher de pago',
      login: 'iniciar sesión',
      register: 'crear su cuenta',
      pay: 'realizar un pago',
      view_balance: 'ver su saldo',
      update_profile: 'actualizar su perfil',
    };
    if (map[action]) return map[action];
    return action;
  }
  if (component) {
    const map: Record<string, string> = {
      RechargeModal: 'recargar saldo',
      UnifiedLunchCalendar: 'ver el calendario de almuerzos',
      LunchOrderCalendar: 'reservar almuerzo',
      OrderLunchMenus: 'elegir menú',
      PaymentsTab: 'revisar sus pagos',
      VoucherApproval: 'aprobar un voucher',
      POS: 'atender en caja',
    };
    return map[component] ?? 'usar el sistema';
  }
  return 'usar el sistema';
}

function humanErrorMessage(log: ErrorLog): string {
  return (
    log.error_translated ||
    log.error_message ||
    log.message ||
    'Ha ocurrido un error. Por favor, intenta nuevamente o contacta con soporte si el problema persiste.'
  );
}

function errorTypeConfig(type: string | null) {
  const cfg: Record<string, { label: string; color: string; bg: string; border: string; Icon: React.ElementType }> = {
    auth: {
      label: 'Acceso',
      color: 'text-yellow-700',
      bg: 'bg-yellow-50',
      border: 'border-yellow-300',
      Icon: Lock,
    },
    database: {
      label: 'Base de datos',
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-300',
      Icon: Database,
    },
    validation: {
      label: 'Formulario',
      color: 'text-orange-700',
      bg: 'bg-orange-50',
      border: 'border-orange-300',
      Icon: AlertTriangle,
    },
    network: {
      label: 'Conexión',
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      border: 'border-blue-300',
      Icon: Wifi,
    },
    permission: {
      label: 'Permisos',
      color: 'text-purple-700',
      bg: 'bg-purple-50',
      border: 'border-purple-300',
      Icon: ShieldAlert,
    },
    ui_runtime: {
      label: 'Interfaz en vivo',
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-300',
      Icon: AlertTriangle,
    },
    unknown: {
      label: 'Desconocido',
      color: 'text-gray-600',
      bg: 'bg-gray-50',
      border: 'border-gray-200',
      Icon: HelpCircle,
    },
  };
  return cfg[type ?? 'unknown'] ?? cfg.unknown;
}

// ── Componente de tarjeta individual de error ─────────────────────────────

function ErrorCard({ log, onResolve }: { log: ErrorLog; onResolve: (log: ErrorLog) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = errorTypeConfig(log.error_type);
  const { Icon } = cfg;

  const who = log.user_email
    ? `${log.user_email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} (${humanRole(log.user_role)})`
    : humanRole(log.user_role);

  const where = humanComponent(log.component, log.page_url);
  const what = humanAction(log.action, log.component);
  const message = humanErrorMessage(log);

  const rawTechnical = log.error_message ?? log.message ?? '';

  const liveClasses = log.is_live_error
    ? 'border-red-400 bg-red-50/80 ring-1 ring-red-200'
    : `${cfg.border} ${cfg.bg}`;

  return (
    <div
      className={`rounded-xl border-l-4 ${liveClasses} ${log.is_resolved ? 'opacity-60' : ''} shadow-sm transition-all`}
    >
      <div className="p-4">
        {/* Fila superior: tipo + tiempo + estado */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {log.is_live_error && (
            <Badge className="text-xs bg-red-600 text-white hover:bg-red-600">
              EN VIVO (PADRE)
            </Badge>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-white/70 ${cfg.color} border ${cfg.border}`}>
            <Icon className="h-3 w-3" />
            {cfg.label}
          </span>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(log.created_at), { locale: es, addSuffix: true })}
            <span className="text-gray-400 hidden sm:inline">
              ({format(new Date(log.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })})
            </span>
          </span>
          {log.is_resolved && (
            <Badge variant="outline" className="text-green-700 border-green-400 bg-green-50 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Resuelto
            </Badge>
          )}
        </div>

        {/* Historia del error en lenguaje natural */}
        <div className="space-y-1 mb-3">
          <p className="text-sm font-semibold text-gray-800">
            👤 {who}
          </p>
          <p className="text-sm text-gray-700">
            Estaba en <span className="font-medium">{where}</span> intentando <span className="font-medium">{what}</span>.
          </p>
          <p className={`text-sm font-medium ${cfg.color} mt-1`}>
            ❌ {message}
          </p>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Ocultar detalles técnicos' : 'Ver detalles técnicos (para el técnico)'}
          </button>
          {!log.is_resolved && log.source_table === 'error_logs' && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs border-green-400 text-green-700 hover:bg-green-50"
              onClick={() => onResolve(log)}
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
              Marcar resuelto
            </Button>
          )}
          {!log.is_resolved && log.source_table === 'system_error_logs' && (
            <Badge variant="outline" className="ml-auto text-red-700 border-red-300 bg-red-100/70">
              Monitoreo en vivo
            </Badge>
          )}
        </div>

        {/* Detalles técnicos colapsables */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Información técnica</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
              <div><span className="font-medium">Correo:</span> {log.user_email ?? 'anónimo'}</div>
              <div><span className="font-medium">Rol:</span> {log.user_role ?? '—'}</div>
              <div><span className="font-medium">Componente:</span> {log.component ?? '—'}</div>
              <div><span className="font-medium">Acción:</span> {log.action ?? '—'}</div>
              <div><span className="font-medium">Origen:</span> {log.source_table}</div>
              <div className="col-span-1 sm:col-span-2">
                <span className="font-medium">URL:</span>{' '}
                <span className="break-all">{log.page_url ?? '—'}</span>
              </div>
            </div>
            {rawTechnical && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Mensaje técnico (para pasar al técnico):</p>
                <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                  {rawTechnical}
                  {log.stack_trace ? `\n\n--- Stack Trace ---\n${log.stack_trace}` : ''}
                </pre>
              </div>
            )}
            {log.metadata && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Datos adicionales:</p>
                <pre className="text-xs bg-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────────────────

export default function ErrorDashboard() {
  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState<ErrorStatistic[]>([]);
  const [recentErrors, setRecentErrors] = useState<ErrorLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('pending');

  useEffect(() => {
    fetchErrorData();
  }, []);

  const fetchErrorData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('unified_system_monitor')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      if (data) setRecentErrors(data as ErrorLog[]);
    } catch (err) {
      console.error('Error cargando datos de errores:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsResolved = async (log: ErrorLog) => {
    if (log.source_table !== 'error_logs') {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase
        .from('error_logs')
        .update({
          is_resolved: true,
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq('id', log.source_id);
      setRecentErrors(prev =>
        prev.map(e => e.id === log.id ? { ...e, is_resolved: true } : e)
      );
    } catch (err) {
      console.error('Error marcando como resuelto:', err);
    }
  };

  const exportToCSV = () => {
    const rows = [
      ['Fecha', 'Quién', 'Rol', 'Dónde estaba', 'Qué hacía', 'Qué pasó', 'URL', 'Tipo', 'Resuelto'],
      ...recentErrors.map(e => [
        format(new Date(e.created_at), 'dd/MM/yyyy HH:mm'),
        e.user_email ?? 'anónimo',
        humanRole(e.user_role),
        humanComponent(e.component, e.page_url),
        humanAction(e.action, e.component),
        `"${humanErrorMessage(e)}"`,
        e.page_url ?? '',
        e.error_type ?? 'unknown',
        e.is_resolved ? 'Sí' : 'No',
      ].join(','))
    ].join('\n');

    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `errores-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // ── Filtrado ──────────────────────────────────────────────────────────────
  const filtered = recentErrors.filter(e => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      !term ||
      (e.user_email ?? '').toLowerCase().includes(term) ||
      (e.error_translated ?? '').toLowerCase().includes(term) ||
      (e.error_message ?? '').toLowerCase().includes(term) ||
      (e.page_url ?? '').toLowerCase().includes(term) ||
      (e.component ?? '').toLowerCase().includes(term) ||
      humanComponent(e.component, e.page_url).toLowerCase().includes(term);

    const matchType = filterType === 'all' || e.error_type === filterType;

    const matchStatus =
      filterStatus === 'all' ||
      (filterStatus === 'pending' && !e.is_resolved) ||
      (filterStatus === 'resolved' && e.is_resolved);

    return matchSearch && matchType && matchStatus;
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const map = new Map<string, { total_count: number; users: Set<string>; last: string }>();
    recentErrors
      .filter(item => new Date(item.created_at) >= cutoff)
      .forEach(item => {
        const key = item.error_type ?? 'unknown';
        const current = map.get(key) ?? { total_count: 0, users: new Set<string>(), last: item.created_at };
        current.total_count += 1;
        if (item.user_email) current.users.add(item.user_email);
        if (new Date(item.created_at) > new Date(current.last)) current.last = item.created_at;
        map.set(key, current);
      });

    const nextStats: ErrorStatistic[] = Array.from(map.entries()).map(([error_type, value]) => ({
      error_type,
      total_count: value.total_count,
      affected_users: value.users.size,
      last_occurrence: value.last,
      avg_hours_ago: Math.round((Date.now() - new Date(value.last).getTime()) / 36e5),
    })).sort((a, b) => b.total_count - a.total_count);

    setStatistics(nextStats);
  }, [recentErrors]);

  const totalErrors = statistics.reduce((s, x) => s + x.total_count, 0);
  const affectedUsers = Math.max(...statistics.map(x => x.affected_users), 0);
  const pendingCount = recentErrors.filter(e => !e.is_resolved).length;
  const resolvedCount = recentErrors.filter(e => e.is_resolved).length;
  const resolutionRate = recentErrors.length
    ? Math.round((resolvedCount / recentErrors.length) * 100)
    : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">Cargando historial de errores…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-0">

      {/* ── Encabezado ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-red-500" />
            <h2 className="text-xl font-bold text-gray-900">Monitor de Errores</h2>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            El sistema te avisa cuando algo falla — sin esperar que te lo cuenten
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchErrorData}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Actualizar
          </Button>
          <Button size="sm" onClick={exportToCSV} className="bg-green-600 hover:bg-green-700 text-white">
            <Download className="h-4 w-4 mr-1.5" />
            Exportar
          </Button>
        </div>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Total errores (30 días)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold text-gray-900">{totalErrors}</p>
            <p className="text-xs text-gray-400 mt-1">registrados en la base de datos</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Personas afectadas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-orange-500" />
              <p className="text-3xl font-bold text-gray-900">{affectedUsers}</p>
            </div>
            <p className="text-xs text-gray-400 mt-1">padres o usuarios únicos</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Sin resolver
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${pendingCount > 0 ? 'text-red-500' : 'text-gray-300'}`} />
              <p className={`text-3xl font-bold ${pendingCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {pendingCount}
              </p>
            </div>
            <p className="text-xs text-gray-400 mt-1">errores pendientes de revisar</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Resueltos
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`h-5 w-5 ${resolutionRate > 0 ? 'text-green-500' : 'text-gray-300'}`} />
              <p className="text-3xl font-bold text-gray-900">{resolutionRate}%</p>
            </div>
            <p className="text-xs text-gray-400 mt-1">{resolvedCount} de {recentErrors.length} últimos</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Distribución por tipo ─────────────────────────────────────────── */}
      {statistics.length > 0 && (
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">¿Qué tipo de errores hay?</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {statistics.map(stat => {
              const cfg = errorTypeConfig(stat.error_type);
              const max = Math.max(...statistics.map(s => s.total_count), 1);
              return (
                <div key={stat.error_type} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-28 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${cfg.border.replace('border', 'bg')}`}
                      style={{ width: `${(stat.total_count / max) * 100}%`, background: undefined }}
                    />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-6 text-right">{stat.total_count}</span>
                  <span className="text-xs text-gray-400 hidden sm:block">
                    {stat.affected_users} {stat.affected_users === 1 ? 'persona' : 'personas'}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Historial de errores ──────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="px-4 pt-4 pb-3">
          <CardTitle className="text-sm font-semibold text-gray-700">
            Historial de errores
          </CardTitle>
          <p className="text-xs text-gray-400">
            Cada tarjeta te dice quién fue, cuándo ocurrió y qué estaba intentando hacer
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">

          {/* Filtros */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por nombre, mensaje o pantalla…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 text-sm h-9"
              />
            </div>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm text-gray-700 h-9 bg-white"
            >
              <option value="all">Todos los tipos</option>
              <option value="auth">Acceso / Contraseña</option>
              <option value="database">Base de datos</option>
              <option value="validation">Formulario</option>
              <option value="network">Conexión</option>
              <option value="permission">Permisos</option>
              <option value="ui_runtime">Interfaz en vivo (padre)</option>
              <option value="unknown">Desconocido</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm text-gray-700 h-9 bg-white"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Sin resolver</option>
              <option value="resolved">Resueltos</option>
            </select>
          </div>

          {/* Lista */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-400 mb-3" />
              <p className="text-base font-semibold text-gray-700">Todo en orden</p>
              <p className="text-sm text-gray-400 mt-1">
                {searchTerm || filterType !== 'all' || filterStatus !== 'pending'
                  ? 'No hay errores que coincidan con el filtro aplicado.'
                  : 'No hay errores pendientes de resolver. ¡El sistema está funcionando bien!'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {filtered.map(log => (
                <ErrorCard key={log.id} log={log} onResolve={markAsResolved} />
              ))}
            </div>
          )}

          {filtered.length > 0 && (
            <p className="text-xs text-gray-400 text-right">
              Mostrando {filtered.length} de {recentErrors.length} errores registrados
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
