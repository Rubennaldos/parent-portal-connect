import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useViewAsStore } from '@/stores/viewAsStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Select de Radix removido - se usa <select> nativo para evitar error removeChild en algunos navegadores
import { 
  FileText,
  DollarSign,
  Calendar,
  Search,
  Download,
  Loader2,
  TrendingUp,
  Building2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface School {
  id: string;
  name: string;
}

interface PaymentHistory {
  id: string;
  created_at: string;
  paid_at: string;
  student_name: string;
  parent_name: string;
  school_name: string;
  period_name: string;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  payment_method: string;
  status: string;
  document_type: string;
}

export const BillingReports = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentHistory[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  
  // Filtros — por defecto hoy
  const today = new Date().toISOString().split('T')[0];
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const canViewAllSchools = role === 'admin_general';

  useEffect(() => {
    fetchSchools();
    fetchPayments();
  }, [selectedSchool, selectedStatus, dateFrom, dateTo]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const fetchPayments = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('transactions')
        .select(`
          id,
          created_at,
          amount,
          type,
          description,
          payment_status,
          payment_method,
          student_id,
          school_id,
          ticket_code,
          registered_by,
          students(full_name, parent_id),
          schools(name)
        `)
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(200);

      // Filtro de sede: admin_general puede ver todas, resto solo su sede
      if (selectedSchool !== 'all') {
        query = query.eq('school_id', selectedSchool);
      } else if (!canViewAllSchools) {
        const schoolId = await getUserSchoolId();
        if (schoolId) {
          query = query.eq('school_id', schoolId);
        }
      }

      if (selectedStatus !== 'all') {
        if (selectedStatus === 'completed') {
          query = query.eq('payment_status', 'paid');
        } else {
          query = query.eq('payment_status', selectedStatus);
        }
      }

      if (dateFrom) {
        query = query.gte('created_at', `${dateFrom}T00:00:00`);
      }

      if (dateTo) {
        query = query.lte('created_at', `${dateTo}T23:59:59`);
      }

      const { data: transactions, error } = await query;

      if (error) throw error;

      // Obtener nombres de padres
      const parentIds = [...new Set(transactions?.map((t: any) => t.students?.parent_id).filter(Boolean))];
      
      let parentsMap = new Map();
      if (parentIds.length > 0) {
        const { data: parentsData } = await supabase
          .from('parent_profiles')
          .select('user_id, full_name')
          .in('user_id', parentIds);
        
        parentsData?.forEach((p: any) => {
          parentsMap.set(p.user_id, p.full_name);
        });
      }

      // Obtener nombres de quién registró (profiles)
      const registeredByIds = [...new Set(transactions?.map((t: any) => t.registered_by).filter(Boolean))];
      let registeredByMap = new Map();
      if (registeredByIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .in('id', registeredByIds);
        
        profilesData?.forEach((p: any) => {
          registeredByMap.set(p.id, { name: p.full_name || 'Sin nombre', role: p.role });
        });

        // También buscar en parent_profiles por si fue un padre
        const { data: parentRegistrars } = await supabase
          .from('parent_profiles')
          .select('user_id, full_name')
          .in('user_id', registeredByIds);
        
        parentRegistrars?.forEach((p: any) => {
          if (p.full_name && !registeredByMap.get(p.user_id)?.name) {
            registeredByMap.set(p.user_id, { name: p.full_name, role: 'parent' });
          } else if (p.full_name) {
            const existing = registeredByMap.get(p.user_id);
            if (existing?.role === 'parent') {
              registeredByMap.set(p.user_id, { ...existing, name: p.full_name });
            }
          }
        });
      }

      const mappedPayments: PaymentHistory[] = (transactions || []).map((transaction: any) => {
        const amount = Math.abs(transaction.amount);
        const isPaid = transaction.payment_status === 'paid';
        
        const registrar = registeredByMap.get(transaction.registered_by);
        const registrarLabel = registrar
          ? `${registrar.name}${registrar.role === 'parent' ? ' (Padre)' : ''}`
          : '';

        return {
          id: transaction.id,
          created_at: transaction.created_at,
          paid_at: isPaid ? transaction.created_at : '',
          student_name: transaction.students?.full_name || 'Cliente Genérico',
          parent_name: parentsMap.get(transaction.students?.parent_id) || registrarLabel || 'Sin registrar',
          school_name: transaction.schools?.name || 'Sin sede',
          period_name: transaction.description || 'Compra',
          total_amount: amount,
          paid_amount: isPaid ? amount : 0,
          pending_amount: isPaid ? 0 : amount,
          payment_method: transaction.payment_method || 'cuenta_libre',
          status: transaction.payment_status === 'paid' ? 'completed' : transaction.payment_status,
          document_type: transaction.ticket_code || 'Sin ticket',
        };
      });

      setPayments(mappedPayments);
    } catch (error) {
      console.error('Error fetching payments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserSchoolId = async () => {
    if (!user) return null;
    const { data } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single();
    return data?.school_id || null;
  };

  const filteredPayments = payments.filter(payment => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      payment.student_name.toLowerCase().includes(search) ||
      payment.parent_name.toLowerCase().includes(search) ||
      payment.period_name.toLowerCase().includes(search)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500">Pagado</Badge>;
      case 'partial':
        return <Badge className="bg-yellow-500">Parcial</Badge>;
      case 'pending':
        return <Badge variant="outline">Pendiente</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Estadísticas
  const stats = {
    total: filteredPayments.length,
    totalAmount: filteredPayments.reduce((sum, p) => sum + p.total_amount, 0),
    paidAmount: filteredPayments.reduce((sum, p) => sum + p.paid_amount, 0),
    pendingAmount: filteredPayments.reduce((sum, p) => sum + p.pending_amount, 0),
  };

  return (
    <div className="space-y-6">
      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <FileText className="h-4 w-4" />
              Total Registros
            </div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <DollarSign className="h-4 w-4" />
              Total Facturado
            </div>
            <div className="text-2xl font-bold text-blue-600">
              S/ {stats.totalAmount.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <TrendingUp className="h-4 w-4" />
              Total Cobrado
            </div>
            <div className="text-2xl font-bold text-green-600">
              S/ {stats.paidAmount.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <DollarSign className="h-4 w-4" />
              Pendiente
            </div>
            <div className="text-2xl font-bold text-red-600">
              S/ {stats.pendingAmount.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {canViewAllSchools && (
              <div className="space-y-2">
                <Label>Sede</Label>
                <select
                  value={selectedSchool}
                  onChange={(e) => setSelectedSchool(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="all">Todas</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Estado</Label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="all">Todos</option>
                <option value="completed">Pagado</option>
                <option value="partial">Parcial</option>
                <option value="pending">Pendiente</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Estudiante..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de pagos */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-red-600" />
          <p className="ml-3 text-gray-600">Cargando historial...</p>
        </div>
      ) : filteredPayments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">No se encontraron registros</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Historial de Pagos — {filteredPayments.length} registros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredPayments.map((payment) => (
                <div
                  key={payment.id}
                  className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold">{payment.student_name}</h3>
                      {getStatusBadge(payment.status)}
                    </div>
                    <p className="text-lg font-bold text-green-600">
                      S/ {payment.total_amount.toFixed(2)}
                    </p>
                  </div>

                  {canViewAllSchools && (
                    <div className="flex items-center gap-1 text-xs text-blue-600 mb-2">
                      <Building2 className="h-3 w-3" />
                      {payment.school_name}
                    </div>
                  )}

                  <div className="bg-white rounded-lg p-3 mb-2 border-l-4 border-blue-400">
                    <p className="text-xs text-gray-500">Detalle de Consumo:</p>
                    <p className="font-medium text-sm">{payment.period_name}</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-600">
                    <div>
                      <span className="text-gray-400">Fecha de pago:</span><br />
                      <span className="font-medium">{format(new Date(payment.created_at), 'dd/MM/yyyy', { locale: es })}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Hora de pago:</span><br />
                      <span className="font-medium">{format(new Date(payment.created_at), 'HH:mm', { locale: es })}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Método de pago:</span><br />
                      <span className="font-medium capitalize">{payment.payment_method.replace(/_/g, ' ')}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">N° de ticket:</span><br />
                      <span className="font-medium text-amber-700">{payment.document_type}</span>
                    </div>
                  </div>

                  {payment.parent_name && (
                    <div className="mt-2 text-xs text-gray-500">
                      <span className="text-gray-400">Registrado por:</span>{' '}
                      <span className="font-medium">{payment.parent_name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
