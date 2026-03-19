import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet, Search, TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle, Loader2, RefreshCw, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Student {
  id: string;
  full_name: string;
  balance: number;
  free_account: boolean | null;
  kiosk_disabled: boolean;
  school_id: string;
  school_name?: string;
  spending_limit_daily?: number | null;
  spending_limit_weekly?: number | null;
  spending_limit_monthly?: number | null;
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

export const KioskWalletReport = ({ canViewAllSchools, userSchoolId, schools }: Props) => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [recharges, setRecharges] = useState<RechargeEntry[]>([]);
  const [transactions, setTransactions] = useState<TransactionEntry[]>([]);
  const [expandedTopes, setExpandedTopes] = useState<string | null>(null);

  const canEditTopes = role === 'admin_general' || role === 'superadmin';

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('students')
        .select(`
          id, full_name, balance, free_account, kiosk_disabled, school_id,
          spending_limit_daily, spending_limit_weekly, spending_limit_monthly,
          schools(name)
        `)
        .or('balance.gt.0,id.in.(select student_id from recharge_requests where request_type=recharge and status=approved)')
        .order('balance', { ascending: false });

      if (!canViewAllSchools && userSchoolId) {
        query = query.eq('school_id', userSchoolId);
      } else if (schoolFilter !== 'all') {
        query = query.eq('school_id', schoolFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Enriquecer con totales de recargas
      const studentIds = (data || []).map((s: any) => s.id);
      let rechargeMap = new Map<string, { total: number; count: number }>();
      if (studentIds.length > 0) {
        const { data: rData } = await supabase
          .from('recharge_requests')
          .select('student_id, amount')
          .in('student_id', studentIds)
          .eq('request_type', 'recharge')
          .eq('status', 'approved');
        (rData || []).forEach((r: any) => {
          const prev = rechargeMap.get(r.student_id) || { total: 0, count: 0 };
          rechargeMap.set(r.student_id, { total: prev.total + (r.amount || 0), count: prev.count + 1 });
        });
      }

      const enriched = (data || []).map((s: any) => ({
        ...s,
        school_name: s.schools?.name || '—',
        total_recharged: rechargeMap.get(s.id)?.total || 0,
        recharge_count: rechargeMap.get(s.id)?.count || 0,
      }));

      setStudents(enriched);
    } catch (e: any) {
      toast({ title: 'Error al cargar alumnos', description: e.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [canViewAllSchools, userSchoolId, schoolFilter]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const openWallet = async (student: Student) => {
    setSelectedStudent(student);
    setWalletLoading(true);
    setRecharges([]);
    setTransactions([]);

    try {
      const [rRes, tRes] = await Promise.all([
        supabase
          .from('recharge_requests')
          .select('id, amount, status, created_at, approved_at, reference_code')
          .eq('student_id', student.id)
          .eq('request_type', 'recharge')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('transactions')
          .select('id, amount, ticket_code, created_at, payment_status, description')
          .eq('student_id', student.id)
          .eq('type', 'purchase')
          .is('metadata->>lunch_order_id' as any, null)
          .order('created_at', { ascending: false })
          .limit(50),
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

  const filteredStudents = students.filter(s =>
    !search.trim() ||
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (s.school_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const formatAmount = (amount: number) =>
    `S/ ${Math.abs(amount).toFixed(2)}`;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const getTipoLabel = (s: Student) => {
    if (s.kiosk_disabled) return <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">Solo almuerzo</Badge>;
    if (s.free_account !== false) return <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Cuenta libre</Badge>;
    return <Badge className="bg-blue-100 text-blue-800 text-[10px]">Con recargas</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-blue-900">
            <Wallet className="h-6 w-6 text-blue-600" />
            Reporte de Saldos Kiosco
          </CardTitle>
          <CardDescription className="text-blue-700">
            Alumnos con saldo activo o historial de recargas. Solo lectura. Haz clic en un alumno para ver su billetera.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por nombre o sede..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {canViewAllSchools && (
          <Select value={schoolFilter} onValueChange={setSchoolFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
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
        <Button variant="outline" onClick={fetchStudents} disabled={loading} className="shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* Resumen rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border border-emerald-200 bg-emerald-50">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-emerald-600 font-medium">Alumnos con saldo</p>
            <p className="text-2xl font-bold text-emerald-700">{students.filter(s => s.balance > 0).length}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-blue-600 font-medium">Saldo total en sistema</p>
            <p className="text-2xl font-bold text-blue-700">
              S/ {students.reduce((sum, s) => sum + (s.balance || 0), 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 bg-purple-50">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-purple-600 font-medium">Total recargado histórico</p>
            <p className="text-2xl font-bold text-purple-700">
              S/ {students.reduce((sum, s) => sum + (s.total_recharged || 0), 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 bg-orange-50">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-orange-600 font-medium">Padres que recargaron</p>
            <p className="text-2xl font-bold text-orange-700">{students.filter(s => (s.recharge_count || 0) > 0).length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : filteredStudents.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            No se encontraron alumnos con saldo o recargas registradas.
          </CardContent>
        </Card>
      ) : (
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
                {filteredStudents.map(student => (
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
                        {student.spending_limit_daily || student.spending_limit_weekly || student.spending_limit_monthly
                          ? <span className="text-blue-600 font-medium">Con tope</span>
                          : <span className="text-gray-400">Sin tope</span>
                        }
                        {expandedTopes === student.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                      {expandedTopes === student.id && (
                        <div className="mt-1 text-left bg-white border border-gray-200 rounded-lg p-2 shadow-sm text-xs space-y-0.5">
                          <p>Diario: <strong>{student.spending_limit_daily ? `S/ ${student.spending_limit_daily}` : 'Sin límite'}</strong></p>
                          <p>Semanal: <strong>{student.spending_limit_weekly ? `S/ ${student.spending_limit_weekly}` : 'Sin límite'}</strong></p>
                          <p>Mensual: <strong>{student.spending_limit_monthly ? `S/ ${student.spending_limit_monthly}` : 'Sin límite'}</strong></p>
                          {!canEditTopes && (
                            <p className="text-orange-500 flex items-center gap-1 mt-1">
                              <ShieldAlert className="h-3 w-3" /> Solo admin general puede editar
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">
                      {student.total_recharged! > 0
                        ? <span className="text-purple-600 font-medium">S/ {student.total_recharged!.toFixed(2)} ({student.recharge_count} vez{student.recharge_count !== 1 ? 'ces' : ''})</span>
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
      )}

      {/* Modal Billetera */}
      <Dialog open={!!selectedStudent} onOpenChange={open => { if (!open) setSelectedStudent(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-900">
              <Wallet className="h-5 w-5 text-blue-500" />
              Billetera Kiosco — {selectedStudent?.full_name}
            </DialogTitle>
          </DialogHeader>

          {/* Resumen de saldo */}
          <div className="grid grid-cols-3 gap-3 mb-2">
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
                S/ {transactions.filter(t => t.payment_status === 'paid').reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Topes */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">Topes de gasto</p>
              {!canEditTopes && (
                <span className="text-xs text-orange-500 flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" /> Solo admin general puede editar
                </span>
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <div><span className="text-gray-500">Diario:</span> <strong>{selectedStudent?.spending_limit_daily ? `S/ ${selectedStudent.spending_limit_daily}` : 'Sin límite'}</strong></div>
              <div><span className="text-gray-500">Semanal:</span> <strong>{selectedStudent?.spending_limit_weekly ? `S/ ${selectedStudent.spending_limit_weekly}` : 'Sin límite'}</strong></div>
              <div><span className="text-gray-500">Mensual:</span> <strong>{selectedStudent?.spending_limit_monthly ? `S/ ${selectedStudent.spending_limit_monthly}` : 'Sin límite'}</strong></div>
            </div>
          </div>

          {walletLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : (
            <Tabs defaultValue="recharges">
              <TabsList className="w-full bg-gray-100">
                <TabsTrigger value="recharges" className="flex-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  <ArrowUpCircle className="h-4 w-4 mr-1" /> Ingresos ({recharges.length})
                </TabsTrigger>
                <TabsTrigger value="transactions" className="flex-1 data-[state=active]:bg-red-600 data-[state=active]:text-white">
                  <ArrowDownCircle className="h-4 w-4 mr-1" /> Egresos ({transactions.length})
                </TabsTrigger>
              </TabsList>

              {/* Ingresos (recargas aprobadas) */}
              <TabsContent value="recharges" className="mt-3 space-y-2">
                {recharges.length === 0 ? (
                  <p className="text-center text-gray-400 py-6 text-sm">Sin recargas registradas</p>
                ) : recharges.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2 hover:border-blue-200">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500">{formatDate(r.created_at)}</p>
                        {r.reference_code && <p className="text-[11px] text-gray-400">Op: {r.reference_code}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={r.status === 'approved' ? 'bg-emerald-100 text-emerald-700 text-[10px]' : r.status === 'pending' ? 'bg-amber-100 text-amber-700 text-[10px]' : 'bg-red-100 text-red-700 text-[10px]'}>
                        {r.status === 'approved' ? 'Aprobado' : r.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                      </Badge>
                      <span className="font-bold text-blue-600">+{formatAmount(r.amount)}</span>
                    </div>
                  </div>
                ))}
              </TabsContent>

              {/* Egresos (compras en kiosco) */}
              <TabsContent value="transactions" className="mt-3 space-y-2">
                {transactions.length === 0 ? (
                  <p className="text-center text-gray-400 py-6 text-sm">Sin compras en kiosco registradas</p>
                ) : transactions.map(t => (
                  <div key={t.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2 hover:border-red-200">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-red-400 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-700 font-medium">{t.description || 'Compra kiosco'}</p>
                        <p className="text-[11px] text-gray-400">{formatDate(t.created_at)}{t.ticket_code ? ` · ${t.ticket_code}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={t.payment_status === 'paid' ? 'bg-gray-100 text-gray-600 text-[10px]' : 'bg-amber-100 text-amber-700 text-[10px]'}>
                        {t.payment_status === 'paid' ? 'Cobrado' : 'Deuda'}
                      </Badge>
                      <span className="font-bold text-red-500">-{formatAmount(t.amount)}</span>
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
