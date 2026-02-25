import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DollarSign,
  TrendingUp,
  Building2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User,
  ArrowLeft,
  Calendar,
  Search,
  Banknote,
  CreditCard,
  Smartphone,
  History,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';

interface SchoolCashSummary {
  school_id: string;
  school_name: string;
  school_code: string;
  register_id: string | null;
  register_status: 'open' | 'closed' | 'never_opened';
  opened_at: string | null;
  closed_at: string | null;
  opened_by_name: string | null;
  initial_amount: number;
  last_closure_date: string | null;
  last_closure_actual: number | null;
  last_closure_difference: number | null;
  last_closure_total_sales: number | null;
  today_sales: number;
  today_cash: number;
  today_card: number;
  today_yape: number;
  today_credit: number;
  has_unclosed_previous: boolean;
}

interface ClosureRecord {
  id: string;
  school_id: string;
  closure_date: string;
  initial_amount: number;
  expected_final: number;
  actual_final: number;
  difference: number;
  total_sales: number;
  total_cash: number;
  total_card: number;
  total_yape: number;
  total_yape_qr: number;
  total_credit: number;
  total_ingresos: number;
  total_egresos: number;
  pos_total: number;
  lunch_total: number;
  created_at: string;
  closed_by_profile?: { full_name: string } | null;
}

type ViewMode = 'today' | 'history';

export default function AdminGeneralCashDashboard() {
  const [schools, setSchools] = useState<SchoolCashSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSchool, setExpandedSchool] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Vista y filtros
  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [historyStartDate, setHistoryStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [historyEndDate, setHistoryEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [historySchool, setHistorySchool] = useState<string>('all');
  const [closureHistory, setClosureHistory] = useState<ClosureRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Cargar estado de hoy ────────────────────────────────
  const loadData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: schoolsData } = await supabase
        .from('schools')
        .select('id, name, code')
        .order('name');

      if (!schoolsData) { setLoading(false); return; }

      const summaries: SchoolCashSummary[] = await Promise.all(
        schoolsData.map(async (school) => {
          const { data: openReg } = await supabase
            .from('cash_registers')
            .select('id, status, opened_at, closed_at, initial_amount, opened_by')
            .eq('school_id', school.id)
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          let hasPrevUnclosed = false;
          if (openReg) {
            const openedDate = new Date(openReg.opened_at);
            openedDate.setHours(0, 0, 0, 0);
            if (openedDate < today) hasPrevUnclosed = true;
          }

          let openedByName: string | null = null;
          if (openReg?.opened_by && !hasPrevUnclosed) {
            const { data: opener } = await supabase
              .from('profiles')
              .select('full_name, email')
              .eq('id', openReg.opened_by)
              .single();
            openedByName = opener?.full_name || opener?.email || 'Desconocido';
          }

          const { data: lastClosure } = await supabase
            .from('cash_closures')
            .select('closure_date, actual_final, difference, total_sales, total_cash, total_card, total_yape, total_credit, created_at')
            .eq('school_id', school.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          let todaySales = 0, todayCash = 0, todayCard = 0, todayYape = 0, todayCredit = 0;
          const todayOpenReg = openReg && !hasPrevUnclosed ? openReg : null;

          if (todayOpenReg) {
            try {
              const { data: totals } = await supabase.rpc('calculate_daily_totals', {
                p_school_id: school.id,
                p_date: format(today, 'yyyy-MM-dd'),
              });
              if (totals) {
                todaySales = (totals.pos?.total || 0) + (totals.lunch?.total || 0);
                todayCash = (totals.pos?.cash || 0) + (totals.pos?.mixed_cash || 0) + (totals.lunch?.cash || 0);
                todayCard = (totals.pos?.card || 0) + (totals.pos?.mixed_card || 0) + (totals.lunch?.card || 0);
                todayYape = (totals.pos?.yape || 0) + (totals.pos?.mixed_yape || 0) + (totals.lunch?.yape || 0);
                todayCredit = (totals.pos?.credit || 0) + (totals.lunch?.credit || 0);
              }
            } catch (_) {}
          }

          const status: 'open' | 'closed' | 'never_opened' =
            todayOpenReg
              ? 'open'
              : lastClosure?.closure_date === format(today, 'yyyy-MM-dd')
                ? 'closed'
                : 'never_opened';

          return {
            school_id: school.id,
            school_name: school.name,
            school_code: school.code,
            register_id: todayOpenReg?.id || null,
            register_status: status,
            opened_at: todayOpenReg?.opened_at || null,
            closed_at: lastClosure?.created_at || null,
            opened_by_name: openedByName,
            initial_amount: todayOpenReg?.initial_amount || 0,
            last_closure_date: lastClosure?.closure_date || null,
            last_closure_actual: lastClosure?.actual_final || null,
            last_closure_difference: lastClosure?.difference || null,
            last_closure_total_sales: lastClosure?.total_sales || null,
            today_sales: todaySales,
            today_cash: todayCash,
            today_card: todayCard,
            today_yape: todayYape,
            today_credit: todayCredit,
            has_unclosed_previous: hasPrevUnclosed,
          };
        })
      );

      setSchools(summaries);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error cargando dashboard de caja:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Cargar historial de cierres ────────────────────────────
  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      let query = supabase
        .from('cash_closures')
        .select(`
          id, school_id, closure_date, initial_amount, expected_final, actual_final, difference,
          total_sales, total_cash, total_card, total_yape, total_yape_qr, total_credit,
          total_ingresos, total_egresos, pos_total, lunch_total, created_at,
          closed_by_profile:profiles!cash_closures_closed_by_fkey(full_name)
        `)
        .gte('closure_date', historyStartDate)
        .lte('closure_date', historyEndDate)
        .order('closure_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (historySchool !== 'all') {
        query = query.eq('school_id', historySchool);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;
      setClosureHistory(data || []);
    } catch (err) {
      console.error('Error cargando historial:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (viewMode === 'history') loadHistory(); }, [viewMode]);

  const openCount    = schools.filter(s => s.register_status === 'open').length;
  const closedCount  = schools.filter(s => s.register_status === 'closed').length;
  const problemCount = schools.filter(s => s.has_unclosed_previous || s.register_status === 'never_opened').length;
  const totalSales   = schools.reduce((acc, s) => acc + s.today_sales, 0);

  // ── Encontrar nombre de sede por ID ────────────────────────
  const getSchoolName = (id: string) => schools.find(s => s.school_id === id)?.school_name || id;
  const getSchoolCode = (id: string) => schools.find(s => s.school_id === id)?.school_code || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Cargando estado de cajas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => window.location.href = '/#/dashboard'} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          <div>
            <h1 className="text-2xl font-black">💰 Control de Cajas — Todas las Sedes</h1>
            <p className="text-sm text-muted-foreground">
              Actualizado {format(lastRefresh, "HH:mm:ss", { locale: es })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'today' ? 'default' : 'outline'}
            onClick={() => setViewMode('today')}
            className="gap-2"
          >
            <Clock className="h-4 w-4" /> Hoy
          </Button>
          <Button
            variant={viewMode === 'history' ? 'default' : 'outline'}
            onClick={() => setViewMode('history')}
            className="gap-2"
          >
            <History className="h-4 w-4" /> Historial
          </Button>
          <Button variant="outline" onClick={loadData} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </Button>
        </div>
      </div>

      {/* ═══ VISTA: HOY ═══════════════════════════════════════════ */}
      {viewMode === 'today' && (
        <>
          {/* Cards resumen ejecutivo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-green-700 font-medium uppercase">Cajas Abiertas</p>
                    <p className="text-3xl font-black text-green-700">{openCount}</p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200 bg-gray-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 font-medium uppercase">Cerradas Hoy</p>
                    <p className="text-3xl font-black text-gray-700">{closedCount}</p>
                  </div>
                  <XCircle className="h-8 w-8 text-gray-400" />
                </div>
              </CardContent>
            </Card>

            <Card className={problemCount > 0 ? 'border-red-200 bg-red-50' : 'border-gray-100'}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs font-medium uppercase ${problemCount > 0 ? 'text-red-700' : 'text-gray-600'}`}>
                      Con Problemas
                    </p>
                    <p className={`text-3xl font-black ${problemCount > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                      {problemCount}
                    </p>
                  </div>
                  <AlertTriangle className={`h-8 w-8 ${problemCount > 0 ? 'text-red-500' : 'text-gray-300'}`} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-blue-700 font-medium uppercase">Ventas Hoy</p>
                    <p className="text-2xl font-black text-blue-700">S/ {totalSales.toFixed(2)}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Lista de sedes */}
          <div className="space-y-3">
            {schools.map((school) => {
              const isExpanded = expandedSchool === school.school_id;
              const diff = school.last_closure_difference ?? 0;

              return (
                <Card
                  key={school.school_id}
                  className={`border-2 transition-all cursor-pointer ${
                    school.has_unclosed_previous
                      ? 'border-red-400 bg-red-50'
                      : school.register_status === 'open'
                        ? 'border-green-300'
                        : school.register_status === 'never_opened'
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-gray-200'
                  }`}
                  onClick={() => setExpandedSchool(isExpanded ? null : school.school_id)}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg shrink-0 ${
                          school.register_status === 'open' ? 'bg-green-100' :
                          school.has_unclosed_previous ? 'bg-red-100' : 'bg-gray-100'
                        }`}>
                          <Building2 className={`h-5 w-5 ${
                            school.register_status === 'open' ? 'text-green-600' :
                            school.has_unclosed_previous ? 'text-red-600' : 'text-gray-500'
                          }`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-base truncate">{school.school_name}</p>
                          <p className="text-xs text-gray-500">{school.school_code}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {school.has_unclosed_previous ? (
                          <Badge className="bg-red-100 text-red-800 border-red-300">
                            ⚠️ Sin cerrar (día anterior)
                          </Badge>
                        ) : school.register_status === 'open' ? (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            🟢 Abierta
                            {school.opened_at && (
                              <span className="ml-1 opacity-70">
                                {format(new Date(school.opened_at), 'HH:mm')}
                              </span>
                            )}
                          </Badge>
                        ) : school.register_status === 'closed' ? (
                          <Badge className="bg-gray-100 text-gray-700 border-gray-300">
                            🔒 Cerrada
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                            ⏸️ Sin aperturar
                          </Badge>
                        )}

                        {school.today_sales > 0 && (
                          <span className="text-sm font-bold text-emerald-700">
                            S/ {school.today_sales.toFixed(2)}
                          </span>
                        )}

                        {school.register_status === 'closed' && school.last_closure_difference !== null && (
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            Math.abs(diff) < 0.01
                              ? 'bg-green-100 text-green-700'
                              : diff < 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {Math.abs(diff) < 0.01 ? '✅ Cuadra' : diff < 0 ? `⚠️ −S/ ${Math.abs(diff).toFixed(2)}` : `⚠️ +S/ ${diff.toFixed(2)}`}
                          </span>
                        )}

                        <div className="h-8 w-8 flex items-center justify-center">
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                      </div>
                    </div>

                    {/* Detalle expandido */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-4 text-sm" onClick={(e) => e.stopPropagation()}>
                        {/* Info apertura */}
                        <div className="space-y-2">
                          <p className="font-semibold text-gray-700 flex items-center gap-1">
                            <Clock className="h-4 w-4" /> Apertura
                          </p>
                          {school.register_status === 'open' ? (
                            <div className="bg-green-50 rounded-lg p-3 space-y-1">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Hora:</span>
                                <span className="font-medium">
                                  {school.opened_at ? format(new Date(school.opened_at), 'HH:mm', { locale: es }) : '—'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Cajero:</span>
                                <span className="font-medium flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {school.opened_by_name || '—'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Inició con:</span>
                                <span className="font-bold text-green-700">S/ {school.initial_amount.toFixed(2)}</span>
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-500 italic text-xs">
                              {school.register_status === 'closed' ? 'Caja ya cerrada' : 'No se ha abierto caja hoy'}
                            </p>
                          )}
                        </div>

                        {/* Ventas del día */}
                        <div className="space-y-2">
                          <p className="font-semibold text-gray-700 flex items-center gap-1">
                            <DollarSign className="h-4 w-4" /> Ventas de hoy
                          </p>
                          {school.today_sales > 0 || (school.register_status === 'closed' && school.last_closure_total_sales) ? (
                            <div className="bg-blue-50 rounded-lg p-3 space-y-1">
                              {(school.today_cash > 0 || school.register_status === 'closed') && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600 flex items-center gap-1"><Banknote className="h-3 w-3" /> Efectivo:</span>
                                  <span className="font-medium text-green-700">S/ {school.today_cash.toFixed(2)}</span>
                                </div>
                              )}
                              {school.today_card > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600 flex items-center gap-1"><CreditCard className="h-3 w-3" /> Tarjeta:</span>
                                  <span className="font-medium text-blue-700">S/ {school.today_card.toFixed(2)}</span>
                                </div>
                              )}
                              {school.today_yape > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600 flex items-center gap-1"><Smartphone className="h-3 w-3" /> Yape:</span>
                                  <span className="font-medium text-purple-700">S/ {school.today_yape.toFixed(2)}</span>
                                </div>
                              )}
                              {school.today_credit > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Crédito:</span>
                                  <span className="font-medium text-amber-700">S/ {school.today_credit.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex justify-between border-t pt-1 mt-1">
                                <span className="font-bold">Total:</span>
                                <span className="font-black text-blue-800">
                                  S/ {(school.today_sales || school.last_closure_total_sales || 0).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-500 italic text-xs">Sin ventas registradas hoy</p>
                          )}
                        </div>

                        {/* Último cierre */}
                        <div className="space-y-2">
                          <p className="font-semibold text-gray-700 flex items-center gap-1">
                            <History className="h-4 w-4" /> Último cierre
                          </p>
                          {school.last_closure_date ? (
                            <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Fecha:</span>
                                <span className="font-medium">
                                  {format(new Date(school.last_closure_date + 'T12:00:00'), "dd MMM yyyy", { locale: es })}
                                </span>
                              </div>
                              {school.closed_at && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Hora cierre:</span>
                                  <span className="font-medium">{format(new Date(school.closed_at), 'HH:mm')}</span>
                                </div>
                              )}
                              {school.last_closure_actual !== null && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Cerró con:</span>
                                  <span className="font-bold">S/ {school.last_closure_actual.toFixed(2)}</span>
                                </div>
                              )}
                              {school.last_closure_difference !== null && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Diferencia:</span>
                                  <span className={Math.abs(school.last_closure_difference) < 0.01 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                                    {Math.abs(school.last_closure_difference) < 0.01
                                      ? '✅ S/ 0.00'
                                      : `⚠️ S/ ${school.last_closure_difference.toFixed(2)}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-gray-500 italic text-xs">Sin cierres registrados</p>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ═══ VISTA: HISTORIAL ═════════════════════════════════════ */}
      {viewMode === 'history' && (
        <>
          {/* Filtros */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <Label className="text-xs font-semibold uppercase text-gray-500">Fecha Inicio</Label>
                  <Input
                    type="date"
                    value={historyStartDate}
                    onChange={(e) => setHistoryStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase text-gray-500">Fecha Fin</Label>
                  <Input
                    type="date"
                    value={historyEndDate}
                    onChange={(e) => setHistoryEndDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase text-gray-500">Sede</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={historySchool}
                    onChange={(e) => setHistorySchool(e.target.value)}
                  >
                    <option value="all">Todas las sedes</option>
                    {schools.map(s => (
                      <option key={s.school_id} value={s.school_id}>{s.school_code} - {s.school_name}</option>
                    ))}
                  </select>
                </div>
                <Button onClick={loadHistory} className="gap-2">
                  <Search className="h-4 w-4" /> Buscar
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Totales del período */}
          {closureHistory.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-4 pb-4 text-center">
                  <p className="text-xs text-blue-600 font-medium uppercase">Total Ventas</p>
                  <p className="text-xl font-black text-blue-700">
                    S/ {closureHistory.reduce((s, c) => s + c.total_sales, 0).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-green-50 border-green-200">
                <CardContent className="pt-4 pb-4 text-center">
                  <p className="text-xs text-green-600 font-medium uppercase">Efectivo</p>
                  <p className="text-xl font-black text-green-700">
                    S/ {closureHistory.reduce((s, c) => s + c.total_cash, 0).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="pt-4 pb-4 text-center">
                  <p className="text-xs text-purple-600 font-medium uppercase">Yape</p>
                  <p className="text-xl font-black text-purple-700">
                    S/ {closureHistory.reduce((s, c) => s + c.total_yape + c.total_yape_qr, 0).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-gray-50 border-gray-200">
                <CardContent className="pt-4 pb-4 text-center">
                  <p className="text-xs text-gray-600 font-medium uppercase">Cierres</p>
                  <p className="text-xl font-black text-gray-700">{closureHistory.length}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Lista de cierres */}
          {loadingHistory ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Cargando historial...</p>
            </div>
          ) : closureHistory.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No hay cierres en el rango seleccionado</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {closureHistory.map((closure) => {
                const diff = closure.difference;
                return (
                  <Card key={closure.id} className="border hover:shadow-md transition-shadow">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        {/* Fecha y sede */}
                        <div className="flex items-center gap-3">
                          <div className="text-center bg-gray-100 rounded-lg px-3 py-2 min-w-[70px]">
                            <p className="text-lg font-black leading-tight">
                              {format(new Date(closure.closure_date + 'T12:00:00'), 'dd')}
                            </p>
                            <p className="text-[10px] uppercase text-gray-500 font-semibold">
                              {format(new Date(closure.closure_date + 'T12:00:00'), 'MMM yyyy', { locale: es })}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold">{getSchoolCode(closure.school_id)} — {getSchoolName(closure.school_id)}</p>
                            <p className="text-xs text-gray-500">
                              Cerrado: {format(new Date(closure.created_at), 'HH:mm', { locale: es })}
                              {closure.closed_by_profile?.full_name && (
                                <span> por {closure.closed_by_profile.full_name}</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Montos rápidos */}
                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500 uppercase">Inició</p>
                            <p className="font-bold">S/ {closure.initial_amount.toFixed(2)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500 uppercase">Cerró</p>
                            <p className="font-bold">S/ {closure.actual_final.toFixed(2)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500 uppercase">Vendió</p>
                            <p className="font-bold text-blue-700">S/ {closure.total_sales.toFixed(2)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-gray-500 uppercase">Yape</p>
                            <p className="font-bold text-purple-700">S/ {(closure.total_yape + closure.total_yape_qr).toFixed(2)}</p>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            Math.abs(diff) < 0.01
                              ? 'bg-green-100 text-green-700'
                              : diff < 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {Math.abs(diff) < 0.01 ? '✅' : diff < 0 ? `−S/ ${Math.abs(diff).toFixed(2)}` : `+S/ ${diff.toFixed(2)}`}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {schools.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            No hay sedes registradas en el sistema.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
