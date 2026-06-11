import { useState, useEffect, useRef, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { getPaymentMethodLabel } from '@/lib/paymentMethodLabels';
import { isLunchTransaction } from '@/lib/lunchUtils';
import { buildInlineLabel } from '@/lib/transactionUtils';
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
  MoreVertical,
  FileX,
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
import { TransactionDetailModal, type TransactionDetailData } from '@/components/admin/TransactionDetailModal';

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

// ── FASE 1: Datos del comprobante original para armar el doc_ref de la NC ──────
interface InvoiceRef {
  id: string;
  serie: string;
  numero: number;
  document_type_code: string; // '01' = factura, '03' = boleta
}
// ── FASE 1: Datos de la Nota de Crédito ya emitida (si existe) ─────────────────
interface NcInfo {
  id: string;
  serie: string;
  numero: number;
  pdf_url: string | null;
  sunat_status: string;
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
  const fetchSummaryRequestId = useRef(0);
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
  const [summaryStats, setSummaryStats] = useState<{ totalSales: number; transactions: number }>({
    totalSales: 0,
    transactions: 0,
  });

  // Exportación: estado de carga independiente para no bloquear la lista
  const [isExporting, setIsExporting] = useState(false);
  
  // Selección múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modal de detalles
  const [showDetails, setShowDetails] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedTransactionDetail, setSelectedTransactionDetail] = useState<TransactionDetailData | null>(null);
  const [transactionItems, setTransactionItems] = useState<TransactionItem[]>([]);
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<string>>(new Set());
  // Nombre del usuario que anuló — se carga al abrir el detalle de una venta cancelada
  const [cancelledByName, setCancelledByName] = useState<string | null>(null);
  
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

  // ── FASE 1: Lookup por lote — comprobante original e NC existente ──────────────
  // Mapa: invoice_id → datos del comprobante original (serie, numero, tipo)
  const [invoiceRefMap, setInvoiceRefMap] = useState<Map<string, InvoiceRef>>(new Map());
  // Mapa: invoice_id original → NC ya emitida (si existe)
  const [ncExistsMap, setNcExistsMap] = useState<Map<string, NcInfo>>(new Map());
  // Modal para emitir Nota de Crédito
  const [showNcModal, setShowNcModal] = useState(false);
  const [ncTargetTransaction, setNcTargetTransaction] = useState<Transaction | null>(null);
  const [ncReason, setNcReason] = useState('');
  const [ncProcessing, setNcProcessing] = useState(false);
  // FASE 2: loading por fila para "Devolver Saldo al Alumno" (anti doble clic)
  const [operationalVoidLoadingIds, setOperationalVoidLoadingIds] = useState<Set<string>>(new Set());
  // Control del menú "..." avanzado (id de la transacción cuyo menú está abierto)
  const [openAdvancedMenuId, setOpenAdvancedMenuId] = useState<string | null>(null);

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

  // ── FASE 1: Cargar datos de comprobantes y NCs tras cada cambio de página/búsqueda ──
  useEffect(() => {
    let active = true;
    const visibleTxs = globalSearchResults !== null ? globalSearchResults : transactions;
    const runLookup = async () => {
      if (visibleTxs.length > 0) {
        await fetchNcDataForPage(visibleTxs, () => active);
      } else if (active) {
        setInvoiceRefMap(new Map());
        setNcExistsMap(new Map());
      }
    };
    void runLookup();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, globalSearchResults]);

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
      // Las ventas anuladas (payment_status='cancelled') se muestran inline
      // en "Ventas del Día" con badge rojo, en lugar de desaparecer.
      q = q.eq('is_deleted', false);
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
      } else if (selectedPaymentMethod === 'efectivo') {
        q = q.or('payment_method.eq.efectivo,payment_method.eq.cash,payment_method.eq.money,payment_method.eq.dinero');
      } else if (selectedPaymentMethod === 'tarjeta') {
        q = q.or('payment_method.eq.tarjeta,payment_method.eq.card,payment_method.eq.visa,payment_method.eq.mastercard');
      } else if (selectedPaymentMethod === 'transferencia') {
        q = q.or('payment_method.eq.transferencia,payment_method.eq.transfer');
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

  // ── FASE 1: Lookup por lote — comprobante original + NC ya emitida ───────────────
  // Solo lee datos desde `invoices`; no modifica saldos ni transacciones.
  const fetchNcDataForPage = async (
    txList: Transaction[],
    isActive: () => boolean = () => true,
  ) => {
    try {
      const sentInvoiceIds = [...new Set(
        txList
          // Blindaje almuerzos: este módulo no gestiona NC/extorno para lunch
          .filter(t => !isLunchTransaction(t) && t.billing_status === 'sent' && !!t.invoice_id)
          .map(t => t.invoice_id as string),
      )];
      if (sentInvoiceIds.length === 0) {
        if (!isActive()) return;
        setInvoiceRefMap(new Map());
        setNcExistsMap(new Map());
        return;
      }

      // Datos del comprobante original (para construir el doc_ref de la NC)
      const { data: invRows, error: invError } = await supabase
        .from('invoices')
        .select('id, serie, numero, document_type_code')
        .in('id', sentInvoiceIds);
      if (invError) throw invError;

      const refMap = new Map<string, InvoiceRef>();
      for (const row of invRows ?? []) {
        refMap.set(row.id, {
          id: row.id,
          serie: row.serie ?? '',
          numero: row.numero ?? 0,
          document_type_code: row.document_type_code ?? '03',
        });
      }

      // Notas de Crédito existentes (código '07') que referencian esos comprobantes
      const { data: ncRows, error: ncError } = await supabase
        .from('invoices')
        .select('id, serie, numero, pdf_url, sunat_status, original_invoice_id')
        .in('original_invoice_id', sentInvoiceIds)
        .eq('document_type_code', '07');
      if (ncError) throw ncError;

      const ncMap = new Map<string, NcInfo>();
      for (const row of ncRows ?? []) {
        if (row.original_invoice_id) {
          ncMap.set(row.original_invoice_id, {
            id: row.id,
            serie: row.serie ?? '',
            numero: row.numero ?? 0,
            pdf_url: row.pdf_url ?? null,
            sunat_status: row.sunat_status ?? 'pending',
          });
        }
      }

      if (!isActive()) return;
      setInvoiceRefMap(refMap);
      setNcExistsMap(ncMap);
    } catch (error: any) {
      console.error('[FASE1 NC] Error en lookup por lote:', error);
      if (!isActive()) return;
      setInvoiceRefMap(new Map());
      setNcExistsMap(new Map());
    }
  };

  const matchesPaymentMethodFilter = (method: string | null | undefined): boolean => {
    if (selectedPaymentMethod === 'all') return true;

    const m = (method || '').trim().toLowerCase();
    if (selectedPaymentMethod === 'yape') return ['yape', 'yape_qr', 'yape_numero'].includes(m);
    if (selectedPaymentMethod === 'plin') return ['plin', 'plin_qr', 'plin_numero'].includes(m);
    if (selectedPaymentMethod === 'efectivo') return ['efectivo', 'cash', 'money', 'dinero'].includes(m);
    if (selectedPaymentMethod === 'tarjeta') return ['tarjeta', 'card', 'visa', 'mastercard'].includes(m);
    if (selectedPaymentMethod === 'transferencia') return ['transferencia', 'transfer'].includes(m);
    return m === selectedPaymentMethod;
  };

  const matchesLocalFilters = (t: Transaction, shouldApplySearchTerm: boolean) => {
    if (salesFilter === 'pos' && isLunchTransaction(t)) return false;
    if (salesFilter === 'lunch' && !isLunchTransaction(t)) return false;

    if (personFilter === 'alumno' && !t.student_id) return false;
    if (personFilter === 'profesor' && !t.teacher_id) return false;
    if (!matchesPaymentMethodFilter(t.payment_method)) return false;

    if (!shouldApplySearchTerm || !searchTerm.trim()) return true;

    const search = searchTerm.toLowerCase();
    return (
      t.ticket_code?.toLowerCase().includes(search) ||
      t.student?.full_name?.toLowerCase().includes(search) ||
      t.teacher?.full_name?.toLowerCase().includes(search) ||
      t.invoice_client_name?.toLowerCase().includes(search) ||
      t.description?.toLowerCase().includes(search) ||
      Math.abs(t.amount || 0).toString().includes(search)
    );
  };

  const fetchSummaryStats = async () => {
    const currentRequestId = ++fetchSummaryRequestId.current;
    try {
      if (!permissions.canView || permissions.loading) return;
      if (!canViewAllSchools && !userSchoolId) return;

      // Si hay búsqueda global activa, ya tenemos el set completo en memoria.
      if (globalSearchResults !== null) {
        const filtered = globalSearchResults.filter((t) => matchesLocalFilters(t, false));
        const totalSales = filtered
          .filter((t) => !t.is_deleted && t.payment_status !== 'cancelled')
          .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
        if (currentRequestId === fetchSummaryRequestId.current) {
          setSummaryStats({ totalSales, transactions: filtered.length });
        }
        return;
      }

      const PAGE = 1000;
      let from = 0;
      let hasMore = true;
      let allData: Transaction[] = [];

      while (hasMore) {
        const { data, error } = await buildBaseQuery()
          .range(from, from + PAGE - 1) as any;
        if (error) throw error;

        allData = allData.concat((data ?? []) as Transaction[]);
        hasMore = (data?.length ?? 0) === PAGE;
        from += PAGE;
      }

      const filtered = allData.filter((t) => matchesLocalFilters(t, true));
      const totalSales = filtered
        .filter((t) => !t.is_deleted && t.payment_status !== 'cancelled')
        .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

      if (currentRequestId === fetchSummaryRequestId.current) {
        setSummaryStats({ totalSales, transactions: filtered.length });
      }
    } catch (error) {
      if (currentRequestId !== fetchSummaryRequestId.current) return;
      console.error('Error fetching summary stats:', error);
      setSummaryStats({ totalSales: 0, transactions: 0 });
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
    if (isLunchTransaction(transaction)) {
      toast({
        variant: 'destructive',
        title: 'Operación prohibida',
        description: 'Los almuerzos se gestionan desde el módulo administrativo de Cobranzas.',
      });
      return;
    }

    console.log('🗑️ Intentando anular venta:', {
      ticket: transaction.ticket_code,
      userRole: role,
      isCajero: role === 'cajero' || role === 'operador_caja'
    });

    // Bloqueo preventivo: comprobante electrónico ya enviado a SUNAT/Nubefact.
    // El trigger SUNAT_INTEGRITY en BD rechazaría el UPDATE de todas formas;
    // este aviso evita el modal vacío y el mensaje de error críptico.
    if (transaction.invoice_id && transaction.billing_status === 'sent') {
      toast({
        variant: 'destructive',
        title: 'Comprobante enviado a SUNAT',
        description: `El ticket ${transaction.ticket_code} tiene un comprobante electrónico emitido en Nubefact. Para anularlo debe emitirse una Nota de Crédito desde el módulo de facturación. La venta no fue modificada.`,
        duration: 9000,
      });
      return;
    }

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

  // Lee payment_status e is_deleted — no hace cálculos financieros.
  const isTransactionCancelled = (t: Transaction) =>
    t.payment_status === 'cancelled' || t.is_deleted === true;

  // Traduce errores de backend (SUNAT, RLS, red) a mensajes comprensibles para el cajero.
  const getAnnulErrorTitle = (error: any): string => {
    const msg: string = error?.message || error?.details || '';
    if (
      msg.includes('SUNAT_INTEGRITY') ||
      msg.includes('invoice_id') ||
      msg.includes('informada a la SUNAT')
    ) return 'No se puede anular desde aquí';
    if (msg.includes('42501') || msg.includes('permission') || msg.includes('policy'))
      return 'Sin permiso';
    return 'No se pudo anular la venta';
  };

  const getAnnulErrorDescription = (error: any): string => {
    const msg: string = error?.message || error?.details || '';
    if (
      msg.includes('SUNAT_INTEGRITY') ||
      msg.includes('invoice_id') ||
      msg.includes('informada a la SUNAT')
    ) {
      return 'El comprobante ya fue enviado a SUNAT/Nubefact. Debe anularse con una Nota de Crédito desde el módulo de facturación. La venta en caja NO fue modificada.';
    }
    if (msg.includes('42501') || msg.includes('permission') || msg.includes('policy'))
      return 'No tienes permiso para anular esta venta.';
    return `No se pudo anular la venta.${msg ? ` (${msg.slice(0, 140)})` : ''}`.trim();
  };

  // Refresca la lista paginada y, si hay búsqueda activa, también la caché globalSearchResults.
  // Necesario para que la tarjeta no quede congelada con datos viejos tras una anulación.
  const refreshSalesListAfterAnnul = async () => {
    await fetchTransactions();
    if (searchTerm.trim().length >= 3) {
      await fetchGlobalSearch(searchTerm);
    } else {
      setGlobalSearchResults(null);
    }
  };

  // ── FASE 1: Abrir modal de Nota de Crédito ────────────────────────────────────
  const handleOpenNcModal = (transaction: Transaction) => {
    if (isLunchTransaction(transaction)) {
      toast({
        variant: 'destructive',
        title: 'Operación prohibida',
        description: 'Los almuerzos se gestionan desde el módulo administrativo de Cobranzas.',
      });
      return;
    }

    setNcTargetTransaction(transaction);
    setNcReason('');
    setNcProcessing(false);
    setOpenAdvancedMenuId(null);
    setShowNcModal(true);
  };

  // ── FASE 1: Emitir Nota de Crédito vía Edge Function generate-document ─────────
  // Solo emite el documento fiscal en Nubefact y persiste en `invoices`.
  // NO modifica payment_status ni saldo del alumno (eso es FASE 2).
  const handleEmitNC = async () => {
    if (!ncTargetTransaction || ncReason.trim().length < 5) return;

    const invoiceRef = ncTargetTransaction.invoice_id
      ? invoiceRefMap.get(ncTargetTransaction.invoice_id)
      : null;

    if (!invoiceRef) {
      toast({
        variant: 'destructive',
        title: 'Sin comprobante vinculado',
        description: 'No se encontraron los datos del comprobante original. Recarga la página e intenta nuevamente.',
      });
      return;
    }

    // '01' factura → tipo NC = 8 y doc_ref.tipo = 1 (Nubefact)
    // '03' boleta  → tipo NC = 7 y doc_ref.tipo = 2 (Nubefact)
    const tipoNC     = invoiceRef.document_type_code === '01' ? 8 : 7;
    const tipoDocRef = invoiceRef.document_type_code === '01' ? 1 : 2;

    const clienteName = ncTargetTransaction.invoice_client_name
      || ncTargetTransaction.student?.full_name
      || ncTargetTransaction.teacher?.full_name
      || 'Consumidor Final';
    const clienteDni = ncTargetTransaction.invoice_client_dni_ruc ?? '';
    const docTypeStr = clienteDni.length === 11 ? 'ruc' : 'dni';

    setNcProcessing(true);
    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke('generate-document', {
        body: {
          school_id:           ncTargetTransaction.school_id ?? '',
          tipo:                tipoNC,
          transaction_id:      ncTargetTransaction.id,
          related_invoice_id:  invoiceRef.id,
          cancellation_reason: ncReason.trim(),
          payment_method:      'nc_pos_manual',
          monto_total:         Math.abs(ncTargetTransaction.amount),
          cliente: {
            doc_type:     clienteDni ? docTypeStr : '-',
            doc_number:   clienteDni || '-',
            razon_social: clienteName,
          },
          doc_ref: {
            tipo:   tipoDocRef,
            serie:  invoiceRef.serie,
            numero: invoiceRef.numero,
          },
        },
      });

      if (fnErr) throw new Error(fnErr.message || 'Error interno en la Edge Function');
      if (!result?.success) {
        const nubefactErr = Array.isArray(result?.nubefact?.errors)
          ? result.nubefact.errors.join(' | ')
          : (result?.error ?? 'Nubefact rechazó la Nota de Crédito');
        throw new Error(nubefactErr);
      }

      // Actualizar mapa local para reflejar la NC en la UI sin recargar la página
      const ncSerie  = result.documento?.serie ?? result.nubefact?.serie ?? '';
      const ncNumero = result.documento?.numero ?? result.nubefact?.numero ?? 0;
      const ncPdf    = result.documento?.enlace_pdf ?? result.nubefact?.enlace_del_pdf ?? null;
      const ncLabel  = ncSerie
        ? `${ncSerie}-${String(ncNumero).padStart(8, '0')}`
        : 'Nota de Crédito';

      if (ncTargetTransaction.invoice_id) {
        setNcExistsMap(prev => {
          const next = new Map(prev);
          next.set(ncTargetTransaction.invoice_id!, {
            id:           result.documento?.id ?? '',
            serie:        ncSerie,
            numero:       ncNumero,
            pdf_url:      ncPdf,
            sunat_status: result.sunat_status ?? 'pending',
          });
          return next;
        });
      }

      toast({
        title: `✅ Nota de Crédito emitida — ${ncLabel}`,
        description: ncPdf
          ? 'Documento listo en Nubefact. Luego podrás usar "Devolver Saldo al Alumno".'
          : 'NC generada. El PDF se procesará en Nubefact en los próximos minutos.',
        duration: 9000,
      });
      setShowNcModal(false);
      setNcReason('');
      setNcTargetTransaction(null);
    } catch (err: any) {
      console.error('[FASE1 NC] Error al emitir NC:', err);
      // Modal permanece abierto para que el cajero no pierda el motivo escrito
      toast({
        variant: 'destructive',
        title: 'Error al emitir Nota de Crédito',
        description: (err.message ?? 'Error desconocido').slice(0, 300),
        duration: 10000,
      });
    } finally {
      setNcProcessing(false);
    }
  };

  const handleExecuteOperationalVoid = async (transaction: Transaction) => {
    if (isLunchTransaction(transaction)) {
      toast({
        variant: 'destructive',
        title: 'Operación prohibida',
        description: 'Los almuerzos se gestionan desde el módulo administrativo de Cobranzas.',
      });
      return;
    }

    if (!user?.id) {
      toast({
        variant: 'destructive',
        title: 'Sesión inválida',
        description: 'No se pudo identificar el usuario autenticado.',
      });
      return;
    }

    if (operationalVoidLoadingIds.has(transaction.id)) return;

    const nc = transaction.invoice_id ? ncExistsMap.get(transaction.invoice_id) : null;
    const isAccepted = (nc?.sunat_status || '').toLowerCase() === 'accepted';
    if (!isAccepted) {
      toast({
        variant: 'destructive',
        title: 'Aún no disponible',
        description: 'Primero emite la Nota de Crédito y espera su aprobación.',
      });
      return;
    }

    setOpenAdvancedMenuId(null);
    setOperationalVoidLoadingIds(prev => {
      const next = new Set(prev);
      next.add(transaction.id);
      return next;
    });

    try {
      const { data, error } = await supabase.rpc('void_pos_sale_with_nc', {
        p_transaction_id: transaction.id,
        p_admin_id: user.id,
        p_reason: `Devolución de saldo al alumno desde Ventas (NC ${nc?.serie || ''}-${String(nc?.numero || 0).padStart(8, '0')})`,
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'La base de datos rechazó la devolución de saldo.');
      }

      setInvoiceRefMap(new Map());
      setNcExistsMap(new Map());
      await refreshSalesListAfterAnnul();

      const refunded = Number(data?.balance_refunded || 0);
      toast({
        title: '✅ Saldo devuelto al alumno',
        description: `Se devolvió S/ ${refunded.toFixed(2)} correctamente.`,
        duration: 9000,
      });
    } catch (err: any) {
      const msg = err?.message || err?.details || 'Error desconocido';
      toast({
        variant: 'destructive',
        title: 'No se pudo devolver el saldo',
        description: String(msg).slice(0, 220),
        duration: 10000,
      });
    } finally {
      setOperationalVoidLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(transaction.id);
        return next;
      });
    }
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
      // RPC atómico: anula la transacción + devuelve stock al inventario.
      // No toca students.balance ni sales.payment_method (por regla de negocio).
      const { data, error: rpcError } = await supabase.rpc('cancel_pos_sale', {
        p_transaction_id: selectedTransaction.id,
        p_admin_id:       user?.id,
        p_reason:         annulReason.trim(),
        p_refund_method:  refundMethod || null,
      });

      if (rpcError) throw rpcError;
      if (!data?.success) {
        throw new Error(data?.error || 'La base de datos rechazó la anulación.');
      }

      // Alerta operativa para admin_general (no financiera — sin cálculos de saldo)
      await supabase.from('cancellation_alerts').insert({
        school_id:           selectedTransaction.school_id,
        transaction_id:      selectedTransaction.id,
        alert_type:          'sale_cancelled',
        amount:              Math.abs(selectedTransaction.amount),
        payment_method:      selectedTransaction.payment_method,
        refund_method:       refundMethod || null,
        cancelled_by:        user?.id,
        cancellation_reason: annulReason.trim(),
        client_name:
          selectedTransaction.invoice_client_name ||
          selectedTransaction.student?.full_name ||
          selectedTransaction.teacher?.full_name ||
          'Cliente genérico',
        ticket_code: selectedTransaction.ticket_code,
      }).then(({ error }) => {
        if (error) console.error('⚠️ Error insertando alerta:', error);
      });

      // Aviso de acción manual: el operador es responsable de devolver el dinero.
      toast({
        title: '⚠️ Venta anulada',
        description:
          'Recuerde realizar la devolución del dinero o saldo al cliente de forma manual.',
      });

      registrarHuella(
        'ANULACION_VENTA_MANUAL',
        'VENTAS',
        {
          admin_id:          user?.id,
          transaccion_id:    selectedTransaction.id,
          ticket_code:       selectedTransaction.ticket_code ?? null,
          alumno_id:         selectedTransaction.student_id ?? null,
          alumno_nombre:     selectedTransaction.student?.full_name ?? null,
          motivo_anulacion:  annulReason.trim(),
          metodo_devolucion: refundMethod || null,
          items_restaurados: (data?.items_restored as number) ?? 0,
        },
        undefined,
        selectedTransaction.school_id ?? undefined
      );

      setShowAnnul(false);
      setRefundMethod('');
      await refreshSalesListAfterAnnul();
      // 'balances' refresca el POS (trg_transactions_balance_sync ya recalculó
      // la deuda pending; spending_limits también se actualiza por trigger).
      emitSync(['debtors', 'balances', 'spending_limits', 'dashboard']);
    } catch (error: any) {
      console.error('Error annulling sale:', error);
      toast({
        variant: 'destructive',
        title: getAnnulErrorTitle(error),
        description: getAnnulErrorDescription(error),
        duration: 8000,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== REIMPRIMIR TICKET ==========
  const handleViewDetails = async (transaction: Transaction) => {
    if (detailLoadingIds.has(transaction.id)) return;
    setDetailLoadingIds(prev => {
      const next = new Set(prev);
      next.add(transaction.id);
      return next;
    });

    try {
      setSelectedTransaction(transaction);
      setCancelledByName(null);

      const { data, error } = await supabase
        .from('v_transaction_detail_view')
        .select('detail_json')
        .eq('transaction_id', transaction.id)
        .maybeSingle();

      if (error) throw error;
      if (!data?.detail_json) {
        throw new Error('No se pudo cargar el detalle de la venta.');
      }

      setSelectedTransactionDetail(data.detail_json as TransactionDetailData);

      // Si la venta está anulada, resolver el nombre del usuario que la anuló
      const cancelledById = transaction.metadata?.cancelled_by;
      if ((transaction.payment_status === 'cancelled' || transaction.is_deleted) && cancelledById) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', cancelledById)
          .maybeSingle();
        setCancelledByName(prof?.full_name || prof?.email || cancelledById);
      }

      setShowDetails(true);
    } catch (error: any) {
      console.error('Error cargando detalle optimizado:', error);
      toast({
        variant: 'destructive',
        title: 'No se pudo abrir el detalle',
        description: (error?.message || 'Intenta nuevamente en unos segundos.').slice(0, 180),
      });
    } finally {
      setDetailLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(transaction.id);
        return next;
      });
    }
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

  // isLunchTransaction importado desde @/lib/lunchUtils (fuente única de verdad).

  // buildInlineLabel importado desde @/lib/transactionUtils (función pura, fuera del componente).

  // Búsqueda inteligente — si hay resultados globales los usa, si no usa los del día.
  // useMemo: evita re-filtrar 394+ items en cada render no relacionado.
  const baseTransactions = globalSearchResults !== null ? globalSearchResults : transactions;
  const filteredTransactions = useMemo(() => baseTransactions.filter(t => {
    return matchesLocalFilters(t, globalSearchResults === null);
  }), [baseTransactions, salesFilter, personFilter, globalSearchResults, searchTerm]);

  const getTotalSales = () => {
    return summaryStats.totalSales;
  };

  useEffect(() => {
    fetchSummaryStats();
  }, [
    activeTab,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
    opNumberSearch,
    selectedPaymentMethod,
    selectedSchool,
    userSchoolId,
    salesFilter,
    personFilter,
    searchTerm,
    globalSearchResults,
    permissions.loading,
    permissions.canView,
  ]);

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
      const metodo     = getPaymentMethodLabel(t.payment_method);

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

  // ── Exportar PDF de Detalle de Consumo (respeta todos los filtros activos) ──
  const downloadConsumptionPDF = async () => {
    setIsExporting(true);
    let allData: Transaction[];
    try {
      allData = await fetchAllForExport();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al exportar', description: err.message });
      setIsExporting(false);
      return;
    }

    // Aplicar los mismos filtros del front-end
    const filtered = allData.filter(t => {
      if (salesFilter === 'pos'   && isLunchTransaction(t))  return false;
      if (salesFilter === 'lunch' && !isLunchTransaction(t)) return false;
      if (personFilter === 'alumno'   && !t.student_id)  return false;
      if (personFilter === 'profesor' && !t.teacher_id)  return false;
      if (selectedPaymentMethod !== 'all' && t.payment_method !== selectedPaymentMethod) return false;
      if (searchTerm.trim()) {
        const search = searchTerm.toLowerCase();
        return (
          t.ticket_code?.toLowerCase().includes(search) ||
          t.student?.full_name?.toLowerCase().includes(search) ||
          t.teacher?.full_name?.toLowerCase().includes(search) ||
          t.invoice_client_name?.toLowerCase().includes(search) ||
          t.description?.toLowerCase().includes(search) ||
          Math.abs(t.amount).toString().includes(search)
        );
      }
      return true;
    });

    setIsExporting(false);

    if (filtered.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay ventas con los filtros actuales para exportar.' });
      return;
    }

    // Batch-fetch de todos los items de las transacciones filtradas
    const txIds = filtered.map(t => t.id);
    const itemsMap: Record<string, TransactionItem[]> = {};
    try {
      const BATCH = 200;
      for (let i = 0; i < txIds.length; i += BATCH) {
        const batchIds = txIds.slice(i, i + BATCH);
        const { data: items } = await supabase
          .from('transaction_items')
          .select('id, transaction_id, product_name, quantity, unit_price, subtotal')
          .in('transaction_id', batchIds);
        (items || []).forEach((item: any) => {
          if (!itemsMap[item.transaction_id]) itemsMap[item.transaction_id] = [];
          itemsMap[item.transaction_id].push(item);
        });
      }
    } catch { /* sin items no bloqueamos la exportación */ }

    // Agrupar por persona
    const groups: Record<string, { key: string; name: string; txs: Transaction[]; total: number }> = {};
    filtered.forEach(t => {
      const name = t.student?.full_name || t.teacher?.full_name || t.invoice_client_name || 'Venta General';
      const key  = t.student_id || t.teacher_id || t.invoice_client_name || 'generic';
      if (!groups[key]) groups[key] = { key, name, txs: [], total: 0 };
      groups[key].txs.push(t);
      groups[key].total += Math.abs(t.amount || 0);
    });
    const groupList = Object.values(groups).sort((a, b) => b.total - a.total);
    const grandTotal = filtered.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const rangeLabel = dateFrom.toDateString() === dateTo.toDateString()
      ? format(dateFrom, "dd/MM/yyyy")
      : `${format(dateFrom, "dd/MM/yyyy")} — ${format(dateTo, "dd/MM/yyyy")}`;

    const sedeLabel = !canViewAllSchools && userSchoolId
      ? (schools.find(s => s.id === userSchoolId)?.name ?? 'Mi Sede')
      : selectedSchool === 'all' ? 'Todas las Sedes'
      : (schools.find(s => s.id === selectedSchool)?.name ?? selectedSchool);

    // ── Encabezado ──
    doc.setFillColor(139, 69, 19);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('LIMA CAFE', 14, 12);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Reporte de Detalle de Consumo', 14, 19);
    doc.text(rangeLabel, 196, 12, { align: 'right' });
    doc.text(`Sede: ${sedeLabel}`, 196, 19, { align: 'right' });

    // ── Filtros aplicados ──
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(8);
    let yInfo = 37;
    doc.setFont('helvetica', 'bold');
    doc.text('Filtros aplicados:', 14, yInfo);
    doc.setFont('helvetica', 'normal');
    yInfo += 5;
    const filterParts: string[] = [];
    filterParts.push(`Período: ${rangeLabel}`);
    if (selectedPaymentMethod !== 'all') filterParts.push(`Medio de pago: ${getPaymentMethodLabel(selectedPaymentMethod)}`);
    if (salesFilter !== 'all') filterParts.push(`Tipo: ${salesFilter === 'pos' ? 'Cafetería' : 'Almuerzos'}`);
    if (personFilter !== 'all') filterParts.push(`Persona: ${personFilter === 'alumno' ? 'Alumno' : 'Profesor'}`);
    if (searchTerm.trim()) filterParts.push(`Búsqueda: "${searchTerm}"`);
    doc.text(filterParts.join('   |   '), 14, yInfo);
    yInfo += 5;
    doc.setFont('helvetica', 'bold');
    doc.text(`Total transacciones: ${filtered.length}   |   Total ventas: S/ ${grandTotal.toFixed(2)}`, 14, yInfo);
    yInfo += 4;

    // ── Tablas por alumno ──
    groupList.forEach((group, gIdx) => {
      // Nombre del alumno como encabezado de sección
      const sectionY = (doc as any).lastAutoTable?.finalY
        ? (doc as any).lastAutoTable.finalY + (gIdx === 0 ? 4 : 8)
        : yInfo + 4;

      doc.setFillColor(245, 230, 210);
      doc.rect(14, sectionY - 1, 182, 7, 'F');
      doc.setTextColor(100, 40, 5);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`${group.name}  —  ${group.txs.length} transacciones  —  Total: S/ ${group.total.toFixed(2)}`, 16, sectionY + 4);
      doc.setTextColor(50, 50, 50);

      // Filas de detalle
      const rows: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
      group.txs.forEach(t => {
        const isPending = t.payment_status === 'pending';
        const items = itemsMap[t.id] || [];
        const payLabel = getPaymentMethodLabel(t.payment_method);
        const statusLabel = isPending ? ' ⚠ CRÉDITO' : '';

        if (items.length > 0) {
          items.forEach((item, iIdx) => {
            rows.push([
              iIdx === 0 ? format(new Date(t.created_at), 'dd/MM HH:mm') : '',
              iIdx === 0 ? (t.ticket_code || '—') : '',
              iIdx === 0 ? `${payLabel}${statusLabel}` : '',
              item.product_name,
              item.quantity.toString(),
              `S/ ${Number(item.unit_price).toFixed(2)}`,
              `S/ ${Number(item.subtotal).toFixed(2)}`,
            ]);
          });
          rows.push([
            { content: '', styles: { fillColor: [245, 245, 245] } },
            { content: '', styles: { fillColor: [245, 245, 245] } },
            { content: '', styles: { fillColor: [245, 245, 245] } },
            { content: '', styles: { fillColor: [245, 245, 245] } },
            { content: '', styles: { fillColor: [245, 245, 245] } },
            { content: 'Total:', styles: { fontStyle: 'bold', halign: 'right', fillColor: [245, 245, 245] } },
            { content: `S/ ${Math.abs(t.amount || 0).toFixed(2)}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [245, 245, 245] } },
          ]);
        } else {
          rows.push([
            format(new Date(t.created_at), 'dd/MM HH:mm'),
            t.ticket_code || '—',
            `${payLabel}${statusLabel}`,
            t.description || '—',
            '1',
            `S/ ${Math.abs(t.amount || 0).toFixed(2)}`,
            `S/ ${Math.abs(t.amount || 0).toFixed(2)}`,
          ]);
        }
      });

      autoTable(doc, {
        startY: sectionY + 8,
        head: [['Fecha/Hora', 'Ticket', 'Pago', 'Producto', 'Cant.', 'P. Unit.', 'Subtotal']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [180, 100, 30], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 20 },
          2: { cellWidth: 28 },
          3: { cellWidth: 'auto' },
          4: { cellWidth: 12, halign: 'center' },
          5: { cellWidth: 18, halign: 'right' },
          6: { cellWidth: 20, halign: 'right' },
        },
        didDrawCell: (data) => {
          // Resaltar en amarillo las filas con crédito/pendiente
          if (data.section === 'body' && data.column.index === 2) {
            const cellText = typeof data.cell.raw === 'string' ? data.cell.raw : '';
            if (cellText.includes('CRÉDITO')) {
              doc.setFillColor(255, 243, 205);
              doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
              doc.setTextColor(180, 100, 0);
              doc.setFontSize(7);
              doc.text(cellText, data.cell.x + 1, data.cell.y + data.cell.height / 2 + 1);
            }
          }
        },
      });
    });

    // ── Total general ──
    const finalY = (doc as any).lastAutoTable?.finalY || 260;
    doc.setFillColor(139, 69, 19);
    doc.rect(14, finalY + 4, 182, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL GENERAL', 16, finalY + 11);
    doc.text(`S/ ${grandTotal.toFixed(2)}`, 193, finalY + 11, { align: 'right' });

    // ── Pie de página ──
    doc.setDrawColor(200, 150, 100);
    doc.setLineWidth(0.4);
    doc.line(14, finalY + 18, 196, finalY + 18);
    doc.setFontSize(7.5);
    doc.setTextColor(130);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')} — Este documento es un comprobante interno. No tiene validez tributaria.`, 105, finalY + 23, { align: 'center' });

    const studentSuffix = searchTerm.trim() ? `_${searchTerm.replace(/\s+/g, '_').toLowerCase()}` : '';
    doc.save(`detalle_consumo${studentSuffix}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    toast({ title: '✅ PDF generado', description: `Detalle de consumo con ${filtered.length} transacciones exportado correctamente.` });
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

              {permissions.canExport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadConsumptionPDF}
                  disabled={isExporting}
                  className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 hover:border-rose-500"
                  title="Exportar PDF con detalle de productos, respeta todos los filtros activos"
                >
                  <FileDown className="h-4 w-4" />
                  {isExporting ? 'Generando...' : 'Exportar PDF Detalle'}
                </Button>
              )}
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
                    <p className="text-2xl font-black text-blue-900">{summaryStats.transactions}</p>
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
                      S/ {summaryStats.transactions > 0 ? (getTotalSales() / summaryStats.transactions).toFixed(2) : '0.00'}
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
                              <div
                                key={t.id}
                                className={`flex items-center gap-3 px-4 py-2.5 hover:bg-white transition text-sm ${isTransactionCancelled(t) ? 'opacity-60 bg-red-50' : ''}`}
                              >
                                <div className="text-slate-400 font-mono text-xs w-28 shrink-0">
                                  {format(new Date(t.created_at), "dd/MM/yyyy HH:mm")}
                                </div>
                                <Badge variant="outline" className="font-mono text-xs shrink-0">
                                  {t.ticket_code || '—'}
                                </Badge>
                                {isTransactionCancelled(t) && (
                                  <Badge variant="destructive" className="text-[10px] shrink-0 font-bold">⚠️ ANULADO</Badge>
                                )}
                                {t.school && (
                                  <Badge variant="secondary" className="text-[10px] shrink-0">
                                    {t.school.name}
                                  </Badge>
                                )}
                                <span
                                  className={`text-xs truncate flex-1 ${isTransactionCancelled(t) ? 'text-slate-400 line-through decoration-slate-400' : 'text-slate-500'}`}
                                  title={t.description || ''}
                                >
                                  {buildInlineLabel(t)}
                                </span>
                                <span className={`font-bold shrink-0 ${isTransactionCancelled(t) ? 'text-slate-400 line-through decoration-slate-400' : 'text-emerald-700'}`}>
                                  S/ {Math.abs(t.amount || 0).toFixed(2)}
                                </span>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700 shrink-0"
                                  onClick={() => handleViewDetails(t)}
                                  disabled={detailLoadingIds.has(t.id)}
                                  title="Ver detalle completo"
                                >
                                  <Eye className={`h-3 w-3 ${detailLoadingIds.has(t.id) ? 'animate-pulse' : ''}`} />
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
                                {/* Anular desde vista agrupada — solo kiosco/venta directa, NO almuerzos ni ventas ya enviadas a SUNAT */}
                                {activeTab !== 'deleted' && t.payment_status !== 'cancelled' && !t.is_deleted && !isLunchTransaction(t) && t.billing_status !== 'sent' && (
                                  <Button
                                    size="sm" variant="ghost"
                                    className="h-6 w-6 p-0 text-red-400 hover:text-red-700 hover:bg-red-50 shrink-0"
                                    onClick={() => handleOpenAnnul(t)}
                                    title="Anular venta"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                                {/* FASE 1.5/2 — Menú avanzado SUNAT (vista agrupada, excluye almuerzos) */}
                                {activeTab !== 'deleted' && t.payment_status !== 'cancelled' && !t.is_deleted && !isLunchTransaction(t) && t.billing_status === 'sent' && (
                                  <Popover
                                    open={openAdvancedMenuId === t.id}
                                    onOpenChange={open => setOpenAdvancedMenuId(open ? t.id : null)}
                                  >
                                    <PopoverTrigger asChild>
                                      <Button
                                        size="sm" variant="ghost"
                                        className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700 shrink-0"
                                        title="Opciones avanzadas SUNAT"
                                      >
                                        <MoreVertical className="h-3 w-3" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-2" align="end">
                                      <p className="text-[10px] font-semibold text-slate-500 px-2 pb-1 uppercase tracking-wide">Opciones SUNAT</p>
                                      {!t.invoice_id && (
                                        <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-200 px-3 py-2">
                                          <AlertTriangle className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                                          <p className="text-[11px] text-orange-800 font-medium">⚠️ Comprobante sin vínculo local. Saneo requerido.</p>
                                        </div>
                                      )}
                                      {t.invoice_id && ncExistsMap.has(t.invoice_id) && (() => {
                                        const nc = ncExistsMap.get(t.invoice_id)!;
                                        const ncLabel = nc.serie ? `${nc.serie}-${String(nc.numero).padStart(8, '0')}` : 'NC emitida';
                                        return (
                                          <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                                            <FileCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                            <div>
                                              <p className="text-[11px] font-bold text-green-800">NC emitida: {ncLabel}</p>
                                              {nc.pdf_url && (
                                                <button
                                                  className="text-[10px] text-green-700 underline"
                                                  onClick={() => { window.open(nc.pdf_url!, '_blank'); setOpenAdvancedMenuId(null); }}
                                                >
                                                  Ver PDF
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })()}
                                      {t.invoice_id && !ncExistsMap.has(t.invoice_id) && (
                                        <Button
                                          variant="ghost" size="sm"
                                          className="w-full h-8 justify-start gap-2 text-xs hover:bg-red-50 hover:text-red-700"
                                          onClick={() => handleOpenNcModal(t)}
                                        >
                                          <FileX className="h-3.5 w-3.5 text-red-500" />
                                          Emitir Nota de Crédito
                                        </Button>
                                      )}
                                      {t.invoice_id && (() => {
                                        const nc = ncExistsMap.get(t.invoice_id);
                                        const canReturn = (nc?.sunat_status || '').toLowerCase() === 'accepted';
                                        const isLoading = operationalVoidLoadingIds.has(t.id);
                                        return (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full h-8 justify-start gap-2 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                                            onClick={() => handleExecuteOperationalVoid(t)}
                                            disabled={!canReturn || isLoading}
                                            title={!canReturn ? 'Primero emite la Nota de Crédito y espera su aprobación' : 'Devuelve el saldo al alumno'}
                                          >
                                            <CreditCard className="h-3.5 w-3.5" />
                                            {isLoading ? 'Procesando...' : 'Devolver Saldo al Alumno'}
                                          </Button>
                                        );
                                      })()}
                                    </PopoverContent>
                                  </Popover>
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
                        selectedIds.has(t.id) ? 'bg-blue-50 border-blue-500' :
                        isTransactionCancelled(t) ? 'bg-red-50/40' : ''
                      }`}
                      style={{
                        borderLeftColor: isTransactionCancelled(t) ? '#ef4444' : '#10b981'
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
                              {isTransactionCancelled(t) && (
                                <Badge variant="destructive" className="text-sm font-bold px-3 py-1">⚠️ ANULADO</Badge>
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
                              <span className={`text-base font-bold ${isTransactionCancelled(t) ? 'text-slate-400 line-through decoration-slate-400' : 'text-slate-900'}`}>
                                CLIENTE: {t.invoice_client_name || t.student?.full_name || t.teacher?.full_name || 'GENÉRICO'}
                              </span>
                            </div>
                            
                            {/* Cuarta línea: Cajero Responsable */}
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-300 text-amber-700">
                                👤 Cajero: {t.profiles?.full_name || t.profiles?.email || 'Sistema'}
                              </Badge>
                            </div>

                            {/* FASE 1 — Banda de alerta: NC emitida ante SUNAT, devolución de saldo pendiente */}
                            {t.invoice_id && ncExistsMap.has(t.invoice_id) && (
                              <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-1.5">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                <span className="text-[11px] font-semibold text-amber-800">
                                  Documento fiscal anulado ante SUNAT. Pendiente devolución de saldo al alumno.
                                </span>
                              </div>
                            )}
                          </div>
                          
                          <div className="text-right">
                            <p className={`text-2xl font-black ${isTransactionCancelled(t) ? 'text-slate-400 line-through decoration-slate-400' : 'text-emerald-600'}`}>
                              S/ {Math.abs(t.amount).toFixed(2)}
                            </p>
                            <div className="flex gap-1 mt-2">
                              {/* Botón Ver Detalles */}
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="h-8 gap-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                                onClick={() => handleViewDetails(t)}
                                disabled={detailLoadingIds.has(t.id)}
                                title="Ver detalles de la venta"
                              >
                                <Eye className={`h-3.5 w-3.5 ${detailLoadingIds.has(t.id) ? 'animate-pulse' : ''}`} />
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
                                  {/* Anular: oculto para almuerzos y para ventas ya enviadas a SUNAT */}
                                  {!isLunchTransaction(t) && t.billing_status !== 'sent' && (
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      className="h-8 w-8 p-0 hover:bg-red-50"
                                      onClick={() => handleOpenAnnul(t)}
                                      title="Anular venta"
                                    >
                                      <Trash2 className="h-4 w-4 text-red-600" />
                                    </Button>
                                  )}
                                  {/* FASE 1.5/2 — Menú avanzado para ventas enviadas a SUNAT (excluye almuerzos) */}
                                  {!isLunchTransaction(t) && t.billing_status === 'sent' && (
                                    <Popover
                                      open={openAdvancedMenuId === t.id}
                                      onOpenChange={open => setOpenAdvancedMenuId(open ? t.id : null)}
                                    >
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 hover:bg-slate-100"
                                          title="Opciones avanzadas SUNAT"
                                        >
                                          <MoreVertical className="h-4 w-4 text-slate-600" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-72 p-2" align="end">
                                        <p className="text-[10px] font-semibold text-slate-500 px-2 pb-1 uppercase tracking-wide">
                                          Opciones SUNAT
                                        </p>
                                        {/* Caso huérfano: billing_status sent pero sin invoice_id local */}
                                        {!t.invoice_id && (
                                          <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-200 px-3 py-2">
                                            <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                                            <p className="text-[11px] text-orange-800 font-medium">
                                              ⚠️ Comprobante sin vínculo local. Saneo administrativo requerido.
                                            </p>
                                          </div>
                                        )}
                                        {/* NC ya emitida — mostrar datos y deshabilitar reemisión */}
                                        {t.invoice_id && ncExistsMap.has(t.invoice_id) && (() => {
                                          const nc = ncExistsMap.get(t.invoice_id)!;
                                          const ncLabel = nc.serie
                                            ? `${nc.serie}-${String(nc.numero).padStart(8, '0')}`
                                            : 'NC emitida';
                                          return (
                                            <div className="space-y-1.5 p-1">
                                              <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                                                <FileCheck className="h-4 w-4 text-green-600 shrink-0" />
                                                <div>
                                                  <p className="text-[11px] font-bold text-green-800">NC ya emitida: {ncLabel}</p>
                                                  <p className="text-[10px] text-green-700">Estado: {nc.sunat_status}</p>
                                                </div>
                                              </div>
                                              {nc.pdf_url && (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="w-full h-7 text-[11px] border-green-300 text-green-700 hover:bg-green-50"
                                                  onClick={() => { window.open(nc.pdf_url!, '_blank'); setOpenAdvancedMenuId(null); }}
                                                >
                                                  <ExternalLink className="h-3 w-3 mr-1" />
                                                  Ver PDF Nota de Crédito
                                                </Button>
                                              )}
                                              <p className="text-[10px] text-slate-500 px-1">
                                                Para continuar, usa la opción "Devolver Saldo al Alumno".
                                              </p>
                                            </div>
                                          );
                                        })()}
                                        {/* NC no emitida — ofrecer el botón de emisión */}
                                        {t.invoice_id && !ncExistsMap.has(t.invoice_id) && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="w-full h-9 justify-start gap-2 text-sm hover:bg-red-50 hover:text-red-700"
                                            onClick={() => handleOpenNcModal(t)}
                                          >
                                            <FileX className="h-4 w-4 text-red-500" />
                                            Emitir Nota de Crédito
                                          </Button>
                                        )}
                                        {t.invoice_id && (() => {
                                          const nc = ncExistsMap.get(t.invoice_id);
                                          const canReturn = (nc?.sunat_status || '').toLowerCase() === 'accepted';
                                          const isLoading = operationalVoidLoadingIds.has(t.id);
                                          return (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="w-full h-8 justify-start gap-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                                              onClick={() => handleExecuteOperationalVoid(t)}
                                              disabled={!canReturn || isLoading}
                                              title={!canReturn ? 'Primero emite la Nota de Crédito y espera su aprobación' : 'Devuelve el saldo al alumno'}
                                            >
                                              <CreditCard className="h-3.5 w-3.5" />
                                              {isLoading ? 'Procesando...' : 'Devolver Saldo al Alumno'}
                                            </Button>
                                          );
                                        })()}
                                      </PopoverContent>
                                    </Popover>
                                  )}
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

      {/* MODAL: Detalle profesional de venta (sin preview térmica) */}
      <TransactionDetailModal
        open={showDetails}
        onOpenChange={(open) => {
          setShowDetails(open);
          if (!open) setSelectedTransactionDetail(null);
        }}
        detail={selectedTransactionDetail}
        isCancelled={!!selectedTransaction && isTransactionCancelled(selectedTransaction)}
        cancelledBy={cancelledByName || selectedTransaction?.metadata?.cancelled_by || null}
        cancelledAt={selectedTransaction?.metadata?.cancelled_at || null}
        cancellationReason={selectedTransaction?.metadata?.cancellation_reason || null}
        refundMethod={selectedTransaction?.metadata?.refund_method || null}
        onPrint={() => selectedTransaction && handleReprint(selectedTransaction)}
      />

      {/* ── FASE 1: Modal para emitir Nota de Crédito ────────────────────────────── */}
      <Dialog
        open={showNcModal}
        onOpenChange={open => {
          // Si está procesando, no permitir cerrar para evitar estados inconsistentes
          if (ncProcessing) return;
          if (!open) {
            setShowNcModal(false);
            setNcReason('');
            setNcTargetTransaction(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <FileX className="h-5 w-5" />
              Emitir Nota de Crédito
            </DialogTitle>
            <DialogDescription>
              Este proceso emite una Nota de Crédito ante la SUNAT para anular
              fiscalmente el comprobante. <strong>No devuelve el saldo al alumno</strong> ni
              cambia el estado de la venta — eso se ejecutará en el paso "Devolver Saldo al Alumno".
            </DialogDescription>
          </DialogHeader>

          {ncTargetTransaction && (
            <div className="space-y-4">
              {/* Resumen de la venta a anular fiscalmente */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Ticket:</span>
                  <span className="font-bold font-mono">{ncTargetTransaction.ticket_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Monto:</span>
                  <span className="font-bold text-emerald-700">
                    S/ {Math.abs(ncTargetTransaction.amount).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Cliente:</span>
                  <span className="font-semibold text-right max-w-[200px] truncate">
                    {ncTargetTransaction.invoice_client_name
                      || ncTargetTransaction.student?.full_name
                      || 'Consumidor Final'}
                  </span>
                </div>
                {ncTargetTransaction.invoice_id && invoiceRefMap.get(ncTargetTransaction.invoice_id) && (() => {
                  const ref = invoiceRefMap.get(ncTargetTransaction.invoice_id)!;
                  const label = ref.serie
                    ? `${ref.serie}-${String(ref.numero).padStart(8, '0')}`
                    : '—';
                  return (
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-medium">Comprobante:</span>
                      <span className="font-bold font-mono text-indigo-700">{label}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Campo de motivo — obligatorio, mínimo 5 caracteres */}
              <div className="space-y-1.5">
                <Label htmlFor="nc-reason" className="font-semibold">
                  Motivo de la Nota de Crédito <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="nc-reason"
                  placeholder="Ej: Error en precio, devolución acordada con el cliente…"
                  rows={3}
                  value={ncReason}
                  onChange={e => setNcReason(e.target.value)}
                  disabled={ncProcessing}
                  className={ncReason.trim().length > 0 && ncReason.trim().length < 5 ? 'border-red-400' : ''}
                />
                {ncReason.trim().length > 0 && ncReason.trim().length < 5 && (
                  <p className="text-xs text-red-600">El motivo debe tener al menos 5 caracteres.</p>
                )}
              </div>

              {/* Aviso sobre lo que NO hace esta operación */}
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800">
                  <strong>Importante:</strong> Esta operación solo cancela el documento fiscal ante
                  la SUNAT. El saldo del alumno y el estado de la venta no se modifican en este paso.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (ncProcessing) return;
                setShowNcModal(false);
                setNcReason('');
                setNcTargetTransaction(null);
              }}
              disabled={ncProcessing}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleEmitNC}
              disabled={ncProcessing || ncReason.trim().length < 5}
            >
              {ncProcessing ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Emitiendo en Nubefact…
                </>
              ) : (
                <>
                  <FileX className="h-4 w-4 mr-2" />
                  Emitir Nota de Crédito
                </>
              )}
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
