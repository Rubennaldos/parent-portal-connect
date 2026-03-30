import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  Printer,
  Download,
  Send,
  History,
  Settings,
  Plus,
  Minus
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashRegisterClosure, CashRegisterSummary, PaymentMethodStats } from '@/types/cashRegister';
import { CashMovementForm } from './CashMovementForm';
import { CashClosureForm } from './CashClosureForm';
import { CashRegisterHistory } from './CashRegisterHistory';
import { CashRegisterSettings } from './CashRegisterSettings';
import { CashRegisterReport } from './CashRegisterReport';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

export function CashRegisterClosure() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentClosure, setCurrentClosure] = useState<CashRegisterClosure | null>(null);
  const [summary, setSummary] = useState<CashRegisterSummary | null>(null);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [movementType, setMovementType] = useState<'income' | 'expense'>('expense');

  useEffect(() => {
    loadCurrentClosure();
  }, [profile?.school_id]);

  const loadCurrentClosure = async () => {
    if (!profile?.school_id) return;

    try {
      setLoading(true);

      // Buscar cierre abierto del día actual
      const { data: closure, error } = await supabase
        .from('cash_register_closures')
        .select('*')
        .eq('school_id', profile.school_id)
        .eq('closure_date', format(new Date(), 'yyyy-MM-dd'))
        .eq('status', 'open')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading closure:', error);
        return;
      }

      setCurrentClosure(closure);

      if (closure) {
        await calculateSummary(closure);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateSummary = async (closure: CashRegisterClosure) => {
    // Calcular totales de POS y almuerzos desde las transacciones del día
    const posTotal = closure.pos_cash + closure.pos_card + closure.pos_yape + 
                     closure.pos_yape_qr + closure.pos_credit +
                     closure.pos_mixed_cash + closure.pos_mixed_card + closure.pos_mixed_yape;

    const lunchTotal = closure.lunch_cash + closure.lunch_credit;

    const totalCash = closure.pos_cash + closure.pos_mixed_cash + closure.lunch_cash;
    const totalCredit = closure.pos_credit + closure.lunch_credit;

    const summary: CashRegisterSummary = {
      openingBalance: closure.opening_balance,
      
      posTotal,
      posCash: closure.pos_cash + closure.pos_mixed_cash,
      posCard: closure.pos_card + closure.pos_mixed_card,
      posYape: closure.pos_yape + closure.pos_mixed_yape,
      posYapeQR: closure.pos_yape_qr,
      posCredit: closure.pos_credit,
      posMixedCash: closure.pos_mixed_cash,
      posMixedCard: closure.pos_mixed_card,
      posMixedYape: closure.pos_mixed_yape,
      
      lunchTotal,
      lunchCash: closure.lunch_cash,
      lunchCredit: closure.lunch_credit,
      
      totalIncome: closure.total_income,
      totalExpenses: closure.total_expenses,
      
      totalCash,
      totalCredit,
      expectedBalance: closure.expected_balance,
      actualBalance: closure.actual_balance,
      difference: closure.difference
    };

    setSummary(summary);
  };

  const handleOpenClosure = async () => {
    if (!profile?.school_id || !user) return;

    try {
      // Verificar si ya existe un cierre abierto
      const { data: existing } = await supabase
        .from('cash_register_closures')
        .select('id')
        .eq('school_id', profile.school_id)
        .eq('status', 'open')
        .single();

      if (existing) {
        alert('Ya existe un cierre de caja abierto');
        return;
      }

      // Obtener el cierre anterior para calcular saldo inicial
      const { data: lastClosure } = await supabase
        .from('cash_register_closures')
        .select('actual_balance, petty_cash, safe_cash')
        .eq('school_id', profile.school_id)
        .eq('status', 'closed')
        .order('closure_date', { ascending: false })
        .limit(1)
        .single();

      const openingBalance = lastClosure?.petty_cash || 0;

      // Crear nuevo cierre
      const { data: newClosure, error } = await supabase
        .from('cash_register_closures')
        .insert({
          school_id: profile.school_id,
          opened_by: user.id,
          closed_by: user.id,
          opening_balance: openingBalance,
          status: 'open'
        })
        .select()
        .single();

      if (error) throw error;

      setCurrentClosure(newClosure);
      await calculateSummary(newClosure);
    } catch (error) {
      console.error('Error opening closure:', error);
      alert('Error al abrir la caja');
    }
  };

  const getPaymentMethodStats = (): PaymentMethodStats[] => {
    if (!summary) return [];

    const stats: PaymentMethodStats[] = [
      { method: 'cash', label: 'Efectivo', amount: summary.totalCash, percentage: 0, color: '#10b981' },
      { method: 'card', label: 'Tarjeta', amount: summary.posCard, percentage: 0, color: '#3b82f6' },
      { method: 'yape', label: 'Yape', amount: summary.posYape, percentage: 0, color: '#8b5cf6' },
      { method: 'yape_qr', label: 'Yape QR', amount: summary.posYapeQR, percentage: 0, color: '#ec4899' },
      { method: 'credit', label: 'Crédito', amount: summary.totalCredit, percentage: 0, color: '#f59e0b' },
    ];

    const total = stats.reduce((sum, stat) => sum + stat.amount, 0);
    
    return stats
      .map(stat => ({
        ...stat,
        percentage: total > 0 ? (stat.amount / total) * 100 : 0
      }))
      .filter(stat => stat.amount > 0);
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]">Cargando...</div>;
  }

  if (!currentClosure) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Unlock className="h-6 w-6" />
              Apertura de Caja
            </CardTitle>
            <CardDescription>
              No hay un cierre de caja abierto para hoy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleOpenClosure} size="lg">
              <Unlock className="mr-2 h-5 w-5" />
              Abrir Caja del Día
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const paymentStats = getPaymentMethodStats();
  const hasDifference = summary?.difference && Math.abs(summary.difference) > 0.01;
  const differenceColor = summary?.difference ? (summary.difference > 0 ? 'text-green-600' : 'text-red-600') : '';

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cierre de Caja</h1>
          <p className="text-muted-foreground">
            {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowHistory(true)}>
            <History className="mr-2 h-4 w-4" />
            Historial
          </Button>
          {profile?.role === 'admin' && (
            <Button variant="outline" onClick={() => setShowSettings(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Configuración
            </Button>
          )}
          <Badge variant={currentClosure.status === 'open' ? 'default' : 'secondary'}>
            {currentClosure.status === 'open' ? 'Abierto' : 'Cerrado'}
          </Badge>
        </div>
      </div>

      {/* Resumen Ejecutivo */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Caja Inicial</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">S/ {summary?.openingBalance.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Esperado</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              S/ {summary?.expectedBalance.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Real</CardTitle>
            {summary?.actualBalance !== null ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.actualBalance !== null 
                ? `S/ ${summary.actualBalance.toFixed(2)}` 
                : 'Pendiente'}
            </div>
          </CardContent>
        </Card>

        <Card className={hasDifference ? 'border-yellow-500' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Diferencia</CardTitle>
            {hasDifference && <AlertTriangle className="h-4 w-4 text-yellow-600" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${differenceColor}`}>
              {summary?.difference !== null 
                ? `S/ ${summary.difference.toFixed(2)}` 
                : '-'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerta de diferencia */}
      {hasDifference && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Existe una diferencia de S/ {Math.abs(summary?.difference || 0).toFixed(2)} en el cierre.
            Se requiere justificación y aprobación.
          </AlertDescription>
        </Alert>
      )}

      {/* Contenido Principal */}
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="movements">Movimientos</TabsTrigger>
          <TabsTrigger value="close">Cerrar Caja</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Desglose por Método de Pago */}
            <Card>
              <CardHeader>
                <CardTitle>Métodos de Pago</CardTitle>
                <CardDescription>Distribución de ventas</CardDescription>
              </CardHeader>
              <CardContent>
                {paymentStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={paymentStats}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percentage }) => `${name}: ${percentage.toFixed(1)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="amount"
                      >
                        {paymentStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `S/ ${value.toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-8">
                    No hay ventas registradas
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Resumen de Ventas */}
            <Card>
              <CardHeader>
                <CardTitle>Resumen de Ventas</CardTitle>
                <CardDescription>Punto de Venta y Almuerzos</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm font-medium">Punto de Venta</span>
                  <span className="text-lg font-bold">S/ {summary?.posTotal.toFixed(2)}</span>
                </div>
                <div className="pl-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Efectivo:</span>
                    <span>S/ {summary?.posCash.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tarjeta:</span>
                    <span>S/ {summary?.posCard.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Yape:</span>
                    <span>S/ {summary?.posYape.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Yape QR:</span>
                    <span>S/ {summary?.posYapeQR.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Crédito:</span>
                    <span>S/ {summary?.posCredit.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pb-2 border-b pt-2">
                  <span className="text-sm font-medium">Almuerzos</span>
                  <span className="text-lg font-bold">S/ {summary?.lunchTotal.toFixed(2)}</span>
                </div>
                <div className="pl-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Efectivo:</span>
                    <span>S/ {summary?.lunchCash.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Crédito:</span>
                    <span>S/ {summary?.lunchCredit.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 border-t font-bold">
                  <span>TOTAL</span>
                  <span className="text-xl">
                    S/ {((summary?.posTotal || 0) + (summary?.lunchTotal || 0)).toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Movimientos de Caja */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Movimientos de Caja</CardTitle>
                  <CardDescription>Ingresos y egresos del día</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMovementType('income');
                      setShowMovementForm(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Ingreso
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMovementType('expense');
                      setShowMovementForm(true);
                    }}
                  >
                    <Minus className="mr-2 h-4 w-4" />
                    Egreso
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-green-600">
                    <TrendingUp className="h-5 w-5" />
                    <span className="font-semibold">Ingresos</span>
                  </div>
                  <p className="text-3xl font-bold text-green-600">
                    S/ {summary?.totalIncome.toFixed(2)}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-600">
                    <TrendingDown className="h-5 w-5" />
                    <span className="font-semibold">Egresos</span>
                  </div>
                  <p className="text-3xl font-bold text-red-600">
                    S/ {summary?.totalExpenses.toFixed(2)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Movimientos</CardTitle>
              <CardDescription>Todos los movimientos de caja del día</CardDescription>
            </CardHeader>
            <CardContent>
              {/* TODO: Componente de lista de movimientos */}
              <p className="text-center text-muted-foreground py-8">
                Lista de movimientos aquí
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="close">
          <CashClosureForm
            closure={currentClosure}
            summary={summary}
            onClose={() => loadCurrentClosure()}
          />
        </TabsContent>
      </Tabs>

      {/* Modales */}
      {showMovementForm && (
        <CashMovementForm
          closureId={currentClosure.id}
          movementType={movementType}
          onClose={() => {
            setShowMovementForm(false);
            loadCurrentClosure();
          }}
        />
      )}

      {showHistory && (
        <CashRegisterHistory
          schoolId={profile!.school_id!}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showSettings && profile?.role === 'admin' && (
        <CashRegisterSettings
          schoolId={profile.school_id!}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
