import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getBillingStatusBadge } from '@/lib/billingUtils';
import { InvoiceClientModal, type InvoiceClientData } from '@/components/billing/InvoiceClientModal';
import { useAuth } from '@/contexts/AuthContext';
import { registrarHuella } from '@/services/auditService';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useViewAsStore } from '@/stores/viewAsStore';
import { useBillingSync, useDebouncedSync } from '@/stores/billingSync';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { YapeLogo } from '@/components/ui/YapeLogo';
import { PlinLogo } from '@/components/ui/PlinLogo';
// Select de Radix removido - se usa <select> nativo para evitar error removeChild en algunos navegadores
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
  User,
  Phone,
  Plus,
  Trash2,
  SplitSquareVertical,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  UtensilsCrossed,
  Coffee,
  ChevronDown,
  ClipboardList,
  CheckSquare,
  Square,
  ArrowRight,
  ArrowLeft,
  GraduationCap,
  Briefcase,
  Wallet,
  Ban,
} from 'lucide-react';
// Tabs de Radix removido - se usa tabs nativo para evitar error removeChild en algunos navegadores
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { generateBillingPDF } from '@/utils/pdfGenerator';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';
import { BillingReportsTab } from './reports/BillingReportsTab';
import { TransactionAuditTimeline } from './reports/TransactionAuditTimeline';

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
  student_grade?: string; // Grado del alumno (solo estudiantes)
  student_section?: string; // Sección del alumno (solo estudiantes)
  parent_id?: string; // Solo para estudiantes
  parent_name?: string; // Solo para estudiantes
  parent_phone?: string; // Solo para estudiantes
  parent_email?: string; // Solo para estudiantes
  school_id: string;
  school_name: string;
  total_amount: number;
  lunch_amount: number;
  cafeteria_amount: number;
  transaction_count: number;
  transactions: any[];
  voucher_status?: 'none' | 'pending' | 'rejected'; // Estado del voucher enviado por el padre
  has_lunch_debt?: boolean; // Si tiene deuda de almuerzo (para mostrar indicador de voucher y WhatsApp)
}



/** Normaliza texto: minúsculas + sin tildes para búsqueda inteligente */
const normalize = (str: string) =>
  str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export const BillingCollection = ({ section }: { section?: 'cobrar' | 'pagos' | 'config' } = {}) => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const emitSync = useBillingSync((s) => s.emit);
  const debtorsSyncTs = useDebouncedSync('debtors', 600);
  const txSyncTs = useDebouncedSync('transactions', 600);

  const isLunchTx = (t: any): boolean => {
    if (t.metadata?.lunch_order_id) return true;
    if (t.metadata?.source === 'lunch_order' || t.metadata?.source === 'lunch') return true;
    if (t.id?.toString().startsWith('lunch_')) return true;
    return false;
  };

  /**
   * Construye el desglose línea por línea de las transacciones para WhatsApp.
   * Cada línea: "- dd/MM: Producto x2, Producto2 *(S/ X.XX)*"
   * - POS: usa transaction_items del mapa (product_name + quantity)
   * - Almuerzo: usa metadata.menu_name o description
   */
  const buildTransactionDesglose = (
    transactions: any[],
    itemsByTxId: Map<string, any[]>,
    type: 'all' | 'lunch' | 'cafeteria' = 'all'
  ): string => {
    const filtered = transactions.filter((t: any) => {
      if (type === 'lunch') return isLunchTx(t);
      if (type === 'cafeteria') return !isLunchTx(t);
      return true;
    });

    if (filtered.length === 0) return '_(sin consumos en este período)_';

    return filtered.map((t: any) => {
      // Fecha: usar la fecha real del pedido si existe (almuerzos), si no la de la transacción
      const rawDate = t.metadata?.order_created_at || t.created_at;
      const dateStr = format(new Date(rawDate), 'dd/MM', { locale: es });

      // Nombre del consumo
      let productDesc: string;
      const items = itemsByTxId.get(t.id);
      if (items && items.length > 0) {
        // POS: listar productos con cantidad
        productDesc = items
          .map((i: any) => `${i.product_name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`)
          .join(', ');
      } else if (t.metadata?.menu_name) {
        productDesc = `Almuerzo - ${t.metadata.menu_name}`;
      } else if (t.description) {
        // Limpiar "Almuerzo - Menú del día - 15/03/2026" para no repetir la fecha
        productDesc = t.description.replace(/\s*-\s*\d{2}\/\d{2}\/\d{4}$/, '');
      } else {
        productDesc = 'Consumo';
      }

      // Las compras POS suelen guardarse con amount negativo; en el mensaje siempre mostramos monto positivo
      const lineAmount = Math.abs(Number(t.amount ?? 0));
      return `- ${dateStr}: ${productDesc} *(S/ ${lineAmount.toFixed(2)})*`;
    }).join('\n');
  };

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [paidTransactions, setPaidTransactions] = useState<any[]>([]);
  const [loadingPaid, setLoadingPaid] = useState(false);

  const fetchDebtorsRequestId = useRef(0);
  const fetchPaidRequestId = useRef(0);
  const lastCheckedRole = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'cobrar' | 'pagos' | 'config'>(section || 'cobrar');

  // Sincronizar con la sección controlada desde el padre (Cobranzas.tsx)
  // NOTA: canViewAllSchools se usa más abajo en otro useEffect
  useEffect(() => {
    if (section) {
      setActiveTab(section);
    }
  }, [section]);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [showDebtorDetailModal, setShowDebtorDetailModal] = useState(false);
  const [selectedDebtorForDetail, setSelectedDebtorForDetail] = useState<any>(null);
  // Deuda histórica real (sin filtros de fecha) para comparar con el total filtrado
  const [historicalDebt, setHistoricalDebt] = useState<{ total: number; count: number } | null>(null);
  const [loadingHistoricalDebt, setLoadingHistoricalDebt] = useState(false);

  // ── Modal: Anular Almuerzo y Acreditar Billetera ──
  const [showCancelWalletModal, setShowCancelWalletModal] = useState(false);
  const [cancellingWallet, setCancellingWallet] = useState(false);
  // billing_status de la transacción seleccionada (se consulta al abrir el modal)
  const [cancelLunchBillingStatus, setCancelLunchBillingStatus] = useState<string | null>(null);
  const [loadingCancelCheck, setLoadingCancelCheck] = useState(false);

  // Búsqueda dedicada para pestaña Pagos
  const [paidSearchTerm, setPaidSearchTerm] = useState('');
  // Filtros dedicados para pestaña Pagos Realizados
  const todayStr = new Date().toISOString().split('T')[0];
  const mondayDate = (() => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    return d.toISOString().split('T')[0];
  })();
  const [paidDateFrom, setPaidDateFrom] = useState(mondayDate);
  const [paidDateTo, setPaidDateTo] = useState(todayStr);
  const [paidStatusFilter, setPaidStatusFilter] = useState<string>('all');

  // Modal guía de pago
  const [showPaymentGuide, setShowPaymentGuide] = useState(false);

  // Config de sede (mensaje WhatsApp + métodos de pago)
  const [schoolConfig, setSchoolConfig] = useState<any>(null);
  const [loadingSchoolConfig, setLoadingSchoolConfig] = useState(false);
  const [savingSchoolConfig, setSavingSchoolConfig] = useState(false);
  const [configMessageTemplate, setConfigMessageTemplate] = useState('');
  const [configStudentTemplate, setConfigStudentTemplate] = useState('');
  const [configTeacherTemplate, setConfigTeacherTemplate] = useState('');
  const [configLunchTemplate, setConfigLunchTemplate] = useState('');
  const [configCafeteriaTemplate, setConfigCafeteriaTemplate] = useState('');
  const [configYapeEnabled, setConfigYapeEnabled] = useState(true);
  const [configPlinEnabled, setConfigPlinEnabled] = useState(true);
  const [configTransferenciaEnabled, setConfigTransferenciaEnabled] = useState(true);
  
  // Filtros
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate]   = useState<string>(''); // Fecha mínima de deuda
  const [untilDate, setUntilDate] = useState<string>(''); // Fecha máxima de deuda
  
  // Selecci�n m�ltiple
  const [selectedDebtors, setSelectedDebtors] = useState<Set<string>>(new Set());
  
  // 🆕 Selección de transacciones individuales por deudor
  const [selectedTransactionsByDebtor, setSelectedTransactionsByDebtor] = useState<Map<string, Set<string>>>(new Map());

  // ── CXC (Cuentas por Cobrar) ──
  const [showCxcModal, setShowCxcModal] = useState(false);
  const [cxcStep, setCxcStep] = useState<1 | 2 | 3>(1);
  const [cxcPeriodType, setCxcPeriodType] = useState<'all' | 'range'>('all');
  const [cxcDateFrom, setCxcDateFrom] = useState('');
  const [cxcDateTo, setCxcDateTo] = useState('');
  const [cxcRubro, setCxcRubro] = useState<'cafeteria' | 'lunch' | 'all'>('cafeteria');
  const [cxcClientType, setCxcClientType] = useState<'student' | 'teacher' | 'all'>('all');
  const [cxcSchool, setCxcSchool] = useState<string>('all');
  const [cxcList, setCxcList] = useState<Debtor[]>([]);
  const [cxcLoadingList, setCxcLoadingList] = useState(false);
  const [cxcChecked, setCxcChecked] = useState<Set<string>>(new Set());
  const [cxcCopyingId, setCxcCopyingId] = useState<string | null>(null);
  const [cxcHasGenerated, setCxcHasGenerated] = useState(false);

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
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [pendingInvoiceData, setPendingInvoiceData] = useState<InvoiceClientData | null>(null);
  
  // 🆕 Pago dividido / mixto: múltiples líneas de pago
  interface PaymentLine {
    id: string;
    amount: number;
    payment_method: string;
    operation_number: string;
  }
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [useSplitPayment, setUseSplitPayment] = useState(false);

  // Modal de env�o masivo
  const [showMassiveModal, setShowMassiveModal] = useState(false);
  const [generatingExport, setGeneratingExport] = useState(false);
  const [canViewAllSchools, setCanViewAllSchools] = useState(false);
  const [canCollect, setCanCollect] = useState(false);

  // Resetear sede a 'all' cuando entra a Reportes como admin_general
  useEffect(() => {
    if (section === 'pagos' && canViewAllSchools) {
      setSelectedSchool('all');
    }
  }, [section, canViewAllSchools]);

  // Paginación - tab Cobrar (deudores) — server-side via RPC
  const DEBTORS_PER_PAGE = 50;
  const [debtorsPage, setDebtorsPage] = useState(1);
  const [debtorsTotalCount, setDebtorsTotalCount] = useState(0);

  // Paginación - tab Pagos Realizados (server-side)
  const PAID_PER_PAGE = 30;
  const [paidPage, setPaidPage] = useState(1);
  const [paidTotalCount, setPaidTotalCount] = useState(0);

  // Verificar permisos al cargar
  useEffect(() => {
    checkPermissions();
  }, [user, role]);

  const checkPermissions = async () => {
    if (!user || !role) return;
    // Guard: evitar re-verificar si el rol no cambió
    if (lastCheckedRole.current === role) return;
    lastCheckedRole.current = role;

    try {
      // Admin General y Supervisor de Red pueden ver todas las sedes
      if (role === 'admin_general' || role === 'supervisor_red') {
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
          }
        }
      });

      setCanViewAllSchools(canViewAll);
      setCanCollect(canCollectPerm);

    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  useEffect(() => {
    fetchSchools();
    fetchUserSchool();
  }, []);

  // Cargar schoolConfig en cuanto tengamos el userSchoolId (no solo en tab config)
  useEffect(() => {
    if (canViewAllSchools && selectedSchool && selectedSchool !== 'all') {
      fetchSchoolConfig(selectedSchool);
    } else if (userSchoolId && !canViewAllSchools) {
      fetchSchoolConfig();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSchoolId, canViewAllSchools, selectedSchool]);

  useEffect(() => {
    // Cargar per�odos
    if (selectedSchool) {
      fetchPeriods();
    }
    
    // Cargar deudores:
    // - Si es admin_general (canViewAllSchools), puede cargar inmediatamente
    // - Si NO es admin_general, espera a que userSchoolId est� disponible
    if (canViewAllSchools || (userSchoolId !== null && !canViewAllSchools)) {
      const timer = setTimeout(() => {
        fetchDebtors();
      }, 300);
      
      return () => {
        clearTimeout(timer);
      };
    } else {
      // esperando userSchoolId
    }
  }, [selectedSchool, userSchoolId, canViewAllSchools, fromDate, untilDate, debtorsPage, searchTerm]);

  useEffect(() => {
    if (debtorsSyncTs > 0 && activeTab === 'cobrar') {
      fetchDebtors();
      toast({ title: '🔄 Datos actualizados', description: 'La lista de deudores se actualizó automáticamente.', duration: 3000 });
    }
  }, [debtorsSyncTs]);

  useEffect(() => {
    if (txSyncTs > 0 && activeTab === 'pagos') {
      fetchPaidTransactions();
      toast({ title: '🔄 Datos actualizados', description: 'Los pagos se actualizaron automáticamente.', duration: 3000 });
    }
  }, [txSyncTs]);

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
      // Fetch role alongside school_id to avoid using stale closure value of canViewAllSchools.
      // canViewAllSchools in the closure always equals false on mount (async state not yet set).
      const { data, error } = await supabase
        .from('profiles')
        .select('school_id, role')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      setUserSchoolId(data?.school_id || null);
      
      // Roles that can see all schools must NOT have selectedSchool forced to their own school.
      const isGlobalRole = ['admin_general', 'supervisor_red', 'superadmin'].includes(data?.role ?? '');
      if (!isGlobalRole && data?.school_id) {
        setSelectedSchool(data.school_id);
        fetchPeriods(data.school_id);
      }
    } catch (error) {
      console.error('Error fetching user school:', error);
    }
  };

  const fetchPeriods = async (schoolId?: string) => {
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
    const currentRequestId = ++fetchDebtorsRequestId.current;
    try {
      setLoading(true);
      setFetchError(null);

      const schoolIdFilter = !canViewAllSchools || selectedSchool !== 'all' 
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;

      // ── RPC unificado: agrupa, deduplica, pagina y hace todos los joins en Postgres ──
      const fromDateUTC = fromDate
        ? (() => { const d = new Date(fromDate); d.setHours(0, 0, 0, 0); return d.toISOString(); })()
        : null;
      const untilDateUTC = untilDate
        ? (() => { const d = new Date(untilDate); d.setHours(23, 59, 59, 999); return d.toISOString(); })()
        : null;

      // supervisor_red solo ve deudas de cafetería (kiosco/POS), nunca almuerzos.
      const txTypeFilter = role === 'supervisor_red' ? 'cafeteria' : null;

      const debtorsOffset = (debtorsPage - 1) * DEBTORS_PER_PAGE;

      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        'get_billing_consolidated_debtors',
        {
          p_school_id:        schoolIdFilter ?? null,
          p_from_date:        fromDateUTC,
          p_until_date:       untilDateUTC,
          p_transaction_type: txTypeFilter,
          p_search:           searchTerm?.trim() || null,
          p_offset:           debtorsOffset,
          p_limit:            DEBTORS_PER_PAGE,
        }
      );

      if (rpcErr) {
        console.error('❌ get_billing_consolidated_debtors error:', rpcErr);
        if (currentRequestId !== fetchDebtorsRequestId.current) return;
        setFetchError('No se pudieron cargar los deudores. Recarga la página o contacta al soporte.');
        setLoading(false);
        return;
      }

      if (currentRequestId !== fetchDebtorsRequestId.current) return;

      const totalCount: number = rpcResult?.total_count ?? 0;
      const rawDebtors: any[]  = rpcResult?.debtors      ?? [];

      // Rehidratar al formato Debtor[] que usa el resto del componente
      const debtorsArray: Debtor[] = rawDebtors.map((d: any) => ({
        id:                d.id,
        client_name:       d.client_name,
        client_type:       d.client_type,
        student_grade:     d.student_grade  || '',
        student_section:   d.student_section|| '',
        parent_id:         d.parent_id      || '',
        parent_name:       d.parent_name    || '',
        parent_phone:      d.parent_phone   || '',
        parent_email:      '',
        school_id:         d.school_id,
        school_name:       d.school_name,
        total_amount:      Number(d.total_amount      ?? 0),
        lunch_amount:      Number(d.lunch_amount      ?? 0),
        cafeteria_amount:  Number(d.cafeteria_amount  ?? 0),
        transaction_count: Number(d.transaction_count ?? 0),
        transactions:      (d.transactions ?? []).map((t: any) => ({
          ...t,
          // Rehidratar subcolumnas que usa buildTransactionDesglose y WhatsApp
          students:         d.client_type === 'student'
            ? { id: d.id, full_name: d.client_name, parent_id: d.parent_id, grade: d.student_grade, section: d.student_section }
            : null,
          teacher_profiles: d.client_type === 'teacher'
            ? { id: d.id, full_name: d.client_name }
            : null,
          schools:          { id: d.school_id, name: d.school_name },
        })),
        has_lunch_debt:    Boolean(d.has_lunch_debt),
        voucher_status:    (d.voucher_status ?? 'none') as 'none' | 'pending' | 'rejected',
      }));

      // Actualizar estado con conteo real del servidor (para paginación)
      setDebtorsTotalCount(totalCount);
      if (currentRequestId !== fetchDebtorsRequestId.current) return;
      setDebtors(debtorsArray);

      // Código legacy eliminado — el RPC get_billing_consolidated_debtors ya devuelve Debtor[] completo
    } catch (error) {
      if (currentRequestId !== fetchDebtorsRequestId.current) return;
      console.error('Error fetching debtors:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los deudores',
      });
    } finally {
      if (currentRequestId === fetchDebtorsRequestId.current) {
        setLoading(false);
      }
    }
  };

  // Los deudores ya vienen paginados y filtrados del servidor.
  // filteredDebtors = debtors (sin re-filtrar) para mantener compatibilidad con selectAll y WhatsApp masivo.
  const filteredDebtors = debtors;
  const debtorsTotalPages = Math.max(1, Math.ceil(debtorsTotalCount / DEBTORS_PER_PAGE));
  const safeDebtorsPage = debtorsPage;
  const paginatedDebtors = debtors; // Ya paginados desde el servidor

  // ✅ Filtrar pagos realizados por término de búsqueda dedicado (pestaña Pagos)
  const filteredPaidTransactions = paidTransactions.filter(transaction => {
    if (!paidSearchTerm) return true;
    const search = normalize(paidSearchTerm);

    const clientName = transaction.students?.full_name ||
                       transaction.teacher_profiles?.full_name ||
                       transaction.manual_client_name ||
                       '';
    const schoolName = transaction.schools?.name || '';
    const creatorName = transaction.created_by_profile?.full_name || '';
    const creatorEmail = transaction.created_by_profile?.email || '';

    return (
      normalize(clientName).includes(search) ||
      normalize(schoolName).includes(search) ||
      normalize(creatorName).includes(search) ||
      normalize(creatorEmail).includes(search) ||
      normalize(transaction.description || '').includes(search) ||
      normalize(transaction.ticket_code || '').includes(search) ||
      normalize(transaction.operation_number || '').includes(search)
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
    const pageIds = paginatedDebtors.map(d => d.id);
    const allPageSelected = pageIds.every(id => selectedDebtors.has(id));
    if (allPageSelected) {
      const newSet = new Set(selectedDebtors);
      pageIds.forEach(id => newSet.delete(id));
      setSelectedDebtors(newSet);
    } else {
      setSelectedDebtors(new Set([...selectedDebtors, ...pageIds]));
    }
  };

  const handleOpenPayment = (debtor: Debtor, collectType: 'all' | 'lunch' | 'cafeteria' = 'all') => {
    const debtorKey = debtor.id;
    const selectedTxIds = selectedTransactionsByDebtor.get(debtorKey);
    
    let transactionsToPayAmount: number;
    let transactionsToPay: any[];
    
    if (selectedTxIds && selectedTxIds.size > 0) {
      transactionsToPay = debtor.transactions.filter((t: any) => selectedTxIds.has(t.id));
      transactionsToPayAmount = transactionsToPay.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
    } else if (collectType === 'lunch') {
      transactionsToPay = debtor.transactions.filter((t: any) => isLunchTx(t));
      transactionsToPayAmount = transactionsToPay.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
    } else if (collectType === 'cafeteria') {
      transactionsToPay = debtor.transactions.filter((t: any) => !isLunchTx(t));
      transactionsToPayAmount = transactionsToPay.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
    } else {
      transactionsToPay = debtor.transactions;
      transactionsToPayAmount = debtor.total_amount;
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
    // Reset split payment
    setUseSplitPayment(false);
    setPaymentLines([{
      id: crypto.randomUUID(),
      amount: transactionsToPayAmount,
      payment_method: 'efectivo',
      operation_number: '',
    }]);
    setShowPaymentModal(true);
  };

  const handleRegisterPayment = async (invoiceData?: InvoiceClientData) => {
    if (!currentDebtor || !user) return;
    // E2 FIX: Guard contra dedo nervioso — si ya hay una llamada en vuelo, ignorar clics extra.
    // setSaving(true) está más abajo pero esta verificación es inmediata (sin await).
    if (saving) return;

    // Determinar método y monto según modo (simple vs dividido)
    let finalPaymentMethod: string;
    let finalOperationNumber: string;
    let finalPaidAmount: number;
    let paymentBreakdown: { method: string; amount: number; operation_number: string }[] = [];

    if (useSplitPayment) {
      // ✅ MODO DIVIDIDO/MIXTO
      const totalLines = paymentLines.reduce((sum, l) => sum + (l.amount || 0), 0);
      const roundedTotal = Math.round(totalLines * 100) / 100;
      const roundedDebtorTotal = Math.round(currentDebtor.total_amount * 100) / 100;
      
      if (roundedTotal !== roundedDebtorTotal) {
        toast({
          variant: 'destructive',
          title: 'El total no coincide',
          description: `La suma de pagos (S/ ${totalLines.toFixed(2)}) debe ser igual al total a cobrar (S/ ${currentDebtor.total_amount.toFixed(2)})`,
        });
        return;
      }

      // Validar que cada línea tenga monto > 0
      for (const line of paymentLines) {
        if (!line.amount || line.amount <= 0) {
          toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Cada línea de pago debe tener un monto mayor a 0',
          });
          return;
        }
        // Validar número de operación si no es efectivo
        if (['yape', 'plin', 'transferencia', 'tarjeta'].includes(line.payment_method) && !line.operation_number) {
          toast({
            variant: 'destructive',
            title: 'Número de Operación Obligatorio',
            description: `Falta el número de operación para el pago de S/ ${line.amount.toFixed(2)} con ${line.payment_method}`,
          });
          return;
        }
      }

      finalPaidAmount = totalLines;
      
      // Determinar si es mixto o dividido
      const uniqueMethods = new Set(paymentLines.map(l => l.payment_method));
      if (uniqueMethods.size > 1) {
        finalPaymentMethod = 'mixto';
      } else {
        finalPaymentMethod = paymentLines[0].payment_method;
      }
      
      // Concatenar números de operación
      const operationNumbers = paymentLines
        .map(l => l.operation_number)
        .filter(Boolean);
      finalOperationNumber = operationNumbers.join(' / ');
      
      // Guardar breakdown para metadata
      paymentBreakdown = paymentLines.map(l => ({
        method: l.payment_method,
        amount: l.amount,
        operation_number: l.operation_number,
      }));

    } else {
      // ✅ MODO SIMPLE (como antes)
      finalPaidAmount = paymentData.paid_amount;
      finalPaymentMethod = paymentData.payment_method;
      finalOperationNumber = paymentData.operation_number;

      if (finalPaidAmount <= 0 || finalPaidAmount > currentDebtor.total_amount) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'El monto debe ser mayor a 0 y menor o igual al total',
        });
        return;
      }

      if (['yape', 'plin', 'transferencia', 'tarjeta'].includes(finalPaymentMethod) && !finalOperationNumber) {
        toast({
          variant: 'destructive',
          title: 'Número de Operación Obligatorio',
          description: 'Debe ingresar el número de operación para este método de pago',
        });
        return;
      }
    }

    setSaving(true);
    
    try {
      // ── Separar IDs reales (UUID) de virtuales (lunch_XXXX) ──────────────
      const UUID_RE_TX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const realTxIds: string[] = (currentDebtor.transactions ?? [])
        .map((t: any) => t.id as string)
        .filter((id: string) => id && UUID_RE_TX.test(id));

      const lunchOrderIds: string[] = (currentDebtor.transactions ?? [])
        .filter((t: any) => t.id?.toString().startsWith('lunch_'))
        .map((t: any) => t.metadata?.lunch_order_id as string)
        .filter(Boolean);

      const studentId = currentDebtor.client_type === 'student' ? currentDebtor.id : null;
      const breakdownPayload = paymentBreakdown.length > 1 ? paymentBreakdown : null;

      // ── LLAMADA ATÓMICA AL RPC ────────────────────────────────────────────
      // Un solo round-trip a la BD. Si cualquier paso falla → ROLLBACK total.
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'process_payment_collection',
        {
          p_real_tx_ids:       realTxIds,
          p_lunch_order_ids:   lunchOrderIds,
          p_payment_method:    finalPaymentMethod,
          p_operation_number:  finalOperationNumber || null,
          p_document_type:     paymentData.document_type || 'ticket',
          p_school_id:         currentDebtor.school_id ?? null,
          p_amount_paid:       finalPaidAmount,
          p_student_id:        studentId,
          p_payment_breakdown: breakdownPayload ? JSON.stringify(breakdownPayload) : null,
        }
      );

      if (rpcError) {
        console.error('❌ [BillingCollection] process_payment_collection falló:', rpcError);
        throw rpcError;
      }

      const methodLabel = useSplitPayment && paymentBreakdown.length > 1
        ? paymentBreakdown.map(p => `${p.method} S/${p.amount.toFixed(2)}`).join(' + ')
        : finalPaymentMethod;

      // Rastro de auditoría: queda registrado quién cobró, cuánto, cómo y a quién
      registrarHuella(
        'APROBACION_MANUAL_EFECTIVO',
        'COBRANZAS',
        {
          admin_id: user.id,
          deudor_id: currentDebtor.id,
          deudor_nombre: currentDebtor.client_name ?? currentDebtor.id,
          monto_cobrado: finalPaidAmount,
          metodo_pago: methodLabel,
          nro_operacion: finalOperationNumber || null,
          transacciones_ids: currentDebtor.transactions?.map((t: any) => t.id) ?? [],
          breakdown: useSplitPayment ? paymentBreakdown : null,
        },
        undefined,
        currentDebtor.school_id ?? undefined
      );

      // ── Emisión inmediata de Boleta/Factura ──────────────────────────────────
      // El toast de "éxito" se lanza AL FINAL, no antes, para evitar
      // que el admin vea "todo OK" cuando la parte fiscal todavía no completó.
      if (invoiceData && (paymentData.document_type === 'boleta' || paymentData.document_type === 'factura')) {
        try {
          const allTxIds = realTxIds;
          const tipoNubefact = invoiceData.tipo === 'factura' ? 1 : 2;

          // ── IGV en aritmética de ENTEROS (céntimos) ──────────────────────────
          // Garantía: baseCents + igvCents = totalCents SIEMPRE.
          // Elimina fugas de ±0.01 que SUNAT rechaza por descuadre.
          // floor() absorbe el residuo en base; igv recibe el resto exacto.
          let igvPct = 18;
          try {
            if (currentDebtor.school_id) {
              const { data: bcfg } = await supabase
                .from('billing_config')
                .select('igv_porcentaje')
                .eq('school_id', currentDebtor.school_id)
                .single();
              if (bcfg?.igv_porcentaje != null && Number(bcfg.igv_porcentaje) > 0) {
                igvPct = Number(bcfg.igv_porcentaje);
              }
            }
          } catch { /* usa 18% de fallback */ }

          const total       = Math.round(finalPaidAmount * 100) / 100;
          const totalCents  = Math.round(total * 100);
          const divisorX100 = 100 + igvPct;
          const baseCents   = Math.floor(totalCents * 100 / divisorX100);
          const igvCents    = totalCents - baseCents;
          const base        = baseCents / 100;
          const igv         = igvCents  / 100;

          const { data: emitResult, error: emitErr } = await supabase.functions.invoke('generate-document', {
            body: {
              school_id: currentDebtor.school_id,
              tipo: tipoNubefact,
              cliente: {
                doc_type:     invoiceData.doc_type === 'sin_documento' ? '-' : invoiceData.doc_type,
                doc_number:   invoiceData.doc_number || '-',
                razon_social: invoiceData.razon_social || 'Consumidor Final',
                direccion:    invoiceData.direccion || '-',
              },
              items: [{
                unidad_de_medida: 'NIU',
                codigo:           'COBRO',
                descripcion:      `Cobro deuda - ${currentDebtor.client_name || 'Cliente'}`,
                cantidad:         1,
                valor_unitario:   base,
                precio_unitario:  total,
                descuento:        '',
                subtotal:         base,
                tipo_de_igv:      1,
                igv,
                total,
                anticipo_regularizacion: false,
              }],
              monto_total:    total,
              payment_method: paymentData.payment_method,
            },
          });

          if (!emitErr && emitResult?.success && emitResult.documento?.id) {
            if (allTxIds.length > 0) {
              await supabase
                .from('transactions')
                .update({ billing_status: 'sent', invoice_id: emitResult.documento.id })
                .in('id', allTxIds);
            }
            // Toast único de éxito total: cobro + boleta confirmados
            toast({
              title: '✅ Cobro y comprobante registrados',
              description: `S/ ${finalPaidAmount.toFixed(2)} cobrados con ${methodLabel}. ${invoiceData.tipo === 'factura' ? 'Factura' : 'Boleta'} emitida con IGV ${igvPct}%.`,
            });
          } else {
            // Nubefact rechazó o no respondió — marcar como 'failed' para reintento
            const nubefactError = emitResult?.error || emitResult?.nubefact?.errors || emitErr?.message || 'Error desconocido';
            console.warn('Emisión fallida (Nubefact):', nubefactError);
            if (allTxIds.length > 0) {
              await supabase
                .from('transactions')
                .update({ billing_status: 'failed' })
                .in('id', allTxIds)
                .eq('billing_status', 'pending');
            }
            toast({
              variant: 'destructive',
              title: '⚠️ Cobro guardado — Error SUNAT',
              description:
                `S/ ${finalPaidAmount.toFixed(2)} cobrados con ${methodLabel}. ` +
                `La boleta no se pudo emitir (Error: ${nubefactError}). ` +
                `Marcada como "Error SUNAT" para reintento. ` +
                `Ve a Facturación → Cierre Mensual → "Reintentar Fallidas".`,
              duration: 12000,
            });
          }
        } catch (emitError: any) {
          // La conexión a Nubefact falló con excepción (timeout, WiFi caído, etc.).
          // El RPC ya hizo COMMIT → cobro registrado. Marcar como 'failed' para que
          // el panel "Reintentar Fallidas" lo detecte. NO decir "proceso nocturno".
          const emitErrMsg = emitError?.message || 'Error de conexión desconocido';
          console.warn('[BillingCollection] Excepción en emisión Nubefact:', emitErrMsg);
          if (realTxIds.length > 0) {
            try {
              await supabase
                .from('transactions')
                .update({ billing_status: 'failed' })
                .in('id', realTxIds)
                .eq('billing_status', 'pending');
            } catch (dbErr) {
              console.error('[BillingCollection] No se pudo marcar como failed:', dbErr);
            }
          }
          toast({
            variant: 'destructive',
            title: '⚠️ Cobro guardado en BD — Boleta fallida',
            description:
              `S/ ${finalPaidAmount.toFixed(2)} quedaron registrados correctamente. ` +
              `La conexión con SUNAT falló (${emitErrMsg}). ` +
              `La transacción fue marcada como "Error SUNAT". ` +
              `Reinténtala desde Facturación → Cierre Mensual → "Reintentar Fallidas". ` +
              `NO vuelvas a cobrar.`,
            duration: 15000,
          });
        }
      } else {
        // Sin comprobante solicitado: toast de cobro simple
        toast({
          title: '✅ Cobro registrado',
          description: `S/ ${finalPaidAmount.toFixed(2)} cobrados con ${methodLabel}.`,
        });
      }

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
      setPendingInvoiceData(null);
      
      // Recargar deudores para actualizar la lista
      await fetchDebtors();
      emitSync(['transactions', 'balances', 'dashboard', 'vouchers']);
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

  // ────────────────────────────────────────────────────────────────────────
  // CXC: construir la lista de despacho — fetch propio sin paginación
  // ────────────────────────────────────────────────────────────────────────
  // PROBLEMA ORIGINAL: buildCxcList usaba filteredDebtors (= página actual,
  // máx 50 registros). Con 813 deudores, CXC solo veía 50 → montos incorrectos.
  //
  // SOLUCIÓN: buildCxcListAsync hace su propio call al RPC con p_limit=9999
  // para obtener TODOS los deudores antes de aplicar los filtros CXC.
  //
  // El servidor ya aplica el filtro de sede y el tipo de transacción.
  // Los filtros de rango de fechas, rubro y tipo de cliente se aplican aquí
  // sobre la lista completa.
  // ────────────────────────────────────────────────────────────────────────
  const buildCxcListAsync = async () => {
    setCxcLoadingList(true);
    setCxcHasGenerated(true);

    try {
      // Calcular el school_id efectivo para la consulta CXC.
      // Prioridad: filtro de sede del modal CXC > filtro de sede de la vista principal.
      const mainSchoolFilter = !canViewAllSchools || selectedSchool !== 'all'
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;
      const cxcSchoolFilter = cxcSchool !== 'all' ? cxcSchool : mainSchoolFilter;

      // supervisor_red solo ve cafetería (restricción de negocio).
      const txTypeFilter = role === 'supervisor_red' ? 'cafeteria' : null;

      // Para rango de fechas, limitar p_until_date al fin del rango.
      // Para "Todo el histórico", sin límite (null).
      const untilDateUTC = cxcPeriodType === 'range' && cxcDateTo
        ? (() => { const d = new Date(cxcDateTo + 'T23:59:59'); return d.toISOString(); })()
        : null;

      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        'get_billing_consolidated_debtors',
        {
          p_school_id:        cxcSchoolFilter ?? null,
          p_until_date:       untilDateUTC,
          p_transaction_type: txTypeFilter,
          p_search:           null,
          p_offset:           0,
          p_limit:            9999,
        }
      );

      if (rpcErr) {
        console.error('❌ CXC fetch error:', rpcErr);
        setCxcList([]);
        setCxcChecked(new Set());
        return;
      }

      const rawDebtors: any[] = rpcResult?.debtors ?? [];

      // Rehidratar al mismo formato Debtor[] que usa el resto del componente.
      const allDebtors: Debtor[] = rawDebtors.map((d: any) => ({
        id:                d.id,
        client_name:       d.client_name,
        client_type:       d.client_type,
        student_grade:     d.student_grade   || '',
        student_section:   d.student_section || '',
        parent_id:         d.parent_id       || '',
        parent_name:       d.parent_name     || '',
        parent_phone:      d.parent_phone    || '',
        parent_email:      '',
        school_id:         d.school_id,
        school_name:       d.school_name,
        total_amount:      Number(d.total_amount      ?? 0),
        lunch_amount:      Number(d.lunch_amount      ?? 0),
        cafeteria_amount:  Number(d.cafeteria_amount  ?? 0),
        transaction_count: Number(d.transaction_count ?? 0),
        transactions:      (d.transactions ?? []).map((t: any) => ({
          ...t,
          students:         d.client_type === 'student'
            ? { id: d.id, full_name: d.client_name, parent_id: d.parent_id, grade: d.student_grade, section: d.student_section }
            : null,
          teacher_profiles: d.client_type === 'teacher'
            ? { id: d.id, full_name: d.client_name }
            : null,
          schools:          { id: d.school_id, name: d.school_name },
        })),
        has_lunch_debt:    Boolean(d.has_lunch_debt),
        voucher_status:    (d.voucher_status ?? 'none') as 'none' | 'pending' | 'rejected',
      }));

      let list = [...allDebtors];

      // 1. Filtro de rango de fechas (solo en modo 'range').
      //    Recalculamos montos desde las transacciones individuales porque los
      //    campos pre-calculados del deudor cubren el período completo.
      if (cxcPeriodType === 'range' && (cxcDateFrom || cxcDateTo)) {
        const from = cxcDateFrom ? new Date(cxcDateFrom + 'T00:00:00') : null;
        const to   = cxcDateTo   ? new Date(cxcDateTo   + 'T23:59:59') : null;
        list = list.map(d => {
          const txFiltered = d.transactions.filter((t: any) => {
            const txDate = new Date(t.metadata?.order_created_at || t.created_at);
            if (from && txDate < from) return false;
            if (to   && txDate > to)   return false;
            return true;
          });
          if (txFiltered.length === 0) return null;
          const lunch = txFiltered
            .filter((t: any) => isLunchTx(t))
            .reduce((s: number, t: any) => s + Math.abs(t.amount ?? 0), 0);
          const cafe = txFiltered
            .filter((t: any) => !isLunchTx(t))
            .reduce((s: number, t: any) => s + Math.abs(t.amount ?? 0), 0);
          return { ...d, transactions: txFiltered, total_amount: lunch + cafe, lunch_amount: lunch, cafeteria_amount: cafe };
        }).filter(Boolean) as Debtor[];
      }

      // 2. Filtro de rubro — usar campos pre-calculados del servidor para
      //    que el monto coincida exactamente con lo que ya calculó el RPC.
      if (cxcRubro === 'cafeteria') {
        list = list.map(d => {
          if (d.cafeteria_amount <= 0) return null;
          const txFiltered = d.transactions.filter((t: any) => !isLunchTx(t));
          if (txFiltered.length === 0) return null;
          return { ...d, transactions: txFiltered, total_amount: d.cafeteria_amount, lunch_amount: 0 };
        }).filter(Boolean) as Debtor[];
      } else if (cxcRubro === 'lunch') {
        list = list.map(d => {
          if (d.lunch_amount <= 0) return null;
          const txFiltered = d.transactions.filter((t: any) => isLunchTx(t));
          if (txFiltered.length === 0) return null;
          return { ...d, transactions: txFiltered, total_amount: d.lunch_amount, cafeteria_amount: 0 };
        }).filter(Boolean) as Debtor[];
      }

      // 3. Filtro de tipo de cliente.
      if (cxcClientType === 'student') {
        list = list.filter(d => d.client_type === 'student');
      } else if (cxcClientType === 'teacher') {
        list = list.filter(d => d.client_type === 'teacher');
      }

      setCxcList(list);
      setCxcChecked(new Set());

    } catch (err) {
      console.error('❌ buildCxcListAsync error:', err);
      setCxcList([]);
      setCxcChecked(new Set());
    } finally {
      setCxcLoadingList(false);
    }
  };

  const openCxcModal = () => {
    setCxcStep(1);
    setCxcPeriodType('all');
    setCxcDateFrom('');
    setCxcDateTo('');
    setCxcRubro(role === 'supervisor_red' ? 'cafeteria' : 'all');
    setCxcClientType('all');
    setCxcSchool('all');
    setCxcList([]);
    setCxcChecked(new Set());
    setCxcHasGenerated(false);
    setShowCxcModal(true);
  };

  const cxcTotalAmount = cxcList.reduce((s, d) => s + d.total_amount, 0);
  const cxcCobradoAmount = cxcList.filter(d => cxcChecked.has(d.id)).reduce((s, d) => s + d.total_amount, 0);

  /**
   * Carga billing_config para los school_ids dados (una sola consulta).
   * Devuelve un Map<school_id, fila>.
   */
  const fetchBillingConfigBySchools = async (schoolIds: string[]): Promise<Map<string, any>> => {
    const ids = [...new Set(schoolIds.filter(Boolean))];
    const m = new Map<string, any>();
    if (ids.length === 0) return m;
    try {
      const { data } = await supabase.from('billing_config').select('*').in('school_id', ids);
      (data || []).forEach((row: any) => m.set(row.school_id, row));
    } catch (e) {
      console.error('[BillingCollection] fetchBillingConfigBySchools:', e);
    }
    return m;
  };

  /**
   * Elige la plantilla correcta según tipo y cliente.
   * Prioridad: billing_config de la sede del deudor > estado React (solo disponible si el admin
   * ya visitó la pestaña Config para esa sede).
   */
  const pickTemplate = (
    type: 'all' | 'lunch' | 'cafeteria',
    debtor: Debtor,
    billingRow: any | null
  ): string => {
    const r = billingRow || {};
    const dbStudent   = (r.student_message_template   || r.message_template || '').trim();
    const dbTeacher   = (r.teacher_message_template   || '').trim();
    const dbLunch     = (r.lunch_message_template     || '').trim();
    const dbCafeteria = (r.cafeteria_message_template || '').trim();

    if (type === 'lunch')     return dbLunch     || dbStudent || configLunchTemplate.trim()     || configMessageTemplate.trim();
    if (type === 'cafeteria') return dbCafeteria || dbStudent || configCafeteriaTemplate.trim() || configMessageTemplate.trim();
    if (debtor.client_type === 'student') return dbStudent || configStudentTemplate.trim() || configMessageTemplate.trim();
    return dbTeacher || dbStudent || configTeacherTemplate.trim() || configStudentTemplate.trim() || configMessageTemplate.trim();
  };

  const copyMessage = async (debtor: Debtor, type: 'all' | 'lunch' | 'cafeteria' = 'all') => {
    const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;

    const amount = type === 'lunch' ? debtor.lunch_amount
      : type === 'cafeteria' ? debtor.cafeteria_amount
      : debtor.total_amount;

    const lunchTransactions = debtor.transactions.filter((t: any) => isLunchTx(t));
    const lunchCount = lunchTransactions.length;

    // ── 1. Obtener items de POS para el desglose ──
    const posIds = debtor.transactions
      .filter((t: any) => !isLunchTx(t) && t.id && !t.id.toString().startsWith('lunch_'))
      .map((t: any) => t.id);

    const itemsByTxId = new Map<string, any[]>();
    if (posIds.length > 0) {
      try {
        const { data: txItems } = await supabase
          .from('transaction_items')
          .select('transaction_id, product_name, quantity, unit_price')
          .in('transaction_id', posIds)
          .range(0, 9999);
        (txItems || []).forEach((item: any) => {
          const existing = itemsByTxId.get(item.transaction_id) || [];
          existing.push(item);
          itemsByTxId.set(item.transaction_id, existing);
        });
      } catch (e) {
        console.error('[copyMessage] Error fetching transaction_items:', e);
      }
    }

    // ── 2. Cargar billing_config de la sede del deudor ──
    const configMap = await fetchBillingConfigBySchools(debtor.school_id ? [debtor.school_id] : []);
    const billingRow = configMap.get(debtor.school_id) ?? null;

    // ── 3. Elegir plantilla (siempre usa la de la sede correcta) ──
    const template = pickTemplate(type, debtor, billingRow);

    // ── 4. Construir desglose ──
    const desglose = buildTransactionDesglose(debtor.transactions, itemsByTxId, type);

    let message: string;
    if (template) {
      message = resolveMessageTemplate(template, debtor, amount, lunchCount, desglose);
    } else {
      // Fallback solo si la sede no tiene ninguna plantilla guardada
      const typeLabel = type === 'lunch' ? ' de almuerzos' : type === 'cafeteria' ? ' de cafetería' : '';
      const destinatario = debtor.client_type === 'student' ? (debtor.parent_name || 'Padre/Madre de familia') : debtor.client_name;
      const periodoLinea = period ? `📅 Período: ${period.period_name}\n` : '';

      message = `🔔 *COBRANZA${typeLabel ? typeLabel.toUpperCase() : ''} LIMA CAFÉ 28*

Hola *${destinatario}*, te escribimos de la cafetería.
Te enviamos el detalle de los consumos pendientes${typeLabel} de *${debtor.client_name}*:

${periodoLinea}${desglose}

*💰 Total a pagar: S/ ${amount.toFixed(2)}*

Para pagar, contacta con administración.
Gracias.`;
    }

    const typeLabels: Record<string, string> = { all: 'general', lunch: 'almuerzos', cafeteria: 'cafetería' };
    navigator.clipboard.writeText(message);
    toast({
      title: '📋 Mensaje copiado',
      description: `Mensaje de ${typeLabels[type]} copiado al portapapeles`,
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

    // Obtener los items reales de transacciones POS (transaction_items)
    const realTxIds = debtor.transactions
      .filter((t: any) => !t.id?.toString().startsWith('lunch_') && t.id)
      .map((t: any) => t.id);

    let itemsByTxId = new Map<string, any[]>();
    if (realTxIds.length > 0) {
      try {
        const { data: txItems } = await supabase
          .from('transaction_items')
          .select('transaction_id, product_name, quantity, unit_price, subtotal')
          .in('transaction_id', realTxIds)
          .range(0, 9999);

        if (txItems) {
          txItems.forEach((item: any) => {
            const existing = itemsByTxId.get(item.transaction_id) || [];
            existing.push(item);
            itemsByTxId.set(item.transaction_id, existing);
          });
        }
      } catch (e) {
        console.error('Error fetching transaction items for PDF:', e);
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
      transactions: debtor.transactions.map(t => {
        // Construir descripcion enriquecida con detalles del consumo
        let desc = t.description || 'Consumo';

        // Si tiene items reales de POS, mostrar los productos en vez de la descripcion generica
        const items = itemsByTxId.get(t.id);
        if (items && items.length > 0) {
          const productLines = items.map((item: any) => 
            `${item.product_name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`
          );
          desc = productLines.join(', ');
        } else if (t.metadata?.menu_name && !desc.toLowerCase().includes(t.metadata.menu_name.toLowerCase())) {
          desc = `${desc} — ${t.metadata.menu_name}`;
        }

        // Usar fecha del pedido si esta disponible, si no la fecha de la transaccion
        const orderDate = t.metadata?.order_created_at || t.created_at;
        return {
          id: t.id,
          created_at: orderDate,
          payment_date: t.created_at,
          ticket_code: t.ticket_code,
          description: desc,
          amount: t.amount,
          menu_name: t.metadata?.menu_name || null,
          menu_date: t.metadata?.menu_date || null,
          payment_method: t.payment_method || null,
        };
      }),
      total_amount: debtor.total_amount,
      lunch_amount: debtor.lunch_amount,
      cafeteria_amount: debtor.cafeteria_amount,
      pending_amount: debtor.total_amount,
      logo_base64: logoBase64
    });

    toast({
      title: '✅ PDF generado',
      description: `Estado de cuenta de ${debtor.client_name}`,
    });
  };

  // �� ENVIAR WHATSAPP INDIVIDUAL A UN DEUDOR (solo para almuerzos)
  const sendWhatsAppReminder = (debtor: Debtor) => {
    const phone = debtor.parent_phone || '';
    if (!phone) {
      toast({
        variant: 'destructive',
        title: 'Sin número de teléfono',
        description: 'Este deudor no tiene un número de teléfono registrado.',
      });
      return;
    }

    // Calcular monto solo de transacciones de almuerzo
    const lunchTransactions = debtor.transactions.filter((t: any) => 
      t.metadata?.lunch_order_id || 
      t.metadata?.source?.includes('lunch') || 
      t.description?.toLowerCase().includes('almuerzo')
    );
    const lunchAmount = lunchTransactions.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
    const lunchCount = lunchTransactions.length;

    // Usar plantilla según tipo de deudor, con fallback
    let message: string;
    const lunchTemplate = configLunchTemplate.trim()
      || (debtor.client_type === 'student' ? configStudentTemplate.trim() : configTeacherTemplate.trim())
      || configMessageTemplate;
    if (lunchTemplate && lunchTemplate.trim()) {
      message = resolveMessageTemplate(lunchTemplate, debtor, lunchAmount, lunchCount);
    } else {
      // Mensaje por defecto si no hay plantilla configurada
      const cuentaInfo = schoolConfig?.bank_account_number
        ? `\n\n🏦 *N° Cuenta:* ${schoolConfig.bank_account_number}${schoolConfig?.bank_cci ? `\n💳 *CCI:* ${schoolConfig.bank_cci}` : ''}${schoolConfig?.yape_number ? `\n💜 *Yape:* ${schoolConfig.yape_number}` : ''}${schoolConfig?.plin_number ? `\n🟢 *Plin:* ${schoolConfig.plin_number}` : ''}`
        : '';
      message = `🔔 *AVISO DE PAGO DE ALMUERZO PENDIENTE*

Estimado(a) padre de familia,

Le informamos que su hijo(a) *${debtor.client_name}* tiene *${lunchCount} almuerzo(s) pendiente(s) de pago* por un monto total de *S/ ${lunchAmount.toFixed(2)}*.

⚠️ Es necesario que cancele su almuerzo para que pueda ser procesado y reflejado en el sistema.

📱 *¿Cómo pagar?*
1. Ingrese a la aplicación
2. Vaya a la sección "Pagos"
3. Seleccione los almuerzos pendientes
4. Suba su comprobante de pago (voucher)${cuentaInfo}

Si ya realizó el pago, por favor envíe su comprobante lo antes posible para que podamos procesarlo.

Agradecemos su pronta atención. 🙏`;
    }

    // Limpiar número de teléfono
    let cleanPhone = phone.replace(/[^0-9+]/g, '');
    // Si empieza con 9 y tiene 9 d�gitos, agregar c�digo de pa�s Per�
    if (/^9\d{8}$/.test(cleanPhone)) {
      cleanPhone = '51' + cleanPhone;
    }
    // Si empieza con +, quitarlo (wa.me no lo necesita)
    cleanPhone = cleanPhone.replace(/^\+/, '');

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');

    toast({
      title: '�� Abriendo WhatsApp',
      description: `Enviando recordatorio a ${debtor.parent_name || debtor.client_name}`,
    });
  };

  const generateWhatsAppExport = async () => {
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

    // ── Batch-fetch transaction_items de todas las transacciones POS ──
    const allPosIds = selectedDebtorsList.flatMap(d =>
      d.transactions
        .filter((t: any) => !isLunchTx(t) && t.id && !t.id.toString().startsWith('lunch_'))
        .map((t: any) => t.id)
    );

    const globalItemsByTxId = new Map<string, any[]>();
    if (allPosIds.length > 0) {
      // Chunked en lotes de 200 para no generar URLs muy largas
      const CHUNK = 200;
      for (let i = 0; i < allPosIds.length; i += CHUNK) {
        const batch = allPosIds.slice(i, i + CHUNK);
        try {
          const { data: txItems } = await supabase
            .from('transaction_items')
            .select('transaction_id, product_name, quantity, unit_price')
            .in('transaction_id', batch)
            .range(0, 4999);
          (txItems || []).forEach((item: any) => {
            const existing = globalItemsByTxId.get(item.transaction_id) || [];
            existing.push(item);
            globalItemsByTxId.set(item.transaction_id, existing);
          });
        } catch (e) {
          console.error('[generateWhatsAppExport] Error fetching transaction_items batch:', e);
        }
      }
    }

    // ── Cargar billing_config de todas las sedes involucradas ──
    const allSchoolIds = selectedDebtorsList.map(d => d.school_id).filter(Boolean);
    const billingConfigMap = await fetchBillingConfigBySchools(allSchoolIds);

    // ── Construir mensajes con desglose detallado ──
    const messages = selectedDebtorsList.map((debtor, index) => {
      const delay = Math.floor(Math.random() * (300 - 15 + 1)) + 15;

      const desglose = buildTransactionDesglose(debtor.transactions, globalItemsByTxId, 'all');

      const billingRow = billingConfigMap.get(debtor.school_id) ?? null;
      const template = pickTemplate('all', debtor, billingRow);
      const periodoLinea = period ? `📅 Período: ${period.period_name}\n` : '';

      let message: string;
      if (template) {
        message = resolveMessageTemplate(template, debtor, debtor.total_amount, debtor.transactions.filter((t: any) => isLunchTx(t)).length, desglose);
      } else {
        const destinatario = debtor.client_type === 'student'
          ? (debtor.parent_name || 'Padre/Madre de familia')
          : debtor.client_name;
        const desgloseSplit = debtor.lunch_amount > 0 && debtor.cafeteria_amount > 0
          ? `\n🍽 Almuerzos: S/ ${debtor.lunch_amount.toFixed(2)}\n☕ Cafetería: S/ ${debtor.cafeteria_amount.toFixed(2)}`
          : '';
        message = `🔔 *COBRANZA LIMA CAFÉ 28*\n\nHola *${destinatario}*, te escribimos de la cafetería.\nTe enviamos el detalle de los consumos pendientes de *${debtor.client_name}*:\n\n${periodoLinea}${desglose}\n${desgloseSplit}\n*💰 Total a pagar: S/ ${debtor.total_amount.toFixed(2)}*\n\nPara pagar, contacta con administración.\nGracias.`;
      }

      return {
        index: index + 1,
        phone: debtor.parent_phone,
        parent_name: debtor.parent_name,
        student_name: debtor.client_name,
        amount: debtor.total_amount.toFixed(2),
        lunch_amount: debtor.lunch_amount.toFixed(2),
        cafeteria_amount: debtor.cafeteria_amount.toFixed(2),
        period: period?.period_name || 'Cuenta Pendiente',
        message,
        delay_seconds: delay,
        pdf_url: '',
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
      description: `${messages.length} mensajes con desglose detallado (intervalos 15-300 seg)`,
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

    // Generar PDFs con peque�o delay entre cada uno
    for (let i = 0; i < selectedDebtorsList.length; i++) {
      const debtor = selectedDebtorsList[i];
      
      const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
      const periodName = period ? period.period_name : 'Todas las deudas';
      
      // Calcular fechas reales basadas en las transacciones si no hay per�odo
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
        lunch_amount: debtor.lunch_amount,
        cafeteria_amount: debtor.cafeteria_amount,
        pending_amount: debtor.total_amount,
        logo_base64: logoBase64
      });

      // Peque�o delay entre PDFs para evitar bloqueo del navegador
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

  // Funci�n para obtener el cargo y descripci�n completa del usuario
  const getUserRoleDescription = (profile: any, schoolName: string) => {
    if (!profile) return null;
    
    const name = profile.full_name || profile.email || 'Usuario';
    // Usar el school_name del perfil si existe, si no, usar el que viene de la transacci�n
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

  // Funci�n para obtener pagos realizados
  const fetchPaidTransactions = async (page = paidPage) => {
    const currentPaidRequestId = ++fetchPaidRequestId.current;
    try {
      setLoadingPaid(true);
      
      const schoolIdFilter = !canViewAllSchools || selectedSchool !== 'all' 
        ? (selectedSchool !== 'all' ? selectedSchool : userSchoolId)
        : null;

      const statusFilter = paidStatusFilter || 'all';


      // Fix: reemplazamos las dos queries directas con embedded joins
      // (que causaban 400 Bad Request) por dos RPCs que usan POST.
      const rpcParams = {
        p_school_id:   schoolIdFilter ?? null,
        p_status:      statusFilter !== 'all' ? statusFilter : null,
        p_date_from:   paidDateFrom ? `${paidDateFrom}T00:00:00` : null,
        p_date_to:     paidDateTo   ? `${paidDateTo}T23:59:59`   : null,
        p_search_term: null,
      };

      // 1. Contar total
      const { data: countData, error: countError } = await supabase.rpc(
        'count_billing_paid_transactions', rpcParams
      );
      if (countError) throw countError;
      const count = Number(countData || 0);
      if (currentPaidRequestId !== fetchPaidRequestId.current) return;
      setPaidTotalCount(count);

      // 2. Cargar página actual
      const offsetVal = (page - 1) * PAID_PER_PAGE;
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'get_billing_paid_transactions',
        { ...rpcParams, p_offset: offsetVal, p_limit: PAID_PER_PAGE }
      );
      if (rpcError) throw rpcError;

      // Rehidratar al formato que espera el resto del componente
      const data = (rpcData || []).map((row: any) => ({
        ...row,
        students:         row.student_id ? { id: row.student_id, full_name: row.student_full_name, parent_id: row.student_parent_id } : null,
        teacher_profiles: row.teacher_id ? { id: row.teacher_id, full_name: row.teacher_full_name } : null,
        schools:          row.school_id  ? { id: row.school_id,  name: row.school_name }             : null,
      }));

      // Filtrar transacciones de pedidos cancelados
      const lunchOrderIds = data
        ?.map((t: any) => t.metadata?.lunch_order_id)
        .filter(Boolean) || [];
      
      let cancelledOrderIds = new Set<string>();
      let existingLunchOrderIds2 = new Set<string>();
      if (lunchOrderIds.length > 0) {
        const uniqueIds2 = [...new Set(lunchOrderIds)];
        const allExisting2: any[] = [];
        const CH = 200;
        for (let i = 0; i < uniqueIds2.length; i += CH) {
          const b = uniqueIds2.slice(i, i + CH);
          const { data: bd } = await supabase
            .from('lunch_orders')
            .select('id, is_cancelled')
            .in('id', b);
          if (bd) allExisting2.push(...bd);
        }
        cancelledOrderIds = new Set(
          allExisting2.filter((o: any) => o.is_cancelled).map((o: any) => o.id)
        );
        existingLunchOrderIds2 = new Set(allExisting2.map((o: any) => o.id));
      }
      
      const validTransactions = data?.filter((t: any) => {
        if (t.metadata?.lunch_order_id) {
          if (cancelledOrderIds.has(t.metadata.lunch_order_id)) return false;
          if (!existingLunchOrderIds2.has(t.metadata.lunch_order_id)) return false;
        }
        return true;
      }) || [];

      // Obtener información del creador (created_by)
      const userIds = [...new Set(validTransactions.map((t: any) => t.created_by).filter(Boolean))];
      let createdByMap = new Map();
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, role, school_id, schools(id, name)')
          .in('id', userIds);
        
        profiles?.forEach((p: any) => {
          createdByMap.set(p.id, { ...p, school_name: p.schools?.name || null });
        });

        const { data: teacherProfiles } = await supabase
          .from('teacher_profiles')
          .select('id, full_name, school_id_1, schools!school_id_1(id, name)')
          .in('id', userIds);
        
        teacherProfiles?.forEach((tp: any) => {
          if (createdByMap.has(tp.id)) {
            const existing = createdByMap.get(tp.id);
            createdByMap.set(tp.id, { ...existing, teacher_school_name: tp.schools?.name || null, teacher_school_id: tp.school_id_1 });
          } else {
            createdByMap.set(tp.id, { id: tp.id, full_name: tp.full_name, role: 'teacher', school_id: tp.school_id_1, school_name: tp.schools?.name || null });
          }
        });
      }

      const transactionsWithCreator = validTransactions.map((t: any) => ({
        ...t,
        created_by_profile: createdByMap.get(t.created_by) || null
      }));

      if (currentPaidRequestId !== fetchPaidRequestId.current) return;
      setPaidTransactions(transactionsWithCreator);
    } catch (error) {
      if (currentPaidRequestId !== fetchPaidRequestId.current) return;
      console.error('Error fetching paid transactions:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pagos realizados',
        variant: 'destructive',
      });
    } finally {
      if (currentPaidRequestId === fetchPaidRequestId.current) {
        setLoadingPaid(false);
      }
    }
  };

  // Cargar pagos realizados cuando cambia la pestaña o la página
  useEffect(() => {
    if (activeTab === 'pagos') {
      fetchPaidTransactions(paidPage);
    }
    if (activeTab === 'config' && userSchoolId) {
      fetchSchoolConfig();
    }
  }, [activeTab, selectedSchool, canViewAllSchools, userSchoolId, paidPage, paidDateFrom, paidDateTo, paidStatusFilter]);

  // Cargar configuración de sede (se llama al montar y al entrar al tab config)
  const fetchSchoolConfig = async (schoolId?: string) => {
    const targetSchoolId = schoolId || userSchoolId;
    if (!targetSchoolId) return;
    setLoadingSchoolConfig(true);
    try {
      const { data, error } = await supabase
        .from('billing_config')
        .select('*')
        .eq('school_id', targetSchoolId)
        .maybeSingle();
      if (error) throw error;
      setSchoolConfig(data || null);
      setConfigMessageTemplate(data?.student_message_template || data?.message_template || '');
      setConfigStudentTemplate(data?.student_message_template || data?.message_template || '');
      setConfigTeacherTemplate(data?.teacher_message_template || '');
      setConfigLunchTemplate(data?.lunch_message_template || '');
      setConfigCafeteriaTemplate(data?.cafeteria_message_template || '');
      setConfigYapeEnabled(data?.yape_enabled ?? true);
      setConfigPlinEnabled(data?.plin_enabled ?? true);
      setConfigTransferenciaEnabled(data?.transferencia_enabled ?? true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar la configuración de la sede.' });
    } finally {
      setLoadingSchoolConfig(false);
    }
  };

  // Reemplazar variables en un mensaje de plantilla con datos reales
  const resolveMessageTemplate = (
    template: string,
    debtor: any,
    amount: number,
    count: number,
    desglose: string = '',
    billingRow: any = null
  ): string => {
    const destinatario = debtor.client_type === 'student'
      ? (debtor.parent_name || 'Padre de familia')
      : debtor.client_name || '';

    // Usar datos de la fila billing_config específica del deudor si está disponible
    const bankAccount = billingRow?.bank_account_number || schoolConfig?.bank_account_number || '';
    const bankCci     = billingRow?.bank_cci             || schoolConfig?.bank_cci             || '';
    const yapeNum     = billingRow?.yape_number          || schoolConfig?.yape_number          || '';
    const plinNum     = billingRow?.plin_number          || schoolConfig?.plin_number          || '';

    let result = template
      .replace(/\{nombre_padre\}/g, debtor.parent_name || destinatario)
      .replace(/\{nombre_estudiante\}/g, debtor.client_name || '')
      .replace(/\{nombre\}/g, debtor.client_name || '')
      .replace(/\{destinatario\}/g, destinatario)
      .replace(/\{monto\}/g, amount.toFixed(2))
      .replace(/\{monto_total\}/g, (debtor.total_amount || amount).toFixed(2))
      .replace(/\{monto_almuerzo\}/g, (debtor.lunch_amount || 0).toFixed(2))
      .replace(/\{monto_cafeteria\}/g, (debtor.cafeteria_amount || 0).toFixed(2))
      .replace(/\{periodo\}/g, selectedPeriod !== 'all' ? (periods.find(p => p.id === selectedPeriod)?.period_name || '') : '')
      .replace(/\{numero_cuenta\}/g, bankAccount)
      .replace(/\{numero_cci\}/g, bankCci)
      .replace(/\{numero_yape\}/g, yapeNum)
      .replace(/\{numero_plin\}/g, plinNum)
      .replace(/\{desglose\}/g, desglose);

    // Si la plantilla NO tenía {desglose} pero hay detalle disponible, lo agregamos
    // automáticamente antes del total para que siempre llegue al padre/apoderado.
    if (desglose && !template.includes('{desglose}')) {
      // Insertar antes de la línea del monto total (si existe) o al final
      const totalLine = result.match(/\*?💰.*Total.*\n?/);
      if (totalLine && totalLine.index !== undefined) {
        result = result.slice(0, totalLine.index) + desglose + '\n\n' + result.slice(totalLine.index);
      } else {
        result = result + '\n\n' + desglose;
      }
    }

    return result;
  };

  // Guardar solo mensaje + habilitaciones (sin editar números)
  const saveSchoolConfig = async () => {
    if (!userSchoolId || !user) return;
    setSavingSchoolConfig(true);
    try {
      const payload = {
        school_id: userSchoolId,
        message_template: configStudentTemplate || configMessageTemplate,
        student_message_template: configStudentTemplate || null,
        teacher_message_template: configTeacherTemplate || null,
        lunch_message_template: configLunchTemplate || null,
        cafeteria_message_template: configCafeteriaTemplate || null,
        yape_enabled: configYapeEnabled,
        plin_enabled: configPlinEnabled,
        transferencia_enabled: configTransferenciaEnabled,
        updated_by: user.id,
      };
      // Upsert: crea si no existe, actualiza si ya existe (evita fallo silencioso de RLS)
      const { error } = await supabase
        .from('billing_config')
        .upsert(payload, { onConflict: 'school_id' });
      if (error) throw error;
      toast({ title: '✅ Configuración guardada', description: 'Los cambios se aplicaron correctamente.' });
      fetchSchoolConfig();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e?.message });
    } finally {
      setSavingSchoolConfig(false);
    }
  };

  // Generar guía de pago para padres
  const getPaymentGuideMessage = () => {
    return `📋 *GUÍA PARA REALIZAR TU PAGO — LIMA CAFÉ 28*

Hola, te explicamos cómo registrar tu pago paso a paso para que se procese correctamente:

*PASO 1 — Ingresa a la aplicación*
📱 Abre la app Lima Café 28 desde tu teléfono.

*PASO 2 — Ve a la sección "Pagos"*
💳 En el menú principal, selecciona la opción *"Pagos"*.

*PASO 3 — Selecciona el pedido pendiente*
🍽️ Verás tus almuerzos o consumos pendientes de pago. Selecciona el que deseas pagar.

*PASO 4 — Elige tu método de pago*
Puedes pagar por:
• 💜 *Yape* — al número registrado de la sede
• 🟢 *Plin* — al número registrado de la sede
• 🏦 *Transferencia bancaria* — a la cuenta de la sede

*PASO 5 — Sube tu comprobante (voucher)*
📸 Después de realizar el pago, toma una captura de pantalla del comprobante y súbela en la app.

*PASO 6 — Espera la confirmación*
✅ Nuestro equipo revisará tu comprobante y procesará el pago. Recibirás la confirmación en la app.

⚠️ *IMPORTANTE:* El almuerzo solo se confirma una vez que el comprobante haya sido aprobado.

Si tienes dudas, comunícate con la administración de tu sede.

¡Gracias por tu atención! 🙏`;
  };

  const copyPaymentGuide = () => {
    navigator.clipboard.writeText(getPaymentGuideMessage());
    toast({
      title: '📋 Guía copiada',
      description: 'La guía de pago fue copiada al portapapeles. Pégala en WhatsApp para enviarla.',
    });
  };

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

      // T�tulo
      doc.setFontSize(20);
      doc.setTextColor(34, 139, 34); // Verde
      doc.text('COMPROBANTE DE PAGO', pageWidth / 2, 25, { align: 'center' });

      // Subt�tulo
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text('Lima Caf� - Sistema de Cobranzas', pageWidth / 2, 32, { align: 'center' });

      // L�nea separadora
      doc.setDrawColor(34, 139, 34);
      doc.setLineWidth(0.5);
      doc.line(15, 50, pageWidth - 15, 50);

      // Informaci�n del pago
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
      const methodText = transaction.payment_method 
        ? transaction.payment_method === 'teacher_account' ? 'CUENTA PROFESOR' 
          : transaction.payment_method === 'mixto' ? 'PAGO MIXTO/DIVIDIDO'
          : transaction.payment_method
        : transaction.ticket_code ? 'PAGO DIRECTO EN CAJA' : 'NO REGISTRADO';
      doc.text(methodText.toUpperCase(), 70, yPos);
      yPos += 7;

      // 🆕 Desglose de pago dividido/mixto en PDF
      if (transaction.metadata?.payment_breakdown && Array.isArray(transaction.metadata.payment_breakdown)) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('DESGLOSE DE PAGOS:', 15, yPos);
        yPos += 6;
        doc.setFont('helvetica', 'normal');
        transaction.metadata.payment_breakdown.forEach((entry: any, idx: number) => {
          const lineText = `  Pago ${idx + 1}: ${String(entry.method).toUpperCase()} - S/ ${Number(entry.amount).toFixed(2)}${entry.operation_number ? ` (Nº ${entry.operation_number})` : ''}`;
          doc.text(lineText, 15, yPos);
          yPos += 5;
        });
        doc.setFontSize(10);
        yPos += 2;
      }

      // Número de ticket (si existe)
      if (transaction.ticket_code) {
        doc.setFont('helvetica', 'bold');
        doc.text('Nº TICKET:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.ticket_code, 70, yPos);
        yPos += 7;
      }

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
      
      // Descripci�n del consumo en recuadro blanco
      doc.setFillColor(240, 245, 255); // Azul muy claro
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.5);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      const description = transaction.description || 'Sin descripci�n';
      const descriptionLines = doc.splitTextToSize(description, pageWidth - 40);
      const descHeight = descriptionLines.length * 5 + 8;
      
      doc.rect(15, yPos - 2, pageWidth - 30, descHeight, 'FD');
      doc.text(descriptionLines, 20, yPos + 3);
      yPos += descHeight + 5;

      // L�nea separadora
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
      doc.text('Este es un comprobante interno generado por el sistema Lima Caf�', pageWidth / 2, footerY, { align: 'center' });
      doc.text(`Generado el: ${format(new Date(), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}`, pageWidth / 2, footerY + 5, { align: 'center' });
      doc.text('Para consultas: contacto@limacafe.pe', pageWidth / 2, footerY + 10, { align: 'center' });

      // Guardar PDF
      const fileName = `Comprobante_Pago_${clientName.replace(/\s+/g, '_')}_${format(new Date(transaction.created_at), 'ddMMyyyy_HHmm')}.pdf`;
      doc.save(fileName);

      toast({
        title: '✅ Comprobante generado',
        description: `Se descarg� el comprobante de pago exitosamente`,
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

  // ── ABRIR MODAL DE CONFIRMACIÓN DE ANULACIÓN ─────────────────────────────
  // Consulta el billing_status real de la transacción antes de mostrar el modal
  // (el RPC de reportes no lo devuelve, hay que buscarlo en la tabla).
  const openCancelLunchModal = async () => {
    if (!selectedTransaction?.id) return;
    setLoadingCancelCheck(true);
    try {
      const { data } = await supabase
        .from('transactions')
        .select('billing_status')
        .eq('id', selectedTransaction.id)
        .single();
      setCancelLunchBillingStatus(data?.billing_status ?? null);
    } catch {
      setCancelLunchBillingStatus(null);
    } finally {
      setLoadingCancelCheck(false);
      setShowCancelWalletModal(true);
    }
  };

  // ── EJECUTAR LA ANULACIÓN CON CRÉDITO DE BILLETERA ───────────────────────
  const handleCancelWithWallet = async () => {
    const lunchOrderId = selectedTransaction?.metadata?.lunch_order_id;
    if (!lunchOrderId) return;

    setCancellingWallet(true);
    try {
      const { data, error } = await supabase.rpc(
        'cancel_lunch_order_with_wallet_credit',
        {
          p_lunch_order_id: lunchOrderId,
          p_reason: 'Anulación desde módulo de cobranzas',
        }
      );
      if (error) throw error;

      const result = data as any;
      setShowCancelWalletModal(false);
      setShowDetailsModal(false);

      if (result.wallet_credit_amount > 0) {
        toast({
          title: '✅ Almuerzo anulado — Saldo acreditado',
          description:
            `S/ ${Number(result.wallet_credit_amount).toFixed(2)} acreditados en la ` +
            `billetera del alumno. Nuevo saldo disponible: ` +
            `S/ ${Number(result.new_wallet_balance).toFixed(2)}`,
          duration: 7000,
        });
      } else {
        toast({
          title: '✅ Almuerzo anulado',
          description: result.message || 'El pedido fue cancelado correctamente.',
          duration: 5000,
        });
      }

      // Refrescar listas
      fetchDebtors();
    } catch (err: any) {
      const msg = err?.message ?? '';
      toast({
        variant: 'destructive',
        title: 'Error al anular',
        description: msg.includes('ALREADY_CANCELLED')
          ? 'Este pedido ya estaba anulado.'
          : msg.includes('NOT_FOUND')
          ? 'No se encontró el pedido de almuerzo.'
          : msg || 'No se pudo anular el pedido. Intenta de nuevo.',
      });
    } finally {
      setCancellingWallet(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alerta de API SUNAT no conectado — solo en pestañas relevantes */}
      {activeTab !== 'pagos' && (
      <Alert className="bg-amber-50 border-amber-200">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <AlertDescription className="text-amber-900">
          <strong>⚠️� API de Facturaci�n SUNAT a�n no conectado</strong>
          <br />
          Por el momento, los documentos se generar�n como comprobantes internos. 
          Pr�ximamente se habilitar� la facturaci�n electr�nica oficial.
        </AlertDescription>
      </Alert>
      )}

      {/* Filtros principales — solo visibles en pestaña Cobrar */}
      {activeTab !== 'pagos' && activeTab !== 'config' && (
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Sede */}
            {canViewAllSchools && (
              <div className="space-y-2">
                <Label>Sede</Label>
                <select
                  value={selectedSchool}
                  onChange={(e) => { setSelectedSchool(e.target.value); setDebtorsPage(1); setPaidPage(1); }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="all">Todas las Sedes</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Per�odo (OPCIONAL) */}
            <div className="space-y-2">
              <Label>Per�odo de Cobranza (Opcional)</Label>
              <select
                value={selectedPeriod || 'all'}
                onChange={(e) => setSelectedPeriod(e.target.value === 'all' ? '' : e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="all">Todas las deudas</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.period_name}
                  </option>
                ))}
              </select>
            </div>


            {/* Filtro: Rango de fechas Desde / Hasta */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Período de cobranza:
              </Label>
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-gray-500 font-medium">Desde</span>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setDebtorsPage(1); setPaidPage(1); }}
                    className="w-full"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-gray-500 font-medium">Hasta</span>
                  <Input
                    type="date"
                    value={untilDate}
                    onChange={(e) => { setUntilDate(e.target.value); setDebtorsPage(1); setPaidPage(1); }}
                    className="w-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    variant="default"
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap text-xs"
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0];
                      setUntilDate(today);
                      setDebtorsPage(1);
                      setPaidPage(1);
                    }}
                  >
                    Hasta Hoy
                  </Button>
                  {(fromDate || untilDate) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-gray-400 hover:text-red-500 px-2"
                      onClick={() => { setFromDate(''); setUntilDate(''); setDebtorsPage(1); setPaidPage(1); }}
                    >
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>
              {(fromDate || untilDate) && (
                <p className="text-xs text-blue-600 font-medium mt-1">
                  {fromDate && untilDate
                    ? `Deudas del ${format(new Date(fromDate + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })} al ${format(new Date(untilDate + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })}`
                    : fromDate
                    ? `Deudas desde el ${format(new Date(fromDate + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })}`
                    : `Deudas hasta el ${format(new Date(untilDate + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })}`
                  }
                </p>
              )}
            </div>
            {/* Buscador */}
            <div className="space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Nombre, profesor, sede..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setDebtorsPage(1); }}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {activeTab !== 'pagos' && activeTab !== 'config' && loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-red-600" />
          <p className="ml-3 text-gray-600">Cargando deudores...</p>
        </div>
      )}

      {activeTab !== 'pagos' && activeTab !== 'config' && !loading && fetchError && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-red-700 font-semibold text-center">{fetchError}</p>
          <button
            className="text-sm text-blue-600 underline"
            onClick={() => { setFetchError(null); fetchDebtors(); }}
          >
            Reintentar
          </button>
        </div>
      )}

      {activeTab === 'cobrar' && !loading && (
        <>
          {/* Acciones masivas */}
          {filteredDebtors.length > 0 && (
            <Card className="bg-gradient-to-r from-orange-50 to-red-50 border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={paginatedDebtors.length > 0 && paginatedDebtors.every(d => selectedDebtors.has(d.id))}
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

                  <div className="flex gap-2 flex-wrap">
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
                    <Button
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold gap-2"
                      onClick={openCxcModal}
                      disabled={filteredDebtors.length === 0}
                    >
                      <ClipboardList className="h-4 w-4" />
                      CXC
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}

          {/* Pestañas: Cobrar / Pagos Realizados / Configuración + botón Guía - Sin Radix */}
          <div className="w-full">

            {/* Botones de Guía cuando se usa sección externa (sin sub-pestañas) */}
            {section && (
              <div className="flex justify-end gap-1 mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-blue-300 text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                  onClick={() => setShowPaymentGuide(true)}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Ver guía</span>
                  <span className="sm:hidden">Guía</span>
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
                  onClick={copyPaymentGuide}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Copiar guía</span>
                  <span className="sm:hidden">Copiar</span>
                </Button>
              </div>
            )}

            {/* Solo mostrar la barra de sub-pestañas si NO se controla desde Cobranzas.tsx */}
            {!section && (
            <div className="flex items-center gap-2 mb-6">
              {/* Tabs */}
              <div className={`flex-1 grid ${!canViewAllSchools ? 'grid-cols-3' : 'grid-cols-2'} bg-muted p-1 rounded-lg`}>
              <button
                onClick={() => setActiveTab('cobrar')}
                className={`flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === 'cobrar'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <DollarSign className="h-4 w-4" />
                ¡Cobrar!
              </button>
              <button
                onClick={() => setActiveTab('pagos')}
                className={`flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === 'pagos'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <History className="h-4 w-4" />
                Pagos Realizados
              </button>
              {!canViewAllSchools && (
                <button
                  onClick={() => setActiveTab('config')}
                  className={`flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'config'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <MessageSquare className="h-4 w-4" />
                  Configuración
                </button>
              )}
              </div>

              {/* Botón Guía de Pago — al lado de las pestañas */}
              <div className="flex gap-1 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-blue-300 text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                  onClick={() => setShowPaymentGuide(true)}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Ver guía</span>
                  <span className="sm:hidden">Guía</span>
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
                  onClick={copyPaymentGuide}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Copiar guía</span>
                  <span className="sm:hidden">Copiar</span>
                </Button>
              </div>
            </div>
            )}

            {activeTab === 'cobrar' && (
            <div className="mt-0">
              {/* Lista de deudores */}
              {/* FIX race condition: el empty state SOLO se muestra cuando !loading.
                  Antes, loading=true + debtors=[] mostraban el spinner Y este mensaje
                  al mismo tiempo porque este bloque estaba fuera del guard !loading. */}
              {loading ? null : filteredDebtors.length === 0 ? (
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
              {/* Info de paginación */}
              {debtorsTotalCount > DEBTORS_PER_PAGE && (
                <div className="flex items-center justify-between px-1 text-sm text-gray-500">
                  <span>
                    Mostrando {((safeDebtorsPage - 1) * DEBTORS_PER_PAGE) + 1}–{Math.min(safeDebtorsPage * DEBTORS_PER_PAGE, debtorsTotalCount)} de {debtorsTotalCount} deudores
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={safeDebtorsPage <= 1} onClick={() => setDebtorsPage(1)}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={safeDebtorsPage <= 1} onClick={() => setDebtorsPage(p => Math.max(1, p - 1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-3 font-medium text-gray-700">
                      {safeDebtorsPage} / {debtorsTotalPages}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={safeDebtorsPage >= debtorsTotalPages} onClick={() => setDebtorsPage(p => Math.min(debtorsTotalPages, p + 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={safeDebtorsPage >= debtorsTotalPages} onClick={() => setDebtorsPage(debtorsTotalPages)}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {paginatedDebtors.map((debtor) => {
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
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h3 className="font-bold text-xl text-gray-900">{debtor.client_name}</h3>
                                {debtor.client_type === 'student' && (debtor.student_grade || debtor.student_section) && (
                                  <span className="text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                                    {[debtor.student_grade, debtor.student_section].filter(Boolean).join(' - ')}
                                  </span>
                                )}
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
                              <div className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 mt-1 bg-blue-50 px-2 py-1 rounded-md">
                                <Building2 className="h-4 w-4" />
                                {debtor.school_name}
                              </div>
                              {/* �� INDICADOR DE VOUCHER (solo para deudas de almuerzo de estudiantes) */}
                              {debtor.has_lunch_debt && debtor.client_type === 'student' && debtor.voucher_status === 'none' && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-xs">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    ��️ Almuerzo sin voucher enviado
                                  </Badge>
                                </div>
                              )}
                              {debtor.has_lunch_debt && debtor.voucher_status === 'pending' && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 text-xs">
                                    <History className="h-3 w-3 mr-1" />
                                    ��️ Voucher pendiente de aprobaci�n
                                  </Badge>
                                </div>
                              )}
                              {debtor.has_lunch_debt && debtor.voucher_status === 'rejected' && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300 text-xs">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    ��️ Voucher rechazado
                                  </Badge>
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-3xl font-bold text-red-600">
                                S/ {debtor.total_amount.toFixed(2)}
                              </p>
                              <Badge variant="destructive" className="mt-1">
                                {debtor.transaction_count} consumo(s)
                              </Badge>
                              {debtor.lunch_amount > 0 && debtor.cafeteria_amount > 0 && (
                                <div className="mt-1.5 text-xs space-y-0.5">
                                  <div className="text-orange-600 font-medium">🍽 Almuerzo: S/ {debtor.lunch_amount.toFixed(2)}</div>
                                  <div className="text-purple-600 font-medium">☕ Cafetería: S/ {debtor.cafeteria_amount.toFixed(2)}</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Informaci�n de fechas y comprobantes */}
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
                            
                            {/* Botón de detalle — reemplaza el acordeón inline */}
                            <button
                              className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                              onClick={async () => {
                                setSelectedDebtorForDetail(debtor);
                                setHistoricalDebt(null);
                                setShowDebtorDetailModal(true);
                                // Deuda histórica total (sin filtros de fecha) — usa view_student_debts
                                if (debtor.student_id) {
                                  setLoadingHistoricalDebt(true);
                                  try {
                                    const { data } = await supabase
                                      .from('view_student_debts')
                                      .select('monto')
                                      .eq('student_id', debtor.student_id)
                                      .neq('fuente', 'saldo_negativo');
                                    const total = (data ?? []).reduce((s, r) => s + Number(r.monto), 0);
                                    setHistoricalDebt({ total, count: (data ?? []).length });
                                  } catch { /* silencioso */ }
                                  finally { setLoadingHistoricalDebt(false); }
                                }
                              }}
                            >
                              <Eye className="h-4 w-4" />
                              Ver Detalle ({debtor.transaction_count} consumo{debtor.transaction_count !== 1 ? 's' : ''})
                            </button>
                          </div>

                          {/* Botones de acción */}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => handleOpenPayment(debtor, 'all')}
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              Cobrar S/ {debtor.total_amount.toFixed(2)}
                            </Button>

                            {debtor.lunch_amount > 0 && debtor.cafeteria_amount > 0 ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline">
                                    <Copy className="h-4 w-4 mr-1" />
                                    Copiar Mensaje
                                    <ChevronDown className="h-3 w-3 ml-1" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => copyMessage(debtor, 'all')}>
                                    <MessageSquare className="h-4 w-4 mr-2" />
                                    Todo — S/ {debtor.total_amount.toFixed(2)}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => copyMessage(debtor, 'lunch')}>
                                    <UtensilsCrossed className="h-4 w-4 mr-2 text-orange-600" />
                                    Almuerzos — S/ {debtor.lunch_amount.toFixed(2)}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => copyMessage(debtor, 'cafeteria')}>
                                    <Coffee className="h-4 w-4 mr-2 text-purple-600" />
                                    Cafetería — S/ {debtor.cafeteria_amount.toFixed(2)}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyMessage(debtor, 'all')}
                              >
                                <Copy className="h-4 w-4 mr-1" />
                                Copiar Mensaje
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generatePDF(debtor)}
                            >
                              <FileText className="h-4 w-4 mr-1" />
                              PDF
                            </Button>

                            {/* �� BOT�N WHATSAPP INDIVIDUAL (solo para deudas de almuerzo) */}
                            {debtor.has_lunch_debt && debtor.parent_phone && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-green-50 hover:bg-green-100 text-green-700 border-green-300"
                                onClick={() => sendWhatsAppReminder(debtor)}
                              >
                                <Phone className="h-4 w-4 mr-1" />
                                WhatsApp
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Paginación inferior */}
              {debtorsTotalCount > DEBTORS_PER_PAGE && (
                <div className="flex items-center justify-between px-1 pt-4 text-sm text-gray-500">
                  <span>
                    Página {safeDebtorsPage} de {debtorsTotalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={safeDebtorsPage <= 1} onClick={() => { setDebtorsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={safeDebtorsPage <= 1} onClick={() => { setDebtorsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Anterior
                    </Button>
                    <Button variant="outline" size="sm" disabled={safeDebtorsPage >= debtorsTotalPages} onClick={() => { setDebtorsPage(p => Math.min(debtorsTotalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={safeDebtorsPage >= debtorsTotalPages} onClick={() => { setDebtorsPage(debtorsTotalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
            </div>
            )}

            {activeTab === 'pagos' && (
            <BillingReportsTab
              schools={schools}
              userSchoolId={userSchoolId}
              canViewAllSchools={canViewAllSchools}
              onOpenDetails={(transaction) => {
                setSelectedTransaction(transaction);
                setShowDetailsModal(true);
              }}
            />
            )}

            {/* ⚙️ PESTAÑA CONFIGURACIÓN DE SEDE (solo admins de sede, no admin general) */}
            {activeTab === 'config' && !canViewAllSchools && (
            <div className="mt-0 space-y-6">
              {loadingSchoolConfig ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-gray-500" />
                    <p className="text-gray-500">Cargando configuración...</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Sección 1: Mensaje de WhatsApp */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <MessageSquare className="h-5 w-5 text-green-600" />
                        Mensaje de WhatsApp para deudores
                      </CardTitle>
                      <p className="text-sm text-gray-500">
                        Este mensaje se enviará como recordatorio a los padres de familia con deudas pendientes de almuerzo.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label className="mb-2 block text-sm font-medium">Mensaje personalizado</Label>
                        <textarea
                          value={configMessageTemplate}
                          onChange={(e) => setConfigMessageTemplate(e.target.value)}
                          rows={8}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                          placeholder="Escribe aquí el mensaje que recibirán los padres de familia..."
                        />
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2 space-y-1">
                          <p className="text-xs font-semibold text-blue-800">📌 Variables disponibles — haz clic para insertar:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { var: '{nombre_padre}', desc: 'Padre' },
                              { var: '{nombre_estudiante}', desc: 'Alumno' },
                              { var: '{monto}', desc: 'Monto' },
                              { var: '{desglose}', desc: 'Detalle consumos' },
                              { var: '{periodo}', desc: 'Período' },
                              { var: '{numero_cuenta}', desc: 'N° Cuenta' },
                              { var: '{numero_cci}', desc: 'CCI' },
                              { var: '{numero_yape}', desc: 'Yape' },
                              { var: '{numero_plin}', desc: 'Plin' },
                            ].map(({ var: v, desc }) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => setConfigMessageTemplate(prev => prev + v)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-blue-300 rounded text-xs font-mono text-blue-700 hover:bg-blue-100 transition-colors"
                                title={`Insertar: ${desc}`}
                              >
                                {v} <span className="text-gray-400 font-sans">→ {desc}</span>
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">💡 Los valores reales ({schoolConfig?.bank_account_number ? `cuenta: ${schoolConfig.bank_account_number}` : 'configura el número de cuenta en la sede'}) se insertan al enviar.</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Sección 2: Métodos de pago de la sede (solo ver + habilitar/deshabilitar) */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Building2 className="h-5 w-5 text-blue-600" />
                        Métodos de pago de mi sede
                      </CardTitle>
                      <p className="text-sm text-gray-500">
                        Puedes activar o desactivar los métodos de pago. Para modificar números de cuenta, contacta al administrador general.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Yape */}
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-purple-50 border-purple-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">Y</span>
                          </div>
                          <div>
                            <p className="font-semibold text-sm">Yape</p>
                            {schoolConfig?.yape_number ? (
                              <p className="text-xs text-gray-600">Número: {schoolConfig.yape_number}{schoolConfig.yape_holder ? ` (${schoolConfig.yape_holder})` : ''}</p>
                            ) : (
                              <p className="text-xs text-gray-400 italic">Sin número configurado</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{configYapeEnabled ? 'Habilitado' : 'Deshabilitado'}</span>
                          <button
                            onClick={() => setConfigYapeEnabled(!configYapeEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${configYapeEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${configYapeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      </div>

                      {/* Plin */}
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-teal-50 border-teal-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">P</span>
                          </div>
                          <div>
                            <p className="font-semibold text-sm">Plin</p>
                            {schoolConfig?.plin_number ? (
                              <p className="text-xs text-gray-600">Número: {schoolConfig.plin_number}{schoolConfig.plin_holder ? ` (${schoolConfig.plin_holder})` : ''}</p>
                            ) : (
                              <p className="text-xs text-gray-400 italic">Sin número configurado</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{configPlinEnabled ? 'Habilitado' : 'Deshabilitado'}</span>
                          <button
                            onClick={() => setConfigPlinEnabled(!configPlinEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${configPlinEnabled ? 'bg-teal-500' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${configPlinEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      </div>

                      {/* Transferencia */}
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-orange-50 border-orange-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                            <Building2 className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">Transferencia Bancaria</p>
                            {schoolConfig?.bank_name && (
                              <p className="text-xs text-gray-600">{schoolConfig.bank_name}</p>
                            )}
                            {schoolConfig?.bank_account_number && (
                              <p className="text-xs text-gray-600">Cuenta: {schoolConfig.bank_account_number}</p>
                            )}
                            {schoolConfig?.bank_cci && (
                              <p className="text-xs text-gray-600">CCI: {schoolConfig.bank_cci}</p>
                            )}
                            {!schoolConfig?.bank_name && !schoolConfig?.bank_account_number && (
                              <p className="text-xs text-gray-400 italic">Sin cuenta configurada</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{configTransferenciaEnabled ? 'Habilitado' : 'Deshabilitado'}</span>
                          <button
                            onClick={() => setConfigTransferenciaEnabled(!configTransferenciaEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${configTransferenciaEnabled ? 'bg-orange-500' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${configTransferenciaEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                        🔒 Los números de cuenta son gestionados por el administrador general y no pueden modificarse desde aquí.
                      </p>
                    </CardContent>
                  </Card>

                  {/* Botón guardar */}
                  <div className="flex justify-end">
                    <Button
                      onClick={saveSchoolConfig}
                      disabled={savingSchoolConfig}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {savingSchoolConfig ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Guardando...</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4 mr-2" /> Guardar cambios</>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>

      {/* Modal Guía de Pago */}
      {/* ══════════════════════════════════════════════════════════════════
          MODAL CXC — Asistente de Cobranza Masiva
          ══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showCxcModal} onOpenChange={(open) => { if (!open) setShowCxcModal(false); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-hidden flex flex-col p-0">
          <DialogTitle className="sr-only">CXC — Cuentas por Cobrar</DialogTitle>
          <DialogDescription className="sr-only">Asistente de cobranza masiva paso a paso</DialogDescription>

          {/* Header fijo */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-indigo-600 text-white rounded-t-lg shrink-0">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-6 w-6" />
              <div>
                <h2 className="text-lg font-bold">CXC — Cuentas por Cobrar</h2>
                <p className="text-indigo-200 text-xs">
                  {cxcStep === 1 ? 'Paso 1 de 3 — Período'
                    : cxcStep === 2 ? 'Paso 2 de 3 — Rubros'
                    : cxcList.length === 0 ? 'Paso 3 de 3 — Tipo de usuario'
                    : `Lista de despacho · ${cxcList.length} deudores · S/ ${cxcTotalAmount.toFixed(2)}`}
                </p>
              </div>
            </div>
            <button onClick={() => setShowCxcModal(false)} className="text-indigo-200 hover:text-white transition-colors text-xl leading-none">✕</button>
          </div>

          {/* ── PASO 1: Período ── */}
          {cxcStep === 1 && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <p className="text-sm text-gray-600">¿Sobre qué período quieres trabajar la cobranza?</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => setCxcPeriodType('all')}
                  className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-all ${cxcPeriodType === 'all' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                >
                  <span className="font-bold text-gray-900">📋 Todo el histórico</span>
                  <span className="text-xs text-gray-500">Usa los filtros de fecha y período ya aplicados en la pantalla principal.</span>
                </button>
                <button
                  onClick={() => setCxcPeriodType('range')}
                  className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-all ${cxcPeriodType === 'range' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                >
                  <span className="font-bold text-gray-900">📅 Rango específico</span>
                  <span className="text-xs text-gray-500">Filtra las transacciones del deudor por un intervalo de fechas personalizado.</span>
                </button>
              </div>

              {cxcPeriodType === 'range' && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-700">Desde</label>
                    <input
                      type="date"
                      value={cxcDateFrom}
                      onChange={e => setCxcDateFrom(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-700">Hasta</label>
                    <input
                      type="date"
                      value={cxcDateTo}
                      onChange={e => setCxcDateTo(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                  onClick={() => setCxcStep(2)}
                  disabled={cxcPeriodType === 'range' && !cxcDateFrom && !cxcDateTo}
                >
                  Siguiente
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── PASO 2: Rubros + Sede + Generar ── */}
          {cxcStep === 2 && cxcList.length === 0 && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <button onClick={() => setCxcStep(1)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline mb-1">
                <ArrowLeft className="h-3 w-3" /> Volver al paso anterior
              </button>

              {/* Rubro */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">¿Qué rubro deseas cobrar?</p>
                <div className="grid grid-cols-3 gap-2">
                  {/* Solo Cafetería — siempre disponible */}
                  <button
                    onClick={() => setCxcRubro('cafeteria')}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${cxcRubro === 'cafeteria' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-orange-300'}`}
                  >
                    <Coffee className="h-5 w-5 text-orange-600" />
                    <span className="text-xs font-semibold">Solo Cafetería</span>
                  </button>

                  {/* Solo Almuerzos — desactivado para supervisor_red */}
                  <button
                    onClick={() => role !== 'supervisor_red' && setCxcRubro('lunch')}
                    disabled={role === 'supervisor_red'}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all
                      ${role === 'supervisor_red' ? 'opacity-40 cursor-not-allowed border-gray-200' : cxcRubro === 'lunch' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}
                  >
                    <UtensilsCrossed className="h-5 w-5 text-green-600" />
                    <span className="text-xs font-semibold">Solo Almuerzos</span>
                    {role === 'supervisor_red' && <span className="text-[10px] text-gray-400">No disponible</span>}
                  </button>

                  {/* Todo — desactivado para supervisor_red */}
                  <button
                    onClick={() => role !== 'supervisor_red' && setCxcRubro('all')}
                    disabled={role === 'supervisor_red'}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all
                      ${role === 'supervisor_red' ? 'opacity-40 cursor-not-allowed border-gray-200' : cxcRubro === 'all' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                  >
                    <DollarSign className="h-5 w-5 text-indigo-600" />
                    <span className="text-xs font-semibold">Todo</span>
                    {role === 'supervisor_red' && <span className="text-[10px] text-gray-400">No disponible</span>}
                  </button>
                </div>
                {role === 'supervisor_red' && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mt-2 flex items-center gap-1">
                    ⚠️ Tu rol solo permite ver deudas de Cafetería.
                  </p>
                )}
              </div>

              {/* Sede (si puede ver varias) */}
              {canViewAllSchools && schools.length > 1 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">¿De qué sede?</p>
                  <select
                    value={cxcSchool}
                    onChange={e => setCxcSchool(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    <option value="all">Todas las sedes</option>
                    {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCxcStep(1)} className="gap-1">
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </Button>
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                  onClick={() => setCxcStep(3)}
                >
                  Siguiente
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Tipo de usuario + Generar ── */}
          {cxcStep === 3 && cxcList.length === 0 && !cxcHasGenerated && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <button onClick={() => setCxcStep(2)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline mb-1">
                <ArrowLeft className="h-3 w-3" /> Volver al paso anterior
              </button>

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">¿A quién deseas cobrar?</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setCxcClientType('student')}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${cxcClientType === 'student' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                  >
                    <GraduationCap className="h-5 w-5 text-blue-600" />
                    <span className="text-xs font-semibold">Solo Alumnos</span>
                  </button>

                  <button
                    onClick={() => setCxcClientType('teacher')}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${cxcClientType === 'teacher' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                  >
                    <Briefcase className="h-5 w-5 text-amber-600" />
                    <span className="text-xs font-semibold">Solo Profesores</span>
                  </button>

                  <button
                    onClick={() => setCxcClientType('all')}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${cxcClientType === 'all' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                  >
                    <Users className="h-5 w-5 text-indigo-600" />
                    <span className="text-xs font-semibold">Todos</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCxcStep(2)} className="gap-1">
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </Button>
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                  onClick={() => buildCxcListAsync()}
                  disabled={cxcLoadingList}
                >
                  {cxcLoadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                  Generar lista de despacho
                </Button>
              </div>
            </div>
          )}

          {/* ── PANTALLA DE OPERACIÓN: Lista de despacho ── */}
          {cxcStep === 3 && cxcList.length > 0 && (
            <>
              {/* Barra de progreso */}
              <div className="px-6 py-3 border-b bg-gray-50 shrink-0">
                {/* Etiqueta de contexto: qué período/rubro se está mostrando */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                    {cxcPeriodType === 'range' && cxcDateFrom && cxcDateTo
                      ? `📅 ${cxcDateFrom} → ${cxcDateTo}`
                      : cxcPeriodType === 'range' && cxcDateFrom
                      ? `📅 Desde ${cxcDateFrom}`
                      : cxcPeriodType === 'range' && cxcDateTo
                      ? `📅 Hasta ${cxcDateTo}`
                      : '📋 Deuda acumulada histórica'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                    {cxcRubro === 'cafeteria' ? '☕ Solo Cafetería' : cxcRubro === 'lunch' ? '🍽 Solo Almuerzos' : '💰 Todo (cafetería + almuerzos)'}
                  </span>
                  {cxcClientType !== 'all' && (
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${cxcClientType === 'student' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {cxcClientType === 'student' ? '🎓 Solo Alumnos' : '👔 Solo Profesores'}
                    </span>
                  )}
                  {cxcSchool !== 'all' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
                      🏫 {schools.find(s => s.id === cxcSchool)?.name || 'Sede específica'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-semibold text-gray-700">Progreso de cobranza</span>
                  <span className="text-gray-500">{cxcChecked.size} / {cxcList.length} cobrados</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-300"
                    style={{ width: `${cxcList.length ? (cxcChecked.size / cxcList.length) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Cobrado: <span className="font-semibold text-green-700">S/ {cxcCobradoAmount.toFixed(2)}</span></span>
                  <span>Pendiente: <span className="font-semibold text-red-600">S/ {(cxcTotalAmount - cxcCobradoAmount).toFixed(2)}</span></span>
                  <span>Total: <span className="font-semibold text-gray-900">S/ {cxcTotalAmount.toFixed(2)}</span></span>
                </div>
              </div>

              {/* Toolbar de filtro rápido */}
              <div className="px-6 py-2 border-b shrink-0 flex items-center gap-2">
                <button
                  onClick={() => { const all = new Set(cxcList.map(d => d.id)); setCxcChecked(all); }}
                  className="text-xs text-green-700 hover:underline"
                >Marcar todos</button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setCxcChecked(new Set())}
                  className="text-xs text-red-500 hover:underline"
                >Limpiar</button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => { setCxcList([]); setCxcHasGenerated(false); setCxcStep(1); }}
                  className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                ><ArrowLeft className="h-3 w-3" /> Cambiar filtros</button>
              </div>

              {/* Lista scrolleable */}
              <div className="flex-1 overflow-y-auto divide-y">
                {cxcList.map((debtor) => {
                  const isCobrado = cxcChecked.has(debtor.id);
                  const isCopying = cxcCopyingId === debtor.id;
                  return (
                    <div
                      key={debtor.id}
                      className={`flex items-center gap-3 px-5 py-3 transition-colors ${isCobrado ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                    >
                      {/* Checkbox de cobrado */}
                      <button
                        onClick={() => {
                          const next = new Set(cxcChecked);
                          if (next.has(debtor.id)) next.delete(debtor.id); else next.add(debtor.id);
                          setCxcChecked(next);
                        }}
                        className="shrink-0"
                        title={isCobrado ? 'Marcar como pendiente' : 'Marcar como cobrado'}
                      >
                        {isCobrado
                          ? <CheckSquare className="h-5 w-5 text-green-600" />
                          : <Square className="h-5 w-5 text-gray-400" />}
                      </button>

                      {/* Datos */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm truncate ${isCobrado ? 'text-green-800 line-through' : 'text-gray-900'}`}>
                          {debtor.client_name}
                        </p>
                        {debtor.client_type === 'student' && debtor.parent_name && (
                          <p className="text-xs text-gray-500 truncate">👤 {debtor.parent_name}</p>
                        )}
                        {debtor.parent_phone && (
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Phone className="h-3 w-3" />{debtor.parent_phone}
                          </p>
                        )}
                      </div>

                      {/* Monto */}
                      <div className="shrink-0 text-right">
                        <p className={`font-bold text-sm ${isCobrado ? 'text-green-700' : 'text-red-600'}`}>
                          S/ {debtor.total_amount.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-gray-400">{debtor.transaction_count} tx</p>
                      </div>

                      {/* Botón copiar mensaje */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isCopying}
                        className="shrink-0 h-8 gap-1 text-xs"
                        onClick={async () => {
                          setCxcCopyingId(debtor.id);
                          await copyMessage(debtor, cxcRubro === 'all' ? 'all' : cxcRubro === 'lunch' ? 'lunch' : 'cafeteria');
                          setCxcCopyingId(null);
                        }}
                      >
                        {isCopying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
                        {isCopying ? '' : 'Copiar'}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t bg-gray-50 shrink-0 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {cxcChecked.size === cxcList.length && cxcList.length > 0
                    ? '✅ ¡Cobranza completada!'
                    : `${cxcList.length - cxcChecked.size} pendientes`}
                </span>
                <Button variant="outline" size="sm" onClick={() => setShowCxcModal(false)}>
                  Cerrar
                </Button>
              </div>
            </>
          )}

          {/* Estado vacío: solo se muestra si ya se hizo clic en Generar (cxcLoadingList fue true) */}
          {cxcStep === 3 && !cxcLoadingList && cxcList.length === 0 && cxcHasGenerated && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-500 space-y-3">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <p className="font-semibold text-gray-700">Sin deudores con este filtro</p>
              <p className="text-xs text-gray-400">Prueba con otro rubro, sede, tipo de usuario o período.</p>
              <Button variant="outline" size="sm" onClick={() => { setCxcHasGenerated(false); setCxcStep(1); }} className="gap-1 mt-2">
                <ArrowLeft className="h-3 w-3" /> Cambiar filtros
              </Button>
            </div>
          )}

        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentGuide} onOpenChange={setShowPaymentGuide}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-blue-600" />
              Guía de Pago para Padres
            </DialogTitle>
            <DialogDescription>
              Copia este mensaje y envíalo por WhatsApp a los padres para guiarlos a registrar su pago en la app.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 bg-gray-50 rounded-lg p-4 border text-xs whitespace-pre-wrap font-mono text-gray-800 leading-relaxed">
            {getPaymentGuideMessage()}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowPaymentGuide(false)}>
              Cerrar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                copyPaymentGuide();
                setShowPaymentGuide(false);
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copiar y cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Registro de Pago - REDISEÑADO con soporte dividido/mixto */}
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
                  {currentDebtor?.client_type === 'student' && (currentDebtor.student_grade || currentDebtor.student_section) && (
                    <span className="ml-2 text-sm font-normal text-blue-600">
                      ({[currentDebtor.student_grade, currentDebtor.student_section].filter(Boolean).join(' - ')})
                    </span>
                  )}
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

            {/* 🆕 Toggle: Pago Simple vs Dividido */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border">
              <Button
                type="button"
                variant={!useSplitPayment ? 'default' : 'outline'}
                className={`flex-1 h-12 text-base ${!useSplitPayment ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={() => {
                  setUseSplitPayment(false);
                  setPaymentData(prev => ({ ...prev, paid_amount: currentDebtor?.total_amount || 0 }));
                }}
              >
                💵 Pago Simple
              </Button>
              <Button
                type="button"
                variant={useSplitPayment ? 'default' : 'outline'}
                className={`flex-1 h-12 text-base ${useSplitPayment ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                onClick={() => {
                  setUseSplitPayment(true);
                  // Inicializar con una línea con el monto total
                  if (paymentLines.length === 0 || (paymentLines.length === 1 && paymentLines[0].amount === 0)) {
                    setPaymentLines([{
                      id: crypto.randomUUID(),
                      amount: currentDebtor?.total_amount || 0,
                      payment_method: 'efectivo',
                      operation_number: '',
                    }]);
                  }
                }}
              >
                <SplitSquareVertical className="h-5 w-5 mr-2" />
                Pago Dividido / Mixto
              </Button>
            </div>

            {!useSplitPayment ? (
              <>
                {/* ===== MODO SIMPLE ===== */}
                {/* Monto a Pagar */}
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

                {/* Método de Pago */}
                <div className="space-y-3">
                  <Label className="text-lg font-semibold">💳 Método de Pago *</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { key: 'efectivo', label: 'Efectivo', icon: '💵', color: 'bg-green-600 hover:bg-green-700' },
                      { key: 'yape', label: 'Yape', icon: 'yape', color: 'bg-[#6C1C8C] hover:bg-[#5A1773]' },
                      { key: 'plin', label: 'Plin', icon: 'plin', color: 'bg-[#00D4D8] hover:bg-[#00B8BC] text-gray-900' },
                      { key: 'transferencia', label: 'Transferencia', icon: '🏦', color: 'bg-indigo-600 hover:bg-indigo-700' },
                      { key: 'tarjeta', label: 'Tarjeta', icon: '💳', color: 'bg-gray-700 hover:bg-gray-800' },
                    ].map(m => (
                      <Button
                        key={m.key}
                        type="button"
                        variant={paymentData.payment_method === m.key ? 'default' : 'outline'}
                        className={`h-20 text-lg ${paymentData.payment_method === m.key ? m.color : ''}`}
                        onClick={() => setPaymentData(prev => ({ ...prev, payment_method: m.key }))}
                      >
                        <div className="flex flex-col items-center gap-1">
                          {m.icon === 'yape' ? <YapeLogo className="w-10 h-10" /> :
                           m.icon === 'plin' ? <PlinLogo className="w-10 h-10" /> :
                           <span className="text-2xl">{m.icon}</span>}
                          <span>{m.label}</span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Número de Operación */}
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
              </>
            ) : (
              <>
                {/* ===== MODO DIVIDIDO / MIXTO ===== */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg font-semibold">📋 Líneas de Pago</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                      onClick={() => {
                        setPaymentLines(prev => [...prev, {
                          id: crypto.randomUUID(),
                          amount: 0,
                          payment_method: 'efectivo',
                          operation_number: '',
                        }]);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Agregar Pago
                    </Button>
                  </div>

                  <p className="text-sm text-gray-500 bg-gray-50 p-2 rounded">
                    💡 Agrega múltiples líneas de pago. Ej: Persona A paga S/25 con tarjeta, Persona B paga S/25 con Yape.
                    La suma debe ser igual al total a cobrar.
                  </p>

                  {paymentLines.map((line, idx) => (
                    <Card key={line.id} className="border-2 border-indigo-200">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-indigo-700">Pago #{idx + 1}</span>
                          {paymentLines.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setPaymentLines(prev => prev.filter(l => l.id !== line.id))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {/* Monto */}
                        <div className="flex items-center gap-3">
                          <Label className="text-base font-semibold w-20">Monto:</Label>
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xl font-bold text-green-700">S/</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.amount || ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPaymentLines(prev => prev.map(l => l.id === line.id ? { ...l, amount: val } : l));
                              }}
                              className="pl-12 h-14 text-2xl font-bold border-2 border-green-300 focus:border-green-500"
                              placeholder="0.00"
                            />
                          </div>
                          {/* Botón mitad rápida */}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs whitespace-nowrap"
                            onClick={() => {
                              const half = Math.round((currentDebtor?.total_amount || 0) / paymentLines.length * 100) / 100;
                              setPaymentLines(prev => prev.map(l => l.id === line.id ? { ...l, amount: half } : l));
                            }}
                          >
                            ÷{paymentLines.length}
                          </Button>
                        </div>

                        {/* Método de Pago */}
                        <div className="grid grid-cols-5 gap-2">
                          {[
                            { key: 'efectivo', label: '💵', title: 'Efectivo' },
                            { key: 'yape', label: 'Y', title: 'Yape' },
                            { key: 'plin', label: 'P', title: 'Plin' },
                            { key: 'transferencia', label: '🏦', title: 'Transferencia' },
                            { key: 'tarjeta', label: '💳', title: 'Tarjeta' },
                          ].map(m => (
                            <Button
                              key={m.key}
                              type="button"
                              variant={line.payment_method === m.key ? 'default' : 'outline'}
                              size="sm"
                              className={`h-10 text-xs ${
                                line.payment_method === m.key 
                                  ? m.key === 'yape' ? 'bg-[#6C1C8C] hover:bg-[#5A1773]' 
                                    : m.key === 'plin' ? 'bg-[#00D4D8] hover:bg-[#00B8BC] text-gray-900'
                                    : m.key === 'efectivo' ? 'bg-green-600 hover:bg-green-700'
                                    : m.key === 'transferencia' ? 'bg-indigo-600 hover:bg-indigo-700'
                                    : 'bg-gray-700 hover:bg-gray-800'
                                  : ''
                              }`}
                              title={m.title}
                              onClick={() => setPaymentLines(prev => prev.map(l => l.id === line.id ? { ...l, payment_method: m.key } : l))}
                            >
                              {m.label === 'Y' ? <YapeLogo className="w-5 h-5" /> :
                               m.label === 'P' ? <PlinLogo className="w-5 h-5" /> :
                               m.label}
                              <span className="ml-1 hidden sm:inline">{m.title}</span>
                            </Button>
                          ))}
                        </div>

                        {/* Número de Operación (solo si no es efectivo) */}
                        {['yape', 'plin', 'transferencia', 'tarjeta'].includes(line.payment_method) && (
                          <Input
                            placeholder={`Nº Operación ${line.payment_method} *`}
                            value={line.operation_number}
                            onChange={(e) => setPaymentLines(prev => prev.map(l => l.id === line.id ? { ...l, operation_number: e.target.value } : l))}
                            className="h-10 border-2"
                          />
                        )}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Resumen de totales */}
                  {(() => {
                    const totalLines = paymentLines.reduce((sum, l) => sum + (l.amount || 0), 0);
                    const debtTotal = currentDebtor?.total_amount || 0;
                    const diff = Math.round((debtTotal - totalLines) * 100) / 100;
                    const isExact = diff === 0;
                    return (
                      <Card className={`border-2 ${isExact ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-gray-600">Suma de pagos:</span>
                              <span className={`text-2xl font-black ml-2 ${isExact ? 'text-green-700' : 'text-red-700'}`}>
                                S/ {totalLines.toFixed(2)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-medium text-gray-600">Total a cobrar:</span>
                              <span className="text-2xl font-black ml-2 text-gray-900">
                                S/ {debtTotal.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          {!isExact && (
                            <p className="text-sm text-red-700 mt-2 font-semibold">
                              {diff > 0 ? `⚠️ Faltan S/ ${diff.toFixed(2)}` : `⚠️ Exceso de S/ ${Math.abs(diff).toFixed(2)}`}
                            </p>
                          )}
                          {isExact && (
                            <p className="text-sm text-green-700 mt-2 font-semibold">✅ Los montos coinciden perfectamente</p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}
                </div>
              </>
            )}

            {/* Tipo de Documento */}
            <div className="space-y-3">
              <Label className="text-lg font-semibold">Tipo de Documento</Label>
              <div className="grid grid-cols-3 gap-3">
                <Button
                  type="button"
                  variant={paymentData.document_type === 'ticket' ? 'default' : 'outline'}
                  className={`h-16 text-base ${paymentData.document_type === 'ticket' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, document_type: 'ticket' }))}
                >
                  Ticket
                </Button>
                <Button
                  type="button"
                  variant={paymentData.document_type === 'boleta' ? 'default' : 'outline'}
                  className={`h-16 text-base ${paymentData.document_type === 'boleta' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, document_type: 'boleta' }))}
                >
                  Boleta
                </Button>
                <Button
                  type="button"
                  variant={paymentData.document_type === 'factura' ? 'default' : 'outline'}
                  className={`h-16 text-base ${paymentData.document_type === 'factura' ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, document_type: 'factura' }))}
                >
                  Factura
                </Button>
              </div>
              {paymentData.document_type !== 'ticket' && (
                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                  Se emitira {paymentData.document_type === 'boleta' ? 'una Boleta' : 'una Factura'} al confirmar el cobro. Se te pediran los datos del cliente.
                </p>
              )}
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
              onClick={() => {
                if (paymentData.document_type !== 'ticket') {
                  setShowInvoiceModal(true);
                } else {
                  handleRegisterPayment();
                }
              }}
              disabled={saving || (
                useSplitPayment 
                  ? paymentLines.reduce((s, l) => s + (l.amount || 0), 0) <= 0
                  : paymentData.paid_amount <= 0
              )} 
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
                  Registrar Pago (S/ {(useSplitPayment 
                    ? paymentLines.reduce((s, l) => s + (l.amount || 0), 0) 
                    : paymentData.paid_amount
                  ).toFixed(2)})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de datos de cliente para Boleta/Factura */}
      <InvoiceClientModal
        open={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        defaultType={paymentData.document_type === 'factura' ? 'factura' : 'boleta'}
        lockedType
        totalAmount={useSplitPayment
          ? paymentLines.reduce((s, l) => s + (l.amount || 0), 0)
          : paymentData.paid_amount}
        onConfirm={(data) => {
          setPendingInvoiceData(data);
          setShowInvoiceModal(false);
          handleRegisterPayment(data);
        }}
      />

      {/* ── Modal: Lista de consumos del deudor ─────────────────────────── */}
      <Dialog open={showDebtorDetailModal} onOpenChange={(open) => { setShowDebtorDetailModal(open); if (!open) setSelectedDebtorForDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5 text-red-600" />
              Consumos pendientes
            </DialogTitle>
            {selectedDebtorForDetail && (
              <DialogDescription asChild>
                <div className="space-y-1 pt-1">
                  <p className="font-semibold text-gray-900 text-base">{selectedDebtorForDetail.client_name}</p>
                  <div className="flex items-center gap-3 flex-wrap text-sm text-gray-500">
                    <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{selectedDebtorForDetail.school_name}</span>
                    <span className="text-red-600 font-bold text-base">Total: S/ {selectedDebtorForDetail.total_amount?.toFixed(2)}</span>
                  </div>
                </div>
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedDebtorForDetail && (
            <div className="space-y-3 mt-2">

              {/* ── Banner: deuda histórica vs deuda filtrada ─────────────── */}
              {loadingHistoricalDebt && (
                <div className="text-xs text-gray-400 italic px-1">Calculando deuda histórica…</div>
              )}
              {!loadingHistoricalDebt && historicalDebt && (
                (() => {
                  const filteredTotal = selectedDebtorForDetail.total_amount ?? 0;
                  const histTotal = historicalDebt.total;
                  const diff = histTotal - filteredTotal;
                  if (diff > 0.01) {
                    return (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                        <p className="text-xs font-bold text-amber-800 flex items-center gap-1">
                          ⚠️ Hay deuda histórica adicional fuera del filtro de fechas
                        </p>
                        <div className="flex gap-4 text-xs text-amber-700">
                          <span>En período: <strong>S/ {filteredTotal.toFixed(2)}</strong></span>
                          <span>Total histórico: <strong className="text-red-700">S/ {histTotal.toFixed(2)}</strong></span>
                          <span className="text-gray-500">({historicalDebt.count} consumos)</span>
                        </div>
                        <p className="text-xs text-amber-600">
                          El portal del padre muestra S/ {histTotal.toFixed(2)} porque suma todas las deudas sin filtro de fechas.
                        </p>
                        <button
                          className="mt-1 text-xs font-semibold text-blue-700 hover:text-blue-900 underline flex items-center gap-1"
                          onClick={() => {
                            setFromDate('');
                            setUntilDate('');
                            setShowDebtorDetailModal(false);
                            toast({ title: 'Filtro de fechas eliminado', description: 'Ahora ves toda la deuda histórica en la lista.' });
                          }}
                        >
                          Ver historial completo (quitar filtro de fechas)
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()
              )}

              {/* Botón seleccionar todas */}
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-gray-500">{selectedDebtorForDetail.transactions?.length} transacción(es)</span>
                <button
                  onClick={() => {
                    const debtorKey = selectedDebtorForDetail.id;
                    const newMap = new Map(selectedTransactionsByDebtor);
                    const currentSelection = newMap.get(debtorKey);
                    const allSelected = currentSelection && currentSelection.size === selectedDebtorForDetail.transactions.length;
                    if (allSelected) {
                      newMap.set(debtorKey, new Set());
                    } else {
                      newMap.set(debtorKey, new Set(selectedDebtorForDetail.transactions.map((t: any) => t.id)));
                    }
                    setSelectedTransactionsByDebtor(newMap);
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 underline font-medium"
                >
                  {(() => {
                    const sel = selectedTransactionsByDebtor.get(selectedDebtorForDetail.id);
                    return sel && sel.size === selectedDebtorForDetail.transactions?.length
                      ? 'Deseleccionar todas'
                      : 'Seleccionar todas';
                  })()}
                </button>
              </div>

              {/* Lista de transacciones */}
              <div className="space-y-2">
                {selectedDebtorForDetail.transactions?.map((t: any, idx: number) => {
                  const debtorKey = selectedDebtorForDetail.id;
                  const isSelected = selectedTransactionsByDebtor.get(debtorKey)?.has(t.id) || false;
                  return (
                    <div
                      key={t.id}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-3 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newMap = new Map(selectedTransactionsByDebtor);
                          if (!newMap.has(debtorKey)) newMap.set(debtorKey, new Set());
                          const txSet = newMap.get(debtorKey)!;
                          if (e.target.checked) txSet.add(t.id);
                          else txSet.delete(t.id);
                          setSelectedTransactionsByDebtor(newMap);
                        }}
                        className="mt-1 cursor-pointer accent-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
                            {t.metadata?.is_kiosk_balance_debt && (
                              <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-xs font-bold">
                                🏪 Saldo negativo kiosco
                              </span>
                            )}
                            {t.metadata?.order_date && (
                              <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">
                                📅 {format(new Date(t.metadata.order_date + 'T12:00:00'), "d MMM", { locale: es })}
                              </span>
                            )}
                            {t.metadata?.menu_name && (
                              <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-medium">
                                {t.metadata.menu_name}
                              </span>
                            )}
                          </div>
                          <span className="text-red-600 font-bold text-sm shrink-0">S/ {Math.abs(t.amount).toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1 truncate">
                          {t.description}
                          {t.created_at && (
                            <span className="text-gray-400"> · {format(new Date(t.created_at), 'dd/MM HH:mm', { locale: es })}</span>
                          )}
                          {t.ticket_code && (
                            <span className="ml-1 text-indigo-700 font-semibold"> · 🎫 {t.ticket_code}</span>
                          )}
                        </p>
                      </div>
                      {/* Botón ver detalle individual */}
                      <button
                        title="Ver detalle completo"
                        className="shrink-0 p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all text-blue-500 hover:text-blue-700"
                        onClick={() => {
                          setSelectedTransaction({
                            ...t,
                            client_name: selectedDebtorForDetail.client_name,
                            client_type: selectedDebtorForDetail.client_type,
                            parent_name: selectedDebtorForDetail.parent_name,
                            parent_phone: selectedDebtorForDetail.parent_phone,
                            school_name: selectedDebtorForDetail.school_name,
                          });
                          setShowDetailsModal(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Footer: cobrar seleccionadas */}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => setShowDebtorDetailModal(false)}>
                  Cerrar
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    setShowDebtorDetailModal(false);
                    handleOpenPayment(selectedDebtorForDetail, 'all');
                  }}
                >
                  <DollarSign className="h-4 w-4 mr-1" />
                  Cobrar S/ {selectedDebtorForDetail.total_amount?.toFixed(2)}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de Detalles Completos */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogTitle className="sr-only">Detalle de transacción</DialogTitle>
          <DialogDescription className="sr-only">Información completa de la transacción seleccionada</DialogDescription>
          {selectedTransaction && (() => {
            const isPending = selectedTransaction.payment_status === 'pending' || selectedTransaction.payment_status === 'partial';
            const isPaid = selectedTransaction.payment_status === 'paid';
            
            const clientName = selectedTransaction.client_name ||
                             selectedTransaction.students?.full_name || 
                             selectedTransaction.teacher_profiles?.full_name || 
                             selectedTransaction.manual_client_name || 
                             '🛒 Cliente Gen�rico Sin Cuenta';
            const clientType = selectedTransaction.client_type === 'student' ? 'Estudiante' :
                              selectedTransaction.client_type === 'teacher' ? 'Profesor' :
                              selectedTransaction.client_type === 'manual' ? 'Cliente Sin Cuenta' :
                              selectedTransaction.student_id ? 'Estudiante' : 
                              selectedTransaction.teacher_id ? 'Profesor' : 
                              selectedTransaction.manual_client_name ? 'Cliente Sin Cuenta' : 'Cliente Gen�rico Sin Cuenta';
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
            
            // Determinar qui�n hizo el pedido - SIEMPRE mostrar nombre y c�mo lo hizo
            const getOriginInfo = () => {
              // CASO 1: created_by = el mismo profesor → Él lo cre� desde su perfil
              if (selectedTransaction.created_by && selectedTransaction.created_by === selectedTransaction.teacher_id) {
                const teacherName = selectedTransaction.teacher_profiles?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: teacherName,
                  createdByRole: 'Profesor',
                  createdByMethod: 'Cre� el pedido desde su perfil en la plataforma',
                  icon: '👨‍🏫'
                };
              }
              
              // CASO 2: created_by = el mismo estudiante
              if (selectedTransaction.created_by && selectedTransaction.created_by === selectedTransaction.student_id) {
                const studentName = selectedTransaction.students?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: studentName,
                  createdByRole: 'Estudiante',
                  createdByMethod: 'Cre� el pedido desde su perfil en la plataforma',
                  icon: '🎒'
                };
              }
              
              // CASO 3: created_by = otro usuario (admin, cajero, gestor, etc.)
              if (selectedTransaction.created_by && userInfo) {
                return {
                  createdByName: userInfo.name,
                  createdByRole: userInfo.role,
                  createdByMethod: 'Lo registr� desde el sistema de administraci�n',
                  icon: '🏢'
                };
              }
              
              // CASO 4: created_by existe pero no tenemos el perfil cargado
              if (selectedTransaction.created_by) {
                return {
                  createdByName: 'Usuario del sistema',
                  createdByRole: 'No se pudo cargar el perfil',
                  createdByMethod: 'Registrado desde el sistema',
                  icon: '🏢'
                };
              }
              
              // CASO 5: created_by = null + teacher_id → El profesor lo pidi� desde su cuenta
              if (!selectedTransaction.created_by && selectedTransaction.teacher_id) {
                const teacherName = selectedTransaction.teacher_profiles?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: teacherName,
                  createdByRole: 'Profesor',
                  createdByMethod: 'Cre� el pedido desde su perfil en la plataforma',
                  icon: '👨‍🏫'
                };
              }
              
              // CASO 6: created_by = null + student_id
              if (!selectedTransaction.created_by && selectedTransaction.student_id) {
                const studentName = selectedTransaction.students?.full_name || 
                                   selectedTransaction.client_name || clientName;
                return {
                  createdByName: studentName,
                  createdByRole: 'Estudiante',
                  createdByMethod: 'Cre� el pedido desde su perfil en la plataforma',
                  icon: '🎒'
                };
              }
              
              // CASO 7: Venta manual sin cuenta
              if (selectedTransaction.manual_client_name) {
                return {
                  createdByName: selectedTransaction.manual_client_name,
                  createdByRole: 'Cliente sin cuenta',
                  createdByMethod: 'Venta registrada en caja',
                  icon: '🛒'
                };
              }
              
              // CASO 8: Sin informaci�n
              return {
                createdByName: 'Sistema',
                createdByRole: 'Autom�tico',
                createdByMethod: 'Generado autom�ticamente por el sistema',
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
                  {/* Estado de la transacci�n */}
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
                        <span className="text-gray-600">Categor�a:</span>
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

                  {/* Informaci�n del Monto y Estado */}
                  <div className={`rounded-lg p-4 border ${isPending 
                    ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200' 
                    : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'}`}>
                    <h3 className="font-bold text-lg text-gray-900 mb-2">
                      {isPending ? '💰 Informaci�n de la Deuda' : '💳 Informaci�n del Pago'}
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
                        <div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Método de pago:</span>
                            <span className="font-semibold text-gray-900 capitalize">
                              {selectedTransaction.metadata?.is_kiosk_balance_debt
                                ? 'Saldo negativo acumulado en kiosco'
                                : selectedTransaction.payment_method 
                                  ? selectedTransaction.payment_method === 'teacher_account' 
                                    ? 'Cuenta Profesor' 
                                    : selectedTransaction.payment_method === 'mixto'
                                      ? '🔀 Pago Mixto'
                                      : selectedTransaction.payment_method
                                  : selectedTransaction.ticket_code 
                                    ? 'Pago directo en caja' 
                                    : 'Método no registrado'}
                            </span>
                          </div>
                          {/* Desglose pago dividido/mixto */}
                          {selectedTransaction.metadata?.payment_breakdown && Array.isArray(selectedTransaction.metadata.payment_breakdown) && (
                            <div className="mt-2 space-y-1 bg-indigo-50 rounded p-3 border border-indigo-200">
                              <p className="text-xs font-semibold text-indigo-700 mb-1">📋 Desglose del pago:</p>
                              {selectedTransaction.metadata.payment_breakdown.map((entry: any, i: number) => (
                                <div key={i} className="flex items-center justify-between text-sm border-b border-indigo-100 pb-1 last:border-0">
                                  <span className="capitalize text-gray-700">
                                    {entry.method}
                                    {entry.operation_number && <span className="text-gray-500 ml-1">(Nº {entry.operation_number})</span>}
                                  </span>
                                  <span className="font-bold text-gray-900">S/ {Number(entry.amount).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {isPaid && (
                        <div className="flex justify-between items-start">
                          <span className="text-gray-600">Fecha y hora:</span>
                          <div className="text-right">
                            <p className="font-semibold text-gray-900">
                              {format(new Date(selectedTransaction.created_at), "dd/MM/yyyy", { locale: es })}
                            </p>
                            <p className="text-sm text-gray-600">
                              {format(new Date(selectedTransaction.created_at), "HH:mm:ss", { locale: es })}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedTransaction.operation_number && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Nº de operaci�n:</span>
                          <span className="font-semibold text-gray-900">{selectedTransaction.operation_number}</span>
                        </div>
                      )}
                      {selectedTransaction.ticket_code && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">🎫 Nº de ticket:</span>
                          <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{selectedTransaction.ticket_code}</span>
                        </div>
                      )}
                      {/* Badge de estado SUNAT — visible siempre para alertar de 'failed' */}
                      {selectedTransaction.billing_status && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Estado SUNAT:</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getBillingStatusBadge(selectedTransaction.billing_status).className}`}>
                            {getBillingStatusBadge(selectedTransaction.billing_status).label}
                          </span>
                        </div>
                      )}
                      {/* Alerta especial si la boleta falló */}
                      {selectedTransaction.billing_status === 'failed' && (
                        <div className="mt-2 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
                          <p className="text-xs font-semibold text-red-800">⚠ Boleta no emitida — acción requerida</p>
                          <p className="text-xs text-red-700 mt-0.5">
                            Nubefact no pudo emitir el comprobante para este pago.
                            Ve a <strong>Facturación → Cierre Mensual → "Reintentar Fallidas"</strong> para resolverlo.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 🍽️ Detalle de Consumo */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border-2 border-blue-300 shadow-md">
                    <h3 className="font-bold text-xl text-gray-900 mb-3 flex items-center gap-2">
                      🍽️ Detalle de Consumo
                    </h3>
                    
                    {/* Fechas e informaci�n del consumo */}
                    <div className="space-y-1.5 bg-white/60 rounded-lg p-3">
                      {/* Descripci�n del consumo */}
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">📝 Descripci�n:</span>
                        <span className="font-semibold text-gray-800 text-right max-w-[60%]">
                          {selectedTransaction.description || 'Sin descripci�n'}
                        </span>
                      </div>
                      {/* Fecha del almuerzo (para qu� d�a es) */}
                      {selectedTransaction.metadata?.order_date && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">📅 Almuerzo para el d�a:</span>
                          <span className="font-bold text-blue-800">
                            {format(new Date(selectedTransaction.metadata.order_date + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es })}
                          </span>
                        </div>
                      )}
                      {/* Fecha de creaci�n del pedido (cu�ndo el profesor/padre hizo el pedido) */}
                      {selectedTransaction.metadata?.order_created_at && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">🛒 Pedido registrado el:</span>
                          <span className="font-semibold text-green-800">
                            {format(new Date(selectedTransaction.metadata.order_created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                          </span>
                        </div>
                      )}
                      {!selectedTransaction.metadata?.order_created_at && selectedTransaction.metadata?.source && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">🛒 Pedido registrado el:</span>
                          <span className="font-medium text-orange-600 italic">
                            No se registr� la fecha de creaci�n
                          </span>
                        </div>
                      )}
                      {/* Fecha de registro / confirmaci�n del pedido */}
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">
                          {selectedTransaction.payment_status === 'paid' ? '✅ Pedido confirmado el:' : '🕐 Pedido registrado el:'}
                        </span>
                        <span className={`font-semibold ${selectedTransaction.payment_status === 'paid' ? 'text-green-700' : 'text-amber-700'}`}>
                          {format(new Date(selectedTransaction.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                        </span>
                      </div>
                      {/* Categor�a del men� */}
                      {selectedTransaction.metadata?.menu_name && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">🍽️ Categor�a:</span>
                          <span className="font-bold text-purple-800">
                            {selectedTransaction.metadata.menu_name}
                          </span>
                        </div>
                      )}
                      {/* Origen */}
                      {selectedTransaction.metadata?.source && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">📱 Origen:</span>
                          <span className="font-medium text-gray-700">
                            {selectedTransaction.metadata.source === 'unified_calendar_teacher' ? 'Calendario del Profesor' :
                             selectedTransaction.metadata.source === 'unified_calendar_v2_teacher' ? 'Calendario del Profesor' :
                             selectedTransaction.metadata.source === 'unified_calendar_parent' ? 'Calendario del Padre/Madre' :
                             selectedTransaction.metadata.source === 'unified_calendar_v2_parent' ? 'Calendario del Padre/Madre' :
                             selectedTransaction.metadata.source === 'teacher_calendar' ? 'Perfil del Profesor' :
                             selectedTransaction.metadata.source === 'parent_calendar' ? 'Perfil del Padre/Madre' :
                             selectedTransaction.metadata.source === 'admin_order' ? 'Pedido del Administrador' :
                             selectedTransaction.metadata.source === 'physical_order' ? 'Pedido presencial (Cocina)' :
                             selectedTransaction.metadata.source === 'physical_order_wizard' ? 'Pedido presencial (Cocina)' :
                             selectedTransaction.metadata.source === 'physical_order_wizard_fiado' ? 'Pedido presencial - Pagar luego' :
                             selectedTransaction.metadata.source === 'physical_order_wizard_paid' ? 'Pedido presencial - Pagado' :
                             selectedTransaction.metadata.source === 'lunch_orders_confirm' ? 'Confirmado desde Pedidos de Almuerzo' :
                             selectedTransaction.metadata.source === 'lunch_order' ? 'Pedido de Almuerzo' :
                             selectedTransaction.metadata.source === 'lunch_fast' ? 'Pedido r�pido de Almuerzo' :
                             selectedTransaction.metadata.source || 'No especificado'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 📋 Qui�n realiz� el pedido */}
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
                      <div className="flex justify-between items-start">
                        <span className="text-gray-600">Medio:</span>
                        <span className="font-semibold text-gray-700 text-sm text-right">
                          {originInfo.createdByMethod}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">ID de transacci�n:</span>
                        <span className="font-mono text-xs text-gray-500">{selectedTransaction.id}</span>
                      </div>
                    </div>
                  </div>


                  {/* Historial de Auditoría — solo visible para admin_general */}
                  {canViewAllSchools && (
                    <TransactionAuditTimeline transactionId={selectedTransaction.id} />
                  )}

                  {/* ── ANULAR ALMUERZO Y ACREDITAR BILLETERA ───────────────
                      Visible cuando:
                      - La transacción ya fue pagada (isPaid)
                      - Es un pedido de almuerzo (tiene lunch_order_id en metadata)
                      - El alumno existe (no es docente)
                      El RPC determinará internamente si aplica crédito de billetera
                      (solo si billing_status='sent'; si no, simplemente cancela). */}
                  {isPaid && selectedTransaction.metadata?.lunch_order_id && selectedTransaction.student_id && (
                    <Button
                      variant="outline"
                      className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 h-11"
                      disabled={loadingCancelCheck || cancellingWallet}
                      onClick={openCancelLunchModal}
                    >
                      {loadingCancelCheck ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Ban className="h-4 w-4 mr-2" />
                      )}
                      Anular Almuerzo y Acreditar Saldo
                    </Button>
                  )}

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
      {/* ══════════════════════════════════════════════════════════
          MODAL: Confirmar Anulación de Almuerzo + Billetera
          Se abre desde el botón "Anular Almuerzo y Acreditar Saldo"
          en el modal de detalles de una transacción pagada.
          ══════════════════════════════════════════════════════════ */}
      <Dialog open={showCancelWalletModal} onOpenChange={setShowCancelWalletModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <Ban className="h-5 w-5" />
              Anular Almuerzo
            </DialogTitle>
            <DialogDescription className="sr-only">
              Confirmación de anulación de almuerzo
            </DialogDescription>
          </DialogHeader>

          {selectedTransaction && (
            <div className="space-y-4">
              {/* Descripción del almuerzo que se va a anular */}
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-orange-800">
                  {selectedTransaction.description || 'Almuerzo'}
                </p>
                <p className="text-xl font-bold text-orange-700 mt-1">
                  S/ {Math.abs(selectedTransaction.amount).toFixed(2)}
                </p>
              </div>

              {/* Explicación según el billing_status */}
              {cancelLunchBillingStatus === 'sent' ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-bold text-green-800 flex items-center gap-1.5">
                    <Wallet className="h-4 w-4" />
                    Este pedido ya fue boleteado a SUNAT
                  </p>
                  <p className="text-sm text-green-700">
                    Al anularlo, se acreditarán{' '}
                    <span className="font-bold">
                      S/ {Math.abs(selectedTransaction.amount).toFixed(2)}
                    </span>{' '}
                    como <strong>saldo a favor</strong> en la billetera interna del alumno.
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    El padre podrá usar ese saldo en su próximo pago.
                    La boleta original en SUNAT <strong>no se modifica</strong>.
                  </p>
                </div>
              ) : cancelLunchBillingStatus === 'excluded' || cancelLunchBillingStatus === 'pending' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-bold text-amber-800">
                    ⚠️ Este almuerzo aún no fue enviado a SUNAT
                  </p>
                  <p className="text-sm text-amber-700">
                    Se cancelará el pedido, pero <strong>no se acreditará saldo</strong>{' '}
                    en la billetera porque no existe boleta emitida. Si el padre realizó
                    un pago, gestiona el reembolso manualmente.
                  </p>
                </div>
              ) : cancelLunchBillingStatus === 'failed' ? (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-bold text-red-800">
                    ✗ Este almuerzo tiene una boleta con error SUNAT
                  </p>
                  <p className="text-sm text-red-700">
                    El pago fue cobrado pero Nubefact no emitió la boleta (quedó en "Error SUNAT").
                    Al anular, <strong>no se acreditará saldo</strong> en la billetera porque la boleta no existe formalmente.
                    Resuelve primero el error en Cierre Mensual.
                  </p>
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-sm text-gray-700">
                    Se cancelará el pedido. El sistema determinará automáticamente
                    si corresponde acreditar saldo a la billetera del alumno.
                  </p>
                </div>
              )}

              <p className="text-xs text-gray-500">
                Esta acción no se puede deshacer directamente.
                Si fue un error, contacta al administrador del sistema.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setShowCancelWalletModal(false)}
              disabled={cancellingWallet}
            >
              Cancelar
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={handleCancelWithWallet}
              disabled={cancellingWallet}
            >
              {cancellingWallet ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Anulando...
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4 mr-2" />
                  Confirmar Anulación
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};
