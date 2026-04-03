import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDebouncedSync } from '@/stores/billingSync';
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
  AlertTriangle,
  Menu as MenuIcon,
  Home,
  ShoppingCart,
  UtensilsCrossed,
  Calendar,
  CreditCard,
  BookOpen,
  User
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AddStudentModal } from '@/components/AddStudentModal';
import { UploadPhotoModal } from '@/components/UploadPhotoModal';
import { StudentCard } from '@/components/parent/StudentCard';
import { RechargeModal } from '@/components/parent/RechargeModal';
import { WeeklyMenuModal } from '@/components/parent/WeeklyMenuModal';
import { VersionBadge } from '@/components/VersionBadge';
import { FreeAccountWarningModal } from '@/components/parent/FreeAccountWarningModal';
import { FreeAccountOnboardingModal } from '@/components/parent/FreeAccountOnboardingModal';
import { SpendingLimitsModal } from '@/components/parent/SpendingLimitsModal';
import { PaymentsTab } from '@/components/parent/PaymentsTab';
import { PaymentHistoryTab } from '@/components/parent/PaymentHistoryTab';
import { StudentLinksManager } from '@/components/parent/StudentLinksManager';
import { MoreMenu } from '@/components/parent/MoreMenu';
import { TempPasswordForm } from '@/components/parent/TempPasswordForm';
import { PhotoConsentModal } from '@/components/parent/PhotoConsentModal';
import { PurchaseHistoryModal } from '@/components/parent/PurchaseHistoryModal';
import { LunchCalendarView } from '@/components/parent/LunchCalendarView';
import { LunchOrderCalendar } from '@/components/parent/LunchOrderCalendar';
import { UnifiedLunchCalendarV2 } from '@/components/lunch/UnifiedLunchCalendarV2';
import { ParentLunchOrders } from '@/components/parent/ParentLunchOrders';
import { ParentDataForm } from '@/components/parent/ParentDataForm';
import { EditStudentModal } from '@/components/parent/EditStudentModal';
import { useOnboardingCheck } from '@/hooks/useOnboardingCheck';
import { MaintenanceScreen } from '@/components/parent/MaintenanceScreen';
import { ErickaTutorial } from '@/components/parent/ErickaTutorial';
import { BalanceHero } from '@/components/parent/BalanceHero';
import { HeroActions } from '@/components/parent/HeroActions';
import { ServicesGrid } from '@/components/parent/ServicesGrid';
import { ChildCarouselHeader } from '@/components/parent/ChildCarouselHeader';

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  daily_limit: number;
  weekly_limit: number;
  monthly_limit: number;
  limit_type: string;
  grade: string;
  section: string;
  is_active: boolean;
  school_id?: string;
  level_id?: string | null;
  classroom_id?: string | null;
  free_account?: boolean;
  kiosk_disabled?: boolean;
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
  const { user, signOut, isTempPassword, clearTempPasswordFlag } = useAuth();
  const { toast } = useToast();
  const { isChecking } = useOnboardingCheck();
  const balanceSyncTs = useDebouncedSync('balances', 800);
  
  const [students, setStudents] = useState<Student[]>([]);
  const [studentDebts, setStudentDebts] = useState<Record<string, { lunchDebt: number; kioskDebt: number; totalDebt: number }>>({}); // 💰 Deudas por estudiante
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0); // 🔴 Contador de pagos pendientes
  const [pendingRechargesMap, setPendingRechargesMap] = useState<Record<string, number>>({}); // ⏳ Recargas pendientes por estudiante
  const [loading, setLoading] = useState(true);

  // ── CARRUSEL ────────────────────────────────────────────────────────────────
  // ID del hijo actualmente visible en el carrusel (persiste en localStorage)
  const [activeStudentId, setActiveStudentId] = useState<string | null>(() => {
    try { return localStorage.getItem('parentPortalActiveStudentId') || null; }
    catch { return null; }
  });
  // Lock de 300ms: evita que un deslizamiento rápido abra modales del hijo incorrecto
  const [isTransitioning, setIsTransitioning] = useState(false);
  // Ref al contenedor del carrusel para leer scrollLeft
  const carouselRef = useRef<HTMLDivElement>(null);
  // ────────────────────────────────────────────────────────────────────────────
  const [parentName, setParentName] = useState<string>('');
  const [parentProfileData, setParentProfileData] = useState<any>(null); // 👤 Datos del perfil del padre
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showTutorialManual, setShowTutorialManual] = useState(false);
  const [tutorialManualKey, setTutorialManualKey] = useState(0);
  const [tutorialModuleEnabled, setTutorialModuleEnabled] = useState(false);
  // Estado para la navegación por pestañas
  const [activeTab, setActiveTab] = useState(() => {
    // Restaurar la pestaña guardada al recargar
    return sessionStorage.getItem('parentPortalTab') || 'alumnos';
  });

  // Guardar la pestaña activa cuando cambia + refrescar datos
  useEffect(() => {
    sessionStorage.setItem('parentPortalTab', activeTab);
    // Refrescar contador de pagos pendientes al cambiar de pestaña
    fetchPendingPaymentsCount();
    // Refrescar deudas del StudentCard cuando el padre vuelve a "alumnos"
    if (activeTab === 'alumnos' && students.length > 0) {
      calculateStudentDebts(students);
    }
  }, [activeTab]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showParentDataForm, setShowParentDataForm] = useState(false);
  const [isParentFormLoading, setIsParentFormLoading] = useState(false);
  
  // Modales
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false); // Nuevo
  const [showUploadPhoto, setShowUploadPhoto] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showFreeAccountWarning, setShowFreeAccountWarning] = useState(false);
  const [showLinksManager, setShowLinksManager] = useState(false);
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [showEditStudent, setShowEditStudent] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<Student | null>(null);
  const [photoConsentAccepted, setPhotoConsentAccepted] = useState(false);
  const [rechargeSuggestedAmount, setRechargeSuggestedAmount] = useState<number | undefined>(undefined);
  const [photoConsentRefresh, setPhotoConsentRefresh] = useState(0); // Para forzar refresh en MoreMenu
  // (LUNCH FAST eliminado)
  
  // Estudiante seleccionado
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Estado para evitar doble apertura
  const [isOpeningPhotoModal, setIsOpeningPhotoModal] = useState(false);

  // 🔧 Modo Mantenimiento por módulo
  const [maintenanceAlmuerzos, setMaintenanceAlmuerzos] = useState<{ title: string; message: string } | null>(null);
  const [maintenancePagos, setMaintenancePagos] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    fetchStudents();
    fetchParentProfile();
    checkOnboardingStatus();
    fetchPendingPaymentsCount();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(fetchPendingPaymentsCount, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Auto-refresh saldos y deudas cuando admin aprueba recarga/voucher (Realtime)
  useEffect(() => {
    if (balanceSyncTs > 0 && user) {
      fetchStudents();
      fetchPendingPaymentsCount();
      toast({ title: '🔄 Datos actualizados', description: 'El saldo de tus hijos se actualizó.', duration: 4000 });
    }
  }, [balanceSyncTs]);

  const fetchParentProfile = async () => {
    if (!user) return;
    try {
      // Intentar obtener nombre/consent desde parent_profiles
      const { data: parentData } = await supabase
        .from('parent_profiles')
        .select('full_name, photo_consent')
        .eq('user_id', user.id)
        .maybeSingle();

      // Obtener school_id desde el primer estudiante activo del padre
      const { data: studentData } = await supabase
        .from('students')
        .select('school_id')
        .eq('parent_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .single();

      // Fallback de nombre desde profiles
      let fullName = parentData?.full_name || '';
      if (!fullName) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
        fullName = profileData?.full_name || '';
      }

      const combined = {
        school_id: studentData?.school_id || null,
        full_name: fullName,
        photo_consent: parentData?.photo_consent || false,
      };

      setParentProfileData(combined);
      if (combined.full_name) setParentName(combined.full_name);
      if (combined.photo_consent) setPhotoConsentAccepted(true);
    } catch (e) {
      console.error("Error fetching parent profile:", e);
    }
  };

  // 🔧 Verificar modo mantenimiento para los módulos del padre
  const fetchMaintenanceConfig = async (schoolIdOverride?: string) => {
    if (!user) return;
    try {
      let schoolId = schoolIdOverride;

      if (!schoolId) {
        // El padre no tiene school_id en profiles → obtener de sus estudiantes
        const { data: studentData } = await supabase
          .from('students')
          .select('school_id')
          .eq('parent_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        schoolId = studentData?.school_id;
      }

      if (!schoolId) {
        console.warn('[Maintenance] No se encontró school_id (padre sin estudiantes activos)');
        return;
      }

      console.log('[Maintenance] Verificando mantenimiento para sede:', schoolId);

      const { data: configs, error } = await supabase
        .from('maintenance_config')
        .select('module_key, enabled, title, message, bypass_emails')
        .eq('school_id', schoolId)
        .eq('enabled', true);

      if (error) throw error;

      console.log('[Maintenance] Configs activas encontradas:', configs?.length || 0);

      let newAlmuerzos: { title: string; message: string } | null = null;
      let newPagos: { title: string; message: string } | null = null;
      let newTutorialEnabled = false;

      if (configs && configs.length > 0) {
        const userEmail = user.email?.toLowerCase() || '';

        configs.forEach((cfg: any) => {
          const isBypassed = (cfg.bypass_emails || []).some(
            (e: string) => e.toLowerCase() === userEmail
          );
          if (isBypassed) return;

          if (cfg.module_key === 'almuerzos_padres') {
            newAlmuerzos = { title: cfg.title, message: cfg.message };
          }
          if (cfg.module_key === 'pagos_padres') {
            newPagos = { title: cfg.title, message: cfg.message };
          }
          if (cfg.module_key === 'tutorial_padres') {
            newTutorialEnabled = true;
          }
        });
      }

      setMaintenanceAlmuerzos(newAlmuerzos);
      setMaintenancePagos(newPagos);
      setTutorialModuleEnabled(newTutorialEnabled);
    } catch (e) {
      console.error('[Maintenance] Error:', e);
    }
  };

  // Cargar estado de mantenimiento al montar y cada 30s como fallback.
  // Se usa parentProfileData?.school_id como dependencia principal para evitar
  // que los dos useEffect anteriores se pisen entre sí y causen bucles de renders.
  useEffect(() => {
    if (!user) return;
    // Si ya tenemos el school_id del perfil lo usamos directamente (evita la query extra a students)
    fetchMaintenanceConfig(parentProfileData?.school_id);
    const interval = setInterval(() => fetchMaintenanceConfig(parentProfileData?.school_id), 30000);
    return () => clearInterval(interval);
  }, [user, parentProfileData?.school_id]);

  // Realtime: detectar cambios en maintenance_config para bloqueo instantáneo
  useEffect(() => {
    if (!user || !parentProfileData?.school_id) return;

    const channel = supabase
      .channel('parent-maintenance-watch')
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'maintenance_config',
        },
        () => {
          console.log('[Maintenance] Realtime → cambio detectado, re-verificando...');
          fetchMaintenanceConfig(parentProfileData.school_id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, parentProfileData?.school_id]);

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
      
      // Si ya completó el onboarding, no mostrar el modal
      if (data?.free_account_onboarding_completed) return;

      // Protección extra: si el padre ya tiene hijos registrados, nunca
      // mostrar el onboarding aunque la BD diga false (evita el bug de
      // padres existentes al agregar la columna con DEFAULT false)
      const { count: studentCount } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', user.id);

      if (studentCount && studentCount > 0) {
        // Actualizar silenciosamente en BD para no volver a entrar aquí
        await supabase
          .from('profiles')
          .update({ free_account_onboarding_completed: true })
          .eq('id', user.id);
        return;
      }

      // Padre nuevo sin hijos → mostrar onboarding
      setShowOnboarding(true);
    } catch (e) {
      console.error("Error checking onboarding status:", e);
    }
  };

  const handleOnboardingComplete = async (kioskDisabled: boolean = false) => {
    if (!user) return;
    try {
      // Guardar que completó el onboarding Y la preferencia elegida
      await supabase
        .from('profiles')
        .update({
          free_account_onboarding_completed: true,
          kiosk_preference: kioskDisabled ? 'lunch_only' : 'full',
        })
        .eq('id', user.id);

      // Si el padre ya tiene hijos (caso de reconexión), aplicar la preferencia
      if (kioskDisabled) {
        const { data: myStudents } = await supabase
          .from('students')
          .select('id')
          .eq('parent_id', user.id);

        if (myStudents && myStudents.length > 0) {
          await supabase
            .from('students')
            .update({ kiosk_disabled: true })
            .in('id', myStudents.map(s => s.id));
        }
      }
      
      setShowOnboarding(false);
      
      // Verificar si tiene hijos, si no, abrir modal para agregar
      const { data: studentsData } = await supabase
        .from('students')
        .select('id')
        .eq('parent_id', user.id)
        .limit(1);
      
      if (!studentsData || studentsData.length === 0) {
        toast({
          title: '👨‍👩‍👧‍👦 Agregar tus hijos',
          description: 'Por favor, agrega a tus hijos para comenzar a usar el portal',
          duration: 5000,
        });
        setShowAddStudent(true);
      } else {
        toast({
          title: kioskDisabled ? '🍽️ Configurado — Solo Almuerzos' : '✅ ¡Bienvenido!',
          description: kioskDisabled
            ? 'Tus hijos solo podrán pedir almuerzos. Sin cuenta en el kiosco.'
            : 'Ya puedes comenzar a usar el portal',
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

      // Inicializar el hijo activo del carrusel:
      // Si hay un ID guardado en localStorage y sigue siendo válido → usarlo.
      // Si no, seleccionar el primero de la lista.
      if (data && data.length > 0) {
        setActiveStudentId(prev => {
          const validIds = new Set(data.map(s => s.id));
          if (prev && validIds.has(prev)) return prev; // mantener el guardado
          const first = data[0].id;
          try { localStorage.setItem('parentPortalActiveStudentId', first); } catch { /* noop */ }
          return first;
        });
      }
      
      // ✅ Calcular deudas con delay para cada estudiante
      if (data && data.length > 0) {
        await calculateStudentDebts(data);
        fetchPendingRecharges(data); // ⏳ Cargar recargas pendientes en paralelo
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

  // ✅ Calcular deuda de cada estudiante — 1 sola query para todos los hijos (no N+1)
  const calculateStudentDebts = async (studentsData: Student[]) => {
    const debtsMap: Record<string, { lunchDebt: number; kioskDebt: number; totalDebt: number }> = {};

    // Inicializar mapa con ceros (incluye alumnos sin deudas y con free_account=false)
    for (const student of studentsData) {
      debtsMap[student.id] = { lunchDebt: 0, kioskDebt: 0, totalDebt: 0 };
    }

    // Solo consultar alumnos que puedan tener deuda (excluir free_account=false)
    const billableIds = studentsData
      .filter(s => s.free_account !== false)
      .map(s => s.id);

    if (billableIds.length === 0) {
      setStudentDebts(debtsMap);
      return;
    }

    try {
      // UNA sola query para todos los hijos (antes era 1 query por hijo)
      const { data: allPendingTx } = await supabase
        .from('transactions')
        .select('student_id, amount, metadata')
        .in('student_id', billableIds)
        .eq('type', 'purchase')
        .in('payment_status', ['pending', 'partial'])
        .eq('is_deleted', false);

      // Agregar en memoria — O(n), sin round-trips adicionales
      for (const tx of allPendingTx ?? []) {
        if (!debtsMap[tx.student_id]) continue;
        const abs = Math.abs(tx.amount);
        if ((tx.metadata as any)?.lunch_order_id) {
          debtsMap[tx.student_id].lunchDebt += abs;
        } else {
          debtsMap[tx.student_id].kioskDebt += abs;
        }
        debtsMap[tx.student_id].totalDebt += abs;
      }
    } catch (error) {
      console.error('Error calculating student debts:', error);
    }

    setStudentDebts(debtsMap);
  };

  // ⏳ Obtener recargas pendientes de aprobación por estudiante
  const fetchPendingRecharges = async (studentsData: Student[]) => {
    if (!studentsData || studentsData.length === 0) return;
    const studentIds = studentsData.map(s => s.id);
    try {
      const { data } = await supabase
        .from('recharge_requests')
        .select('student_id, amount')
        .in('student_id', studentIds)
        .eq('status', 'pending')
        .eq('request_type', 'recharge');

      const map: Record<string, number> = {};
      for (const row of data || []) {
        map[row.student_id] = (map[row.student_id] || 0) + row.amount;
      }
      setPendingRechargesMap(map);
    } catch (err) {
      // silently ignore
    }
  };

  // 🔴 Contar pagos pendientes (transacciones pending de los hijos del padre)
  // Reutiliza los IDs ya cargados en `students` state para evitar una query extra a students.
  const fetchPendingPaymentsCount = async () => {
    if (!user) return;
    try {
      // Usar IDs del estado si ya están cargados; si no, hacer la query mínima
      const studentIds = students.length > 0
        ? students.map(s => s.id)
        : await (async () => {
            const { data } = await supabase
              .from('students')
              .select('id')
              .eq('parent_id', user.id)
              .eq('is_active', true);
            return (data ?? []).map(s => s.id);
          })();

      if (studentIds.length === 0) {
        setPendingPaymentsCount(0);
        return;
      }

      const { count, error } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .in('student_id', studentIds)
        .eq('type', 'purchase')
        .in('payment_status', ['pending', 'partial'])
        .eq('is_deleted', false);

      if (!error) setPendingPaymentsCount(count || 0);
    } catch (err) {
      console.error('Error fetching pending payments count:', err);
    }
  };

  const handleRecharge = async (_amount: number, _method: string) => {
    toast({
      title: 'Usa el Carrito',
      description: 'Las recargas se gestionan desde la pestaña Carrito.',
    });
  };

  // ── CARRUSEL: detectar qué hijo está centrado después de un scroll ──────────
  const handleCarouselScroll = useCallback(() => {
    const el = carouselRef.current;
    if (!el || students.length === 0) return;
    // Cada tarjeta ocupa scrollWidth / nCards del área de scroll total
    const cardWidth = el.scrollWidth / students.length;
    const newIndex  = Math.round(el.scrollLeft / cardWidth);
    const clamped   = Math.max(0, Math.min(newIndex, students.length - 1));
    const newId     = students[clamped]?.id;
    if (newId && newId !== activeStudentId) {
      setIsTransitioning(true);
      setActiveStudentId(newId);
      try { localStorage.setItem('parentPortalActiveStudentId', newId); } catch { /* noop */ }
      setTimeout(() => setIsTransitioning(false), 300);
    }
  }, [students, activeStudentId]);

  // Scroll programático al hijo guardado cuando el carrusel monta o cambia students
  const scrollToActiveStudent = useCallback(() => {
    const el = carouselRef.current;
    if (!el || students.length === 0 || !activeStudentId) return;
    const index = students.findIndex(s => s.id === activeStudentId);
    if (index < 0) return;
    const cardWidth = el.scrollWidth / students.length;
    el.scrollTo({ left: cardWidth * index, behavior: 'instant' });
  }, [students, activeStudentId]);
  // ────────────────────────────────────────────────────────────────────────────

  const openRechargeModal = (student: Student) => {
    setSelectedStudent(student);
    setShowRechargeModal(true);
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

  // handleLunchFast eliminado

  // handleConfirmLunchOrder eliminado

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
    <div className="bg-[#FAFAF9] pb-20">
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
              {/* Botón Tutorial — solo visible si el módulo está activado para esta sede */}
              {tutorialModuleEnabled && (
                <button
                  onClick={() => {
                    localStorage.removeItem('ericka_tutorial_completed');
                    setTutorialManualKey(k => k + 1);
                    setShowTutorialManual(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-700 rounded-lg text-xs font-semibold transition-all duration-200 shadow-sm hover:shadow"
                  title="Ver tutorial guiado de Ericka"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tutorial</span>
                </button>
              )}
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4">
        {/* ── PESTAÑA ALUMNOS — Carrusel estilo Yape ── */}
        <div className={activeTab !== 'alumnos' ? 'hidden' : ''}>
          <div className="space-y-3">

            {/* Cabecera v0: hijo activo + dots */}
            {students.length > 0 && (
              <ChildCarouselHeader
                students={students}
                activeStudentId={activeStudentId}
                onDotClick={(sid) => {
                  // Actualización directa sin scroll visible — no hay que bajar para ver el carousel
                  setActiveStudentId(sid);
                  try { localStorage.setItem('parentPortal_activeStudentId', sid); } catch { /* noop */ }
                  // También sincronizamos el carousel oculto para mantener compatibilidad
                  const el = carouselRef.current;
                  if (el) {
                    const index = students.findIndex(s => s.id === sid);
                    const cardWidth = el.scrollWidth / (students.length || 1);
                    el.scrollTo({ left: cardWidth * index, behavior: 'auto' });
                  }
                }}
              />
            )}

            {students.length === 0 ? (
              /* Estado vacío — idéntico al original */
              <Card className="border border-dashed border-stone-300/50 bg-white shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16 md:py-20 px-4">
                  <GraduationCap className="h-12 w-12 sm:h-14 sm:w-14 text-stone-300 mb-4 sm:mb-6" />
                  <h3 className="text-lg sm:text-xl font-normal text-stone-800 mb-2 sm:mb-3 tracking-wide text-center">
                    No hay estudiantes registrados
                  </h3>
                  <p className="text-stone-500 mb-6 sm:mb-8 text-center max-w-md text-xs sm:text-sm leading-relaxed px-2">
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
                {/* ── MÓDULO DE SALDO (BalanceHero) + BOTONES HERO ── */}
                {(() => {
                  const active = students.find(s => s.id === activeStudentId) ?? students[0];
                  return (
                    <>
                      <BalanceHero
                        studentId={active?.id ?? null}
                        studentName={active?.full_name ?? ''}
                        photoUrl={active?.photo_url ?? null}
                        balance={active?.balance ?? 0}
                        lunchDebt={studentDebts[active?.id]?.lunchDebt ?? 0}
                        kioskDebt={studentDebts[active?.id]?.kioskDebt ?? 0}
                        isLoading={loading}
                      />
                      {/* Botones gigantes estilo Yape — re-renderizan con activeStudentId */}
                      <HeroActions
                        activeStudentName={active?.full_name ?? ''}
                        schoolName={active?.school?.name}
                        onAlmuerzos={() => setActiveTab('almuerzos')}
                        onPagos={() => setActiveTab('carrito')}
                        pendingPaymentsCount={pendingPaymentsCount}
                        almuerzosEnMantenimiento={!!maintenanceAlmuerzos}
                        isTransitioning={isTransitioning}
                      />
                      {/* Cuadrícula de servicios secundarios estilo Yape */}
                      <ServicesGrid
                        onViewHistory={() => { if (!isTransitioning) openHistoryModal(active); }}
                      />
                    </>
                  );
                })()}

                {/* ── CARRUSEL HORIZONTAL (oculto visualmente — solo para lógica de scroll/detección) ── */}
                {/* La interfaz visual la provee ChildCarouselHeader. Este div no ocupa espacio en pantalla. */}
                <div
                  ref={carouselRef}
                  onScroll={handleCarouselScroll}
                  onLoad={scrollToActiveStudent}
                  aria-hidden="true"
                  className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth gap-3"
                  style={{
                    scrollbarWidth: 'none',
                    WebkitOverflowScrolling: 'touch',
                    height: 0,
                    overflow: 'hidden',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  {students.map((student) => (
                    <div
                      key={student.id}
                      data-student-id={student.id}
                      className="snap-center flex-shrink-0 w-[87vw] sm:w-[380px]"
                    >
                      <StudentCard
                        student={student}
                        totalDebt={studentDebts[student.id]?.totalDebt || 0}
                        lunchDebt={studentDebts[student.id]?.lunchDebt || 0}
                        kioskDebt={studentDebts[student.id]?.kioskDebt || 0}
                        pendingRechargeAmount={pendingRechargesMap[student.id] || 0}
                        onRecharge={() => { if (!isTransitioning) openRechargeModal(student); }}
                        onViewHistory={() => { if (!isTransitioning) openHistoryModal(student); }}
                        onViewMenu={() => { if (!isTransitioning) openMenuModal(student); }}
                        onOpenSettings={() => { if (!isTransitioning) openSettingsModal(student); }}
                        onPhotoClick={() => { if (!isTransitioning) openPhotoModal(student); }}
                        onEdit={() => { if (!isTransitioning) { setStudentToEdit(student); setShowEditStudent(true); } }}
                      />
                    </div>
                  ))}

                  {/* Tarjeta para agregar hijo — al final del carrusel */}
                  <div className="snap-center flex-shrink-0 w-[60vw] sm:w-[200px] flex items-center justify-center">
                    <button
                      onClick={() => setShowAddStudent(true)}
                      className="flex flex-col items-center gap-2 px-6 py-8 rounded-2xl border-2 border-dashed border-stone-300 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all duration-200 text-stone-400 hover:text-emerald-600 w-full h-full min-h-[140px]"
                    >
                      <Plus className="h-7 w-7" />
                      <span className="text-xs font-medium text-center leading-tight">Agregar otro estudiante</span>
                    </button>
                  </div>
                </div>

                {/* Dots ya están en ChildCarouselHeader — no se duplican aquí */}
              </>
            )}
          </div>
        </div>

        {/* Pestaña Carrito */}
        <div className={activeTab !== 'carrito' ? 'hidden' : ''}>
          {user?.id && maintenancePagos ? (
            /* Módulo en mantenimiento */
            <MaintenanceScreen
              title={maintenancePagos.title}
              message={maintenancePagos.message}
            />
          ) : user?.id ? (
            <Tabs defaultValue="pendientes" className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-auto mb-4">
                <TabsTrigger value="pendientes" className="text-xs sm:text-sm py-2 sm:py-3 gap-1.5">
                  <Receipt className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Pendientes
                </TabsTrigger>
                <TabsTrigger value="historial" className="text-xs sm:text-sm py-2 sm:py-3 gap-1.5">
                  <History className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Pagos Realizados
                </TabsTrigger>
              </TabsList>
              <TabsContent value="pendientes">
                <PaymentsTab userId={user.id} isActive={activeTab === 'carrito'} />
              </TabsContent>
              <TabsContent value="historial">
                <PaymentHistoryTab userId={user.id} isActive={activeTab === 'carrito'} />
              </TabsContent>
            </Tabs>
          ) : null}
        </div>

        {/* Pestaña Almuerzos */}
        <div className={activeTab !== 'almuerzos' ? 'hidden' : ''}>
          {user && maintenanceAlmuerzos ? (
            /* 🔧 Módulo en mantenimiento */
            <MaintenanceScreen
              title={maintenanceAlmuerzos.title}
              message={maintenanceAlmuerzos.message}
            />
          ) : user ? (
            <div className="px-2 sm:px-4 space-y-4 sm:space-y-6">
              {/* Sub-pestañas para Almuerzos */}
              <Tabs defaultValue="hacer-pedido" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-auto">
                  <TabsTrigger id="lunch-subtab-hacer-pedido" value="hacer-pedido" className="text-xs sm:text-sm py-2 sm:py-3">
                    <UtensilsCrossed className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    Hacer Pedido
                  </TabsTrigger>
                  <TabsTrigger id="lunch-subtab-mis-pedidos" value="mis-pedidos" className="text-xs sm:text-sm py-2 sm:py-3">
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
                      onGoToCart={() => setActiveTab('carrito')}
                    />
                  )}
                </TabsContent>
                
                <TabsContent value="mis-pedidos" className="mt-4 sm:mt-6">
                  {/* Mis Pedidos de Almuerzo */}
                  <ParentLunchOrders parentId={user.id} />
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </div>

        {/* ── PESTAÑA HISTORIAL — Pagos Realizados (acceso directo desde nav) ── */}
        {/* El código de PaymentsTab y PaymentHistoryTab sigue intacto en el tab 'carrito' */}
        <div className={activeTab !== 'historial' ? 'hidden' : ''}>
          {user?.id && maintenancePagos ? (
            <MaintenanceScreen
              title={maintenancePagos.title}
              message={maintenancePagos.message}
            />
          ) : user?.id ? (
            <PaymentHistoryTab userId={user.id} isActive={activeTab === 'historial'} />
          ) : null}
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
            onClose={() => {
              setShowRechargeModal(false);
              setRechargeSuggestedAmount(undefined);
            }}
            studentName={selectedStudent.full_name}
            studentId={selectedStudent.id}
            currentBalance={selectedStudent.balance}
            accountType={selectedStudent.free_account !== false ? 'free' : 'prepaid'}
            onRecharge={handleRecharge}
            suggestedAmount={rechargeSuggestedAmount}
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
            onRequestRecharge={(suggestedAmount?: number) => {
              setRechargeSuggestedAmount(suggestedAmount);
              setShowRechargeModal(true);
            }}
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

          {/* LUNCH FAST eliminado */}
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

      {/* Modal Editar Estudiante */}
      <EditStudentModal
        isOpen={showEditStudent}
        onClose={() => { setShowEditStudent(false); setStudentToEdit(null); }}
        onSuccess={() => { setShowEditStudent(false); setStudentToEdit(null); fetchStudents(); }}
        student={studentToEdit ? {
          id: studentToEdit.id,
          full_name: studentToEdit.full_name,
          school_id: studentToEdit.school_id || '',
          level_id: studentToEdit.level_id,
          classroom_id: studentToEdit.classroom_id,
        } : null}
      />

      {/* ── NAVEGACIÓN INFERIOR v0 — 3 ítems (Inicio · Historial · Perfil) ── */}
      <nav id="bottom-nav-bar" className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-100/50 shadow-lg z-50">
        <div className="max-w-7xl mx-auto px-6 pb-4">
          <div className="flex items-center justify-around h-20">

            {/* Inicio */}
            {(() => {
              const isActive = activeTab === 'alumnos' || activeTab === 'almuerzos' || activeTab === 'carrito';
              return (
                <button
                  id="nav-tab-alumnos"
                  onClick={() => setActiveTab('alumnos')}
                  className="flex flex-col items-center gap-1 px-6 active:scale-95 transition-transform"
                >
                  <div className={`p-2.5 rounded-2xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-300/40'
                      : 'bg-transparent hover:bg-slate-100'
                  }`}>
                    <Home className={`w-6 h-6 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  </div>
                  <span className={`text-xs font-semibold ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>Inicio</span>
                </button>
              );
            })()}

            {/* Historial */}
            {(() => {
              const isActive = activeTab === 'historial';
              return (
                <button
                  id="nav-tab-historial"
                  onClick={() => setActiveTab('historial')}
                  className="relative flex flex-col items-center gap-1 px-6 active:scale-95 transition-transform"
                >
                  {pendingPaymentsCount > 0 && !isActive && (
                    <span className="absolute top-0 right-4 flex">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex items-center justify-center h-4 w-4 rounded-full bg-red-500 text-white text-[8px] font-bold">
                        {pendingPaymentsCount > 9 ? '9+' : pendingPaymentsCount}
                      </span>
                    </span>
                  )}
                  <div className={`p-2.5 rounded-2xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-300/40'
                      : 'bg-transparent hover:bg-slate-100'
                  }`}>
                    <History className={`w-6 h-6 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  </div>
                  <span className={`text-xs font-semibold ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>Historial</span>
                </button>
              );
            })()}

            {/* Perfil */}
            {(() => {
              const isActive = activeTab === 'mas';
              return (
                <button
                  id="nav-tab-mas"
                  onClick={() => setActiveTab('mas')}
                  className="flex flex-col items-center gap-1 px-6 active:scale-95 transition-transform"
                >
                  <div className={`p-2.5 rounded-2xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-300/40'
                      : 'bg-transparent hover:bg-slate-100'
                  }`}>
                    <User className={`w-6 h-6 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  </div>
                  <span className={`text-xs font-semibold ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>Perfil</span>
                </button>
              );
            })()}

          </div>
        </div>
      </nav>

      {/* Footer - Créditos del sistema (al final del contenido, no flotante) */}
      <div className="pb-20 sm:pb-24">
        <div className="text-center py-3 text-[9px] sm:text-[10px] text-gray-400">
          © 2026 <span className="font-semibold">ERP Profesional</span> · Diseñado por <span className="font-semibold">ARQUISIA Soluciones</span> para <span className="font-semibold">Lima Café 28</span>
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
        onAccept={(kioskDisabled) => handleOnboardingComplete(kioskDisabled)}
        parentName={parentName || 'Padre de Familia'}
      />

      {/* Tutorial guiado con Ericka — solo visible para padres */}
      {!showParentDataForm && !showOnboarding && user && (
        <ErickaTutorial
          userId={user?.id}
          schoolId={parentProfileData?.school_id || undefined}
          onSetActiveTab={setActiveTab}
          key={`tutorial-${user?.id}`}
        />
      )}

      {/* Tutorial manual — activado con el botón del header */}
      {showTutorialManual && user && (
        <ErickaTutorial
          userId={user?.id}
          schoolId={parentProfileData?.school_id || undefined}
          onSetActiveTab={setActiveTab}
          forceShow={true}
          onClose={() => setShowTutorialManual(false)}
          key={`tutorial-manual-${tutorialManualKey}`}
        />
      )}

      {/* Modal de contraseña temporal — bloquea hasta que el padre cambie su contraseña */}
      <Dialog open={isTempPassword} onOpenChange={() => {}}>
        <DialogContent className="max-w-sm [&>button]:hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              🔑 Cambia tu contraseña
            </DialogTitle>
            <DialogDescription>
              El administrador te asignó una contraseña temporal. Por seguridad, debes crear una nueva antes de continuar.
            </DialogDescription>
          </DialogHeader>
          <TempPasswordForm onDone={clearTempPasswordFlag} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
