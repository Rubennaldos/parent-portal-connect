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
  PackagePlus,
  FileSpreadsheet,
  FileText,
  Settings2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LunchOrderActionsModal } from '@/components/lunch/LunchOrderActionsModal';
import { LunchDeliveryDashboard } from '@/components/lunch/LunchDeliveryDashboard';

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
  created_by: string | null;
  student_id: string | null;
  teacher_id: string | null;
  manual_name: string | null;
  payment_method: string | null;
  payment_details: any;
  parent_notes: string | null;
  menu_id: string | null;
  quantity: number | null;
  base_price: number | null;
  addons_total: number | null;
  final_price: number | null;
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
    grade: string | null;
    section: string | null;
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
  lunch_order_addons?: Array<{
    id: string;
    addon_name: string;
    addon_price: number;
    quantity: number;
  }>;
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
  const [selectedOrderTicketCode, setSelectedOrderTicketCode] = useState<string | null>(null);
  
  // Estados para anulación de pedidos
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showPasswordValidation, setShowPasswordValidation] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [pendingCancelOrder, setPendingCancelOrder] = useState<LunchOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // 🆕 Info de pago del pedido a anular (para mostrar advertencia de reembolso)
  const [cancelOrderPaymentInfo, setCancelOrderPaymentInfo] = useState<{
    isPaid: boolean;
    amount: number;
    paymentMethod: string | null;
    clientName: string;
  } | null>(null);
  const [lunchConfig, setLunchConfig] = useState<{ cancellation_deadline_time?: string; cancellation_deadline_days?: number } | null>(null);

  // 🍽️ Modo entrega de almuerzos
  const [showDelivery, setShowDelivery] = useState(false);
  const [adminSchoolId, setAdminSchoolId] = useState<string | null>(null);

  // ── Modal de exportación ──────────────────────────────────────────────────
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'excel'>('pdf');
  // true = exportar TODOS los pedidos cargados (ignora filtros activos)
  // false = exportar solo lo que se ve en pantalla (respeta filtros)
  const [exportIgnoreFilters, setExportIgnoreFilters] = useState(true);
  const [exportColumns, setExportColumns] = useState({
    nombre:        true,
    sede:          true,
    grado:         true,
    fecha:         true,
    hora:          true,
    categoria:     true,
    plato:         true,
    observaciones: true,
    estado:        true,
    pago:          true,
    total:         true,
    origen:        false,
  });
  const ALL_EXPORT_COLUMNS = [
    { key: 'nombre',        label: 'Nombre del alumno / cliente' },
    { key: 'sede',          label: 'Sede' },
    { key: 'grado',         label: 'Grado y sección' },
    { key: 'fecha',         label: 'Fecha del pedido' },
    { key: 'hora',          label: 'Hora del pedido' },
    { key: 'categoria',     label: 'Categoría del menú' },
    { key: 'plato',         label: 'Detalle del plato (entrada, segundo, postre, bebida)' },
    { key: 'observaciones', label: 'Observaciones / Notas' },
    { key: 'estado',        label: 'Estado del pedido' },
    { key: 'pago',          label: 'Estado de pago' },
    { key: 'total',         label: 'Total (S/)' },
    { key: 'origen',        label: 'Origen del pedido (app / manual)' },
  ] as const;

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
        setAdminSchoolId(schoolId);
        // Si el usuario tiene una sede asignada y NO puede ver todas las sedes, 
        // configurar automáticamente el filtro a su sede
        if (!canViewAllSchools) {
          setSelectedSchool(schoolId);
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
              free_account,
              grade,
              section
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
            ),
            lunch_order_addons (
              id,
              addon_name,
              addon_price,
              quantity
            )
          `)
          .gte('order_date', startDate)
          .lte('order_date', endDate)
          .eq('is_cancelled', false)
          .order('order_date', { ascending: false })
          .order('created_at', { ascending: false });

        // Paginación para superar el límite de 1000 filas de Supabase
        let allData: any[] = [];
        let from = 0;
        const PAGE_SIZE = 1000;
        while (true) {
          const { data: page, error: pageError } = await query.range(from, from + PAGE_SIZE - 1);
          if (pageError) throw pageError;
          if (!page || page.length === 0) break;
          allData = allData.concat(page);
          if (page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        const data = allData;
        
        console.log('✅ Pedidos cargados (rango):', data?.length || 0);
        // Debug: verificar si llegan todos los pedidos y si tienen student
        if (data && data.length > 0) {
          const sinStudent = data.filter((o: any) => !o.student && !o.teacher && !o.manual_name);
          if (sinStudent.length > 0) {
            console.warn('⚠️ Pedidos sin join de student/teacher:', sinStudent.length, sinStudent.map((o: any) => ({ id: o.id, order_date: o.order_date, student_id: o.student_id })));
          }
        }
        
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
        
        // 🎫💰 Batch: obtener ticket_codes + payment_status + amount para modo rango
        if (data && data.length > 0) {
          try {
            const orderIds = data.map(o => o.id);
            const { data: txData } = await supabase
              .from('transactions')
              .select('metadata, ticket_code, payment_status, payment_method, amount')
              .eq('type', 'purchase')
              .neq('payment_status', 'cancelled')
              .not('metadata', 'is', null)
              .order('created_at', { ascending: false })
              .limit(5000); // 🔧 Evitar límite por defecto de 1000 que ocultaba tickets
            
            if (txData) {
              const ticketMap = new Map<string, string>();
              const paymentStatusMap = new Map<string, { status: string; method: string | null }>();
              const amountMap = new Map<string, number>();
              const sourceMap = new Map<string, string>();
              txData.forEach((tx: any) => {
                const lunchOrderId = tx.metadata?.lunch_order_id;
                if (lunchOrderId && orderIds.includes(lunchOrderId)) {
                  if (tx.ticket_code) {
                    ticketMap.set(lunchOrderId, tx.ticket_code);
                  }
                  const existing = paymentStatusMap.get(lunchOrderId);
                  if (!existing || tx.payment_status === 'paid') {
                    paymentStatusMap.set(lunchOrderId, { 
                      status: tx.payment_status, 
                      method: tx.payment_method 
                    });
                  }
                  // Guardar el monto de la transacción (valor absoluto)
                  if (tx.amount) {
                    amountMap.set(lunchOrderId, Math.abs(tx.amount));
                  }
                  // Guardar el source de la transacción
                  if (tx.metadata?.source) {
                    sourceMap.set(lunchOrderId, tx.metadata.source);
                  }
                }
              });
              
              data.forEach((order: any) => {
                if (ticketMap.has(order.id)) {
                  order._ticket_code = ticketMap.get(order.id);
                }
                if (paymentStatusMap.has(order.id)) {
                  order._tx_payment_status = paymentStatusMap.get(order.id)!.status;
                  order._tx_payment_method = paymentStatusMap.get(order.id)!.method;
                }
                if (sourceMap.has(order.id)) {
                  order._tx_source = sourceMap.get(order.id);
                }
                // 💰 Si final_price es 0 o null, usar el monto de la transacción
                if ((!order.final_price || order.final_price === 0) && amountMap.has(order.id)) {
                  order.final_price = amountMap.get(order.id);
                }
              });
            }
          } catch (err) {
            console.log('⚠️ No se pudieron obtener ticket_codes/payment_status batch (rango)');
          }
        }
        
        // ✅ Mostrar TODOS los pedidos (pagados y sin pagar) — el admin necesita verlos todos
        setOrders(data || []);
        setLoading(false);
        return;
      }
      
      // Modo normal: una sola fecha

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
            free_account,
            grade,
            section
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
          ),
          lunch_order_addons (
            id,
            addon_name,
            addon_price,
            quantity
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
      
      // 🎫💰 Batch: obtener ticket_codes + payment_status + amount de transacciones asociadas a estos pedidos
      if (data && data.length > 0) {
        try {
          const orderIds = data.map(o => o.id);
          // Filtrar por school_id para performance (no buscar transacciones de otras sedes)
          let txQuery = supabase
            .from('transactions')
            .select('metadata, ticket_code, payment_status, payment_method, amount')
            .eq('type', 'purchase')
            .neq('payment_status', 'cancelled')
            .not('metadata', 'is', null);
          
          if (adminSchoolId) {
            txQuery = txQuery.eq('school_id', adminSchoolId);
          }

          const { data: txData } = await txQuery
            .order('created_at', { ascending: false })
            .limit(5000);
          
          if (txData) {
            const ticketMap = new Map<string, string>();
            const paymentStatusMap = new Map<string, { status: string; method: string | null }>();
            const amountMap = new Map<string, number>();
            const sourceMap = new Map<string, string>();
            txData.forEach((tx: any) => {
              const lunchOrderId = tx.metadata?.lunch_order_id;
              if (lunchOrderId && orderIds.includes(lunchOrderId)) {
                if (tx.ticket_code) {
                  ticketMap.set(lunchOrderId, tx.ticket_code);
                }
                // Usar la transacción más reciente (ya viene ordenado por created_at DESC)
                // Solo guardar la primera que encontremos para cada order
                if (!paymentStatusMap.has(lunchOrderId)) {
                  paymentStatusMap.set(lunchOrderId, { 
                    status: tx.payment_status, 
                    method: tx.payment_method 
                  });
                }
                if (tx.amount) {
                  amountMap.set(lunchOrderId, Math.abs(tx.amount));
                }
                if (tx.metadata?.source) {
                  sourceMap.set(lunchOrderId, tx.metadata.source);
                }
              }
            });
            
            data.forEach((order: any) => {
              if (ticketMap.has(order.id)) {
                order._ticket_code = ticketMap.get(order.id);
              }
              if (paymentStatusMap.has(order.id)) {
                order._tx_payment_status = paymentStatusMap.get(order.id)!.status;
                order._tx_payment_method = paymentStatusMap.get(order.id)!.method;
              }
              if (sourceMap.has(order.id)) {
                order._tx_source = sourceMap.get(order.id);
              }
              // 💰 Si final_price es 0 o null, usar el monto de la transacción
              if ((!order.final_price || order.final_price === 0) && amountMap.has(order.id)) {
                order.final_price = amountMap.get(order.id);
              }
            });
          }
        } catch (err) {
          console.log('⚠️ No se pudieron obtener ticket_codes/payment_status batch');
        }
      }

      // ✅ Mostrar TODOS los pedidos (pagados y sin pagar) — el admin necesita verlos todos
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
        // ✅ Incluir pedidos manuales (sin crédito) de la sede seleccionada
        if (order.manual_name && order.school_id === selectedSchool) return true;
        // ✅ Fallback: usar school_id directo del pedido (cubre casos donde el join falla)
        if (order.school_id === selectedSchool) return true;
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
      filtered = filtered.filter(order => {
        if (order.student?.full_name?.toLowerCase().includes(term)) return true;
        if (order.teacher?.full_name?.toLowerCase().includes(term)) return true;
        if (order.manual_name?.toLowerCase().includes(term)) return true;
        if (order.student?.temporary_classroom_name?.toLowerCase().includes(term)) return true;
        // Fallback: buscar en nombre_estudiante guardado directamente en el pedido
        if ((order as any).student_name?.toLowerCase().includes(term)) return true;
        if ((order as any).client_name?.toLowerCase().includes(term)) return true;
        return false;
      });
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

      // ============================================
      // 🛡️ ANTI-DUPLICADO NIVEL 1: Por metadata.lunch_order_id
      // ============================================
      const { data: existingByMetadata, error: checkError } = await supabase
        .from('transactions')
        .select('id, payment_status, metadata')
        .eq('metadata->>lunch_order_id', order.id)
        .neq('payment_status', 'cancelled');

      if (checkError) {
        console.error('❌ Error verificando transacción existente (metadata):', checkError);
        // No lanzar error - continuar con fallback
      }

      if (existingByMetadata && existingByMetadata.length > 0) {
        const hasPaid = existingByMetadata.some((t: any) => t.payment_status === 'paid');
        console.log('⚠️ [NIVEL 1] Ya existe(n) transacción(es) por metadata:', existingByMetadata.length, 'pagada:', hasPaid);
        
        toast({
          title: hasPaid ? '✅ Pedido ya fue pagado' : '⚠️ Pedido ya tiene transacción',
          description: hasPaid 
            ? 'Este pedido ya fue pagado. Solo se actualizó el estado del pedido.'
            : 'Este pedido ya tiene una transacción registrada. Solo se actualizó el estado.',
        });
        
        // Solo actualizar el status del pedido (no crear transacción)
        const { error: updateError } = await supabase
          .from('lunch_orders')
          .update({ status: 'confirmed' })
          .eq('id', order.id);

        if (updateError) throw updateError;

        fetchOrders();
        return;
      }

      // ============================================
      // 🛡️ ANTI-DUPLICADO NIVEL 2: FALLBACK por descripción + persona + fecha
      // Para transacciones creadas SIN metadata.lunch_order_id (código viejo)
      // ============================================
      console.log('🔍 [NIVEL 2] Buscando duplicado por descripción (fallback para metadata faltante)...');
      
      // Formatear la fecha del pedido como aparece en las descripciones
      const orderDateFormatted = format(new Date(order.order_date + 'T12:00:00'), "d 'de' MMMM", { locale: es });
      console.log('🔍 [NIVEL 2] Buscando "Almuerzo" + "' + orderDateFormatted + '" para', 
        order.teacher_id ? 'teacher:' + order.teacher_id : 'student:' + order.student_id);
      
      let fallbackQuery = supabase
        .from('transactions')
        .select('id, payment_status, description, metadata')
        .eq('type', 'purchase')
        .neq('payment_status', 'cancelled')
        .ilike('description', `%Almuerzo%`);

      if (order.teacher_id) {
        fallbackQuery = fallbackQuery.eq('teacher_id', order.teacher_id);
      } else if (order.student_id) {
        fallbackQuery = fallbackQuery.eq('student_id', order.student_id);
      } else if (order.manual_name) {
        fallbackQuery = fallbackQuery.ilike('manual_client_name', `%${order.manual_name}%`);
      }

      const { data: fallbackResults } = await fallbackQuery;
      
      // Filtrar por fecha en la descripción
      const existingByDescription = fallbackResults?.filter((t: any) => {
        return t.description?.includes(orderDateFormatted);
      }) || [];

      if (existingByDescription.length > 0) {
        const hasPaid = existingByDescription.some((t: any) => t.payment_status === 'paid');
        console.log('⚠️ [NIVEL 2] Encontrada(s) transacción(es) por descripción:', existingByDescription.length, 'pagada:', hasPaid);
        
        // 🔧 BONUS: Actualizar la transacción vieja para que tenga metadata.lunch_order_id
        // Esto evita que el duplicado se repita en futuras confirmaciones
        const txToFix = existingByDescription[0];
        try {
          const updatedMetadata = {
            ...(txToFix.metadata || {}),
            lunch_order_id: order.id,
            order_date: order.order_date,
            fixed_by: 'handleConfirmOrder_fallback',
            fixed_at: new Date().toISOString()
          };
          await supabase
            .from('transactions')
            .update({ metadata: updatedMetadata })
            .eq('id', txToFix.id);
          console.log('✅ [NIVEL 2] Metadata actualizada en transacción vieja:', txToFix.id);
        } catch (fixErr) {
          console.warn('⚠️ [NIVEL 2] No se pudo actualizar metadata:', fixErr);
        }

        toast({
          title: hasPaid ? '✅ Pedido ya fue pagado' : '⚠️ Pedido ya tiene transacción',
          description: hasPaid 
            ? 'Este pedido ya fue pagado. Solo se actualizó el estado.'
            : 'Se detectó una transacción existente (sin metadata). Solo se actualizó el estado.',
        });
        
        // Solo actualizar el status del pedido (no crear transacción)
        const { error: updateError } = await supabase
          .from('lunch_orders')
          .update({ status: 'confirmed' })
          .eq('id', order.id);

        if (updateError) throw updateError;

        fetchOrders();
        return;
      }
      
      console.log('✅ [ANTI-DUPLICADO] No se encontraron duplicados. Procediendo a crear transacción...');

      // Actualizar status a confirmed
      const { error: updateError } = await supabase
        .from('lunch_orders')
        .update({ status: 'confirmed' })
        .eq('id', order.id);

      if (updateError) throw updateError;

      // 🎫 Generar ticket_code
      let ticketCode: string | null = null;
      try {
        const { data: ticketNumber, error: ticketErr } = await supabase
          .rpc('get_next_ticket_number', { p_user_id: user?.id });
        if (!ticketErr && ticketNumber) {
          ticketCode = ticketNumber;
        }
      } catch (err) {
        console.warn('⚠️ No se pudo generar ticket_code:', err);
      }

      // Crear transacción si es necesario (crédito o pagar luego)
      let needsTransaction = false;
      let transactionData: any = {
        type: 'purchase',
        payment_status: 'pending',
        school_id: order.school_id || order.student?.school_id || order.teacher?.school_id_1,
        created_by: user?.id, // 👤 Registrar quién confirmó
        ticket_code: ticketCode,
        metadata: {
          lunch_order_id: order.id,
          source: 'lunch_orders_confirm',
          order_date: order.order_date,
          order_created_at: order.created_at, // 📅 Fecha original de creación del pedido
        }
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
          transactionData.description = `Almuerzo - ${format(new Date(order.order_date + 'T12:00:00'), "d 'de' MMMM", { locale: es })}`;
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
        transactionData.description = `Almuerzo - ${format(new Date(order.order_date + 'T12:00:00'), "d 'de' MMMM", { locale: es })}`;
      } else if (order.manual_name) {
        // Cliente manual - verificar si es "pagar luego" o ya pagó
        needsTransaction = true;
        transactionData.manual_client_name = order.manual_name;
        
        const { data: category } = await supabase
          .from('lunch_categories')
          .select('price')
          .eq('id', order.category_id || '')
          .single();

        const price = category?.price || 7.50;
        transactionData.amount = -Math.abs(price);
        transactionData.description = `Almuerzo - ${format(new Date(order.order_date + 'T12:00:00'), "d 'de' MMMM", { locale: es })} - ${order.manual_name}`;
        
        // 🔑 Si el pedido YA fue pagado (método != pagar_luego), marcar transacción como paid
        if (order.payment_method && order.payment_method !== 'pagar_luego') {
          transactionData.payment_status = 'paid';
          transactionData.payment_method = order.payment_method;
          console.log(`✅ [handleConfirmOrder] Pedido manual ya pagado con ${order.payment_method}, tx se crea como paid`);
        }
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
    const txStatus = (order as any)._tx_payment_status;
    
    // 🔍 Si hay transacción asociada, SIEMPRE confiar en su estado (es la fuente de verdad)
    if (txStatus) {
      if (txStatus === 'paid') {
        return { label: '✅ Pagado', color: 'bg-green-50 text-green-700 border-green-300' };
      }
      // La transacción dice pending/partial → mostrar como pendiente
      // NO confiar en order.payment_method porque puede estar desactualizado
      if (order.manual_name && order.payment_method === 'pagar_luego') {
        return { label: '💰 Pagar luego', color: 'bg-yellow-50 text-yellow-700 border-yellow-300' };
      }
      return { label: '💳 Crédito (Pendiente)', color: 'bg-blue-50 text-blue-700 border-blue-300' };
    }
    
    // Sin transacción → usar lógica de fallback basada en el pedido
    if (order.manual_name && order.payment_method === 'pagar_luego') {
      return { label: '💰 Pagar luego', color: 'bg-yellow-50 text-yellow-700 border-yellow-300' };
    }
    
    // Cliente manual con pago inmediato y SIN transacción = pagó al momento
    if (order.manual_name && order.payment_method && order.payment_method !== 'pagar_luego') {
      return { label: '✅ Pagado', color: 'bg-green-50 text-green-700 border-green-300' };
    }
    
    // Si es estudiante, verificar tipo de cuenta
    if (order.student_id && order.student) {
      if (order.student.free_account === true) {
        return { label: '💳 Crédito (Pendiente)', color: 'bg-blue-50 text-blue-700 border-blue-300' };
      } else {
        // Estudiante con saldo: si no encontramos transacción, verificar si fue debitado
        // Si el pedido fue registrado por el padre desde el calendario, puede ser saldo pendiente
        if (order.payment_method === 'saldo' || order.payment_method === 'balance') {
          return { label: '✅ Pagado', color: 'bg-green-50 text-green-700 border-green-300' };
        }
        return { label: '⏳ Sin verificar', color: 'bg-gray-50 text-gray-600 border-gray-300' };
      }
    }
    
    // Si es profesor, crédito pendiente
    if (order.teacher_id) {
      return { label: '💳 Crédito (Pendiente)', color: 'bg-blue-50 text-blue-700 border-blue-300' };
    }
    
    return { label: '⏳ Pendiente', color: 'bg-gray-50 text-gray-700 border-gray-300' };
  };

  const handleViewMenu = async (order: LunchOrder) => {
    setSelectedMenuOrder(order);
    // Usar el ticket_code pre-cargado si existe, sino buscar
    const preloadedTicket = (order as any)._ticket_code;
    setSelectedOrderTicketCode(preloadedTicket || null);
    setShowMenuDetails(true);
    
    try {
      const { data: txData } = await supabase
        .from('transactions')
        .select('ticket_code, payment_status, payment_method, amount, metadata, created_by')
        .eq('type', 'purchase')
        .neq('payment_status', 'cancelled')
        .contains('metadata', { lunch_order_id: order.id })
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (txData && txData.length > 0) {
        if (txData[0].ticket_code) {
          setSelectedOrderTicketCode(txData[0].ticket_code);
        }
        // Actualizar el estado de pago en tiempo real
        const updatedOrder = { ...order } as any;
        updatedOrder._tx_payment_status = txData[0].payment_status;
        updatedOrder._tx_payment_method = txData[0].payment_method;
        updatedOrder._tx_source = txData[0].metadata?.source || null;
        updatedOrder._tx_created_by = txData[0].created_by || null;
        // 💰 Si final_price es 0 o null, usar el monto de la transacción
        if ((!updatedOrder.final_price || updatedOrder.final_price === 0) && txData[0].amount) {
          updatedOrder.final_price = Math.abs(txData[0].amount);
        }
        setSelectedMenuOrder(updatedOrder);
      }
    } catch (err) {
      console.log('⚠️ No se pudo obtener info de transacción para el pedido:', order.id);
    }
  };

  // ========================================
  // FUNCIONES DE ANULACIÓN DE PEDIDOS
  // ========================================
  
  const handleOpenCancel = async (order: LunchOrder) => {
    console.log('🗑️ [handleOpenCancel] Intentando anular pedido');
    console.log('👤 [handleOpenCancel] Rol del usuario:', role);
    
    // 🔍 Verificar si el pedido tiene transacción PAGADA (para advertencia de reembolso)
    let paymentInfo: typeof cancelOrderPaymentInfo = null;
    try {
      const { data: txData } = await supabase
        .from('transactions')
        .select('id, payment_status, payment_method, amount')
        .eq('metadata->>lunch_order_id', order.id)
        .neq('payment_status', 'cancelled')
        .limit(1);
      
      if (txData && txData.length > 0) {
        const clientName = order.student?.full_name || order.teacher?.full_name || order.manual_name || 'Cliente';
        if (txData[0].payment_status === 'paid') {
          paymentInfo = {
            isPaid: true,
            amount: Math.abs(txData[0].amount),
            paymentMethod: txData[0].payment_method,
            clientName,
          };
          console.log('💰 [handleOpenCancel] Pedido YA PAGADO:', paymentInfo);
        } else {
          paymentInfo = {
            isPaid: false,
            amount: Math.abs(txData[0].amount),
            paymentMethod: null,
            clientName,
          };
          console.log('📋 [handleOpenCancel] Pedido con deuda pendiente');
        }
      } else {
        // Buscar también por campo legacy (sin metadata) - para pedidos viejos
        // Verificar si el lunch_order tiene payment_method != pagar_luego (pagado en persona)
        if (order.payment_method && order.payment_method !== 'pagar_luego') {
          const price = order.final_price || order.base_price || 0;
          paymentInfo = {
            isPaid: true,
            amount: price,
            paymentMethod: order.payment_method,
            clientName: order.student?.full_name || order.teacher?.full_name || order.manual_name || 'Cliente',
          };
          console.log('💰 [handleOpenCancel] Pedido pagado (sin transacción, info de lunch_orders):', paymentInfo);
        }
      }
    } catch (err) {
      console.warn('⚠️ Error verificando estado de pago al abrir anulación:', err);
    }
    
    setCancelOrderPaymentInfo(paymentInfo);
    
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
      
      // 💰 Buscar transacción asociada para CUALQUIER tipo de pedido
      // (crédito, fiado, pago inmediato - estudiante, profesor O manual)
      console.log('💰 Buscando transacción asociada al pedido...');
      console.log('📋 Datos del pedido:', {
        id: pendingCancelOrder.id,
        student_id: pendingCancelOrder.student_id,
        teacher_id: pendingCancelOrder.teacher_id,
        manual_name: pendingCancelOrder.manual_name,
        order_date: pendingCancelOrder.order_date
      });
      
      let cancelledTransactionWasPaid = false;
      let cancelledTransactionAmount = 0;
      let cancelledTransactionMethod: string | null = null;
      
      // 🔍 NIVEL 1: Buscar por metadata.lunch_order_id (más confiable)
      let { data: transactions, error: transError } = await supabase
        .from('transactions')
        .select('id, amount, student_id, teacher_id, manual_client_name, description, created_at, metadata, payment_status, payment_method')
        .eq('metadata->>lunch_order_id', pendingCancelOrder.id)
        .in('payment_status', ['pending', 'paid', 'partial']);
      
      // 🔍 NIVEL 2: Si no se encuentra por metadata, buscar por descripción (legacy)
      if (!transactions || transactions.length === 0) {
        console.log('⚠️ No se encontró por lunch_order_id, buscando por descripción...');
        let query = supabase
          .from('transactions')
          .select('id, amount, student_id, teacher_id, manual_client_name, description, created_at, metadata, payment_status, payment_method')
          .eq('type', 'purchase')
          .in('payment_status', ['pending', 'paid', 'partial']);
        
        // Filtrar por student_id, teacher_id o manual_client_name según corresponda
        if (pendingCancelOrder.student_id) {
          query = query.eq('student_id', pendingCancelOrder.student_id);
        } else if (pendingCancelOrder.teacher_id) {
          query = query.eq('teacher_id', pendingCancelOrder.teacher_id);
        } else if (pendingCancelOrder.manual_name) {
          query = query.ilike('manual_client_name', `%${pendingCancelOrder.manual_name}%`);
        }
        
        // Filtrar por fecha del pedido en la descripción
        const orderDateFormatted = format(new Date(pendingCancelOrder.order_date + 'T12:00:00'), "d 'de' MMMM", { locale: es });
        query = query.ilike('description', `%${orderDateFormatted}%`);
        
        const result = await query;
        transactions = result.data;
        transError = result.error;
      }
      
      console.log('🔍 Transacciones encontradas:', transactions?.length || 0);
      
      if (transError) {
        console.error('❌ Error buscando transacción:', transError);
      } else if (transactions && transactions.length > 0) {
        const transaction = transactions[0];
        console.log('✅ Transacción encontrada:', transaction.id, 'estado:', transaction.payment_status);
        
        // Guardar info del pago para el mensaje final
        cancelledTransactionWasPaid = transaction.payment_status === 'paid';
        cancelledTransactionAmount = Math.abs(transaction.amount);
        cancelledTransactionMethod = transaction.payment_method;
        
        // Anular la transacción (cambiar a 'cancelled')
        const { error: cancelTransError } = await supabase
          .from('transactions')
          .update({ 
            payment_status: 'cancelled',
            metadata: {
              ...transaction.metadata,
              cancellation_reason: cancelReason.trim(),
              cancelled_by: user?.id,
              cancelled_at: new Date().toISOString(),
              original_payment_status: transaction.payment_status,
              original_payment_method: transaction.payment_method,
              requires_refund: cancelledTransactionWasPaid, // 🆕 Marcar si requiere reembolso
              refund_amount: cancelledTransactionWasPaid ? cancelledTransactionAmount : 0,
            }
          })
          .eq('id', transaction.id);
        
        if (cancelTransError) {
          console.error('❌ Error anulando transacción:', cancelTransError);
        } else {
          console.log('✅ Transacción cancelada. Era pagada:', cancelledTransactionWasPaid);
        }
      } else {
        console.log('⚠️ No se encontró transacción asociada al pedido');
      }
      
      // 📢 Mostrar mensaje según el tipo de anulación
      const clientName = pendingCancelOrder.student?.full_name || 
                         pendingCancelOrder.teacher?.full_name || 
                         pendingCancelOrder.manual_name || 'Cliente';
      
      if (cancelledTransactionWasPaid) {
        // ⚠️ El pedido ya estaba PAGADO → necesita reembolso manual
        const methodLabel = cancelledTransactionMethod === 'efectivo' ? 'Efectivo' 
          : cancelledTransactionMethod === 'tarjeta' ? 'Tarjeta' 
          : cancelledTransactionMethod === 'yape' ? 'Yape' 
          : cancelledTransactionMethod === 'transferencia' ? 'Transferencia'
          : cancelledTransactionMethod || 'No especificado';
        
        toast({
          title: '⚠️ Pedido anulado - REQUIERE REEMBOLSO',
          description: `Debes devolver S/ ${cancelledTransactionAmount.toFixed(2)} a ${clientName}. Método original: ${methodLabel}`,
          variant: 'destructive',
          duration: 15000, // 15 segundos para que lo lean
        });
      } else if (transactions && transactions.length > 0) {
        // Tenía deuda pendiente → la deuda se elimina automáticamente
        toast({
          title: '✅ Pedido anulado',
          description: `El pedido de ${clientName} ha sido anulado y la deuda pendiente eliminada.`,
        });
      } else {
        // No tenía transacción → solo se anuló el pedido
        toast({
          title: '✅ Pedido anulado',
          description: `El pedido de ${clientName} ha sido anulado correctamente.`,
        });
      }
      
      // Cerrar modales y limpiar estados
      setShowCancelModal(false);
      setCancelReason('');
      setPendingCancelOrder(null);
      setCancelOrderPaymentInfo(null);
      
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
  // HELPERS PARA EXPORTACIÓN
  // ========================================

  /** Construye la fila de datos de un pedido según columnas activas */
  const buildOrderRow = (order: LunchOrder) => {
    const clientName   = order.student?.full_name || order.teacher?.full_name || order.manual_name || 'N/A';
    const schoolName   = order.school?.name || (order.student?.school_id ? schools.find(s => s.id === order.student?.school_id)?.name : null) || 'N/A';
    const grade        = order.student ? `${order.student.grade || ''} ${order.student.section || ''}`.trim() || '-' : '-';
    // ⚠️ FIX TIMEZONE: Supabase DATE viene como "2026-03-06" (UTC midnight).
    // new Date("2026-03-06") = 01-Mar-05 19:00 Lima (UTC-5) → día incorrecto.
    // Solución: forzar mediodía local añadiendo T12:00:00 para evitar el desfase.
    const deliveryDate = format(new Date(order.order_date + 'T12:00:00'), 'dd/MM/yyyy', { locale: es });
    const orderDate    = new Date(order.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' });
    const orderTime    = new Date(order.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
    const categoria    = order.lunch_menus?.lunch_categories?.name || (order.lunch_menus as any)?.category_name || 'Menú del día';
    const quantity     = order.quantity || 1;
    const quantityText = quantity > 1 ? `${quantity}x ` : '';

    // Plato detallado
    let plato = '-';
    if (order.lunch_menus) {
      const parts: string[] = [];
      if (order.lunch_menus.starter)    parts.push(`Entrada: ${order.lunch_menus.starter}`);
      if (order.lunch_menus.main_course) parts.push(`Segundo: ${order.lunch_menus.main_course}`);
      if (order.lunch_menus.dessert)    parts.push(`Postre: ${order.lunch_menus.dessert}`);
      if (order.lunch_menus.beverage)   parts.push(`Bebida: ${order.lunch_menus.beverage}`);
      plato = parts.length > 0 ? parts.join(' | ') : '-';
    }

    // Opciones configurables y selecciones del padre
    const addons = (order as any).lunch_order_addons;
    let configurableText = '';
    if (addons && addons.length > 0) {
      configurableText = addons.map((a: any) => `${a.addon_name}${a.quantity > 1 ? ` x${a.quantity}` : ''}`).join(', ');
    }

    // Selecciones de plato armado (modifiers, garnishes, configurable_selections)
    const selMods = (order as any).selected_modifiers;
    if (selMods && Array.isArray(selMods) && selMods.length > 0) {
      const modsText = selMods.map((m: any) => `${m.group_name || ''}: ${m.selected_name || ''}`).join(', ');
      configurableText = configurableText ? `${configurableText} | ${modsText}` : modsText;
    }

    const selGarnishes = (order as any).selected_garnishes;
    if (selGarnishes && Array.isArray(selGarnishes) && selGarnishes.length > 0) {
      const garText = `Guarniciones: ${selGarnishes.join(', ')}`;
      configurableText = configurableText ? `${configurableText} | ${garText}` : garText;
    }

    const configSels = (order as any).configurable_selections;
    if (configSels && Array.isArray(configSels) && configSels.length > 0) {
      const csText = configSels.map((c: any) => `${c.group_name || ''}: ${c.selected ?? c.selected_name ?? ''}`).join(', ');
      configurableText = configurableText ? `${configurableText} | ${csText}` : csText;
    }

    const statusLabels: Record<string, string> = {
      pending: 'Pendiente', confirmed: 'Confirmado', delivered: 'Entregado',
      cancelled: 'Anulado', postponed: 'Postergado', pending_payment: 'Pend. Pago'
    };
    const estado = statusLabels[order.status] || order.status;
    const pago   = getDebtStatus(order).label.replace(/[💰✅💳⏳🆓]/g, '').trim();
    const total  = order.final_price != null ? `S/ ${order.final_price.toFixed(2)}` : '-';
    let origen = 'Desconocido';
    if (order.teacher_id)       origen = 'App Profesor';
    else if (order.student_id)  origen = order.student?.is_temporary ? 'Cocina (temporal)' : 'App Padre';
    else if (order.manual_name) origen = 'Registro Manual';

    const menuNotes = order.lunch_menus?.notes || '';
    const parentNotes = order.parent_notes || '';
    const cancelNotes = order.cancellation_reason || order.postponement_reason || '';
    const observacionesParts: string[] = [];
    if (parentNotes) observacionesParts.push(`Obs. Padre: ${parentNotes}`);
    if (menuNotes) observacionesParts.push(menuNotes);
    if (cancelNotes) observacionesParts.push(cancelNotes);
    if (configurableText) observacionesParts.push(`Opciones: ${configurableText}`);
    const observaciones = observacionesParts.length > 0 ? observacionesParts.join(' | ') : '-';

    return { clientName, schoolName, grade, orderDate, deliveryDate, orderTime, categoria: `${quantityText}${categoria}`, plato, observaciones, estado, pago, total, origen, configurableText };
  };

  // ========================================
  // FUNCIÓN DE EXPORTACIÓN A EXCEL
  // ========================================

  const exportToExcel = () => {
    try {
      // ✅ FIX: usar todos los pedidos cargados si "exportIgnoreFilters" está activo
      const exportData = exportIgnoreFilters ? orders : filteredOrders;

      // Cabeceras activas
      const headers: string[] = [];
      if (exportColumns.nombre)        headers.push('Nombre');
      if (exportColumns.sede)          headers.push('Sede');
      if (exportColumns.grado)         headers.push('Grado / Sección');
      if (exportColumns.fecha)         headers.push('Fecha del Pedido');
      if (exportColumns.hora)          headers.push('Hora del Pedido');
      if (exportColumns.categoria)     headers.push('Categoría');
      if (exportColumns.plato)         headers.push('Detalle del Plato');
      if (exportColumns.observaciones) headers.push('Observaciones');
      if (exportColumns.estado)        headers.push('Estado');
      if (exportColumns.pago)          headers.push('Pago');
      if (exportColumns.total)         headers.push('Total');
      if (exportColumns.origen)        headers.push('Origen');

      const rows = exportData.map(order => {
        const r = buildOrderRow(order);
        const row: (string)[] = [];
        if (exportColumns.nombre)        row.push(r.clientName);
        if (exportColumns.sede)          row.push(r.schoolName);
        if (exportColumns.grado)         row.push(r.grade);
        if (exportColumns.fecha)         row.push(r.orderDate);
        if (exportColumns.hora)          row.push(r.orderTime);
        if (exportColumns.categoria)     row.push(r.categoria);
        if (exportColumns.plato)         row.push(r.plato);
        if (exportColumns.observaciones) row.push(r.observaciones);
        if (exportColumns.estado)        row.push(r.estado);
        if (exportColumns.pago)          row.push(r.pago);
        if (exportColumns.total)         row.push(r.total);
        if (exportColumns.origen)        row.push(r.origen);
      });

      const deliveryLabel = isDateRangeMode
        ? `Pedidos del ${format(new Date(startDate + 'T12:00:00'), "dd/MM/yyyy")} al ${format(new Date(endDate + 'T12:00:00'), "dd/MM/yyyy")}`
        : `Pedidos para el ${format(new Date(selectedDate + 'T12:00:00'), "EEEE dd 'de' MMMM yyyy", { locale: es })}`;

      // Insertar título + línea en blanco + cabeceras + datos
      const wsDataFull: any[][] = [
        [deliveryLabel],
        [],
        headers,
        ...rows,
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsDataFull);

      // Estilo de encabezados (ancho de columnas automático)
      const colWidths = headers.map((_, i) => ({
        wch: Math.max(headers[i].length, ...rows.map(r => (r[i] || '').length), 12)
      }));
      ws['!cols'] = colWidths;

      // Aplicar negrita a la fila de encabezados (ahora en row index 2)
      headers.forEach((_, i) => {
        const cellRef = XLSX.utils.encode_cell({ r: 2, c: i });
        if (ws[cellRef]) {
          ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: '3B82F6' } }, font2: { color: { rgb: 'FFFFFF' } } };
        }
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');

      // Hoja resumen
      const resumenData = [
        ['RESUMEN', ''],
        ['Total pedidos', exportData.length],
        ['Confirmados', exportData.filter(o => o.status === 'confirmed').length],
        ['Entregados', exportData.filter(o => o.status === 'delivered').length],
        ['Anulados', exportData.filter(o => o.status === 'cancelled').length],
        ['', ''],
        ['Generado el', new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })],
      ];
      const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
      wsResumen['!cols'] = [{ wch: 20 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

      // ⚠️ FIX TIMEZONE: misma corrección para el nombre del archivo
      const fileName = isDateRangeMode
        ? `Pedidos_para_${format(new Date(startDate + 'T12:00:00'), 'ddMMyyyy')}_al_${format(new Date(endDate + 'T12:00:00'), 'ddMMyyyy')}.xlsx`
        : `Pedidos_para_${format(new Date(selectedDate + 'T12:00:00'), 'dd-MMM-yyyy', { locale: es })}.xlsx`;

      XLSX.writeFile(wb, fileName);
      setShowExportModal(false);
      toast({ title: '✅ Excel generado', description: 'El reporte Excel ha sido descargado.' });
    } catch (error: any) {
      console.error('Excel export error:', error);
      toast({ variant: 'destructive', title: 'Error', description: `No se pudo generar el Excel: ${error?.message || 'Error desconocido'}` });
    }
  };

  // ========================================
  // FUNCIÓN DE EXPORTACIÓN A PDF
  // ========================================
  
  const exportToPDF = () => {
    try {
      // ✅ FIX: usar todos los pedidos cargados si "exportIgnoreFilters" está activo
      const exportData = exportIgnoreFilters ? orders : filteredOrders;

      const doc = new jsPDF('l', 'mm', 'a4');
      const pageW = doc.internal.pageSize.width;

      // ── Encabezado ───────────────────────────────────────────
      doc.setFillColor(59, 130, 246);
      doc.rect(0, 0, pageW, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('REPORTE DE PEDIDOS DE ALMUERZO', pageW / 2, 10, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');

      let filterText = '';
      if (isDateRangeMode && startDate && endDate) {
        filterText = `Período de entrega: ${format(new Date(startDate + 'T12:00:00'), 'dd/MM/yyyy', { locale: es })} – ${format(new Date(endDate + 'T12:00:00'), 'dd/MM/yyyy', { locale: es })}`;
      } else {
        filterText = `Pedidos para el ${format(new Date(selectedDate + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es })}`;
      }
      if (selectedSchool !== 'all') {
        const school = schools.find(s => s.id === selectedSchool);
        filterText += `  |  Sede: ${school?.name || 'N/A'}`;
      }
      if (selectedStatus !== 'all') {
        const sl: Record<string, string> = { confirmed:'Confirmado', delivered:'Entregado', cancelled:'Anulado', postponed:'Postergado', pending_payment:'Pend. Pago' };
        filterText += `  |  Estado: ${sl[selectedStatus] || selectedStatus}`;
      }
      doc.text(filterText, pageW / 2, 17, { align: 'center' });

      // Fila de metadatos
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(7);
      doc.text(`Total pedidos: ${exportData.length}   |   Generado: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })}`, 15, 27);

      // ── Construir columnas activas ──────────────────────────
      const heads: string[] = [];
      if (exportColumns.nombre)        heads.push('Nombre');
      if (exportColumns.sede)          heads.push('Sede');
      if (exportColumns.grado)         heads.push('Grado');
      if (exportColumns.fecha)         heads.push('Fecha del Pedido');
      if (exportColumns.hora)          heads.push('Hora del Pedido');
      if (exportColumns.categoria)     heads.push('Categoría');
      if (exportColumns.plato)         heads.push('Plato / Menú');
      if (exportColumns.observaciones) heads.push('Observaciones');
      if (exportColumns.estado)        heads.push('Estado');
      if (exportColumns.pago)          heads.push('Pago');
      if (exportColumns.total)         heads.push('Total');
      if (exportColumns.origen)        heads.push('Origen');

      // ── Filas con soporte de negrita para configurables ─────
      const tableBody: any[][] = exportData.map(order => {
        const r = buildOrderRow(order);
        const row: any[] = [];
        if (exportColumns.nombre)        row.push(r.clientName);
        if (exportColumns.sede)          row.push(r.schoolName);
        if (exportColumns.grado)         row.push(r.grade);
        if (exportColumns.fecha)         row.push(r.orderDate);
        if (exportColumns.hora)          row.push(r.orderTime);
        if (exportColumns.categoria)     row.push(r.categoria);
        if (exportColumns.plato) {
          // Si tiene opciones configurables, marcarlas en negrita dentro de la celda
          row.push(r.configurableText
            ? { content: r.plato + (r.configurableText ? `\n★ Opciones: ${r.configurableText}` : ''), styles: { fontStyle: 'bold' } }
            : r.plato);
        }
        if (exportColumns.observaciones) {
          const hasObs = r.observaciones !== '-';
          row.push(hasObs ? { content: r.observaciones, styles: { fontStyle: 'bold', textColor: [120, 53, 15] } } : '-');
        }
        if (exportColumns.estado)        row.push(r.estado);
        if (exportColumns.pago) {
          const isPaid = r.pago.toLowerCase().includes('pagado') || r.pago.toLowerCase().includes('saldo');
          row.push({ content: r.pago, styles: { textColor: isPaid ? [22, 163, 74] : [220, 38, 38], fontStyle: 'bold' } });
        }
        if (exportColumns.total)         row.push({ content: r.total, styles: { halign: 'right' } });
        if (exportColumns.origen)        row.push(r.origen);
        return row;
      });

      autoTable(doc, {
        head: [heads],
        body: tableBody,
        startY: 31,
        styles: { fontSize: 6.5, cellPadding: 1.8, overflow: 'linebreak' },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 7 },
        alternateRowStyles: { fillColor: [239, 246, 255] },
        margin: { left: 10, right: 10 },
      });

      // ── Footer ───────────────────────────────────────────────
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(160, 160, 160);
        doc.text('© 2026 ERP Profesional · Lima Café 28 · Generado por ARQUISIA Soluciones', pageW / 2, doc.internal.pageSize.height - 6, { align: 'center' });
        doc.text(`Pág. ${i} / ${pageCount}`, pageW - 15, doc.internal.pageSize.height - 6, { align: 'right' });
      }

      // ⚠️ FIX TIMEZONE: misma corrección para nombre del PDF
      const fileName = isDateRangeMode
        ? `Pedidos_Almuerzo_${format(new Date(startDate + 'T12:00:00'), 'ddMMyyyy')}_${format(new Date(endDate + 'T12:00:00'), 'ddMMyyyy')}.pdf`
        : `Pedidos_Almuerzo_${format(new Date(selectedDate + 'T12:00:00'), 'ddMMyyyy')}.pdf`;
      doc.save(fileName);
      setShowExportModal(false);
      toast({ title: '✅ PDF generado', description: 'El reporte ha sido descargado.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo generar el PDF.' });
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

  // 🍽️ Modo entrega
  if (showDelivery && adminSchoolId && user) {
    return (
      <LunchDeliveryDashboard
        schoolId={adminSchoolId}
        userId={user.id}
        userName={user.email?.split('@')[0] || 'Admin'}
        selectedDate={selectedDate || undefined}
        onClose={() => { setShowDelivery(false); fetchOrders(); }}
      />
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
          {adminSchoolId && (
            <Button
              onClick={() => setShowDelivery(true)}
              className="gap-2 bg-orange-600 hover:bg-orange-700 text-white shadow-lg"
            >
              <UtensilsCrossed className="h-4 w-4" />
              🍽️ Iniciar Entrega
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowExportModal(true)}
            disabled={filteredOrders.length === 0}
            className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <Download className="h-4 w-4" />
            Exportar reporte
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
                      {/* Mostrar agregados si existen */}
                      {order.lunch_order_addons && order.lunch_order_addons.length > 0 && (
                        <div className="mt-1">
                          <p className="text-xs text-gray-500">
                            <span className="font-semibold text-green-600">Agregados:</span>{' '}
                            {order.lunch_order_addons.map((addon: any, idx: number) => (
                              <span key={addon.id}>
                                {addon.addon_name}
                                {idx < order.lunch_order_addons.length - 1 ? ', ' : ''}
                              </span>
                            ))}
                          </p>
                        </div>
                      )}
                      {/* Selecciones del plato armado */}
                      {(() => {
                        const mods = (order as any).selected_modifiers;
                        const garns = (order as any).selected_garnishes;
                        const cfgs = (order as any).configurable_selections;
                        const parts: string[] = [];
                        if (mods && Array.isArray(mods) && mods.length > 0) parts.push(mods.map((m: any) => `${m.group_name}: ${m.selected_name}`).join(', '));
                        if (cfgs && Array.isArray(cfgs) && cfgs.length > 0) parts.push(cfgs.map((c: any) => `${c.group_name}: ${c.selected ?? c.selected_name ?? ''}`).join(', '));
                        if (garns && Array.isArray(garns) && garns.length > 0) parts.push(`Guarniciones: ${garns.join(', ')}`);
                        if (parts.length === 0) return null;
                        return (
                          <div className="mt-1 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                            <p className="text-xs text-indigo-800">
                              <span className="font-semibold">🍽️ Selecciones:</span> {parts.join(' | ')}
                            </p>
                          </div>
                        );
                      })()}
                      {/* Observaciones del padre */}
                      {order.parent_notes && (
                        <div className="mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          <p className="text-xs text-amber-800">
                            <span className="font-semibold">📝 Obs. Padre:</span> {order.parent_notes}
                          </p>
                        </div>
                      )}
                      {/* Mostrar precio total si está disponible */}
                      {order.final_price !== null && order.final_price !== undefined && (
                        <p className="text-sm font-semibold text-green-700 mt-1">
                          Total: S/ {order.final_price.toFixed(2)}
                          {order.addons_total && order.addons_total > 0 && (
                            <span className="text-xs font-normal text-gray-500 ml-1">
                              (Base: S/ {order.base_price?.toFixed(2)} + Agregados: S/ {order.addons_total.toFixed(2)})
                            </span>
                          )}
                        </p>
                      )}
                      {/* 🎫 Nº de Comprobante - siempre visible y prominente */}
                      {(order as any)._ticket_code ? (
                        <div className="mt-1 inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 rounded-md px-2.5 py-1">
                          <span className="text-sm font-bold text-indigo-800">
                            🎫 Nº {(order as any)._ticket_code}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1">
                          <span className="text-xs text-gray-400">
                            Sin comprobante
                          </span>
                        </div>
                      )}
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

      {/* Modal de Detalles del Pedido - REDESIGNED v1.21.2 */}
      {selectedMenuOrder && selectedMenuOrder.lunch_menus && (
        <Dialog open={showMenuDetails} onOpenChange={setShowMenuDetails}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
                🍽️ Detalle del Pedido
              </DialogTitle>
              <DialogDescription className="text-base">
                Información completa del pedido de almuerzo
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* 1. PARA QUÉ DÍA ES EL PEDIDO */}
              <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-300">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600 font-medium uppercase tracking-wide">Para el día</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {format(new Date(selectedMenuOrder.order_date + 'T00:00:00'), "EEEE d 'de' MMMM, yyyy", { locale: es })}
                      </p>
                    </div>
                    <Calendar className="h-12 w-12 text-purple-600" />
                  </div>
                </CardContent>
              </Card>

              {/* 2. CUÁNDO LO PIDIÓ */}
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <Clock className="h-10 w-10 text-blue-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-gray-600 font-medium">Pedido registrado el</p>
                      <p className="text-lg font-bold text-gray-900">
                        {format(new Date(selectedMenuOrder.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 2.5 NÚMERO DE COMPROBANTE / TICKET */}
              {selectedOrderTicketCode && (
                <Card className="bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-300">
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-amber-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-2xl">🎫</span>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">Nº de Comprobante</p>
                        <p className="text-xl font-bold text-amber-800">{selectedOrderTicketCode}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 3. QUIÉN HIZO EL PEDIDO */}
              <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold uppercase tracking-wide flex items-center gap-2">
                    👤 Cliente
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    {selectedMenuOrder.student?.photo_url ? (
                      <img
                        src={selectedMenuOrder.student.photo_url}
                        alt={selectedMenuOrder.student.full_name}
                        className="h-14 w-14 rounded-full object-cover border-2 border-green-300"
                      />
                    ) : (
                      <div className={cn(
                        "h-14 w-14 rounded-full flex items-center justify-center border-2",
                        selectedMenuOrder.teacher ? "bg-green-100 border-green-400" : "bg-blue-100 border-blue-400"
                      )}>
                        <span className="font-bold text-xl">
                          {(selectedMenuOrder.student?.full_name || selectedMenuOrder.teacher?.full_name || selectedMenuOrder.manual_name || '?')[0]}
                        </span>
                      </div>
                    )}
                    
                    <div className="flex-1">
                      <p className="text-lg font-bold text-gray-900">
                        {selectedMenuOrder.student?.full_name || selectedMenuOrder.teacher?.full_name || selectedMenuOrder.manual_name || 'Desconocido'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {selectedMenuOrder.teacher && (
                          <Badge className="bg-green-600">👨‍🏫 Profesor</Badge>
                        )}
                        {selectedMenuOrder.student && !selectedMenuOrder.student.is_temporary && (
                          <Badge className="bg-blue-600">👨‍🎓 Alumno</Badge>
                        )}
                        {selectedMenuOrder.manual_name && (
                          <Badge className="bg-orange-600">💵 Cliente Manual</Badge>
                        )}
                        {selectedMenuOrder.school && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                            🏫 {selectedMenuOrder.school.name}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* QUIÉN LO CREÓ */}
                  <div className="mt-3 pt-3 border-t border-green-200">
                    <p className="text-xs text-gray-600 font-medium uppercase tracking-wide mb-1">Registrado por</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {(() => {
                        const source = (selectedMenuOrder as any)?._tx_source;
                        // Priorizar metadata.source de la transacción
                        if (source) {
                          switch (source) {
                            case 'teacher_lunch_calendar':
                              return '✅ El profesor desde su calendario';
                            case 'parent_lunch_calendar':
                              return '✅ El padre desde su calendario';
                            case 'unified_calendar_v2_parent':
                              return '✅ El padre desde el calendario V2';
                            case 'unified_calendar_v2_teacher':
                              return '✅ El profesor desde el calendario V2';
                            case 'order_lunch_menus':
                              return '✅ Desde el calendario de menús';
                            case 'physical_order_wizard':
                            case 'physical_order_wizard_fiado':
                            case 'physical_order_wizard_paid':
                              return '🔧 Registro manual (administrador/cajero)';
                            case 'lunch_orders_confirm':
                              return '🔧 Confirmado por administrador/cajero';
                            case 'lunch_fast':
                              return '⚡ Pedido rápido (padre)';
                            default:
                              return `📋 ${source}`;
                          }
                        }
                        // Fallback: usar created_by del pedido
                        if (selectedMenuOrder.created_by) {
                          if (selectedMenuOrder.teacher_id && selectedMenuOrder.created_by === selectedMenuOrder.teacher_id) {
                            return '✅ El profesor desde su perfil';
                          }
                          if (selectedMenuOrder.student_id && selectedMenuOrder.created_by === (selectedMenuOrder.student as any)?.parent_id) {
                            return '✅ El padre desde su perfil';
                          }
                          return '🔧 Un administrador/cajero';
                        }
                        // Fallback final
                        if (selectedMenuOrder.manual_name) return '🔧 Un cajero (venta manual)';
                        return '⚙️ Sistema';
                      })()}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* 4. ESTADO DEL PEDIDO (GRANDE Y CLARO) */}
              <Card className={cn(
                "border-2",
                selectedMenuOrder.status === 'delivered' && "bg-green-50 border-green-500",
                selectedMenuOrder.status === 'confirmed' && "bg-blue-50 border-blue-500",
                selectedMenuOrder.status === 'pending' && "bg-yellow-50 border-yellow-500",
                selectedMenuOrder.is_cancelled && "bg-red-50 border-red-500"
              )}>
                <CardContent className="py-6">
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-2">Estado del Pedido</p>
                    <div className="flex items-center justify-center gap-3">
                      {selectedMenuOrder.status === 'delivered' && (
                        <>
                          <CheckCircle2 className="h-10 w-10 text-green-600" />
                          <p className="text-3xl font-bold text-green-700">ENTREGADO</p>
                        </>
                      )}
                      {selectedMenuOrder.status === 'confirmed' && (
                        <>
                          <CheckCircle2 className="h-10 w-10 text-blue-600" />
                          <p className="text-3xl font-bold text-blue-700">CONFIRMADO</p>
                        </>
                      )}
                      {selectedMenuOrder.status === 'pending' && !selectedMenuOrder.is_cancelled && (
                        <>
                          <Clock className="h-10 w-10 text-yellow-600" />
                          <p className="text-3xl font-bold text-yellow-700">PENDIENTE</p>
                        </>
                      )}
                      {selectedMenuOrder.is_cancelled && (
                        <>
                          <XCircle className="h-10 w-10 text-red-600" />
                          <p className="text-3xl font-bold text-red-700">ANULADO</p>
                        </>
                      )}
                    </div>
                    {selectedMenuOrder.delivered_at && (
                      <p className="text-sm text-gray-600 mt-2">
                        Entregado a las {format(new Date(selectedMenuOrder.delivered_at), "HH:mm", { locale: es })}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 5. CANTIDAD DE MENÚS */}
              {selectedMenuOrder.quantity && selectedMenuOrder.quantity > 1 && (
                <Card className="bg-amber-50 border-amber-300">
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-amber-200 flex items-center justify-center">
                        <span className="text-2xl font-bold text-amber-900">{selectedMenuOrder.quantity}</span>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600 font-medium">Cantidad de menús</p>
                        <p className="text-lg font-bold text-gray-900">
                          {selectedMenuOrder.quantity} menú{selectedMenuOrder.quantity > 1 ? 's' : ''} pedido{selectedMenuOrder.quantity > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 6. CATEGORÍA */}
              {selectedMenuOrder.lunch_menus.lunch_categories && (
                <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                      {selectedMenuOrder.lunch_menus.lunch_categories.icon && (
                        <span className="text-4xl">{selectedMenuOrder.lunch_menus.lunch_categories.icon}</span>
                      )}
                      <div>
                        <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">Categoría</p>
                        <p className="text-xl font-bold text-gray-900">{selectedMenuOrder.lunch_menus.lunch_categories.name}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 7. MENÚ COMPLETO */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold uppercase tracking-wide flex items-center gap-2">
                    🍽️ Menú del Día
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedMenuOrder.lunch_menus.starter && (
                      <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                        <p className="text-xs font-semibold text-green-700 uppercase mb-1">🥗 Entrada</p>
                        <p className="text-sm font-medium text-gray-900">{selectedMenuOrder.lunch_menus.starter}</p>
                      </div>
                    )}
                    {selectedMenuOrder.lunch_menus.main_course && (
                      <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                        <p className="text-xs font-semibold text-orange-700 uppercase mb-1">🍽️ Plato Principal</p>
                        <p className="text-sm font-medium text-gray-900">{selectedMenuOrder.lunch_menus.main_course}</p>
                      </div>
                    )}
                    {selectedMenuOrder.lunch_menus.beverage && (
                      <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                        <p className="text-xs font-semibold text-blue-700 uppercase mb-1">🥤 Bebida</p>
                        <p className="text-sm font-medium text-gray-900">{selectedMenuOrder.lunch_menus.beverage}</p>
                      </div>
                    )}
                    {selectedMenuOrder.lunch_menus.dessert && (
                      <div className="bg-pink-50 p-3 rounded-lg border border-pink-200">
                        <p className="text-xs font-semibold text-pink-700 uppercase mb-1">🍰 Postre</p>
                        <p className="text-sm font-medium text-gray-900">{selectedMenuOrder.lunch_menus.dessert}</p>
                      </div>
                    )}
                  </div>
                  {selectedMenuOrder.lunch_menus.notes && (
                    <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-yellow-700 uppercase mb-1">📝 Notas del Menú</p>
                      <p className="text-sm text-gray-700">{selectedMenuOrder.lunch_menus.notes}</p>
                    </div>
                  )}
                  {selectedMenuOrder.parent_notes && (
                    <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-3">
                      <p className="text-xs font-semibold text-amber-700 uppercase mb-1">📝 Observación del Padre</p>
                      <p className="text-sm text-gray-700">{selectedMenuOrder.parent_notes}</p>
                    </div>
                  )}

                  {/* Selecciones del plato armado */}
                  {(() => {
                    const mods = (selectedMenuOrder as any).selected_modifiers;
                    const garns = (selectedMenuOrder as any).selected_garnishes;
                    const configs = (selectedMenuOrder as any).configurable_selections;
                    const hasMods = mods && Array.isArray(mods) && mods.length > 0;
                    const hasGarns = garns && Array.isArray(garns) && garns.length > 0;
                    const hasConfigs = configs && Array.isArray(configs) && configs.length > 0;
                    if (!hasMods && !hasGarns && !hasConfigs) return null;

                    return (
                      <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-semibold text-indigo-700 uppercase mb-1">🍽️ Selecciones del Padre</p>
                        {hasMods && (
                          <div className="flex flex-wrap gap-1.5">
                            {mods.map((m: any, i: number) => (
                              <Badge key={i} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                                {m.group_name}: <strong className="ml-1">{m.selected_name}</strong>
                              </Badge>
                            ))}
                          </div>
                        )}
                        {hasConfigs && (
                          <div className="flex flex-wrap gap-1.5">
                            {configs.map((c: any, i: number) => (
                              <Badge key={i} variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                                {c.group_name}: <strong className="ml-1">{c.selected ?? c.selected_name ?? ''}</strong>
                              </Badge>
                            ))}
                          </div>
                        )}
                        {hasGarns && (
                          <div className="flex flex-wrap gap-1.5">
                            {garns.map((g: string, i: number) => (
                              <Badge key={i} variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                                🥗 {g}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* 8. ESTADO DE PAGO (SIEMPRE MOSTRAR SI TIENE PRECIO O TX) */}
              {(selectedMenuOrder.payment_method || selectedMenuOrder.final_price || (selectedMenuOrder as any)._tx_payment_status) && (
                <Card className={cn(
                  "border",
                  (selectedMenuOrder as any)._tx_payment_status === 'paid' 
                    ? "bg-gradient-to-r from-green-50 to-emerald-50 border-green-300" 
                    : "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200"
                )}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold uppercase tracking-wide flex items-center gap-2">
                      💰 Información de Pago
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Estado real basado en la transacción (FUENTE DE VERDAD) */}
                    {(() => {
                      const txStatus = (selectedMenuOrder as any)._tx_payment_status;
                      const txMethod = (selectedMenuOrder as any)._tx_payment_method;
                      const orderMethod = selectedMenuOrder.payment_method;
                      
                      // Helper para mostrar el método de pago
                      const renderMethod = (method: string | null) => {
                        if (!method) return null;
                        const methodMap: Record<string, string> = {
                          'cash': '💵 Efectivo', 'card': '💳 Tarjeta', 'yape': '📱 Yape',
                          'plin': '📱 Plin', 'transfer': '🏦 Transferencia', 'transferencia': '🏦 Transferencia',
                          'efectivo': '💵 Efectivo', 'tarjeta': '💳 Tarjeta',
                          'Efectivo': '💵 Efectivo', 'Tarjeta': '💳 Tarjeta', 'Yape': '📱 Yape',
                        };
                        return methodMap[method] || method;
                      };

                      // CASO 1: Transacción dice PAGADO → mostrar pagado
                      if (txStatus === 'paid') {
                        return (
                          <div>
                            <p className="text-sm text-gray-600">Estado:</p>
                            <Badge className="bg-green-600 text-white mt-1 text-sm px-3 py-1">✅ Pagado</Badge>
                            {(txMethod || orderMethod) && (
                              <p className="text-sm text-gray-600 mt-2">
                                Método: <span className="font-semibold text-gray-900">
                                  {renderMethod(txMethod || orderMethod)}
                                </span>
                              </p>
                            )}
                          </div>
                        );
                      }
                      
                      // CASO 2: Transacción dice PENDIENTE → mostrar pendiente (confiar en la transacción)
                      if (txStatus === 'pending' || txStatus === 'partial') {
                        return (
                          <div>
                            <p className="text-sm text-gray-600">Estado:</p>
                            <Badge className="bg-yellow-600 text-white mt-1">⏳ Pendiente de Pago</Badge>
                            {orderMethod && orderMethod !== 'pagar_luego' && (
                              <p className="text-xs text-orange-600 mt-2">
                                ⚠️ El pedido indica método "{renderMethod(orderMethod)}" pero la transacción no está marcada como pagada
                              </p>
                            )}
                          </div>
                        );
                      }
                      
                      // CASO 3: Sin transacción - usar lógica del pedido
                      if (selectedMenuOrder.manual_name && orderMethod && orderMethod !== 'pagar_luego') {
                        return (
                          <div>
                            <p className="text-sm text-gray-600">Estado:</p>
                            <Badge className="bg-green-600 text-white mt-1">✅ Pagado ({renderMethod(orderMethod)})</Badge>
                          </div>
                        );
                      }
                      
                      if (orderMethod && orderMethod !== 'pagar_luego') {
                        return (
                          <div>
                            <p className="text-sm text-gray-600">Método de Pago:</p>
                            <p className="font-bold text-gray-900 mt-1">{renderMethod(orderMethod)}</p>
                          </div>
                        );
                      }
                      
                      return (
                        <div>
                          <p className="text-sm text-gray-600">Estado:</p>
                          <Badge className="bg-yellow-600 text-white mt-1">⏳ Pendiente de Pago (A Crédito)</Badge>
                        </div>
                      );
                    })()}

                    {selectedMenuOrder.final_price && (
                      <div className="pt-2 border-t border-emerald-200">
                        <div className="flex justify-between items-center text-lg font-bold">
                          <span className="text-gray-700">Total:</span>
                          <span className="text-emerald-700">S/ {selectedMenuOrder.final_price.toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t mt-4">
              <Button onClick={() => setShowMenuDetails(false)} size="lg" className="bg-purple-600 hover:bg-purple-700">
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
          
          {/* ⚠️ Advertencia si el pedido ya fue PAGADO */}
          {cancelOrderPaymentInfo?.isPaid && (
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-2">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">⚠️</span>
                <div>
                  <p className="font-bold text-red-800 text-sm">¡ATENCIÓN: Este pedido ya fue PAGADO!</p>
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-red-700">
                      💰 Monto: <span className="font-bold">S/ {cancelOrderPaymentInfo.amount.toFixed(2)}</span>
                    </p>
                    <p className="text-sm text-red-700">
                      💳 Método: <span className="font-bold">
                        {cancelOrderPaymentInfo.paymentMethod === 'efectivo' ? 'Efectivo' 
                          : cancelOrderPaymentInfo.paymentMethod === 'tarjeta' ? 'Tarjeta' 
                          : cancelOrderPaymentInfo.paymentMethod === 'yape' ? 'Yape' 
                          : cancelOrderPaymentInfo.paymentMethod === 'transferencia' ? 'Transferencia'
                          : cancelOrderPaymentInfo.paymentMethod || 'No especificado'}
                      </span>
                    </p>
                    <p className="text-sm text-red-700">
                      👤 Cliente: <span className="font-bold">{cancelOrderPaymentInfo.clientName}</span>
                    </p>
                  </div>
                  <p className="text-sm font-bold text-red-900 mt-3 bg-red-100 p-2 rounded">
                    🔄 Al anular, deberás devolver S/ {cancelOrderPaymentInfo.amount.toFixed(2)} manualmente al cliente.
                  </p>
                </div>
              </div>
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
                setCancelOrderPaymentInfo(null);
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

      {/* ══════════════════════════════════════════════════════════
          MODAL DE EXPORTACIÓN
      ══════════════════════════════════════════════════════════ */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Settings2 className="h-5 w-5 text-blue-600" />
              Configurar Reporte
            </DialogTitle>
            <DialogDescription>
              Elige el formato y las columnas que deseas exportar.
              <span className="font-semibold text-blue-700 ml-1">
                ({exportIgnoreFilters ? orders.length : filteredOrders.length} pedidos)
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">

            {/* ── Alcance del reporte ──────────────────── */}
            <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-3 space-y-2">
              <p className="text-sm font-semibold text-blue-800">📋 ¿Qué pedidos exportar?</p>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="exportScope"
                    checked={exportIgnoreFilters}
                    onChange={() => setExportIgnoreFilters(true)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <span className="text-sm font-semibold text-gray-800">
                      Todos los pedidos del día
                      <span className="ml-2 text-blue-700 font-bold">({orders.length})</span>
                    </span>
                    <p className="text-xs text-gray-500">Ignora los filtros activos en pantalla. Recomendado para cocina.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="exportScope"
                    checked={!exportIgnoreFilters}
                    onChange={() => setExportIgnoreFilters(false)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <span className="text-sm font-semibold text-gray-800">
                      Solo vista actual (con filtros)
                      <span className="ml-2 text-gray-600 font-bold">({filteredOrders.length})</span>
                    </span>
                    <p className="text-xs text-gray-500">
                      Exporta solo lo que se ve en pantalla
                      {(searchTerm || selectedStatus !== 'all' || selectedSchool !== 'all') && (
                        <span className="ml-1 text-amber-700 font-semibold">⚠️ Tienes filtros activos</span>
                      )}
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* ── Formato ─────────────────────────────── */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">📄 Formato de exportación</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setExportFormat('pdf')}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                    exportFormat === 'pdf'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <FileText className="h-8 w-8" />
                  <div className="text-left">
                    <p className="font-bold text-sm">PDF</p>
                    <p className="text-xs opacity-70">Para imprimir</p>
                  </div>
                </button>
                <button
                  onClick={() => setExportFormat('excel')}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                    exportFormat === 'excel'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <FileSpreadsheet className="h-8 w-8" />
                  <div className="text-left">
                    <p className="font-bold text-sm">Excel (.xlsx)</p>
                    <p className="text-xs opacity-70">Para analizar</p>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Columnas ────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-700">🗂️ Columnas a incluir</p>
                <div className="flex gap-2">
                  <button
                    className="text-xs text-blue-600 underline"
                    onClick={() => setExportColumns(prev => Object.fromEntries(Object.keys(prev).map(k => [k, true])) as typeof exportColumns)}
                  >Todas</button>
                  <button
                    className="text-xs text-gray-400 underline"
                    onClick={() => setExportColumns(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])) as typeof exportColumns)}
                  >Ninguna</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                {ALL_EXPORT_COLUMNS.map(col => (
                  <div key={col.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`col-${col.key}`}
                      checked={exportColumns[col.key]}
                      onCheckedChange={(v) =>
                        setExportColumns(prev => ({ ...prev, [col.key]: !!v }))
                      }
                    />
                    <Label htmlFor={`col-${col.key}`} className="text-xs cursor-pointer leading-tight">
                      {col.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* ── Botones ─────────────────────────────── */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setShowExportModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => exportFormat === 'pdf' ? exportToPDF() : exportToExcel()}
              disabled={!Object.values(exportColumns).some(Boolean)}
              className={exportFormat === 'pdf' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}
            >
              {exportFormat === 'pdf'
                ? <><FileText className="h-4 w-4 mr-2" /> Descargar PDF</>
                : <><FileSpreadsheet className="h-4 w-4 mr-2" /> Descargar Excel</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
