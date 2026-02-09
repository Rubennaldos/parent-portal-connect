import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { 
  Calendar, 
  UtensilsCrossed, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle,
  Search,
  Filter,
  Loader2,
  Eye,
  Trash2,
  Download,
  PackagePlus
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LunchOrderActionsModal } from '@/components/lunch/LunchOrderActionsModal';

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
  is_cancelled: boolean;
  cancelled_by: string | null;
  student_id: string | null;
  teacher_id: string | null;
  manual_name: string | null;
  payment_method: string | null;
  payment_details: any;
  menu_id: string | null;
  school?: {
    name: string;
    code: string;
  };
  student?: {
    full_name: string;
    photo_url: string | null;
    is_temporary: boolean;
    temporary_classroom_name: string | null;
    school_id: string;
    free_account: boolean | null;
  };
  teacher?: {
    full_name: string;
    school_id_1: string;
  };
  lunch_menus?: {
    starter: string | null;
    main_course: string | null;
    beverage: string | null;
    dessert: string | null;
    notes: string | null;
    category_id: string | null;
    lunch_categories?: {
      name: string;
      icon: string | null;
    };
  };
}

interface School {
  id: string;
  name: string;
  code: string;
}

export default function LunchOrders() {
  const { user } = useAuth();
  const { role, canViewAllSchools, loading: roleLoading } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<LunchOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<LunchOrder[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  
  // Fecha por defecto: basada en configuración de entrega
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [defaultDeliveryDate, setDefaultDeliveryDate] = useState<string>('');
  
  // Filtros de rango de fechas para auditoría
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isDateRangeMode, setIsDateRangeMode] = useState(false);
  
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedOrderForAction, setSelectedOrderForAction] = useState<LunchOrder | null>(null);
  const [showActionsModal, setShowActionsModal] = useState(false);
  const [showMenuDetails, setShowMenuDetails] = useState(false);
  const [selectedMenuOrder, setSelectedMenuOrder] = useState<LunchOrder | null>(null);
  
  // Estados para anulación de pedidos
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showPasswordValidation, setShowPasswordValidation] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [pendingCancelOrder, setPendingCancelOrder] = useState<LunchOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [lunchConfig, setLunchConfig] = useState<{ cancellation_deadline_time?: string; cancellation_deadline_days?: number } | null>(null);

  useEffect(() => {
    if (!roleLoading && role && user) {
      fetchConfigAndInitialize();
    }
  }, [role, roleLoading, user]);

  useEffect(() => {
    if (selectedDate && !isDateRangeMode) {
      fetchOrders();
    }
  }, [selectedDate]);

  useEffect(() => {
    if (isDateRangeMode && startDate && endDate) {
      fetchOrders();
    }
  }, [isDateRangeMode, startDate, endDate]);

  useEffect(() => {
    filterOrders();
  }, [orders, selectedSchool, selectedStatus, searchTerm]);

  const fetchConfigAndInitialize = async () => {
    try {
      console.log('📅 Cargando configuración de entrega...');
      
      // Obtener configuración de lunch
      const { data: profileData } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user?.id)
        .single();

      const schoolId = profileData?.school_id;

      if (schoolId) {
        // Si el usuario tiene una sede asignada y NO puede ver todas las sedes, 
        // configurar automáticamente el filtro a su sede
        if (!canViewAllSchools) {
          setSelectedSchool(schoolId);
          console.log('🏫 Admin de sede: filtrando automáticamente por su sede:', schoolId);
        }

        const { data: config, error: configError } = await supabase
          .from('lunch_configuration')
          .select('delivery_end_time, cancellation_deadline_time, cancellation_deadline_days')
          .eq('school_id', schoolId)
          .maybeSingle();

        if (configError) {
          console.error('Error cargando configuración:', configError);
        }

        // Guardar configuración para usar en canModifyOrder
        if (config) {
          setLunchConfig({
            cancellation_deadline_time: config.cancellation_deadline_time,
            cancellation_deadline_days: config.cancellation_deadline_days
          });
        }

        console.log('🕐 Configuración de entrega:', config);

        // Calcular fecha por defecto basada en la hora de CORTE (delivery_end_time)
        const now = new Date();
        const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
        const currentHour = peruTime.getHours();
        const currentMinute = peruTime.getMinutes();
        
        // Convertir delivery_end_time a horas y minutos (ej: "17:00:00" -> 17:00)
        const deliveryEndHour = config?.delivery_end_time 
          ? parseInt(config.delivery_end_time.split(':')[0]) 
          : 17; // Default 5 PM
        const deliveryEndMinute = config?.delivery_end_time 
          ? parseInt(config.delivery_end_time.split(':')[1]) 
          : 0;

        // Si ya pasó la hora de corte, mostrar pedidos de mañana
        // Si no ha pasado, mostrar pedidos de hoy
        let defaultDate = new Date(peruTime);
        const currentTotalMinutes = currentHour * 60 + currentMinute;
        const cutoffTotalMinutes = deliveryEndHour * 60 + deliveryEndMinute;
        
        if (currentTotalMinutes >= cutoffTotalMinutes) {
          defaultDate.setDate(defaultDate.getDate() + 1);
          console.log('⏰ Ya pasó la hora de corte, mostrando pedidos del día siguiente');
        } else {
          console.log('⏰ Aún no es hora de corte, mostrando pedidos de hoy');
        }

        const formattedDate = format(defaultDate, 'yyyy-MM-dd');
        console.log('📅 Fecha por defecto calculada:', formattedDate);
        console.log('⏰ Hora de corte configurada:', `${deliveryEndHour}:${String(deliveryEndMinute).padStart(2, '0')}`);
        
        setDefaultDeliveryDate(formattedDate);
        setSelectedDate(formattedDate);
      } else {
        // Si no tiene school_id (admin general), usar mañana por defecto
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const formattedDate = format(tomorrow, 'yyyy-MM-dd');
        setDefaultDeliveryDate(formattedDate);
        setSelectedDate(formattedDate);
      }

      await fetchSchools();
    } catch (error: any) {
      console.error('Error inicializando:', error);
      // En caso de error, usar mañana como fallback
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const formattedDate = format(tomorrow, 'yyyy-MM-dd');
      setDefaultDeliveryDate(formattedDate);
      setSelectedDate(formattedDate);
      setLoading(false);
    }
  };

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
      
      // Si está en modo de rango de fechas, obtener pedidos en ese rango
      if (isDateRangeMode && startDate && endDate) {
        console.log('📅 Cargando pedidos de almuerzo desde:', startDate, 'hasta:', endDate);
        
        let query = supabase
          .from('lunch_orders')
          .select(`
            *,
            school:schools!lunch_orders_school_id_fkey (
              name,
              code
            ),
            student:students (
              full_name,
              photo_url,
              is_temporary,
              temporary_classroom_name,
              school_id,
              free_account
            ),
            teacher:teacher_profiles (
              full_name,
              school_id_1
            ),
            lunch_menus (
              starter,
              main_course,
              beverage,
              dessert,
              notes,
              category_id
            )
          `)
          .gte('order_date', startDate)
          .lte('order_date', endDate)
          .eq('is_cancelled', false)
          .order('order_date', { ascending: false })
          .order('created_at', { ascending: false });

        const { data, error } = await query;
        
        if (error) {
          console.error('❌ ERROR EN QUERY:', error);
          throw error;
        }
        
        console.log('✅ Pedidos cargados (rango):', data?.length || 0);
        
        // Cargar categorías para los menús que tengan category_id
        if (data && data.length > 0) {
          const categoryIds = data
            .map(order => order.lunch_menus?.category_id)
            .filter((id): id is string => id !== null && id !== undefined);
          
          if (categoryIds.length > 0) {
            const { data: categories, error: catError } = await supabase
              .from('lunch_categories')
              .select('id, name')
              .in('id', categoryIds);
            
            if (!catError && categories) {
              const categoryMap = new Map(categories.map(cat => [cat.id, cat.name]));
              data.forEach(order => {
                if (order.lunch_menus?.category_id) {
                  order.lunch_menus.category_name = categoryMap.get(order.lunch_menus.category_id);
                }
              });
            }
          }
        }
        
        setOrders(data || []);
        setLoading(false);
        return;
      }
      
      // Modo normal: una sola fecha
      console.log('📅 Cargando pedidos de almuerzo para:', selectedDate);
      console.log('👤 Usuario:', user?.id);
      console.log('🎭 Rol:', role);

      let query = supabase
        .from('lunch_orders')
        .select(`
          *,
          school:schools!lunch_orders_school_id_fkey (
            name,
            code
          ),
          student:students (
            full_name,
            photo_url,
            is_temporary,
            temporary_classroom_name,
            school_id,
            free_account
          ),
          teacher:teacher_profiles (
            full_name,
            school_id_1
          ),
          lunch_menus (
            starter,
            main_course,
            beverage,
            dessert,
            notes,
            category_id
          )
        `)
        .eq('order_date', selectedDate)
        .eq('is_cancelled', false) // 🚫 SOLO traer los que son explícitamente false
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      
      if (error) {
        console.error('❌ ERROR EN QUERY:', error);
        throw error;
      }
      
      console.log('✅ Pedidos cargados:', data?.length || 0);
      console.log('🔍 [DEBUG] Pedidos con is_cancelled:', data?.map(o => ({
        nombre: o.student?.full_name || o.teacher?.full_name || o.manual_name,
        is_cancelled: o.is_cancelled,
        status: o.status
      })));
      
      // DEBUG: Ver qué pedidos tienen menú
      data?.forEach((order, index) => {
        console.log(`Pedido ${index + 1}:`, {
          id: order.id,
          student: order.student?.full_name,
          teacher: order.teacher?.full_name,
          manual_name: order.manual_name,
          menu_id: order.menu_id,
          tiene_menu: !!order.lunch_menus,
          menu: order.lunch_menus
        });
      });
      
      // Cargar categorías para los menús que tengan category_id
      if (data && data.length > 0) {
        const categoryIds = data
          .map(order => order.lunch_menus?.category_id)
          .filter((id): id is string => id !== null && id !== undefined);
        
        if (categoryIds.length > 0) {
          const { data: categories } = await supabase
            .from('lunch_categories')
            .select('id, name, icon')
            .in('id', categoryIds);
          
          // Mapear categorías a los menús
          const categoriesMap = new Map(categories?.map(c => [c.id, c]) || []);
          
          data.forEach(order => {
            if (order.lunch_menus && order.lunch_menus.category_id) {
              const category = categoriesMap.get(order.lunch_menus.category_id);
              if (category) {
                order.lunch_menus.lunch_categories = category;
              }
            }
          });
        }
      }
      
      setOrders(data || []);
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

    // Ya no es necesario filtrar por is_cancelled aquí porque lo hacemos en la query SQL
    // Los pedidos anulados nunca llegan a este punto

    // Filtrar por sede
    if (selectedSchool !== 'all') {
      filtered = filtered.filter(order => {
        // Incluir pedidos de estudiantes de la sede seleccionada
        if (order.student?.school_id === selectedSchool) return true;
        // Incluir pedidos de profesores de la sede seleccionada
        if (order.teacher?.school_id_1 === selectedSchool) return true;
        // EXCLUIR pedidos manuales cuando se ha seleccionado una sede específica
        // Los pedidos manuales no tienen school_id asociado, por lo que no pertenecen a ninguna sede
        return false;
      });
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
        order.manual_name?.toLowerCase().includes(term) ||
        order.student?.temporary_classroom_name?.toLowerCase().includes(term)
      );
    }

    setFilteredOrders(filtered);
  };

  const canModifyOrder = () => {
    // Si no hay configuración, usar 9 AM por defecto
    if (!lunchConfig || !lunchConfig.cancellation_deadline_time) {
      const now = new Date();
      const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const currentHour = peruTime.getHours();
      return currentHour < 9;
    }

    // Usar la configuración de cancellation_deadline_time
    const now = new Date();
    const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const currentTime = peruTime.getHours() * 60 + peruTime.getMinutes(); // Minutos desde medianoche
    
    // Parsear la hora de la configuración (ej: "09:00:00" -> 540 minutos)
    const [deadlineHour, deadlineMinute] = lunchConfig.cancellation_deadline_time.split(':').map(Number);
    const deadlineTime = deadlineHour * 60 + deadlineMinute;
    
    // Verificar si ya pasó la hora límite
    return currentTime < deadlineTime;
  };

  const getDeadlineTime = () => {
    if (!lunchConfig || !lunchConfig.cancellation_deadline_time) {
      return '9:00 AM';
    }
    const [hour, minute] = lunchConfig.cancellation_deadline_time.split(':');
    const hourNum = parseInt(hour);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    return `${displayHour}:${minute.padStart(2, '0')} ${ampm}`;
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

  // ========================================
  // FUNCIONES DE CONFIRMACIÓN Y ENTREGA
  // ========================================

  const handleConfirmOrder = async (order: LunchOrder) => {
    try {
      setLoading(true);
      console.log('✅ Confirmando pedido:', order.id);

      // Actualizar status a confirmed
      const { error: updateError } = await supabase
        .from('lunch_orders')
        .update({ status: 'confirmed' })
        .eq('id', order.id);

      if (updateError) throw updateError;

      // Crear transacción si es necesario (crédito o pagar luego)
      let needsTransaction = false;
      let transactionData: any = {
        type: 'purchase',
        payment_status: 'pending',
        school_id: order.school_id || order.student?.school_id || order.teacher?.school_id_1,
      };

      // Determinar si necesita transacción y el monto
      if (order.student_id) {
        // Es estudiante - verificar si tiene cuenta libre
        const { data: studentData } = await supabase
          .from('students')
          .select('free_account, school_id')
          .eq('id', order.student_id)
          .single();

        if (studentData?.free_account === true) {
          needsTransaction = true;
          transactionData.student_id = order.student_id;
          
          // Obtener precio desde categoría o configuración
          const { data: category } = await supabase
            .from('lunch_categories')
            .select('price')
            .eq('id', order.category_id || '')
            .single();
          
          const { data: config } = await supabase
            .from('lunch_configuration')
            .select('lunch_price')
            .eq('school_id', studentData.school_id)
            .single();

          const price = category?.price || config?.lunch_price || 7.50;
          transactionData.amount = -Math.abs(price);
          transactionData.description = `Almuerzo - ${format(new Date(order.order_date), "d 'de' MMMM", { locale: es })}`;
        }
      } else if (order.teacher_id) {
        // Es profesor - siempre crear transacción
        // Primero obtener el school_id del profesor
        const { data: teacherData } = await supabase
          .from('teacher_profiles')
          .select('school_id_1')
          .eq('id', order.teacher_id)
          .single();

        const teacherSchoolId = teacherData?.school_id_1 || order.teacher?.school_id_1 || order.school_id;
        
        needsTransaction = true;
        transactionData.teacher_id = order.teacher_id;
        transactionData.school_id = teacherSchoolId;
        
        // Obtener precio desde categoría o configuración
        const { data: category } = await supabase
          .from('lunch_categories')
          .select('price')
          .eq('id', order.category_id || '')
          .single();
        
        const { data: config } = await supabase
          .from('lunch_configuration')
          .select('lunch_price')
          .eq('school_id', teacherSchoolId || '')
          .single();

        const price = category?.price || config?.lunch_price || 7.50;
        transactionData.amount = -Math.abs(price);
        transactionData.description = `Almuerzo - ${format(new Date(order.order_date), "d 'de' MMMM", { locale: es })}`;
      } else if (order.manual_name && order.payment_method === 'pagar_luego') {
        // Cliente manual con "pagar luego"
        needsTransaction = true;
        transactionData.manual_client_name = order.manual_name;
        
        const { data: category } = await supabase
          .from('lunch_categories')
          .select('price')
          .eq('id', order.category_id || '')
          .single();

        const price = category?.price || 7.50;
        transactionData.amount = -Math.abs(price);
        transactionData.description = `Almuerzo - ${format(new Date(order.order_date), "d 'de' MMMM", { locale: es })} - ${order.manual_name}`;
      }

      // Crear transacción si es necesario
      if (needsTransaction) {
        const { error: transactionError } = await supabase
          .from('transactions')
          .insert([transactionData]);

        if (transactionError) {
          console.error('⚠️ Error creando transacción:', transactionError);
          // No lanzar error, el pedido ya se confirmó
        } else {
          console.log('✅ Transacción creada para pedido confirmado');
        }
      }

      toast({
        title: '✅ Pedido confirmado',
        description: 'El pedido ha sido confirmado y aparecerá en cobranzas si aplica',
      });

      fetchOrders();
    } catch (error: any) {
      console.error('❌ Error confirmando pedido:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo confirmar el pedido',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeliverOrder = async (order: LunchOrder) => {
    try {
      setLoading(true);
      console.log('📦 Marcando pedido como entregado:', order.id);

      const { error } = await supabase
        .from('lunch_orders')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          delivered_by: user?.id
        })
        .eq('id', order.id);

      if (error) throw error;

      toast({
        title: '✅ Pedido entregado',
        description: 'El pedido ha sido marcado como entregado',
      });

      fetchOrders();
    } catch (error: any) {
      console.error('❌ Error entregando pedido:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo marcar como entregado',
      });
    } finally {
      setLoading(false);
    }
  };

  // Función para obtener el estado de deuda
  const getDebtStatus = (order: LunchOrder): { label: string; color: string } => {
    // Si es cliente manual con "pagar luego"
    if (order.manual_name && order.payment_method === 'pagar_luego') {
      return { label: '💰 Pagar luego', color: 'bg-yellow-50 text-yellow-700 border-yellow-300' };
    }
    
    // Si es cliente manual con pago inmediato
    if (order.manual_name && order.payment_method && order.payment_method !== 'pagar_luego') {
      return { label: '✅ Pagado', color: 'bg-green-50 text-green-700 border-green-300' };
    }
    
    // Si es estudiante, verificar tipo de cuenta
    if (order.student_id && order.student) {
      if (order.student.free_account === true) {
        return { label: '💳 Crédito', color: 'bg-blue-50 text-blue-700 border-blue-300' };
      } else {
        return { label: '✅ Pagado', color: 'bg-green-50 text-green-700 border-green-300' };
      }
    }
    
    // Si es profesor, siempre es crédito
    if (order.teacher_id) {
      return { label: '💳 Crédito', color: 'bg-blue-50 text-blue-700 border-blue-300' };
    }
    
    return { label: '⏳ Pendiente', color: 'bg-gray-50 text-gray-700 border-gray-300' };
  };

  const handleViewMenu = (order: LunchOrder) => {
    setSelectedMenuOrder(order);
    setShowMenuDetails(true);
  };

  // ========================================
  // FUNCIONES DE ANULACIÓN DE PEDIDOS
  // ========================================
  
  const handleOpenCancel = (order: LunchOrder) => {
    console.log('🗑️ [handleOpenCancel] Intentando anular pedido');
    console.log('👤 [handleOpenCancel] Rol del usuario:', role);
    
    const isCajero = role === 'operador_caja' || role === 'cajero';
    console.log('💼 [handleOpenCancel] ¿Es cajero?:', isCajero);
    
    if (isCajero) {
      // Si es cajero, primero pedir contraseña
      setPendingCancelOrder(order);
      setAdminPassword('');
      setShowPasswordValidation(true);
    } else {
      // Si es admin, ir directo al motivo
      setPendingCancelOrder(order);
      setCancelReason('');
      setShowCancelModal(true);
    }
  };
  
  const handlePasswordValidated = async () => {
    if (!adminPassword.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes ingresar tu contraseña',
      });
      return;
    }
    
    try {
      setCancelling(true);
      
      // Validar contraseña del admin
      const { data, error } = await supabase.rpc('validate_admin_password', {
        p_admin_id: user?.id,
        p_password: adminPassword
      });
      
      if (error) throw error;
      
      if (!data) {
        toast({
          variant: 'destructive',
          title: 'Contraseña incorrecta',
          description: 'La contraseña del administrador no es válida',
        });
        return;
      }
      
      // Si la contraseña es correcta, mostrar modal de motivo
      setShowPasswordValidation(false);
      setAdminPassword('');
      setCancelReason('');
      setShowCancelModal(true);
      
    } catch (error: any) {
      console.error('Error validando contraseña:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo validar la contraseña',
      });
    } finally {
      setCancelling(false);
    }
  };
  
  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes ingresar un motivo de anulación',
      });
      return;
    }
    
    if (!pendingCancelOrder) return;
    
    try {
      setCancelling(true);
      
      console.log('🚫 [ANULAR] Iniciando anulación...');
      console.log('📋 [ANULAR] Pedido completo:', pendingCancelOrder);
      console.log('🆔 [ANULAR] ID del pedido:', pendingCancelOrder.id);
      console.log('👤 [ANULAR] Usuario actual:', user?.id);
      console.log('📝 [ANULAR] Motivo:', cancelReason.trim());
      
      // Anular el pedido
      const { error: updateError } = await supabase
        .from('lunch_orders')
        .update({
          is_cancelled: true,
          cancellation_reason: cancelReason.trim(),
          cancelled_by: user?.id,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', pendingCancelOrder.id);
      
      if (updateError) {
        console.error('❌ [ANULAR] Error al actualizar:', updateError);
        throw updateError;
      }
      
      console.log('✅ [ANULAR] Pedido actualizado en BD');
      
      // 💰 Si el pedido fue con crédito (tiene student_id o teacher_id), devolver el crédito
      if (pendingCancelOrder.student_id || pendingCancelOrder.teacher_id) {
        console.log('💰 Buscando transacción asociada para devolver crédito...');
        console.log('📋 Datos del pedido:', {
          id: pendingCancelOrder.id,
          student_id: pendingCancelOrder.student_id,
          teacher_id: pendingCancelOrder.teacher_id,
          order_date: pendingCancelOrder.order_date
        });
        
        // Buscar la transacción de compra asociada por student_id o teacher_id
        let query = supabase
          .from('transactions')
          .select('id, amount, student_id, teacher_id, description, created_at')
          .eq('type', 'purchase')
          .eq('payment_status', 'pending');
        
        // Filtrar por student_id o teacher_id según corresponda
        if (pendingCancelOrder.student_id) {
          query = query.eq('student_id', pendingCancelOrder.student_id);
        } else if (pendingCancelOrder.teacher_id) {
          query = query.eq('teacher_id', pendingCancelOrder.teacher_id);
        }
        
        // Filtrar por fecha del pedido en la descripción
        query = query.ilike('description', `%${pendingCancelOrder.order_date}%`);
        
        const { data: transactions, error: transError } = await query;
        
        console.log('🔍 Transacciones encontradas:', transactions);
        
        if (transError) {
          console.error('❌ Error buscando transacción:', transError);
        } else if (transactions && transactions.length > 0) {
          const transaction = transactions[0];
          console.log('✅ Transacción encontrada:', transaction);
          
          // Anular la transacción (eliminarla para devolver el crédito)
          const { error: deleteTransError } = await supabase
            .from('transactions')
            .delete()
            .eq('id', transaction.id);
          
          if (deleteTransError) {
            console.error('❌ Error anulando transacción:', deleteTransError);
          } else {
            console.log('✅ Transacción eliminada, crédito devuelto automáticamente');
          }
        } else {
          console.log('⚠️ No se encontró transacción asociada (puede ser un pago físico o ya fue pagado)');
        }
      }
      
      toast({
        title: '✅ Pedido anulado',
        description: pendingCancelOrder.student_id || pendingCancelOrder.teacher_id 
          ? 'El pedido ha sido anulado y el crédito devuelto' 
          : 'El pedido ha sido anulado correctamente',
      });
      
      // Cerrar modales y limpiar estados
      setShowCancelModal(false);
      setCancelReason('');
      setPendingCancelOrder(null);
      
      console.log('🔄 [ANULAR] Recargando pedidos...');
      // Recargar pedidos
      await fetchOrders();
      console.log('✅ [ANULAR] Pedidos recargados');
      
    } catch (error: any) {
      console.error('💥 [ANULAR] Error fatal:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo anular el pedido',
      });
    } finally {
      setCancelling(false);
    }
  };

  // ========================================
  // FUNCIÓN DE EXPORTACIÓN A PDF
  // ========================================
  
  const exportToPDF = () => {
    try {
      const doc = new jsPDF('l', 'mm', 'a4'); // Landscape para más espacio
      
      // Título del documento
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('REPORTE DE PEDIDOS DE ALMUERZO', doc.internal.pageSize.width / 2, 15, { align: 'center' });
      
      // Información de filtros
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      
      let filterText = '';
      if (isDateRangeMode && startDate && endDate) {
        filterText = `Período: ${format(new Date(startDate), 'dd/MM/yyyy', { locale: es })} - ${format(new Date(endDate), 'dd/MM/yyyy', { locale: es })}`;
      } else {
        filterText = `Fecha: ${format(new Date(selectedDate), 'dd/MM/yyyy', { locale: es })}`;
      }
      
      if (selectedSchool !== 'all') {
        const school = schools.find(s => s.id === selectedSchool);
        filterText += ` | Sede: ${school?.name || 'N/A'}`;
      }
      
      if (selectedStatus !== 'all') {
        const statusLabels: Record<string, string> = {
          confirmed: 'Confirmado',
          delivered: 'Entregado',
          cancelled: 'Anulado',
          postponed: 'Postergado',
          pending_payment: 'Pendiente de pago'
        };
        filterText += ` | Estado: ${statusLabels[selectedStatus] || selectedStatus}`;
      }
      
      doc.text(filterText, 15, 25);
      doc.text(`Generado: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })}`, 15, 30);
      
      // Preparar datos para la tabla
      const tableData = filteredOrders.map(order => {
        const clientName = order.student?.full_name || order.teacher?.full_name || order.manual_name || 'N/A';
        const schoolName = order.school?.name || (order.student?.school_id ? schools.find(s => s.id === order.student?.school_id)?.name : null) || 'N/A';
        const orderDate = format(new Date(order.order_date), 'dd/MM/yyyy', { locale: es });
        const orderTime = new Date(order.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
        
        const statusLabels: Record<string, string> = {
          pending: 'Pendiente',
          confirmed: 'Confirmado',
          delivered: 'Entregado',
          cancelled: 'Anulado',
          postponed: 'Postergado',
          pending_payment: 'Pend. Pago'
        };
        const status = statusLabels[order.status] || order.status;
        
        const debtInfo = getDebtStatus(order);
        const paymentStatus = debtInfo.label.replace(/[💰✅💳⏳]/g, '').trim();
        
        const menuCategory = order.lunch_menus?.category_name || 'Menú del día';
        
        return [
          clientName,
          schoolName,
          orderDate,
          orderTime,
          status,
          paymentStatus,
          menuCategory
        ];
      });
      
      // Crear tabla con autoTable
      autoTable(doc, {
        head: [['Cliente', 'Sede', 'Fecha Pedido', 'Hora', 'Estado', 'Pago', 'Categoría Menú']],
        body: tableData,
        startY: 35,
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [59, 130, 246], // Blue-600
          textColor: 255,
          fontStyle: 'bold',
          halign: 'center'
        },
        alternateRowStyles: {
          fillColor: [249, 250, 251] // Gray-50
        },
        columnStyles: {
          0: { cellWidth: 45 }, // Cliente
          1: { cellWidth: 40 }, // Sede
          2: { cellWidth: 25 }, // Fecha
          3: { cellWidth: 20 }, // Hora
          4: { cellWidth: 25 }, // Estado
          5: { cellWidth: 25 }, // Pago
          6: { cellWidth: 40 }  // Categoría
        },
        margin: { left: 15, right: 15 },
      });
      
      // Footer con branding
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(128, 128, 128);
        doc.text(
          'Este es un reporte interno generado • © 2026 ERP Profesional diseñado por ARQUISIA Soluciones para Lima Café 28',
          doc.internal.pageSize.width / 2,
          doc.internal.pageSize.height - 10,
          { align: 'center' }
        );
        doc.text(
          `Página ${i} de ${pageCount}`,
          doc.internal.pageSize.width - 15,
          doc.internal.pageSize.height - 10,
          { align: 'right' }
        );
      }
      
      // Descargar el PDF
      const fileName = isDateRangeMode 
        ? `Pedidos_Almuerzo_${format(new Date(startDate), 'ddMMyyyy')}_${format(new Date(endDate), 'ddMMyyyy')}.pdf`
        : `Pedidos_Almuerzo_${format(new Date(selectedDate), 'ddMMyyyy')}.pdf`;
      
      doc.save(fileName);
      
      toast({
        title: '✅ PDF generado',
        description: 'El reporte ha sido descargado exitosamente',
      });
    } catch (error: any) {
      console.error('Error generando PDF:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo generar el PDF',
      });
    }
  };

  if (loading || roleLoading) {
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
          {/* Botón de Exportar PDF */}
          <Button
            variant="outline"
            onClick={exportToPDF}
            disabled={filteredOrders.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Exportar PDF
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
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            {/* Filtro de Fecha/Rango - ocupa 2 columnas */}
            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-2 block">
                Filtro de Fecha
              </label>
              
              {/* Toggle para cambiar entre fecha única y rango */}
              <div className="flex gap-2 mb-2">
                <Button
                  size="sm"
                  variant={!isDateRangeMode ? 'default' : 'outline'}
                  onClick={() => setIsDateRangeMode(false)}
                  className="flex-1"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Fecha Única
                </Button>
                <Button
                  size="sm"
                  variant={isDateRangeMode ? 'default' : 'outline'}
                  onClick={() => setIsDateRangeMode(true)}
                  className="flex-1"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Rango de Fechas
                </Button>
              </div>
              
              {/* Inputs según el modo */}
              {!isDateRangeMode ? (
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full"
                  />
                  {selectedDate !== defaultDeliveryDate && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedDate(defaultDeliveryDate)}
                      className="whitespace-nowrap"
                      title="Volver a fecha de entrega configurada"
                    >
                      <Calendar className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Desde</label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Hasta</label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Sede */}
            {canViewAllSchools && (
              <div className="md:col-span-1">
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
            <div className="md:col-span-1">
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
            <div className="md:col-span-2">
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
                Después de las {getDeadlineTime()} - Solo lectura
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
                  onClick={() => order.lunch_menus && handleViewMenu(order)}
                  className={cn(
                    "flex items-center justify-between p-4 border rounded-lg transition-colors",
                    order.lunch_menus && "cursor-pointer hover:bg-blue-50 hover:border-blue-300"
                  )}
                >
                  <div className="flex items-center gap-4 flex-1">
                    {/* Foto o inicial */}
                    <div className="relative">
                      {order.student?.photo_url ? (
                        <img
                          src={order.student.photo_url}
                          alt={order.student.full_name}
                          className="h-14 w-14 rounded-full object-cover border-2 border-blue-200"
                        />
                      ) : (
                        <div className={cn(
                          "h-14 w-14 rounded-full flex items-center justify-center border-2",
                          order.teacher ? "bg-green-100 border-green-300" : "bg-blue-100 border-blue-200"
                        )}>
                          <span className={cn(
                            "font-bold text-xl",
                            order.teacher ? "text-green-700" : "text-blue-600"
                          )}>
                            {order.student?.full_name[0] || order.teacher?.full_name[0] || order.manual_name?.[0] || '?'}
                          </span>
                        </div>
                      )}
                      {order.student?.is_temporary && (
                        <div className="absolute -top-1 -right-1 bg-purple-600 rounded-full p-1">
                          <UserPlus className="h-3 w-3 text-white" />
                        </div>
                      )}
                      {order.teacher && (
                        <div className="absolute -bottom-1 -right-1 bg-green-600 rounded-full p-1">
                          <span className="text-white text-[10px] font-bold px-1">👨‍🏫</span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-lg text-gray-900">
                          {order.student?.full_name || order.teacher?.full_name || order.manual_name || 'Desconocido'}
                        </p>
                        {order.school && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300 text-xs">
                            🏫 {order.school.name}
                          </Badge>
                        )}
                        {order.teacher && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-xs">
                            Profesor
                          </Badge>
                        )}
                        {order.manual_name && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-xs">
                            💵 Pago Físico
                          </Badge>
                        )}
                        {order.student && !order.student.is_temporary && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-xs">
                            Alumno
                          </Badge>
                        )}
                      </div>
                      {order.student?.is_temporary && order.student.temporary_classroom_name && (
                        <p className="text-sm font-medium text-purple-600">
                          🎫 Puente Temporal - {order.student.temporary_classroom_name}
                        </p>
                      )}
                      <p className="text-sm text-gray-500">
                        Pedido a las {new Date(order.created_at).toLocaleTimeString('es-PE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'America/Lima'
                        })}
                      </p>
                    </div>

                    {/* Estado y Estado de Deuda */}
                    <div className="flex flex-col gap-2 items-end">
                      {getStatusBadge(order.status, order.is_no_order_delivery)}
                      {(() => {
                        const debtStatus = getDebtStatus(order);
                        return (
                          <Badge variant="outline" className={cn("text-xs", debtStatus.color)}>
                            {debtStatus.label}
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    {/* Botón Confirmar - Solo para pedidos pendientes */}
                    {order.status === 'pending' && !order.is_cancelled && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleConfirmOrder(order)}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Confirmar
                      </Button>
                    )}

                    {/* Botón Entregado - Solo para pedidos confirmados */}
                    {order.status === 'confirmed' && !order.is_cancelled && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleDeliverOrder(order)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <PackagePlus className="h-4 w-4 mr-1" />
                        Entregado
                      </Button>
                    )}

                    {/* Botón Anular (siempre visible excepto si está cancelado) */}
                    {!order.is_cancelled && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleOpenCancel(order)}
                        className="gap-1"
                      >
                        <Trash2 className="h-4 w-4" />
                        Anular
                      </Button>
                    )}
                    
                    {/* Badge de "Anulado" si está cancelado */}
                    {order.is_cancelled && (
                      <Badge variant="destructive" className="text-xs">
                        ❌ ANULADO
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      {selectedOrderForAction && (
        <LunchOrderActionsModal
          isOpen={showActionsModal}
          onClose={() => setShowActionsModal(false)}
          order={selectedOrderForAction}
          onSuccess={handleActionComplete}
          canModify={canModifyOrder()}
        />
      )}

      {/* Modal de Detalles del Menú */}
      {selectedMenuOrder && selectedMenuOrder.lunch_menus && (
        <Dialog open={showMenuDetails} onOpenChange={setShowMenuDetails}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <UtensilsCrossed className="h-6 w-6 text-blue-600" />
                Detalles del Pedido
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* DATOS DE QUIÉN HIZO EL PEDIDO */}
              <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    👤 Información del Cliente
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-4">
                    {/* Foto o inicial */}
                    {selectedMenuOrder.student?.photo_url ? (
                      <img
                        src={selectedMenuOrder.student.photo_url}
                        alt={selectedMenuOrder.student.full_name}
                        className="h-16 w-16 rounded-full object-cover border-2 border-blue-300"
                      />
                    ) : (
                      <div className={cn(
                        "h-16 w-16 rounded-full flex items-center justify-center border-2",
                        selectedMenuOrder.teacher ? "bg-green-100 border-green-300" : "bg-blue-100 border-blue-300"
                      )}>
                        <span className={cn(
                          "font-bold text-2xl",
                          selectedMenuOrder.teacher ? "text-green-700" : "text-blue-600"
                        )}>
                          {selectedMenuOrder.student?.full_name[0] || selectedMenuOrder.teacher?.full_name[0] || selectedMenuOrder.manual_name?.[0] || '?'}
                        </span>
                      </div>
                    )}
                    
                    <div className="flex-1">
                      <p className="text-xl font-bold text-gray-900">
                        {selectedMenuOrder.student?.full_name || selectedMenuOrder.teacher?.full_name || selectedMenuOrder.manual_name || 'Desconocido'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {selectedMenuOrder.teacher && (
                          <Badge className="bg-green-600">👨‍🏫 Profesor</Badge>
                        )}
                        {selectedMenuOrder.student && !selectedMenuOrder.student.is_temporary && (
                          <Badge className="bg-blue-600">👨‍🎓 Alumno</Badge>
                        )}
                        {selectedMenuOrder.student?.is_temporary && (
                          <Badge className="bg-purple-600">🎫 Puente Temporal</Badge>
                        )}
                        {selectedMenuOrder.manual_name && (
                          <Badge className="bg-orange-600">💵 Pago Físico</Badge>
                        )}
                        {selectedMenuOrder.school && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                            🏫 {selectedMenuOrder.school.name}
                          </Badge>
                        )}
                      </div>
                      {selectedMenuOrder.student?.is_temporary && selectedMenuOrder.student.temporary_classroom_name && (
                        <p className="text-sm text-purple-600 mt-1">
                          Salón: {selectedMenuOrder.student.temporary_classroom_name}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ESTADO DE PAGO */}
              <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    💰 Información de Pago
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Estado de Pago:</p>
                      {selectedMenuOrder.manual_name ? (
                        <Badge className="bg-green-600 text-white mt-1">✅ Pagado (Físico)</Badge>
                      ) : (
                        <Badge className="bg-blue-600 text-white mt-1">💳 Pagado (Crédito)</Badge>
                      )}
                    </div>
                    
                    {selectedMenuOrder.payment_method && (
                      <div>
                        <p className="text-sm text-gray-600">Método de Pago:</p>
                        <p className="font-bold text-gray-900 mt-1">
                          {selectedMenuOrder.payment_method === 'cash' && '💵 Efectivo'}
                          {selectedMenuOrder.payment_method === 'card' && '💳 Tarjeta'}
                          {selectedMenuOrder.payment_method === 'yape' && '📱 Yape'}
                          {selectedMenuOrder.payment_method === 'plin' && '📱 Plin'}
                          {selectedMenuOrder.payment_method === 'transfer' && '🏦 Transferencia'}
                          {!['cash', 'card', 'yape', 'plin', 'transfer'].includes(selectedMenuOrder.payment_method) && selectedMenuOrder.payment_method}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Detalles de Pago */}
                  {selectedMenuOrder.payment_details && (
                    <div className="pt-3 border-t border-green-200">
                      <p className="text-sm text-gray-600 mb-2">Detalles:</p>
                      <div className="bg-white rounded-lg p-3 text-sm">
                        {selectedMenuOrder.payment_method === 'cash' && (
                          <div className="space-y-1">
                            <p><span className="font-semibold">Moneda:</span> {selectedMenuOrder.payment_details.currency || 'Soles'}</p>
                            <p><span className="font-semibold">Monto recibido:</span> S/ {selectedMenuOrder.payment_details.amount_received?.toFixed(2)}</p>
                            {selectedMenuOrder.payment_details.change && (
                              <p><span className="font-semibold">Vuelto:</span> S/ {selectedMenuOrder.payment_details.change?.toFixed(2)}</p>
                            )}
                          </div>
                        )}
                        {selectedMenuOrder.payment_method === 'card' && (
                          <div className="space-y-1">
                            <p><span className="font-semibold">Tipo:</span> {selectedMenuOrder.payment_details.card_type}</p>
                            <p><span className="font-semibold">N° Operación:</span> {selectedMenuOrder.payment_details.operation_number}</p>
                          </div>
                        )}
                        {(selectedMenuOrder.payment_method === 'yape' || selectedMenuOrder.payment_method === 'plin') && (
                          <div className="space-y-1">
                            <p><span className="font-semibold">N° Operación:</span> {selectedMenuOrder.payment_details.operation_number}</p>
                          </div>
                        )}
                        {selectedMenuOrder.payment_method === 'transfer' && (
                          <div className="space-y-1">
                            <p><span className="font-semibold">Banco:</span> {selectedMenuOrder.payment_details.bank_name}</p>
                            <p><span className="font-semibold">N° Operación:</span> {selectedMenuOrder.payment_details.operation_number}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* CATEGORÍA DEL MENÚ */}
              {selectedMenuOrder.lunch_menus.lunch_categories && (
                <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      {selectedMenuOrder.lunch_menus.lunch_categories.icon && (
                        <span className="text-5xl">{selectedMenuOrder.lunch_menus.lunch_categories.icon}</span>
                      )}
                      <div>
                        <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">Categoría</p>
                        <p className="text-2xl font-bold text-gray-900">{selectedMenuOrder.lunch_menus.lunch_categories.name}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* MENÚ DETALLADO */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    🍽️ Menú del Día
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Entrada */}
                    {selectedMenuOrder.lunch_menus.starter && (
                      <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                        <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                          🥗 Entrada
                        </p>
                        <p className="text-base text-gray-900 font-medium">{selectedMenuOrder.lunch_menus.starter}</p>
                      </div>
                    )}

                    {/* Plato Principal */}
                    {selectedMenuOrder.lunch_menus.main_course && (
                      <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                          🍽️ Plato Principal
                        </p>
                        <p className="text-base text-gray-900 font-medium">{selectedMenuOrder.lunch_menus.main_course}</p>
                      </div>
                    )}

                    {/* Bebida */}
                    {selectedMenuOrder.lunch_menus.beverage && (
                      <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                          🥤 Bebida
                        </p>
                        <p className="text-base text-gray-900 font-medium">{selectedMenuOrder.lunch_menus.beverage}</p>
                      </div>
                    )}

                    {/* Postre */}
                    {selectedMenuOrder.lunch_menus.dessert && (
                      <div className="bg-gradient-to-br from-pink-50 to-pink-100 p-4 rounded-lg border border-pink-200">
                        <p className="text-xs font-semibold text-pink-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                          🍰 Postre
                        </p>
                        <p className="text-base text-gray-900 font-medium">{selectedMenuOrder.lunch_menus.dessert}</p>
                      </div>
                    )}
                  </div>

                  {/* Notas */}
                  {selectedMenuOrder.lunch_menus.notes && (
                    <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                        📝 Notas Especiales
                      </p>
                      <p className="text-sm text-gray-700">{selectedMenuOrder.lunch_menus.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* INFORMACIÓN DEL PEDIDO */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    📋 Información del Pedido
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-gray-600">Fecha del pedido:</span>
                      <span className="font-semibold text-gray-900">
                        {format(new Date(selectedMenuOrder.order_date + 'T00:00:00'), "dd 'de' MMMM, yyyy", { locale: es })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-gray-600">Hora de registro:</span>
                      <span className="font-semibold text-gray-900">
                        {new Date(selectedMenuOrder.created_at).toLocaleTimeString('es-PE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'America/Lima'
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-600">Estado actual:</span>
                      <div>
                        {getStatusBadge(selectedMenuOrder.status, selectedMenuOrder.is_no_order_delivery)}
                      </div>
                    </div>
                    {selectedMenuOrder.delivered_at && (
                      <div className="flex justify-between items-center py-2 border-t">
                        <span className="text-sm text-gray-600">Entregado a las:</span>
                        <span className="font-semibold text-green-700">
                          {format(new Date(selectedMenuOrder.delivered_at), "HH:mm", { locale: es })}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={() => setShowMenuDetails(false)} size="lg">
                Cerrar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      
      {/* MODAL: VALIDACIÓN DE CONTRASEÑA (solo para cajeros) */}
      <Dialog open={showPasswordValidation} onOpenChange={setShowPasswordValidation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🔐 Autorización Requerida</DialogTitle>
            <DialogDescription>
              Para anular este pedido, necesitas la autorización de un administrador
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Contraseña del Administrador</label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Ingresa la contraseña"
                disabled={cancelling}
                className="mt-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !cancelling) {
                    handlePasswordValidated();
                  }
                }}
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowPasswordValidation(false);
                setAdminPassword('');
                setPendingCancelOrder(null);
              }}
              disabled={cancelling}
            >
              Cancelar
            </Button>
            <Button
              onClick={handlePasswordValidated}
              disabled={!adminPassword.trim() || cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validando...
                </>
              ) : (
                'Validar'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* MODAL: MOTIVO DE ANULACIÓN */}
      <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>❌ Anular Pedido</DialogTitle>
            <DialogDescription>
              Ingresa el motivo por el cual se está anulando este pedido
            </DialogDescription>
          </DialogHeader>
          
          {pendingCancelOrder && (
            <div className="bg-gray-50 p-3 rounded-lg mb-4">
              <p className="text-sm font-semibold">
                {pendingCancelOrder.student?.full_name || 
                 pendingCancelOrder.teacher?.full_name || 
                 pendingCancelOrder.manual_name || 
                 'Desconocido'}
              </p>
              <p className="text-xs text-gray-500">
                Pedido del {format(new Date(pendingCancelOrder.order_date + 'T00:00:00'), "dd 'de' MMMM", { locale: es })}
              </p>
            </div>
          )}
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Motivo de Anulación *</label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej: Pedido duplicado, error en el registro, etc."
                disabled={cancelling}
                className="mt-2"
                maxLength={200}
              />
              <p className="text-xs text-gray-500 mt-1">
                {cancelReason.length}/200 caracteres
              </p>
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowCancelModal(false);
                setCancelReason('');
                setPendingCancelOrder(null);
              }}
              disabled={cancelling}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={!cancelReason.trim() || cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Anulando...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Confirmar Anulación
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
