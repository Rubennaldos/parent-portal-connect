import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  TrendingUp,
  DollarSign,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Calendar,
  Loader2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PaymentStats {
  total_amount:    number;
  total_count:     number;
  approved_amount: number;
  approved_count:  number;
  pending_amount:  number;
  pending_count:   number;
  rejected_amount: number;
  rejected_count:  number;
}

interface RecentTransaction {
  id:              string;
  amount:          number;
  status:          string;
  payment_gateway: string;
  payment_method:  string;
  created_at:      string;
}

// ─── Helpers de presentación (solo UI, sin aritmética) ────────────────────────

const STATUS_ICONS: Record<string, JSX.Element> = {
  approved:   <CheckCircle2 className="h-4 w-4 text-green-600" />,
  pending:    <Clock        className="h-4 w-4 text-yellow-600" />,
  processing: <Clock        className="h-4 w-4 text-yellow-600" />,
  rejected:   <XCircle      className="h-4 w-4 text-red-600" />,
  cancelled:  <XCircle      className="h-4 w-4 text-red-600" />,
};

const STATUS_LABELS: Record<string, string> = {
  approved:   'Aprobado',
  pending:    'Pendiente',
  processing: 'Procesando',
  rejected:   'Rechazado',
  cancelled:  'Cancelado',
  refunded:   'Reembolsado',
  expired:    'Expirado',
};

const GATEWAY_LABELS: Record<string, string> = {
  niubiz:      'Niubiz (Visa)',
  izipay:      'Izipay',
  culqi:       'Culqi',
  mercadopago: 'Mercado Pago',
  manual:      'Manual',
};

const fmt = (n: number) => `S/ ${Number(n).toFixed(2)}`;

// ─── Componente ───────────────────────────────────────────────────────────────

export function PaymentStatistics() {
  const [stats, setStats]       = useState<PaymentStats | null>(null);
  const [recent, setRecent]     = useState<RecentTransaction[]>([]);
  const [loading, setLoading]   = useState(true);
  const [daysAgo, setDaysAgo]   = useState('7');
  const { toast }               = useToast();

  useEffect(() => {
    fetchAll();
  }, [daysAgo]);

  /**
   * Un único RPC que devuelve stats + últimas 10 tx.
   * Toda la aritmética ocurre en Postgres con NUMERIC y ROUND(...,2).
   * No hay parseFloat, no hay bucles de suma en JS.
   */
  const fetchAll = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.rpc('get_billing_payment_stats', {
        p_school_id: null,
        p_days_ago:  parseInt(daysAgo, 10),
      });

      if (error) throw error;

      const result = data as (PaymentStats & { recent_transactions: RecentTransaction[] });

      setStats({
        total_amount:    result.total_amount,
        total_count:     result.total_count,
        approved_amount: result.approved_amount,
        approved_count:  result.approved_count,
        pending_amount:  result.pending_amount,
        pending_count:   result.pending_count,
        rejected_amount: result.rejected_amount,
        rejected_count:  result.rejected_count,
      });
      setRecent(result.recent_transactions ?? []);

    } catch (err: any) {
      console.error('Error cargando estadísticas de pago:', err);
      toast({
        variant:     'destructive',
        title:       'Error',
        description: 'No se pudieron cargar las estadísticas',
      });
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (!recent.length) return;

    const headers = ['Fecha', 'Monto', 'Estado', 'Pasarela', 'Método'];
    const rows = recent.map((tx) => [
      new Date(tx.created_at).toLocaleString('es-PE'),
      fmt(tx.amount),
      STATUS_LABELS[tx.status] ?? tx.status,
      GATEWAY_LABELS[tx.payment_gateway] ?? tx.payment_gateway,
      tx.payment_method || 'N/A',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pagos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    toast({ title: '✅ Exportado', description: 'Archivo CSV descargado.' });
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── UI (puramente visual — ningún cálculo aquí) ───────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Barra de controles ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <Select value={daysAgo} onValueChange={setDaysAgo}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 3 meses</SelectItem>
              <SelectItem value="365">Último año</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={exportToCSV} variant="outline" size="sm" disabled={!recent.length}>
          <Download className="h-4 w-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {/* ── Tarjetas de estadísticas ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

        {/* Total */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Procesado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{fmt(stats?.total_amount ?? 0)}</p>
                <p className="text-xs text-muted-foreground">
                  {stats?.total_count ?? 0} transacciones
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Aprobados */}
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-800">
              ✅ Aprobados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-green-900">
                  {fmt(stats?.approved_amount ?? 0)}
                </p>
                <p className="text-xs text-green-700">
                  {stats?.approved_count ?? 0} pagos exitosos
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        {/* Pendientes */}
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-800">
              ⏳ Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-yellow-900">
                  {fmt(stats?.pending_amount ?? 0)}
                </p>
                <p className="text-xs text-yellow-700">
                  {stats?.pending_count ?? 0} en proceso
                </p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>

        {/* Rechazados */}
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-800">
              ❌ Rechazados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-red-900">
                  {fmt(stats?.rejected_amount ?? 0)}
                </p>
                <p className="text-xs text-red-700">
                  {stats?.rejected_count ?? 0} fallidos
                </p>
              </div>
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Transacciones recientes ── */}
      <Card>
        <CardHeader>
          <CardTitle>Transacciones Recientes</CardTitle>
          <CardDescription>Últimas 10 transacciones procesadas</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay transacciones aún</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {STATUS_ICONS[tx.status] ?? <AlertCircle className="h-4 w-4 text-gray-600" />}
                    <div>
                      <p className="font-medium">{fmt(tx.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleDateString('es-PE', {
                          day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {GATEWAY_LABELS[tx.payment_gateway] ?? tx.payment_gateway}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {STATUS_LABELS[tx.status] ?? tx.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
