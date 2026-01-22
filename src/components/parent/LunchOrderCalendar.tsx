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
      await Promise.all([
        fetchStudents(),
        fetchMonthlyData()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    const { data, error } = await supabase
      .from('students')
      .select('id, full_name, photo_url, school_id')
      .eq('parent_id', parentId)
      .eq('is_active', true);

    if (error) throw error;
    setStudents(data || []);
    
    // Auto-seleccionar todos los estudiantes
    setSelectedStudents(new Set(data?.map(s => s.id) || []));
  };

  const fetchMonthlyData = async () => {
    if (students.length === 0) return;

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const schoolId = students[0]?.school_id;

    if (!schoolId) return;

    // Fetch configuración
    const { data: configData } = await supabase
      .from('lunch_configuration')
      .select('*')
      .eq('school_id', schoolId)
      .single();

    setConfig(configData);

    // Fetch menús del mes
    const { data: menusData } = await supabase
      .from('lunch_menus')
      .select('*')
      .eq('school_id', schoolId)
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd'))
      .order('date');

    const menusMap = new Map<string, LunchMenu>();
    menusData?.forEach(menu => {
      menusMap.set(menu.date, menu);
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
      .in('student_id', students.map(s => s.id))
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

    setSubmitting(true);
    try {
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

      const { error } = await supabase
        .from('lunch_orders')
        .insert(orders);

      if (error) throw error;

      toast({
        title: '¡Pedidos realizados!',
        description: `Se realizaron ${orders.length} pedido(s) de almuerzo exitosamente`,
      });

      // Recargar datos y limpiar selección
      await fetchMonthlyData();
      setSelectedDates(new Set());
      onClose();
    } catch (error: any) {
      console.error('Error submitting orders:', error);
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Cargando calendario...</p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Panel lateral: Estudiantes y Acciones Rápidas */}
            <aside className="col-span-3 space-y-4">
              {/* Selección de Estudiantes */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Seleccionar Estudiantes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {students.map(student => (
                    <div key={student.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`student-${student.id}`}
                        checked={selectedStudents.has(student.id)}
                        onCheckedChange={() => toggleStudent(student.id)}
                      />
                      <label
                        htmlFor={`student-${student.id}`}
                        className="text-sm cursor-pointer flex items-center gap-2"
                      >
                        {student.photo_url && (
                          <img
                            src={student.photo_url}
                            alt={student.full_name}
                            className="w-6 h-6 rounded-full object-cover"
                          />
                        )}
                        {student.full_name}
                      </label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Acciones Rápidas */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="h-4 w-4 text-orange-500" />
                    Selección Rápida
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={selectAllMonth}
                  >
                    <CalendarDays className="h-4 w-4 mr-2" />
                    Todo el Mes
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={selectFromToday}
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Desde Hoy
                  </Button>
                  
                  {/* Selector inteligente con rango */}
                  <div className="pt-2 border-t">
                    <Button
                      variant={showRangeSelector ? "default" : "outline"}
                      size="sm"
                      className="w-full justify-start mb-2"
                      onClick={() => setShowRangeSelector(!showRangeSelector)}
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      Selección Inteligente
                    </Button>
                    
                    {showRangeSelector && (
                      <div className="space-y-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <div className="space-y-2">
                          <Label className="text-xs font-bold">Desde:</Label>
                          <Input
                            type="date"
                            value={rangeStartDate}
                            onChange={(e) => setRangeStartDate(e.target.value)}
                            className="text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-bold">Hasta:</Label>
                          <Input
                            type="date"
                            value={rangeEndDate}
                            onChange={(e) => setRangeEndDate(e.target.value)}
                            className="text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-bold">Solo estos días (opcional):</Label>
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
                                className="text-xs"
                                onClick={() => toggleWeekday(day)}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                          <p className="text-[10px] text-gray-500 italic">
                            Si no seleccionas ninguno, se incluyen todos los días
                          </p>
                        </div>
                        <Button
                          onClick={selectCustomRange}
                          size="sm"
                          className="w-full bg-orange-600 hover:bg-orange-700"
                        >
                          Aplicar Selección
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-2 border-t">
                    <Label className="text-xs text-muted-foreground mb-2 block">Rápido del mes actual:</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => selectAllWeekday(1)}>Lun</Button>
                      <Button variant="outline" size="sm" onClick={() => selectAllWeekday(2)}>Mar</Button>
                      <Button variant="outline" size="sm" onClick={() => selectAllWeekday(3)}>Mié</Button>
                      <Button variant="outline" size="sm" onClick={() => selectAllWeekday(4)}>Jue</Button>
                      <Button variant="outline" size="sm" onClick={() => selectAllWeekday(5)}>Vie</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Resumen */}
              {config && (
                <Card className="border-2 border-green-500">
                  <CardHeader className="pb-3 bg-green-50">
                    <CardTitle className="text-sm">Resumen del Pedido</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-2 text-sm">
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
                    <div className="pt-2 border-t flex justify-between">
                      <span className="font-bold">TOTAL:</span>
                      <span className="text-xl font-black text-green-600">
                        S/ {calculateTotal().toFixed(2)}
                      </span>
                    </div>
                    <Button
                      onClick={handleSubmitOrders}
                      disabled={submitting || selectedDates.size === 0 || selectedStudents.size === 0}
                      className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 h-16 text-lg font-black shadow-lg animate-pulse"
                    >
                      {submitting ? (
                        <>Procesando...</>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-6 w-6" />
                            <span>CONFIRMAR PEDIDO DE ALMUERZOS</span>
                          </div>
                          <span className="text-xs font-normal mt-1">
                            {selectedDates.size} día(s) para {selectedStudents.size} estudiante(s)
                          </span>
                        </div>
                      )}
                    </Button>
                    
                    {(selectedDates.size > 0 || selectedStudents.size > 0) && (
                      <div className="mt-3 p-3 bg-yellow-50 border-2 border-yellow-300 rounded-lg">
                        <p className="text-sm font-bold text-yellow-900 mb-2">📋 Resumen del Pedido:</p>
                        <div className="space-y-1 text-xs text-yellow-800">
                          <p><strong>Estudiantes:</strong> {Array.from(selectedStudents).map(id => students.find(s => s.id === id)?.full_name).join(', ')}</p>
                          <p><strong>Días seleccionados:</strong> {selectedDates.size}</p>
                          <p><strong>Total de almuerzos:</strong> {selectedDates.size * selectedStudents.size}</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Info de límites */}
              {config && (
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-4 text-xs space-y-1">
                    <p className="flex items-center gap-1 text-blue-800">
                      <Clock className="h-3 w-3" />
                      Pedidos hasta {config.order_deadline_time.slice(0, 5)} ({config.order_deadline_days} día(s) antes)
                    </p>
                    <p className="flex items-center gap-1 text-blue-800">
                      <AlertCircle className="h-3 w-3" />
                      Cancelaciones hasta {config.cancellation_deadline_time.slice(0, 5)}
                    </p>
                  </CardContent>
                </Card>
              )}
            </aside>

            {/* Calendario */}
            <div className="col-span-9">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-2xl">
                        {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        Haz clic en los días con menú para seleccionarlos
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={handlePreviousMonth}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
                        Hoy
                      </Button>
                      <Button variant="outline" size="icon" onClick={handleNextMonth}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-7 gap-2">
                    {/* Encabezados */}
                    {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day) => (
                      <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
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
                            'aspect-square border rounded-lg p-2 transition-all cursor-pointer',
                            bgClass,
                            borderClass,
                            isToday(day) && 'ring-2 ring-orange-500',
                            isPast && 'opacity-50 cursor-not-allowed'
                          )}
                          onClick={() => !isPast && handleDayClick(dateStr)}
                        >
                          <div className="h-full flex flex-col">
                            <div className="flex justify-between items-start">
                              <span className="text-sm font-bold">{day.getDate()}</span>
                              {hasOrders && (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              )}
                            </div>
                            
                            <div className="flex-1 flex items-center justify-center">
                              {specialDay ? (
                                <span className="text-[10px] font-bold text-center">
                                  {specialDay.title}
                                </span>
                              ) : hasMenu ? (
                                <UtensilsCrossed className="h-5 w-5 text-blue-600" />
                              ) : (
                                <span className="text-[10px] text-muted-foreground">Sin menú</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Leyenda */}
                  <div className="mt-6 pt-4 border-t grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-blue-50 border border-blue-200 rounded"></div>
                      <span>Con menú</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-green-100 border-2 border-green-500 rounded"></div>
                      <span>Seleccionado</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-emerald-200 border-2 border-emerald-500 rounded"></div>
                      <span className="font-bold text-emerald-700">Ya pedido</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                      <span>Feriado</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-gray-200 border border-gray-400 rounded"></div>
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
