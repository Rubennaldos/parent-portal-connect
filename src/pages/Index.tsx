import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  const [loading, setLoading] = useState(true);
  const [parentName, setParentName] = useState<string>('');
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [activeTab, setActiveTab] = useState('alumnos');
  const [showOnboarding, setShowOnboarding] = useState(false);
  
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
      // Obtener nombre del perfil
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      
      if (profileData && profileData.full_name) {
        setParentName(profileData.full_name);
      }

      // Verificar si ya aceptó el consentimiento de fotos
      const { data: consentData, error: consentError } = await supabase
        .from('parent_profiles')
        .select('photo_consent')
        .eq('user_id', user.id)
        .maybeSingle(); // Usar maybeSingle en lugar de single para evitar error si no existe

      if (consentData && consentData.photo_consent === true) {
        setPhotoConsentAccepted(true);
        console.log('✅ Photo consent already accepted');
      } else {
        console.log('⚠️ Photo consent not found or not accepted');
      }
    } catch (e) {
      console.error("Error fetching parent profile:", e);
    }
  };

  const checkOnboardingStatus = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('free_account_onboarding_completed')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      
      // Si no ha completado el onboarding, mostrar el modal
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
      toast({
        title: '✅ ¡Bienvenido!',
        description: 'Ya puedes comenzar a usar el portal',
      });
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
        .select('*')
        .eq('parent_id', user.id)
        .eq('is_active', true)
        .order('full_name', { ascending: true });

      if (error) throw error;
      
      setStudents(data || []);
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
    setSelectedStudent(student);
    
    // LOGICA SIMPLIFICADA: Si el balance es negativo (debe) → Pasarela, si no → Recarga
    const hasDebts = student.balance < 0;
    
    console.log('--- DIAGNOSTICO DE PAGO ---');
    console.log('Estudiante:', student.full_name);
    console.log('Deudas detectadas:', hasDebts);
    console.log('Saldo:', student.balance);
    
    if (hasDebts) {
      console.log('MODO: PASARELA DE PAGOS');
      setShowPayDebtModal(true);
      setShowRechargeModal(false);
    } else {
      console.log('MODO: RECARGA DE SALDO');
      setShowRechargeModal(true);
      setShowPayDebtModal(false);
    }
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
      const { error } = await supabase.from('transactions').insert({
        student_id: selectedStudent.id,
        type: 'purchase',
        amount: amount,
        description: `LUNCH FAST: ${todayMenu.main_course}`,
        payment_status: selectedStudent.free_account !== false ? 'pending' : 'paid',
        created_by: user?.id,
        metadata: { lunch_menu_id: todayMenu.id, source: 'lunch_fast' }
      });

      if (error) throw error;

      // Actualizar balance del estudiante
      const { error: balanceError } = await supabase
        .from('students')
        .update({ balance: selectedStudent.balance - amount })
        .eq('id', selectedStudent.id);

      if (balanceError) throw balanceError;

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
    <div className="min-h-screen bg-[#FDFCFB] pb-24">
      {/* Header Minimalista y Elegante */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-[#8B4513] rounded-xl flex items-center justify-center shadow-sm">
                <GraduationCap className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-black text-[#8B4513]">Lima Café 28</h1>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Portal de Padres</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="hidden md:block text-right">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Bienvenido</p>
                <p className="text-sm font-black text-slate-800">{parentName || 'Padre de Familia'}</p>
              </div>
              <VersionBadge />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'alumnos' && (
          <div className="space-y-8">
            <div className="mb-2">
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">Mis Hijos</h2>
              <p className="text-slate-400 font-medium mt-1">Gestión centralizada de cuentas escolares</p>
            </div>

            {students.length === 0 ? (
              <Card className="border-2 border-dashed border-[#D2691E]/30">
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <GraduationCap className="h-16 w-16 text-[#D2691E]/40 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    No hay estudiantes registrados
                  </h3>
                  <p className="text-gray-600 mb-6 text-center max-w-md text-sm">
                    Agrega a tu primer hijo para empezar a usar el kiosco escolar
                  </p>
                  <Button 
                    size="lg" 
                    onClick={() => setShowAddStudent(true)}
                    className="bg-[#8B4513] hover:bg-[#A0522D]"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Agregar Mi Primer Hijo
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {students.map((student) => (
                    <StudentCard
                      key={student.id}
                      student={student}
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

                <Card 
                  className="border-2 border-dashed border-[#D2691E]/30 hover:border-[#D2691E] hover:bg-[#FFF8E7] transition-all cursor-pointer"
                  onClick={() => setShowAddStudent(true)}
                >
                  <CardContent className="flex items-center justify-center py-8">
                    <Plus className="h-6 w-6 text-[#8B4513] mr-2" />
                    <span className="text-[#8B4513] font-semibold">Agregar otro estudiante</span>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {activeTab === 'pagos' && <PaymentsTab userId={user?.id || ''} />}

        {activeTab === 'almuerzos' && user && (
          <div className="px-4">
            <LunchOrderCalendar
              isOpen={true}
              onClose={() => {}}
              parentId={user.id}
              embedded={true}
            />
          </div>
        )}

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

      {/* Navegación Inferior Fija - Colores Lima Café 28 */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-[#8B4513]/20 shadow-lg z-50">
        <div className="max-w-7xl mx-auto px-2">
          <div className="grid grid-cols-4 gap-1">
            <button
              onClick={() => setActiveTab('alumnos')}
              className={`flex flex-col items-center justify-center py-3 transition-all ${
                activeTab === 'alumnos'
                  ? 'text-[#8B4513] bg-[#FFF8E7]'
                  : 'text-gray-500 hover:text-[#8B4513] hover:bg-gray-50'
              }`}
            >
              <Home className="h-6 w-6 mb-1" />
              <span className="text-xs font-semibold">Mis Hijos</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('almuerzos');
              }}
              className={`flex flex-col items-center justify-center py-3 transition-all ${
                activeTab === 'almuerzos'
                  ? 'text-[#8B4513] bg-[#FFF8E7]'
                  : 'text-gray-500 hover:text-[#8B4513] hover:bg-gray-50'
              }`}
            >
              <UtensilsCrossed className="h-6 w-6 mb-1" />
              <span className="text-xs font-semibold">Almuerzos</span>
            </button>

            <button
              onClick={() => setActiveTab('pagos')}
              className={`flex flex-col items-center justify-center py-3 transition-all ${
                activeTab === 'pagos'
                  ? 'text-[#8B4513] bg-[#FFF8E7]'
                  : 'text-gray-500 hover:text-[#8B4513] hover:bg-gray-50'
              }`}
            >
              <Wallet className="h-6 w-6 mb-1" />
              <span className="text-xs font-semibold">Pagos</span>
            </button>

            <button
              onClick={() => setActiveTab('mas')}
              className={`flex flex-col items-center justify-center py-3 transition-all ${
                activeTab === 'mas'
                  ? 'text-[#8B4513] bg-[#FFF8E7]'
                  : 'text-gray-500 hover:text-[#8B4513] hover:bg-gray-50'
              }`}
            >
              <MenuIcon className="h-6 w-6 mb-1" />
              <span className="text-xs font-semibold">Más</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Modal de Onboarding - Cuenta Libre */}
      <FreeAccountOnboardingModal
        open={showOnboarding}
        onAccept={handleOnboardingComplete}
        parentName={parentName || 'Padre de Familia'}
      />
    </div>
  );
};

export default Index;
