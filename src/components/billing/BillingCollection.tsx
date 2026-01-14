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
  AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
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

interface DebtorStudent {
  student_id: string;
  student_name: string;
  parent_id: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
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
  const [debtors, setDebtors] = useState<DebtorStudent[]>([]);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  
  // Filtros
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [untilDate, setUntilDate] = useState<string>(''); // Nueva fecha límite
  
  // Selección múltiple
  const [selectedDebtors, setSelectedDebtors] = useState<Set<string>>(new Set());
  
  // Modal de pago
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentDebtor, setCurrentDebtor] = useState<DebtorStudent | null>(null);
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

      // SIMPLIFICADO: Solo consultar transacciones pendientes
      let query = supabase
        .from('transactions')
        .select(`
          *,
          students(id, full_name, parent_id),
          schools(id, name)
        `)
        .eq('type', 'purchase')
        .eq('payment_status', 'pending')
        .not('student_id', 'is', null);

      // Filtrar por fecha límite si está definida
      if (untilDate) {
        // Convertir a fecha local sin restar días
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

      // Obtener IDs únicos de padres
      const parentIds = [...new Set(transactions
        .map((t: any) => t.students?.parent_id)
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

      // Agrupar por estudiante
      const debtorsMap: { [key: string]: DebtorStudent } = {};

      transactions?.forEach((transaction: any) => {
        const studentId = transaction.student_id;
        if (!studentId || !transaction.students) return;

        const student = transaction.students;
        const parentProfile = parentMap.get(student.parent_id);
        
        if (!debtorsMap[studentId]) {
          debtorsMap[studentId] = {
            student_id: studentId,
            student_name: student.full_name,
            parent_id: student.parent_id || '',
            parent_name: parentProfile?.full_name || 'Sin padre asignado',
            parent_phone: parentProfile?.phone_1 || '',
            parent_email: '', // Email no disponible por ahora
            school_id: transaction.school_id,
            school_name: transaction.schools?.name || '',
            total_amount: 0,
            transaction_count: 0,
            transactions: [],
          };
        }

        debtorsMap[studentId].total_amount += Math.abs(transaction.amount);
        debtorsMap[studentId].transaction_count += 1;
        debtorsMap[studentId].transactions.push(transaction);
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
      debtor.student_name.toLowerCase().includes(search) ||
      debtor.parent_name.toLowerCase().includes(search) ||
      debtor.parent_email.toLowerCase().includes(search)
    );
  });

  const toggleSelection = (studentId: string) => {
    const newSelected = new Set(selectedDebtors);
    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
    } else {
      newSelected.add(studentId);
    }
    setSelectedDebtors(newSelected);
  };

  const selectAll = () => {
    if (selectedDebtors.size === filteredDebtors.length) {
      setSelectedDebtors(new Set());
    } else {
      setSelectedDebtors(new Set(filteredDebtors.map(d => d.student_id)));
    }
  };

  const handleOpenPayment = (debtor: DebtorStudent) => {
    setCurrentDebtor(debtor);
    setPaymentData({
      paid_amount: debtor.total_amount, // Por defecto pago completo
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

    setSaving(true);
    
    try {
      // Simplemente marcar transacciones como pagadas
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          payment_status: 'paid',
          payment_method: paymentData.payment_method,
        })
        .in('id', currentDebtor.transactions.map(t => t.id));

      if (updateError) {
        console.error('Error actualizando transacciones:', updateError);
        throw updateError;
      }

      toast({
        title: '✅ Pago registrado',
        description: `Se registró el pago de S/ ${paymentData.paid_amount.toFixed(2)} con ${paymentData.payment_method}`,
      });

      setShowPaymentModal(false);
      setCurrentDebtor(null);
      setPaymentData({
        paid_amount: 0,
        payment_method: 'efectivo',
        operation_number: '',
        document_type: 'ticket',
        notes: '',
      });
      fetchDebtors();
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

  const copyMessage = (debtor: DebtorStudent) => {
    const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
    const periodText = period ? `del período: ${period.period_name}` : 'pendiente';
    
    const message = `🔔 *COBRANZA LIMA CAFÉ 28*

Estimado(a) ${debtor.parent_name}

El alumno *${debtor.student_name}* tiene un consumo ${periodText}

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

  const generatePDF = async (debtor: DebtorStudent) => {
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
      student_name: debtor.student_name,
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
      description: `Estado de cuenta de ${debtor.student_name}`,
    });
  };

  const generateWhatsAppExport = () => {
    const period = selectedPeriod !== 'all' ? periods.find(p => p.id === selectedPeriod) : null;
    const selectedDebtorsList = filteredDebtors.filter(d => selectedDebtors.has(d.student_id));

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
        student_name: debtor.student_name,
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
    const selectedDebtorsList = filteredDebtors.filter(d => selectedDebtors.has(d.student_id));

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
        student_name: debtor.student_name,
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
                        .filter(d => selectedDebtors.has(d.student_id))
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
                  <Card key={debtor.student_id} className="hover:shadow-lg transition-shadow border-l-4 border-l-red-500">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <Checkbox
                          checked={selectedDebtors.has(debtor.student_id)}
                          onCheckedChange={() => toggleSelection(debtor.student_id)}
                          className="mt-1"
                        />

                        <div className="flex-1">
                          {/* Header con nombre y monto */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h3 className="font-bold text-xl text-gray-900">{debtor.student_name}</h3>
                              <p className="text-sm text-gray-600 mt-1">
                                👤 Padre: <span className="font-semibold">{debtor.parent_name}</span>
                              </p>
                              {debtor.parent_phone && (
                                <p className="text-sm text-gray-600">
                                  📱 {debtor.parent_phone}
                                </p>
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
                              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                {debtor.transactions.map((t: any, idx: number) => (
                                  <div key={t.id} className="text-xs bg-white p-2 rounded border">
                                    <span className="font-semibold">#{idx + 1}</span>
                                    {' - '}
                                    {format(new Date(t.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                                    {' - '}
                                    <span className="text-red-600 font-bold">S/ {Math.abs(t.amount).toFixed(2)}</span>
                                    {t.ticket_number && ` - Ticket: ${t.ticket_number}`}
                                  </div>
                                ))}
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
                <div className="font-semibold text-gray-900">👨‍🎓 Estudiante: {currentDebtor?.student_name}</div>
                <div className="font-semibold text-gray-900">👤 Padre: {currentDebtor?.parent_name}</div>
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

            {/* Número de Operación */}
            {['yape', 'plin', 'transferencia'].includes(paymentData.payment_method) && (
              <div className="space-y-2">
                <Label className="text-base font-semibold">🔢 Número de Operación (Opcional)</Label>
                <Input
                  placeholder="Ej: 123456789"
                  value={paymentData.operation_number}
                  onChange={(e) => setPaymentData(prev => ({ ...prev, operation_number: e.target.value }))}
                  className="h-12 text-lg"
                />
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
                <Button
                  type="button"
                  variant={paymentData.document_type === 'boleta' ? 'default' : 'outline'}
                  className={`h-16 text-base ${paymentData.document_type === 'boleta' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, document_type: 'boleta' }))}
                >
                  📄 Boleta
                </Button>
                <Button
                  type="button"
                  variant={paymentData.document_type === 'factura' ? 'default' : 'outline'}
                  className={`h-16 text-base ${paymentData.document_type === 'factura' ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                  onClick={() => setPaymentData(prev => ({ ...prev, document_type: 'factura' }))}
                >
                  📋 Factura
                </Button>
              </div>
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
    </div>
  );
};
