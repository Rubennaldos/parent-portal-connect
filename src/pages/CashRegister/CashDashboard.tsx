import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  DollarSign, 
  CreditCard, 
  Smartphone, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  Users
} from 'lucide-react';
import { CashRegister, CashMovement, DailyTotals } from '@/types/cashRegister';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface Props {
  cashRegister: CashRegister;
  movements: CashMovement[];
  onRefresh: () => void;
}

export default function CashDashboard({ cashRegister, movements, onRefresh }: Props) {
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);
  const [loading, setLoading] = useState(true);

  // Cargar totales del día
  const loadDailyTotals = async () => {
    try {
      const { data, error } = await supabase
        .rpc('calculate_daily_totals', {
          p_school_id: cashRegister.school_id,
          p_date: format(new Date(cashRegister.opened_at), 'yyyy-MM-dd')
        });

      if (error) throw error;

      setDailyTotals(data);
    } catch (error) {
      console.error('Error al cargar totales:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDailyTotals();
  }, [cashRegister]);

  if (loading || !dailyTotals) {
    return <div>Cargando dashboard...</div>;
  }

  // Calcular totales
  const totalIngresos = movements
    .filter(m => m.type === 'ingreso')
    .reduce((sum, m) => sum + m.amount, 0);

  const totalEgresos = movements
    .filter(m => m.type === 'egreso')
    .reduce((sum, m) => sum + m.amount, 0);

  const totalCash = 
    dailyTotals.pos.cash + 
    dailyTotals.pos.mixed_cash + 
    dailyTotals.lunch.cash;

  const totalCard = 
    dailyTotals.pos.card + 
    dailyTotals.pos.mixed_card + 
    dailyTotals.lunch.card;

  const totalYape = 
    dailyTotals.pos.yape + 
    dailyTotals.pos.mixed_yape + 
    dailyTotals.lunch.yape;

  const totalYapeQR = dailyTotals.pos.yape_qr;

  const totalCredit = 
    dailyTotals.pos.credit + 
    dailyTotals.lunch.credit;

  const totalSales = dailyTotals.pos.total + dailyTotals.lunch.total;

  const expectedFinal = 
    cashRegister.initial_amount + 
    totalCash + 
    totalIngresos - 
    totalEgresos;

  // Datos para gráfico de torta
  const paymentData = [
    { name: 'Efectivo', value: totalCash, color: '#10b981' },
    { name: 'Tarjeta', value: totalCard, color: '#3b82f6' },
    { name: 'Yape', value: totalYape, color: '#8b5cf6' },
    { name: 'Yape QR', value: totalYapeQR, color: '#ec4899' },
    { name: 'Crédito', value: totalCredit, color: '#f59e0b' },
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-6">
      {/* Cards resumen ejecutivo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Esperado */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Esperado</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              S/ {expectedFinal.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              En caja al momento
            </p>
          </CardContent>
        </Card>

        {/* Total Ventas */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Ventas</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              S/ {totalSales.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              POS + Almuerzos
            </p>
          </CardContent>
        </Card>

        {/* Movimientos */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Movimientos</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-green-600">Ingresos:</span>
                <span className="font-semibold">S/ {totalIngresos.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-red-600">Egresos:</span>
                <span className="font-semibold">S/ {totalEgresos.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Desglose por método de pago */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tabla de métodos de pago */}
        <Card>
          <CardHeader>
            <CardTitle>Métodos de Pago</CardTitle>
            <CardDescription>Desglose detallado por tipo de pago</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Efectivo */}
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500 rounded-full">
                    <DollarSign className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">Efectivo</p>
                    <p className="text-xs text-muted-foreground">
                      POS: S/ {(dailyTotals.pos.cash + dailyTotals.pos.mixed_cash).toFixed(2)} | 
                      Almuerzos: S/ {dailyTotals.lunch.cash.toFixed(2)}
                    </p>
                  </div>
                </div>
                <span className="text-lg font-bold text-green-600">
                  S/ {totalCash.toFixed(2)}
                </span>
              </div>

              {/* Tarjeta */}
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500 rounded-full">
                    <CreditCard className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">Tarjeta</p>
                    <p className="text-xs text-muted-foreground">
                      POS: S/ {(dailyTotals.pos.card + dailyTotals.pos.mixed_card).toFixed(2)} | 
                      Almuerzos: S/ {dailyTotals.lunch.card.toFixed(2)}
                    </p>
                  </div>
                </div>
                <span className="text-lg font-bold text-blue-600">
                  S/ {totalCard.toFixed(2)}
                </span>
              </div>

              {/* Yape */}
              <div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500 rounded-full">
                    <Smartphone className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">Yape</p>
                    <p className="text-xs text-muted-foreground">
                      POS: S/ {(dailyTotals.pos.yape + dailyTotals.pos.mixed_yape).toFixed(2)} | 
                      Almuerzos: S/ {dailyTotals.lunch.yape.toFixed(2)}
                    </p>
                  </div>
                </div>
                <span className="text-lg font-bold text-purple-600">
                  S/ {totalYape.toFixed(2)}
                </span>
              </div>

              {/* Yape QR */}
              {totalYapeQR > 0 && (
                <div className="flex items-center justify-between p-3 bg-pink-50 dark:bg-pink-950/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-pink-500 rounded-full">
                      <Smartphone className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold">Yape QR</p>
                      <p className="text-xs text-muted-foreground">Solo POS</p>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-pink-600">
                    S/ {totalYapeQR.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Crédito */}
              {totalCredit > 0 && (
                <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500 rounded-full">
                      <Users className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold">Crédito (Fiar)</p>
                      <p className="text-xs text-muted-foreground">
                        POS: S/ {dailyTotals.pos.credit.toFixed(2)} | 
                        Almuerzos: S/ {dailyTotals.lunch.credit.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-amber-600">
                    S/ {totalCredit.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Gráfico de torta */}
        <Card>
          <CardHeader>
            <CardTitle>Distribución de Pagos</CardTitle>
            <CardDescription>Porcentaje por método de pago</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={paymentData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {paymentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => `S/ ${value.toFixed(2)}`}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Desglose POS vs Almuerzos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* POS */}
        <Card>
          <CardHeader>
            <CardTitle>📦 Punto de Venta (POS)</CardTitle>
            <CardDescription>Ventas de productos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Efectivo:</span>
                <span className="font-semibold">S/ {(dailyTotals.pos.cash + dailyTotals.pos.mixed_cash).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Tarjeta:</span>
                <span className="font-semibold">S/ {(dailyTotals.pos.card + dailyTotals.pos.mixed_card).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Yape:</span>
                <span className="font-semibold">S/ {(dailyTotals.pos.yape + dailyTotals.pos.mixed_yape).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Yape QR:</span>
                <span className="font-semibold">S/ {dailyTotals.pos.yape_qr.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Crédito:</span>
                <span className="font-semibold">S/ {dailyTotals.pos.credit.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>TOTAL POS:</span>
                <span className="text-lg">S/ {dailyTotals.pos.total.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Almuerzos */}
        <Card>
          <CardHeader>
            <CardTitle>🍽️ Almuerzos</CardTitle>
            <CardDescription>Ventas de menús</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Efectivo:</span>
                <span className="font-semibold">S/ {dailyTotals.lunch.cash.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Tarjeta:</span>
                <span className="font-semibold">S/ {dailyTotals.lunch.card.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Yape:</span>
                <span className="font-semibold">S/ {dailyTotals.lunch.yape.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Crédito (Pendiente):</span>
                <span className="font-semibold">S/ {dailyTotals.lunch.credit.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>TOTAL ALMUERZOS:</span>
                <span className="text-lg">S/ {dailyTotals.lunch.total.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resumen final */}
      <Card className="border-primary">
        <CardHeader>
          <CardTitle>💼 Resumen de Caja</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span>Caja Inicial:</span>
              <span className="font-semibold">S/ {cashRegister.initial_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>+ Efectivo recibido:</span>
              <span className="font-semibold text-green-600">S/ {totalCash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>+ Ingresos adicionales:</span>
              <span className="font-semibold text-green-600">S/ {totalIngresos.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>- Egresos:</span>
              <span className="font-semibold text-red-600">S/ {totalEgresos.toFixed(2)}</span>
            </div>
            <div className="border-t-2 border-primary pt-3 flex justify-between font-bold text-lg">
              <span>CAJA ESPERADA:</span>
              <span className="text-primary">S/ {expectedFinal.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
