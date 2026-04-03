import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { BILLING_EXCLUDED } from '@/lib/billingUtils';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ChevronLeft,
  ChevronRight,
  UtensilsCrossed,
  AlertCircle,
  CheckCircle2,
  CalendarDays,
  Loader2
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';

interface TeacherLunchCalendarProps {
  teacherId: string;
  schoolId: string;
}

interface LunchMenu {
  id: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  notes: string | null;
}

interface SpecialDay {
  date: string;
  type: 'feriado' | 'no_laborable' | 'suspension' | 'otro';
  title: string;
}

interface ExistingOrder {
  date: string;
  status: string;
}

interface LunchConfig {
  lunch_price: number;
  orders_enabled: boolean;
  order_deadline_time: string;
  order_deadline_days: number;
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function TeacherLunchCalendar({ teacherId, schoolId }: TeacherLunchCalendarProps) {
  const { toast } = useToast();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [menus, setMenus] = useState<Map<string, LunchMenu>>(new Map());
  const [specialDays, setSpecialDays] = useState<Map<string, SpecialDay>>(new Map());
  const [existingOrders, setExistingOrders] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<LunchConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMenuDate, setSelectedMenuDate] = useState<string | null>(null);

  useEffect(() => {
    fetchMonthlyData();
  }, [currentDate, teacherId, schoolId]);

  const fetchMonthlyData = async () => {
    try {
      setLoading(true);
      console.log('📅 Cargando datos del mes para profesor:', teacherId);

      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);

      // 1. Obtener configuración de almuerzos
      const { data: configData, error: configError } = await supabase
        .from('lunch_configuration')
        .select('lunch_price, orders_enabled, order_deadline_time, order_deadline_days')
        .eq('school_id', schoolId)
        .maybeSingle();

      if (configError) {
        console.error('Error cargando configuración:', configError);
      } else {
        setConfig(configData);
      }

      // 2. Obtener menús del mes
      const { data: menusData, error: menusError } = await supabase
        .from('lunch_menus')
        .select('*')
        .eq('school_id', schoolId)
        .gte('date', format(start, 'yyyy-MM-dd'))
        .lte('date', format(end, 'yyyy-MM-dd'))
        .order('date', { ascending: true });

      if (menusError) throw menusError;

      const menusMap = new Map<string, LunchMenu>();
      menusData?.forEach(menu => {
        menusMap.set(menu.date, menu);
      });
      setMenus(menusMap);

      // 3. Obtener días especiales
      const { data: specialDaysData, error: specialDaysError } = await supabase
        .from('special_days')
        .select('*')
        .eq('school_id', schoolId)
        .gte('date', format(start, 'yyyy-MM-dd'))
        .lte('date', format(end, 'yyyy-MM-dd'));

      if (specialDaysError) throw specialDaysError;

      const specialDaysMap = new Map<string, SpecialDay>();
      specialDaysData?.forEach(day => {
        specialDaysMap.set(day.date, day);
      });
      setSpecialDays(specialDaysMap);

      // 4. Obtener pedidos existentes del profesor
      const { data: ordersData, error: ordersError } = await supabase
        .from('lunch_orders')
        .select('order_date, status')
        .eq('teacher_id', teacherId)
        .gte('order_date', format(start, 'yyyy-MM-dd'))
        .lte('order_date', format(end, 'yyyy-MM-dd'));

      if (ordersError) throw ordersError;

      const ordersSet = new Set<string>();
      ordersData?.forEach(order => {
        ordersSet.add(order.order_date);
      });
      setExistingOrders(ordersSet);

      console.log('✅ Datos cargados:', {
        menus: menusMap.size,
        specialDays: specialDaysMap.size,
        orders: ordersSet.size
      });

    } catch (error: any) {
      console.error('❌ Error cargando datos del mes:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los menús del mes',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // Si ya tiene pedido, no permitir cambios
    if (existingOrders.has(dateStr)) {
      toast({
        variant: 'default',
        title: 'Ya tienes un pedido',
        description: 'Ya ordenaste almuerzo para este día',
      });
      return;
    }

    // Si no hay menú, no permitir pedido
    if (!menus.has(dateStr)) {
      toast({
        variant: 'destructive',
        title: 'Sin menú',
        description: 'No hay menú disponible para este día',
      });
      return;
    }

    // Si hay día especial, no permitir pedido
    if (specialDays.has(dateStr)) {
      toast({
        variant: 'default',
        title: 'Día especial',
        description: specialDays.get(dateStr)?.title || 'No hay clases este día',
      });
      return;
    }

    setSelectedDate(dateStr);
    setSelectedMenuDate(dateStr);
  };

  // ⏰ Validar si se puede hacer pedido según la hora límite
  const canOrderForDate = (targetDate: string): { canOrder: boolean; message?: string; isWarning?: boolean } => {
    if (!config || !config.order_deadline_time || config.order_deadline_days === undefined) {
      return { canOrder: true };
    }

    const now = new Date();
    const target = new Date(targetDate + 'T00:00:00-05:00'); // Zona horaria Perú
    
    // Calcular el deadline
    const deadlineDate = new Date(target);
    deadlineDate.setDate(deadlineDate.getDate() - config.order_deadline_days);
    
    // Parsear la hora límite (formato "HH:MM:SS")
    const [hours, minutes] = config.order_deadline_time.split(':').map(Number);
    deadlineDate.setHours(hours, minutes, 0, 0);

    console.log('⏰ Validación de hora límite:', {
      now: now.toLocaleString('es-PE', { timeZone: 'America/Lima' }),
      deadline: deadlineDate.toLocaleString('es-PE', { timeZone: 'America/Lima' }),
      canOrder: now <= deadlineDate
    });

    // Si ya pasó el deadline
    if (now > deadlineDate) {
      return {
        canOrder: false,
        message: `Ya no puedes hacer pedidos. La hora límite era ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}.`
      };
    }

    // Si faltan menos de 30 minutos para el deadline (advertencia)
    const timeUntilDeadline = deadlineDate.getTime() - now.getTime();
    const minutesUntilDeadline = Math.floor(timeUntilDeadline / (1000 * 60));

    if (minutesUntilDeadline <= 30 && minutesUntilDeadline > 0) {
      return {
        canOrder: true,
        isWarning: true,
        message: `¡Apúrate! Solo quedan ${minutesUntilDeadline} minutos para hacer tu pedido hasta las ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}.`
      };
    }

    return { canOrder: true };
  };

  const handleOrderLunch = async () => {
    if (!selectedDate || !config) return;

    // ⏰ VALIDACIÓN: Verificar si se puede hacer el pedido
    const validation = canOrderForDate(selectedDate);
    if (!validation.canOrder) {
      toast({
        variant: 'destructive',
        title: '❌ Pedido no permitido',
        description: validation.message,
        duration: 6000,
      });
      return;
    }

    // Si hay advertencia, mostrarla pero permitir continuar
    if (validation.isWarning && validation.message) {
      toast({
        title: '⚠️ Aviso Importante',
        description: validation.message,
        duration: 6000,
      });
    }

    try {
      setSubmitting(true);
      console.log('🍽️ Creando pedido de almuerzo para profesor');

      // Crear pedido y obtener su ID
      const { data: insertedOrder, error: orderError } = await supabase
        .from('lunch_orders')
        .insert({
          teacher_id: teacherId,
          order_date: selectedDate,
          status: 'confirmed',
          school_id: schoolId,
        })
        .select('id')
        .single();

      if (orderError) throw orderError;

      // 🎫 Generar ticket_code
      let ticketCode: string | null = null;
      try {
        const { data: ticketNumber, error: ticketError } = await supabase
          .rpc('get_next_ticket_number', { p_user_id: teacherId });
        if (!ticketError && ticketNumber) {
          ticketCode = ticketNumber;
        }
      } catch (err) {
        console.warn('⚠️ No se pudo generar ticket_code:', err);
      }

      // Crear transacción de cuenta libre CON lunch_order_id para evitar duplicados
      console.log('🔍 [TeacherLunchCalendar] Creando transacción con payment_status: pending, lunch_order_id:', insertedOrder.id);
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          teacher_id: teacherId,
          type: 'purchase',
          amount: -config.lunch_price,
          description: `Almuerzo - ${format(new Date(selectedDate), "d 'de' MMMM", { locale: es })}`,
          payment_status: 'pending',
          payment_method: null,
          school_id: schoolId,
          ticket_code: ticketCode,
          metadata: {
            lunch_order_id: insertedOrder.id,
            source: 'teacher_lunch_calendar',
            order_date: selectedDate
          },
          ...BILLING_EXCLUDED,
        });

      if (transactionError) throw transactionError;

      toast({
        title: '✅ Pedido confirmado',
        description: `Almuerzo ordenado para el ${format(new Date(selectedDate), "d 'de' MMMM", { locale: es })}`,
      });

      // Recargar datos
      setSelectedDate(null);
      setSelectedMenuDate(null);
      fetchMonthlyData();

    } catch (error: any) {
      console.error('❌ Error creando pedido:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear el pedido',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getDayStatus = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    
    if (existingOrders.has(dateStr)) return 'ordered';
    if (specialDays.has(dateStr)) return 'special';
    if (menus.has(dateStr)) return 'available';
    return 'unavailable';
  };

  const renderCalendar = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });

    // Obtener el día de la semana del primer día (0 = domingo, 1 = lunes, etc.)
    const startDayOfWeek = start.getDay();

    return (
      <div className="grid grid-cols-7 gap-2">
        {/* Headers de días de la semana */}
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-center text-sm font-medium text-gray-500 p-2">
            {day}
          </div>
        ))}

        {/* Espacios en blanco antes del primer día */}
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* Días del mes */}
        {days.map((date) => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const status = getDayStatus(date);
          const menu = menus.get(dateStr);
          const specialDay = specialDays.get(dateStr);
          const isSelected = selectedDate === dateStr;
          const today = isToday(date);

          return (
            <button
              key={dateStr}
              onClick={() => handleDateClick(date)}
              className={cn(
                "aspect-square p-2 rounded-lg border-2 transition-all relative",
                "hover:shadow-md disabled:cursor-not-allowed",
                today && "ring-2 ring-blue-400",
                isSelected && "ring-2 ring-purple-500 bg-purple-50",
                status === 'ordered' && "bg-green-50 border-green-300",
                status === 'special' && "bg-gray-100 border-gray-300",
                status === 'available' && "bg-white border-blue-200 hover:border-blue-400",
                status === 'unavailable' && "bg-gray-50 border-gray-200"
              )}
              disabled={status === 'unavailable' || status === 'ordered'}
            >
              <div className="text-sm font-medium">
                {format(date, 'd')}
              </div>

              {status === 'ordered' && (
                <CheckCircle2 className="absolute top-1 right-1 h-3 w-3 text-green-600" />
              )}

              {status === 'special' && specialDay && (
                <Badge variant="secondary" className="absolute bottom-0 left-0 right-0 text-[8px] h-4 justify-center">
                  {specialDay.title.substring(0, 8)}
                </Badge>
              )}

              {status === 'available' && menu && (
                <UtensilsCrossed className="absolute top-1 right-1 h-3 w-3 text-blue-600" />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  const selectedMenu = selectedMenuDate ? menus.get(selectedMenuDate) : null;

  return (
    <div className="space-y-6">
      {/* Header con navegación de mes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div className="text-center">
              <CardTitle className="text-lg">
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </CardTitle>
              <CardDescription className="text-sm">
                Selecciona un día para ordenar tu almuerzo
              </CardDescription>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {renderCalendar()}

          {/* Leyenda */}
          <div className="mt-6 flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Ya ordenado</span>
            </div>
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-blue-600" />
              <span>Menú disponible</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-gray-400" />
              <span>No disponible</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detalle del menú seleccionado */}
      {selectedMenu && selectedDate && (
        <Card className="border-2 border-purple-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {format(new Date(selectedDate), "EEEE, d 'de' MMMM", { locale: es })}
            </CardTitle>
            <CardDescription>
              Menú del día - S/ {config?.lunch_price.toFixed(2)}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* ⚠️ ADVERTENCIA DE HORA LÍMITE */}
            {(() => {
              const validation = canOrderForDate(selectedDate);
              if (!validation.canOrder || validation.isWarning) {
                return (
                  <div className={cn(
                    "p-3 rounded-lg border-2 flex items-start gap-2",
                    !validation.canOrder 
                      ? "bg-red-50 border-red-300" 
                      : "bg-yellow-50 border-yellow-300"
                  )}>
                    <AlertCircle className={cn(
                      "h-5 w-5 mt-0.5 flex-shrink-0",
                      !validation.canOrder ? "text-red-600" : "text-yellow-600"
                    )} />
                    <p className={cn(
                      "text-sm font-medium",
                      !validation.canOrder ? "text-red-800" : "text-yellow-800"
                    )}>
                      {validation.message}
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {selectedMenu.starter && (
              <div>
                <p className="text-sm font-medium text-gray-600">Entrada</p>
                <p className="text-base">{selectedMenu.starter}</p>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-gray-600">Plato Principal</p>
              <p className="text-base font-semibold">{selectedMenu.main_course}</p>
            </div>

            {selectedMenu.beverage && (
              <div>
                <p className="text-sm font-medium text-gray-600">Bebida</p>
                <p className="text-base">{selectedMenu.beverage}</p>
              </div>
            )}

            {selectedMenu.dessert && (
              <div>
                <p className="text-sm font-medium text-gray-600">Postre</p>
                <p className="text-base">{selectedMenu.dessert}</p>
              </div>
            )}

            {selectedMenu.notes && (
              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-sm text-blue-800">{selectedMenu.notes}</p>
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleOrderLunch}
                disabled={submitting || !config?.orders_enabled}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <UtensilsCrossed className="h-4 w-4 mr-2" />
                    Ordenar Almuerzo
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setSelectedDate(null);
                  setSelectedMenuDate(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info sobre cuenta libre */}
      <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-purple-600 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-gray-900">Tu cuenta es libre</p>
              <p className="text-gray-600 mt-1">
                Como profesor, no tienes límites de gasto. Los almuerzos se cargarán automáticamente a tu cuenta.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
