import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  Calendar, 
  UtensilsCrossed, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle,
  UserPlus,
  PackagePlus,
  Search,
  Filter,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CreateTemporaryStudentModal } from '@/components/lunch/CreateTemporaryStudentModal';
import { DeliverWithoutOrderModal } from '@/components/lunch/DeliverWithoutOrderModal';
import { LunchOrderActionsModal } from '@/components/lunch/LunchOrderActionsModal';

interface LunchOrder {
  id: string;
  order_date: string;
  status: string;
  ordered_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  postponed_at: string | null;
  cancellation_reason: string | null;
  postponement_reason: string | null;
  is_no_order_delivery: boolean;
  student_id: string;
  teacher_id: string | null;
  student?: {
    full_name: string;
    photo_url: string | null;
    is_temporary: boolean;
    temporary_classroom_name: string | null;
  };
  teacher?: {
    full_name: string;
  };
}

interface School {
  id: string;
  name: string;
  code: string;
}

export default function LunchOrders() {
  const { user } = useAuth();
  const { role, canViewAllSchools } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<LunchOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<LunchOrder[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showCreateTemporary, setShowCreateTemporary] = useState(false);
  const [showDeliverWithoutOrder, setShowDeliverWithoutOrder] = useState(false);
  const [selectedOrderForAction, setSelectedOrderForAction] = useState<LunchOrder | null>(null);
  const [showActionsModal, setShowActionsModal] = useState(false);

  useEffect(() => {
    fetchSchools();
    fetchOrders();
  }, [selectedDate]);

  useEffect(() => {
    filterOrders();
  }, [orders, selectedSchool, selectedStatus, searchTerm]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, code')
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error: any) {
      console.error('Error cargando escuelas:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      console.log('📅 Cargando pedidos de almuerzo para:', selectedDate);

      let query = supabase
        .from('lunch_orders')
        .select(`
          *,
          student:students!lunch_orders_student_id_fkey (
            full_name,
            photo_url,
            is_temporary,
            temporary_classroom_name,
            school_id
          ),
          teacher:teacher_profiles!lunch_orders_teacher_id_fkey (
            full_name
          )
        `)
        .eq('order_date', selectedDate)
        .order('ordered_at', { ascending: false });

      // Si no puede ver todas las sedes, filtrar por sus sedes asignadas
      if (!canViewAllSchools && user) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('assigned_schools')
          .eq('id', user.id)
          .maybeSingle();

        if (!profileError && profileData?.assigned_schools && profileData.assigned_schools.length > 0) {
          // Necesitamos filtrar por school_id del estudiante
          // Esto requiere una subconsulta, lo haremos en el cliente
          const { data: allOrders, error } = await query;
          if (error) throw error;

          const filtered = allOrders?.filter(order => 
            order.student && profileData.assigned_schools.includes(order.student.school_id)
          ) || [];

          setOrders(filtered);
        } else {
          // Si no tiene sedes asignadas o hay error, mostrar todos los pedidos
          const { data, error } = await query;
          if (error) throw error;
          setOrders(data || []);
        }
      } else {
        const { data, error } = await query;
        if (error) throw error;
        setOrders(data || []);
      }

      console.log('✅ Pedidos cargados:', orders.length);
    } catch (error: any) {
      console.error('❌ Error cargando pedidos:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los pedidos de almuerzo.',
      });
    } finally {
      setLoading(false);
    }
  };

  const filterOrders = () => {
    let filtered = [...orders];

    // Filtrar por sede
    if (selectedSchool !== 'all') {
      filtered = filtered.filter(order => order.student?.school_id === selectedSchool);
    }

    // Filtrar por estado
    if (selectedStatus !== 'all') {
      filtered = filtered.filter(order => order.status === selectedStatus);
    }

    // Filtrar por búsqueda
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(order => 
        order.student?.full_name.toLowerCase().includes(term) ||
        order.teacher?.full_name.toLowerCase().includes(term) ||
        order.student?.temporary_classroom_name?.toLowerCase().includes(term)
      );
    }

    setFilteredOrders(filtered);
  };

  const canModifyOrder = () => {
    const now = new Date();
    const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const currentHour = peruTime.getHours();
    
    // Solo se puede modificar antes de las 9 AM
    return currentHour < 9;
  };

  const getStatusBadge = (status: string, isNoOrderDelivery: boolean) => {
    if (isNoOrderDelivery) {
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
          <AlertCircle className="h-3 w-3 mr-1" />
          Sin pedido previo
        </Badge>
      );
    }

    switch (status) {
      case 'confirmed':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
            <Clock className="h-3 w-3 mr-1" />
            Confirmado
          </Badge>
        );
      case 'delivered':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Entregado
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Anulado
          </Badge>
        );
      case 'postponed':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            Postergado
          </Badge>
        );
      case 'pending_payment':
        return (
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pendiente de pago
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleOrderAction = (order: LunchOrder) => {
    setSelectedOrderForAction(order);
    setShowActionsModal(true);
  };

  const handleActionComplete = () => {
    setShowActionsModal(false);
    setSelectedOrderForAction(null);
    fetchOrders(); // Recargar los pedidos
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Cargando pedidos de almuerzo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <UtensilsCrossed className="h-6 w-6 text-blue-600" />
            Gestión de Pedidos
          </h2>
          <p className="text-gray-600">Gestiona las entregas de almuerzos del día</p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => setShowDeliverWithoutOrder(true)}
            className="bg-orange-600 hover:bg-orange-700 gap-2"
          >
            <PackagePlus className="h-4 w-4" />
            Entregar sin pedido
          </Button>
          <Button
            onClick={() => setShowCreateTemporary(true)}
            className="bg-purple-600 hover:bg-purple-700 gap-2"
          >
            <UserPlus className="h-4 w-4" />
            Crear Puente Temporal
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Fecha */}
            <div>
              <label className="text-sm font-medium mb-2 block">Fecha</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Sede */}
            {canViewAllSchools && (
              <div>
                <label className="text-sm font-medium mb-2 block">Sede</label>
                <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas las sedes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sedes</SelectItem>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Estado */}
            <div>
              <label className="text-sm font-medium mb-2 block">Estado</label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="confirmed">Confirmado</SelectItem>
                  <SelectItem value="delivered">Entregado</SelectItem>
                  <SelectItem value="cancelled">Anulado</SelectItem>
                  <SelectItem value="postponed">Postergado</SelectItem>
                  <SelectItem value="pending_payment">Pendiente de pago</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Búsqueda */}
            <div>
              <label className="text-sm font-medium mb-2 block">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Nombre del estudiante..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de pedidos */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Pedidos del día</CardTitle>
              <CardDescription>
                {filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''} encontrado{filteredOrders.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            {!canModifyOrder() && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
                <AlertCircle className="h-3 w-3 mr-1" />
                Después de las 9:00 AM - Solo lectura
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <UtensilsCrossed className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-semibold mb-2">No hay pedidos</p>
              <p className="text-sm">
                No se encontraron pedidos de almuerzo para los filtros seleccionados.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    {/* Foto o inicial */}
                    <div className="relative">
                      {order.student?.photo_url ? (
                        <img
                          src={order.student.photo_url}
                          alt={order.student.full_name}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-600 font-bold text-lg">
                            {order.student?.full_name[0] || order.teacher?.full_name[0] || '?'}
                          </span>
                        </div>
                      )}
                      {order.student?.is_temporary && (
                        <div className="absolute -top-1 -right-1 bg-purple-600 rounded-full p-1">
                          <UserPlus className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">
                        {order.student?.full_name || order.teacher?.full_name || 'Desconocido'}
                      </p>
                      {order.student?.is_temporary && order.student.temporary_classroom_name && (
                        <p className="text-sm text-purple-600">
                          Temporal - {order.student.temporary_classroom_name}
                        </p>
                      )}
                      <p className="text-sm text-gray-500">
                        Pedido: {format(new Date(order.ordered_at), "HH:mm", { locale: es })}
                      </p>
                    </div>

                    {/* Estado */}
                    <div>
                      {getStatusBadge(order.status, order.is_no_order_delivery)}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleOrderAction(order)}
                      disabled={!canModifyOrder() && order.status === 'confirmed'}
                    >
                      Acciones
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      <CreateTemporaryStudentModal
        isOpen={showCreateTemporary}
        onClose={() => setShowCreateTemporary(false)}
        onSuccess={() => {
          setShowCreateTemporary(false);
          fetchOrders();
        }}
      />

      <DeliverWithoutOrderModal
        isOpen={showDeliverWithoutOrder}
        onClose={() => setShowDeliverWithoutOrder(false)}
        selectedDate={selectedDate}
        onSuccess={() => {
          setShowDeliverWithoutOrder(false);
          fetchOrders();
        }}
      />

      {selectedOrderForAction && (
        <LunchOrderActionsModal
          isOpen={showActionsModal}
          onClose={() => setShowActionsModal(false)}
          order={selectedOrderForAction}
          onSuccess={handleActionComplete}
          canModify={canModifyOrder()}
        />
      )}
    </div>
  );
}
