import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle,
  UtensilsCrossed,
  Loader2,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ParentLunchOrdersProps {
  parentId: string;
}

interface LunchOrder {
  id: string;
  order_date: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  postponed_at: string | null;
  cancellation_reason: string | null;
  postponement_reason: string | null;
  is_no_order_delivery: boolean;
  student: {
    id: string;
    full_name: string;
    photo_url: string | null;
  };
  menu?: {
    id: string;
    date: string;
    starter: string | null;
    main_course: string;
    beverage: string | null;
    dessert: string | null;
    notes: string | null;
  } | null;
}

export function ParentLunchOrders({ parentId }: ParentLunchOrdersProps) {
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<LunchOrder[]>([]);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');

  useEffect(() => {
    if (parentId) {
      fetchOrders();
    }
  }, [parentId, filter]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      console.log('📅 Cargando pedidos de almuerzo del padre...');

      // Obtener IDs de los hijos del padre
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id')
        .eq('parent_id', parentId)
        .eq('is_active', true);

      if (studentsError) throw studentsError;

      if (!students || students.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      const studentIds = students.map(s => s.id);

      // Obtener pedidos de almuerzo
      let query = supabase
        .from('lunch_orders')
        .select(`
          id,
          order_date,
          status,
          created_at,
          delivered_at,
          cancelled_at,
          postponed_at,
          cancellation_reason,
          postponement_reason,
          is_no_order_delivery,
          student:students!lunch_orders_student_id_fkey (
            id,
            full_name,
            photo_url
          )
        `)
        .in('student_id', studentIds)
        .order('order_date', { ascending: false });

      // Aplicar filtros
      const today = new Date().toISOString().split('T')[0];
      if (filter === 'upcoming') {
        query = query.gte('order_date', today);
      } else if (filter === 'past') {
        query = query.lt('order_date', today);
      }

      const { data, error } = await query.limit(50);

      if (error) throw error;

      // Obtener los menús para las fechas de los pedidos
      if (data && data.length > 0) {
        const orderDates = [...new Set(data.map(order => order.order_date))];
        
        const { data: menusData, error: menusError } = await supabase
          .from('lunch_menus')
          .select('id, date, starter, main_course, beverage, dessert, notes')
          .in('date', orderDates);

        if (menusError) {
          console.error('⚠️ Error cargando menús:', menusError);
        }

        // Agregar los menús a los pedidos
        const ordersWithMenus = data.map(order => ({
          ...order,
          menu: menusData?.find(menu => menu.date === order.order_date) || null
        }));

        // 🎫 Batch: obtener ticket_codes de transacciones asociadas
        if (ordersWithMenus.length > 0) {
          try {
            const orderIds = ordersWithMenus.map(o => o.id);
            const { data: txData } = await supabase
              .from('transactions')
              .select('metadata, ticket_code')
              .eq('type', 'purchase')
              .not('metadata', 'is', null);
            
            if (txData) {
              const ticketMap = new Map<string, string>();
              txData.forEach((tx: any) => {
                const lunchOrderId = tx.metadata?.lunch_order_id;
                if (lunchOrderId && orderIds.includes(lunchOrderId) && tx.ticket_code) {
                  ticketMap.set(lunchOrderId, tx.ticket_code);
                }
              });
              
              ordersWithMenus.forEach((order: any) => {
                if (ticketMap.has(order.id)) {
                  order._ticket_code = ticketMap.get(order.id);
                }
              });
            }
          } catch (err) {
            console.log('⚠️ No se pudieron obtener ticket_codes');
          }
        }

        setOrders(ordersWithMenus);
        console.log('✅ Pedidos cargados con menús:', ordersWithMenus.length);
      } else {
        setOrders([]);
      }
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

  const getStatusBadge = (status: string, isNoOrderDelivery: boolean) => {
    if (isNoOrderDelivery) {
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300 text-[9px] sm:text-[10px] md:text-xs">
          <AlertCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
          <span className="hidden sm:inline">Entregado sin pedido</span>
          <span className="sm:hidden">Sin pedido</span>
        </Badge>
      );
    }

    switch (status) {
      case 'confirmed':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-[9px] sm:text-[10px] md:text-xs">
            <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            Confirmado
          </Badge>
        );
      case 'delivered':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-[9px] sm:text-[10px] md:text-xs">
            <CheckCircle2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            Entregado
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-[9px] sm:text-[10px] md:text-xs">
            <XCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            Anulado
          </Badge>
        );
      case 'postponed':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 text-[9px] sm:text-[10px] md:text-xs">
            <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            Postergado
          </Badge>
        );
      case 'pending_payment':
        return (
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300 text-[9px] sm:text-[10px] md:text-xs">
            <AlertCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            <span className="hidden sm:inline">Pendiente de pago</span>
            <span className="sm:hidden">Pendiente</span>
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-[9px] sm:text-[10px] md:text-xs">
            <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            <span className="hidden sm:inline">Pendiente</span>
            <span className="sm:hidden">Pendiente</span>
          </Badge>
        );
      default:
        return <Badge variant="outline" className="text-[9px] sm:text-[10px] md:text-xs">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 sm:py-8 md:py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-blue-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 md:py-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div>
            <CardTitle className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg md:text-xl">
              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
              Mis Pedidos de Almuerzo
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm mt-1">
              Historial de pedidos realizados para tus hijos
            </CardDescription>
          </div>

          {/* Filtros */}
          <div className="flex gap-1 sm:gap-2 w-full sm:w-auto">
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
              className="flex-1 sm:flex-none h-7 sm:h-8 text-[10px] sm:text-xs"
            >
              Todos
            </Button>
            <Button
              size="sm"
              variant={filter === 'upcoming' ? 'default' : 'outline'}
              onClick={() => setFilter('upcoming')}
              className="flex-1 sm:flex-none h-7 sm:h-8 text-[10px] sm:text-xs"
            >
              Próximos
            </Button>
            <Button
              size="sm"
              variant={filter === 'past' ? 'default' : 'outline'}
              onClick={() => setFilter('past')}
              className="flex-1 sm:flex-none h-7 sm:h-8 text-[10px] sm:text-xs"
            >
              Pasados
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-2 sm:px-3 md:px-4 lg:px-6 py-3 sm:py-4">
        {orders.length === 0 ? (
          <div className="text-center py-8 sm:py-10 md:py-12 text-gray-500">
            <UtensilsCrossed className="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 mx-auto mb-3 sm:mb-4 opacity-30" />
            <p className="text-base sm:text-lg font-semibold mb-1 sm:mb-2">No hay pedidos</p>
            <p className="text-xs sm:text-sm">
              {filter === 'upcoming' 
                ? 'No tienes pedidos próximos.' 
                : filter === 'past'
                ? 'No tienes pedidos pasados.'
                : 'Aún no has realizado ningún pedido de almuerzo.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="border rounded-md sm:rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between p-2 sm:p-3 md:p-4">
                  <div className="flex items-center gap-2 sm:gap-3 md:gap-4 flex-1">
                    {/* Foto del estudiante */}
                    <div>
                      {order.student.photo_url ? (
                        <img
                          src={order.student.photo_url}
                          alt={order.student.full_name}
                          className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-600 font-bold text-sm sm:text-base md:text-lg">
                            {order.student.full_name[0]}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Info del pedido */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-xs sm:text-sm md:text-base truncate">
                        {order.student.full_name}
                      </p>
                      <p className="text-[10px] sm:text-xs md:text-sm text-gray-600">
                        {format(new Date(order.order_date + 'T00:00:00'), "EEEE, d 'de' MMMM", { locale: es })}
                      </p>
                      <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-400">
                        Pedido el {format(new Date(order.created_at), "d 'de' MMM 'a las' HH:mm", { locale: es })}
                      </p>
                      {(order as any)._ticket_code && (
                        <p className="text-[9px] sm:text-[10px] md:text-xs font-bold text-indigo-700 mt-0.5">
                          🎫 Ticket: {(order as any)._ticket_code}
                        </p>
                      )}
                    </div>

                    {/* Estado */}
                    <div className="flex-shrink-0">
                      {getStatusBadge(order.status, order.is_no_order_delivery)}
                    </div>
                  </div>
                </div>

                {/* Menú del día */}
                {order.menu && (
                  <div className="px-2 sm:px-3 md:px-4 pb-2 sm:pb-3 md:pb-4 pt-1.5 sm:pt-2 border-t bg-gray-50/50">
                    <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 mb-1.5 sm:mb-2">
                      <UtensilsCrossed className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 text-blue-600" />
                      <span className="text-[10px] sm:text-xs font-semibold text-gray-700">Menú del día:</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
                      {order.menu.starter && (
                        <div>
                          <span className="font-medium text-gray-600">Entrada:</span>
                          <p className="text-gray-800">{order.menu.starter}</p>
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-gray-600">Plato principal:</span>
                        <p className="text-gray-800">{order.menu.main_course}</p>
                      </div>
                      {order.menu.beverage && (
                        <div>
                          <span className="font-medium text-gray-600">Bebida:</span>
                          <p className="text-gray-800">{order.menu.beverage}</p>
                        </div>
                      )}
                      {order.menu.dessert && (
                        <div>
                          <span className="font-medium text-gray-600">Postre:</span>
                          <p className="text-gray-800">{order.menu.dessert}</p>
                        </div>
                      )}
                    </div>
                    {order.menu.notes && (
                      <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-500 mt-1.5 sm:mt-2 italic">
                        {order.menu.notes}
                      </p>
                    )}
                  </div>
                )}

                {/* Detalles adicionales */}
                {(order.cancellation_reason || order.postponement_reason) && (
                  <div className="px-2 sm:px-3 md:px-4 pb-2 sm:pb-3 text-[10px] sm:text-xs text-gray-500">
                    {order.cancellation_reason && (
                      <p>
                        <span className="font-semibold">Motivo de anulación:</span> {order.cancellation_reason}
                      </p>
                    )}
                    {order.postponement_reason && (
                      <p>
                        <span className="font-semibold">Motivo de postergación:</span> {order.postponement_reason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Nota informativa */}
        {orders.some(o => o.is_no_order_delivery) && (
          <div className="mt-3 sm:mt-4 bg-orange-50 p-2 sm:p-3 rounded-md sm:rounded-lg flex items-start gap-1.5 sm:gap-2">
            <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            <div className="text-[10px] sm:text-xs md:text-sm text-orange-800">
              <p className="font-semibold mb-0.5 sm:mb-1">Almuerzos entregados sin pedido previo</p>
              <p>
                Algunos almuerzos fueron entregados sin que hayas hecho un pedido anticipado. 
                Esto genera una deuda automática en la cuenta de tu hijo que puedes ver en la pestaña "Pagos".
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
