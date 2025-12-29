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
  Settings
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Student {
  id: string;
  name: string;
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
  
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
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
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 hidden sm:block">
              {user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-800">¡Bienvenido!</h2>
          <p className="text-gray-600 mt-1">Gestiona las cuentas del kiosco de tus hijos</p>
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
              <Button size="lg" className="shadow-lg">
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
                      src={student.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.name}`}
                      alt={student.name}
                      className="w-24 h-24 rounded-full border-4 border-white shadow-lg"
                    />
                  </div>

                  {/* Información del Estudiante */}
                  <div className="text-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800 mb-1">{student.name}</h3>
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
                            Recarga el saldo de {selectedStudent?.name}
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
                            Configura el monto máximo que {selectedStudent?.name} puede gastar por día
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

        {/* Modal de Historial */}
        <Dialog open={showHistory} onOpenChange={setShowHistory}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Historial de Movimientos</DialogTitle>
              <DialogDescription>
                Últimas transacciones de {selectedStudent?.name}
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
      </main>
    </div>
  );
};

export default Index;
