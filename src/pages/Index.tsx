import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  GraduationCap, 
  LogOut, 
  Plus,
  History,
  X,
  Settings,
  Receipt,
  Users as UsersIcon,
  AlertCircle,
  Menu as MenuIcon,
  Home,
  Wallet,
  UtensilsCrossed,
  Calendar
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AddStudentModal } from '@/components/AddStudentModal';
import { UploadPhotoModal } from '@/components/UploadPhotoModal';
import { StudentCard } from '@/components/parent/StudentCard';
import { RechargeModal } from '@/components/parent/RechargeModal';
import { PayDebtModal } from '@/components/parent/PayDebtModal';
import { WeeklyMenuModal } from '@/components/parent/WeeklyMenuModal';
import { VersionBadge } from '@/components/VersionBadge';
import { FreeAccountWarningModal } from '@/components/parent/FreeAccountWarningModal';
import { FreeAccountOnboardingModal } from '@/components/parent/FreeAccountOnboardingModal';
import { SpendingLimitsModal } from '@/components/parent/SpendingLimitsModal';
import { PaymentsTab } from '@/components/parent/PaymentsTab';
import { StudentLinksManager } from '@/components/parent/StudentLinksManager';
import { MoreMenu } from '@/components/parent/MoreMenu';
import { PhotoConsentModal } from '@/components/parent/PhotoConsentModal';
import { PurchaseHistoryModal } from '@/components/parent/PurchaseHistoryModal';
import { LunchCalendarView } from '@/components/parent/LunchCalendarView';
import { LunchOrderCalendar } from '@/components/parent/LunchOrderCalendar';
import { UnifiedLunchCalendarV2 } from '@/components/lunch/UnifiedLunchCalendarV2';
import { ParentLunchOrders } from '@/components/parent/ParentLunchOrders';
import { ParentDataForm } from '@/components/parent/ParentDataForm';
import { useOnboardingCheck } from '@/hooks/useOnboardingCheck';

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  daily_limit: number;
  grade: string;
  section: string;
  is_active: boolean;
  school_id?: string;
  free_account?: boolean;
  school?: { id: string; name: string } | null;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
  balance_after: number;
  payment_method?: string;
  payment_status?: 'paid' | 'pending' | 'partial';
}

const Index = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { isChecking } = useOnboardingCheck();
  
  const [students, setStudents] = useState<Student[]>([]);
  const [studentDebts, setStudentDebts] = useState<Record<string, number>>({}); // 💰 Deudas por estudiante
  const [loading, setLoading] = useState(true);
  const [parentName, setParentName] = useState<string>('');
  const [parentProfileData, setParentProfileData] = useState<any>(null); // 👤 Datos del perfil del padre
  const [showAddStudent, setShowAddStudent] = useState(false);
  // Estado para la navegación por pestañas
  const [activeTab, setActiveTab] = useState(() => {
    // Restaurar la pestaña guardada al recargar
    return sessionStorage.getItem('parentPortalTab') || 'alumnos';
  });

  // Guardar la pestaña activa cuando cambia
  useEffect(() => {
    sessionStorage.setItem('parentPortalTab', activeTab);
  }, [activeTab]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showParentDataForm, setShowParentDataForm] = useState(false);
  const [isParentFormLoading, setIsParentFormLoading] = useState(false);
  
  // Modales
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [showPayDebtModal, setShowPayDebtModal] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false); // Nuevo
  const [showUploadPhoto, setShowUploadPhoto] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showFreeAccountWarning, setShowFreeAccountWarning] = useState(false);
  const [showLinksManager, setShowLinksManager] = useState(false);
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [photoConsentAccepted, setPhotoConsentAccepted] = useState(false);
  const [photoConsentRefresh, setPhotoConsentRefresh] = useState(0); // Para forzar refresh en MoreMenu
  const [showLunchFastConfirm, setShowLunchFastConfirm] = useState(false);
  const [todayMenu, setTodayMenu] = useState<any>(null);
  const [isOrdering, setIsOrdering] = useState(false);
  
  // Estudiante seleccionado
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Estado para evitar doble apertura
  const [isOpeningPhotoModal, setIsOpeningPhotoModal] = useState(false);

  useEffect(() => {
    fetchStudents();
    fetchParentProfile();
    checkOnboardingStatus();
  }, [user]);

  const fetchParentProfile = async () => {
    if (!user) return;
    try {
      // Obtener nombre del responsable de pago principal desde parent_profiles
      const { data: parentProfileData, error: parentProfileError } = await supabase
        .from('parent_profiles')
        .select('full_name, photo_consent')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Si existe el nombre en parent_profiles, usarlo (prioridad)
      if (parentProfileData && parentProfileData.full_name) {
        setParentName(parentProfileData.full_name);
        setParentProfileData(parentProfileData); // Guardar datos completos en el estado
        
        // Verificar consentimiento de fotos
        if (parentProfileData.photo_consent === true) {
          setPhotoConsentAccepted(true);
          console.log('✅ Photo consent already accepted');
        } else {
          console.log('⚠️ Photo consent not found or not accepted');
        }
      } else {
        // Fallback: obtener nombre del perfil básico
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, school_id')
          .eq('id', user.id)
          .single();
        
        if (profileData) {
          if (profileData.full_name) {
            setParentName(profileData.full_name);
          }
          setParentProfileData(profileData); // Guardar datos del perfil básico
        }
      }
    } catch (e) {
      console.error("Error fetching parent profile:", e);
    }
  };

  const checkOnboardingStatus = async () => {
    if (!user) return;
    try {
      // PASO 1: Verificar si los datos del padre están completos (incluyendo segundo responsable)
      const { data: parentData, error: parentError } = await supabase
        .from('parent_profiles')
        .select('full_name, dni, phone_1, address, legal_acceptance, responsible_2_full_name, responsible_2_dni, responsible_2_phone_1')
        .eq('user_id', user.id)
        .maybeSingle();

      if (parentError) {
        console.error('Error checking parent data:', parentError);
        return;
      }

      // Verificar RESPONSABLE PRINCIPAL
      const mainResponsibleComplete = parentData?.full_name && parentData?.dni && parentData?.phone_1 && parentData?.address && parentData?.legal_acceptance;
      
      // Verificar SEGUNDO RESPONSABLE
      const secondResponsibleComplete = parentData?.responsible_2_full_name && parentData?.responsible_2_dni && parentData?.responsible_2_phone_1;

      // Si faltan datos de CUALQUIERA de los dos responsables, mostrar formulario PRIMERO
      if (!parentData || !mainResponsibleComplete || !secondResponsibleComplete) {
        console.log('📋 Datos del padre o segundo responsable incompletos, mostrando formulario...');
        console.log('  - Responsable principal completo:', mainResponsibleComplete);
        console.log('  - Segundo responsable completo:', secondResponsibleComplete);
        setShowParentDataForm(true);
        return;
      }

      // PASO 2: Si los datos están completos, verificar el onboarding de cuenta libre
      const { data, error } = await supabase
        .from('profiles')
        .select('free_account_onboarding_completed')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      
      // Si no ha completado el onboarding de cuenta libre, mostrar el modal
      if (!data?.free_account_onboarding_completed) {
        setShowOnboarding(true);
      }
    } catch (e) {
      console.error("Error checking onboarding status:", e);
    }
  };

  const handleOnboardingComplete = async () => {
    if (!user) return;
    try {
      await supabase
        .from('profiles')
        .update({ free_account_onboarding_completed: true })
        .eq('id', user.id);
      
      setShowOnboarding(false);
      
      // Verificar si tiene hijos, si no, abrir modal para agregar
      const { data: studentsData } = await supabase
        .from('students')
        .select('id')
        .eq('parent_id', user.id)
        .limit(1);
      
      if (!studentsData || studentsData.length === 0) {
        // No tiene hijos, abrir modal para agregar el primero
        toast({
          title: '👨‍👩‍👧‍👦 Agregar tus hijos',
          description: 'Por favor, agrega a tus hijos para comenzar a usar el portal',
          duration: 5000,
        });
        setShowAddStudent(true);
      } else {
        toast({
          title: '✅ ¡Bienvenido!',
          description: 'Ya puedes comenzar a usar el portal',
        });
      }
    } catch (e) {
      console.error("Error completing onboarding:", e);
    }
  };

  const fetchStudents = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('students')
        .select('*, school:schools(id, name)')
        .eq('parent_id', user.id)
        .eq('is_active', true)
        .order('full_name', { ascending: true});

      if (error) throw error;
      
      setStudents(data || []);
      
      // ✅ Calcular deudas con delay para cada estudiante
      if (data && data.length > 0) {
        await calculateStudentDebts(data);
      }
    } catch (error: any) {
      console.error('Error fetching students:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los estudiantes',
      });
    } finally {
      setLoading(false);
    }
  };

  // ✅ Calcular deuda de cada estudiante respetando el delay
  const calculateStudentDebts = async (studentsData: Student[]) => {
    const debtsMap: Record<string, number> = {};
    
    for (const student of studentsData) {
      // Solo calcular deuda para estudiantes con cuenta libre
      if (student.free_account === false) {
        debtsMap[student.id] = 0;
        continue;
      }

      try {
        // Obtener delay configurado para la sede del estudiante
        console.log('🔍 Buscando delay para:', {
          studentName: student.full_name,
          schoolId: student.school_id
        });

        const { data: delayData, error: delayError } = await supabase
          .from('purchase_visibility_delay')
          .select('delay_days')
          .eq('school_id', student.school_id)
          .maybeSingle();

        console.log('📦 Resultado de búsqueda de delay:', {
          studentName: student.full_name,
          delayData,
          delayError,
          valorFinal: delayData?.delay_days ?? 2
        });

        const delayDays = delayData?.delay_days ?? 2;
        
        // ✅ Construir query base
        let query = supabase
          .from('transactions')
          .select('amount')
          .eq('student_id', student.id)
          .eq('type', 'purchase')
          .eq('payment_status', 'pending');

        // ✅ Solo aplicar filtro de fecha si delay > 0
        if (delayDays > 0) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - delayDays);
          const cutoffDateISO = cutoffDate.toISOString();

          console.log('📅 Filtro de delay aplicado (StudentCard):', {
            studentName: student.full_name,
            schoolId: student.school_id,
            delayDays,
            hoy: new Date().toLocaleString('es-PE'),
            cutoffDate: cutoffDate.toLocaleString('es-PE'),
            cutoffDateISO,
            message: `Solo deudas HASTA ${cutoffDate.toLocaleDateString('es-PE')}`
          });

          query = query.lte('created_at', cutoffDateISO);
        } else {
          console.log('⚡ Modo EN VIVO (StudentCard) - Sin filtro de delay:', {
            studentName: student.full_name,
            schoolId: student.school_id,
            message: 'Mostrando TODAS las deudas pendientes'
          });
        }

        // ✅ Ejecutar query
        const { data: transactions } = await query;

        const totalDebt = transactions?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
        debtsMap[student.id] = totalDebt;
        
        console.log('💰 Deuda calculada (StudentCard):', {
          studentName: student.full_name,
          totalDebt,
          transaccionesPendientes: transactions?.length || 0
        });
      } catch (error) {
        console.error(`Error calculating debt for student ${student.id}:`, error);
        debtsMap[student.id] = 0;
      }
    }
    
    setStudentDebts(debtsMap);
  };

  const handleRecharge = async (amount: number, method: string) => {
    if (!selectedStudent) return;
    
    try {
      const newBalance = selectedStudent.balance + amount;

      const { error: transError } = await supabase
        .from('transactions')
        .insert({
          student_id: selectedStudent.id,
          type: 'recharge',
          amount: amount,
          description: `Recarga vía ${method === 'yape' ? 'Yape' : method === 'plin' ? 'Plin' : method === 'card' ? 'Tarjeta' : 'Banco'}`,
          balance_after: newBalance,
          created_by: user?.id,
          payment_method: method,
        });

      if (transError) throw transError;

      const { error: updateError } = await supabase
        .from('students')
        .update({ balance: newBalance })
        .eq('id', selectedStudent.id);

      if (updateError) throw updateError;

      toast({
        title: '✅ ¡Recarga Exitosa!',
        description: `Nuevo saldo: S/ ${newBalance.toFixed(2)}`,
      });

      await fetchStudents();
      
    } catch (error: any) {
      console.error('Error en recarga:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo completar la recarga',
      });
      throw error;
    }
  };

  const openRechargeModal = (student: Student) => {
    // 🔒 MÓDULO DE PAGOS/RECARGAS DESACTIVADO TEMPORALMENTE
    // Todo pago es presencial en caja
    toast({
      title: '💳 Pagos presenciales',
      description: 'Los pagos y recargas se realizan presencialmente en la cafetería del colegio. Pronto habilitaremos pagos en línea.',
    });
    return;
    
    /* CÓDIGO ORIGINAL - Restaurar cuando se habiliten pagos en línea:
    setSelectedStudent(student);
    const hasDebts = student.balance < 0;
    if (hasDebts) {
      setShowPayDebtModal(true);
      setShowRechargeModal(false);
    } else {
      setShowRechargeModal(true);
      setShowPayDebtModal(false);
    }
    */
  };

  const openMenuModal = (student: Student) => {
    setSelectedStudent(student);
    setShowMenuModal(true);
  };

  const openHistoryModal = (student: Student) => {
    setSelectedStudent(student);
    setShowHistoryModal(true);
  };

  const openCalendarModal = (student: Student) => {
    setSelectedStudent(student);
    setShowCalendarModal(true);
  };

  const openPhotoModal = async (student: Student) => {
    // Prevenir múltiples llamadas simultáneas
    if (isOpeningPhotoModal) {
      console.log('⚠️ Already opening photo modal, ignoring duplicate call');
      return;
    }

    setIsOpeningPhotoModal(true);
    setSelectedStudent(student);
    
    console.log('🔍 openPhotoModal called for:', student.full_name);
    console.log('🔍 Current photoConsentAccepted (state):', photoConsentAccepted);
    
    // Verificar EN VIVO desde la base de datos
    if (user?.id) {
      try {
        const { data: consentData, error } = await supabase
          .from('parent_profiles')
          .select('photo_consent')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('❌ Error checking consent:', error);
        }

        const hasConsent = consentData?.photo_consent === true;
        console.log('🔍 photo_consent from database:', hasConsent);

        if (hasConsent) {
          console.log('✅ User has consent - opening photo upload');
          setPhotoConsentAccepted(true);
          setShowUploadPhoto(true);
        } else {
          console.log('⚠️ No consent found - showing consent modal');
          setShowPhotoConsent(true);
        }
      } catch (error) {
        console.error('❌ Exception in openPhotoModal:', error);
      }
    } else {
      console.log('⚠️ No user ID - cannot check consent');
    }

    // Liberar el lock después de un breve delay
    setTimeout(() => {
      setIsOpeningPhotoModal(false);
    }, 500);
  };

  const handlePhotoConsentAccept = () => {
    setPhotoConsentAccepted(true);
    setShowPhotoConsent(false);
    setShowUploadPhoto(true);
    setPhotoConsentRefresh(prev => prev + 1); // Forzar refresh del estado en MoreMenu
    
    // Refrescar el perfil para confirmar que se guardó
    fetchParentProfile();
  };

  const openSettingsModal = (student: Student) => {
    setSelectedStudent(student);
    setShowLimitModal(true);
  };

  const handleLunchFast = async (student: Student) => {
    setSelectedStudent(student);
    try {
      const { data, error } = await supabase.rpc('get_today_lunch_menu', {
        p_school_id: student.school_id
      });

      if (error) throw error;

      const menu = data?.[0];
      if (!menu || menu.is_special_day || !menu.main_course) {
        toast({
          title: "Lunch Fast no disponible",
          description: menu?.special_day_title || "No hay menú programado para el día de hoy.",
          variant: "destructive"
        });
        return;
      }

      setTodayMenu(menu);
      setShowLunchFastConfirm(true);
    } catch (error) {
      console.error('Error in handleLunchFast:', error);
      toast({
        title: "Error",
        description: "No se pudo consultar el menú de hoy",
        variant: "destructive"
      });
    }
  };

  const handleConfirmLunchOrder = async () => {
    if (!selectedStudent || !todayMenu) return;
    
    setIsOrdering(true);
    try {
      // Registrar la orden de almuerzo como una compra inmediata
      const amount = todayMenu.price || 15.00;
      
      // Si es cuenta libre, crear transacción pendiente (deuda)
      if (selectedStudent.free_account !== false) {
        const { error } = await supabase.from('transactions').insert({
          student_id: selectedStudent.id,
          type: 'purchase',
          amount: -Math.abs(amount), // Negativo = deuda
          description: `LUNCH FAST: ${todayMenu.main_course}`,
          payment_status: 'pending',
          created_by: user?.id,
          metadata: { lunch_menu_id: todayMenu.id, source: 'lunch_fast' }
        });

        if (error) throw error;
      } else {
        // Si es cuenta prepagada, solo descontar del saldo (NO crear transacción)
        // El pago ya se registró cuando recargó el saldo
        const { error: balanceError } = await supabase
          .from('students')
          .update({ balance: selectedStudent.balance - amount })
          .eq('id', selectedStudent.id);

        if (balanceError) throw balanceError;
      }

      toast({
        title: "¡Pedido Confirmado! 🚀",
        description: `Se ha separado el almuerzo para ${selectedStudent.full_name}`,
      });

      await fetchStudents();
      setShowLunchFastConfirm(false);
    } catch (error) {
      console.error('Error confirming lunch order:', error);
      toast({
        title: "Error",
        description: "No se pudo procesar el pedido",
        variant: "destructive"
      });
    } finally {
      setIsOrdering(false);
    }
  };

  const handleToggleFreeAccount = async (student: Student, newValue: boolean) => {
    // VALIDACIÓN: Si intenta pasar a Prepago (newValue = false) y TIENE DEUDA (balance < 0)
    if (newValue === false && student.balance < 0) {
      toast({
        variant: "destructive",
        title: "🚫 Acción Bloqueada",
        description: `Para pasar al modo Prepago, primero debes cancelar la deuda actual de S/ ${Math.abs(student.balance).toFixed(2)}.`,
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('students')
        .update({ free_account: newValue })
        .eq('id', student.id);

      if (error) throw error;

      // Si pasa de Prepago a Cuenta Libre y tiene saldo a favor
      const saldoAFavor = !newValue && student.balance > 0;

      toast({
        title: newValue ? '✅ Cuenta Libre Activada' : '🔒 Cuenta Libre Desactivada',
        description: newValue 
          ? `${student.full_name} ahora puede consumir y pagar después. ${student.balance > 0 ? 'Tu saldo a favor se descontará automáticamente.' : ''}` 
          : `${student.full_name} ahora está en modo Prepago (Recargas).`,
      });

      await fetchStudents();
    } catch (error: any) {
      console.error('Error toggling free account:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cambiar el modo de cuenta',
      });
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  if (isChecking || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9] pb-20 sm:pb-24">
      {/* Header Minimalista y Elegante - Responsive */}
      <header className="bg-white border-b border-stone-200/50 sticky top-0 z-40 shadow-sm backdrop-blur-sm bg-white/95">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 md:py-5">
          <div className="flex items-center justify-between">
            {/* Logo y Título - Más compacto en móvil */}
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="w-9 h-9 sm:w-10 sm:h-10 md:w-11 md:h-11 bg-gradient-to-br from-emerald-600/90 via-[#8B7355] to-[#6B5744] rounded-xl sm:rounded-2xl flex items-center justify-center shadow-sm">
                <GraduationCap className="h-5 w-5 sm:h-5.5 sm:w-5.5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg md:text-xl font-light text-[#6B5744] tracking-wide">Lima Café 28</h1>
                <p className="text-[9px] sm:text-[10px] font-medium text-stone-400 uppercase tracking-[0.2em] sm:tracking-[0.25em]">Portal de Padres</p>
              </div>
            </div>
            
            {/* Nombre usuario - Hidden en móvil, visible en tablet+ */}
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="hidden md:block text-right">
                <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wider">Bienvenido</p>
                <p className="text-sm font-medium text-stone-700">{parentName || 'Padre de Familia'}</p>
              </div>
              {/* VersionBadge hidden en móvil */}
              <div className="hidden sm:block">
                <VersionBadge />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Padding responsivo */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-10">
        {/* Pestaña Alumnos */}
        <div className={activeTab !== 'alumnos' ? 'hidden' : ''}>
          <div className="space-y-6 sm:space-y-8">
            {/* Título - Más pequeño en móvil */}
            <div className="mb-4 sm:mb-6 md:mb-8">
              <h2 className="text-2xl sm:text-2xl md:text-3xl font-light text-stone-800 tracking-wide mb-1 sm:mb-2">Mis Hijos</h2>
              <p className="text-stone-400 font-normal text-xs sm:text-sm tracking-wide">Gestión centralizada de cuentas escolares</p>
            </div>

            {students.length === 0 ? (
              <Card className="border border-dashed border-stone-300/50 bg-white shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16 md:py-20 px-4">
                  <GraduationCap className="h-12 w-12 sm:h-13 sm:w-13 md:h-14 md:w-14 text-stone-300 mb-4 sm:mb-5 md:mb-6" />
                  <h3 className="text-lg sm:text-xl font-normal text-stone-800 mb-2 sm:mb-3 tracking-wide text-center">
                    No hay estudiantes registrados
                  </h3>
                  <p className="text-stone-500 mb-6 sm:mb-7 md:mb-8 text-center max-w-md text-xs sm:text-sm leading-relaxed px-2">
                    Agrega a tu primer hijo para empezar a usar el kiosco escolar
                  </p>
                  <Button 
                    size="lg" 
                    onClick={() => setShowAddStudent(true)}
                    className="bg-gradient-to-r from-emerald-600/90 via-[#8B7355] to-[#6B5744] hover:from-emerald-700/90 hover:via-[#6B5744] hover:to-[#5B4734] text-white shadow-md transition-all duration-300 h-12 sm:h-auto text-sm sm:text-base"
                  >
                    <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                    Agregar Mi Primer Hijo
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Grid - 1 columna en móvil, 2 en tablet, 3 en desktop */}
                <div className="grid gap-4 sm:gap-5 md:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                  {students.map((student) => (
                    <StudentCard
                      key={student.id}
                      student={student}
                      totalDebt={studentDebts[student.id] || 0} // 💰 Pasar deuda calculada con delay
                      onRecharge={() => openRechargeModal(student)}
                      onViewHistory={() => openHistoryModal(student)}
                      onLunchFast={() => handleLunchFast(student)}
                      onViewMenu={() => openMenuModal(student)}
                      onOpenSettings={() => openSettingsModal(student)}
                      onPhotoClick={() => openPhotoModal(student)}
                      // onViewCalendar={() => openCalendarModal(student)} // Deshabilitado temporalmente
                    />
                  ))}
                </div>

                {/* Card para agregar más estudiantes */}
                <Card 
                  className="border border-dashed border-stone-300/50 hover:border-emerald-500/50 hover:bg-emerald-50/30 transition-all duration-300 cursor-pointer shadow-sm"
                  onClick={() => setShowAddStudent(true)}
                >
                  <CardContent className="flex items-center justify-center py-6 sm:py-7 md:py-8">
                    <Plus className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600 mr-2" />
                    <span className="text-emerald-700 font-normal tracking-wide text-sm sm:text-base">Agregar otro estudiante</span>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>

        {/* Pestaña Pagos */}
        <div className={activeTab !== 'pagos' ? 'hidden' : ''}>
          {user?.id && <PaymentsTab userId={user.id} />}
        </div>

        {/* Pestaña Almuerzos */}
        <div className={activeTab !== 'almuerzos' ? 'hidden' : ''}>
          {user && (
            <div className="px-2 sm:px-4 space-y-4 sm:space-y-6">
              {/* Sub-pestañas para Almuerzos */}
              <Tabs defaultValue="hacer-pedido" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-auto">
                  <TabsTrigger value="hacer-pedido" className="text-xs sm:text-sm py-2 sm:py-3">
                    <UtensilsCrossed className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    Hacer Pedido
                  </TabsTrigger>
                  <TabsTrigger value="mis-pedidos" className="text-xs sm:text-sm py-2 sm:py-3">
                    <Calendar className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    Mis Pedidos
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="hacer-pedido" className="mt-4 sm:mt-6">
                  {/* Calendario unificado V2 con wizard paso a paso */}
                  {user && parentProfileData && (
                    <UnifiedLunchCalendarV2 
                      userType="parent"
                      userId={user.id}
                      userSchoolId={parentProfileData.school_id || ''}
                    />
                  )}
                </TabsContent>
                
                <TabsContent value="mis-pedidos" className="mt-4 sm:mt-6">
                  {/* Mis Pedidos de Almuerzo */}
                  <ParentLunchOrders parentId={user.id} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>

      </main>

      {/* MODALES */}
      <AddStudentModal
        isOpen={showAddStudent}
        onClose={() => setShowAddStudent(false)}
        onSuccess={fetchStudents}
      />

      {/* Modal de Calendario de Pedidos de Almuerzos */}
      <LunchOrderCalendar
        isOpen={showMenuModal}
        onClose={() => setShowMenuModal(false)}
        parentId={user?.id || ''}
      />

      {selectedStudent && (
        <>
          <RechargeModal
            isOpen={showRechargeModal}
            onClose={() => setShowRechargeModal(false)}
            studentName={selectedStudent.full_name}
            studentId={selectedStudent.id}
            currentBalance={selectedStudent.balance}
            accountType="free"
            onRecharge={handleRecharge}
          />

          <PayDebtModal
            isOpen={showPayDebtModal}
            onClose={() => setShowPayDebtModal(false)}
            studentName={selectedStudent.full_name}
            studentId={selectedStudent.id}
            onPaymentComplete={fetchStudents}
          />

          <UploadPhotoModal
            isOpen={showUploadPhoto}
            onClose={() => setShowUploadPhoto(false)}
            studentId={selectedStudent.id}
            studentName={selectedStudent.full_name}
            onSuccess={fetchStudents}
            skipConsent={true} // Saltar el consentimiento porque ya fue validado
          />

          {/* Modal de Límites de Gasto */}
          <SpendingLimitsModal
            open={showLimitModal}
            onOpenChange={setShowLimitModal}
            studentId={selectedStudent.id}
            studentName={selectedStudent.full_name}
            onSuccess={fetchStudents}
          />

          {/* Modal de Historial de Compras */}
          {selectedStudent && (
            <PurchaseHistoryModal
              isOpen={showHistoryModal}
              onClose={() => setShowHistoryModal(false)}
              studentId={selectedStudent.id}
              studentName={selectedStudent.full_name}
            />
          )}

          {/* Modal de Calendario de Almuerzos */}
          {selectedStudent && (
            <Dialog open={showCalendarModal} onOpenChange={setShowCalendarModal}>
              <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                <LunchCalendarView
                  studentId={selectedStudent.id}
                  studentName={selectedStudent.full_name}
                />
              </DialogContent>
            </Dialog>
          )}

          {/* Modal de Confirmación LUNCH FAST */}
          <Dialog open={showLunchFastConfirm} onOpenChange={setShowLunchFastConfirm}>
            <DialogContent className="max-w-md border-4 border-orange-500">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black text-center text-orange-600">
                  ¿CONFIRMAR ALMUERZO HOY?
                </DialogTitle>
                <DialogDescription className="text-center pt-2">
                  Se realizará el pedido para <span className="font-bold text-gray-900">{selectedStudent.full_name}</span>
                </DialogDescription>
              </DialogHeader>

              {todayMenu && (
                <div className="bg-orange-50 rounded-2xl p-6 border-2 border-orange-200 shadow-inner">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start border-b border-orange-200 pb-2">
                      <span className="text-xs font-bold text-orange-700 uppercase">Entrada</span>
                      <span className="text-sm font-semibold text-gray-800">{todayMenu.starter || 'Sopa del día'}</span>
                    </div>
                    <div className="flex justify-between items-start border-b border-orange-200 pb-2">
                      <span className="text-xs font-bold text-orange-700 uppercase">Segundo</span>
                      <span className="text-sm font-bold text-gray-900">{todayMenu.main_course}</span>
                    </div>
                    <div className="flex justify-between items-start border-b border-orange-200 pb-2">
                      <span className="text-xs font-bold text-orange-700 uppercase">Bebida</span>
                      <span className="text-sm font-semibold text-gray-800">{todayMenu.beverage || 'Refresco natural'}</span>
                    </div>
                    <div className="flex justify-center pt-4">
                      <div className="text-center">
                        <span className="text-xs font-bold text-gray-500 uppercase block">Total a pagar</span>
                        <span className="text-4xl font-black text-orange-600">S/ {(todayMenu.price || 15).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setShowLunchFastConfirm(false)}
                  className="h-14 font-bold border-2"
                  disabled={isOrdering}
                >
                  Cancelar
                </Button>
                <Button 
                  onClick={handleConfirmLunchOrder}
                  className="h-14 font-black bg-orange-600 hover:bg-orange-700 text-lg shadow-lg"
                  disabled={isOrdering}
                >
                  {isOrdering ? 'Procesando...' : '¡SÍ, PEDIR!'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Modal de Advertencia de Cuenta Libre */}
      {selectedStudent && (
        <>
          <PhotoConsentModal
            open={showPhotoConsent}
            onOpenChange={setShowPhotoConsent}
            onAccept={handlePhotoConsentAccept}
            studentName={selectedStudent.full_name}
            parentId={user?.id || ''}
          />

          <FreeAccountWarningModal
            open={showFreeAccountWarning}
            onOpenChange={setShowFreeAccountWarning}
            studentName={selectedStudent.full_name}
            onConfirmDisable={() => handleToggleFreeAccount(selectedStudent, false)}
          />

          <StudentLinksManager
            open={showLinksManager}
            onOpenChange={setShowLinksManager}
            student={selectedStudent}
            allStudents={students}
            onLinksUpdated={fetchStudents}
          />
        </>
      )}

      {activeTab === 'mas' && (
        <MoreMenu 
          key={photoConsentRefresh} 
          userEmail={user?.email || ''} 
          onLogout={handleLogout} 
        />
      )}

      {/* Navegación Inferior Fija - Optimizada para móvil */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-stone-200/50 shadow-lg z-50">
        <div className="max-w-7xl mx-auto px-1 sm:px-2">
          <div className="grid grid-cols-4 gap-0.5 sm:gap-1">
            <button
              onClick={() => setActiveTab('alumnos')}
              className={`flex flex-col items-center justify-center py-2.5 sm:py-3 transition-all duration-200 rounded-lg ${
                activeTab === 'alumnos'
                  ? 'text-emerald-700 bg-emerald-50'
                  : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50/30'
              }`}
            >
              <Home className="h-5 w-5 sm:h-6 sm:w-6 mb-0.5 sm:mb-1" />
              <span className="text-[10px] sm:text-xs font-normal tracking-wide">Mis Hijos</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('almuerzos');
              }}
              className={`flex flex-col items-center justify-center py-2.5 sm:py-3 transition-all duration-200 rounded-lg ${
                activeTab === 'almuerzos'
                  ? 'text-emerald-700 bg-emerald-50'
                  : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50/30'
              }`}
            >
              <UtensilsCrossed className="h-5 w-5 sm:h-6 sm:w-6 mb-0.5 sm:mb-1" />
              <span className="text-[10px] sm:text-xs font-normal tracking-wide">Almuerzos</span>
            </button>

            <button
              onClick={() => setActiveTab('pagos')}
              className={`flex flex-col items-center justify-center py-2.5 sm:py-3 transition-all duration-200 rounded-lg ${
                activeTab === 'pagos'
                  ? 'text-emerald-700 bg-emerald-50'
                  : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50/30'
              }`}
            >
              <Wallet className="h-5 w-5 sm:h-6 sm:w-6 mb-0.5 sm:mb-1" />
              <span className="text-[10px] sm:text-xs font-normal tracking-wide">Pagos</span>
            </button>

            <button
              onClick={() => setActiveTab('mas')}
              className={`flex flex-col items-center justify-center py-2.5 sm:py-3 transition-all duration-200 rounded-lg ${
                activeTab === 'mas'
                  ? 'text-emerald-700 bg-emerald-50'
                  : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50/30'
              }`}
            >
              <MenuIcon className="h-5 w-5 sm:h-6 sm:w-6 mb-0.5 sm:mb-1" />
              <span className="text-[10px] sm:text-xs font-normal tracking-wide">Más</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Footer - Créditos del sistema */}
      <div className="fixed bottom-16 sm:bottom-20 left-0 right-0 pointer-events-none z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-gradient-to-r from-emerald-50/80 to-blue-50/80 backdrop-blur-sm border border-emerald-200/50 rounded-lg shadow-sm py-2 px-4 pointer-events-auto">
            <div className="flex items-center justify-center gap-2 text-[10px] sm:text-xs text-gray-600">
              <span className="font-medium">©</span>
              <span>2026 <span className="font-semibold text-emerald-700">ERP Profesional</span></span>
            </div>
            <div className="text-center text-[9px] sm:text-[10px] text-gray-500 mt-1">
              Diseñado por <span className="font-semibold text-emerald-600">ARQUISIA Soluciones</span> para <span className="font-semibold text-blue-600">Lima Café 28</span>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Formulario de Datos del Padre (PRIMERO) */}
      {showParentDataForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-4">
            <ParentDataForm
              onSuccess={() => {
                setShowParentDataForm(false);
                // Ir directamente al modal de cuenta libre sin volver a verificar
                setShowOnboarding(true);
              }}
              isLoading={isParentFormLoading}
              setIsLoading={setIsParentFormLoading}
            />
          </div>
        </div>
      )}

      {/* Modal de Onboarding - Cuenta Libre (DESPUÉS) */}
      <FreeAccountOnboardingModal
        open={showOnboarding}
        onAccept={handleOnboardingComplete}
        parentName={parentName || 'Padre de Familia'}
      />
    </div>
  );
};

export default Index;
