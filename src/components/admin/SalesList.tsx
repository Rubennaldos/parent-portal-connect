import { useState, useEffect, useRef, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/config/supabase.config';
import { useAuth } from '@/contexts/AuthContext';
import { registrarHuella } from '@/services/auditService';
import { useRole } from '@/hooks/useRole';
import { useBillingSync, useDebouncedSync } from '@/stores/billingSync';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { 
  Search, 
  FileText, 
  ArrowUpDown,
  Eye,
  Download,
  Calendar as CalendarIcon,
  Trash2,
  AlertTriangle,
  ShoppingCart,
  User,
  Clock,
  Printer,
  Edit,
  X,
  CheckSquare,
  FileCheck,
  Receipt,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Building2,
  Filter,
  Users,
  List,
  FileDown,
  Sheet,
  ExternalLink,
  CreditCard,
} from "lucide-react";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { ThermalTicket } from "@/components/pos/ThermalTicket";
import { EmitirComprobanteModal, type TransaccionParaEmitir } from '@/components/billing/EmitirComprobanteModal';

interface School {
  id: string;
  name: string;
  code: string;
}

interface Transaction {
  id: string;
  created_at: string;
  student_id: string | null;
  teacher_id?: string | null;
  school_id: string | null;
  type: string;
  amount: number;
  description: string;
  balance_after: number;
  ticket_code: string;
  created_by: string;
  is_deleted?: boolean;
  deleted_at?: string;
  deleted_by?: string;
  deletion_reason?: string;
  invoice_client_name?: string;
  invoice_client_dni_ruc?: string;
  invoice_id?: string | null;
  billing_status?: string | null;
  // alias de compatibilidad (undefined cuando no existe en BD)
  client_name?: string;
  document_type?: 'ticket' | 'boleta' | 'factura';
  payment_status?: string;
  payment_method?: string;
  metadata?: {
    lunch_order_id?: string;
    source?: string;
    order_date?: string;
    [key: string]: any;
  };
  student?: {
    id: string;
    full_name: string;
  };
  teacher?: {
    id: string;
    full_name: string;
  };
  profiles?: {
    email: string;
    full_name?: string;
  };
  school?: School;
}

interface TransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

const PAGE_SIZE = 50;

// Campos mínimos para el listado.
// NOTA: la columna se llama "invoice_client_name" en transactions (no "client_name").
const TRANSACTION_SELECT = `
  id,
  amount,
  created_at,
  type,
  payment_status,
  payment_method,
  ticket_code,
  description,
  is_deleted,
  invoice_client_name,
  invoice_client_dni_ruc,
  document_type,
  invoice_id,
  billing_status,
  created_by,
  school_id,
  student_id,
  teacher_id,
  metadata,
  balance_after,
  student:students(id, full_name),
  teacher:teacher_profiles(id, full_name),
  school:schools(id, name, code)
`.trim();

export const SalesList = () => {
  const { user } = useAuth();
  const { role, canViewAllSchools: canViewAllSchoolsFromHook } = useRole();
  const { toast } = useToast();
  const emitSync = useBillingSync((s) => s.emit);
  const txSyncTs = useDebouncedSync('transactions', 600);
  const maintenance = useMaintenanceGuard('ventas_admin');
  
  // Permisos del módulo de ventas
  const [permissions, setPermissions] = useState({
    canView: false,
    canEdit: false,
    canDelete: false,
    canPrint: false,
    canExport: false,
    loading: true,
  });
  
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  // Emisión manual de comprobante SUNAT
  const [emitirTarget, setEmitirTarget] = useState<TransaccionParaEmitir | null>(null);
  // Mapa local: transaction.id → pdf_url (para mostrar "Ver PDF" tras emitir sin recargar)
  const [localPdfMap, setLocalPdfMap] = useState<Map<string, string | null>>(new Map());
  const fetchTxRequestId = useRef(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<Transaction[] | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const globalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  // Rango de fechas
  const [dateFrom, setDateFrom] = useState<Date>(new Date());
  const [dateTo, setDateTo]     = useState<Date>(new Date());
  // Filtro de horas (formato "HH:MM", vacío = sin filtro de hora)
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo,   setTimeTo]   = useState('');
  // Buscador dedicado de Nº de Operación (columna operation_number)
  const [opNumberSearch, setOpNumberSearch] = useState('');
  // Filtro de método de pago
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');
  // Vista: 'flat' = lista plana clásica, 'grouped' = agrupado por alumno
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('grouped');
  // Control de filas expandidas en vista agrupada
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());
  
  // Filtro de tipo de venta (POS, Almuerzos, Todas)
  const [salesFilter, setSalesFilter] = useState<'all' | 'pos' | 'lunch'>('all');

  // Filtro de tipo de persona (Todos, Alumno, Profesor)
  const [personFilter, setPersonFilter] = useState<'all' | 'alumno' | 'profesor'>('all');
  
  // Filtro de sedes
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const canViewAllSchools = canViewAllSchoolsFromHook;

  // Paginación server-side
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Exportación: estado de carga independiente para no bloquear la lista
  const [isExporting, setIsExporting] = useState(false);
  
  // Selección múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modal de detalles
  const [showDetails, setShowDetails] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [transactionItems, setTransactionItems] = useState<TransactionItem[]>([]);
  
  // Modal de editar cliente
  const [showEditClient, setShowEditClient] = useState(false);
  const [editClientName, setEditClientName] = useState('');
  const [editClientDNI, setEditClientDNI] = useState('');
  const [editClientRUC, setEditClientRUC] = useState('');
  const [editDocumentType, setEditDocumentType] = useState<'ticket' | 'boleta' | 'factura'>('ticket');
  
  // Modal de editar medio de pago
  const [showEditPayment, setShowEditPayment] = useState(false);
  const [editPaymentMethod, setEditPaymentMethod] = useState('');

  // Modal de anular venta
  const [showAnnul, setShowAnnul] = useState(false);
  const [annulReason, setAnnulReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Validación de contraseña para cajeros
  const [showPasswordValidation, setShowPasswordValidation] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [pendingAnnulTransaction, setPendingAnnulTransaction] = useState<Transaction | null>(null);
  
  // Modal de impresión
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [printType, setPrintType] = useState<'individual' | 'consolidated'>('individual');

  // Verificar permisos al cargar
  useEffect(() => {
    checkPermissions();
  }, [user, role]);

  // Cargar escuelas y school_id del usuario
  useEffect(() => {
    if (!permissions.loading && permissions.canView) {
      fetchSchools();
      fetchUserSchool();
    }
  }, [permissions.loading, permissions.canView]);

  // ✅ Setear automáticamente la sede del usuario si NO puede ver todas las sedes
  useEffect(() => {
    if (!canViewAllSchools && userSchoolId) {
      console.log('🔒 Admin de sede detectado - Estableciendo filtro automático a su sede:', userSchoolId);
      setSelectedSchool(userSchoolId);
    }
  }, [canViewAllSchools, userSchoolId]);

  // Resetear página a 1 cuando cambia cualquier filtro de consulta
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, dateFrom, dateTo, timeFrom, timeTo, opNumberSearch, selectedPaymentMethod, selectedSchool, userSchoolId, salesFilter, personFilter]);

  useEffect(() => {
    if (!permissions.loading && permissions.canView) {
      fetchTransactions();
    }
  }, [activeTab, dateFrom, dateTo, timeFrom, timeTo, opNumberSearch, selectedPaymentMethod, selectedSchool, userSchoolId, currentPage, permissions.loading, permissions.canView]);

  useEffect(() => {
    if (txSyncTs > 0 && !permissions.loading && permissions.canView) {
      fetchTransactions();
      toast({ title: '🔄 Ventas actualizadas', description: 'Se detectaron cambios en transacciones.', duration: 3000 });
    }
  }, [txSyncTs]);

  const checkPermissions = async () => {
    if (!user || !role) {
      setPermissions(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      console.log('🔍 Verificando permisos de Ventas para rol:', role);

      // Admin General tiene todos los permisos siempre
      if (role === 'admin_general') {
        setPermissions({
          canView: true,
          canEdit: true,
          canDelete: true,
          canPrint: true,
          canExport: true,
          loading: false,
        });
        // ✅ canViewAllSchools ya viene del hook
        console.log('✅ Admin General - Todos los permisos');
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
        throw error;
      }

      console.log('📦 Permisos obtenidos de BD:', data);

      // Inicializar permisos
      let perms = {
        canView: false,
        canEdit: false,
        canDelete: false,
        canPrint: false,
        canExport: false,
        loading: false,
      };
      let canViewAll = false;

      // Mapear los permisos de la BD
      data?.forEach((perm: any) => {
        const permission = perm.permissions;
        if (permission?.module === 'ventas') {
          switch (permission.action) {
            case 'ver_modulo':
              // ver_modulo es suficiente para acceder al módulo
              perms.canView = true;
              break;
            case 'ver_su_sede':
              perms.canView = true;
              break;
            case 'ver_todas_sedes':
              perms.canView = true;
              canViewAll = true;
              break;
            case 'ver_personalizado':
              perms.canView = true;
              // TODO: Implementar selección de sedes personalizadas
              break;
            case 'editar':
              perms.canEdit = true;
              break;
            case 'eliminar':
            case 'anular':
              perms.canDelete = true;
              break;
            case 'imprimir_ticket':
              perms.canPrint = true;
              break;
            case 'sacar_reportes':
              perms.canExport = true;
              break;
          }
        }
      });

      console.log('✅ Permisos finales de Ventas:', perms);
      setPermissions(perms);
      // ✅ canViewAllSchools ya viene del hook (se ignora canViewAll local)

    } catch (error) {
      console.error('Error checking permissions:', error);
      // En caso de error, dar acceso básico
      setPermissions({
        canView: false,
        canEdit: false,
        canDelete: false,
        canPrint: false,
        canExport: false,
        loading: false,
      });
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
    } catch (error) {
      console.error('Error fetching user school:', error);
    }
  };

  // Búsqueda global por nombre (ignora la fecha seleccionada)
  const fetchGlobalSearch = async (term: string) => {
    if (!term.trim() || term.trim().length < 3) {
      setGlobalSearchResults(null);
      return;
    }
    setGlobalSearchLoading(true);
    try {
      // Buscar por nombre de alumno en students
      const { data: matchingStudents } = await supabase
        .from('students')
        .select('id')
        .ilike('full_name', `%${term.trim()}%`)
        .limit(50);

      const studentIds = (matchingStudents || []).map((s: any) => s.id);

      // Respetar el rango de fechas + horas activo
      const searchStart = buildLimaTimestamp(dateFrom, timeFrom, false);
      const searchEnd   = buildLimaTimestamp(dateTo,   timeTo,   true);

      let query = supabase
        .from('transactions')
        .select(TRANSACTION_SELECT)
        .in('type', ['purchase', 'sale'])
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')
        .gte('created_at', searchStart.toISOString())
        .lte('created_at', searchEnd.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (!canViewAllSchools && userSchoolId) {
        query = query.eq('school_id', userSchoolId);
      } else if (selectedSchool !== 'all') {
        query = query.eq('school_id', selectedSchool);
      }

      if (studentIds.length > 0) {
        query = query.in('student_id', studentIds);
      } else {
        // Buscar en ticket_code, descripción y cliente (sin operation_number:
        // ese tiene su propio input dedicado)
        query = query.or(
          `ticket_code.ilike.%${term.trim()}%,` +
          `description.ilike.%${term.trim()}%,` +
          `invoice_client_name.ilike.%${term.trim()}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      // Cargar perfiles de cajeros
      if (data && data.length > 0) {
        const createdByIds = [...new Set(data.map((t: any) => t.created_by).filter(Boolean))];
        if (createdByIds.length > 0) {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .in('id', createdByIds);
          if (profilesData) {
            const profilesMap = new Map(profilesData.map(p => [p.id, p]));
            data.forEach((t: any) => {
              if (t.created_by) t.profiles = profilesMap.get(t.created_by);
            });
          }
        }
      }

      setGlobalSearchResults(data || []);
    } catch (err) {
      console.error('[GlobalSearch] Error:', err);
      setGlobalSearchResults(null);
    } finally {
      setGlobalSearchLoading(false);
    }
  };

  // ── Helpers para combinar fecha + hora en UTC Lima (UTC-5) ───────────────
  // La BD almacena timestamps en UTC. Lima es UTC-5, o sea Lima 00:00 = UTC 05:00.
  const buildLimaTimestamp = (date: Date, timeStr: string, isEnd: boolean): Date => {
    const [hh, mm] = timeStr
      ? timeStr.split(':').map(Number)
      : isEnd ? [23, 59] : [0, 0];
    const ss = isEnd && !timeStr ? 59 : 0;
    // Construir en UTC: fecha Lima + hora Lima + offset Lima (UTC-5 = +5h en UTC)
    return new Date(Date.UTC(
      date.getFullYear(), date.getMonth(), date.getDate(),
      hh + 5,   // sumar 5h para convertir Lima → UTC
      mm,
      ss,
      isEnd && !timeStr ? 999 : 0,
    ));
  };

  // Construye los filtros compartidos de la query principal (sede, fechas, pestaña)
  const buildBaseQuery = (forCount = false) => {
    const start = buildLimaTimestamp(dateFrom, timeFrom, false);
    const end   = buildLimaTimestamp(dateTo,   timeTo,   true);

    let q = supabase
      .from('transactions')
      .select(forCount ? '*' : TRANSACTION_SELECT, forCount ? { count: 'exact', head: true } : { count: 'exact' })
      .in('type', ['purchase', 'sale'])   // cubre ventas POS nuevas y legacy
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });

    if (canViewAllSchools) {
      if (selectedSchool !== 'all') q = q.eq('school_id', selectedSchool);
    } else {
      q = q.eq('school_id', userSchoolId!);
    }

    if (activeTab === 'deleted') {
      q = q.or('payment_status.eq.cancelled,is_deleted.eq.true');
    } else {
      q = q.eq('is_deleted', false).neq('payment_status', 'cancelled');
    }

    // ── Filtro de Nº de Operación (columna dedicada) ─────────────────────────
    if (opNumberSearch.trim()) {
      q = q.ilike('operation_number', `%${opNumberSearch.trim()}%`);
    }

    // ── Filtro de Método de Pago ──────────────────────────────────────────────
    if (selectedPaymentMethod !== 'all') {
      // Yape y Plin tienen variantes (_qr, _numero) → usar ilike con prefijo
      if (selectedPaymentMethod === 'yape') {
        q = q.or('payment_method.eq.yape,payment_method.eq.yape_qr,payment_method.eq.yape_numero');
      } else if (selectedPaymentMethod === 'plin') {
        q = q.or('payment_method.eq.plin,payment_method.eq.plin_qr,payment_method.eq.plin_numero');
      } else if (selectedPaymentMethod === 'tarjeta') {
        q = q.or('payment_method.eq.tarjeta,payment_method.eq.card,payment_method.eq.visa,payment_method.eq.mastercard');
      } else {
        q = q.eq('payment_method', selectedPaymentMethod);
      }
    }

    return q;
  };

  const fetchTransactions = async () => {
    const currentRequestId = ++fetchTxRequestId.current;
    try {
      if (!canViewAllSchools && !userSchoolId) { setLoading(false); return; }

      setLoading(true);

      const from = (currentPage - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      const { data, error, count } = await buildBaseQuery()
        .range(from, to) as any;

      if (error) throw error;

      // Enriquecer con datos del cajero (campo no disponible en el select principal)
      if (data && data.length > 0) {
        const createdByIds = [...new Set((data as any[]).map((t) => t.created_by).filter(Boolean))];
        if (createdByIds.length > 0) {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .in('id', createdByIds);
          if (profilesData) {
            const map = new Map(profilesData.map(p => [p.id, p]));
            (data as any[]).forEach(t => { if (t.created_by) t.profiles = map.get(t.created_by); });
          }
        }
      }

      if (currentRequestId !== fetchTxRequestId.current) return;
      setTransactions(data || []);
      setTotalCount(count ?? 0);
    } catch (error: any) {
      if (currentRequestId !== fetchTxRequestId.current) return;
      console.error('Error fetching transactions:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las ventas' });
    } finally {
      if (currentRequestId === fetchTxRequestId.current) setLoading(false);
    }
  };

  const fetchTransactionItems = async (transactionId: string) => {
    try {
      const { data, error } = await supabase
        .from('transaction_items')
        .select('*')
        .eq('transaction_id', transactionId);

      if (error) throw error;
      setTransactionItems(data || []);
    } catch (error: any) {
      console.error('Error fetching items:', error);
    }
  };

  // ========== MANEJO DE SELECCIÓN MÚLTIPLE ==========
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === filteredTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTransactions.map(t => t.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // ========== EDITAR DATOS DEL CLIENTE ==========
  const handleOpenEditClient = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setEditClientName(transaction.invoice_client_name || transaction.student?.full_name || transaction.teacher?.full_name || 'CLIENTE GENÉRICO');
    setEditClientDNI(transaction.client_dni || '');
    setEditClientRUC(transaction.client_ruc || '');
    setEditDocumentType(transaction.document_type || 'ticket');
    setShowEditClient(true);
  };

  const handleSaveClientData = async () => {
    if (!selectedTransaction) return;

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          invoice_client_name:    editClientName.trim() || null,
          invoice_client_dni_ruc: editClientDNI.trim() || editClientRUC.trim() || null,
          document_type: editDocumentType,
        })
        .eq('id', selectedTransaction.id);

      if (error) throw error;

      toast({
        title: '✅ Datos Actualizados',
        description: 'La información del cliente fue actualizada correctamente',
      });

      setShowEditClient(false);
      fetchTransactions();
    } catch (error: any) {
      console.error('Error updating client data:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar la información',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== EDITAR MEDIO DE PAGO ==========
  const handleOpenEditPayment = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setEditPaymentMethod(transaction.payment_method || 'efectivo');
    setShowEditPayment(true);
  };

  const handleSavePaymentMethod = async () => {
    if (!selectedTransaction || !editPaymentMethod) return;

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ payment_method: editPaymentMethod })
        .eq('id', selectedTransaction.id);

      if (error) throw error;

      toast({
        title: '✅ Medio de Pago Actualizado',
        description: `Ticket ${selectedTransaction.ticket_code}: cambiado a ${editPaymentMethod.toUpperCase()}`,
      });

      setShowEditPayment(false);
      fetchTransactions();
    } catch (error: any) {
      console.error('Error updating payment method:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar el medio de pago',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== ANULAR VENTA ==========
  const handleOpenAnnul = (transaction: Transaction) => {
    console.log('🗑️ Intentando anular venta:', {
      ticket: transaction.ticket_code,
      userRole: role,
      isCajero: role === 'cajero' || role === 'operador_caja'
    });
    
    // Si es cajero u operador de caja, requiere contraseña de admin primero
    if (role === 'cajero' || role === 'operador_caja') {
      console.log('✅ Es cajero/operador, pidiendo autorización de admin');
      setPendingAnnulTransaction(transaction);
      setAdminEmail('');
      setAdminPassword('');
      setShowPasswordValidation(true);
    } else {
      console.log('✅ Es admin/gestor, anulación directa');
      // Admin o gestor pueden anular directamente
      setSelectedTransaction(transaction);
      setAnnulReason('');
      setShowAnnul(true);
    }
  };

  // Validar credenciales del admin para que el cajero pueda anular
  // Usa un cliente temporal sin persistencia — no afecta la sesión del cajero
  const handleValidatePassword = async () => {
    if (!adminEmail.trim() || !adminPassword.trim()) {
      toast({
        variant: 'destructive',
        title: 'Completa los campos',
        description: 'Ingresa el correo y la contraseña del administrador',
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Cliente temporal con memoria (no toca la sesión del cajero)
      const tempClient = createClient(
        supabaseConfig.url,
        supabaseConfig.anonKey,
        {
          auth: {
            persistSession:   false,
            autoRefreshToken: false,
            storageKey:       'sb-admin-verify-temp',  // ← aislado, no pisa la sesión principal
          },
        }
      );

      const { data: authData, error: authError } = await tempClient.auth.signInWithPassword({
        email: adminEmail.trim().toLowerCase(),
        password: adminPassword.trim(),
      });

      if (authError || !authData?.user) {
        toast({
          variant: 'destructive',
          title: 'Credenciales incorrectas',
          description: 'El correo o la contraseña del administrador no son válidos',
        });
        return;
      }

      // Verificar que sea admin/gestor con acceso a esta sede
      const { data: profile, error: profileError } = await tempClient
        .from('profiles')
        .select('role, school_id')
        .eq('id', authData.user.id)
        .single();

      // Cerrar la sesión temporal inmediatamente
      await tempClient.auth.signOut();

      if (profileError || !profile) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo verificar el perfil del admin' });
        return;
      }

      const rolesAdmin = ['admin_general', 'gestor_unidad', 'admin_sede', 'supervisor_red', 'superadmin'];
      if (!rolesAdmin.includes(profile.role)) {
        toast({
          variant: 'destructive',
          title: 'No autorizado',
          description: 'El usuario ingresado no tiene rol de administrador',
        });
        return;
      }

      // Si es gestor_unidad, debe ser de la misma sede que el cajero
      if (profile.role === 'gestor_unidad' && userSchoolId && profile.school_id !== userSchoolId) {
        toast({
          variant: 'destructive',
          title: 'Admin de otra sede',
          description: 'Ese administrador pertenece a una sede diferente. Usa el admin de tu sede.',
        });
        return;
      }

      // ✅ Autorizado
      toast({ title: '✅ Autorizado', description: `Admin verificado: ${adminEmail.trim()}` });
      setShowPasswordValidation(false);
      setSelectedTransaction(pendingAnnulTransaction);
      setAnnulReason('');
      setShowAnnul(true);
      setAdminEmail('');
      setAdminPassword('');
      setPendingAnnulTransaction(null);

    } catch (error: any) {
      console.error('Error validando admin:', error);
      toast({
        variant: 'destructive',
        title: 'Error de conexión',
        description: 'No se pudo conectar para verificar. Intenta de nuevo.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const isNonCashPayment = (method?: string) => {
    return method && ['yape', 'yape_qr', 'yape_numero', 'tarjeta', 'transferencia', 'plin', 'plin_qr'].includes(method);
  };

  const handleAnnulSale = async () => {
    if (!selectedTransaction || !annulReason.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes ingresar un motivo de anulación',
      });
      return;
    }

    if (isNonCashPayment(selectedTransaction.payment_method) && !refundMethod) {
      toast({
        variant: 'destructive',
        title: 'Selecciona método de devolución',
        description: `Esta venta fue pagada con ${selectedTransaction.payment_method?.toUpperCase()}. Indica cómo se devolvió el dinero.`,
      });
      return;
    }

    setIsProcessing(true);
    try {
      const { data: currentTx } = await supabase
        .from('transactions')
        .select('metadata')
        .eq('id', selectedTransaction.id)
        .single();
      
      const currentMetadata = currentTx?.metadata || {};
      
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          payment_status: 'cancelled',
          metadata: {
            ...currentMetadata,
            cancelled_at: new Date().toISOString(),
            cancelled_by: user?.id,
            cancellation_reason: annulReason.trim(),
            ...(refundMethod ? { refund_method: refundMethod } : {}),
          },
        })
        .eq('id', selectedTransaction.id);

      if (updateError) throw updateError;

      const { error: salesError } = await supabase
        .from('sales')
        .update({ payment_method: 'cancelled' })
        .eq('transaction_id', selectedTransaction.id);

      if (salesError) {
        console.error('⚠️ Error actualizando sales:', salesError);
      }

      // Insertar alerta de anulación para admin_general
      await supabase.from('cancellation_alerts').insert({
        school_id: selectedTransaction.school_id,
        transaction_id: selectedTransaction.id,
        alert_type: 'sale_cancelled',
        amount: Math.abs(selectedTransaction.amount),
        payment_method: selectedTransaction.payment_method,
        refund_method: refundMethod || null,
        cancelled_by: user?.id,
        cancellation_reason: annulReason.trim(),
        client_name: selectedTransaction.invoice_client_name || selectedTransaction.student?.full_name || selectedTransaction.teacher?.full_name || 'Cliente genérico',
        ticket_code: selectedTransaction.ticket_code,
      }).then(({ error }) => {
        if (error) console.error('⚠️ Error insertando alerta:', error);
      });

      if (selectedTransaction.student_id && selectedTransaction.student) {
        const amountToReturn = Math.abs(selectedTransaction.amount);

        // 🔒 ATÓMICO: Devolver saldo usando RPC (evita usar balance stale del state)
        const { data: updatedBalance, error: rpcError } = await supabase
          .rpc('adjust_student_balance', {
            p_student_id: selectedTransaction.student_id,
            p_amount: amountToReturn,
          });

        if (rpcError) throw rpcError;

        const finalBalance = updatedBalance ?? (selectedTransaction.student.balance + amountToReturn);

        toast({
          title: '✅ Venta Anulada',
          description: `Saldo devuelto: S/ ${amountToReturn.toFixed(2)}. Nuevo saldo: S/ ${finalBalance.toFixed(2)}`,
        });
      } else {
        toast({
          title: '✅ Venta Anulada',
          description: 'La venta fue marcada como anulada',
        });
      }

      // Rastro de auditoría: anulación de venta con devolución de saldo
      registrarHuella(
        'DEVOLUCION_SALDO_POR_ANULACION',
        'VENTAS',
        {
          admin_id: user?.id,
          transaccion_id: selectedTransaction.id,
          ticket_code: selectedTransaction.ticket_code ?? null,
          alumno_id: selectedTransaction.student_id ?? null,
          alumno_nombre: selectedTransaction.student?.full_name ?? null,
          monto_devuelto: selectedTransaction.student_id ? Math.abs(selectedTransaction.amount) : 0,
          motivo_anulacion: annulReason.trim(),
          metodo_devolucion: refundMethod || null,
        },
        undefined,
        selectedTransaction.school_id ?? undefined
      );

      setShowAnnul(false);
      setRefundMethod('');
      fetchTransactions();
      emitSync(['debtors', 'balances', 'dashboard']);
    } catch (error: any) {
      console.error('Error annulling sale:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo anular la venta',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== REIMPRIMIR TICKET ==========
  const handleViewDetails = async (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    await fetchTransactionItems(transaction.id);
    setShowDetails(true);
  };

  const handleReprint = async (transaction: Transaction) => {
    try {
      // 1. Cargamos los datos y abrimos el modal para que se vea el ticket integrado
      setSelectedTransaction(transaction);
      await fetchTransactionItems(transaction.id);
      setShowDetails(true);
      
      // 2. Damos un pequeño respiro para que el modal se dibuje y luego lanzamos la impresión
      toast({
        title: "Preparando ticket...",
        description: "Abriendo vista previa e impresión",
      });
      
      setTimeout(() => {
        window.print();
      }, 500);
    } catch (error) {
      console.error("Error al reimprimir:", error);
    }
  };

  // ========== IMPRESIÓN MÚLTIPLE ==========
  const handlePrintSelected = () => {
    if (selectedIds.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos una venta',
      });
      return;
    }
    setShowPrintOptions(true);
  };

  const executePrint = () => {
    if (printType === 'individual') {
      // Imprimir tickets uno por uno (se abrirán múltiples ventanas de impresión)
      toast({
        title: 'Imprimiendo...',
        description: `Se imprimirán ${selectedIds.size} tickets`,
      });
      // TODO: Implementar impresión secuencial
    } else {
      // Consolidado (TODO: generar reporte PDF)
      toast({
        title: 'Generando consolidado...',
        description: 'Próximamente disponible',
      });
    }
    setShowPrintOptions(false);
  };

  // 🔍 Determinar si una transacción es de almuerzo
  const isLunchTransaction = (t: Transaction): boolean => {
    // Verificar por metadata (más confiable)
    if (t.metadata?.lunch_order_id) return true;
    if (t.metadata?.source && (
      t.metadata.source.includes('lunch') || 
      t.metadata.source === 'lunch_orders_confirm' ||
      t.metadata.source === 'lunch_order' ||
      t.metadata.source === 'lunch_fast'
    )) return true;
    // Verificar por descripción (fallback para transacciones antiguas)
    if (t.description?.startsWith('Almuerzo')) return true;
    if (t.description?.startsWith('Almuerzo -')) return true;
    return false;
  };

  // Búsqueda inteligente — si hay resultados globales los usa, si no usa los del día
  const baseTransactions = globalSearchResults !== null ? globalSearchResults : transactions;
  const filteredTransactions = baseTransactions.filter(t => {
    // Filtro tipo de venta (Cafetería / Almuerzo)
    if (salesFilter === 'pos'   && isLunchTransaction(t))  return false;
    if (salesFilter === 'lunch' && !isLunchTransaction(t)) return false;

    // Filtro tipo de persona (Alumno / Profesor / Todos)
    if (personFilter === 'alumno'   && !t.student_id)  return false;
    if (personFilter === 'profesor' && !t.teacher_id)  return false;

    // En búsqueda global ya vienen filtrados por nombre desde Supabase
    if (globalSearchResults !== null) return true;

    // Filtro de búsqueda local
    if (!searchTerm.trim()) return true;

    const search = searchTerm.toLowerCase();
    return (
      t.ticket_code?.toLowerCase().includes(search) ||
      t.student?.full_name?.toLowerCase().includes(search) ||
      t.teacher?.full_name?.toLowerCase().includes(search) ||
      t.invoice_client_name?.toLowerCase().includes(search) ||
      t.description?.toLowerCase().includes(search) ||
      Math.abs(t.amount).toString().includes(search)
    );
  });

  const getTotalSales = () => {
    return filteredTransactions
      .filter(t => !t.is_deleted && t.payment_status !== 'cancelled')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  };

  // ── Agrupación por alumno/cliente ──────────────────────────────────────────
  const studentGroups = useMemo(() => {
    const map: Record<string, { key: string; name: string; txs: Transaction[]; total: number }> = {};
    filteredTransactions.forEach(t => {
      const name = t.student?.full_name || t.teacher?.full_name || t.invoice_client_name || 'Venta General';
      const key  = t.student_id || t.teacher_id || t.invoice_client_name || 'generic';
      if (!map[key]) map[key] = { key, name, txs: [], total: 0 };
      map[key].txs.push(t);
      map[key].total += Math.abs(t.amount || 0);
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredTransactions]);

  // Guards condicionales DESPUÉS de todos los Hooks
  if (permissions.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Verificando permisos...</p>
        </div>
      </div>
    );
  }

  if (maintenance.blocked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600">{maintenance.message}</p>
        </div>
      </div>
    );
  }

  const toggleStudentRow = (key: string) => {
    setExpandedStudents(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Helper: obtiene TODO el rango sin paginación para exportación de auditoría ──
  const fetchAllForExport = async (): Promise<Transaction[]> => {
    if (!canViewAllSchools && !userSchoolId) return [];

    // Convertir fechas a UTC respetando el huso horario Lima (UTC-5).
    // dateFrom/dateTo son Date locales del calendario → construir el rango UTC explícito.
    // Inicio del primer día Lima = 05:00 UTC del mismo día calendario.
    // Fin del último día Lima    = 04:59:59.999 UTC del día calendario SIGUIENTE.
    const limaOffsetMs = 5 * 60 * 60 * 1000;
    const startUTC = new Date(
      Date.UTC(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate()) + limaOffsetMs
    );
    const endUTC = new Date(
      Date.UTC(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate() + 1) + limaOffsetMs - 1
    );

    // ── Paginación completa: bucle .range(from, to) hasta agotar todos los registros ──
    // Supabase devuelve máximo 1000 filas por petición; sin paginación se trunca silenciosamente.
    const PAGE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      let q = supabase
        .from('transactions')
        .select(TRANSACTION_SELECT)
        .in('type', ['purchase', 'sale'])
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')
        .gte('created_at', startUTC.toISOString())
        .lte('created_at', endUTC.toISOString())
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);

      if (canViewAllSchools) {
        if (selectedSchool !== 'all') q = q.eq('school_id', selectedSchool);
      } else {
        q = q.eq('school_id', userSchoolId!);
      }

      const { data, error } = await q;
      if (error) throw error;

      allData = allData.concat(data ?? []);
      hasMore = (data?.length ?? 0) === PAGE;
      from += PAGE;
    }

    // Enriquecer con cajeros (una sola query para todos los lotes)
    if (allData.length > 0) {
      const ids = [...new Set(allData.map((t: any) => t.created_by).filter(Boolean))];
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from('profiles').select('id, email, full_name').in('id', ids);
        if (profs) {
          const map = new Map(profs.map(p => [p.id, p]));
          allData.forEach((t: any) => { if (t.created_by) t.profiles = map.get(t.created_by); });
        }
      }
    }
    return allData as Transaction[];
  };

  // ── Exportar PDF profesional ─────────────────────────────────────────────
  const downloadPDF = async () => {
    setIsExporting(true);
    let exportData: Transaction[];
    try {
      exportData = await fetchAllForExport();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al exportar', description: err.message });
      setIsExporting(false);
      return;
    } finally {
      setIsExporting(false);
    }

    if (exportData.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay ventas para exportar en el rango seleccionado.' });
      return;
    }

    // Agrupación y total desde datos de la BD (no del estado de UI)
    const exportGroups: Record<string, { key: string; name: string; txs: Transaction[]; total: number }> = {};
    exportData.forEach(t => {
      const name = t.student?.full_name || t.teacher?.full_name || t.invoice_client_name || 'Venta General';
      const key  = t.student_id || t.teacher_id || t.invoice_client_name || 'generic';
      if (!exportGroups[key]) exportGroups[key] = { key, name, txs: [], total: 0 };
      exportGroups[key].txs.push(t);
      exportGroups[key].total += Math.abs(t.amount || 0);
    });
    const groupList = Object.values(exportGroups).sort((a, b) => b.total - a.total);
    const grandTotal = exportData.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const rangeLabel = dateFrom.toDateString() === dateTo.toDateString()
      ? format(dateFrom, "dd/MM/yyyy")
      : `${format(dateFrom, "dd/MM/yyyy")} — ${format(dateTo, "dd/MM/yyyy")}`;

    // ── Encabezado ──
    doc.setFillColor(139, 69, 19);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('LIMA CAFE', 14, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Reporte de Ventas — Comprobante de Arqueo', 14, 21);
    doc.text(rangeLabel, 196, 21, { align: 'right' });

    // ── Resumen ──
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(9);
    doc.text(`Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 38);
    doc.text(`Total transacciones: ${exportData.length}`, 14, 44);
    doc.text(`Total ventas: S/ ${grandTotal.toFixed(2)}`, 14, 50);

    // ── Tabla agrupada por alumno ──
    const rows: (string | { content: string; styles?: Record<string, unknown> })[][] = [];

    groupList.forEach(g => {
      g.txs.forEach((t, i) => {
        rows.push([
          i === 0 ? g.name : '',
          format(new Date(t.created_at), 'dd/MM HH:mm'),
          t.ticket_code || '—',
          t.payment_method || '—',
          t.description || '—',
          `S/ ${Math.abs(t.amount || 0).toFixed(2)}`,
        ]);
      });
      rows.push([
        { content: `Subtotal ${g.name}`, styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: `S/ ${g.total.toFixed(2)}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [245, 245, 245] } },
      ]);
    });

    rows.push([
      { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold', fillColor: [139, 69, 19], textColor: [255, 255, 255] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: `S/ ${grandTotal.toFixed(2)}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [139, 69, 19], textColor: [255, 255, 255] } },
    ]);

    autoTable(doc, {
      startY: 58,
      head: [['Alumno / Cliente', 'Fecha y Hora', 'Ticket', 'Método de Pago', 'Detalle', 'Monto']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [139, 69, 19], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 24 },
        2: { cellWidth: 24 },
        3: { cellWidth: 22 },
        4: { cellWidth: 'auto' },
        5: { halign: 'right', cellWidth: 22 },
      },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 0 && data.cell.raw !== '') {
          doc.setDrawColor(139, 69, 19);
          doc.setLineWidth(0.3);
          doc.line(data.cell.x, data.cell.y, 210 - 14, data.cell.y);
        }
      },
    });

    // ── Pie de página ──
    const finalY = (doc as any).lastAutoTable?.finalY || 200;
    doc.setDrawColor(139, 69, 19);
    doc.setLineWidth(0.5);
    doc.line(14, finalY + 8, 196, finalY + 8);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Este documento es un comprobante interno de arqueo. No tiene validez tributaria.', 105, finalY + 14, { align: 'center' });
    doc.text('Lima Cafe — Sistema de Gestión Escolar', 105, finalY + 19, { align: 'center' });

    doc.save(`arqueo_ventas_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    toast({ title: '✅ PDF generado', description: 'El comprobante de arqueo se descargó correctamente.' });
  };

  // ── Exportar Excel Arqueo — query fresca (no depende del estado de UI) ──────
  const downloadExcel = async () => {
    setIsExporting(true);
    let exportData: Transaction[];
    try {
      exportData = await fetchAllForExport();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al exportar', description: err.message });
      setIsExporting(false);
      return;
    } finally {
      setIsExporting(false);
    }

    if (exportData.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay ventas para exportar en el rango seleccionado.' });
      return;
    }

    const rangeLabel = dateFrom.toDateString() === dateTo.toDateString()
      ? format(dateFrom, 'dd/MM/yyyy')
      : `${format(dateFrom, 'dd/MM/yyyy')} — ${format(dateTo, 'dd/MM/yyyy')}`;

    const sedeLabel = !canViewAllSchools && userSchoolId
      ? (schools.find(s => s.id === userSchoolId)?.name ?? 'Mi Sede')
      : selectedSchool === 'all'
        ? 'Todas las Sedes'
        : (schools.find(s => s.id === selectedSchool)?.name ?? selectedSchool);

    const totalVentas = exportData.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const cantidadTx  = exportData.length;
    const promedio    = cantidadTx > 0 ? totalVentas / cantidadTx : 0;

    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    const set = (cell: string, v: unknown) => { ws[cell] = { v }; };

    set('A1', 'ARQUEO DE CAJA — DATOS DIRECTOS DE BASE DE DATOS');
    set('A2', `Sede: ${sedeLabel}`);
    set('A3', `Período: ${rangeLabel}   |   Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`);

    set('A5', 'TOTAL VENTAS');   set('B5', `S/ ${totalVentas.toFixed(2)}`);
    set('C5', 'TRANSACCIONES');  set('D5', cantidadTx);
    set('E5', 'PROMEDIO');       set('F5', `S/ ${promedio.toFixed(2)}`);

    const headers = ['ID Ticket', 'Cliente', 'Sede', 'Fecha / Hora', 'Categoría', 'Cajero', 'Método de Pago', 'Monto (S/)'];
    headers.forEach((h, i) => set(`${String.fromCharCode(65 + i)}7`, h));

    exportData.forEach((t, idx) => {
      const row = 8 + idx;
      const clientName = t.invoice_client_name || t.student?.full_name || t.teacher?.full_name || 'Cliente Genérico';
      const categoria  = isLunchTransaction(t) ? 'Almuerzo' : 'Cafetería';
      const cajero     = (t as any).profiles?.full_name || (t as any).profiles?.email || 'Sistema';
      const metodo     = t.payment_method
        ? t.payment_method.charAt(0).toUpperCase() + t.payment_method.slice(1)
        : 'Efectivo';

      set(`A${row}`, t.ticket_code || '—');
      set(`B${row}`, clientName);
      set(`C${row}`, t.school?.name ?? sedeLabel);
      set(`D${row}`, format(new Date(t.created_at), 'dd/MM/yyyy HH:mm'));
      set(`E${row}`, categoria);
      set(`F${row}`, cajero);
      set(`G${row}`, metodo);
      ws[`H${row}`] = { v: Math.abs(t.amount || 0), t: 'n' };
    });

    const lastRow = 8 + cantidadTx;
    set(`G${lastRow}`, 'TOTAL GENERAL');
    ws[`H${lastRow}`] = { v: totalVentas, t: 'n' };

    ws['!ref'] = `A1:H${lastRow}`;
    ws['!cols'] = [
      { wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 18 },
      { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 12 },
    ];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Arqueo');
    XLSX.writeFile(wb, `arqueo_ventas_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
    toast({ title: '✅ Excel generado', description: `${cantidadTx} ventas exportadas desde la base de datos.` });
  };

  return (
    <div className="space-y-4">
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-emerald-600" />
                Módulo de Ventas
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <CalendarIcon className="h-3 w-3" />
                {dateFrom.toDateString() === dateTo.toDateString()
                  ? format(dateFrom, "EEEE, dd 'de' MMMM yyyy", { locale: es })
                  : `${format(dateFrom, "dd/MM/yyyy")} — ${format(dateTo, "dd/MM/yyyy")}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">

              {/* ── Rango de fechas ── */}
              <div className="flex items-center gap-1.5 bg-muted rounded-lg px-2 py-1">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Desde</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-bold">
                      {format(dateFrom, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={(d) => { if (d) { setDateFrom(d); if (d > dateTo) setDateTo(d); } }}
                      initialFocus
                      locale={es}
                      disabled={(d) => d > new Date()}
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-xs text-muted-foreground font-medium">Hasta</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-bold">
                      {format(dateTo, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={(d) => { if (d) { setDateTo(d); if (d < dateFrom) setDateFrom(d); } }}
                      initialFocus
                      locale={es}
                      disabled={(d) => d > new Date() || d < dateFrom}
                    />
                  </PopoverContent>
                </Popover>
                {/* Acceso rápido: Hoy */}
                <Button
                  variant="ghost" size="sm"
                  className="h-7 px-2 text-[10px] text-blue-600 hover:bg-blue-50"
                  onClick={() => { const t = new Date(); setDateFrom(t); setDateTo(t); }}
                >
                  Hoy
                </Button>

                {/* Filtro de horas */}
                <span className="text-xs text-muted-foreground font-medium ml-1">|</span>
                <span className="text-xs text-muted-foreground font-medium">⏱ Desde</span>
                <input
                  type="time"
                  value={timeFrom}
                  onChange={(e) => setTimeFrom(e.target.value)}
                  className="h-7 px-1.5 text-xs border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-[82px]"
                  title="Hora inicio (Lima)"
                />
                <span className="text-xs text-muted-foreground font-medium">hasta</span>
                <input
                  type="time"
                  value={timeTo}
                  onChange={(e) => setTimeTo(e.target.value)}
                  className="h-7 px-1.5 text-xs border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-[82px]"
                  title="Hora fin (Lima)"
                />
                {(timeFrom || timeTo) && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 px-1.5 text-[10px] text-gray-500 hover:bg-gray-100"
                    onClick={() => { setTimeFrom(''); setTimeTo(''); }}
                    title="Quitar filtro de hora"
                  >
                    ✕ hora
                  </Button>
                )}
              </div>

              {/* ── Toggle Vista ── */}
              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <Button
                  variant={viewMode === 'grouped' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => setViewMode('grouped')}
                  title="Vista agrupada por persona"
                >
                  <Users className="h-3.5 w-3.5" />
                  Agrupado
                </Button>
                <Button
                  variant={viewMode === 'flat' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => setViewMode('flat')}
                  title="Vista detallada (una fila por venta)"
                >
                  <List className="h-3.5 w-3.5" />
                  Detalle
                </Button>
              </div>

              {selectedIds.size > 0 && (
                <>
                  <Badge variant="secondary" className="text-sm">
                    {selectedIds.size} seleccionadas
                  </Badge>
                  <Button variant="outline" size="sm" onClick={handlePrintSelected}>
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimir
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={fetchTransactions}>
                <ArrowUpDown className="h-4 w-4 mr-2" />
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Estadísticas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="bg-emerald-50 border-emerald-200">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-emerald-600 font-semibold uppercase">Total Ventas</p>
                    <p className="text-2xl font-black text-emerald-900">S/ {getTotalSales().toFixed(2)}</p>
                  </div>
                  <FileText className="h-8 w-8 text-emerald-600 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-blue-600 font-semibold uppercase">Transacciones</p>
                    <p className="text-2xl font-black text-blue-900">{filteredTransactions.length}</p>
                  </div>
                  <ShoppingCart className="h-8 w-8 text-blue-600 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-purple-50 border-purple-200">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-purple-600 font-semibold uppercase">Promedio</p>
                    <p className="text-2xl font-black text-purple-900">
                      S/ {filteredTransactions.length > 0 ? (getTotalSales() / filteredTransactions.length).toFixed(2) : '0.00'}
                    </p>
                  </div>
                  <ArrowUpDown className="h-8 w-8 text-purple-600 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Barra de búsqueda + filtros avanzados ── */}
          <div className="space-y-3 mb-6">

            {/* Fila 1: Buscador general + Nº de Operación */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

              {/* Buscador general (nombre, ticket, descripción) */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  placeholder="🔍 Buscar: ticket, cliente, monto..."
                  className="pl-10 h-12 text-base border-2 focus:border-emerald-500"
                  value={searchTerm}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchTerm(val);
                    if (!val.trim()) {
                      setGlobalSearchResults(null);
                      if (globalSearchTimer.current) clearTimeout(globalSearchTimer.current);
                      return;
                    }
                    if (globalSearchTimer.current) clearTimeout(globalSearchTimer.current);
                    globalSearchTimer.current = setTimeout(() => {
                      fetchGlobalSearch(val);
                    }, 600);
                  }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {globalSearchLoading && (
                    <span className="text-xs text-gray-400 animate-pulse">Buscando...</span>
                  )}
                  {globalSearchResults !== null && !globalSearchLoading && (
                    <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-800">
                      🌐 {filteredTransactions.length} resultados
                    </Badge>
                  )}
                  {searchTerm && globalSearchResults === null && !globalSearchLoading && (
                    <Badge variant="secondary" className="text-xs">
                      {filteredTransactions.length} resultados
                    </Badge>
                  )}
                </div>
              </div>

              {/* Buscador dedicado de Nº de Operación */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-muted-foreground select-none">#</span>
                <Input
                  placeholder="Buscar Nº de Operación (Yape, Tarjeta, Transfer...)"
                  className={`pl-8 h-12 text-base border-2 uppercase ${opNumberSearch ? 'border-indigo-400 focus:border-indigo-500 bg-indigo-50' : 'focus:border-indigo-400'}`}
                  value={opNumberSearch}
                  onChange={(e) => {
                    setOpNumberSearch(e.target.value.toUpperCase());
                    setCurrentPage(1);
                  }}
                />
                {opNumberSearch && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none"
                    onClick={() => setOpNumberSearch('')}
                    title="Limpiar"
                  >×</button>
                )}
              </div>
            </div>

            {/* Fila 2: Filtro de Método de Pago */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-600 shrink-0">💳 Medio de Pago:</span>
              {[
                { value: 'all',          label: 'Todos',          color: 'gray'   },
                { value: 'efectivo',     label: '💵 Efectivo',    color: 'emerald'},
                { value: 'yape',         label: '📱 Yape',        color: 'purple' },
                { value: 'plin',         label: '📱 Plin',        color: 'cyan'   },
                { value: 'tarjeta',      label: '💳 Tarjeta',     color: 'blue'   },
                { value: 'transferencia',label: '🏦 Transferencia',color: 'amber' },
                { value: 'mixto',        label: '🔀 Mixto',       color: 'orange' },
              ].map(opt => {
                const isActive = selectedPaymentMethod === opt.value;
                const colorMap: Record<string, string> = {
                  gray:    isActive ? 'bg-gray-700 text-white border-gray-700'    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500',
                  emerald: isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-500',
                  purple:  isActive ? 'bg-purple-600 text-white border-purple-600'   : 'bg-white text-purple-700 border-purple-300 hover:border-purple-500',
                  cyan:    isActive ? 'bg-cyan-600 text-white border-cyan-600'       : 'bg-white text-cyan-700 border-cyan-300 hover:border-cyan-500',
                  blue:    isActive ? 'bg-blue-600 text-white border-blue-600'       : 'bg-white text-blue-700 border-blue-300 hover:border-blue-500',
                  amber:   isActive ? 'bg-amber-600 text-white border-amber-600'     : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500',
                  orange:  isActive ? 'bg-orange-600 text-white border-orange-600'   : 'bg-white text-orange-700 border-orange-300 hover:border-orange-500',
                };
                return (
                  <button
                    key={opt.value}
                    onClick={() => { setSelectedPaymentMethod(opt.value); setCurrentPage(1); }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border-2 transition-all ${colorMap[opt.color]}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
              {selectedPaymentMethod !== 'all' && (
                <button
                  className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700"
                  onClick={() => setSelectedPaymentMethod('all')}
                >✕ limpiar</button>
              )}
            </div>
          </div>

          {/* Filtro de Tipo de Venta */}
          <Card className="mb-6 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-emerald-600" />
                  <Label className="font-semibold text-emerald-900">Tipo de Venta:</Label>
                </div>
                <Select value={salesFilter} onValueChange={(value: 'all' | 'pos' | 'lunch') => setSalesFilter(value)}>
                  <SelectTrigger className="w-[280px] bg-white">
                    <SelectValue placeholder="Selecciona tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-purple-600" />
                        <span className="font-semibold">📊 Todas las Ventas</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="pos">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-blue-600" />
                        <span>🛒 Punto de Venta (Cafetería)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="lunch">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-orange-600" />
                        <span>🍽️ Almuerzos</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="default" className="ml-2">
                  {salesFilter === 'all' && '📊 Mostrando todo'}
                  {salesFilter === 'pos' && '🛒 Solo Cafetería'}
                  {salesFilter === 'lunch' && '🍽️ Solo Almuerzos'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* ── Filtro de Tipo de Persona (Alumno / Profesor / Todos) ── */}
          <Card className="mb-6 bg-gradient-to-r from-indigo-50 to-violet-50 border-indigo-200">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  <Users className="h-5 w-5 text-indigo-600" />
                  <Label className="font-semibold text-indigo-900">Tipo de Persona:</Label>
                </div>
                <div className="flex gap-2">
                  {[
                    { value: 'all',      label: '📊 Todos',    color: 'indigo' },
                    { value: 'alumno',   label: '🎓 Alumno',   color: 'blue'   },
                    { value: 'profesor', label: '👨‍🏫 Profesor', color: 'violet' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setPersonFilter(opt.value as 'all' | 'alumno' | 'profesor')}
                      className={`px-4 py-1.5 rounded-full text-sm font-semibold border-2 transition-all ${
                        personFilter === opt.value
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-indigo-700 border-indigo-200 hover:border-indigo-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {personFilter !== 'all' && (
                  <Badge className="ml-1 bg-indigo-100 text-indigo-800 border border-indigo-300">
                    {filteredTransactions.length} resultado{filteredTransactions.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Filtro de Sedes (solo si tiene permiso) */}
          {canViewAllSchools && schools.length > 1 && (
            <Card className="mb-6 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Filter className="h-5 w-5 text-blue-600" />
                    <Label className="font-semibold text-blue-900">Filtrar por Sede:</Label>
                  </div>
                  <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                    <SelectTrigger className="w-[280px] bg-white">
                      <SelectValue placeholder="Selecciona una sede" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-purple-600" />
                          <span className="font-semibold">Todas las Sedes</span>
                        </div>
                      </SelectItem>
                      {schools.map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-blue-600" />
                            <span>{school.name}</span>
                            <Badge variant="outline" className="text-xs">{school.code}</Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedSchool !== 'all' && (
                    <Badge variant="default" className="ml-2">
                      Filtrando
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 🔒 Indicador para Admin de Sede (cuando NO puede ver todas las sedes) */}
          {!canViewAllSchools && userSchoolId && (
            <Card className="mb-6 bg-gradient-to-r from-orange-50 to-amber-50 border-orange-300">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-orange-600" />
                  <div>
                    <p className="font-semibold text-orange-900">
                      Mostrando solo ventas de tu sede
                    </p>
                    <p className="text-sm text-orange-700">
                      {schools.find(s => s.id === userSchoolId)?.name || 'Tu sede'}
                    </p>
                  </div>
                  <Badge variant="secondary" className="ml-auto bg-orange-100 text-orange-800 border-orange-300">
                    🔒 Vista limitada
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pestañas */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="flex items-center justify-between">
              <TabsList className="grid grid-cols-2 h-auto">
                <TabsTrigger value="today" className="flex items-center gap-2 py-3">
                  <Clock className="h-4 w-4" />
                  <span>Ventas del Día</span>
                </TabsTrigger>
                <TabsTrigger value="deleted" className="flex items-center gap-2 py-3">
                  <Trash2 className="h-4 w-4" />
                  <span>Anuladas</span>
                </TabsTrigger>
              </TabsList>
              
              {filteredTransactions.length > 0 && (
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-2" />
                  {selectedIds.size === filteredTransactions.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </Button>
              )}
            </div>

            <TabsContent value={activeTab} className="space-y-3">
              {loading ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Cargando ventas...</p>
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 mx-auto mb-3 text-muted-foreground opacity-30" />
                  <p className="text-muted-foreground">
                    {searchTerm && globalSearchResults !== null
                      ? `No se encontraron ventas para "${searchTerm}" en ningún día`
                      : searchTerm 
                      ? 'No se encontraron resultados' 
                      : salesFilter === 'pos' 
                        ? `No hay ventas de cafetería para ${format(selectedDate, "dd/MM/yyyy", { locale: es })}` 
                        : salesFilter === 'lunch' 
                          ? `No hay ventas de almuerzos para ${format(selectedDate, "dd/MM/yyyy", { locale: es })}` 
                          : `No hay ventas para ${format(selectedDate, "dd/MM/yyyy", { locale: es })}`}
                  </p>
                  {transactions.length > 0 && filteredTransactions.length === 0 && globalSearchResults === null && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Hay {transactions.length} venta(s) en total. Prueba cambiando el filtro de tipo.
                    </p>
                  )}
                </div>
              ) : viewMode === 'grouped' ? (
                /* ──────────────────────────────────────────────────────
                   VISTA AGRUPADA POR ALUMNO
                   Un bloque por alumno, expandible con sus transacciones
                ─────────────────────────────────────────────────────── */
                <div className="space-y-2">
                  {studentGroups.map(group => {
                    const isOpen = expandedStudents.has(group.key);
                    return (
                      <div key={group.key} className="border rounded-xl overflow-hidden shadow-sm">
                        {/* ── Fila resumen del alumno ── */}
                        <button
                          onClick={() => toggleStudentRow(group.key)}
                          className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition text-left"
                        >
                          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                            <User className="h-4 w-4 text-amber-700" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{group.name}</p>
                            <p className="text-xs text-slate-500">
                              {group.txs.length} {group.txs.length === 1 ? 'transacción' : 'transacciones'}
                              {' · '}
                              {format(new Date(group.txs[group.txs.length - 1].created_at), "dd/MM/yyyy", { locale: es })}
                              {group.txs.length > 1 && ` al ${format(new Date(group.txs[0].created_at), "dd/MM/yyyy", { locale: es })}`}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg font-black text-emerald-700">S/ {group.total.toFixed(2)}</p>
                          </div>
                          <div className="text-slate-400 shrink-0">
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>
                        </button>

                        {/* ── Detalle expandido ── */}
                        {isOpen && (
                          <div className="divide-y bg-slate-50 border-t">
                            {group.txs.map(t => (
                              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white transition text-sm">
                                <div className="text-slate-400 font-mono text-xs w-28 shrink-0">
                                  {format(new Date(t.created_at), "dd/MM/yyyy HH:mm")}
                                </div>
                                <Badge variant="outline" className="font-mono text-xs shrink-0">
                                  {t.ticket_code || '—'}
                                </Badge>
                                {t.school && (
                                  <Badge variant="secondary" className="text-[10px] shrink-0">
                                    {t.school.name}
                                  </Badge>
                                )}
                                <span className="text-slate-500 text-xs truncate flex-1">
                                  {t.payment_method ? t.payment_method.charAt(0).toUpperCase() + t.payment_method.slice(1) : 'Efectivo'}
                                  {t.description ? ` · ${t.description}` : ''}
                                </span>
                                <span className="font-bold text-emerald-700 shrink-0">
                                  S/ {Math.abs(t.amount || 0).toFixed(2)}
                                </span>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700 shrink-0"
                                  onClick={() => {
                                    setSelectedTransaction(t);
                                    setShowDetails(true);
                                    fetchTransactionItems(t.id);
                                  }}
                                  title="Ver detalle completo"
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                                {/* Editar medio de pago — vista agrupada */}
                                {activeTab !== 'deleted' && t.payment_status !== 'cancelled' && !t.is_deleted && permissions.canEdit && (
                                  <Button
                                    size="sm" variant="ghost"
                                    className="h-6 w-6 p-0 text-amber-500 hover:text-amber-700 hover:bg-amber-50 shrink-0"
                                    onClick={() => handleOpenEditPayment(t)}
                                    title="Editar medio de pago"
                                  >
                                    <CreditCard className="h-3 w-3" />
                                  </Button>
                                )}
                                {/* Anular desde vista agrupada */}
                                {activeTab !== 'deleted' && t.payment_status !== 'cancelled' && !t.is_deleted && (
                                  <Button
                                    size="sm" variant="ghost"
                                    className="h-6 w-6 p-0 text-red-400 hover:text-red-700 hover:bg-red-50 shrink-0"
                                    onClick={() => handleOpenAnnul(t)}
                                    title="Anular venta"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            {/* Subtotal del alumno */}
                            <div className="flex justify-end px-4 py-2 bg-emerald-50">
                              <span className="text-xs text-emerald-700 font-semibold mr-2">Subtotal {group.name}:</span>
                              <span className="text-sm font-black text-emerald-800">S/ {group.total.toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ── VISTA PLANA (original) ── */
                <div className="grid grid-cols-1 gap-3">
                  {filteredTransactions.map((t) => (
                    <Card 
                      key={t.id} 
                      className={`hover:shadow-md transition-all border-l-4 ${
                        selectedIds.has(t.id) ? 'bg-blue-50 border-blue-500' : ''
                      }`}
                      style={{
                        borderLeftColor: t.payment_status === 'cancelled' ? '#ef4444' : '#10b981'
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedIds.has(t.id)}
                            onCheckedChange={() => toggleSelection(t.id)}
                          />
                          
                          <div className="flex-1">
                            {/* Primera línea: Ticket, Fecha y Hora - MÁS GRANDE */}
                            <div className="flex items-center gap-3 mb-3">
                              <Badge variant="outline" className="font-mono text-base font-black px-4 py-1.5 bg-slate-100 border-2">
                                📄 {t.ticket_code || '---'}
                              </Badge>
                              <span className="text-sm text-muted-foreground font-bold flex items-center gap-1.5">
                                <Clock className="h-4 w-4" />
                                {format(new Date(t.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                              </span>
                              {t.payment_status === 'cancelled' && (
                                <Badge variant="destructive" className="text-xs font-bold">ANULADA</Badge>
                              )}
                            </div>

                            {/* Segunda línea: Sede (MÁS VISIBLE) y Tipo de Documento */}
                            <div className="flex items-center gap-2 mb-2">
                              {t.school && (
                                <Badge 
                                  variant="default" 
                                  className="text-xs font-semibold flex items-center gap-1 bg-gradient-to-r from-blue-500 to-purple-500"
                                >
                                  <Building2 className="h-3.5 w-3.5" />
                                  {t.school.name}
                                </Badge>
                              )}
                              {t.document_type && t.document_type !== 'ticket' && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {t.document_type.toUpperCase()}
                                </Badge>
                              )}
                            </div>
                            
                            {/* Tercera línea: Cliente - MÁS GRANDE */}
                            <div className="flex items-center gap-2 mb-2">
                              <User className="h-5 w-5 text-emerald-600" />
                              <span className="text-base font-bold text-slate-900">
                                CLIENTE: {t.invoice_client_name || t.student?.full_name || t.teacher?.full_name || 'GENÉRICO'}
                              </span>
                            </div>
                            
                            {/* Cuarta línea: Cajero Responsable */}
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-300 text-amber-700">
                                👤 Cajero: {t.profiles?.full_name || t.profiles?.email || 'Sistema'}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <p className="text-2xl font-black text-emerald-600">
                              S/ {Math.abs(t.amount).toFixed(2)}
                            </p>
                            <div className="flex gap-1 mt-2">
                              {/* Botón Ver Detalles */}
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="h-8 gap-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                                onClick={() => handleViewDetails(t)}
                                title="Ver detalles de la venta"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>

                              {/* Botón SUNAT: Ver PDF si ya existe, Emitir si no */}
                              {(t.invoice_id || localPdfMap.has(t.id))
                                ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1 border-indigo-300 hover:bg-indigo-50 text-indigo-600"
                                    title="Ver PDF en Nubefact"
                                    onClick={async () => {
                                      const local = localPdfMap.get(t.id);
                                      if (local) { window.open(local, '_blank'); return; }
                                      // Buscar pdf_url en invoices
                                      const { data: inv } = await supabase
                                        .from('invoices').select('pdf_url').eq('id', t.invoice_id!).maybeSingle();
                                      if (inv?.pdf_url) window.open(inv.pdf_url, '_blank');
                                      else toast({ title: 'PDF no disponible', description: 'El comprobante fue emitido pero el PDF aún no está listo en Nubefact.' });
                                    }}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                )
                                : t.payment_status !== 'cancelled' && !t.is_deleted && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1 border-purple-300 hover:bg-purple-50 text-purple-700"
                                    title="Emitir comprobante electrónico SUNAT"
                                    onClick={() => setEmitirTarget({
                                      id:          t.id,
                                      amount:      t.amount,
                                      description: t.description,
                                      school_id:   t.school_id,
                                      ticket_code: t.ticket_code,
                                    })}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                  </Button>
                                )
                              }

                              {/* Botón Reimprimir */}
                              {permissions.canPrint && t.payment_status !== 'cancelled' && !t.is_deleted && (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="h-8 gap-1 border-emerald-200 hover:bg-emerald-50 text-emerald-700"
                                  onClick={() => handleReprint(t)}
                                  title="Reimprimir ticket"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                              )}

                              {t.payment_status !== 'cancelled' && (
                                <>
                                  {permissions.canEdit && (
                                    <>
                                      <Button 
                                        variant="ghost" 
                                        size="sm"
                                        className="h-8 w-8 p-0 hover:bg-blue-50"
                                        onClick={() => handleOpenEditClient(t)}
                                        title="Editar datos del cliente"
                                      >
                                        <Edit className="h-4 w-4 text-blue-600" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 hover:bg-amber-50"
                                        onClick={() => handleOpenEditPayment(t)}
                                        title="Editar medio de pago"
                                      >
                                        <CreditCard className="h-4 w-4 text-amber-600" />
                                      </Button>
                                    </>
                                  )}
                                  {/* Tachito: siempre visible */}
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-red-50"
                                    onClick={() => handleOpenAnnul(t)}
                                    title="Anular venta"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* ── Controles de paginación server-side ── */}
          {!loading && totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-sm text-slate-500">
                Mostrando{' '}
                <span className="font-semibold text-slate-700">
                  {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)}
                </span>{' '}
                de{' '}
                <span className="font-semibold text-slate-700">{totalCount}</span> ventas
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <span className="text-sm font-semibold text-slate-600 px-2">
                  Página {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="gap-1"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MODAL: Autorización de Admin para Cajeros */}
      <Dialog open={showPasswordValidation} onOpenChange={open => {
        if (!open) { setAdminEmail(''); setAdminPassword(''); setPendingAnnulTransaction(null); }
        setShowPasswordValidation(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Autorización de Administrador
            </DialogTitle>
            <DialogDescription>
              Para anular ventas necesitas que el administrador de tu sede ingrese sus credenciales.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Info de la venta a anular */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
              <p className="text-sm text-amber-800">
                <strong>Ticket:</strong> {pendingAnnulTransaction?.ticket_code}
              </p>
              <p className="text-sm text-amber-800">
                <strong>Monto:</strong> S/ {pendingAnnulTransaction ? Math.abs(pendingAnnulTransaction.amount).toFixed(2) : '0.00'}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                El administrador debe ingresar sus credenciales de acceso al portal.
              </p>
            </div>

            {/* Email del admin */}
            <div>
              <Label htmlFor="adminEmail" className="font-semibold">Correo del Administrador</Label>
              <Input
                id="adminEmail"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@colegio.com"
                autoFocus
                className="mt-1"
              />
            </div>

            {/* Contraseña del admin */}
            <div>
              <Label htmlFor="adminPassword" className="font-semibold">Contraseña del Administrador</Label>
              <Input
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && handleValidatePassword()}
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowPasswordValidation(false);
                setAdminEmail('');
                setAdminPassword('');
                setPendingAnnulTransaction(null);
              }}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleValidatePassword} 
              disabled={isProcessing || !adminPassword.trim() || !adminEmail.trim()}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isProcessing ? 'Verificando...' : '🔓 Autorizar Anulación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Editar Datos del Cliente */}
      <Dialog open={showEditClient} onOpenChange={setShowEditClient}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-blue-600" />
              Editar Datos del Cliente
            </DialogTitle>
            <DialogDescription>
              Ticket: {selectedTransaction?.ticket_code}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="docType">Tipo de Documento</Label>
              <Select value={editDocumentType} onValueChange={(v: any) => setEditDocumentType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticket">Ticket (Interno)</SelectItem>
                  <SelectItem value="boleta">Boleta Electrónica</SelectItem>
                  <SelectItem value="factura">Factura Electrónica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="clientName">Nombre del Cliente</Label>
              <Input
                id="clientName"
                value={editClientName}
                onChange={(e) => setEditClientName(e.target.value)}
                placeholder="Nombre completo o Razón Social"
              />
            </div>

            {editDocumentType === 'boleta' && (
              <div>
                <Label htmlFor="clientDNI">DNI (8 dígitos)</Label>
                <Input
                  id="clientDNI"
                  value={editClientDNI}
                  onChange={(e) => setEditClientDNI(e.target.value)}
                  placeholder="12345678"
                  maxLength={8}
                />
              </div>
            )}

            {editDocumentType === 'factura' && (
              <div>
                <Label htmlFor="clientRUC">RUC (11 dígitos)</Label>
                <Input
                  id="clientRUC"
                  value={editClientRUC}
                  onChange={(e) => setEditClientRUC(e.target.value)}
                  placeholder="20XXXXXXXXX"
                  maxLength={11}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditClient(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveClientData} disabled={isProcessing}>
              {isProcessing ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Editar Medio de Pago */}
      <Dialog open={showEditPayment} onOpenChange={setShowEditPayment}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-amber-600" />
              Editar Medio de Pago
            </DialogTitle>
            <DialogDescription>
              Ticket: {selectedTransaction?.ticket_code}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label>Nuevo medio de pago</Label>
            <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">💵 Efectivo</SelectItem>
                <SelectItem value="yape">📱 Yape</SelectItem>
                <SelectItem value="yape_qr">📱 Yape QR</SelectItem>
                <SelectItem value="yape_numero">📱 Yape Número</SelectItem>
                <SelectItem value="plin">📱 Plin</SelectItem>
                <SelectItem value="plin_qr">📱 Plin QR</SelectItem>
                <SelectItem value="tarjeta">💳 Tarjeta</SelectItem>
                <SelectItem value="transferencia">🏦 Transferencia</SelectItem>
                <SelectItem value="mixto">🔀 Mixto</SelectItem>
                <SelectItem value="saldo">🏦 Saldo (kiosco)</SelectItem>
              </SelectContent>
            </Select>
            {selectedTransaction?.payment_method && (
              <p className="text-xs text-muted-foreground">
                Actual: <span className="font-semibold">{selectedTransaction.payment_method.toUpperCase()}</span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditPayment(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSavePaymentMethod}
              disabled={isProcessing || !editPaymentMethod || editPaymentMethod === selectedTransaction?.payment_method}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isProcessing ? 'Guardando...' : 'Guardar Cambio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Anular Venta */}
      <Dialog open={showAnnul} onOpenChange={setShowAnnul}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Anular Venta
            </DialogTitle>
            <DialogDescription>
              <span className="block">Ticket: {selectedTransaction?.ticket_code}</span>
              {selectedTransaction?.student && (
                <span className="block mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-sm">
                  ⚠️ Se devolverá S/ {Math.abs(selectedTransaction.amount).toFixed(2)} a {selectedTransaction.student.full_name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3">
            <div>
              <Label htmlFor="reason">Motivo de Anulación *</Label>
              <Textarea
                id="reason"
                value={annulReason}
                onChange={(e) => setAnnulReason(e.target.value)}
                placeholder="Ej: Error en el pedido, producto incorrecto, cliente canceló..."
                rows={3}
              />
            </div>

            {selectedTransaction && isNonCashPayment(selectedTransaction.payment_method) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <Label className="text-amber-800 font-semibold text-sm">
                  💰 ¿Cómo se devolvió el dinero al cliente? *
                </Label>
                <p className="text-xs text-amber-600 mb-2">
                  El pago fue con <strong>{selectedTransaction.payment_method?.toUpperCase()}</strong>. Selecciona el método de devolución.
                </p>
                <select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="w-full border border-amber-300 rounded-md p-2 text-sm bg-white"
                >
                  <option value="">-- Seleccionar --</option>
                  <option value="mismo_medio">Se devolvió por el mismo medio ({selectedTransaction.payment_method})</option>
                  <option value="efectivo">Se devolvió en efectivo</option>
                  <option value="saldo_cuenta">Se acreditó al saldo del alumno</option>
                  <option value="no_devuelto">No se devolvió (producto no entregado)</option>
                  <option value="pendiente">Devolución pendiente</option>
                </select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAnnul(false); setRefundMethod(''); }}>
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleAnnulSale} 
              disabled={isProcessing || !annulReason.trim() || (isNonCashPayment(selectedTransaction?.payment_method) && !refundMethod)}
            >
              {isProcessing ? 'Anulando...' : 'Confirmar Anulación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Detalles de Venta (DISEÑO TICKET REAL) */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-[400px] p-0 bg-gray-100 overflow-hidden" aria-describedby={undefined}>
          <DialogHeader className="p-4 bg-white border-b">
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-600" />
              Vista de Comprobante
            </DialogTitle>
          </DialogHeader>
          
          <div className="p-6 overflow-y-auto max-h-[70vh]">
            {selectedTransaction && (
              <ThermalTicket
                ticketCode={selectedTransaction.ticket_code}
                date={new Date(selectedTransaction.created_at)}
                cashierEmail={selectedTransaction.profiles?.full_name || selectedTransaction.profiles?.email || 'Sistema'}
                clientName={selectedTransaction.invoice_client_name || selectedTransaction.student?.full_name || selectedTransaction.teacher?.full_name || 'CLIENTE GENÉRICO'}
                documentType={selectedTransaction.document_type || 'ticket'}
                items={transactionItems}
                total={Math.abs(selectedTransaction.amount)}
                clientDNI={selectedTransaction.invoice_client_dni_ruc}
                clientRUC={selectedTransaction.invoice_client_dni_ruc}
                isReprint={false}
                showOnScreen={true}
              />
            )}
          </div>

          <DialogFooter className="p-4 bg-white border-t flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowDetails(false)}>
              Cerrar
            </Button>
            <Button className="flex-1 gap-2" onClick={() => selectedTransaction && handleReprint(selectedTransaction)}>
              <Printer className="h-4 w-4" />
              Imprimir Real
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de emisión manual de comprobante SUNAT */}
      {emitirTarget && (
        <EmitirComprobanteModal
          open={!!emitirTarget}
          onClose={() => setEmitirTarget(null)}
          transaction={emitirTarget}
          onSuccess={(invoiceId, pdfUrl) => {
            // Actualizar la lista local sin recargar: marcar invoice_id en la transacción
            setTransactions(prev =>
              prev.map(t => t.id === emitirTarget.id ? { ...t, invoice_id: invoiceId } : t),
            );
            setLocalPdfMap(prev => {
              const next = new Map(prev);
              next.set(emitirTarget.id, pdfUrl);
              return next;
            });
            setEmitirTarget(null);
          }}
        />
      )}

      {/* TICKET TÉRMICO (Oculto, para impresión) */}
      {selectedTransaction && transactionItems.length > 0 && (
        <ThermalTicket
          ticketCode={selectedTransaction.ticket_code}
          date={new Date(selectedTransaction.created_at)}
          cashierEmail={selectedTransaction.profiles?.full_name || selectedTransaction.profiles?.email || 'Sistema'}
          clientName={selectedTransaction.invoice_client_name || selectedTransaction.student?.full_name || selectedTransaction.teacher?.full_name || 'CLIENTE GENÉRICO'}
          documentType={selectedTransaction.document_type || 'ticket'}
          items={transactionItems}
          total={Math.abs(selectedTransaction.amount)}
          clientDNI={selectedTransaction.invoice_client_dni_ruc}
          clientRUC={selectedTransaction.invoice_client_dni_ruc}
          isReprint={true}
        />
      )}
    </div>
  );
};
