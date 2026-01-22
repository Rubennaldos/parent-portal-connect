import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Calendar, UtensilsCrossed } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';

interface LunchOrder {
  order_id: string | null;
  school_id: string;
  school_name: string;
  school_color: string;
  order_date: string;
  starter: string;
  main_course: string;
  beverage: string;
  dessert: string;
  notes: string;
  is_special_day: boolean;
  special_day_type: string;
  special_day_title: string;
  order_status: string;
}

interface LunchCalendarViewProps {
  studentId: string; // Cambiar a studentId en lugar de studentSchoolIds
  studentName: string; // Agregar nombre del estudiante
}

export function LunchCalendarView({ studentId, studentName }: LunchCalendarViewProps) {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [orders, setOrders] = useState<LunchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    if (studentId) {
      fetchMonthOrders();
    }
  }, [currentDate, studentId]);

  const fetchMonthOrders = async () => {
    try {
      setLoading(true);
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();

      const { data, error } = await supabase.rpc('get_student_lunch_orders', {
        p_student_id: studentId,
        target_month: month,
        target_year: year
      });

      if (error) throw error;
      setOrders(data || []);
    } catch (error: any) {
      console.error('Error fetching lunch orders:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los pedidos de almuerzo',
      });
    } finally {
      setLoading(false);
    }
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Obtener los días del calendario (incluyendo días del mes anterior y siguiente)
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getOrdersForDay = (day: Date) => {
    const dayStr = format(day, 'yyyy-MM-dd');
    return orders.filter(o => o.order_date === dayStr);
  };

  const getDayType = (day: Date) => {
    const dayOrders = getOrdersForDay(day);
    
    if (dayOrders.length === 0) return 'sin_pedido';
    
    const firstOrder = dayOrders[0];
    if (firstOrder.is_special_day) {
      return firstOrder.special_day_type || 'no_laborable';
    }
    
    if (firstOrder.order_status === 'confirmed' && firstOrder.main_course) return 'con_pedido';
    
    return 'sin_pedido';
  };

  const getDayBgColor = (day: Date, type: string) => {
    const isCurrentMonth = isSameMonth(day, currentDate);
    const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
    
    if (!isCurrentMonth) return 'bg-gray-50';
    if (isToday) return 'ring-4 ring-blue-500';
    
    switch (type) {
      case 'con_pedido':
        return 'bg-green-100 hover:bg-green-200';
      case 'feriado':
        return 'bg-red-100';
      case 'no_laborable':
        return 'bg-gray-200';
      default:
        return 'bg-white hover:bg-gray-50';
    }
  };

  const renderDayContent = (day: Date, type: string) => {
    const dayOrders = getOrdersForDay(day);
    
    if (type === 'feriado' || type === 'no_laborable') {
      const title = dayOrders[0]?.special_day_title || (type === 'feriado' ? 'FERIADO' : 'FIN DE SEMANA');
      return (
        <div className="text-center">
          <p className="text-xs font-black text-gray-700 uppercase">{title}</p>
        </div>
      );
    }
    
    if (type === 'sin_pedido') {
      return (
        <div className="text-center">
          <p className="text-xs font-semibold text-gray-400">Sin pedido</p>
        </div>
      );
    }
    
    // Con pedido - Mostrar que tiene almuerzo
    return (
      <div className="space-y-1">
        <div className="text-center">
          <p className="text-xs font-bold text-green-700">✓ Almuerzo</p>
          <p className="text-xs text-gray-600">{studentName}</p>
        </div>
      </div>
    );
  };

  if (!studentId) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <UtensilsCrossed className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">Selecciona un estudiante para ver su calendario</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header con navegación */}
      <Card className="bg-gradient-to-r from-[#8B4513] to-[#D2691E]">
        <CardHeader>
          <div className="flex items-center justify-between text-white">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPreviousMonth}
              className="text-white hover:bg-white/20"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div className="text-center">
              <CardTitle className="text-2xl font-bold">
                {format(currentDate, 'MMMM yyyy', { locale: es }).toUpperCase()}
              </CardTitle>
              <p className="text-sm text-white/80">Pedidos de {studentName}</p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextMonth}
              className="text-white hover:bg-white/20"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="flex justify-center">
        <Button onClick={goToToday} variant="outline" className="border-[#8B4513] text-[#8B4513]">
          <Calendar className="h-4 w-4 mr-2" />
          Hoy
        </Button>
      </div>

      {/* Leyenda */}
      <Card className="bg-[#FFF8E7]">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 justify-center text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-100 border-2 border-green-300 rounded" />
              <span className="font-semibold">Pedido confirmado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-white border-2 border-gray-300 rounded" />
              <span className="font-semibold">Sin pedido</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-100 border-2 border-red-300 rounded" />
              <span className="font-semibold">Feriado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-gray-200 border-2 border-gray-400 rounded" />
              <span className="font-semibold">No laborable</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendario */}
      <Card>
        <CardContent className="p-2">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513] mx-auto"></div>
              <p className="mt-4 text-gray-500">Cargando menús...</p>
            </div>
          ) : (
            <>
              {/* Días de la semana */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day) => (
                  <div key={day} className="text-center text-xs font-bold text-gray-600 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {/* Días del mes */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, idx) => {
                  const type = getDayType(day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDay(day)}
                      className={`
                        min-h-[100px] p-2 rounded-lg border-2 transition-all
                        ${getDayBgColor(day, type)}
                        ${isCurrentMonth ? 'border-gray-300' : 'border-gray-200'}
                        ${type === 'con_pedido' ? 'cursor-pointer' : 'cursor-default'}
                      `}
                    >
                      <div className="text-left mb-1">
                        <span className={`text-sm font-bold ${isCurrentMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                          {format(day, 'd')}
                        </span>
                      </div>
                      {isCurrentMonth && renderDayContent(day, type)}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal de detalle del día (si se selecciona) */}
      {selectedDay && getDayType(selectedDay) === 'con_pedido' && (
        <Card className="border-4 border-green-500">
          <CardHeader className="bg-green-50">
            <div className="flex items-center justify-between">
              <CardTitle>
                Almuerzo - {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setSelectedDay(null)}>
                ✕
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {getOrdersForDay(selectedDay).map((order, idx) => (
              <div key={idx} className="border-l-4 pl-4 border-green-500">
                <p className="font-bold text-lg mb-2">{order.school_name}</p>
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Entrada:</span> {order.starter || 'No especificado'}</p>
                  <p><span className="font-semibold">Segundo:</span> {order.main_course}</p>
                  <p><span className="font-semibold">Bebida:</span> {order.beverage || 'No especificado'}</p>
                  <p><span className="font-semibold">Postre:</span> {order.dessert || 'No especificado'}</p>
                  {order.notes && <p className="text-gray-600 italic">{order.notes}</p>}
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs font-semibold text-green-700">
                      Estado: {order.order_status === 'confirmed' ? '✓ Confirmado' : 'Pendiente'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
