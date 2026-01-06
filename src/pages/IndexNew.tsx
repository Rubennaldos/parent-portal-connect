import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  GraduationCap, 
  LogOut, 
  Plus,
  History,
  X
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
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
  balance_after: number;
}

const Index = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { isChecking } = useOnboardingCheck();
  
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddStudent, setShowAddStudent] = useState(false);
  
  // Modales
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showUploadPhoto, setShowUploadPhoto] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // Estudiante seleccionado para cada acción
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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
        .limit(50);

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

      // 1. Crear transacción
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

      // 2. Actualizar saldo
      const { error: updateError } = await supabase
        .from('students')
        .update({ balance: newBalance })
        .eq('id', selectedStudent.id);

      if (updateError) throw updateError;

      // 3. Éxito
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
    setShowSettingsModal(true);
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <GraduationCap className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Portal de Padres</h1>
                <p className="text-sm text-gray-500">Lima Café 28</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <VersionBadge />
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Mis Alumnos</h2>
          <p className="text-gray-600">Gestiona las cuentas del kiosco de tus hijos</p>
        </div>

        {/* Sin estudiantes */}
        {students.length === 0 && (
          <Card className="border-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <GraduationCap className="h-16 w-16 text-gray-400 mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                No hay estudiantes registrados
              </h3>
              <p className="text-gray-600 mb-6 text-center max-w-md">
                Agrega a tu primer hijo para empezar a usar el kiosco escolar
              </p>
              <Button size="lg" onClick={() => setShowAddStudent(true)}>
                <Plus className="h-5 w-5 mr-2" />
                Registrar mi Primer Estudiante
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Grid de Estudiantes */}
        {students.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
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

            {/* Botón Agregar Estudiante */}
            <Card className="border-2 border-dashed hover:border-blue-400 transition-colors cursor-pointer" onClick={() => setShowAddStudent(true)}>
              <CardContent className="flex items-center justify-center py-8">
                <Plus className="h-6 w-6 text-gray-400 mr-2" />
                <span className="text-gray-600 font-medium">Agregar otro estudiante</span>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {/* Modales */}
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

          {/* Modal de Settings (placeholder) */}
          <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Configuración de {selectedStudent.full_name}</DialogTitle>
              </DialogHeader>
              <p className="text-gray-600">Próximamente: configuración de topes y límites</p>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
};

export default Index;

