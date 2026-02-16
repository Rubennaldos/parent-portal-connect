import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  UtensilsCrossed,
  Users,
  Clock,
  AlertCircle,
  CheckCircle2,
  Zap,
  CalendarDays,
  DollarSign
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';

interface LunchOrderCalendarProps {
  isOpen: boolean;
  onClose: () => void;
  parentId: string;
  embedded?: boolean; // Nuevo: para modo embebido (dentro de pestaña)
}

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  school_id: string;
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

interface LunchConfig {
  lunch_price: number;
  order_deadline_time: string;
  order_deadline_days: number;
  cancellation_deadline_time: string;
  cancellation_deadline_days: number;
  orders_enabled: boolean;
}

interface ExistingOrder {
  date: string;
  student_id: string;
  status: string;
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export function LunchOrderCalendar({ isOpen, onClose, parentId, embedded = false }: LunchOrderCalendarProps) {
  const { toast } = useToast();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [menus, setMenus] = useState<Map<string, LunchMenu>>(new Map());
  const [specialDays, setSpecialDays] = useState<Map<string, SpecialDay>>(new Map());
  const [existingOrders, setExistingOrders] = useState<Map<string, Set<string>>>(new Map());
  const [config, setConfig] = useState<LunchConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showMenuDetail, setShowMenuDetail] = useState(false);
  const [selectedMenuDate, setSelectedMenuDate] = useState<string | null>(null);
  
  // Estados para selector de rango inteligente
  const [showRangeSelector, setShowRangeSelector] = useState(false);
  const [rangeStartDate, setRangeStartDate] = useState<string>('');
  const [rangeEndDate, setRangeEndDate] = useState<string>('');
  const [selectedWeekdays, setSelectedWeekdays] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isOpen && parentId) {
      loadData();
    }
  }, [isOpen, currentDate, parentId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // PRIMERO cargar estudiantes, LUEGO los menús
      const studentsData = await fetchStudents();
      if (studentsData && studentsData.length > 0) {
        await fetchMonthlyData(studentsData);
      } else {
        console.warn('⚠️ No se encontraron estudiantes para cargar menús');
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    console.log('👨‍👩‍👧‍👦 fetchStudents iniciado, parentId:', parentId);
    
    const { data, error } = await supabase
      .from('students')
      .select('id, full_name, photo_url, school_id')
      .eq('parent_id', parentId)
      .eq('is_active', true);

    if (error) {
      console.error('❌ Error cargando estudiantes:', error);
      throw error;
    }
    
    console.log('✅ Estudiantes cargados:', data);
    setStudents(data || []);
    
    // Auto-seleccionar todos los estudiantes
    setSelectedStudents(new Set(data?.map(s => s.id) || []));
    
    return data || [];
  };

  const fetchMonthlyData = async (studentsData?: Student[]) => {
    // Usar studentsData si se pasa como parámetro, si no, usar el estado
    const dataToUse = studentsData || students;
    
    if (dataToUse.length === 0) {
      console.log('🍽️ fetchMonthlyData: NO hay estudiantes, abortando');
      return;
    }

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const schoolId = dataToUse[0]?.school_id;

    console.log('🍽️ fetchMonthlyData iniciado:', {
      estudiantesCount: dataToUse.length,
      primerEstudiante: dataToUse[0]?.full_name,
      schoolId,
      monthStart: format(monthStart, 'yyyy-MM-dd'),
      monthEnd: format(monthEnd, 'yyyy-MM-dd')
    });

    if (!schoolId) {
      console.error('❌ fetchMonthlyData: schoolId es NULL o undefined');
      return;
    }

    // Fetch configuración
    const { data: configData, error: configError } = await supabase
      .from('lunch_configuration')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle(); // Cambiar a maybeSingle para que no falle si no hay config

    if (configError) {
      console.error('❌ Error cargando configuración de almuerzos:', configError);
    } else if (!configData) {
      console.warn('⚠️ No hay configuración de almuerzos para esta sede. Usando valores por defecto.');
      // Configuración por defecto si no existe
      const defaultConfig: LunchConfig = {
        lunch_price: 5.00,
        order_deadline_time: '09:00:00',
        order_deadline_days: 1,
        cancellation_deadline_time: '09:00:00',
        cancellation_deadline_days: 1,
        orders_enabled: true
      };
      setConfig(defaultConfig);
    } else {
      console.log('✅ Configuración de almuerzos cargada:', configData);
      setConfig(configData);
    }

    // Fetch menús del mes
    console.log('📋 Fetching menús con:', {
      schoolId,
      desde: format(monthStart, 'yyyy-MM-dd'),
      hasta: format(monthEnd, 'yyyy-MM-dd')
    });

    const { data: menusData, error: menusError } = await supabase
      .from('lunch_menus')
      .select('*')
      .eq('school_id', schoolId)
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd'))
      .order('date');

    if (menusError) {
      console.error('❌ ERROR fetching menús:', menusError);
    } else {
      console.log('✅ Menús obtenidos:', {
        count: menusData?.length || 0,
        menus: menusData
      });
    }

    const menusMap = new Map<string, LunchMenu>();
    menusData?.forEach(menu => {
      console.log('📌 Agregando menú al Map:', menu.date, menu);
      menusMap.set(menu.date, menu);
    });
    
    console.log('🗺️ Map de menús final:', {
      size: menusMap.size,
      fechas: Array.from(menusMap.keys())
    });
    
    setMenus(menusMap);

    // Fetch días especiales
    const { data: specialData } = await supabase
      .from('special_days')
      .select('date, type, title')
      .or(`school_id.is.null,school_id.eq.${schoolId}`)
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd'));

    const specialMap = new Map<string, SpecialDay>();
    specialData?.forEach(day => {
      specialMap.set(day.date, day);
    });
    setSpecialDays(specialMap);

    // Fetch pedidos existentes
    const { data: ordersData } = await supabase
      .from('lunch_orders')
      .select('order_date, student_id, status')
      .in('student_id', dataToUse.map(s => s.id))
      .gte('order_date', format(monthStart, 'yyyy-MM-dd'))
      .lte('order_date', format(monthEnd, 'yyyy-MM-dd'))
      .neq('status', 'cancelled');

    const ordersMap = new Map<string, Set<string>>();
    ordersData?.forEach(order => {
      const dateStr = order.order_date;
      if (!ordersMap.has(dateStr)) {
        ordersMap.set(dateStr, new Set());
      }
      ordersMap.get(dateStr)!.add(order.student_id);
    });
    setExistingOrders(ordersMap);
  };

  const handlePreviousMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
    setSelectedDates(new Set());
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
    setSelectedDates(new Set());
  };

  const toggleStudent = (studentId: string) => {
    setSelectedStudents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  const toggleDate = (dateStr: string) => {
    // No permitir seleccionar días especiales o sin menú
    if (specialDays.has(dateStr) || !menus.has(dateStr)) {
      return;
    }

    // No permitir seleccionar días que YA tienen pedido
    if (existingOrders.has(dateStr)) {
      toast({
        variant: 'destructive',
        title: '⚠️ Ya tienes un pedido para este día',
        description: `Ya realizaste un pedido de almuerzo para el ${new Date(dateStr).toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })}. No puedes pedir dos veces el mismo día.`,
      });
      return;
    }

    setSelectedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateStr)) {
        newSet.delete(dateStr);
      } else {
        newSet.add(dateStr);
      }
      return newSet;
    });
  };

  const handleDayClick = (dateStr: string) => {
    // Si ya tiene pedido, mostrar mensaje en lugar de abrir modal
    if (existingOrders.has(dateStr)) {
      toast({
        variant: 'destructive',
        title: '⚠️ Ya tienes un pedido para este día',
        description: `Ya realizaste un pedido de almuerzo para el ${new Date(dateStr).toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })}. No puedes pedir dos veces el mismo día.`,
      });
      return;
    }

    const menu = menus.get(dateStr);
    if (menu) {
      setSelectedMenuDate(dateStr);
      setShowMenuDetail(true);
    } else {
      toggleDate(dateStr);
    }
  };

  // Modalidades rápidas
  const selectAllMondays = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    const newDates = new Set<string>();
    days.forEach(day => {
      if (day.getDay() === 1) { // Lunes
        const dateStr = format(day, 'yyyy-MM-dd');
        if (menus.has(dateStr) && !specialDays.has(dateStr)) {
          newDates.add(dateStr);
        }
      }
    });
    setSelectedDates(newDates);
  };

  const selectAllWeekday = (weekday: number) => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    const newDates = new Set<string>();
    days.forEach(day => {
      if (day.getDay() === weekday) {
        const dateStr = format(day, 'yyyy-MM-dd');
        if (menus.has(dateStr) && !specialDays.has(dateStr)) {
          newDates.add(dateStr);
        }
      }
    });
    setSelectedDates(newDates);
  };

  const selectAllMonth = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    console.log('selectAllMonth llamado');
    console.log('Menús disponibles:', menus.size);
    console.log('Días especiales:', specialDays.size);
    
    const newDates = new Set<string>();
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (menus.has(dateStr) && !specialDays.has(dateStr)) {
        newDates.add(dateStr);
      }
    });
    
    console.log('Días seleccionados:', newDates.size);
    setSelectedDates(newDates);
    
    if (newDates.size === 0) {
      toast({
        variant: 'destructive',
        title: 'No hay menús disponibles',
        description: 'No se encontraron menús para este mes. El administrador debe crear los menús primero.',
      });
    } else {
      toast({
        title: `✅ ${newDates.size} días seleccionados`,
        description: 'Revisa el calendario y confirma tu pedido',
      });
    }
  };

  const selectFromToday = () => {
    const today = new Date();
    const monthEnd = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start: today, end: monthEnd });
    
    const newDates = new Set<string>();
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (menus.has(dateStr) && !specialDays.has(dateStr)) {
        newDates.add(dateStr);
      }
    });
    setSelectedDates(newDates);
  };

  // Nueva función: Selección inteligente con rango de fechas
  const selectCustomRange = () => {
    if (!rangeStartDate || !rangeEndDate) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona ambas fechas (desde y hasta)',
      });
      return;
    }

    const start = new Date(rangeStartDate);
    const end = new Date(rangeEndDate);
    
    if (start > end) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'La fecha inicial debe ser anterior a la final',
      });
      return;
    }

    const days = eachDayOfInterval({ start, end });
    const newDates = new Set<string>();
    
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayOfWeek = day.getDay();
      
      // Si hay días de la semana seleccionados, filtrar por ellos
      const matchesWeekday = selectedWeekdays.size === 0 || selectedWeekdays.has(dayOfWeek);
      
      if (matchesWeekday && menus.has(dateStr) && !specialDays.has(dateStr)) {
        newDates.add(dateStr);
      }
    });
    
    setSelectedDates(newDates);
    setShowRangeSelector(false);
    
    toast({
      title: '✅ Selección aplicada',
      description: `Se seleccionaron ${newDates.size} día(s)`,
    });
  };

  const toggleWeekday = (weekday: number) => {
    setSelectedWeekdays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(weekday)) {
        newSet.delete(weekday);
      } else {
        newSet.add(weekday);
      }
      return newSet;
    });
  };

  const calculateTotal = () => {
    if (!config) return 0;
    return selectedDates.size * selectedStudents.size * config.lunch_price;
  };

  const handleSubmitOrders = async () => {
    if (selectedDates.size === 0 || selectedStudents.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos un día y un estudiante',
      });
      return;
    }

    if (!config) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la configuración de almuerzos',
      });
      return;
    }

    // Validar que ningún día seleccionado ya tenga pedido
    const daysWithExistingOrders: string[] = [];
    for (const dateStr of selectedDates) {
      if (existingOrders.has(dateStr)) {
        daysWithExistingOrders.push(new Date(dateStr).toLocaleDateString('es-PE', { day: 'numeric', month: 'long' }));
      }
    }

    if (daysWithExistingOrders.length > 0) {
      toast({
        variant: 'destructive',
        title: '⚠️ Algunos días ya tienen pedidos',
        description: `Ya tienes pedidos para: ${daysWithExistingOrders.join(', ')}. Por favor deselecciónalos.`,
      });
      return;
    }

    setSubmitting(true);
    try {
      console.log('🍽️ Iniciando proceso de pedidos de almuerzos...');
      
      // Crear pedidos
      const orders = [];
      
      for (const dateStr of selectedDates) {
        for (const studentId of selectedStudents) {
          orders.push({
            student_id: studentId,
            order_date: dateStr,
            status: 'confirmed',
            created_at: new Date().toISOString(),
          });
        }
      }

      // 📋 Insertar pedidos Y obtener sus IDs para vincularlos a transacciones
      console.log('📋 Insertando pedidos:', orders.length);
      const { data: insertedOrders, error: ordersError } = await supabase
        .from('lunch_orders')
        .insert(orders)
        .select('id, student_id, order_date');

      if (ordersError) throw ordersError;

      // Crear mapa de lunch_order_id por (student_id + order_date)
      const orderIdMap = new Map<string, string>();
      if (insertedOrders) {
        for (const io of insertedOrders) {
          orderIdMap.set(`${io.student_id}_${io.order_date}`, io.id);
        }
      }

      // Crear transacciones con lunch_order_id vinculado
      const transactions = [];
      
      for (const dateStr of selectedDates) {
        for (const studentId of selectedStudents) {
          const student = students.find(s => s.id === studentId);

          // Si el estudiante tiene CUENTA LIBRE, crear transacción (deuda)
          if (student) {
            const { data: studentData } = await supabase
              .from('students')
              .select('free_account')
              .eq('id', studentId)
              .single();

            if (studentData?.free_account === true) {
              console.log(`💳 Estudiante ${student.full_name} tiene CUENTA LIBRE - Creando transacción`);
              
              const lunchOrderId = orderIdMap.get(`${studentId}_${dateStr}`);

              // 🎫 Generar ticket_code
              let ticketCode: string | null = null;
              try {
                const { data: ticketNumber, error: ticketErr } = await supabase
                  .rpc('get_next_ticket_number', { p_user_id: parentId });
                if (!ticketErr && ticketNumber) {
                  ticketCode = ticketNumber;
                }
              } catch (err) {
                console.warn('⚠️ No se pudo generar ticket_code:', err);
              }
              
              transactions.push({
                student_id: studentId,
                type: 'purchase',
                amount: -config.lunch_price, // Negativo = deuda
                payment_status: 'pending',
                description: `Almuerzo - ${new Date(dateStr + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })}`,
                created_at: new Date().toISOString(),
                ticket_code: ticketCode,
                metadata: {
                  lunch_order_id: lunchOrderId || null,
                  source: 'parent_lunch_calendar',
                  order_date: dateStr
                }
              });
            } else {
              console.log(`💰 Estudiante ${student.full_name} tiene SALDO PREPAGADO - Descontando del balance`);
              
              // Para cuentas con saldo, descontar del balance
              const { data: currentStudent } = await supabase
                .from('students')
                .select('balance')
                .eq('id', studentId)
                .single();

              if (currentStudent) {
                const newBalance = (currentStudent.balance || 0) - config.lunch_price;
                
                await supabase
                  .from('students')
                  .update({ balance: newBalance })
                  .eq('id', studentId);

                // ✅ NO crear transacción para cuentas prepagadas
              }
            }
          }
        }
      }

      console.log('💰 Insertando transacciones:', transactions.length);
      if (transactions.length > 0) {
        const { error: transError } = await supabase
          .from('transactions')
          .insert(transactions);

        if (transError) {
          console.error('❌ Error insertando transacciones:', transError);
          throw transError;
        }
      }

      toast({
        title: '✅ ¡Pedidos realizados!',
        description: `${orders.length} almuerzo(s) pedido(s) • ${transactions.filter(t => t.payment_status === 'pending').length} registrado(s) como deuda`,
      });

      // Recargar datos y limpiar selección
      await fetchMonthlyData();
      setSelectedDates(new Set());
      onClose();
    } catch (error: any) {
      console.error('❌ Error submitting orders:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron procesar los pedidos',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfMonth = monthStart.getDay();

  if (embedded) {
    // Modo embebido: render directo sin Dialog
    return (
      <>
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 sm:h-12 sm:w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-500 text-sm sm:text-base">Cargando calendario...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-3 md:gap-4 lg:gap-6">
            {/* Panel lateral: Estudiantes y Acciones Rápidas */}
            <aside className="lg:col-span-3 space-y-2 sm:space-y-3 md:space-y-4">
              {/* Selección de Estudiantes */}
              <Card className="border-stone-200/50">
                <CardHeader className="pb-2 px-3 sm:px-4 md:px-6 py-2 sm:py-3">
                  <CardTitle className="text-xs sm:text-sm md:text-base flex items-center gap-1.5">
                    <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4" />
                    Seleccionar Estudiantes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 px-3 sm:px-4 md:px-6 py-2 sm:py-3">
                  {students.map(student => (
                    <div key={student.id} className="flex items-center space-x-1.5 sm:space-x-2">
                      <Checkbox
                        id={`student-${student.id}`}
                        checked={selectedStudents.has(student.id)}
                        onCheckedChange={() => toggleStudent(student.id)}
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      />
                      <label
                        htmlFor={`student-${student.id}`}
                        className="text-[10px] sm:text-xs md:text-sm cursor-pointer flex items-center gap-1 sm:gap-1.5"
                      >
                        {student.photo_url && (
                          <img
                            src={student.photo_url}
                            alt={student.full_name}
                            className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 rounded-full object-cover"
                          />
                        )}
                        <span className="truncate">{student.full_name}</span>
                      </label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Acciones Rápidas */}
              <Card className="border-stone-200/50">
                <CardHeader className="pb-2 px-3 sm:px-4 md:px-6 py-2 sm:py-3">
                  <CardTitle className="text-xs sm:text-sm md:text-base flex items-center gap-1.5">
                    <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 text-orange-500" />
                    Selección Rápida
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 px-3 sm:px-4 md:px-6 py-2 sm:py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-7 sm:h-8 md:h-9 text-[10px] sm:text-xs md:text-sm px-2 sm:px-3"
                    onClick={selectAllMonth}
                  >
                    <CalendarDays className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 mr-1 sm:mr-1.5" />
                    Todo el Mes
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-7 sm:h-8 md:h-9 text-[10px] sm:text-xs md:text-sm px-2 sm:px-3"
                    onClick={selectFromToday}
                  >
                    <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 mr-1 sm:mr-1.5" />
                    Desde Hoy
                  </Button>
                  
                  {/* Selector inteligente con rango */}
                  <div className="pt-1.5 border-t">
                    <Button
                      variant={showRangeSelector ? "default" : "outline"}
                      size="sm"
                      className="w-full justify-start mb-1.5 h-7 sm:h-8 md:h-9 text-[10px] sm:text-xs md:text-sm px-2 sm:px-3"
                      onClick={() => setShowRangeSelector(!showRangeSelector)}
                    >
                      <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4 mr-1 sm:mr-1.5" />
                      Selección Inteligente
                    </Button>
                    
                    {showRangeSelector && (
                      <div className="space-y-1.5 sm:space-y-2 p-2 bg-orange-50 rounded-lg border border-orange-200">
                        <div className="space-y-1">
                          <Label className="text-[10px] sm:text-xs font-bold">Desde:</Label>
                          <Input
                            type="date"
                            value={rangeStartDate}
                            onChange={(e) => setRangeStartDate(e.target.value)}
                            className="text-[10px] sm:text-xs md:text-sm h-7 sm:h-8 md:h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] sm:text-xs font-bold">Hasta:</Label>
                          <Input
                            type="date"
                            value={rangeEndDate}
                            onChange={(e) => setRangeEndDate(e.target.value)}
                            className="text-[10px] sm:text-xs md:text-sm h-7 sm:h-8 md:h-9"
                          />
                        </div>
                        <div className="space-y-1.5 sm:space-y-2">
                          <Label className="text-[10px] sm:text-xs font-bold">Solo estos días (opcional):</Label>
                          <div className="grid grid-cols-3 gap-1">
                            {[
                              { day: 1, label: 'Lun' },
                              { day: 2, label: 'Mar' },
                              { day: 3, label: 'Mié' },
                              { day: 4, label: 'Jue' },
                              { day: 5, label: 'Vie' },
                            ].map(({ day, label }) => (
                              <Button
                                key={day}
                                variant={selectedWeekdays.has(day) ? "default" : "outline"}
                                size="sm"
                                className="text-[10px] sm:text-xs h-7 sm:h-8"
                                onClick={() => toggleWeekday(day)}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                          <p className="text-[9px] sm:text-[10px] text-gray-500 italic">
                            Si no seleccionas ninguno, se incluyen todos los días
                          </p>
                        </div>
                        <Button
                          onClick={selectCustomRange}
                          size="sm"
                          className="w-full bg-orange-600 hover:bg-orange-700 h-7 sm:h-8 md:h-9 text-[10px] sm:text-xs md:text-sm"
                        >
                          Aplicar Selección
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-1.5 border-t">
                    <Label className="text-[10px] sm:text-xs text-muted-foreground mb-1.5 block">Rápido del mes actual:</Label>
                    <div className="grid grid-cols-2 gap-1">
                      <Button variant="outline" size="sm" className="h-6 sm:h-7 md:h-8 text-[10px] sm:text-xs" onClick={() => selectAllWeekday(1)}>Lun</Button>
                      <Button variant="outline" size="sm" className="h-6 sm:h-7 md:h-8 text-[10px] sm:text-xs" onClick={() => selectAllWeekday(2)}>Mar</Button>
                      <Button variant="outline" size="sm" className="h-6 sm:h-7 md:h-8 text-[10px] sm:text-xs" onClick={() => selectAllWeekday(3)}>Mié</Button>
                      <Button variant="outline" size="sm" className="h-6 sm:h-7 md:h-8 text-[10px] sm:text-xs" onClick={() => selectAllWeekday(4)}>Jue</Button>
                      <Button variant="outline" size="sm" className="h-6 sm:h-7 md:h-8 text-[10px] sm:text-xs" onClick={() => selectAllWeekday(5)}>Vie</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Resumen */}
              {config && (
                <Card className="border-2 border-green-500">
                  <CardHeader className="pb-2 bg-green-50 px-3 sm:px-4 md:px-6 py-2 sm:py-3">
                    <CardTitle className="text-xs sm:text-sm md:text-base">Resumen del Pedido</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-2 sm:pt-3 space-y-1.5 text-[10px] sm:text-xs md:text-sm px-3 sm:px-4 md:px-6">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Días:</span>
                      <span className="font-bold">{selectedDates.size}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Estudiantes:</span>
                      <span className="font-bold">{selectedStudents.size}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Precio unitario:</span>
                      <span>S/ {config.lunch_price.toFixed(2)}</span>
                    </div>
                    <div className="pt-1.5 border-t flex justify-between">
                      <span className="font-bold text-xs sm:text-sm md:text-base">TOTAL:</span>
                      <span className="text-base sm:text-lg md:text-xl font-black text-green-600">
                        S/ {calculateTotal().toFixed(2)}
                      </span>
                    </div>
                    <Button
                      onClick={handleSubmitOrders}
                      disabled={submitting || selectedDates.size === 0 || selectedStudents.size === 0}
                      className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 h-10 sm:h-12 md:h-14 text-xs sm:text-sm md:text-base font-black shadow-lg animate-pulse"
                    >
                      {submitting ? (
                        <>Procesando...</>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-1 sm:gap-1.5">
                            <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
                            <span className="hidden md:inline">CONFIRMAR PEDIDO DE ALMUERZOS</span>
                            <span className="md:hidden">CONFIRMAR PEDIDO</span>
                          </div>
                          <span className="text-[9px] sm:text-[10px] md:text-xs font-normal mt-0.5">
                            {selectedDates.size} día(s) • {selectedStudents.size} estudiante(s)
                          </span>
                        </div>
                      )}
                    </Button>
                    
                    {(selectedDates.size > 0 || selectedStudents.size > 0) && (
                      <div className="mt-2 p-2 bg-yellow-50 border-2 border-yellow-300 rounded-lg">
                        <p className="text-[10px] sm:text-xs md:text-sm font-bold text-yellow-900 mb-1">📋 Resumen:</p>
                        <div className="space-y-0.5 text-[9px] sm:text-[10px] md:text-xs text-yellow-800">
                          <p><strong>Estudiantes:</strong> {Array.from(selectedStudents).map(id => students.find(s => s.id === id)?.full_name).join(', ')}</p>
                          <p><strong>Días:</strong> {selectedDates.size} • <strong>Almuerzos:</strong> {selectedDates.size * selectedStudents.size}</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Info de límites */}
              {config && (
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-2 sm:pt-3 text-[9px] sm:text-[10px] md:text-xs space-y-0.5 px-3 sm:px-4 md:px-6">
                    <p className="flex items-center gap-1 text-blue-800">
                      <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      Pedidos hasta {config.order_deadline_time.slice(0, 5)} ({config.order_deadline_days} día(s) antes)
                    </p>
                    <p className="flex items-center gap-1 text-blue-800">
                      <AlertCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      Cancelaciones hasta {config.cancellation_deadline_time.slice(0, 5)}
                    </p>
                  </CardContent>
                </Card>
              )}
            </aside>

            {/* Calendario */}
            <div className="lg:col-span-9">
              <Card className="border-stone-200/50">
                <CardHeader className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
                    <div>
                      <CardTitle className="text-sm sm:text-lg md:text-xl lg:text-2xl">
                        {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                      </CardTitle>
                      <p className="text-[10px] sm:text-xs md:text-sm text-muted-foreground mt-1">
                        Haz clic en los días con menú
                      </p>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <Button variant="outline" size="icon" className="h-7 w-7 sm:h-8 sm:w-8 md:h-10 md:w-10" onClick={handlePreviousMonth}>
                        <ChevronLeft className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 sm:h-8 md:h-10 text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 md:px-4" onClick={() => setCurrentDate(new Date())}>
                        Hoy
                      </Button>
                      <Button variant="outline" size="icon" className="h-7 w-7 sm:h-8 sm:w-8 md:h-10 md:w-10" onClick={handleNextMonth}>
                        <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-1 sm:px-2 md:px-4 lg:px-6">
                  <div className="grid grid-cols-7 gap-0.5 sm:gap-1 md:gap-2">
                    {/* Encabezados */}
                    {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day) => (
                      <div key={day} className="text-center text-[9px] sm:text-[10px] md:text-xs lg:text-sm font-medium text-muted-foreground py-1">
                        {day}
                      </div>
                    ))}

                    {/* Espacios vacíos */}
                    {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square" />
                    ))}

                    {/* Días del mes */}
                    {days.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const hasMenu = menus.has(dateStr);
                      const specialDay = specialDays.get(dateStr);
                      const isSelected = selectedDates.has(dateStr);
                      const hasOrders = existingOrders.has(dateStr);
                      const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));

                      let bgClass = 'bg-white hover:bg-gray-50';
                      let borderClass = 'border-gray-200';

                      if (specialDay) {
                        if (specialDay.type === 'feriado') {
                          bgClass = 'bg-red-100';
                          borderClass = 'border-red-300';
                        } else if (specialDay.type === 'no_laborable') {
                          bgClass = 'bg-gray-200';
                          borderClass = 'border-gray-400';
                        }
                      } else if (hasOrders) {
                        // Días con pedidos existentes: VERDE FUERTE
                        bgClass = 'bg-emerald-200 hover:bg-emerald-300';
                        borderClass = 'border-emerald-500 border-2';
                      } else if (isSelected) {
                        bgClass = 'bg-green-100 hover:bg-green-200';
                        borderClass = 'border-green-500 border-2';
                      } else if (hasMenu) {
                        bgClass = 'bg-blue-50 hover:bg-blue-100';
                        borderClass = 'border-blue-200';
                      }

                      return (
                        <div
                          key={dateStr}
                          className={cn(
                            'aspect-square border rounded-sm sm:rounded-md md:rounded-lg p-0.5 sm:p-1 md:p-2 transition-all',
                            bgClass,
                            borderClass,
                            isToday(day) && 'ring-1 ring-orange-500',
                            isPast && 'opacity-50 cursor-not-allowed',
                            hasOrders && 'cursor-not-allowed',
                            !hasOrders && !isPast && 'cursor-pointer'
                          )}
                          onClick={() => !isPast && !hasOrders && handleDayClick(dateStr)}
                        >
                          <div className="h-full flex flex-col">
                            <div className="flex justify-between items-start">
                              <span className="text-[8px] sm:text-[10px] md:text-xs lg:text-sm font-bold">{day.getDate()}</span>
                              {hasOrders && (
                                <CheckCircle2 className="h-2 w-2 sm:h-2.5 sm:w-2.5 md:h-3 md:w-3 lg:h-4 lg:w-4 text-green-600" />
                              )}
                            </div>
                            
                            <div className="flex-1 flex items-center justify-center">
                              {specialDay ? (
                                <span className="text-[6px] sm:text-[7px] md:text-[8px] lg:text-[10px] font-bold text-center leading-tight">
                                  {specialDay.title}
                                </span>
                              ) : hasMenu ? (
                                <UtensilsCrossed className="h-2.5 w-2.5 sm:h-3 sm:w-3 md:h-4 md:w-4 lg:h-5 lg:w-5 text-blue-600" />
                              ) : (
                                <span className="text-[6px] sm:text-[7px] md:text-[8px] lg:text-[10px] text-muted-foreground text-center hidden md:block">Sin menú</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Leyenda */}
                  <div className="mt-3 sm:mt-4 md:mt-6 pt-2 sm:pt-3 md:pt-4 border-t grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-2 md:gap-3 lg:gap-4 text-[9px] sm:text-[10px] md:text-xs">
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-blue-50 border border-blue-200 rounded"></div>
                      <span>Con menú</span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-green-100 border-2 border-green-500 rounded"></div>
                      <span>Seleccionado</span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-emerald-200 border-2 border-emerald-500 rounded"></div>
                      <span className="font-bold text-emerald-700">Ya pedido</span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-red-100 border border-red-300 rounded"></div>
                      <span>Feriado</span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-gray-200 border border-gray-400 rounded"></div>
                      <span>No laborable</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Modal de Detalle de Menú (también en embedded) */}
        <Dialog open={showMenuDetail} onOpenChange={setShowMenuDetail}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Menú del Día</DialogTitle>
            </DialogHeader>
            {selectedMenuDate && menus.get(selectedMenuDate) && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {format(new Date(selectedMenuDate), "EEEE d 'de' MMMM", { locale: es })}
                </p>
                {(() => {
                  const menu = menus.get(selectedMenuDate)!;
                  return (
                    <div className="space-y-3">
                      {menu.starter && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground">🥗 ENTRADA</p>
                          <p className="text-sm">{menu.starter}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-bold text-green-700">🍲 SEGUNDO</p>
                        <p className="text-sm font-bold">{menu.main_course}</p>
                      </div>
                      {menu.beverage && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground">🥤 BEBIDA</p>
                          <p className="text-sm">{menu.beverage}</p>
                        </div>
                      )}
                      {menu.dessert && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground">🍰 POSTRE</p>
                          <p className="text-sm">{menu.dessert}</p>
                        </div>
                      )}
                      {menu.notes && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground italic">{menu.notes}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowMenuDetail(false)}
                  >
                    Cerrar
                  </Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      if (selectedMenuDate) {
                        toggleDate(selectedMenuDate);
                      }
                      setShowMenuDetail(false);
                    }}
                  >
                    {selectedMenuDate && selectedDates.has(selectedMenuDate) ? 'Quitar' : 'Seleccionar'}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Modo Dialog (modal)
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Calendar className="h-6 w-6 text-green-600" />
            Calendario de Almuerzos - Realizar Pedidos
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Cargando calendario...</p>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">El calendario ahora se muestra directamente en la pestaña Almuerzos</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
