import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  GraduationCap, 
  LogOut, 
  Users, 
  Wallet, 
  History, 
  Plus,
  CreditCard,
  Smartphone,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Settings,
  Receipt,
  MessageSquare,
  UtensilsCrossed,
  AlertTriangle,
  Nfc,
  Mail,
  Calendar,
  Sliders,
  Key,
  Bell,
  Shield,
  HelpCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AddStudentModal } from '@/components/AddStudentModal';
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
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  
  // Estado para Modal de Agregar Estudiante
  const [showAddStudent, setShowAddStudent] = useState(false);
  
  // Estados para Modal de Recarga
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeMethod, setRechargeMethod] = useState<'yape' | 'plin' | 'card'>('yape');
  const [isRecharging, setIsRecharging] = useState(false);
  
  // Estados para Historial
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  // Estados para Límite Diario
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
        .order('name', { ascending: true });

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
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar el historial',
      });
    }
  };

  const handleRecharge = async () => {
    if (!selectedStudent) return;
    
    const amount = parseFloat(rechargeAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa un monto válido',
      });
      return;
    }

    setIsRecharging(true);

    try {
      const newBalance = selectedStudent.balance + amount;

      // 1. Crear transacción
      const { error: transError } = await supabase
        .from('transactions')
        .insert({
          student_id: selectedStudent.id,
          type: 'recharge',
          amount: amount,
          description: `Recarga vía ${rechargeMethod === 'yape' ? 'Yape' : rechargeMethod === 'plin' ? 'Plin' : 'Tarjeta'}`,
          balance_after: newBalance,
          created_by: user?.id,
        });

      if (transError) throw transError;

      // 2. Actualizar saldo del estudiante
      const { error: updateError } = await supabase
        .from('students')
        .update({ balance: newBalance })
        .eq('id', selectedStudent.id);

      if (updateError) throw updateError;

      // 3. Éxito
      toast({
        title: '✅ ¡Recarga Exitosa!',
        description: `Nuevo saldo: S/ ${newBalance.toFixed(2)}`,
        duration: 3000,
      });

      // 4. Actualizar estado local
      setStudents(students.map(s => 
        s.id === selectedStudent.id ? { ...s, balance: newBalance } : s
      ));
      setSelectedStudent({ ...selectedStudent, balance: newBalance });
      setRechargeAmount('');

    } catch (error: any) {
      console.error('Error processing recharge:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo completar la recarga: ' + error.message,
      });
    } finally {
      setIsRecharging(false);
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

      setStudents(students.map(s => 
        s.id === selectedStudent.id ? { ...s, daily_limit: limit } : s
      ));
      setSelectedStudent({ ...selectedStudent, daily_limit: limit });
      setNewLimit('');

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

  const handleSignOut = async () => {
    await signOut();
  };

  const openHistoryModal = (student: Student) => {
    setSelectedStudent(student);
    fetchTransactions(student.id);
    setShowHistory(true);
  };

  // Mostrar loader mientras verifica onboarding
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Verificando...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <GraduationCap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-gray-800">Portal de Padres</h1>
              <p className="text-xs text-gray-500">Kiosco Escolar - Lima Café 28</p>
            </div>
          </div>
          <span className="text-sm text-gray-600 hidden sm:block">
              {user?.email}
            </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {/* Pestañas Principales */}
        <Tabs defaultValue="alumnos" className="w-full">
          {/* Contenido de las pestañas */}

          {/* Pestaña: Alumnos */}
          <TabsContent value="alumnos" className="space-y-4">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Mis Alumnos</h2>
              <p className="text-gray-600 text-sm mt-1">Gestiona las cuentas del kiosco de tus hijos</p>
            </div>
            
            {/* Estado Vacío */}
            {students.length === 0 && (
          <Card className="border-2 border-dashed border-gray-300 bg-white/50">
            <CardContent className="py-16 text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Users className="h-10 w-10 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">No hay estudiantes registrados</h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">
                Comienza agregando a tus hijos para gestionar sus cuentas del kiosco escolar
              </p>
              <Button size="lg" className="shadow-lg" onClick={() => setShowAddStudent(true)}>
                <Plus className="h-5 w-5 mr-2" />
                Registrar mi Primer Estudiante
              </Button>
            </CardContent>
          </Card>
        )}

            {/* Grid de Estudiantes */}
            {students.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {students.map((student) => (
              <Card key={student.id} className="overflow-hidden hover:shadow-xl transition-shadow border-2">
                <div className="h-24 bg-gradient-to-br from-blue-500 to-purple-600"></div>
                <CardContent className="pt-0 px-6 pb-6">
                  {/* Foto del Estudiante */}
                  <div className="flex justify-center -mt-12 mb-4">
                    <img
                      src={student.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.full_name}`}
                      alt={student.full_name}
                      className="w-24 h-24 rounded-full border-4 border-white shadow-lg"
                    />
                  </div>

                  {/* Información del Estudiante */}
                  <div className="text-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800 mb-1">{student.full_name}</h3>
                    <p className="text-sm text-gray-600">{student.grade} - {student.section}</p>
                  </div>

                  {/* Saldo */}
                  <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 mb-4">
                    <p className="text-xs text-green-700 uppercase tracking-wide font-semibold mb-1">
                      Saldo Disponible
                    </p>
                    <p className="text-4xl font-bold text-green-600">
                      S/ {student.balance.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      Límite diario: S/ {student.daily_limit.toFixed(2)}
                    </p>
                  </div>

                  {/* Botones de Acción */}
                  <div className="grid grid-cols-2 gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          className="w-full"
                          onClick={() => {
                            setSelectedStudent(student);
                            setRechargeAmount('');
                          }}
                        >
                          <Wallet className="h-4 w-4 mr-2" />
                          Recargar
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Recargar Saldo</DialogTitle>
                          <DialogDescription>
                            Recarga el saldo de {selectedStudent?.full_name}
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="space-y-4">
                          {/* Saldo Actual */}
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-gray-600">Saldo actual</p>
                            <p className="text-2xl font-bold text-blue-600">
                              S/ {selectedStudent?.balance.toFixed(2)}
                            </p>
                          </div>

                          {/* Monto a Recargar */}
                          <div>
                            <Label htmlFor="amount">Monto a recargar</Label>
                            <Input
                              id="amount"
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={rechargeAmount}
                              onChange={(e) => setRechargeAmount(e.target.value)}
                              className="text-lg font-semibold"
                            />
                          </div>

                          {/* Método de Pago */}
                          <div>
                            <Label>Método de Pago</Label>
                            <Tabs value={rechargeMethod} onValueChange={(v) => setRechargeMethod(v as any)} className="mt-2">
                              <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="yape">
                                  <Smartphone className="h-4 w-4 mr-1" />
                                  Yape
                                </TabsTrigger>
                                <TabsTrigger value="plin">
                                  <Smartphone className="h-4 w-4 mr-1" />
                                  Plin
                                </TabsTrigger>
                                <TabsTrigger value="card">
                                  <CreditCard className="h-4 w-4 mr-1" />
                                  Tarjeta
                                </TabsTrigger>
                              </TabsList>
                            </Tabs>
                          </div>

                          {/* Vista Previa */}
                          {rechargeAmount && !isNaN(parseFloat(rechargeAmount)) && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <p className="text-sm text-gray-600">Nuevo saldo será</p>
                              <p className="text-2xl font-bold text-green-600">
                                S/ {(selectedStudent!.balance + parseFloat(rechargeAmount)).toFixed(2)}
                              </p>
                            </div>
                          )}

                          <Button 
                            onClick={handleRecharge} 
                            disabled={isRecharging}
                            className="w-full"
                          >
                            {isRecharging ? 'Procesando...' : `Recargar S/ ${rechargeAmount || '0.00'}`}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button 
                      variant="outline"
                      onClick={() => openHistoryModal(student)}
                    >
                      <History className="h-4 w-4 mr-2" />
                      Historial
                    </Button>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="outline"
                          className="col-span-2"
                          onClick={() => {
                            setSelectedStudent(student);
                            setNewLimit(student.daily_limit.toString());
                          }}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Configurar Límite Diario
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Límite de Gasto Diario</DialogTitle>
                          <DialogDescription>
                            Configura el monto máximo que {selectedStudent?.full_name} puede gastar por día
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="limit">Límite Diario (S/)</Label>
                            <Input
                              id="limit"
                              type="number"
                              step="0.01"
                              value={newLimit}
                              onChange={(e) => setNewLimit(e.target.value)}
                              className="text-lg font-semibold"
                            />
                          </div>

                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
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
                  </div>
                </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Pestaña: Pagos */}
          <TabsContent value="pagos" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Historial de Pagos y Recargas
                </CardTitle>
                <CardDescription>
                  Revisa todas las transacciones realizadas en el sistema
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center py-8 text-gray-500">
                  <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Historial de pagos centralizado</p>
                  <p className="text-sm mt-2">Próximamente: filtros por estudiante, fecha y tipo</p>
                </div>
            </CardContent>
          </Card>
          </TabsContent>

          {/* Pestaña: Consultas */}
          <TabsContent value="consultas" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Preguntas y Consultas
                </CardTitle>
                <CardDescription>
                  Envía tus dudas o comentarios al personal del kiosco
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="consulta">Tu consulta</Label>
                    <textarea
                      id="consulta"
                      className="w-full min-h-[120px] px-3 py-2 border rounded-md resize-none"
                      placeholder="Escribe tu pregunta o comentario aquí..."
                    />
                  </div>
                  <Button className="w-full">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Enviar Consulta
                  </Button>
                  
                  <div className="mt-8">
                    <h3 className="font-semibold mb-3">Consultas Frecuentes</h3>
                    <div className="space-y-2">
                      <details className="border rounded-lg p-3">
                        <summary className="font-medium cursor-pointer">¿Cómo recargo el saldo?</summary>
                        <p className="text-sm text-gray-600 mt-2">Ingresa a la pestaña "Alumnos" y presiona el botón "Recargar" en la tarjeta de tu hijo.</p>
                      </details>
                      <details className="border rounded-lg p-3">
                        <summary className="font-medium cursor-pointer">¿Puedo ver qué compró mi hijo?</summary>
                        <p className="text-sm text-gray-600 mt-2">Sí, presiona "Historial" en la tarjeta del estudiante para ver todas las transacciones.</p>
                      </details>
                      <details className="border rounded-lg p-3">
                        <summary className="font-medium cursor-pointer">¿Cómo funciona el límite diario?</summary>
                        <p className="text-sm text-gray-600 mt-2">El límite diario controla cuánto puede gastar tu hijo por día en el kiosco.</p>
                      </details>
                    </div>
                  </div>
              </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña: Nutrición */}
          <TabsContent value="nutricion" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UtensilsCrossed className="h-5 w-5" />
                  Menú Semanal del Kiosco
                </CardTitle>
                <CardDescription>
                  Conoce las opciones nutritivas disponibles cada día
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">Lunes</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Sándwich de pollo</li>
                      <li>• Ensalada de frutas</li>
                      <li>• Jugos naturales</li>
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">Martes</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Hamburguesa saludable</li>
                      <li>• Yogurt con granola</li>
                      <li>• Agua de frutas</li>
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">Miércoles</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Pizza integral</li>
                      <li>• Ensalada verde</li>
                      <li>• Refresco natural</li>
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">Jueves</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Hot dog saludable</li>
                      <li>• Snacks nutritivos</li>
                      <li>• Limonada</li>
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">Viernes</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Wrap de vegetales</li>
                      <li>• Fruta fresca</li>
                      <li>• Smoothies</li>
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4 bg-blue-50">
                    <h3 className="font-semibold mb-2 text-blue-900">Información</h3>
                    <p className="text-sm text-blue-700">
                      Todos nuestros productos cumplen con estándares nutricionales para escolares.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña: Alergias */}
          <TabsContent value="alergias" className="space-y-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Alergias</h2>
              <p className="text-gray-600 text-sm mt-1">Registro de alergias de tus hijos</p>
            </div>
            
            <Card>
              <CardContent className="pt-6">
                {students.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No hay estudiantes registrados</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {students.map((student) => (
                      <Card key={student.id} className="border-2">
                        <CardContent className="pt-6">
                          <div className="flex items-center gap-4 mb-4">
                            <img
                              src={student.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.full_name}`}
                              alt={student.full_name}
                              className="w-12 h-12 rounded-full"
                            />
                            <div>
                              <h3 className="font-semibold">{student.full_name}</h3>
                              <p className="text-sm text-gray-600">{student.grade} - {student.section}</p>
                            </div>
                          </div>
                          
                          <div className="space-y-3">
                            <div>
                              <Label htmlFor={`allergies-${student.id}`}>Alergias conocidas</Label>
                              <textarea
                                id={`allergies-${student.id}`}
                                className="w-full min-h-[80px] px-3 py-2 border rounded-md resize-none text-sm"
                                placeholder="Ej: Alérgico a los maní, lácteos, mariscos..."
                              />
                            </div>
                            <Button variant="outline" size="sm" className="w-full">
                              Guardar Información
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña: Configuración */}
          <TabsContent value="config" className="space-y-4">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Configuración</h2>
              <p className="text-gray-600 text-sm mt-1">Ajusta tu cuenta y preferencias</p>
            </div>

            <div className="space-y-3">
              {/* Información del Usuario */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">
                        {user?.email?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{user?.email}</h3>
                      <Badge variant="secondary">Padre de Familia</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Opciones de Configuración */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Opciones de Cuenta</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Cambiar Contraseña',
                      description: 'Función próximamente disponible',
                    });
                  }}>
                    <Key className="h-4 w-4 mr-2" />
                    Cambiar Contraseña
                  </Button>
                  
                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Notificaciones',
                      description: 'Configuración de notificaciones próximamente',
                    });
                  }}>
                    <Bell className="h-4 w-4 mr-2" />
                    Notificaciones
                  </Button>

                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Configuración de App',
                      description: 'Opciones avanzadas próximamente',
                    });
                  }}>
                    <Sliders className="h-4 w-4 mr-2" />
                    Configuración de App
                  </Button>
            </CardContent>
          </Card>

              {/* Funciones Próximamente */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Próximamente</CardTitle>
            </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" disabled>
                    <Nfc className="h-4 w-4 mr-2" />
                    Activar NFC
                    <Badge variant="secondary" className="ml-auto">Próximamente</Badge>
                  </Button>
                  
                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Evento Privado',
                      description: 'Función próximamente disponible',
                    });
                  }}>
                    <Calendar className="h-4 w-4 mr-2" />
                    Eventos Privados
                  </Button>
            </CardContent>
          </Card>

              {/* Soporte y Contacto */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Soporte</CardTitle>
            </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Contacto',
                      description: 'Envíanos un correo a: soporte@limacafe28.com',
                    });
                  }}>
                    <Mail className="h-4 w-4 mr-2" />
                    Contacto
                  </Button>
                  
                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Ayuda',
                      description: 'Visita nuestra sección de preguntas frecuentes',
                    });
                  }}>
                    <HelpCircle className="h-4 w-4 mr-2" />
                    Ayuda
                  </Button>

                  <Button variant="outline" className="w-full justify-start" onClick={() => {
                    toast({
                      title: 'Privacidad',
                      description: 'Consulta nuestras políticas de privacidad',
                    });
                  }}>
                    <Shield className="h-4 w-4 mr-2" />
                    Privacidad y Seguridad
                  </Button>
            </CardContent>
          </Card>

              {/* Cerrar Sesión */}
              <Card className="border-red-200">
                <CardContent className="pt-6">
                  <Button 
                    variant="destructive" 
                    className="w-full" 
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Cerrar Sesión
            </Button>
          </CardContent>
        </Card>
            </div>
          </TabsContent>

          {/* Barra de Navegación Inferior (Bottom Navigation) */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50">
            <TabsList className="grid w-full grid-cols-5 h-16 bg-white rounded-none">
              <TabsTrigger 
                value="alumnos" 
                className="flex flex-col items-center gap-1 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600"
              >
                <Users className="h-5 w-5" />
                <span className="text-xs">Alumnos</span>
              </TabsTrigger>
              <TabsTrigger 
                value="pagos" 
                className="flex flex-col items-center gap-1 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600"
              >
                <Receipt className="h-5 w-5" />
                <span className="text-xs">Pagos</span>
              </TabsTrigger>
              <TabsTrigger 
                value="nutricion" 
                className="flex flex-col items-center gap-1 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600"
              >
                <UtensilsCrossed className="h-5 w-5" />
                <span className="text-xs">Menú</span>
              </TabsTrigger>
              <TabsTrigger 
                value="alergias" 
                className="flex flex-col items-center gap-1 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600"
              >
                <AlertTriangle className="h-5 w-5" />
                <span className="text-xs">Alergias</span>
              </TabsTrigger>
              <TabsTrigger 
                value="config" 
                className="flex flex-col items-center gap-1 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600"
              >
                <Settings className="h-5 w-5" />
                <span className="text-xs">Config</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </Tabs>

        {/* Modal de Historial */}
        <Dialog open={showHistory} onOpenChange={setShowHistory}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Historial de Movimientos</DialogTitle>
              <DialogDescription>
                Últimas transacciones de {selectedStudent?.full_name}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-96 overflow-y-auto">
              {transactions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No hay transacciones registradas</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((trans) => (
                    <div 
                      key={trans.id}
                      className="border rounded-lg p-3 hover:bg-gray-50 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          trans.type === 'recharge' ? 'bg-green-100' : 'bg-red-100'
                        }`}>
                          {trans.type === 'recharge' ? (
                            <TrendingUp className="h-5 w-5 text-green-600" />
                          ) : (
                            <TrendingDown className="h-5 w-5 text-red-600" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {trans.type === 'recharge' ? 'Recarga' : 'Compra'}
                          </p>
                          <p className="text-xs text-gray-600">{trans.description}</p>
                          <p className="text-xs text-gray-500">
                            {format(new Date(trans.created_at), "dd MMM yyyy, HH:mm", { locale: es })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${
                          trans.type === 'recharge' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {trans.type === 'recharge' ? '+' : '-'} S/ {Math.abs(trans.amount).toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-500">
                          Saldo: S/ {trans.balance_after.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal de Agregar Estudiante */}
        <AddStudentModal
          open={showAddStudent}
          onOpenChange={setShowAddStudent}
          onStudentAdded={fetchStudents}
          parentId={user?.id || ''}
        />
      </main>
    </div>
  );
};

export default Index;
