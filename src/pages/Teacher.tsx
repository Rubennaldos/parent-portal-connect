import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogOut, User, ShoppingBag, UtensilsCrossed, Home, MoreHorizontal, Loader2, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TeacherOnboardingModal } from '@/components/teacher/TeacherOnboardingModal';
import { TeacherMoreMenu } from '@/components/teacher/TeacherMoreMenu';
import { OrderLunchMenus } from '@/components/lunch/OrderLunchMenus';

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
      }
    }
  }, [activeTab, teacherProfile]);

  const fetchCurrentBalance = async () => {
    if (!teacherProfile) return;

    try {
      console.log('💰 Calculando balance actual del profesor');

      // Obtener todas las transacciones del profesor
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('teacher_id', teacherProfile.id);

      if (error) throw error;

      // Calcular balance
      const balance = transactions?.reduce((sum, t) => sum + t.amount, 0) || 0;
      setCurrentBalance(balance);

      console.log('✅ Balance actual:', balance);
    } catch (error: any) {
      console.error('❌ Error calculando balance:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo calcular el balance.',
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
          transaction_items (
            product_name,
            quantity,
            unit_price,
            subtotal
          )
        `)
        .eq('teacher_id', teacherProfile.id)
        .eq('type', 'purchase');

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

      const { data: transactions, error } = await query.order('created_at', { ascending: false });

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
              {/* Card: Balance Actual */}
              <Card>
                <CardHeader>
                  <CardTitle>Balance de Cuenta</CardTitle>
                  <CardDescription>
                    Como profesor, tu cuenta es libre sin límites de gasto.
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>

              {/* Card: Historial de Transacciones */}
              <Card>
                <CardHeader>
                  <CardTitle>Todas las Transacciones</CardTitle>
                  <CardDescription>
                    Historial completo de compras y pagos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {purchaseHistory.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <DollarSign className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-semibold mb-2">Sin transacciones</p>
                      <p className="text-sm">
                        Aún no has realizado ninguna compra.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {purchaseHistory.map((transaction) => (
                        <div key={transaction.id} className="border rounded-lg p-4">
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
                                })}
                              </p>
                              {transaction.ticket_code && (
                                <p className="text-xs text-gray-400 mt-1">
                                  Ticket: {transaction.ticket_code}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className={`text-2xl font-bold ${transaction.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {transaction.amount < 0 ? '-' : '+'} S/ {Math.abs(transaction.amount).toFixed(2)}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                {transaction.amount < 0 ? 'Compra' : 'Pago'}
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

            {/* TAB: MENÚ */}
            <TabsContent value="menu">
              {teacherProfile.school_1_id && (
                <OrderLunchMenus 
                  userType="teacher"
                  userId={teacherProfile.id}
                  userSchoolId={teacherProfile.school_1_id}
                />
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
