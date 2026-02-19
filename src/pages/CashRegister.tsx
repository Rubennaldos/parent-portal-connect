import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Lock, 
  Printer, 
  Download, 
  Send,
  AlertCircle,
  CheckCircle,
  Clock,
  History,
  ArrowLeft
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CashRegister, CashClosure, CashMovement, CashRegisterConfig } from '@/types/cashRegister';
import CashDashboard from './CashRegister/CashDashboard';
import CashMovements from './CashRegister/CashMovements';
import CashClosureDialog from './CashRegister/CashClosureDialog';
import CashHistoryDialog from './CashRegister/CashHistoryDialog';
import CashConfigDialog from './CashRegister/CashConfigDialog';
import { CashOpeningModal } from '@/components/cash-register/CashOpeningModal';
import AdminGeneralCashDashboard from './CashRegister/AdminGeneralCashDashboard';
import { toast } from 'sonner';

export default function CashRegisterPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentRegister, setCurrentRegister] = useState<CashRegister | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [config, setConfig] = useState<CashRegisterConfig | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  // Apertura de caja anti-fraude
  const [lastClosedAmount, setLastClosedAmount] = useState<number | null>(null);
  const [hasUnclosedPrevious, setHasUnclosedPrevious] = useState(false);
  const [previousUnclosed, setPreviousUnclosed] = useState<any | null>(null);

  // Cargar perfil del usuario
  useEffect(() => {
    const loadProfile = async () => {
      if (!user?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, role, school_id')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error cargando perfil:', error);
          return;
        }

        console.log('✅ Perfil cargado:', data);
        setProfile(data);
      } catch (error) {
        console.error('Error en loadProfile:', error);
      }
    };

    loadProfile();
  }, [user?.id]);

  // Cargar caja actual con verificación anti-fraude
  const loadCurrentRegister = async () => {
    if (!profile?.school_id) return;

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Buscar caja abierta
      const { data, error } = await supabase
        .from('cash_registers')
        .select('*')
        .eq('school_id', profile.school_id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const openedDate = new Date(data.opened_at);
        openedDate.setHours(0, 0, 0, 0);
        if (openedDate < todayStart) {
          // Caja abierta de un día anterior → sin cerrar
          setHasUnclosedPrevious(true);
          setPreviousUnclosed(data);
          setCurrentRegister(null);
        } else {
          setCurrentRegister(data);
          setHasUnclosedPrevious(false);
          setPreviousUnclosed(null);
        }
      } else {
        setCurrentRegister(null);
      }

      // Cargar último cierre para referencia de monto
      const { data: lastClosure } = await supabase
        .from('cash_closures')
        .select('actual_final')
        .eq('school_id', profile.school_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setLastClosedAmount(lastClosure?.actual_final ?? null);
    } catch (error) {
      console.error('Error al cargar caja:', error);
      toast.error('Error al cargar la caja actual');
    }
  };

  // Cargar movimientos
  const loadMovements = async () => {
    if (!currentRegister) return;

    try {
      const { data, error } = await supabase
        .from('cash_movements')
        .select('*')
        .eq('cash_register_id', currentRegister.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setMovements(data || []);
    } catch (error) {
      console.error('Error al cargar movimientos:', error);
    }
  };

  // Cargar configuración
  const loadConfig = async () => {
    if (!profile?.school_id) return;

    try {
      const { data, error } = await supabase
        .from('cash_register_config')
        .select('*')
        .eq('school_id', profile.school_id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      setConfig(data || null);
    } catch (error) {
      console.error('Error al cargar configuración:', error);
    }
  };

  // La apertura de caja ahora se maneja en CashOpeningModal

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([
        loadCurrentRegister(),
        loadConfig()
      ]);
      setLoading(false);
    };

    init();
  }, [profile?.school_id]);

  useEffect(() => {
    if (currentRegister) {
      loadMovements();
    }
  }, [currentRegister]);

  // No necesitamos verificar permisos aquí porque PermissionProtectedRoute ya lo hace
  // Si el usuario llegó hasta aquí, es porque tiene permisos

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Cargando sistema de caja...</p>
        </div>
      </div>
    );
  }

  // ── Admin General: ve el dashboard multi-sede, sin restricción de school_id ──
  if (profile?.role === 'admin_general' || profile?.role === 'super_admin') {
    return (
      <div className="container mx-auto p-6">
        <AdminGeneralCashDashboard />
      </div>
    );
  }

  // ── Otros roles sin sede asignada: error ──
  if (!profile?.school_id) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-red-200">
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">No tienes una sede asignada</h2>
            <p className="text-gray-600 mb-6">
              Contacta al administrador para que te asigne una sede.
            </p>
            <Button onClick={() => window.location.href = '/#/dashboard'}>
              Volver al Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {true && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => window.location.href = '/#/dashboard'}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al Dashboard
          </Button>
          <div>
            <h1 className="text-3xl font-bold">💰 Cierre de Caja</h1>
            <p className="text-muted-foreground">
              Gestión completa de caja, ingresos, egresos y cierre diario
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {config && (profile?.role === 'admin' || profile?.role === 'admin_general') && (
            <Button
              variant="outline"
              onClick={() => setShowConfigDialog(true)}
            >
              <Clock className="h-4 w-4 mr-2" />
              Configuración
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowHistoryDialog(true)}
          >
            <History className="h-4 w-4 mr-2" />
            Historial
          </Button>
        </div>
      </div>

      {/* Modal bloqueante de apertura / caja sin cerrar */}
      {!currentRegister && profile?.school_id && (
        <CashOpeningModal
          schoolId={profile.school_id}
          lastClosedAmount={lastClosedAmount}
          hasUnclosedPrevious={hasUnclosedPrevious}
          previousUnclosed={previousUnclosed}
          onOpened={() => {
            loadCurrentRegister();
            loadMovements();
          }}
        />
      )}

      {/* Estado de la caja */}
      {currentRegister && (
        <>
          {/* Info de caja abierta */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Caja Abierta
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Desde {format(new Date(currentRegister.opened_at), "dd MMM yyyy, HH:mm", { locale: es })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Caja inicial: <span className="font-semibold text-foreground">S/ {currentRegister.initial_amount.toFixed(2)}</span>
                  </p>
                </div>
                <Button
                  onClick={() => setShowCloseDialog(true)}
                  variant="default"
                  className="bg-red-600 hover:bg-red-700"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Cerrar Caja
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tabs principales */}
          <Tabs defaultValue="dashboard" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="movements">Ingresos/Egresos</TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard">
              <CashDashboard 
                cashRegister={currentRegister}
                movements={movements}
                onRefresh={() => {
                  loadCurrentRegister();
                  loadMovements();
                }}
              />
            </TabsContent>

            <TabsContent value="movements">
              <CashMovements
                cashRegister={currentRegister}
                movements={movements}
                onMovementAdded={() => {
                  loadMovements();
                  loadCurrentRegister();
                }}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Dialogs */}
      {showCloseDialog && currentRegister && (
        <CashClosureDialog
          cashRegister={currentRegister}
          movements={movements}
          config={config}
          onClose={() => setShowCloseDialog(false)}
          onClosed={() => {
            setShowCloseDialog(false);
            loadCurrentRegister();
            toast.success('Caja cerrada exitosamente');
          }}
        />
      )}

      {showHistoryDialog && profile?.school_id && (
        <CashHistoryDialog
          schoolId={profile.school_id}
          onClose={() => setShowHistoryDialog(false)}
        />
      )}

      {showConfigDialog && config && (
        <CashConfigDialog
          config={config}
          onClose={() => setShowConfigDialog(false)}
          onUpdated={() => {
            loadConfig();
            toast.success('Configuración actualizada');
          }}
        />
      )}
        </>
      )}
    </div>
  );
}
