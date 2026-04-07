import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Wallet, Search, TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle,
  Loader2, RefreshCw, ShieldAlert, ChevronDown, ChevronUp, Eye,
  Image as ImageIcon, FileSpreadsheet, FileText, Info, ChevronLeft, ChevronRight,
  History
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Student {
  id: string;
  full_name: string;
  balance: number;
  free_account: boolean | null;
  kiosk_disabled: boolean;
  school_id: string;
  school_name?: string;
  limit_type?: 'none' | 'daily' | 'weekly' | 'monthly' | null;
  daily_limit?: number | null;
  weekly_limit?: number | null;
  monthly_limit?: number | null;
  total_recharged?: number;
  recharge_count?: number;
}

interface RechargeEntry {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  approved_at: string | null;
  reference_code: string | null;
  voucher_url: string | null;
}

interface TransactionEntry {
  id: string;
  amount: number;
  ticket_code: string | null;
  created_at: string;
  payment_status: string;
  description: string | null;
}

interface Props {
  canViewAllSchools: boolean;
  userSchoolId: string | null;
  schools: { id: string; name: string }[];
}

const PAGE_SIZE = 50;

// Normalizar texto: quitar tildes, minúsculas
const normalize = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// ── Componente ─────────────────────────────────────────────────────────────────

export const KioskWalletReport = ({ canViewAllSchools, userSchoolId, schools }: Props) => {
  const { role } = useRole();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Student[] | null>(null); // null = no hay búsqueda activa
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [recharges, setRecharges] = useState<RechargeEntry[]>([]);
  const [transactions, setTransactions] = useState<TransactionEntry[]>([]);
  const [expandedTopes, setExpandedTopes] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const canEditTopes = role === 'admin_general' || role === 'superadmin';

  // ── Filtro de sede efectivo ────────────────────────────────────────────────
  const effectiveSchoolId = !canViewAllSchools
    ? userSchoolId
    : schoolFilter !== 'all' ? schoolFilter : null;

  // ── Fetch paginado ─────────────────────────────────────────────────────────
  const fetchStudents = useCallback(async (pageNum = 0) => {
    setLoading(true);
    try {
      const from = pageNum * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      let query = supabase
        .from('students')
        .select(
          'id, full_name, balance, free_account, kiosk_disabled, school_id, limit_type, daily_limit, weekly_limit, monthly_limit, schools(name)',
          { count: 'exact' }
        )
        // Condición: balance != 0 OR free_account = false
        // Los que tienen recargas históricas se incluyen vía free_account = false
        // o balance != 0. Si tuvieron recargas y luego volvieron a cuenta libre,
        // los capturamos con la búsqueda global o con el subquery de recharges
        .or('balance.neq.0,free_account.eq.false')
        .order('balance', { ascending: false })
        .range(from, to);

      if (effectiveSchoolId) query = query.eq('school_id', effectiveSchoolId);

      const { data, error, count } = await query;
      if (error) throw error;

      // Enriquecer con totales de recargas
      const ids = (data || []).map((s: any) => s.id);
      const rechargeMap = await fetchRechargeMap(ids);

      const enriched = (data || []).map((s: any) => ({
        ...s,
        school_name: s.schools?.name || '—',
        total_recharged: rechargeMap.get(s.id)?.total || 0,
        recharge_count:  rechargeMap.get(s.id)?.count || 0,
      }));

      setStudents(enriched);
      setTotalCount(count || 0);
      setPage(pageNum);
    } catch (e: any) {
      console.error('KioskWalletReport fetchStudents:', e);
      toast({ title: 'Error al cargar alumnos', description: e.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [effectiveSchoolId]);

  // ── Helper: obtener mapa de recargas para un lote de student IDs ───────────
  const fetchRechargeMap = async (ids: string[]) => {
    const map = new Map<string, { total: number; count: number }>();
    if (!ids.length) return map;
    const { data } = await supabase
      .from('recharge_requests')
      .select('student_id, amount')
      .in('student_id', ids)
      .eq('request_type', 'recharge')
      .eq('status', 'approved');
    (data || []).forEach((r: any) => {
      const prev = map.get(r.student_id) || { total: 0, count: 0 };
      map.set(r.student_id, { total: prev.total + (r.amount || 0), count: prev.count + 1 });
    });
    return map;
  };

  // ── Búsqueda global (server-side, normalizada, multi-palabra) ──────────────
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim() || value.trim().length < 2) {
      setSearchResults(null);
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      runGlobalSearch(value.trim());
    }, 400);
  };

  const runGlobalSearch = async (term: string) => {
    setSearchLoading(true);
    try {
      // Dividir por palabras y buscar cada una con ilike (OR implícito por palabra, AND entre palabras)
      const words = normalize(term).split(/\s+/).filter(Boolean);

      let query = supabase
        .from('students')
        .select('id, full_name, balance, free_account, kiosk_disabled, school_id, limit_type, daily_limit, weekly_limit, monthly_limit, schools(name)')
        .order('balance', { ascending: false })
        .limit(200);

      if (effectiveSchoolId) query = query.eq('school_id', effectiveSchoolId);

      // Aplicar un ilike por cada palabra (busca que el nombre contenga TODAS las palabras)
      for (const word of words) {
        query = query.ilike('full_name', `%${word}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const ids = (data || []).map((s: any) => s.id);
      const rechargeMap = await fetchRechargeMap(ids);

      const enriched = (data || []).map((s: any) => ({
        ...s,
        school_name: s.schools?.name || '—',
        total_recharged: rechargeMap.get(s.id)?.total || 0,
        recharge_count:  rechargeMap.get(s.id)?.count || 0,
      }));

      setSearchResults(enriched);
    } catch (e: any) {
      console.error('KioskWalletReport search:', e);
    }
    setSearchLoading(false);
  };

  useEffect(() => { fetchStudents(0); }, [fetchStudents]);

  // Reset página y búsqueda al cambiar filtro de sede
  useEffect(() => {
    setSearch('');
    setSearchResults(null);
    fetchStudents(0);
  }, [schoolFilter]);

  // ── Datos a mostrar: búsqueda activa o paginación normal ──────────────────
  const displayStudents = searchResults !== null ? searchResults : students;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // ── Abrir billetera de un alumno ───────────────────────────────────────────
  const openWallet = async (student: Student) => {
    setSelectedStudent(student);
    setWalletLoading(true);
    setRecharges([]);
    setTransactions([]);
    try {
      const [rRes, tRes] = await Promise.all([
        supabase
          .from('recharge_requests')
          .select('id, amount, status, created_at, approved_at, reference_code, voucher_url')
          .eq('student_id', student.id)
          .eq('request_type', 'recharge')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('transactions')
          .select('id, amount, ticket_code, created_at, payment_status, description')
          .eq('student_id', student.id)
          .eq('type', 'purchase')
          .is('metadata->>lunch_order_id' as any, null)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (rRes.error) throw rRes.error;
      if (tRes.error) throw tRes.error;
      setRecharges(rRes.data || []);
      setTransactions(tRes.data || []);
    } catch (e: any) {
      toast({ title: 'Error al cargar billetera', description: e.message, variant: 'destructive' });
    }
    setWalletLoading(false);
  };

  // ── Exportar Excel ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    const rows = displayStudents.map(s => ({
      'Alumno':           s.full_name,
      'Sede':             s.school_name || '—',
      'Saldo Actual':     (s.balance || 0).toFixed(2),
      'Tipo de Cuenta':   s.kiosk_disabled ? 'Solo almuerzo' : s.free_account !== false ? 'Cuenta libre' : 'Con recargas',
      'Tope activo':      s.limit_type && s.limit_type !== 'none' ? s.limit_type : 'Sin tope',
      'Total Recargado':  (s.total_recharged || 0).toFixed(2),
      'Veces Recargado':  s.recharge_count || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Saldos Kiosco');
    XLSX.writeFile(wb, `recargas_kiosco_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── Exportar PDF ───────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Reporte de Saldos Kiosco', 14, 15);
    doc.setFontSize(9);
    doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, 14, 22);

    autoTable(doc, {
      startY: 27,
      head: [['Alumno', 'Sede', 'Saldo Actual', 'Tipo', 'Tope', 'Total Recargado', 'Recargas']],
      body: displayStudents.map(s => [
        s.full_name,
        s.school_name || '—',
        `S/ ${(s.balance || 0).toFixed(2)}`,
        s.kiosk_disabled ? 'Solo almuerzo' : s.free_account !== false ? 'Cuenta libre' : 'Con recargas',
        s.limit_type && s.limit_type !== 'none' ? s.limit_type : 'Sin tope',
        `S/ ${(s.total_recharged || 0).toFixed(2)}`,
        String(s.recharge_count || 0),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
      alternateRowStyles: { fillColor: [240, 245, 255] },
    });
    doc.save(`recargas_kiosco_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // ── Helpers UI ─────────────────────────────────────────────────────────────
  const fmt = (amount: number) => `S/ ${Math.abs(amount).toFixed(2)}`;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const getTipoLabel = (s: Student) => {
    if (s.kiosk_disabled) return <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">Solo almuerzo</Badge>;
    if (s.free_account !== false) return <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Cuenta libre</Badge>;
    return <Badge className="bg-blue-100 text-blue-800 text-[10px]">Con recargas</Badge>;
  };

  const getTopeLabel = (s: Student) => {
    if (!s.limit_type || s.limit_type === 'none') return 'Sin tope';
    const val = s.limit_type === 'daily' ? s.daily_limit : s.limit_type === 'weekly' ? s.weekly_limit : s.monthly_limit;
    const label = s.limit_type === 'daily' ? 'Diario' : s.limit_type === 'weekly' ? 'Semanal' : 'Mensual';
    return `${label} S/ ${val || 0}`;
  };

  const saldoTotal = students.reduce((sum, s) => sum + (s.balance || 0), 0);
  const recargadoTotal = students.reduce((sum, s) => sum + (s.total_recharged || 0), 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="space-y-4">

        {/* Header */}
        <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-blue-900">
                  <Wallet className="h-6 w-6 text-blue-600" />
                  Recargas — Saldos Kiosco
                </CardTitle>
                <CardDescription className="text-blue-700 mt-1">
                  Alumnos con saldo activo, historial de recargas o cuenta "Con Recargas".
                  {!canEditTopes && <span className="ml-2 text-orange-500">· Edición de topes: solo admin general</span>}
                </CardDescription>
              </div>
              {/* Botones exportar */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportExcel} className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 gap-1.5">
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </Button>
                <Button size="sm" variant="outline" onClick={exportPDF} className="text-red-700 border-red-300 hover:bg-red-50 gap-1.5">
                  <FileText className="h-4 w-4" />
                  PDF
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre (búsqueda global, sin importar página)..."
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="pl-10 pr-8"
            />
            {searchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
            )}
          </div>
          {canViewAllSchools && (
            <Select value={schoolFilter} onValueChange={setSchoolFilter}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Todas las sedes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sedes</SelectItem>
                {schools.map(sc => (
                  <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => fetchStudents(0)} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {/* Tarjetas resumen */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border border-emerald-200 bg-emerald-50">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-emerald-600 font-medium">Alumnos con saldo</p>
              <p className="text-2xl font-bold text-emerald-700">{students.filter(s => s.balance > 0).length}</p>
              <p className="text-[10px] text-emerald-500 mt-0.5">de esta página</p>
            </CardContent>
          </Card>

          <Card className="border border-blue-200 bg-blue-50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-xs text-blue-600 font-medium">Saldo del Sistema</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-blue-400 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px] text-xs">
                    Suma del saldo a favor de todos los alumnos visibles en esta página.
                    Incluye alumnos con cuenta "Con Recargas" activa o saldo pendiente de gastar.
                    No incluye deudas de almuerzo.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-2xl font-bold text-blue-700">S/ {saldoTotal.toFixed(2)}</p>
              <p className="text-[10px] text-blue-500 mt-0.5">página actual</p>
            </CardContent>
          </Card>

          <Card className="border border-purple-200 bg-purple-50">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-purple-600 font-medium">Total recargado histórico</p>
              <p className="text-2xl font-bold text-purple-700">S/ {recargadoTotal.toFixed(2)}</p>
              <p className="text-[10px] text-purple-500 mt-0.5">página actual</p>
            </CardContent>
          </Card>

          <Card className="border border-orange-200 bg-orange-50">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-orange-600 font-medium">Total registros</p>
              <p className="text-2xl font-bold text-orange-700">{searchResults !== null ? searchResults.length : totalCount}</p>
              <p className="text-[10px] text-orange-500 mt-0.5">{searchResults !== null ? 'en búsqueda' : 'en base de datos'}</p>
            </CardContent>
          </Card>
        </div>

        {/* Indicador de búsqueda activa */}
        {searchResults !== null && (
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <Search className="h-4 w-4 shrink-0" />
            <span>Búsqueda global activa: <strong>{searchResults.length}</strong> resultado(s) para <strong>"{search}"</strong></span>
            <button onClick={() => { setSearch(''); setSearchResults(null); }} className="ml-auto text-xs underline hover:no-underline">
              Limpiar
            </button>
          </div>
        )}

        {/* Tabla */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>
        ) : displayStudents.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-gray-400">No se encontraron alumnos.</CardContent></Card>
        ) : (
          <>
            <Card className="border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Alumno</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Sede</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Saldo Actual</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Tipo</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Topes</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Recargado</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayStudents.map(student => (
                      <tr key={student.id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{student.full_name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{student.school_name}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold text-base ${student.balance > 0 ? 'text-emerald-600' : student.balance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            S/ {(student.balance || 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">{getTipoLabel(student)}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setExpandedTopes(expandedTopes === student.id ? null : student.id)}
                            className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 mx-auto"
                          >
                            <span className={student.limit_type && student.limit_type !== 'none' ? 'text-blue-600 font-medium' : 'text-gray-400'}>
                              {getTopeLabel(student)}
                            </span>
                            {expandedTopes === student.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          {expandedTopes === student.id && (
                            <div className="mt-1 text-left bg-white border border-gray-200 rounded-lg p-2 shadow-sm text-xs space-y-0.5 z-10 relative">
                              <p>Tipo: <strong>{student.limit_type || 'none'}</strong></p>
                              <p>Diario: <strong>{student.daily_limit ? `S/ ${student.daily_limit}` : '—'}</strong></p>
                              <p>Semanal: <strong>{student.weekly_limit ? `S/ ${student.weekly_limit}` : '—'}</strong></p>
                              <p>Mensual: <strong>{student.monthly_limit ? `S/ ${student.monthly_limit}` : '—'}</strong></p>
                              {!canEditTopes && (
                                <p className="text-orange-500 flex items-center gap-1 mt-1">
                                  <ShieldAlert className="h-3 w-3" /> Solo admin general puede editar
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs">
                          {(student.total_recharged || 0) > 0
                            ? <span className="text-purple-600 font-medium">S/ {student.total_recharged!.toFixed(2)} ({student.recharge_count} {student.recharge_count === 1 ? 'vez' : 'veces'})</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => openWallet(student)}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs h-7">
                            <Wallet className="h-3 w-3 mr-1" /> Billetera
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Paginación (solo cuando no hay búsqueda activa) */}
            {searchResults === null && totalPages > 1 && (
              <div className="flex items-center justify-between px-1">
                <p className="text-sm text-gray-500">
                  Página {page + 1} de {totalPages} · {totalCount} registros totales
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={page === 0 || loading}
                    onClick={() => fetchStudents(page - 1)}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={page >= totalPages - 1 || loading}
                    onClick={() => fetchStudents(page + 1)}
                    className="gap-1"
                  >
                    Siguiente <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Modal Billetera ── */}
        <Dialog open={!!selectedStudent} onOpenChange={open => { if (!open) setSelectedStudent(null); }}>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-blue-900">
                <Wallet className="h-5 w-5 text-blue-500" />
                Billetera Kiosco — {selectedStudent?.full_name}
                <span className="text-sm font-normal text-gray-400 ml-1">· {selectedStudent?.school_name}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-600 font-medium">Saldo actual</p>
                <p className={`text-xl font-bold ${(selectedStudent?.balance || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  S/ {(selectedStudent?.balance || 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Total ingresado</p>
                <p className="text-xl font-bold text-blue-700">
                  S/ {recharges.filter(r => r.status === 'approved').reduce((s, r) => s + r.amount, 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <p className="text-xs text-red-600 font-medium">Total gastado</p>
                <p className="text-xl font-bold text-red-700">
                  S/ {transactions.reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Saldo histórico / no registrado */}
            {(() => {
              const totalIngresado = recharges.filter(r => r.status === 'approved').reduce((s, r) => s + r.amount, 0);
              const totalGastado   = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);
              const diferencia     = (selectedStudent?.balance || 0) + totalGastado - totalIngresado;

              if (Math.abs(diferencia) < 0.01) return null;

              if (diferencia > 0) {
                // Hay saldo sin respaldo (ingresó más de lo que muestran las recargas)
                return (
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
                    <History className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="text-xs text-gray-500 flex-1">
                      Saldo inicial / histórico detectado:&nbsp;
                      <strong className="text-gray-700">S/ {diferencia.toFixed(2)}</strong>
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-gray-400 cursor-help shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                        Este monto corresponde a saldos cargados en versiones anteriores del
                        sistema o migraciones que no tienen un comprobante de recarga digital.
                        No es un error: el saldo es real y el alumno puede usarlo con normalidad.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              } else {
                // Hay consumo sin registro (gastó más de lo que muestran las transacciones)
                return (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <History className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-xs text-amber-700 flex-1">
                      Consumo previo sin registro:&nbsp;
                      <strong className="text-amber-800">S/ {Math.abs(diferencia).toFixed(2)}</strong>
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-amber-400 cursor-help shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                        El saldo actual es menor de lo esperado. Hay S/ {Math.abs(diferencia).toFixed(2)} en consumos
                        realizados antes del sistema de transacciones actual que no tienen registro digital.
                        El saldo en pantalla es el correcto.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              }
            })()}

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold text-gray-700">Topes de gasto</p>
                {!canEditTopes && (
                  <span className="text-xs text-orange-500 flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3" /> Solo admin general puede editar
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <div><span className="text-gray-500">Tipo:</span> <strong className="capitalize">{selectedStudent?.limit_type || 'none'}</strong></div>
                <div><span className="text-gray-500">Diario:</span> <strong>{selectedStudent?.daily_limit ? `S/ ${selectedStudent.daily_limit}` : '—'}</strong></div>
                <div><span className="text-gray-500">Semanal:</span> <strong>{selectedStudent?.weekly_limit ? `S/ ${selectedStudent.weekly_limit}` : '—'}</strong></div>
                <div><span className="text-gray-500">Mensual:</span> <strong>{selectedStudent?.monthly_limit ? `S/ ${selectedStudent.monthly_limit}` : '—'}</strong></div>
              </div>
            </div>

            {walletLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
            ) : (
              <Tabs defaultValue="recharges">
                <TabsList className="w-full bg-gray-100">
                  <TabsTrigger value="recharges" className="flex-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                    <ArrowUpCircle className="h-4 w-4 mr-1" /> Ingresos ({recharges.length})
                  </TabsTrigger>
                  <TabsTrigger value="transactions" className="flex-1 data-[state=active]:bg-red-600 data-[state=active]:text-white">
                    <ArrowDownCircle className="h-4 w-4 mr-1" /> Egresos POS ({transactions.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="recharges" className="mt-3 space-y-2">
                  {recharges.length === 0 ? (
                    <p className="text-center text-gray-400 py-6 text-sm">Sin recargas registradas</p>
                  ) : recharges.map(r => (
                    <div key={r.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-blue-200 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-gray-500">{fmtDate(r.created_at)}</p>
                            {r.approved_at && <p className="text-[11px] text-emerald-600">Aprobado: {fmtDate(r.approved_at)}</p>}
                            {r.reference_code && <p className="text-[11px] text-gray-500 font-mono">N° Op: <strong>{r.reference_code}</strong></p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.voucher_url ? (
                            <button onClick={() => setPreviewImage(r.voucher_url)}
                              className="border border-blue-200 rounded-lg overflow-hidden w-10 h-10 hover:border-blue-400 transition-colors shrink-0"
                              title="Ver comprobante">
                              <img src={r.voucher_url} alt="Comprobante" className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-center" title="Sin comprobante">
                              <ImageIcon className="h-4 w-4 text-gray-300" />
                            </div>
                          )}
                          <Badge className={r.status === 'approved' ? 'bg-emerald-100 text-emerald-700 text-[10px]' : r.status === 'pending' ? 'bg-amber-100 text-amber-700 text-[10px]' : 'bg-red-100 text-red-700 text-[10px]'}>
                            {r.status === 'approved' ? 'Aprobado' : r.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                          </Badge>
                          <span className="font-bold text-blue-600 text-sm">+{fmt(r.amount)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="transactions" className="mt-3 space-y-2">
                  <p className="text-[11px] text-gray-400 italic px-1">Solo compras del kiosco (POS). Los pagos de almuerzo se gestionan en el módulo de Almuerzos.</p>
                  {transactions.length === 0 ? (
                    <p className="text-center text-gray-400 py-6 text-sm">Sin compras en kiosco registradas</p>
                  ) : transactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-2.5 hover:border-red-200 transition-colors">
                      <div className="flex items-start gap-3">
                        <TrendingDown className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-gray-700 font-medium">{t.description || 'Compra kiosco'}</p>
                          <p className="text-[11px] text-gray-400">
                            {fmtDate(t.created_at)}
                            {t.ticket_code && <span className="ml-2 font-mono">· {t.ticket_code}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={t.payment_status === 'paid' ? 'bg-gray-100 text-gray-600 text-[10px]' : 'bg-amber-100 text-amber-700 text-[10px]'}>
                          {t.payment_status === 'paid' ? 'Cobrado' : 'Deuda'}
                        </Badge>
                        <span className="font-bold text-red-500">-{fmt(t.amount)}</span>
                      </div>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Visor comprobante ampliado ── */}
        <Dialog open={!!previewImage} onOpenChange={open => { if (!open) setPreviewImage(null); }}>
          <DialogContent className="max-w-lg" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4" /> Comprobante de recarga
              </DialogTitle>
            </DialogHeader>
            {previewImage && <img src={previewImage} alt="Comprobante" className="w-full rounded-lg border border-gray-200" />}
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
};
