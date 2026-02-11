import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useViewAsStore } from '@/stores/viewAsStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { YapeLogo } from '@/components/ui/YapeLogo';
import { PlinLogo } from '@/components/ui/PlinLogo';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  DollarSign,
  Users,
  Send,
  Download,
  Copy,
  CheckCircle2,
  Search,
  Filter,
  Calendar,
  Building2,
  Loader2,
  FileText,
  MessageSquare,
  AlertTriangle,
  AlertCircle,
  History,
  Eye,
  User
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { generateBillingPDF } from '@/utils/pdfGenerator';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';

interface School {
  id: string;
  name: string;
  code: string;
}

interface BillingPeriod {
  id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  school_id: string;
}

interface Debtor {
  id: string; // student_id, teacher_id, o 'manual_' + nombre
  client_name: string; // Nombre del deudor (alumno, profesor, o cliente manual)
  client_type: 'student' | 'teacher' | 'manual'; // Tipo de cliente
  parent_id?: string; // Solo para estudiantes
  parent_name?: string; // Solo para estudiantes
  parent_phone?: string; // Solo para estudiantes
  parent_email?: string; // Solo para estudiantes
  school_id: string;
  school_name: string;
  total_amount: number;
  transaction_count: number;
  transactions: any[];
}

export const BillingCollection = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [paidTransactions, setPaidTransactions] = useState<any[]>([]);
  const [loadingPaid, setLoadingPaid] = useState(false);
  const [activeTab, setActiveTab] = useState<'cobrar' | 'pagos'>('cobrar');
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  
  // Filtros
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [untilDate, setUntilDate] = useState<string>(''); // Nueva fecha límite
  
  // Selección múltiple
  const [selectedDebtors, setSelectedDebtors] = useState<Set<string>>(new Set());
  
  // 🆕 Selección de transacciones individuales por deudor
  const [selectedTransactionsByDebtor, setSelectedTransactionsByDebtor] = useState<Map<string, Set<string>>>(new Map());
  
  // Modal de pago
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentDebtor, setCurrentDebtor] = useState<Debtor | null>(null);
  const [paymentData, setPaymentData] = useState({
    paid_amount: 0,
    payment_method: 'efectivo',
    operation_number: '',
    document_type: 'ticket' as 'ticket' | 'boleta' | 'factura',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Modal de envío masivo
  const [showMassiveModal, setShowMassiveModal] = useState(false);
  const [generatingExport, setGeneratingExport] = useState(false);
  const [canViewAllSchools, setCanViewAllSchools] = useState(false);
  const [canCollect, setCanCollect] = useState(false);

  // Verificar permisos al cargar
  useEffect(() => {
    checkPermissions();
  }, [user, role]);

  const checkPermissions = async () => {
    if (!user || !role) return;

    try {
      console.log('🔍 Verificando permisos de Cobranzas/Cobrar para rol:', role);

      // Admin General tiene todos los permisos
      if (role === 'admin_general') {
        setCanViewAllSchools(true);
        setCanCollect(true);
        return;
      }

      // Para otros roles, consultar la BD
      const { data, error } = await supabase
        .from('role_permissions')
        .select(`
          granted,
          permissions (
            module,
            action
          )
        `)
        .eq('role', role)
        .eq('granted', true);

      if (error) {
        console.error('❌ Error consultando permisos:', error);
        return;
      }

      console.log('📦 Permisos obtenidos para Cobrar:', data);

      let canViewAll = false;
      let canCollectPerm = false;

      data?.forEach((perm: any) => {
        const permission = perm.permissions;
        if (permission?.module === 'cobranzas') {
          if (permission.action === 'cobrar_todas_sedes') {
            canCollectPerm = true;
            canViewAll = true;
          } else if (permission.action === 'cobrar_su_sede') {
            canCollectPerm = true;
            canViewAll = false;
          } else if (permission.action === 'cobrar_personalizado') {
            canCollectPerm = true;
            // TODO: Implementar sedes personalizadas
          }
        }
      });

      console.log('✅ Permisos de Cobrar:', { canCollectPerm, canViewAll });
      setCanViewAllSchools(canViewAll);
      setCanCollect(canCollectPerm);

    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  useEffect(() => {
    console.log('🎬 [BillingCollection] Componente montado');
    fetchSchools();
    fetchUserSchool();
  }, []);

  useEffect(() => {
    console.log('🔄 [BillingCollection] selectedSchool o untilDate cambió:', selectedSchool, 'userSchoolId:', userSchoolId, 'canViewAllSchools:', canViewAllSchools, 'untilDate:', untilDate);
    
    // Cargar períodos
    if (selectedSchool) {
      fetchPeriods();
    }
    
    // Cargar deudores:
    // - Si es admin_general (canViewAllSchools), puede cargar inmediatamente
    // - Si NO es admin_general, espera a que userSchoolId esté disponible
    if (canViewAllSchools || (userSchoolId !== null && !canViewAllSchools)) {
      const timer = setTimeout(() => {
        console.log('⏰ [BillingCollection] Ejecutando fetchDebtors después de debounce');
        fetchDebtors();
      }, 300);
      
      return () => {
        console.log('🧹 [BillingCollection] Limpiando timer');
        clearTimeout(timer);
      };
    } else {
      console.log('⏸️ [BillingCollection] Esperando userSchoolId...');
    }
  }, [selectedSchool, userSchoolId, canViewAllSchools, untilDate]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const fetchUserSchool = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      setUserSchoolId(data?.school_id || null);
      
      if (!canViewAllSchools && data?.school_id) {
        setSelectedSchool(data.school_id);
        fetchPeriods(data.school_id);
      }
    } catch (error) {
      console.error('Error fetching user school:', error);
    }
  };

  const fetchPeriods = async (schoolId?: string) => {
    console.log('📅 [BillingCollection] fetchPeriods llamado');
    try {
      const targetSchoolId = schoolId || (canViewAllSchools && selectedSchool !== 'all' ? selectedSchool : userSchoolId);
      
      if (!targetSchoolId && !canViewAllSchools) return;

      let query = supabase
        .from('billing_periods')
        .select('*')
        .eq('status', 'open')
        .order('start_date', { ascending: false });

      if (targetSchoolId) {
        query = query.eq('school_id', targetSchoolId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPeriods(data || []);
    } catch (error) {
      console.error('Error fetching periods:', error);
    }
  };

  const fetchDebtors = async () => {
    try {
      setLoading(true);
      console.log('🔍 [BillingCollection] Iniciando fetchDebtors...');

      // Determinar el school_id a filtrar
      const schoolIdFilter = !canViewAllSchools || selectedSchool !== 'all' 
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;

      console.log('🔍 [BillingCollection] schoolIdFilter:', schoolIdFilter);

      // CONSULTA MEJORADA: Incluir estudiantes, profesores y clientes manuales
      // Solo transacciones PENDIENTES o PARCIALES (NO pagadas)
      let query = supabase
        .from('transactions')
        .select(`
          *,
          students(id, full_name, parent_id),
          teacher_profiles(id, full_name),
          schools(id, name)
        `)
        .eq('type', 'purchase')
        .in('payment_status', ['pending', 'partial']); // Excluir 'paid'

      // Filtrar por fecha límite si está definida
      if (untilDate) {
        const localDate = new Date(untilDate);
        localDate.setHours(23, 59, 59, 999);
        const isoDate = localDate.toISOString();
        query = query.lte('created_at', isoDate);
        console.log('📅 [BillingCollection] Filtrando hasta:', untilDate, '→', isoDate);
      }

      if (schoolIdFilter) {
        query = query.eq('school_id', schoolIdFilter);
      }

      const { data: transactions, error } = await query;

      console.log('📊 [BillingCollection] Transacciones:', { 
        count: transactions?.length || 0,
        error,
        sample: transactions?.[0]
      });

      if (error) {
        console.error('❌ [BillingCollection] Error:', error);
        throw error;
      }

      // 🆕 BUSCAR PEDIDOS DE ALMUERZO CONFIRMADOS SIN TRANSACCIONES
      console.log('🍽️ [BillingCollection] Buscando pedidos de almuerzo sin transacciones...');
      
      let lunchOrdersQuery = supabase
        .from('lunch_orders')
        .select(`
          id,
          order_date,
          student_id,
          teacher_id,
          manual_name,
          school_id,
          category_id,
          students(id, full_name, parent_id, school_id),
          teacher_profiles(id, full_name, school_id_1),
          schools(id, name),
          lunch_categories(id, name, price)
        `)
        .in('status', ['confirmed', 'delivered']) // Pedidos confirmados Y entregados aparecen en cobranzas (si no están pagados)
        .eq('is_cancelled', false);

      // Filtrar por fecha límite si está definida
      if (untilDate) {
        const localDate = new Date(untilDate);
        localDate.setHours(23, 59, 59, 999);
        const dateStr = localDate.toISOString().split('T')[0];
        lunchOrdersQuery = lunchOrdersQuery.lte('order_date', dateStr);
      }

      // NO filtrar por school_id aquí porque los pedidos pueden no tenerlo
      // El filtro se hará después de obtener los datos
      const { data: lunchOrders, error: lunchOrdersError } = await lunchOrdersQuery;

      if (lunchOrdersError) {
        console.error('❌ [BillingCollection] Error fetching lunch orders:', lunchOrdersError);
      } else {
        console.log('🍽️ [BillingCollection] Pedidos de almuerzo encontrados:', lunchOrders?.length || 0);
      }

      // 🔥 FILTRAR TRANSACCIONES DE PEDIDOS CANCELADOS (OPTIMIZADO)
      console.log('🔍 [BillingCollection] Filtrando transacciones de pedidos cancelados...');
      
      // Obtener todos los lunch_order_ids de las transacciones
      const lunchOrderIds = transactions
        ?.map((t: any) => t.metadata?.lunch_order_id)
        .filter(Boolean) || [];
      
      // Si hay transacciones con lunch_order_id, verificar cuáles están cancelados
      let cancelledOrderIds = new Set<string>();
      if (lunchOrderIds.length > 0) {
        const { data: cancelledOrders } = await supabase
          .from('lunch_orders')
          .select('id')
          .in('id', lunchOrderIds)
          .eq('is_cancelled', true);
        
        cancelledOrderIds = new Set(cancelledOrders?.map((o: any) => o.id) || []);
        console.log('❌ [BillingCollection] Pedidos cancelados encontrados:', cancelledOrderIds.size);
      }
      
      // Filtrar transacciones, excluyendo las de pedidos cancelados
      const validTransactions = transactions?.filter((t: any) => {
        if (t.metadata?.lunch_order_id && cancelledOrderIds.has(t.metadata.lunch_order_id)) {
          console.log(`⏭️ [BillingCollection] Transacción ${t.id} es de pedido cancelado, omitiendo`);
          return false;
        }
        return true;
      }) || [];
      
      console.log('✅ [BillingCollection] Transacciones válidas (no canceladas):', validTransactions.length);
      
      // 🔥 BUSCAR TAMBIÉN TRANSACCIONES PAID PARA EVITAR DUPLICADOS
      console.log('💰 [BillingCollection] Buscando transacciones PAID de lunch_orders...');
      const { data: paidLunchTransactions } = await supabase
        .from('transactions')
        .select('id, metadata')
        .eq('type', 'purchase')
        .eq('payment_status', 'paid')
        .not('metadata', 'is', null);
      
      console.log('💰 [BillingCollection] Transacciones PAID encontradas:', paidLunchTransactions?.length || 0);
      
      // Obtener IDs de pedidos que ya tienen transacciones asociadas (PENDING O PAID)
      const existingOrderKeys = new Set<string>();
      
      // Método 1: Por metadata.lunch_order_id (transacciones virtuales convertidas a reales)
      validTransactions.forEach((t: any) => {
        if (t.metadata?.lunch_order_id) {
          existingOrderKeys.add(t.metadata.lunch_order_id);
        }
      });
      
      // Agregar también los IDs de transacciones PAID
      paidLunchTransactions?.forEach((t: any) => {
        if (t.metadata?.lunch_order_id) {
          existingOrderKeys.add(t.metadata.lunch_order_id);
          console.log(`✅ [BillingCollection] Pedido ${t.metadata.lunch_order_id} ya tiene transacción PAID, omitiendo`);
        }
      });
      
      // Método 2: Por coincidencia de teacher_id/student_id + fecha (para transacciones sin metadata)
      lunchOrders?.forEach((order: any) => {
        const orderDate = order.order_date; // Formato: "2026-02-09"
        
        const hasMatchingTransaction = validTransactions.some((t: any) => {
          // Verificar si la transacción coincide con este pedido
          const transDate = t.created_at.split('T')[0]; // Formato: "2026-02-09"
          const descMatches = t.description?.includes('Almuerzo') || t.description?.includes('almuerzo');
          
          if (order.teacher_id && t.teacher_id === order.teacher_id && descMatches) {
            // Para profesores: verificar que la transacción sea del mismo día O del día anterior (por bug de zona horaria)
            const orderDateObj = new Date(orderDate);
            const tranDateObj = new Date(transDate);
            const daysDiff = Math.abs((orderDateObj.getTime() - tranDateObj.getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysDiff <= 1) { // Mismo día o 1 día de diferencia
              return true;
            }
          }
          
          if (order.student_id && t.student_id === order.student_id && transDate === orderDate && descMatches) {
            return true;
          }
          
          return false;
        });
        
        if (hasMatchingTransaction) {
          existingOrderKeys.add(order.id);
          console.log(`✅ [BillingCollection] Pedido ${order.id} tiene transacción real (sin metadata), omitiendo virtual`);
        }
      });
      
      console.log('📋 [BillingCollection] Total de pedidos con transacción (pending o paid):', existingOrderKeys.size);

      // Crear transacciones virtuales para pedidos sin transacciones
      const virtualTransactions: any[] = [];
      
      if (lunchOrders && lunchOrders.length > 0) {
        // Obtener todos los school_ids posibles (del pedido, estudiante o profesor)
        const allSchoolIds = new Set<string>();
        lunchOrders.forEach((o: any) => {
          if (o.school_id) allSchoolIds.add(o.school_id);
          if (o.students?.school_id) allSchoolIds.add(o.students.school_id);
          if (o.teacher_profiles?.school_id_1) allSchoolIds.add(o.teacher_profiles.school_id_1);
        });
        
        const { data: lunchConfigs } = await supabase
          .from('lunch_configuration')
          .select('school_id, lunch_price')
          .in('school_id', Array.from(allSchoolIds));

        const configMap = new Map();
        lunchConfigs?.forEach((c: any) => {
          configMap.set(c.school_id, c.lunch_price);
        });

        lunchOrders.forEach((order: any) => {
          // Verificar si este pedido ya tiene una transacción
          if (existingOrderKeys.has(order.id)) {
            console.log(`⏭️ [BillingCollection] Pedido ${order.id} ya tiene transacción, omitiendo`);
            return; // Saltar este pedido
          }
          
          let price = 0;
          let schoolId = order.school_id;

          // Obtener precio desde categoría o configuración
          if (order.lunch_categories?.price) {
            price = order.lunch_categories.price;
          } else if (schoolId && configMap.has(schoolId)) {
            price = configMap.get(schoolId);
          } else {
            price = 7.50; // Precio por defecto
          }

          // Determinar school_id si no está en el pedido
          if (!schoolId) {
            if (order.students?.school_id) {
              schoolId = order.students.school_id;
            } else if (order.teacher_profiles?.school_id_1) {
              schoolId = order.teacher_profiles.school_id_1;
            }
          }

          // Aplicar filtro de school_id si está configurado (después de determinar el school_id correcto)
          if (schoolIdFilter && schoolId !== schoolIdFilter) {
            console.log(`⏭️ [BillingCollection] Pedido ${order.id} no coincide con filtro de sede (${schoolId} vs ${schoolIdFilter}), omitiendo`);
            return; // Saltar este pedido
          }

          // Crear transacción virtual solo si el pedido tiene un cliente identificado
          if (order.student_id || order.teacher_id || order.manual_name) {
            // Mejorar la descripción para incluir el tipo de menú
            const menuName = order.lunch_categories?.name || order.menu_item || 'Menú';
            const dateFormatted = new Date(order.order_date + 'T12:00:00').toLocaleDateString('es-PE', { 
              day: 'numeric', 
              month: 'long',
              year: 'numeric'
            });
            
            virtualTransactions.push({
              id: `lunch_${order.id}`, // ID virtual
              type: 'purchase',
              amount: -Math.abs(price), // Negativo = deuda
              payment_status: 'pending',
              description: `Almuerzo - ${menuName} - ${dateFormatted}`,
              student_id: order.student_id || null,
              teacher_id: order.teacher_id || null,
              manual_client_name: order.manual_name || null,
              school_id: schoolId,
              created_at: order.order_date || new Date().toISOString(),
              students: order.students || null,
              teacher_profiles: order.teacher_profiles || null,
              schools: order.schools || null,
              metadata: { 
                lunch_order_id: order.id, 
                source: 'lunch_order',
                order_date: order.order_date,
                menu_name: menuName
              }
            });
          }
        });

        console.log('💰 [BillingCollection] Transacciones virtuales creadas:', virtualTransactions.length);
      }

      // Combinar transacciones reales (ya filtradas arriba) con virtuales
      const allTransactions = [...validTransactions, ...virtualTransactions];

      // Obtener IDs únicos de padres (solo para estudiantes)
      const parentIds = [...new Set(allTransactions
        .filter((t: any) => t.student_id && t.students?.parent_id)
        .map((t: any) => t.students.parent_id)
        .filter(Boolean))];

      console.log('👤 [BillingCollection] Parent IDs:', parentIds);

      // Obtener datos de los padres (solo si hay parentIds)
      let parentProfiles: any[] = [];
      if (parentIds.length > 0) {
        const { data, error: parentError } = await supabase
          .from('parent_profiles')
          .select('user_id, full_name, phone_1')
          .in('user_id', parentIds);

        if (parentError) {
          console.error('❌ [BillingCollection] Error fetching parent profiles:', parentError);
        } else {
          parentProfiles = data || [];
          console.log('👤 [BillingCollection] Parent profiles encontrados:', parentProfiles.length);
        }
      }

      // Crear mapa de padres para acceso rápido
      const parentMap = new Map();
      parentProfiles?.forEach((p: any) => {
        parentMap.set(p.user_id, p);
      });

      console.log('🗺️ [BillingCollection] Parent map size:', parentMap.size);

      // Agrupar por cliente (estudiante, profesor, o manual)
      const debtorsMap: { [key: string]: Debtor } = {};

      allTransactions?.forEach((transaction: any) => {
        let clientId: string;
        let clientName: string;
        let clientType: 'student' | 'teacher' | 'manual';
        let parentData = null;

        // Determinar el tipo de cliente
        if (transaction.student_id && transaction.students) {
          // Estudiante
          clientId = transaction.student_id;
          clientName = transaction.students.full_name;
          clientType = 'student';
          parentData = parentMap.get(transaction.students.parent_id);
        } else if (transaction.teacher_id && transaction.teacher_profiles) {
          // Profesor
          clientId = transaction.teacher_id;
          clientName = transaction.teacher_profiles.full_name;
          clientType = 'teacher';
        } else if (transaction.manual_client_name) {
          // Cliente manual (sin cuenta)
          clientId = `manual_${transaction.manual_client_name}`;
          clientName = transaction.manual_client_name;
          clientType = 'manual';
        } else {
          // Transacción sin cliente identificado, saltar
          return;
        }

        if (!debtorsMap[clientId]) {
          debtorsMap[clientId] = {
            id: clientId,
            client_name: clientName,
            client_type: clientType,
            parent_id: parentData?.user_id || '',
            parent_name: parentData?.full_name || '',
            parent_phone: parentData?.phone_1 || '',
            parent_email: '', // Email no disponible por ahora
            school_id: transaction.school_id,
            school_name: transaction.schools?.name || '',
            total_amount: 0,
            transaction_count: 0,
            transactions: [],
          };
        }

        debtorsMap[clientId].total_amount += Math.abs(transaction.amount);
        debtorsMap[clientId].transaction_count += 1;
        debtorsMap[clientId].transactions.push(transaction);
      });

      const debtorsArray = Object.values(debtorsMap);
      console.log('👥 [BillingCollection] Deudores encontrados:', debtorsArray.length);
      console.log('👥 [BillingCollection] Muestra:', debtorsArray[0]);
      
      setDebtors(debtorsArray);
    } catch (error) {
      console.error('Error fetching debtors:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los deudores',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredDebtors = debtors.filter(debtor => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      debtor.client_name.toLowerCase().includes(search) ||
      debtor.parent_name?.toLowerCase().includes(search) ||
      debtor.parent_email?.toLowerCase().includes(search)
    );
  });

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedDebtors);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDebtors(newSelected);
  };

  const selectAll = () => {
    if (selectedDebtors.size === filteredDebtors.length) {
      setSelectedDebtors(new Set());
    } else {
      setSelectedDebtors(new Set(filteredDebtors.map(d => d.id)));
    }
  };

  const handleOpenPayment = (debtor: Debtor) => {
    // 🆕 Filtrar solo transacciones seleccionadas (si hay alguna seleccionada)
    const debtorKey = debtor.student_id || debtor.teacher_id || debtor.manual_client_name || '';
    const selectedTxIds = selectedTransactionsByDebtor.get(debtorKey);
    
    let transactionsToPayAmount: number;
    let transactionsToPay: any[];
    
    if (selectedTxIds && selectedTxIds.size > 0) {
      // Si hay transacciones seleccionadas, cobrar solo esas
      transactionsToPay = debtor.transactions.filter((t: any) => selectedTxIds.has(t.id));
      transactionsToPayAmount = transactionsToPay.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
      console.log(`💰 Cobrando ${selectedTxIds.size} transacciones seleccionadas: S/ ${transactionsToPayAmount}`);
    } else {
      // Si no hay selección, cobrar todas
      transactionsToPay = debtor.transactions;
      transactionsToPayAmount = debtor.total_amount;
      console.log(`💰 Cobrando todas las transacciones: S/ ${transactionsToPayAmount}`);
    }
    
    // Guardar el deudor con las transacciones filtradas
    setCurrentDebtor({
      ...debtor,
      transactions: transactionsToPay,
      total_amount: transactionsToPayAmount
    });
    
    setPaymentData({
      paid_amount: transactionsToPayAmount, // Por defecto pago completo de las seleccionadas
      payment_method: 'efectivo',
      operation_number: '',
      document_type: 'ticket',
      notes: '',
    });
    setShowPaymentModal(true);
  };

  const handleRegisterPayment = async () => {
    if (!currentDebtor || !user) return;

    if (paymentData.paid_amount <= 0 || paymentData.paid_amount > currentDebtor.total_amount) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El monto debe ser mayor a 0 y menor o igual al total',
      });
      return;
    }

    // ✅ VALIDACIÓN: Número de operación obligatorio (excepto efectivo)
    if (['yape', 'plin', 'transferencia', 'tarjeta'].includes(paymentData.payment_method) && !paymentData.operation_number) {
      toast({
        variant: 'destructive',
        title: 'Número de Operación Obligatorio',
        description: 'Debe ingresar el número de operación para este método de pago',
      });
      return;
    }

    setSaving(true);
    
    try {
      console.log('💰 [BillingCollection] Iniciando registro de pago...', currentDebtor);
      
      // Separar transacciones reales de virtuales
      const realTransactions = currentDebtor.transactions.filter((t: any) => 
        !t.id?.toString().startsWith('lunch_')
      );
      const virtualTransactions = currentDebtor.transactions.filter((t: any) => 
        t.id?.toString().startsWith('lunch_')
      );
      
      console.log('📊 [BillingCollection] Transacciones reales:', realTransactions.length, 'virtuales:', virtualTransactions.length);

      // 1. ACTUALIZAR transacciones reales existentes (que ya están en la BD)
      if (realTransactions.length > 0) {
        const realIds = realTransactions.map((t: any) => t.id);
        console.log('🔄 [BillingCollection] Actualizando transacciones reales:', realIds);

        const { error: updateError } = await supabase
          .from('transactions')
          .update({
            payment_status: 'paid',
            payment_method: paymentData.payment_method,
            operation_number: paymentData.operation_number || null,
          })
          .in('id', realIds);

        if (updateError) {
          console.error('❌ [BillingCollection] Error actualizando transacciones:', updateError);
          throw updateError;
        }
        
        console.log('✅ [BillingCollection] Transacciones reales actualizadas:', realIds.length);
      }

      // 2. CREAR transacciones reales NUEVAS para las virtuales (pedidos de almuerzo sin transacción)
      if (virtualTransactions.length > 0) {
        console.log('💰 [BillingCollection] Creando transacciones reales para pedidos de almuerzo...');
        
        const transactionsToCreate = virtualTransactions.map((vt: any) => {
          const transaction: any = {
            type: 'purchase',
            amount: vt.amount,
            payment_status: 'paid',
            payment_method: paymentData.payment_method,
            operation_number: paymentData.operation_number || null,
            description: vt.description,
            student_id: vt.student_id || null,
            teacher_id: vt.teacher_id || null,
            manual_client_name: vt.manual_client_name || null,
            school_id: vt.school_id,
            created_at: vt.created_at,
          };
          
          // Agregar metadata con lunch_order_id
          if (vt.metadata) {
            transaction.metadata = vt.metadata;
          }
          
          return transaction;
        });

        const { data: createdTransactions, error: createError } = await supabase
          .from('transactions')
          .insert(transactionsToCreate)
          .select();

        if (createError) {
          console.error('❌ [BillingCollection] Error creando transacciones:', createError);
          throw createError;
        }

        console.log('✅ [BillingCollection] Transacciones nuevas creadas:', createdTransactions?.length);
      }

      toast({
        title: '✅ Pago registrado',
        description: `Se registró el pago de S/ ${paymentData.paid_amount.toFixed(2)} con ${paymentData.payment_method}`,
      });

      // Cerrar modal y limpiar
      setShowPaymentModal(false);
      setCurrentDebtor(null);
      setPaymentData({
        paid_amount: 0,
        payment_method: 'efectivo',
        operation_number: '',
        document_type: 'ticket',
        notes: '',
      });
      
      // Recargar deudores para actualizar la lista
      console.log('🔄 [BillingCollection] Recargando deudores después del pago...');
      await fetchDebtors();
    } catch (error: any) {
      console.error('Error registering payment:', error);
      toast({
        variant: 'destructive',
        title: 'Error al registrar pago',
        description: error.message || 'Error desconocido',
      });
    } finally {
      setSaving(false);
    }
  };

  const copyMessage = (debtor: Debtor) => {
    const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
    const periodText = period ? `del período: ${period.period_name}` : 'pendiente';
    
    let clientLine = '';
    let recipientLine = '';
    
    if (debtor.client_type === 'student') {
      clientLine = `El alumno *${debtor.client_name}* tiene un consumo ${periodText}`;
      recipientLine = `Estimado(a) ${debtor.parent_name || 'Padre/Madre de familia'}`;
    } else if (debtor.client_type === 'teacher') {
      clientLine = `El profesor *${debtor.client_name}* tiene un consumo ${periodText}`;
      recipientLine = `Estimado(a) Profesor(a) ${debtor.client_name}`;
    } else {
      clientLine = `*${debtor.client_name}* tiene un consumo ${periodText}`;
      recipientLine = `Estimado(a) ${debtor.client_name}`;
    }
    
    const message = `🔔 *COBRANZA LIMA CAFÉ 28*

${recipientLine}

${clientLine}

💰 Monto Total: S/ ${debtor.total_amount.toFixed(2)}

📎 Adjuntamos el detalle completo.

Para pagar, contacte con administración.
Gracias.`;

    navigator.clipboard.writeText(message);
    toast({
      title: '📋 Mensaje copiado',
      description: 'El mensaje se copió al portapapeles',
    });
  };

  const generatePDF = async (debtor: Debtor) => {
    const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
    
    let periodName: string;
    let startDate: string;
    let endDate: string;
    
    if (period) {
      periodName = period.period_name;
      startDate = period.start_date;
      endDate = period.end_date;
    } else {
      // Usar las fechas de las transacciones
      periodName = 'Cuenta Pendiente';
      const dates = debtor.transactions.map(t => new Date(t.created_at));
      if (dates.length > 0) {
        startDate = new Date(Math.min(...dates.map(d => d.getTime()))).toISOString();
        endDate = new Date(Math.max(...dates.map(d => d.getTime()))).toISOString();
      } else {
        const now = new Date().toISOString();
        startDate = now;
        endDate = now;
      }
    }

    // Intentar obtener el logo en base64
    let logoBase64 = '';
    try {
      const response = await fetch(limaCafeLogo);
      const blob = await response.blob();
      logoBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error cargando logo para PDF:', error);
    }

    generateBillingPDF({
      student_name: debtor.client_name,
      parent_name: debtor.parent_name,
      parent_phone: debtor.parent_phone,
      school_name: debtor.school_name,
      period_name: periodName,
      start_date: startDate,
      end_date: endDate,
      transactions: debtor.transactions.map(t => ({
        id: t.id,
        created_at: t.created_at,
        ticket_code: t.ticket_code,
        description: t.description || 'Consumo',
        amount: t.amount,
      })),
      total_amount: debtor.total_amount,
      pending_amount: debtor.total_amount,
      logo_base64: logoBase64
    });

    toast({
      title: '✅ PDF generado',
      description: `Estado de cuenta de ${debtor.client_name}`,
    });
  };

  const generateWhatsAppExport = () => {
    const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
    const selectedDebtorsList = filteredDebtors.filter(d => selectedDebtors.has(d.id));

    if (selectedDebtorsList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos un deudor',
      });
      return;
    }

    // Generar intervalos aleatorios entre 15 y 300 segundos
    const messages = selectedDebtorsList.map((debtor, index) => {
      const delay = Math.floor(Math.random() * (300 - 15 + 1)) + 15; // 15-300 segundos

      return {
        index: index + 1,
        phone: debtor.parent_phone,
        parent_name: debtor.parent_name,
        student_name: debtor.client_name,
        amount: debtor.total_amount.toFixed(2),
        period: period?.period_name || 'Cuenta Pendiente',
        message: `🔔 *COBRANZA LIMA CAFÉ 28*\n\nEstimado(a) ${debtor.parent_name}\n\nEl alumno *${debtor.student_name}* tiene un consumo pendiente${period ? ` del período: ${period.period_name}` : ''}\n\n💰 Monto Total: S/ ${debtor.total_amount.toFixed(2)}\n\n📎 Adjuntamos el detalle completo.\n\nPara pagar, contacte con administración.\nGracias.`,
        delay_seconds: delay,
        pdf_url: '', // Se generará después
      };
    });

    // Descargar como JSON
    const dataStr = JSON.stringify(messages, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cobranzas_${period?.period_name || 'todas'}_${format(new Date(), 'yyyyMMdd_HHmmss')}.json`;
    link.click();

    toast({
      title: '✅ Exportación generada',
      description: `${messages.length} mensajes con intervalos aleatorios (15-300 seg)`,
    });
  };

  const generateMassivePDFs = async () => {
    const selectedDebtorsList = filteredDebtors.filter(d => selectedDebtors.has(d.id));

    if (selectedDebtorsList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos un deudor',
      });
      return;
    }

    toast({
      title: '📄 Generando PDFs...',
      description: `Procesando ${selectedDebtorsList.length} documento(s)`,
    });

    // Cargar logo una sola vez
    let logoBase64 = '';
    try {
      const response = await fetch(limaCafeLogo);
      const blob = await response.blob();
      logoBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error cargando logo:', error);
    }

    // Generar PDFs con pequeño delay entre cada uno
    for (let i = 0; i < selectedDebtorsList.length; i++) {
      const debtor = selectedDebtorsList[i];
      
      const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
      const periodName = period ? period.period_name : 'Todas las deudas';
      
      // Calcular fechas reales basadas en las transacciones si no hay período
      let startDate: string;
      let endDate: string;
      
      if (period) {
        startDate = period.start_date;
        endDate = period.end_date;
      } else {
        // Usar las fechas de las transacciones del deudor
        const dates = debtor.transactions.map(t => new Date(t.created_at));
        if (dates.length > 0) {
          startDate = new Date(Math.min(...dates.map(d => d.getTime()))).toISOString();
          endDate = new Date(Math.max(...dates.map(d => d.getTime()))).toISOString();
        } else {
          // Fallback: usar fecha actual
          const now = new Date().toISOString();
          startDate = now;
          endDate = now;
        }
      }

      generateBillingPDF({
        student_name: debtor.client_name,
        parent_name: debtor.parent_name,
        parent_phone: debtor.parent_phone,
        school_name: debtor.school_name,
        period_name: periodName,
        start_date: startDate,
        end_date: endDate,
        transactions: debtor.transactions.map(t => ({
          id: t.id,
          created_at: t.created_at,
          ticket_code: t.ticket_code,
          description: t.description || 'Consumo',
          amount: t.amount,
        })),
        total_amount: debtor.total_amount,
        pending_amount: debtor.total_amount,
        logo_base64: logoBase64
      });

      // Pequeño delay entre PDFs para evitar bloqueo del navegador
      if (i < selectedDebtorsList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    toast({
      title: '✅ PDFs generados',
      description: `Se generaron ${selectedDebtorsList.length} documentos exitosamente`,
    });
  };

  const currentPeriod = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;

  // Función para obtener el cargo y descripción completa del usuario
  const getUserRoleDescription = (profile: any, schoolName: string) => {
    if (!profile) return null;
    
    const name = profile.full_name || profile.email || 'Usuario';
    // Usar el school_name del perfil si existe, si no, usar el que viene de la transacción
    const finalSchoolName = profile.school_name || profile.teacher_school_name || schoolName;
    let roleDescription = '';
    
    switch (profile.role) {
      case 'admin_general':
        roleDescription = `Administrador General`;
        break;
      case 'supervisor_red':
        roleDescription = `Supervisor de Red`;
        break;
      case 'gestor_unidad':
        roleDescription = `Gestor de Unidad - ${finalSchoolName}`;
        break;
      case 'operador_caja':
        roleDescription = `Cajero - ${finalSchoolName}`;
        break;
      case 'kitchen':
        roleDescription = `Cocina - ${finalSchoolName}`;
        break;
      case 'teacher':
        roleDescription = `Profesor - ${finalSchoolName}`;
        break;
      case 'parent':
        roleDescription = `Padre de Familia`;
        break;
      default:
        // Para roles desconocidos, mostrar el rol tal cual
        roleDescription = `${profile.role || 'Usuario'} - ${finalSchoolName}`;
    }
    
    return {
      name,
      role: roleDescription,
      fullDescription: `${name} (${roleDescription})`
    };
  };

  // Función para obtener pagos realizados
  const fetchPaidTransactions = async () => {
    try {
      setLoadingPaid(true);
      
      const schoolIdFilter = !canViewAllSchools || selectedSchool !== 'all' 
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;

      let query = supabase
        .from('transactions')
        .select(`
          *,
          students(id, full_name, parent_id),
          teacher_profiles(id, full_name),
          schools(id, name)
        `)
        .eq('type', 'purchase')
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: false });

      if (schoolIdFilter) {
        query = query.eq('school_id', schoolIdFilter);
      }

      // Filtrar por fecha si está definida
      if (untilDate) {
        const localDate = new Date(untilDate);
        localDate.setHours(23, 59, 59, 999);
        const isoDate = localDate.toISOString();
        query = query.lte('created_at', isoDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // 🔥 FILTRAR TRANSACCIONES DE PEDIDOS CANCELADOS (OPTIMIZADO)
      const lunchOrderIds = data
        ?.map((t: any) => t.metadata?.lunch_order_id)
        .filter(Boolean) || [];
      
      let cancelledOrderIds = new Set<string>();
      if (lunchOrderIds.length > 0) {
        const { data: cancelledOrders } = await supabase
          .from('lunch_orders')
          .select('id')
          .in('id', lunchOrderIds)
          .eq('is_cancelled', true);
        
        cancelledOrderIds = new Set(cancelledOrders?.map((o: any) => o.id) || []);
      }
      
      const validTransactions = data?.filter((t: any) => {
        if (t.metadata?.lunch_order_id && cancelledOrderIds.has(t.metadata.lunch_order_id)) {
          return false;
        }
        return true;
      }) || [];

      // 🆕 Obtener información del creador (created_by) manualmente
      const userIds = [...new Set(validTransactions.map((t: any) => t.created_by).filter(Boolean))];
      let createdByMap = new Map();
      
      if (userIds.length > 0) {
        // Buscar en profiles con school_id
        const { data: profiles } = await supabase
          .from('profiles')
          .select(`
            id, 
            full_name, 
            email, 
            role, 
            school_id,
            schools:school_id(id, name)
          `)
          .in('id', userIds);
        
        if (profiles) {
          profiles.forEach((p: any) => {
            createdByMap.set(p.id, {
              ...p,
              school_name: p.schools?.name || null
            });
          });
        }

        // También buscar en teacher_profiles por si el created_by es un profesor
        const { data: teacherProfiles } = await supabase
          .from('teacher_profiles')
          .select('id, full_name, school_id, schools:school_id(id, name)')
          .in('id', userIds);
        
        if (teacherProfiles) {
          teacherProfiles.forEach((tp: any) => {
            // Si ya existe en profiles, enriquecer con datos de teacher
            if (createdByMap.has(tp.id)) {
              const existing = createdByMap.get(tp.id);
              createdByMap.set(tp.id, {
                ...existing,
                teacher_school_name: tp.schools?.name || null,
                teacher_school_id: tp.school_id
              });
            } else {
              // Si no existe en profiles, agregarlo como teacher
              createdByMap.set(tp.id, {
                id: tp.id,
                full_name: tp.full_name,
                role: 'teacher',
                school_id: tp.school_id,
                school_name: tp.schools?.name || null
              });
            }
          });
        }
      }

      // Agregar la información del creador a cada transacción
      const transactionsWithCreator = validTransactions.map((t: any) => ({
        ...t,
        created_by_profile: createdByMap.get(t.created_by) || null
      }));

      console.log('[BillingCollection] 📊 Transacciones cargadas:', transactionsWithCreator.length);
      console.log('[BillingCollection] 🔍 Ejemplo de transacción completa:', transactionsWithCreator[0]);
      console.log('[BillingCollection] 👤 created_by_profile:', transactionsWithCreator[0]?.created_by_profile);
      console.log('[BillingCollection] 🗺️ Mapa de creadores (primeros 3):', Array.from(createdByMap.entries()).slice(0, 3));

      setPaidTransactions(transactionsWithCreator);
    } catch (error) {
      console.error('Error fetching paid transactions:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pagos realizados',
        variant: 'destructive',
      });
    } finally {
      setLoadingPaid(false);
    }
  };

  // Cargar pagos realizados cuando cambia la pestaña
  useEffect(() => {
    if (activeTab === 'pagos' && (canViewAllSchools || userSchoolId)) {
      fetchPaidTransactions();
    }
  }, [activeTab, selectedSchool, untilDate, canViewAllSchools, userSchoolId]);

  // Generar comprobante de pago en PDF
  const generatePaymentReceipt = async (transaction: any) => {
    try {
      const doc = new jsPDF();
      
      // Cargar logo
      let logoBase64 = '';
      try {
        const response = await fetch(limaCafeLogo);
        const blob = await response.blob();
        logoBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        console.error('Error cargando logo:', error);
      }

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;

      // Logo y header
      if (logoBase64) {
        doc.addImage(logoBase64, 'PNG', 15, 15, 30, 30);
      }

      // Título
      doc.setFontSize(20);
      doc.setTextColor(34, 139, 34); // Verde
      doc.text('COMPROBANTE DE PAGO', pageWidth / 2, 25, { align: 'center' });

      // Subtítulo
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text('Lima Café - Sistema de Cobranzas', pageWidth / 2, 32, { align: 'center' });

      // Línea separadora
      doc.setDrawColor(34, 139, 34);
      doc.setLineWidth(0.5);
      doc.line(15, 50, pageWidth - 15, 50);

      // Información del pago
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      
      let yPos = 60;
      
      // Fecha de pago
      doc.setFont('helvetica', 'bold');
      doc.text('FECHA DE PAGO:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(format(new Date(transaction.created_at), "dd/MM/yyyy", { locale: es }), 70, yPos);
      yPos += 7;

      // Hora de pago
      doc.setFont('helvetica', 'bold');
      doc.text('HORA DE PAGO:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(format(new Date(transaction.created_at), "HH:mm:ss", { locale: es }), 70, yPos);
      yPos += 7;

      // Cliente
      const clientName = transaction.students?.full_name || 
                        transaction.teacher_profiles?.full_name || 
                        transaction.manual_client_name || 
                        'Cliente Generico Sin Cuenta';
      doc.setFont('helvetica', 'bold');
      doc.text('CLIENTE:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(clientName, 70, yPos);
      yPos += 7;

      // Tipo de cliente
      const clientType = transaction.student_id ? 'Estudiante' : 
                        transaction.teacher_id ? 'Profesor' : 
                        transaction.manual_client_name ? 'Cliente Sin Cuenta' : 'Cliente Generico Sin Cuenta';
      doc.setFont('helvetica', 'bold');
      doc.text('CATEGORIA:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(clientType, 70, yPos);
      yPos += 7;

      // Sede
      const schoolName = transaction.schools?.name || 'Sin sede';
      doc.setFont('helvetica', 'bold');
      doc.text('SEDE:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(schoolName, 70, yPos);
      yPos += 7;

      // Registrado por (si existe) - CON CARGO COMPLETO
      if (transaction.created_by_profile) {
        const userInfo = getUserRoleDescription(
          transaction.created_by_profile, 
          transaction.schools?.name || 'Sin sede'
        );
        if (userInfo) {
          doc.setFont('helvetica', 'bold');
          doc.text('REGISTRADO POR:', 15, yPos);
          doc.setFont('helvetica', 'normal');
          doc.text(userInfo.name, 70, yPos);
          yPos += 7;

          doc.setFont('helvetica', 'bold');
          doc.text('CARGO:', 15, yPos);
          doc.setFont('helvetica', 'normal');
          const roleText = doc.splitTextToSize(userInfo.role, pageWidth - 80);
          doc.text(roleText, 70, yPos);
          yPos += 7 * roleText.length;
        }
      }

      // Método de pago
      doc.setFont('helvetica', 'bold');
      doc.text('MÉTODO DE PAGO:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text((transaction.payment_method || 'No especificado').toUpperCase(), 70, yPos);
      yPos += 7;

      // Número de operación (si existe)
      if (transaction.operation_number) {
        doc.setFont('helvetica', 'bold');
        doc.text('Nº OPERACIÓN:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.operation_number, 70, yPos);
        yPos += 7;
      }

      // Tipo de documento (si existe)
      if (transaction.document_type) {
        doc.setFont('helvetica', 'bold');
        doc.text('TIPO DOCUMENTO:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.document_type.toUpperCase(), 70, yPos);
        yPos += 7;
      }

      yPos += 3;

      // 🍽️ DETALLE DE CONSUMO - MUY DESTACADO CON RECUADRO AZUL
      doc.setFillColor(59, 130, 246); // Azul
      doc.rect(15, yPos - 2, pageWidth - 30, 8, 'F');
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('🍽️ DETALLE DE CONSUMO', 18, yPos + 4);
      
      yPos += 12;
      
      // Descripción del consumo en recuadro blanco
      doc.setFillColor(240, 245, 255); // Azul muy claro
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.5);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      const description = transaction.description || 'Sin descripción';
      const descriptionLines = doc.splitTextToSize(description, pageWidth - 40);
      const descHeight = descriptionLines.length * 5 + 8;
      
      doc.rect(15, yPos - 2, pageWidth - 30, descHeight, 'FD');
      doc.text(descriptionLines, 20, yPos + 3);
      yPos += descHeight + 5;

      // Línea separadora
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(15, yPos, pageWidth - 15, yPos);
      yPos += 10;

      // Monto pagado (destacado)
      doc.setFillColor(34, 139, 34);
      doc.rect(15, yPos - 5, pageWidth - 30, 15, 'F');
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('MONTO PAGADO:', 20, yPos + 5);
      doc.setFontSize(18);
      doc.text(`S/ ${Math.abs(transaction.amount).toFixed(2)}`, pageWidth - 20, yPos + 5, { align: 'right' });
      
      yPos += 25;

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.setFont('helvetica', 'italic');
      
      const footerY = pageHeight - 30;
      doc.text('Este es un comprobante interno generado por el sistema Lima Café', pageWidth / 2, footerY, { align: 'center' });
      doc.text(`Generado el: ${format(new Date(), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}`, pageWidth / 2, footerY + 5, { align: 'center' });
      doc.text('Para consultas: contacto@limacafe.pe', pageWidth / 2, footerY + 10, { align: 'center' });

      // Guardar PDF
      const fileName = `Comprobante_Pago_${clientName.replace(/\s+/g, '_')}_${format(new Date(transaction.created_at), 'ddMMyyyy_HHmm')}.pdf`;
      doc.save(fileName);

      toast({
        title: '✅ Comprobante generado',
        description: `Se descargó el comprobante de pago exitosamente`,
      });
    } catch (error) {
      console.error('Error generando comprobante:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo generar el comprobante de pago',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Alerta de API SUNAT no conectado */}
      <Alert className="bg-amber-50 border-amber-200">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <AlertDescription className="text-amber-900">
          <strong>⚠️ API de Facturación SUNAT aún no conectado</strong>
          <br />
          Por el momento, los documentos se generarán como comprobantes internos. 
          Próximamente se habilitará la facturación electrónica oficial.
        </AlertDescription>
      </Alert>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Sede */}
            {canViewAllSchools && (
              <div className="space-y-2">
                <Label>Sede</Label>
                <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las Sedes</SelectItem>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Período (OPCIONAL) */}
            <div className="space-y-2">
              <Label>Período de Cobranza (Opcional)</Label>
              <Select value={selectedPeriod || 'all'} onValueChange={(value) => setSelectedPeriod(value === 'all' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las deudas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las deudas</SelectItem>
                  {periods.map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.period_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* NUEVO: Filtro de fecha límite */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Cobrar hasta:
              </Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="flex-1"
                  placeholder="Seleccionar fecha límite"
                />
                <Button
                  variant="default"
                  className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
                  onClick={() => {
                    const today = new Date();
                    const localDate = today.toISOString().split('T')[0];
                    setUntilDate(localDate);
                  }}
                >
                  📅 Hasta Hoy
                </Button>
              </div>
              {untilDate && (
                <p className="text-xs text-gray-500">
                  Filtrando hasta el {format(new Date(untilDate + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })} 
                  {(() => {
                    const today = new Date();
                    const filterDate = new Date(untilDate + 'T00:00:00');
                    if (filterDate < today) {
                      return ' ⚠️ (Puede que falten pedidos de fechas posteriores)';
                    }
                    return '';
                  })()}
                </p>
              )}
            </div>

            {/* Buscador */}
            <div className="space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Estudiante, padre..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-red-600" />
          <p className="ml-3 text-gray-600">Cargando deudores...</p>
        </div>
      ) : (
        <>
          {/* Acciones masivas */}
          {filteredDebtors.length > 0 && (
            <Card className="bg-gradient-to-r from-orange-50 to-red-50 border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={selectedDebtors.size === filteredDebtors.length && filteredDebtors.length > 0}
                      onCheckedChange={selectAll}
                    />
                    <span className="font-semibold text-gray-900">
                      {selectedDebtors.size} de {filteredDebtors.length} seleccionados
                    </span>
                    <Badge variant="secondary">
                      Total: S/ {filteredDebtors
                        .filter(d => selectedDebtors.has(d.id))
                        .reduce((sum, d) => sum + d.total_amount, 0)
                        .toFixed(2)}
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedDebtors.size === 0}
                      onClick={generateWhatsAppExport}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Exportar WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedDebtors.size === 0}
                      onClick={generateMassivePDFs}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      PDFs Masivos
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pestañas: Cobrar / Pagos Realizados */}
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'cobrar' | 'pagos')} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="cobrar" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                ¡Cobrar!
              </TabsTrigger>
              <TabsTrigger value="pagos" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Pagos Realizados
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cobrar" className="mt-0">
              {/* Lista de deudores */}
              {filteredDebtors.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  ¡Sin deudas pendientes!
                </h3>
                <p className="text-gray-500">
                  No hay consumos sin facturar en el período seleccionado
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredDebtors.map((debtor) => {
                // Calcular fechas mín y máx de las transacciones
                const dates = debtor.transactions.map(t => new Date(t.created_at));
                const minDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
                const maxDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

                return (
                  <Card key={debtor.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-red-500">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <Checkbox
                          checked={selectedDebtors.has(debtor.id)}
                          onCheckedChange={() => toggleSelection(debtor.id)}
                          className="mt-1"
                        />

                        <div className="flex-1">
                          {/* Header con nombre y monto */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-bold text-xl text-gray-900">{debtor.client_name}</h3>
                                {debtor.client_type === 'teacher' && (
                                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                    👨‍🏫 Profesor
                                  </Badge>
                                )}
                                {debtor.client_type === 'manual' && (
                                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                    📝 Sin Cuenta
                                  </Badge>
                                )}
                              </div>
                              {debtor.client_type === 'student' && debtor.parent_name && (
                                <>
                                  <p className="text-sm text-gray-600 mt-1">
                                    👤 Padre: <span className="font-semibold">{debtor.parent_name}</span>
                                  </p>
                                  {debtor.parent_phone && (
                                    <p className="text-sm text-gray-600">
                                      📱 {debtor.parent_phone}
                                    </p>
                                  )}
                                </>
                              )}
                              {/* SIEMPRE mostrar la sede */}
                              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 mt-1 bg-blue-50 px-2 py-1 rounded-md inline-flex">
                                <Building2 className="h-4 w-4" />
                                {debtor.school_name}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-3xl font-bold text-red-600">
                                S/ {debtor.total_amount.toFixed(2)}
                              </p>
                              <Badge variant="destructive" className="mt-1">
                                {debtor.transaction_count} consumo(s)
                              </Badge>
                            </div>
                          </div>

                          {/* Información de fechas y comprobantes */}
                          <div className="bg-gray-50 rounded-lg p-3 mb-3 space-y-2">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-gray-500">📅 Primer consumo:</p>
                                <p className="font-semibold text-gray-900">
                                  {minDate ? format(minDate, "dd/MM/yyyy 'a las' HH:mm", { locale: es }) : 'N/A'}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500">📅 Último consumo:</p>
                                <p className="font-semibold text-gray-900">
                                  {maxDate ? format(maxDate, "dd/MM/yyyy 'a las' HH:mm", { locale: es }) : 'N/A'}
                                </p>
                              </div>
                            </div>
                            
                            {/* Desglose de transacciones */}
                            <details className="cursor-pointer">
                              <summary className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                                Ver detalles de {debtor.transaction_count} transacción(es) ▼
                              </summary>
                              <div className="mt-2">
                                {/* Botón para seleccionar todas */}
                                <button
                                  onClick={() => {
                                    const debtorKey = debtor.student_id || debtor.teacher_id || debtor.manual_client_name || '';
                                    const newMap = new Map(selectedTransactionsByDebtor);
                                    const currentSelection = newMap.get(debtorKey);
                                    const allSelected = currentSelection && currentSelection.size === debtor.transactions.length;
                                    
                                    if (allSelected) {
                                      // Deseleccionar todas
                                      newMap.set(debtorKey, new Set());
                                    } else {
                                      // Seleccionar todas
                                      const allTxIds = new Set(debtor.transactions.map((t: any) => t.id));
                                      newMap.set(debtorKey, allTxIds);
                                    }
                                    
                                    setSelectedTransactionsByDebtor(newMap);
                                  }}
                                  className="text-xs text-blue-600 hover:text-blue-700 underline mb-2"
                                >
                                  {(() => {
                                    const debtorKey = debtor.student_id || debtor.teacher_id || debtor.manual_client_name || '';
                                    const currentSelection = selectedTransactionsByDebtor.get(debtorKey);
                                    const allSelected = currentSelection && currentSelection.size === debtor.transactions.length;
                                    return allSelected ? 'Deseleccionar todas' : 'Seleccionar todas';
                                  })()}
                                </button>
                                
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {debtor.transactions.map((t: any, idx: number) => {
                                    const debtorKey = debtor.student_id || debtor.teacher_id || debtor.manual_client_name || '';
                                    const isSelected = selectedTransactionsByDebtor.get(debtorKey)?.has(t.id) || false;
                                    
                                    return (
                                      <div key={t.id} className="text-xs bg-white p-2 rounded border flex items-start gap-2 hover:bg-blue-50 transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            const newMap = new Map(selectedTransactionsByDebtor);
                                            if (!newMap.has(debtorKey)) {
                                              newMap.set(debtorKey, new Set());
                                            }
                                            const txSet = newMap.get(debtorKey)!;
                                            
                                            if (e.target.checked) {
                                              txSet.add(t.id);
                                            } else {
                                              txSet.delete(t.id);
                                            }
                                            
                                            setSelectedTransactionsByDebtor(newMap);
                                          }}
                                          className="mt-0.5 cursor-pointer"
                                        />
                                        <div 
                                          className="flex-1 cursor-pointer"
                                          onClick={() => {
                                            // Convertir la transacción individual a formato compatible con el modal de detalles
                                            const txForModal = {
                                              ...t,
                                              client_name: debtor.client_name,
                                              client_type: debtor.client_type,
                                              parent_name: debtor.parent_name,
                                              parent_phone: debtor.parent_phone,
                                              school_name: debtor.school_name
                                            };
                                            setSelectedTransaction(txForModal);
                                            setShowDetailsModal(true);
                                          }}
                                        >
                                          <span className="font-semibold text-blue-600 hover:text-blue-700">#{idx + 1}</span>
                                          {' - '}
                                          {format(new Date(t.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                                          {' - '}
                                          <span className="text-red-600 font-bold">S/ {Math.abs(t.amount).toFixed(2)}</span>
                                          <div className="text-gray-700 mt-0.5 font-medium">{t.description}</div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </details>
                          </div>

                          {/* Botones de acción */}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => handleOpenPayment(debtor)}
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              Cobrar
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyMessage(debtor)}
                            >
                              <Copy className="h-4 w-4 mr-1" />
                              Copiar Mensaje
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generatePDF(debtor)}
                            >
                              <FileText className="h-4 w-4 mr-1" />
                              PDF
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
            </TabsContent>

            <TabsContent value="pagos" className="mt-0">
              {/* Lista de pagos realizados */}
              {loadingPaid ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-blue-600" />
                    <p className="text-gray-500">Cargando pagos realizados...</p>
                  </CardContent>
                </Card>
              ) : paidTransactions.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                      No hay pagos registrados
                    </h3>
                    <p className="text-gray-500">
                      Los pagos realizados aparecerán aquí
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {paidTransactions.map((transaction) => {
                    // Determinar el nombre del cliente
                    let clientName = transaction.students?.full_name || 
                                     transaction.teacher_profiles?.full_name || 
                                     transaction.manual_client_name || 
                                     null;
                    
                    // Si no hay nombre, es una venta de cocina genérica
                    const isGenericSale = !clientName && !transaction.student_id && !transaction.teacher_id;
                    if (isGenericSale) {
                      clientName = '🛒 Cliente Genérico Sin Cuenta';
                    }
                    
                    const clientType = transaction.student_id ? 'student' : 
                                      transaction.teacher_id ? 'teacher' : 
                                      isGenericSale ? 'generic' : 'manual';
                    const schoolName = transaction.schools?.name || 'Sin sede';

                    return (
                      <Card key={transaction.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-green-500">
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-bold text-xl text-gray-900">{clientName}</h3>
                                {clientType === 'teacher' && (
                                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                    👨‍🏫 Profesor
                                  </Badge>
                                )}
                                {clientType === 'generic' && (
                                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                    🛒 Sin Cliente
                                  </Badge>
                                )}
                                {clientType === 'manual' && (
                                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                    📝 Sin Cuenta
                                  </Badge>
                                )}
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                  ✅ Pagado
                                </Badge>
                              </div>
                              
                              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 mt-1 bg-blue-50 px-2 py-1 rounded-md inline-flex mb-3">
                                <Building2 className="h-4 w-4" />
                                {schoolName}
                              </div>

                              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                                {/* 🍽️ DETALLE DE CONSUMO - Lo más importante primero */}
                                <div className="bg-white border-l-4 border-l-blue-500 rounded-md p-3 mb-3">
                                  <p className="text-gray-500 text-sm font-semibold mb-1">🍽️ Detalle de Consumo:</p>
                                  <p className="font-bold text-gray-900 text-base">
                                    {transaction.description || 'Sin descripción'}
                                  </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-sm">
                                  <div>
                                    <p className="text-gray-500">📅 Fecha de pago:</p>
                                    <p className="font-semibold text-gray-900">
                                      {format(new Date(transaction.created_at), "dd/MM/yyyy", { locale: es })}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">🕐 Hora de pago:</p>
                                    <p className="font-semibold text-gray-900">
                                      {format(new Date(transaction.created_at), "HH:mm", { locale: es })}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-gray-500">💳 Método de pago:</p>
                                    <p className="font-semibold text-gray-900 capitalize">
                                      {transaction.payment_method || 'No especificado'}
                                    </p>
                                  </div>
                                  {transaction.operation_number && (
                                    <div>
                                      <p className="text-gray-500">🔢 N° de operación:</p>
                                      <p className="font-semibold text-gray-900">
                                        {transaction.operation_number}
                                      </p>
                                    </div>
                                  )}
                                </div>
                                
                                {transaction.created_by_profile && (() => {
                                  const userInfo = getUserRoleDescription(
                                    transaction.created_by_profile, 
                                    transaction.schools?.name || 'Sin sede'
                                  );
                                  return userInfo ? (
                                    <div className="border-t pt-2 mt-2">
                                      <p className="text-gray-500 text-sm">👤 Registrado por:</p>
                                      <p className="font-semibold text-gray-900">{userInfo.name}</p>
                                      <p className="text-xs text-gray-600 mt-1">{userInfo.role}</p>
                                    </div>
                                  ) : null;
                                })()}

                                {transaction.document_type && (
                                  <div className="border-t pt-2 mt-2">
                                    <p className="text-gray-500 text-sm">📄 Tipo de documento:</p>
                                    <p className="font-semibold text-gray-900 capitalize">
                                      {transaction.document_type}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="text-right ml-4 flex flex-col items-end">
                              <p className="text-3xl font-bold text-green-600 mb-2">
                                S/ {Math.abs(transaction.amount).toFixed(2)}
                              </p>
                              <div className="flex flex-col gap-2 w-full mt-3">
                                <Button
                                  onClick={() => {
                                    console.log('[BillingCollection] 🔍 Abriendo detalles de transacción:', transaction);
                                    console.log('[BillingCollection] 📞 operation_number:', transaction.operation_number);
                                    setSelectedTransaction(transaction);
                                    setShowDetailsModal(true);
                                  }}
                                  variant="outline"
                                  size="sm"
                                  className="w-full border-blue-600 text-blue-600 hover:bg-blue-50"
                                >
                                  <Eye className="h-4 w-4 mr-2" />
                                  Ver Detalles
                                </Button>
                                <Button
                                  onClick={() => generatePaymentReceipt(transaction)}
                                  variant="outline"
                                  size="sm"
                                  className="w-full border-green-600 text-green-600 hover:bg-green-50"
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  Comprobante
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Modal de Registro de Pago - REDISEÑADO */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-3">
              <DollarSign className="h-7 w-7 text-green-600" />
              Registrar Pago
            </DialogTitle>
            <DialogDescription asChild>
              <div className="mt-3 p-4 bg-blue-50 rounded-lg space-y-1">
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-gray-900">
                    {currentDebtor?.client_type === 'student' && '👨‍🎓 Estudiante: '}
                    {currentDebtor?.client_type === 'teacher' && '👨‍🏫 Profesor: '}
                    {currentDebtor?.client_type === 'manual' && '📝 Cliente: '}
                    {currentDebtor?.client_name}
                  </div>
                </div>
                {currentDebtor?.client_type === 'student' && currentDebtor.parent_name && (
                  <div className="font-semibold text-gray-900">👤 Padre: {currentDebtor.parent_name}</div>
                )}
                <div className="text-2xl font-bold text-red-600 mt-2">Total a Cobrar: S/ {currentDebtor?.total_amount.toFixed(2)}</div>
                <div className="text-sm text-gray-600">{currentDebtor?.transaction_count} consumo(s) pendiente(s)</div>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Monto a Pagar - MUY GRANDE Y VISIBLE */}
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-6">
                <Label className="text-xl font-bold mb-4 block">💰 Monto a Pagar *</Label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-7xl font-black text-green-700">S/</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={currentDebtor?.total_amount || 0}
                    value={paymentData.paid_amount || ''}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, paid_amount: parseFloat(e.target.value) || 0 }))}
                    style={{ fontSize: '5rem', paddingLeft: '140px' }}
                    className="font-black h-32 text-center border-4 border-green-500 focus:border-green-600 focus:ring-4 focus:ring-green-200"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                {currentDebtor && paymentData.paid_amount < currentDebtor.total_amount && paymentData.paid_amount > 0 && (
                  <Alert className="mt-3 bg-orange-50 border-orange-200">
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                    <AlertDescription className="text-orange-900">
                      <strong>Pago Parcial</strong> - Restante: S/ {(currentDebtor.total_amount - paymentData.paid_amount).toFixed(2)}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Método de Pago - BOTONES GRANDES */}
            <div className="space-y-3">
              <Label className="text-lg font-semibold">💳 Método de Pago *</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Button
                  type="button"
                  variant={paymentData.payment_method === 'efectivo' ? 'default' : 'outline'}
                  className={`h-20 text-lg ${paymentData.payment_method === 'efectivo' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, payment_method: 'efectivo' }))}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-2xl">💵</span>
                    <span>Efectivo</span>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={paymentData.payment_method === 'yape' ? 'default' : 'outline'}
                  className={`h-20 text-lg ${paymentData.payment_method === 'yape' ? 'bg-[#6C1C8C] hover:bg-[#5A1773]' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, payment_method: 'yape' }))}
                >
                  <div className="flex flex-col items-center gap-1">
                    <YapeLogo className="w-10 h-10" />
                    <span>Yape</span>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={paymentData.payment_method === 'plin' ? 'default' : 'outline'}
                  className={`h-20 text-lg ${paymentData.payment_method === 'plin' ? 'bg-[#00D4D8] hover:bg-[#00B8BC] text-gray-900' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, payment_method: 'plin' }))}
                >
                  <div className="flex flex-col items-center gap-1">
                    <PlinLogo className="w-10 h-10" />
                    <span>Plin</span>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={paymentData.payment_method === 'transferencia' ? 'default' : 'outline'}
                  className={`h-20 text-lg ${paymentData.payment_method === 'transferencia' ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, payment_method: 'transferencia' }))}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-2xl">🏦</span>
                    <span>Transferencia</span>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={paymentData.payment_method === 'tarjeta' ? 'default' : 'outline'}
                  className={`h-20 text-lg ${paymentData.payment_method === 'tarjeta' ? 'bg-gray-700 hover:bg-gray-800' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, payment_method: 'tarjeta' }))}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-2xl">💳</span>
                    <span>Tarjeta</span>
                  </div>
                </Button>
              </div>
            </div>

            {/* Número de Operación - OBLIGATORIO */}
            {['yape', 'plin', 'transferencia', 'tarjeta'].includes(paymentData.payment_method) && (
              <div className="space-y-2">
                <Label className="text-base font-semibold">
                  🔢 Número de Operación *
                  <span className="text-red-600 ml-1">(OBLIGATORIO)</span>
                </Label>
                <Input
                  placeholder="Ej: 123456789"
                  value={paymentData.operation_number}
                  onChange={(e) => setPaymentData(prev => ({ ...prev, operation_number: e.target.value }))}
                  className="h-12 text-lg border-2"
                  required
                />
                {!paymentData.operation_number && (
                  <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                    ⚠️ El número de operación es obligatorio para este método de pago
                  </p>
                )}
              </div>
            )}

            {/* Tipo de Documento - BOTONES */}
            <div className="space-y-3">
              <Label className="text-lg font-semibold">📄 Tipo de Documento</Label>
              <div className="grid grid-cols-3 gap-3">
                <Button
                  type="button"
                  variant={paymentData.document_type === 'ticket' ? 'default' : 'outline'}
                  className={`h-16 text-base ${paymentData.document_type === 'ticket' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, document_type: 'ticket' }))}
                >
                  🎫 Ticket
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-16 text-base opacity-50 cursor-not-allowed w-full"
                    disabled
                  >
                    📄 Boleta
                  </Button>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Badge variant="destructive" className="text-xs">Requiere API SUNAT</Badge>
                  </div>
                </div>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-16 text-base opacity-50 cursor-not-allowed w-full"
                    disabled
                  >
                    📋 Factura
                  </Button>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Badge variant="destructive" className="text-xs">Requiere API SUNAT</Badge>
                  </div>
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ <strong>Boleta</strong> y <strong>Factura</strong> requieren conexión con la API de SUNAT. 
                Por ahora solo está disponible <strong>Ticket</strong> (comprobante interno).
              </p>
            </div>

            {/* Notas */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">📝 Notas (Opcional)</Label>
              <Input
                placeholder="Observaciones adicionales..."
                value={paymentData.notes}
                onChange={(e) => setPaymentData(prev => ({ ...prev, notes: e.target.value }))}
                className="h-12"
              />
            </div>
          </div>

          <DialogFooter className="mt-6 gap-3">
            <Button 
              variant="outline" 
              onClick={() => setShowPaymentModal(false)}
              className="h-12 text-base px-8"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleRegisterPayment} 
              disabled={saving || paymentData.paid_amount <= 0} 
              className="bg-green-600 hover:bg-green-700 h-12 text-base px-8"
            >
              {saving ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Registrar Pago (S/ {paymentData.paid_amount.toFixed(2)})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalles Completos */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedTransaction && (() => {
            const isPending = selectedTransaction.payment_status === 'pending' || selectedTransaction.payment_status === 'partial';
            const isPaid = selectedTransaction.payment_status === 'paid';
            
            const clientName = selectedTransaction.client_name ||
                             selectedTransaction.students?.full_name || 
                             selectedTransaction.teacher_profiles?.full_name || 
                             selectedTransaction.manual_client_name || 
                             '🛒 Cliente Genérico Sin Cuenta';
            const clientType = selectedTransaction.client_type === 'student' ? 'Estudiante' :
                              selectedTransaction.client_type === 'teacher' ? 'Profesor' :
                              selectedTransaction.client_type === 'manual' ? 'Cliente Sin Cuenta' :
                              selectedTransaction.student_id ? 'Estudiante' : 
                              selectedTransaction.teacher_id ? 'Profesor' : 
                              selectedTransaction.manual_client_name ? 'Cliente Sin Cuenta' : 'Cliente Genérico Sin Cuenta';
            const schoolName = selectedTransaction.school_name || 
                              selectedTransaction.schools?.name || 
                              'Sin sede';
            const userInfo = selectedTransaction.created_by_profile ? 
                            getUserRoleDescription(selectedTransaction.created_by_profile, schoolName) : 
                            null;
            
            // Determinar si tiene cuenta en el sistema
            const hasAccount = !!(selectedTransaction.student_id || selectedTransaction.teacher_id);
            const accountEmail = selectedTransaction.teacher_profiles?.email || 
                                selectedTransaction.students?.email || null;
            
            // Determinar quién hizo el pedido - SIEMPRE mostrar nombre
            const getOriginInfo = () => {
              // CASO 1: Tiene created_by y es el mismo profesor
              if (selectedTransaction.created_by && selectedTransaction.created_by === selectedTransaction.teacher_id) {
                const teacherName = selectedTransaction.teacher_profiles?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: teacherName,
                  createdByRole: 'Profesor',
                  icon: '👨‍🏫'
                };
              }
              
              // CASO 2: Tiene created_by y es el mismo estudiante
              if (selectedTransaction.created_by && selectedTransaction.created_by === selectedTransaction.student_id) {
                const studentName = selectedTransaction.students?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: studentName,
                  createdByRole: 'Estudiante',
                  icon: '🎒'
                };
              }
              
              // CASO 3: Tiene created_by y es otro usuario (admin, cajero, etc.)
              if (selectedTransaction.created_by && userInfo) {
                return {
                  createdByName: userInfo.name,
                  createdByRole: userInfo.role,
                  icon: '🏢'
                };
              }
              
              // CASO 4: Tiene created_by pero no tenemos el perfil
              if (selectedTransaction.created_by) {
                return {
                  createdByName: 'Administrador',
                  createdByRole: 'No se pudo cargar el perfil',
                  icon: '🏢'
                };
              }
              
              // CASO 5: NO tiene created_by pero es un pedido de almuerzo con teacher_id
              // → El profesor lo pidió desde su cuenta
              if (!selectedTransaction.created_by && selectedTransaction.teacher_id) {
                const teacherName = selectedTransaction.teacher_profiles?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: teacherName,
                  createdByRole: 'Profesor (pedido desde su cuenta)',
                  icon: '👨‍🏫'
                };
              }
              
              // CASO 6: NO tiene created_by pero tiene student_id
              if (!selectedTransaction.created_by && selectedTransaction.student_id) {
                const studentName = selectedTransaction.students?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: studentName,
                  createdByRole: 'Estudiante (pedido desde su cuenta)',
                  icon: '🎒'
                };
              }
              
              // CASO 7: Venta manual sin cuenta
              if (selectedTransaction.manual_client_name) {
                return {
                  createdByName: selectedTransaction.manual_client_name,
                  createdByRole: 'Cliente sin cuenta',
                  icon: '🛒'
                };
              }
              
              // CASO 8: Sin información
              return {
                createdByName: 'Sistema',
                createdByRole: 'Generado automáticamente',
                icon: '⚙️'
              };
            };
            
            const originInfo = getOriginInfo();

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold flex items-center gap-3">
                    {isPending ? (
                      <>
                        <AlertCircle className="h-7 w-7 text-red-600" />
                        <span className="text-red-700">Detalles de Deuda Pendiente</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-7 w-7 text-blue-600" />
                        Detalles Completos del Pago
                      </>
                    )}
                  </DialogTitle>
                </DialogHeader>
                
                <div className="space-y-4 mt-4">
                  {/* Estado de la transacción */}
                  {isPending && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3 text-center">
                      <span className="text-red-700 font-bold text-lg">⏳ DEUDA PENDIENTE DE PAGO</span>
                    </div>
                  )}
                  
                  {/* Cliente */}
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
                    <h3 className="font-bold text-lg text-gray-900 mb-2">👤 Cliente</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Nombre:</span>
                        <span className="font-semibold text-gray-900">{clientName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Categoría:</span>
                        <span className="font-semibold text-gray-900">{clientType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Sede:</span>
                        <span className="font-semibold text-gray-900">{schoolName}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Cuenta:</span>
                        {hasAccount ? (
                          <span className="font-semibold text-green-700 flex items-center gap-1">
                            ✅ Tiene cuenta en el sistema
                          </span>
                        ) : (
                          <span className="font-semibold text-red-600 flex items-center gap-1">
                            ❌ No tiene cuenta
                          </span>
                        )}
                      </div>
                      {hasAccount && accountEmail && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Email:</span>
                          <span className="font-semibold text-gray-900 text-sm">{accountEmail}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Información del Monto y Estado */}
                  <div className={`rounded-lg p-4 border ${isPending 
                    ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200' 
                    : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'}`}>
                    <h3 className="font-bold text-lg text-gray-900 mb-2">
                      {isPending ? '💰 Información de la Deuda' : '💳 Información del Pago'}
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Monto:</span>
                        <span className={`font-bold text-2xl ${isPending ? 'text-red-600' : 'text-green-600'}`}>
                          S/ {Math.abs(selectedTransaction.amount).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Estado:</span>
                        {isPending ? (
                          <span className="font-bold text-red-600 bg-red-100 px-3 py-1 rounded-full text-sm">
                            ⏳ Pendiente de Pago
                          </span>
                        ) : (
                          <span className="font-bold text-green-600 bg-green-100 px-3 py-1 rounded-full text-sm">
                            ✅ Pagado
                          </span>
                        )}
                      </div>
                      {isPaid && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Método de pago:</span>
                          <span className="font-semibold text-gray-900 capitalize">
                            {selectedTransaction.payment_method || 'No especificado'}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-start">
                        <span className="text-gray-600">{isPending ? 'Fecha del pedido:' : 'Fecha y hora:'}</span>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">
                            {format(new Date(selectedTransaction.created_at), "dd/MM/yyyy", { locale: es })}
                          </p>
                          <p className="text-sm text-gray-600">
                            {format(new Date(selectedTransaction.created_at), "HH:mm:ss", { locale: es })}
                          </p>
                        </div>
                      </div>
                      {selectedTransaction.operation_number && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Nº de operación:</span>
                          <span className="font-semibold text-gray-900">{selectedTransaction.operation_number}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 🍽️ Detalle de Consumo */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border-2 border-blue-300 shadow-md">
                    <h3 className="font-bold text-xl text-gray-900 mb-3 flex items-center gap-2">
                      🍽️ Detalle de Consumo
                    </h3>
                    <p className="text-gray-900 font-semibold text-lg leading-relaxed">
                      {selectedTransaction.description || 'Sin descripción'}
                    </p>
                  </div>

                  {/* 📋 Quién realizó el pedido */}
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-4 border border-amber-200">
                    <h3 className="font-bold text-lg text-gray-900 mb-2">
                      📋 {isPending ? 'Responsable del Pedido' : 'Registrado por'}
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Nombre:</span>
                        <span className="font-bold text-gray-900 text-lg flex items-center gap-2">
                          {originInfo.icon} {originInfo.createdByName}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Cargo:</span>
                        <span className="font-semibold text-blue-700">
                          {originInfo.createdByRole}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">ID de transacción:</span>
                        <span className="font-mono text-xs text-gray-500">{selectedTransaction.id}</span>
                      </div>
                    </div>
                  </div>

                  {/* Botón PDF */}
                  {isPaid ? (
                    <Button
                      onClick={() => {
                        generatePaymentReceipt(selectedTransaction);
                        setShowDetailsModal(false);
                      }}
                      className="w-full bg-green-600 hover:bg-green-700 h-12"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar Comprobante de Pago PDF
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        generatePDF({
                          id: selectedTransaction.teacher_id || selectedTransaction.student_id || 'manual',
                          client_name: clientName,
                          client_type: clientType === 'Estudiante' ? 'student' : clientType === 'Profesor' ? 'teacher' : 'manual',
                          school_id: selectedTransaction.school_id,
                          school_name: schoolName,
                          total_amount: Math.abs(selectedTransaction.amount),
                          transaction_count: 1,
                          transactions: [selectedTransaction],
                        } as Debtor);
                        setShowDetailsModal(false);
                      }}
                      className="w-full bg-red-600 hover:bg-red-700 h-12"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar Estado de Deuda PDF
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};
