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
  Wallet
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
import { PaymentsTab } from '@/components/parent/PaymentsTab';
import { StudentLinksManager } from '@/components/parent/StudentLinksManager';
import { MoreMenu } from '@/components/parent/MoreMenu';
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
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [activeTab, setActiveTab] = useState('alumnos');
  
  // Modales
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showUploadPhoto, setShowUploadPhoto] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showFreeAccountWarning, setShowFreeAccountWarning] = useState(false);
  const [showLinksManager, setShowLinksManager] = useState(false);
  
  // Estudiante seleccionado
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Para límite diario
  const [newLimit, setNewLimit] = useState('');
  const [isUpdatingLimit, setIsUpdatingLimit] = useState(false);

  useEffect(() => {
    fetchStudents();
  }, [user]);

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

  const fetchTransactions = async (studentId: string) => {
    try {
      setLoadingHistory(true);
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar el historial',
      });
    } finally {
      setLoadingHistory(false);
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

  const handleUpdateLimit = async () => {
    if (!selectedStudent) return;
    
    const limit = parseFloat(newLimit);
    if (isNaN(limit) || limit < 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa un límite válido',
      });
      return;
    }

    setIsUpdatingLimit(true);

    try {
      const { error } = await supabase
        .from('students')
        .update({ daily_limit: limit })
        .eq('id', selectedStudent.id);

      if (error) throw error;

      toast({
        title: '✅ Límite Actualizado',
        description: `Nuevo límite diario: S/ ${limit.toFixed(2)}`,
      });

      await fetchStudents();
      setShowLimitModal(false);
    } catch (error: any) {
      console.error('Error updating limit:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar el límite',
      });
    } finally {
      setIsUpdatingLimit(false);
    }
  };

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
    fetchTransactions(student.id);
    setShowHistoryModal(true);
  };

  const openPhotoModal = (student: Student) => {
    setSelectedStudent(student);
    setShowUploadPhoto(true);
  };

  const openSettingsModal = (student: Student) => {
    setSelectedStudent(student);
    setNewLimit(student.daily_limit.toString());
    setShowLimitModal(true);
  };

  const handleToggleFreeAccount = async (student: Student, newValue: boolean) => {
    try {
      const { error } = await supabase
        .from('students')
        .update({ free_account: newValue })
        .eq('id', student.id);

      if (error) throw error;

      toast({
        title: newValue ? '✅ Cuenta Libre Activada' : '🔒 Cuenta Libre Desactivada',
        description: newValue 
          ? `${student.full_name} ahora puede consumir y pagar después` 
          : `${student.full_name} necesitará saldo para consumir`,
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
    <div className="min-h-screen bg-[#FDF6E3] pb-20">
      {/* Header Fijo con Logo Lima Café 28 */}
      <header className="bg-gradient-to-r from-[#8B4513] to-[#D2691E] text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md">
                <GraduationCap className="h-7 w-7 text-[#8B4513]" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Lima Café 28</h1>
                <p className="text-xs text-white/80">Portal de Padres</p>
              </div>
            </div>
            
            <VersionBadge />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'alumnos' && (
          <div className="space-y-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-[#8B4513] mb-1">Mis Hijos</h2>
              <p className="text-gray-600 text-sm">Gestiona las cuentas del kiosco escolar</p>
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
                      onViewMenu={() => openMenuModal(student)}
                      onOpenSettings={() => openSettingsModal(student)}
                      onPhotoClick={() => openPhotoModal(student)}
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

        {activeTab === 'configuracion' && (
          <div className="space-y-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-[#8B4513] mb-1">Configuración</h2>
              <p className="text-gray-600 text-sm">Gestiona las opciones de cada estudiante</p>
            </div>

            {students.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No hay estudiantes registrados</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                    {students.map((student) => (
                      <Card key={student.id} className="border-2">
                        <CardContent className="p-4">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="font-bold text-lg">{student.full_name}</p>
                                <p className="text-sm text-gray-500">{student.grade} - {student.section}</p>
                              </div>
                              {student.free_account !== false && (
                                <span className="text-xs bg-green-100 text-green-800 px-3 py-1 rounded-full font-bold">
                                  ✓ Cuenta Libre
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              {/* Cuenta Libre */}
                              <div className="bg-gray-50 rounded-lg p-3 border">
                                <Label className="text-xs font-bold text-gray-700 uppercase mb-2 block">
                                  Cuenta Libre (Pagar después)
                                </Label>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-gray-600">
                                    {student.free_account !== false ? 'Activada' : 'Desactivada'}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      if (student.free_account !== false) {
                                        setSelectedStudent(student);
                                        setShowFreeAccountWarning(true);
                                      } else {
                                        handleToggleFreeAccount(student, true);
                                      }
                                    }}
                                  >
                                    {student.free_account !== false ? 'Desactivar' : 'Activar'}
                                  </Button>
                                </div>
                              </div>

                              {/* Límite Diario */}
                              <div className="bg-gray-50 rounded-lg p-3 border">
                                <Label className="text-xs font-bold text-gray-700 uppercase mb-2 block">
                                  Límite Diario
                                </Label>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-gray-600">
                                    S/ {student.daily_limit.toFixed(2)}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openSettingsModal(student)}
                                  >
                                    Modificar
                                  </Button>
                                </div>
                              </div>
                            </div>

                            {/* Vínculos Familiares */}
                            <div className="pt-3 border-t">
                              <Button
                                variant="ghost"
                                className="w-full justify-start text-left hover:bg-purple-50"
                                onClick={() => {
                                  setSelectedStudent(student);
                                  setShowLinksManager(true);
                                }}
                              >
                                <UsersIcon className="h-4 w-4 mr-2 text-purple-600" />
                                <span className="text-sm font-semibold text-purple-700">
                                  Gestionar Vínculos Familiares
                                </span>
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
          </div>
        )}

      </main>

      {/* MODALES */}
      <AddStudentModal
        isOpen={showAddStudent}
        onClose={() => setShowAddStudent(false)}
        onSuccess={fetchStudents}
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

          <WeeklyMenuModal
            isOpen={showMenuModal}
            onClose={() => setShowMenuModal(false)}
            schoolId={selectedStudent.school_id || ''}
          />

          <UploadPhotoModal
            isOpen={showUploadPhoto}
            onClose={() => setShowUploadPhoto(false)}
            studentId={selectedStudent.id}
            studentName={selectedStudent.full_name}
            onSuccess={fetchStudents}
          />

          {/* Modal de Límite Diario */}
          <Dialog open={showLimitModal} onOpenChange={setShowLimitModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Límite de Gasto Diario</DialogTitle>
                <DialogDescription>
                  Configura el monto máximo que {selectedStudent.full_name} puede gastar por día
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="limit">Límite Diario (S/)</Label>
                  <Input
                    id="limit"
                    type="number"
                    step="0.50"
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    className="text-lg font-semibold"
                    placeholder="15.00"
                  />
                  <p className="text-xs text-gray-500 mt-1">Coloca 0 para sin límite</p>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-yellow-800">
                    Este límite ayuda a controlar los gastos diarios del estudiante en el kiosco.
                  </p>
                </div>

                <Button 
                  onClick={handleUpdateLimit}
                  disabled={isUpdatingLimit}
                  className="w-full"
                >
                  {isUpdatingLimit ? 'Actualizando...' : 'Actualizar Límite'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Modal de Historial */}
          <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-2xl">
                    Historial de {selectedStudent.full_name}
                  </DialogTitle>
                  <Button variant="ghost" size="icon" onClick={() => setShowHistoryModal(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </DialogHeader>

              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-12">
                  <History className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">Sin transacciones aún</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.map((trans) => (
                    <Card key={trans.id} className="border">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-gray-900">
                              {trans.type === 'recharge' ? '💰 Recarga' : '🛒 Compra'}
                            </p>
                            <p className="text-sm text-gray-600">{trans.description}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {format(new Date(trans.created_at), "d 'de' MMMM, yyyy 'a las' HH:mm", { locale: es })}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-lg font-bold ${trans.type === 'recharge' ? 'text-green-600' : 'text-red-600'}`}>
                              {trans.type === 'recharge' ? '+' : '-'} S/ {trans.amount.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-500">
                              Saldo: S/ {trans.balance_after.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Modal de Advertencia de Cuenta Libre */}
      {selectedStudent && (
        <>
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

      {activeTab === 'mas' && <MoreMenu userEmail={user?.email || ''} onLogout={handleLogout} />}

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
              onClick={() => setActiveTab('configuracion')}
              className={`flex flex-col items-center justify-center py-3 transition-all ${
                activeTab === 'configuracion'
                  ? 'text-[#8B4513] bg-[#FFF8E7]'
                  : 'text-gray-500 hover:text-[#8B4513] hover:bg-gray-50'
              }`}
            >
              <Settings className="h-6 w-6 mb-1" />
              <span className="text-xs font-semibold">Config</span>
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
    </div>
  );
};

export default Index;
