import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, User, ShoppingBag, UtensilsCrossed, Home, MoreHorizontal, Loader2, DollarSign, CheckCircle2, Download, Filter, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TeacherOnboardingModal } from '@/components/teacher/TeacherOnboardingModal';
import { TeacherMoreMenu } from '@/components/teacher/TeacherMoreMenu';
import { OrderLunchMenus } from '@/components/lunch/OrderLunchMenus';
import { MyLunchOrders } from '@/components/teacher/MyLunchOrders';
import jsPDF from 'jspdf';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';

interface TeacherProfile {
  id: string;
  full_name: string;
  dni: string;
  corporate_email: string | null;
  personal_email: string | null;
  phone_1: string;
  corporate_phone: string | null;
  area: string;
  school_1_id: string; // ⬅️ Corregido de school_id_1 a school_1_id
  school_2_id: string | null; // ⬅️ Corregido de school_id_2 a school_2_id
  school_1_name?: string;
  school_2_name?: string;
  onboarding_completed: boolean;
}

export default function Teacher() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [delayDays, setDelayDays] = useState<number>(0);
  const [currentBalance, setCurrentBalance] = useState<number>(0);
  const [pendingTransactions, setPendingTransactions] = useState<any[]>([]);
  const [paidTransactions, setPaidTransactions] = useState<any[]>([]);
  const [paymentSubTab, setPaymentSubTab] = useState('pending');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc'); // Más reciente primero
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  useEffect(() => {
    if (user) {
      checkOnboardingStatus();
    }
  }, [user]);

  useEffect(() => {
    // Cargar datos según la pestaña activa
    if (teacherProfile) {
      if (activeTab === 'history') {
        fetchPurchaseHistory();
      } else if (activeTab === 'payments') {
        fetchCurrentBalance();
        fetchPendingAndPaidTransactions();
      }
    }
  }, [activeTab, teacherProfile]);

  const fetchCurrentBalance = async () => {
    if (!teacherProfile) return;

    try {
      console.log('💰 Calculando balance actual del profesor');

      // Obtener todas las transacciones PENDIENTES del profesor (excluyendo pagadas y eliminadas)
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('amount, payment_status')
        .eq('teacher_id', teacherProfile.id)
        .eq('is_deleted', false)
        .or('payment_status.eq.pending,payment_status.is.null');

      if (error) throw error;

      // Calcular balance solo de transacciones pendientes
      const balance = transactions?.reduce((sum, t) => sum + t.amount, 0) || 0;
      setCurrentBalance(balance);

      console.log('✅ Balance actual (solo pendientes):', balance);
      console.log('📊 Transacciones pendientes:', transactions?.length);
    } catch (error: any) {
      console.error('❌ Error calculando balance:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo calcular el balance.',
      });
    }
  };

  const fetchPendingAndPaidTransactions = async () => {
    if (!teacherProfile) return;

    try {
      console.log('📋 Cargando transacciones pendientes y pagadas...');

      // Transacciones PENDIENTES
      const { data: pending, error: pendingError } = await supabase
        .from('transactions')
        .select(`
          id,
          type,
          amount,
          description,
          created_at,
          ticket_code,
          payment_status,
          transaction_items (
            product_name,
            quantity,
            unit_price,
            subtotal
          )
        `)
        .eq('teacher_id', teacherProfile.id)
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .or('payment_status.eq.pending,payment_status.is.null')
        .order('created_at', { ascending: false });

      if (pendingError) throw pendingError;

      setPendingTransactions(pending || []);
      console.log('✅ Transacciones pendientes:', pending?.length);

      // Transacciones PAGADAS (compras que ya fueron pagadas)
      const { data: paid, error: paidError } = await supabase
        .from('transactions')
        .select(`
          id,
          type,
          amount,
          description,
          created_at,
          ticket_code,
          payment_status,
          payment_method,
          operation_number,
          created_by,
          school_id,
          transaction_items (
            product_name,
            quantity,
            unit_price,
            subtotal
          )
        `)
        .eq('teacher_id', teacherProfile.id)
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: false });

      if (paidError) throw paidError;

      console.log('✅ Transacciones pagadas:', paid?.length);

      // Obtener información de cajeros y sedes por separado
      if (paid && paid.length > 0) {
        // IDs únicos de cajeros
        const cashierIds = [...new Set(paid.map((t: any) => t.created_by).filter(Boolean))];
        
        // IDs únicos de sedes
        const schoolIds = [...new Set(paid.map((t: any) => t.school_id).filter(Boolean))];

        // Fetch cajeros
        let cashiersMap = new Map();
        if (cashierIds.length > 0) {
          const { data: cashiers } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', cashierIds);

          if (cashiers) {
            cashiers.forEach((c: any) => {
              cashiersMap.set(c.id, c);
            });
          }
        }

        // Fetch sedes
        let schoolsMap = new Map();
        if (schoolIds.length > 0) {
          const { data: schools } = await supabase
            .from('schools')
            .select('id, name')
            .in('id', schoolIds);

          if (schools) {
            schools.forEach((s: any) => {
              schoolsMap.set(s.id, s);
            });
          }
        }

        // Mapear información a las transacciones
        const enrichedPaid = paid.map((t: any) => ({
          ...t,
          profiles: t.created_by ? cashiersMap.get(t.created_by) : null,
          schools: t.school_id ? schoolsMap.get(t.school_id) : null,
        }));

        setPaidTransactions(enrichedPaid);
      } else {
        setPaidTransactions([]);
      }

    } catch (error: any) {
      console.error('❌ Error cargando transacciones:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las transacciones.',
      });
    }
  };

  // Filtrar y ordenar transacciones pendientes
  const filteredPendingTransactions = useMemo(() => {
    let filtered = [...pendingTransactions];

    // Filtrar por fechas
    if (dateFrom) {
      filtered = filtered.filter(t => new Date(t.created_at) >= new Date(dateFrom));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(t => new Date(t.created_at) <= endDate);
    }

    // Ordenar
    filtered.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [pendingTransactions, dateFrom, dateTo, sortOrder]);

  // Filtrar y ordenar transacciones pagadas
  const filteredPaidTransactions = useMemo(() => {
    let filtered = [...paidTransactions];

    // Filtrar por fechas
    if (dateFrom) {
      filtered = filtered.filter(t => new Date(t.created_at) >= new Date(dateFrom));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(t => new Date(t.created_at) <= endDate);
    }

    // Ordenar
    filtered.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [paidTransactions, dateFrom, dateTo, sortOrder]);

  // Función para generar comprobante de pago
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
      doc.text('Lima Café - Profesor', pageWidth / 2, 32, { align: 'center' });

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
      const paymentDate = new Date(transaction.created_at);
      const formattedDate = paymentDate.toLocaleDateString('es-PE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Lima'
      });
      doc.text(formattedDate, 70, yPos);
      yPos += 7;

      // Profesor
      doc.setFont('helvetica', 'bold');
      doc.text('PROFESOR:', 15, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(teacherProfile?.full_name || 'Sin nombre', 70, yPos);
      yPos += 7;

      // Sede
      if (transaction.schools?.name) {
        doc.setFont('helvetica', 'bold');
        doc.text('SEDE:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.schools.name, 70, yPos);
        yPos += 7;
      }

      // Cajero que cobró
      if (transaction.profiles?.full_name) {
        doc.setFont('helvetica', 'bold');
        doc.text('COBRADO POR:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.profiles.full_name, 70, yPos);
        yPos += 7;
      }

      if (transaction.profiles?.email) {
        doc.setFont('helvetica', 'bold');
        doc.text('EMAIL CAJERO:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.profiles.email, 70, yPos);
        yPos += 7;
      }

      // Método de pago
      if (transaction.payment_method) {
        doc.setFont('helvetica', 'bold');
        doc.text('MÉTODO DE PAGO:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.payment_method.toUpperCase(), 70, yPos);
        yPos += 7;
      }

      // Número de operación
      if (transaction.operation_number) {
        doc.setFont('helvetica', 'bold');
        doc.text('Nº OPERACIÓN:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.operation_number, 70, yPos);
        yPos += 7;
      }

      // Ticket code
      if (transaction.ticket_code) {
        doc.setFont('helvetica', 'bold');
        doc.text('Nº TICKET:', 15, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(transaction.ticket_code, 70, yPos);
        yPos += 7;
      }

      yPos += 3;

      // Descripción
      doc.setFont('helvetica', 'bold');
      doc.text('DESCRIPCIÓN:', 15, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      const description = transaction.description || 'Sin descripción';
      const descriptionLines = doc.splitTextToSize(description, pageWidth - 30);
      doc.text(descriptionLines, 15, yPos);
      yPos += descriptionLines.length * 5 + 5;

      // Detalle de items
      if (transaction.transaction_items && transaction.transaction_items.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.text('PRODUCTOS:', 15, yPos);
        yPos += 6;
        doc.setFont('helvetica', 'normal');
        
        transaction.transaction_items.forEach((item: any) => {
          doc.text(`${item.quantity}x ${item.product_name}`, 20, yPos);
          doc.text(`S/ ${item.subtotal.toFixed(2)}`, pageWidth - 20, yPos, { align: 'right' });
          yPos += 5;
        });
        yPos += 5;
      }

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
      doc.setFont('helvetica', 'normal');
      
      const footerY = pageHeight - 30;
      doc.text('Este es un comprobante interno generado', pageWidth / 2, footerY, { align: 'center' });
      doc.text('© 2026 ERP Profesional diseñado por ARQUISIA Soluciones para Lima Café 28', pageWidth / 2, footerY + 5, { align: 'center' });
      doc.text(`Versión 1.17.2 • PRODUCTION`, pageWidth / 2, footerY + 10, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString('es-PE', { dateStyle: 'full', timeZone: 'America/Lima' })}`, pageWidth / 2, footerY + 15, { align: 'center' });

      // Guardar PDF
      const fileName = `Comprobante_${teacherProfile?.full_name.replace(/\s+/g, '_')}_${new Date(transaction.created_at).toLocaleDateString('es-PE').replace(/\//g, '-')}.pdf`;
      doc.save(fileName);

      toast({
        title: '✅ Comprobante generado',
        description: 'Se descargó el comprobante de pago exitosamente',
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

  const checkOnboardingStatus = async () => {
    try {
      setLoading(true);
      console.log('🔍 Verificando perfil del profesor:', user?.id);

      // Verificar si existe el perfil del profesor
      const { data: profile, error } = await supabase
        .from('teacher_profiles_with_schools')
        .select('*')
        .eq('id', user?.id)
        .maybeSingle();

      if (error) {
        console.error('❌ Error cargando perfil:', error);
        throw error;
      }

      // Si no hay perfil, mostrar onboarding
      if (!profile) {
        console.log('📝 Profesor sin perfil, mostrando onboarding');
        setShowOnboarding(true);
        setLoading(false);
        return;
      }

      console.log('✅ Perfil encontrado:', profile);
      setTeacherProfile(profile);

      // Si el perfil no está completo, mostrar onboarding
      if (!profile.onboarding_completed) {
        console.log('📝 Onboarding incompleto, mostrando modal');
        setShowOnboarding(true);
      }

      setLoading(false);
    } catch (error: any) {
      console.error('❌ Error verificando perfil:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar tu perfil. Por favor, intenta de nuevo.',
      });
      setLoading(false);
    }
  };

  const fetchPurchaseHistory = async () => {
    if (!teacherProfile) return;

    try {
      console.log('📊 Cargando historial de compras del profesor');

      // 1. Obtener el delay configurado para la sede del profesor
      const { data: delayData, error: delayError } = await supabase
        .from('purchase_visibility_delay')
        .select('delay_days')
        .eq('school_id', teacherProfile.school_1_id) // ⬅️ Corregido
        .maybeSingle();

      if (delayError) {
        console.error('❌ Error obteniendo delay:', delayError);
      }

      const configuredDelayDays = delayData?.delay_days ?? 0;
      setDelayDays(configuredDelayDays);
      console.log('⏱️ Delay configurado:', configuredDelayDays, 'días');

      // 2. Calcular la fecha de corte (si hay delay)
      let query = supabase
        .from('transactions')
        .select(`
          id,
          type,
          amount,
          description,
          created_at,
          ticket_code,
          payment_status,
          transaction_items (
            product_name,
            quantity,
            unit_price,
            subtotal
          )
        `)
        .eq('teacher_id', teacherProfile.id)
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      // Aplicar filtro de delay solo si es mayor a 0
      if (configuredDelayDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - configuredDelayDays);
        const cutoffDateISO = cutoffDate.toISOString();
        
        console.log('📅 Mostrando compras hasta:', cutoffDate.toLocaleDateString());
        query = query.lte('created_at', cutoffDateISO);
      } else {
        console.log('⚡ Modo EN VIVO: Mostrando todas las compras sin delay');
      }

      const { data: transactions, error } = await query;

      if (error) throw error;

      console.log('✅ Transacciones cargadas:', transactions?.length);
      setPurchaseHistory(transactions || []);

      // Calcular total gastado
      const total = transactions?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
      setTotalSpent(total);

    } catch (error: any) {
      console.error('❌ Error cargando historial:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar el historial de compras.',
      });
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/auth');
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    checkOnboardingStatus();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Cargando tu portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-purple-600 p-2 rounded-lg">
                <UtensilsCrossed className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Portal del Profesor</h1>
                {teacherProfile && (
                  <p className="text-sm text-gray-500">{teacherProfile.full_name}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <TeacherMoreMenu 
                teacherProfile={teacherProfile}
                onProfileUpdate={checkOnboardingStatus}
              />
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-5 w-5 mr-2" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {teacherProfile && teacherProfile.onboarding_completed ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5 mb-6">
              <TabsTrigger value="home" className="gap-2">
                <Home className="h-4 w-4" />
                Inicio
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-2">
                <User className="h-4 w-4" />
                Mi Perfil
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2">
                <ShoppingBag className="h-4 w-4" />
                Historial
              </TabsTrigger>
              <TabsTrigger value="payments" className="gap-2">
                <DollarSign className="h-4 w-4" />
                Pagos
              </TabsTrigger>
              <TabsTrigger value="menu" className="gap-2">
                <UtensilsCrossed className="h-4 w-4" />
                Menú
              </TabsTrigger>
            </TabsList>

            {/* TAB: INICIO */}
            <TabsContent value="home" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Card: Bienvenida */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Bienvenido, {teacherProfile.full_name.split(' ')[0]} 👋</CardTitle>
                    <CardDescription>
                      Tu cuenta es libre, sin límites de gasto.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
                        <div>
                          <p className="text-sm text-gray-600">Total Gastado</p>
                          <p className="text-2xl font-bold text-purple-600">
                            S/ {totalSpent.toFixed(2)}
                          </p>
                        </div>
                        <ShoppingBag className="h-10 w-10 text-purple-600" />
                      </div>
                      
                      <div className="p-4 bg-green-50 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                          <p className="text-sm font-semibold text-green-800">Cuenta Activa</p>
                        </div>
                        <p className="text-xs text-green-700">
                          Tu cuenta está habilitada para compras sin restricciones.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Card: Info Rápida */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Tu Información</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-500">Área</p>
                      <p className="font-semibold capitalize">{teacherProfile.area}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Escuela Principal</p>
                      <p className="font-semibold text-sm">{teacherProfile.school_1_name}</p>
                    </div>
                    {teacherProfile.school_2_name && (
                      <div>
                        <p className="text-xs text-gray-500">Segunda Escuela</p>
                        <p className="font-semibold text-sm">{teacherProfile.school_2_name}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Últimas Compras */}
              <Card>
                <CardHeader>
                  <CardTitle>Últimas Compras</CardTitle>
                  <CardDescription>Tus compras más recientes</CardDescription>
                </CardHeader>
                <CardContent>
                  {purchaseHistory.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>No tienes compras registradas aún</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {purchaseHistory.slice(0, 5).map((transaction) => (
                        <div
                          key={transaction.id}
                          className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                        >
                          <div>
                            <p className="font-semibold">{transaction.description}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(transaction.created_at).toLocaleDateString('es-PE')}
                            </p>
                          </div>
                          <p className="font-bold text-red-600">
                            S/ {Math.abs(transaction.amount).toFixed(2)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: MI PERFIL */}
            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle>Mi Perfil</CardTitle>
                  <CardDescription>Tu información personal</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Nombre Completo</p>
                      <p className="font-semibold">{teacherProfile.full_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">DNI</p>
                      <p className="font-semibold">{teacherProfile.dni}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Correo Personal</p>
                      <p className="font-semibold">{teacherProfile.personal_email || user?.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Correo Corporativo</p>
                      <p className="font-semibold">{teacherProfile.corporate_email || 'No registrado'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Teléfono Personal</p>
                      <p className="font-semibold">{teacherProfile.phone_1}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Teléfono Corporativo</p>
                      <p className="font-semibold">{teacherProfile.corporate_phone || 'No registrado'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Área de Trabajo</p>
                      <p className="font-semibold capitalize">{teacherProfile.area}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Tipo de Cuenta</p>
                      <p className="font-semibold text-green-600">Cuenta Libre</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: HISTORIAL */}
            <TabsContent value="history">
              <Card>
                <CardHeader>
                  <CardTitle>Historial de Compras</CardTitle>
                  <CardDescription>
                    Todas tus compras en el kiosco
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {purchaseHistory.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <ShoppingBag className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-semibold mb-2">No hay compras registradas</p>
                      <p className="text-sm">Tus compras aparecerán aquí</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {purchaseHistory.map((transaction) => (
                        <div
                          key={transaction.id}
                          className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="font-semibold text-lg">{transaction.description}</p>
                              <p className="text-sm text-gray-500">
                                {new Date(transaction.created_at).toLocaleDateString('es-PE', {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              {transaction.ticket_code && (
                                <p className="text-xs text-gray-400 mt-1">
                                  Ticket: {transaction.ticket_code}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-red-600">
                                S/ {Math.abs(transaction.amount).toFixed(2)}
                              </p>
                            </div>
                          </div>

                          {/* Detalle de items */}
                          {transaction.transaction_items && transaction.transaction_items.length > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs font-semibold text-gray-600 mb-2">Productos:</p>
                              <div className="space-y-1">
                                {transaction.transaction_items.map((item: any, idx: number) => (
                                  <div key={idx} className="flex justify-between text-sm">
                                    <span className="text-gray-700">
                                      {item.quantity}x {item.product_name}
                                    </span>
                                    <span className="text-gray-900 font-medium">
                                      S/ {item.subtotal.toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: PAGOS */}
            <TabsContent value="payments" className="space-y-6">
              {/* Banner informativo */}
              <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-blue-500 rounded-full p-2 mt-1">
                    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-blue-900 text-lg mb-1">
                      Información de Pagos
                    </h3>
                    <p className="text-blue-800 text-sm leading-relaxed">
                      Esta sección es <strong>solo informativa</strong>. Los pagos se realizarán directamente con el administrador. 
                      La pasarela de pagos en línea se habilitará próximamente.
                    </p>
                  </div>
                </div>
              </div>

              {/* Card: Balance Actual */}
              <Card>
                <CardHeader>
                  <CardTitle>Balance de Cuenta</CardTitle>
                  <CardDescription>
                    Como profesor, tu cuenta es libre sin límites de gasto.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={`p-6 rounded-lg ${currentBalance < 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <p className="text-sm text-gray-600 mb-2">Balance actual:</p>
                    <p className={`text-4xl font-bold ${currentBalance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      S/ {Math.abs(currentBalance).toFixed(2)}
                    </p>
                    {currentBalance < 0 && (
                      <p className="text-sm text-red-600 mt-2">
                        ⚠️ Tienes una deuda pendiente
                      </p>
                    )}
                    {currentBalance >= 0 && (
                      <p className="text-sm text-green-600 mt-2">
                        ✅ Sin deudas pendientes
                      </p>
                    )}
                  </div>
                  
                  {/* Mensaje de Pago en Línea */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <div className="bg-blue-100 rounded-full p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-blue-900 text-sm">
                          Pago en Línea
                        </h4>
                        <p className="text-blue-700 text-xs mt-1">
                          Próximamente podrás pagar tus deudas directamente desde esta plataforma.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sub-pestañas: Tickets por Pagar y Tickets Pagados */}
              <Tabs value={paymentSubTab} onValueChange={setPaymentSubTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="pending" className="gap-2">
                    <DollarSign className="h-4 w-4" />
                    Tickets por Pagar
                  </TabsTrigger>
                  <TabsTrigger value="paid" className="gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Tickets Pagados
                  </TabsTrigger>
                </TabsList>

                {/* Filtros Compartidos */}
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Filter className="h-5 w-5" />
                      Filtros
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Fecha Desde */}
                      <div>
                        <Label htmlFor="dateFrom">Desde</Label>
                        <Input
                          id="dateFrom"
                          type="date"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                        />
                      </div>

                      {/* Fecha Hasta */}
                      <div>
                        <Label htmlFor="dateTo">Hasta</Label>
                        <Input
                          id="dateTo"
                          type="date"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                        />
                      </div>

                      {/* Ordenamiento */}
                      <div>
                        <Label htmlFor="sortOrder">Ordenar por fecha</Label>
                        <Select value={sortOrder} onValueChange={(val: 'desc' | 'asc') => setSortOrder(val)}>
                          <SelectTrigger id="sortOrder">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desc">Más reciente primero</SelectItem>
                            <SelectItem value="asc">Más antiguo primero</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Botones de acción */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDateFrom('');
                          setDateTo('');
                          setSortOrder('desc');
                        }}
                      >
                        Limpiar Filtros
                      </Button>
                      <div className="flex-1"></div>
                      <div className="text-sm text-gray-600">
                        {paymentSubTab === 'pending' 
                          ? `${filteredPendingTransactions.length} ticket(s) pendiente(s)`
                          : `${filteredPaidTransactions.length} ticket(s) pagado(s)`
                        }
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Tickets por Pagar */}
                <TabsContent value="pending">
                  <Card>
                    <CardHeader>
                      <CardTitle>Tickets por Pagar</CardTitle>
                      <CardDescription>
                        Deudas pendientes de pago
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {filteredPendingTransactions.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 opacity-30 text-green-500" />
                          <p className="text-lg font-semibold mb-2">
                            {pendingTransactions.length === 0 ? '¡Sin deudas!' : 'No hay resultados'}
                          </p>
                          <p className="text-sm">
                            {pendingTransactions.length === 0 
                              ? 'No tienes tickets pendientes de pago.'
                              : 'Intenta ajustar los filtros de fecha.'
                            }
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {filteredPendingTransactions.map((transaction) => (
                            <div key={transaction.id} className="border border-red-200 bg-red-50 rounded-lg p-4">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <p className="font-semibold text-gray-900">
                                    {transaction.description}
                                  </p>
                                  <p className="text-sm text-gray-500">
                                    {new Date(transaction.created_at).toLocaleDateString('es-PE', {
                                      weekday: 'long',
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      timeZone: 'America/Lima'
                                    })}
                                  </p>
                                  {transaction.ticket_code && (
                                    <p className="text-xs text-gray-400 mt-1">
                                      Ticket: {transaction.ticket_code}
                                    </p>
                                  )}
                                </div>
                                <div className="text-right">
                                  <p className="text-2xl font-bold text-red-600">
                                    - S/ {Math.abs(transaction.amount).toFixed(2)}
                                  </p>
                                  <p className="text-xs text-red-600 mt-1 font-semibold">
                                    PENDIENTE
                                  </p>
                                </div>
                              </div>

                              {/* Detalle de items */}
                              {transaction.transaction_items && transaction.transaction_items.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-red-200">
                                  <p className="text-xs font-semibold text-gray-600 mb-2">Productos:</p>
                                  <div className="space-y-1">
                                    {transaction.transaction_items.map((item: any, idx: number) => (
                                      <div key={idx} className="flex justify-between text-sm">
                                        <span className="text-gray-700">
                                          {item.quantity}x {item.product_name}
                                        </span>
                                        <span className="text-gray-900 font-medium">
                                          S/ {item.subtotal.toFixed(2)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Tickets Pagados */}
                <TabsContent value="paid">
                  <Card>
                    <CardHeader>
                      <CardTitle>Tickets Pagados</CardTitle>
                      <CardDescription>
                        Historial de pagos realizados
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {filteredPaidTransactions.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                          <DollarSign className="h-16 w-16 mx-auto mb-4 opacity-30" />
                          <p className="text-lg font-semibold mb-2">
                            {paidTransactions.length === 0 ? 'Sin pagos registrados' : 'No hay resultados'}
                          </p>
                          <p className="text-sm">
                            {paidTransactions.length === 0
                              ? 'Aún no has realizado ningún pago.'
                              : 'Intenta ajustar los filtros de fecha.'
                            }
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {filteredPaidTransactions.map((transaction) => (
                            <div key={transaction.id} className="border border-green-200 bg-green-50 rounded-lg p-4">
                              <div className="flex justify-between items-start gap-4">
                                <div className="flex-1">
                                  <p className="font-semibold text-gray-900 text-lg">
                                    {transaction.description}
                                  </p>
                                  
                                  {/* Fecha y hora - Zona Horaria Peruana */}
                                  <div className="mt-2 space-y-1">
                                    <p className="text-sm text-gray-600">
                                      📅 <span className="font-medium">Fecha:</span> {new Date(transaction.created_at).toLocaleDateString('es-PE', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        timeZone: 'America/Lima'
                                      })}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                      🕐 <span className="font-medium">Hora:</span> {new Date(transaction.created_at).toLocaleTimeString('es-PE', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        timeZone: 'America/Lima'
                                      })}
                                    </p>
                                  </div>

                                  {/* Información del cajero */}
                                  {transaction.profiles && (
                                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                                      <p className="text-xs font-semibold text-blue-900">Cobrado por:</p>
                                      <p className="text-sm text-blue-800">{transaction.profiles.full_name}</p>
                                      {transaction.profiles.email && (
                                        <p className="text-xs text-blue-600">{transaction.profiles.email}</p>
                                      )}
                                    </div>
                                  )}

                                  {/* Sede */}
                                  {transaction.schools?.name && (
                                    <p className="text-xs text-gray-600 mt-2">
                                      🏫 <span className="font-medium">Sede:</span> {transaction.schools.name}
                                    </p>
                                  )}

                                  {/* Método de pago */}
                                  {transaction.payment_method && (
                                    <p className="text-xs text-gray-600 mt-1">
                                      💳 <span className="font-medium">Método:</span> {transaction.payment_method.toUpperCase()}
                                    </p>
                                  )}

                                  {/* Número de operación */}
                                  {transaction.operation_number && (
                                    <p className="text-xs text-gray-600 mt-1">
                                      🔢 <span className="font-medium">Nº Operación:</span> {transaction.operation_number}
                                    </p>
                                  )}

                                  {/* Ticket code */}
                                  {transaction.ticket_code && (
                                    <p className="text-xs text-gray-400 mt-1">
                                      🎫 Ticket: {transaction.ticket_code}
                                    </p>
                                  )}

                                  {/* Detalle de items */}
                                  {transaction.transaction_items && transaction.transaction_items.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-green-200">
                                      <p className="text-xs font-semibold text-gray-600 mb-2">Productos:</p>
                                      <div className="space-y-1">
                                        {transaction.transaction_items.map((item: any, idx: number) => (
                                          <div key={idx} className="flex justify-between text-sm">
                                            <span className="text-gray-700">
                                              {item.quantity}x {item.product_name}
                                            </span>
                                            <span className="text-gray-900 font-medium">
                                              S/ {item.subtotal.toFixed(2)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Monto y Botón */}
                                <div className="text-right flex flex-col items-end">
                                  <p className="text-2xl font-bold text-green-600 mb-2">
                                    + S/ {Math.abs(transaction.amount).toFixed(2)}
                                  </p>
                                  <p className="text-xs text-green-600 font-semibold mb-3">
                                    ✅ PAGADO
                                  </p>
                                  <Button
                                    onClick={() => generatePaymentReceipt(transaction)}
                                    variant="outline"
                                    size="sm"
                                    className="border-green-600 text-green-600 hover:bg-green-50"
                                  >
                                    <Download className="h-4 w-4 mr-1" />
                                    Comprobante
                                  </Button>
                                </div>
                              </div>

                              {/* Footer con branding */}
                              <div className="mt-3 pt-3 border-t border-green-200">
                                <p className="text-[10px] text-gray-500 text-center">
                                  Este es un comprobante interno generado • © 2026 ERP Profesional diseñado por ARQUISIA Soluciones para Lima Café 28
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* TAB: MENÚ */}
            <TabsContent value="menu">
              {teacherProfile.school_1_id && (
                <Tabs defaultValue="order" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="order" className="gap-2">
                      <UtensilsCrossed className="h-4 w-4" />
                      Hacer Pedido
                    </TabsTrigger>
                    <TabsTrigger value="my-orders" className="gap-2">
                      <ShoppingBag className="h-4 w-4" />
                      Mis Pedidos
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="order">
                    <OrderLunchMenus 
                      userType="teacher"
                      userId={teacherProfile.id}
                      userSchoolId={teacherProfile.school_1_id}
                    />
                  </TabsContent>

                  <TabsContent value="my-orders">
                    <Card>
                      <CardHeader>
                        <CardTitle>Mis Pedidos de Almuerzo</CardTitle>
                        <CardDescription>
                          Aquí verás todos los almuerzos que has solicitado
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <MyLunchOrders teacherId={teacherProfile.id} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-purple-600 mx-auto mb-4" />
              <p className="text-gray-600">Completando tu perfil...</p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Modal de Onboarding */}
      {showOnboarding && (
        <TeacherOnboardingModal
          open={showOnboarding}
          onComplete={handleOnboardingComplete}
        />
      )}
    </div>
  );
}
