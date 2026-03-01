import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle,
  UtensilsCrossed,
  Loader2,
  Calendar,
  Trash2,
  Lock,
  Info,
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
  is_cancelled: boolean;
  created_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  postponed_at: string | null;
  cancellation_reason: string | null;
  postponement_reason: string | null;
  is_no_order_delivery: boolean;
  student_id: string;
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
  // Extra fields added client-side
  category_name?: string | null;
  _ticket_code?: string;
  _transaction_payment_status?: string | null;
}

interface LunchConfig {
  cancellation_deadline_time: string;
  cancellation_deadline_days: number;
}

const PAGE_SIZE = 5;

/** Hora actual en Perú (UTC-5) */
const getPeruNow = (): Date => {
  const now = new Date();
  const peruOffset = -5 * 60;
  const localOffset = now.getTimezoneOffset();
  return new Date(now.getTime() + (localOffset - Math.abs(peruOffset)) * 60 * 1000);
};

export function ParentLunchOrders({ parentId }: ParentLunchOrdersProps) {
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<LunchOrder[]>([]);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [config, setConfig] = useState<LunchConfig | null>(null);

  // Cancel state
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [confirmCancelOrder, setConfirmCancelOrder] = useState<LunchOrder | null>(null);

  useEffect(() => {
    if (parentId) {
      setVisibleCount(PAGE_SIZE);
      fetchOrders();
    }
  }, [parentId, filter]);

  /** Verifica si el plazo de cancelación sigue vigente para una fecha */
  const canCancelForDate = useCallback((dateStr: string): boolean => {
    if (!config?.cancellation_deadline_time) return false;

    const peruNow = getPeruNow();
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = config.cancellation_deadline_time.split(':').map(Number);

    // Día límite = order_date - cancellation_deadline_days
    const deadlineDays = config.cancellation_deadline_days ?? 0;
    const targetDate = new Date(year, month - 1, day);
    targetDate.setDate(targetDate.getDate() - deadlineDays);
    targetDate.setHours(hours, minutes, 0, 0);

    return peruNow < targetDate;
  }, [config]);

  const fetchOrders = async () => {
    try {
      setLoading(true);

      // Obtener IDs de los hijos del padre
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, school_id')
        .eq('parent_id', parentId)
        .eq('is_active', true);

      if (studentsError) throw studentsError;

      if (!students || students.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      const studentIds = students.map(s => s.id);
      const schoolId = students[0]?.school_id;

      // Obtener config de cancelación del colegio
      if (schoolId && !config) {
        const { data: configData } = await supabase
          .from('lunch_config')
          .select('cancellation_deadline_time, cancellation_deadline_days')
          .eq('school_id', schoolId)
          .single();
        if (configData) setConfig(configData);
      }

      // Obtener pedidos de almuerzo
      let query = supabase
        .from('lunch_orders')
        .select(`
          id,
          order_date,
          status,
          is_cancelled,
          created_at,
          delivered_at,
          cancelled_at,
          postponed_at,
          cancellation_reason,
          postponement_reason,
          is_no_order_delivery,
          menu_id,
          category_id,
          student_id,
          student:students!lunch_orders_student_id_fkey (
            id,
            full_name,
            photo_url
          ),
          lunch_categories (
            id,
            name
          )
        `)
        .in('student_id', studentIds)
        .order('order_date', { ascending: false });

      const today = new Date().toISOString().split('T')[0];
      if (filter === 'upcoming') {
        query = query.gte('order_date', today);
      } else if (filter === 'past') {
        query = query.lt('order_date', today);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;

      if (!data || data.length === 0) {
        setOrders([]);
        return;
      }

      // Batch lookup de menús por menu_id
      const menuIds = [...new Set((data as any[]).map(o => o.menu_id).filter(Boolean))];
      let menusMap: Record<string, any> = {};
      if (menuIds.length > 0) {
        const { data: menusData } = await supabase
          .from('lunch_menus')
          .select('id, date, starter, main_course, beverage, dessert, notes')
          .in('id', menuIds);
        if (menusData) menusData.forEach(m => { menusMap[m.id] = m; });
      }

      const mapped: LunchOrder[] = (data as any[]).map((order: any) => ({
        ...order,
        is_cancelled: order.is_cancelled || false,
        menu: order.menu_id ? (menusMap[order.menu_id] || null) : null,
        category_name: (order.lunch_categories as any)?.name || null,
      }));

      // 🔀 Orden inteligente: próximos/pendientes primero, luego pasados
      const activeStatuses = ['pending', 'confirmed', 'pending_payment'];
      const upcoming = mapped
        .filter((o) => o.order_date >= today && activeStatuses.includes(o.status) && !o.is_cancelled)
        .sort((a, b) => a.order_date.localeCompare(b.order_date));
      const past = mapped
        .filter((o) => !(o.order_date >= today && activeStatuses.includes(o.status) && !o.is_cancelled))
        .sort((a, b) => b.order_date.localeCompare(a.order_date));
      const ordersWithMenus = [...upcoming, ...past];

      // Batch: obtener ticket_codes y payment_status de transacciones asociadas
      const orderIds = ordersWithMenus.map(o => o.id);
      if (orderIds.length > 0) {
        const { data: txData } = await supabase
          .from('transactions')
          .select('metadata, ticket_code, payment_status')
          .eq('type', 'purchase')
          .not('metadata', 'is', null);

        if (txData) {
          const ticketMap = new Map<string, string>();
          const paymentMap = new Map<string, string>();
          txData.forEach((tx: any) => {
            const lunchOrderId = tx.metadata?.lunch_order_id;
            if (lunchOrderId && orderIds.includes(lunchOrderId)) {
              if (tx.ticket_code) ticketMap.set(lunchOrderId, tx.ticket_code);
              if (tx.payment_status) paymentMap.set(lunchOrderId, tx.payment_status);
            }
          });
          ordersWithMenus.forEach((order) => {
            if (ticketMap.has(order.id)) order._ticket_code = ticketMap.get(order.id);
            order._transaction_payment_status = paymentMap.get(order.id) ?? null;
          });
        }
      }

      setOrders(ordersWithMenus);
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

  const handleCancelOrder = async (order: LunchOrder) => {
    setCancellingOrderId(order.id);
    setConfirmCancelOrder(null);
    try {
      // 1. Cancelar el pedido
      const { error: orderError } = await supabase
        .from('lunch_orders')
        .update({
          is_cancelled: true,
          status: 'cancelled',
          cancelled_by: parentId,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      if (orderError) throw orderError;

      // 2. Cancelar la transacción vinculada (deuda pendiente)
      const { error: txError } = await supabase
        .from('transactions')
        .update({ payment_status: 'cancelled' })
        .contains('metadata', { lunch_order_id: order.id });

      if (txError) console.error('⚠️ Error actualizando transacción:', txError);

      toast({ title: '✅ Pedido anulado', description: 'El pedido fue anulado y la deuda cancelada.' });
      await fetchOrders();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudo anular el pedido.' });
    } finally {
      setCancellingOrderId(null);
    }
  };

  /** Decide qué botón/mensaje mostrar para cada pedido */
  const renderCancelAction = (order: LunchOrder) => {
    // Solo pedidos activos (no cancelados ni entregados)
    if (order.is_cancelled || order.status === 'cancelled') return null;
    if (order.status === 'delivered') return null;

    const isPaid = order._transaction_payment_status === 'paid';
    const withinDeadline = canCancelForDate(order.order_date);

    // Ya pagado → solo admin puede revertir
    if (isPaid) {
      return (
        <div className="mt-2 flex items-start gap-1.5 text-[10px] sm:text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-amber-700">
          <Lock className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>Este pedido ya fue <strong>pagado</strong>. Para anularlo, comunícate con la administración del colegio.</span>
        </div>
      );
    }

    // Fuera de plazo → no se puede cancelar
    if (!withinDeadline) {
      return (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] sm:text-xs text-red-500">
          <Lock className="h-3 w-3 flex-shrink-0" />
          <span>Ya venció el plazo de anulación.</span>
        </div>
      );
    }

    // Elegible para cancelar
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-2 h-7 text-[10px] sm:text-xs text-red-600 border-red-300 hover:bg-red-50 gap-1"
        onClick={() => setConfirmCancelOrder(order)}
        disabled={cancellingOrderId === order.id}
      >
        {cancellingOrderId === order.id ? (
          <><Loader2 className="h-3 w-3 animate-spin" />Anulando...</>
        ) : (
          <><Trash2 className="h-3 w-3" />Anular pedido</>
        )}
      </Button>
    );
  };

  const getStatusBadge = (status: string, isNoOrderDelivery: boolean, isCancelled: boolean) => {
    if (isCancelled || status === 'cancelled') {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-[9px] sm:text-[10px] md:text-xs">
          <XCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
          Anulado
        </Badge>
      );
    }
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
            Pendiente
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
    <>
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
              {orders.slice(0, visibleCount).map((order) => (
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
                        {order._ticket_code && (
                          <p className="text-[9px] sm:text-[10px] md:text-xs font-bold text-indigo-700 mt-0.5">
                            🎫 Ticket: {order._ticket_code}
                          </p>
                        )}
                      </div>

                      {/* Estado */}
                      <div className="flex-shrink-0">
                        {getStatusBadge(order.status, order.is_no_order_delivery, order.is_cancelled)}
                      </div>
                    </div>
                  </div>

                  {/* Menú del día */}
                  {order.menu && (
                    <div className="px-2 sm:px-3 md:px-4 pb-2 sm:pb-3 md:pb-4 pt-1.5 sm:pt-2 border-t bg-gray-50/50">
                      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 mb-1.5 sm:mb-2">
                        <UtensilsCrossed className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 text-blue-600" />
                        <span className="text-[10px] sm:text-xs font-semibold text-gray-700">
                          {order.category_name || 'Menú del día'}:
                        </span>
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

                      {/* Botón / mensaje de anulación */}
                      {renderCancelAction(order)}
                    </div>
                  )}

                  {/* Si no hay menú, mostrar el botón de anulación igual */}
                  {!order.menu && (
                    <div className="px-2 sm:px-3 md:px-4 pb-2 sm:pb-3">
                      {renderCancelAction(order)}
                    </div>
                  )}

                  {/* Detalles adicionales */}
                  {(order.cancellation_reason || order.postponement_reason) && (
                    <div className="px-2 sm:px-3 md:px-4 pb-2 sm:pb-3 text-[10px] sm:text-xs text-gray-500 border-t pt-2">
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

              {/* Botón Ver más */}
              {visibleCount < orders.length && (
                <div className="flex justify-center pt-1 sm:pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                    className="text-xs sm:text-sm"
                  >
                    Ver más ({orders.length - visibleCount} pedidos restantes)
                  </Button>
                </div>
              )}
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

      {/* DIÁLOGO DE CONFIRMACIÓN DE ANULACIÓN */}
      {confirmCancelOrder && (
        <Dialog open={!!confirmCancelOrder} onOpenChange={() => setConfirmCancelOrder(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-5 w-5 text-red-500" />
                ¿Anular este pedido?
              </DialogTitle>
              <DialogDescription className="text-sm">
                Pedido del{' '}
                <strong>
                  {format(new Date(confirmCancelOrder.order_date + 'T00:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                </strong>{' '}
                — {confirmCancelOrder.student.full_name}
              </DialogDescription>
            </DialogHeader>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 mt-2">
              <Info className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Al anular el pedido, la deuda asociada también se cancelará. Esta acción no se puede deshacer.
              </p>
            </div>

            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setConfirmCancelOrder(null)}
                disabled={cancellingOrderId === confirmCancelOrder.id}
              >
                No, mantener
              </Button>
              <Button
                onClick={() => handleCancelOrder(confirmCancelOrder)}
                disabled={cancellingOrderId === confirmCancelOrder.id}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {cancellingOrderId === confirmCancelOrder.id ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Anulando...</>
                ) : (
                  <><Trash2 className="h-4 w-4 mr-1" />Sí, anular</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
