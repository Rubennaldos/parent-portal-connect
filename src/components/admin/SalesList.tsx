import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
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
  Building2,
  Filter
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
  client_name?: string;
  client_dni?: string;
  client_ruc?: string;
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
    balance: number;
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

export const SalesList = () => {
  const { user } = useAuth();
  const { role, canViewAllSchools: canViewAllSchoolsFromHook } = useRole();
  const { toast } = useToast();
  
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
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Filtro de tipo de venta (POS, Almuerzos, Todas)
  const [salesFilter, setSalesFilter] = useState<'all' | 'pos' | 'lunch'>('all');
  
  // Filtro de sedes
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const canViewAllSchools = canViewAllSchoolsFromHook; // ✅ Usar desde el hook
  
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
  
  // Modal de anular venta
  const [showAnnul, setShowAnnul] = useState(false);
  const [annulReason, setAnnulReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Validación de contraseña para cajeros
  const [showPasswordValidation, setShowPasswordValidation] = useState(false);
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

  useEffect(() => {
    if (!permissions.loading && permissions.canView) {
      fetchTransactions();
    }
  }, [activeTab, selectedDate, selectedSchool, userSchoolId, permissions.loading, permissions.canView]); // ✅ Agregar userSchoolId

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
    } catch (error) {
      console.error('Error fetching user school:', error);
    }
  };

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      
      console.log('🚀 fetchTransactions INICIADO con salesFilter:', salesFilter);
      
      // Ajustar fechas para timezone de Perú (UTC-5)
      // Buscar todo el día en hora local + margen para timezone
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const startDate = start.toISOString();
      
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      const endDate = end.toISOString();

      console.log('🔍 INICIANDO BÚSQUEDA DE TRANSACCIONES:', {
        date: format(selectedDate, 'dd/MM/yyyy'),
        activeTab,
        selectedSchool,
        salesFilter,
        canViewAllSchools,
        userSchoolId,
        userRole: role
      });

      let query = supabase
        .from('transactions')
        .select(`
          *,
          student:students(id, full_name, balance),
          teacher:teacher_profiles(id, full_name),
          school:schools(id, name, code)
        `)
        .eq('type', 'purchase') // ✅ VENTAS DEL POS (registradas como 'purchase' en BD)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false });

      console.log('🎯 Filtro aplicado:', salesFilter);

      // Filtrar por sede si corresponde
      console.log('🏫 Evaluando filtro de sedes:', {
        canViewAllSchools,
        userSchoolId,
        selectedSchool
      });

      if (canViewAllSchools) {
        // Si tiene permiso para ver todas las sedes
        if (selectedSchool !== 'all') {
          console.log('✅ Admin con acceso total - Filtrando por sede seleccionada:', selectedSchool);
          query = query.eq('school_id', selectedSchool);
        } else {
          console.log('✅ Admin con acceso total - Mostrando TODAS las sedes');
        }
      } else {
        // Si NO tiene permiso, solo ve su propia sede
        if (userSchoolId) {
          console.log('🔒 Admin de sede - FORZANDO filtro por su sede:', userSchoolId);
          query = query.eq('school_id', userSchoolId);
        } else {
          console.log('⚠️ Admin de sede - NO SE ENCONTRÓ userSchoolId');
        }
      }

      // Filtrar según pestaña
      if (activeTab === 'deleted') {
        query = query.eq('is_deleted', true);
      } else if (activeTab === 'today') {
        query = query.or('is_deleted.is.null,is_deleted.eq.false');
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error:', error);
        throw error;
      }

      console.log('📦 Total transacciones desde BD:', data?.length || 0);
      console.log('📅 Rango de fechas:', { startDate, endDate });
      console.log('🔍 Primeras 3 transacciones:', data?.slice(0, 3));

      // Cargar información de los cajeros (profiles) por separado
      if (data && data.length > 0) {
        const createdByIds = [...new Set(data.map((t: any) => t.created_by).filter(Boolean))];
        
        if (createdByIds.length > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .in('id', createdByIds);
          
          if (!profilesError && profilesData) {
            // Mapear los perfiles a las transacciones
            const profilesMap = new Map(profilesData.map(p => [p.id, p]));
            data.forEach((transaction: any) => {
              if (transaction.created_by) {
                transaction.profiles = profilesMap.get(transaction.created_by);
              }
            });
          }
        }
      }
      
      console.log('✅ Ventas obtenidas:', data?.length || 0);
      console.log('📊 Primera venta (ejemplo):', data?.[0]);
      console.log('🏢 School data:', data?.[0]?.school);
      setTransactions(data || []);
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las ventas',
      });
    } finally {
      setLoading(false);
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
    setEditClientName(transaction.client_name || transaction.student?.full_name || transaction.teacher?.full_name || 'CLIENTE GENÉRICO');
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
          client_name: editClientName.trim() || null,
          client_dni: editClientDNI.trim() || null,
          client_ruc: editClientRUC.trim() || null,
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

  // ========== ANULAR VENTA ==========
  const handleOpenAnnul = (transaction: Transaction) => {
    console.log('🗑️ Intentando anular venta:', {
      ticket: transaction.ticket_code,
      userRole: role,
      isCajero: role === 'cajero' || role === 'operador_caja'
    });
    
    // Si es cajero u operador de caja, requiere contraseña de admin primero
    if (role === 'cajero' || role === 'operador_caja') {
      console.log('✅ Es cajero/operador, pidiendo contraseña');
      setPendingAnnulTransaction(transaction);
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

  // Validar contraseña de admin para cajeros
  const handleValidatePassword = async () => {
    if (!adminPassword.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa la contraseña del administrador',
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Buscar un admin con esa contraseña
      const { data: adminUser, error } = await supabase.rpc('validate_admin_password', {
        p_password: adminPassword
      });

      if (error || !adminUser) {
        toast({
          variant: 'destructive',
          title: 'Contraseña Incorrecta',
          description: 'La contraseña del administrador no es válida',
        });
        return;
      }

      // Contraseña correcta, abrir modal de anulación
      toast({
        title: '✅ Autorizado',
        description: 'Contraseña verificada correctamente',
      });
      
      setShowPasswordValidation(false);
      setSelectedTransaction(pendingAnnulTransaction);
      setAnnulReason('');
      setShowAnnul(true);
      setAdminPassword('');
      setPendingAnnulTransaction(null);

    } catch (error: any) {
      console.error('Error validating password:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo validar la contraseña',
      });
    } finally {
      setIsProcessing(false);
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

    setIsProcessing(true);
    try {
      // 1. Marcar como anulada
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id,
          deletion_reason: annulReason.trim(),
        })
        .eq('id', selectedTransaction.id);

      if (updateError) throw updateError;

      // 2. Si es venta de estudiante, devolver saldo
      if (selectedTransaction.student_id && selectedTransaction.student) {
        const amountToReturn = Math.abs(selectedTransaction.amount);
        const newBalance = selectedTransaction.student.balance + amountToReturn;

        const { error: balanceError } = await supabase
          .from('students')
          .update({ balance: newBalance })
          .eq('id', selectedTransaction.student_id);

        if (balanceError) throw balanceError;

        toast({
          title: '✅ Venta Anulada',
          description: `Saldo devuelto: S/ ${amountToReturn.toFixed(2)}. Nuevo saldo: S/ ${newBalance.toFixed(2)}`,
        });
      } else {
        toast({
          title: '✅ Venta Anulada',
          description: 'La venta fue marcada como anulada',
        });
      }

      setShowAnnul(false);
      fetchTransactions();
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

  // Búsqueda inteligente
  const filteredTransactions = transactions.filter(t => {
    // Primero filtrar por tipo de venta
    if (salesFilter === 'pos' && isLunchTransaction(t)) return false;  // POS: excluir almuerzos
    if (salesFilter === 'lunch' && !isLunchTransaction(t)) return false; // Almuerzos: excluir POS
    
    // Luego filtrar por búsqueda
    if (!searchTerm.trim()) return true;
    
    const search = searchTerm.toLowerCase();
    return (
      t.ticket_code?.toLowerCase().includes(search) ||
      t.student?.full_name?.toLowerCase().includes(search) ||
      t.teacher?.full_name?.toLowerCase().includes(search) || // ✅ Incluir nombre de profesor en búsqueda
      t.client_name?.toLowerCase().includes(search) ||
      t.description?.toLowerCase().includes(search) ||
      Math.abs(t.amount).toString().includes(search)
    );
  });

  const getTotalSales = () => {
    return filteredTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  };

  // Mostrar loading mientras verifica permisos
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

  // Ya no bloqueamos el acceso aquí, eso lo hace PermissionProtectedRoute en App.tsx
  // Solo usamos los permisos para mostrar/ocultar funcionalidades específicas

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
                {format(selectedDate, "EEEE, dd 'de' MMMM yyyy", { locale: es })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro de Fecha */}
              <div className="flex items-center bg-muted rounded-lg p-1 mr-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8"
                  onClick={() => setSelectedDate(prev => subDays(prev, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 font-bold px-2 hover:bg-transparent"
                    >
                      {format(selectedDate, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      initialFocus
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8"
                  onClick={() => setSelectedDate(prev => addDays(prev, 1))}
                  disabled={startOfDay(selectedDate).getTime() >= startOfDay(new Date()).getTime()}
                >
                  <ChevronRight className="h-4 w-4" />
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

          {/* Buscador */}
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="🔍 Buscar: ticket, cliente, monto..."
              className="pl-10 h-12 text-base border-2 focus:border-emerald-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Badge variant="secondary" className="text-xs">
                  {filteredTransactions.length} resultados
                </Badge>
              </div>
            )}
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
                    {searchTerm 
                      ? 'No se encontraron resultados' 
                      : salesFilter === 'pos' 
                        ? `No hay ventas de cafetería para ${format(selectedDate, "dd/MM/yyyy", { locale: es })}` 
                        : salesFilter === 'lunch' 
                          ? `No hay ventas de almuerzos para ${format(selectedDate, "dd/MM/yyyy", { locale: es })}` 
                          : `No hay ventas para ${format(selectedDate, "dd/MM/yyyy", { locale: es })}`}
                  </p>
                  {transactions.length > 0 && filteredTransactions.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Hay {transactions.length} venta(s) en total. Prueba cambiando el filtro de tipo.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredTransactions.map((t) => (
                    <Card 
                      key={t.id} 
                      className={`hover:shadow-md transition-all border-l-4 ${
                        selectedIds.has(t.id) ? 'bg-blue-50 border-blue-500' : ''
                      }`}
                      style={{
                        borderLeftColor: t.is_deleted ? '#ef4444' : '#10b981'
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
                              {t.is_deleted && (
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
                                CLIENTE: {t.client_name || t.student?.full_name || t.teacher?.full_name || 'GENÉRICO'}
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

                              {/* Botón Reimprimir */}
                              {permissions.canPrint && (
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

                              {!t.is_deleted && (
                                <>
                                  {permissions.canEdit && (
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      className="h-8 w-8 p-0 hover:bg-blue-50"
                                      onClick={() => handleOpenEditClient(t)}
                                      title="Editar datos del cliente"
                                    >
                                      <Edit className="h-4 w-4 text-blue-600" />
                                    </Button>
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
        </CardContent>
      </Card>

      {/* MODAL: Validación de Contraseña para Cajeros */}
      <Dialog open={showPasswordValidation} onOpenChange={setShowPasswordValidation}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Autorización Requerida
            </DialogTitle>
            <DialogDescription>
              Como cajero, necesitas la contraseña de un administrador para anular ventas.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800">
                <strong>Ticket:</strong> {pendingAnnulTransaction?.ticket_code}
              </p>
              <p className="text-sm text-amber-800">
                <strong>Monto:</strong> S/ {pendingAnnulTransaction ? Math.abs(pendingAnnulTransaction.amount).toFixed(2) : '0.00'}
              </p>
            </div>

            <div>
              <Label htmlFor="adminPassword">Contraseña del Administrador</Label>
              <Input
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Ingresa la contraseña"
                onKeyDown={(e) => e.key === 'Enter' && handleValidatePassword()}
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowPasswordValidation(false);
                setAdminPassword('');
                setPendingAnnulTransaction(null);
              }}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleValidatePassword} 
              disabled={isProcessing || !adminPassword.trim()}
            >
              {isProcessing ? 'Validando...' : 'Validar'}
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnnul(false)}>
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleAnnulSale} 
              disabled={isProcessing || !annulReason.trim()}
            >
              {isProcessing ? 'Anulando...' : 'Confirmar Anulación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Detalles de Venta (DISEÑO TICKET REAL) */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-[400px] p-0 bg-gray-100 overflow-hidden">
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
                clientName={selectedTransaction.client_name || selectedTransaction.student?.full_name || selectedTransaction.teacher?.full_name || 'CLIENTE GENÉRICO'}
                documentType={selectedTransaction.document_type || 'ticket'}
                items={transactionItems}
                total={Math.abs(selectedTransaction.amount)}
                clientDNI={selectedTransaction.client_dni}
                clientRUC={selectedTransaction.client_ruc}
                isReprint={false}
                showOnScreen={true} // ✅ Se muestra como ticket en pantalla
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

      {/* TICKET TÉRMICO (Oculto, para impresión) */}
      {selectedTransaction && transactionItems.length > 0 && (
        <ThermalTicket
          ticketCode={selectedTransaction.ticket_code}
          date={new Date(selectedTransaction.created_at)}
          cashierEmail={selectedTransaction.profiles?.full_name || selectedTransaction.profiles?.email || 'Sistema'}
          clientName={selectedTransaction.client_name || selectedTransaction.student?.full_name || selectedTransaction.teacher?.full_name || 'CLIENTE GENÉRICO'}
          documentType={selectedTransaction.document_type || 'ticket'}
          items={transactionItems}
          total={Math.abs(selectedTransaction.amount)}
          clientDNI={selectedTransaction.client_dni}
          clientRUC={selectedTransaction.client_ruc}
          isReprint={true}
        />
      )}
    </div>
  );
};
