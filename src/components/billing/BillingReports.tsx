import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  
  // Filtros
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
        .from('billing_payments')
        .select(`
          *,
          students(full_name),
          parent_profiles!billing_payments_parent_id_fkey(full_name),
          schools(name),
          billing_periods(period_name)
        `)
        .order('created_at', { ascending: false });

      // Filtros
      if (!canViewAllSchools || selectedSchool !== 'all') {
        const schoolId = selectedSchool !== 'all' ? selectedSchool : await getUserSchoolId();
        if (schoolId) {
          query = query.eq('school_id', schoolId);
        }
      }

      if (selectedStatus !== 'all') {
        query = query.eq('status', selectedStatus);
      }

      if (dateFrom) {
        query = query.gte('created_at', `${dateFrom}T00:00:00`);
      }

      if (dateTo) {
        query = query.lte('created_at', `${dateTo}T23:59:59`);
      }

      const { data, error } = await query;

      if (error) throw error;

      const mappedPayments: PaymentHistory[] = (data || []).map((payment: any) => ({
        id: payment.id,
        created_at: payment.created_at,
        paid_at: payment.paid_at,
        student_name: payment.students?.full_name || 'Sin nombre',
        parent_name: payment.parent_profiles?.full_name || 'Sin nombre',
        school_name: payment.schools?.name || 'Sin sede',
        period_name: payment.billing_periods?.period_name || 'Sin período',
        total_amount: payment.total_amount,
        paid_amount: payment.paid_amount,
        pending_amount: payment.pending_amount,
        payment_method: payment.payment_method,
        status: payment.status,
        document_type: payment.document_type,
      }));

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
                <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="completed">Pagado</SelectItem>
                  <SelectItem value="partial">Parcial</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                </SelectContent>
              </Select>
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
          <CardHeader>
            <CardTitle>Historial de Pagos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredPayments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">{payment.student_name}</h3>
                      {getStatusBadge(payment.status)}
                      <Badge variant="outline" className="text-xs">
                        {payment.document_type}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600">
                      <div>Padre: {payment.parent_name}</div>
                      <div>Período: {payment.period_name}</div>
                      {canViewAllSchools && (
                        <div className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {payment.school_name}
                        </div>
                      )}
                      <div>
                        {format(new Date(payment.created_at), 'dd MMM yyyy', { locale: es })}
                      </div>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-lg font-bold text-green-600">
                      S/ {payment.paid_amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">
                      de S/ {payment.total_amount.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
