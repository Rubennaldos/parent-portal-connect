import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { UtensilsCrossed, Calendar, Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface LunchOrder {
  id: string;
  order_date: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'delivered';
  created_at: string;
  menu_id: string;
  category_id: string | null;
  delivered_by?: string | null;
  delivered_at?: string | null;
  lunch_menus: {
    starter: string | null;
    main_course: string;
    beverage: string | null;
    dessert: string | null;
  };
  lunch_categories: {
    name: string;
    color: string;
    price: number | null;
  } | null;
  profiles?: {
    full_name: string;
    role: string;
  } | null;
}

interface MyLunchOrdersProps {
  teacherId: string;
}

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', icon: Clock, color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: 'Confirmado', icon: CheckCircle2, color: 'bg-green-100 text-green-800' },
  delivered: { label: 'Entregado', icon: CheckCircle2, color: 'bg-blue-100 text-blue-800' },
  cancelled: { label: 'Cancelado', icon: XCircle, color: 'bg-red-100 text-red-800' },
};

export function MyLunchOrders({ teacherId }: MyLunchOrdersProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<LunchOrder[]>([]);

  useEffect(() => {
    fetchOrders();
  }, [teacherId]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('lunch_orders')
        .select(`
          id,
          order_date,
          status,
          created_at,
          menu_id,
          category_id,
          delivered_by,
          delivered_at,
          lunch_menus (
            starter,
            main_course,
            beverage,
            dessert
          ),
          lunch_categories (
            name,
            color,
            price
          )
        `)
        .eq('teacher_id', teacherId)
        .order('order_date', { ascending: false });

      if (error) throw error;

      // Obtener información de quien entregó cada pedido
      const ordersWithProfiles = await Promise.all(
        (data || []).map(async (order) => {
          if (order.delivered_by) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name, role')
              .eq('id', order.delivered_by)
              .single();
            
            return { ...order, profiles: profile };
          }
          return order;
        })
      );

      // 🎫 Batch: obtener ticket_codes de transacciones asociadas
      if (ordersWithProfiles.length > 0) {
        try {
          const orderIds = ordersWithProfiles.map(o => o.id);
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
            
            ordersWithProfiles.forEach((order: any) => {
              if (ticketMap.has(order.id)) {
                order._ticket_code = ticketMap.get(order.id);
              }
            });
          }
        } catch (err) {
          console.log('⚠️ No se pudieron obtener ticket_codes');
        }
      }

      setOrders(ordersWithProfiles);
    } catch (error: any) {
      console.error('Error fetching lunch orders:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar tus pedidos'
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-12">
        <UtensilsCrossed className="h-16 w-16 mx-auto mb-4 text-gray-300" />
        <p className="text-lg font-semibold text-gray-600 mb-2">Sin pedidos</p>
        <p className="text-sm text-gray-500">Aún no has solicitado ningún almuerzo</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => {
        const statusConfig = STATUS_CONFIG[order.status];
        const StatusIcon = statusConfig.icon;
        const orderDate = new Date(order.order_date + 'T00:00:00');

        return (
          <Card key={order.id} className="overflow-hidden">
            {/* Header con categoría */}
            {order.lunch_categories && (
              <div 
                className="p-4"
                style={{ backgroundColor: `${order.lunch_categories.color}15` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-lg">{order.lunch_categories.name}</h3>
                    {order.lunch_categories.price && (
                      <p className="text-sm font-semibold" style={{ color: order.lunch_categories.color }}>
                        S/ {order.lunch_categories.price.toFixed(2)}
                      </p>
                    )}
                  </div>
                  <Badge className={statusConfig.color}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {statusConfig.label}
                  </Badge>
                </div>
              </div>
            )}

            <CardContent className="p-4 space-y-3">
              {/* Fecha */}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4" />
                <span className="font-medium">
                  {format(orderDate, "EEEE d 'de' MMMM", { locale: es })}
                </span>
              </div>

              {/* Menú */}
              <div className="space-y-1 text-sm">
                {order.lunch_menus.starter && (
                  <div>
                    <span className="font-medium text-gray-600">Entrada:</span>
                    <p className="text-gray-900">{order.lunch_menus.starter}</p>
                  </div>
                )}
                <div>
                  <span className="font-medium text-green-700">Segundo:</span>
                  <p className="font-bold text-green-800">{order.lunch_menus.main_course}</p>
                </div>
                {order.lunch_menus.beverage && (
                  <div>
                    <span className="font-medium text-gray-600">Bebida:</span>
                    <p className="text-gray-900">{order.lunch_menus.beverage}</p>
                  </div>
                )}
                {order.lunch_menus.dessert && (
                  <div>
                    <span className="font-medium text-gray-600">Postre:</span>
                    <p className="text-gray-900">{order.lunch_menus.dessert}</p>
                  </div>
                )}
              </div>

              {/* Fecha de pedido y ticket */}
              <div className="pt-2 border-t">
                <p className="text-xs text-gray-400">
                  Pedido el {format(new Date(order.created_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })}
                </p>
                {(order as any)._ticket_code && (
                  <p className="text-xs font-bold text-indigo-700 mt-1">
                    🎫 Ticket: {(order as any)._ticket_code}
                  </p>
                )}
              </div>
              
              {/* Información de entrega */}
              {order.status === 'delivered' && order.delivered_by && order.profiles && (
                <div className="mt-2 pt-2 border-t bg-blue-50 -mx-4 -mb-4 px-4 py-3 rounded-b-lg">
                  <p className="text-xs text-blue-700">
                    <span className="font-semibold">Entregado por:</span> {order.profiles.full_name}
                  </p>
                  {order.delivered_at && (
                    <p className="text-xs text-blue-600 mt-1">
                      {format(new Date(order.delivered_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
