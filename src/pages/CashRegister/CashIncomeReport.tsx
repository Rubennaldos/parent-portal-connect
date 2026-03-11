import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Banknote, CreditCard, Smartphone, Users,
  RefreshCw, TrendingUp, ShoppingCart, UtensilsCrossed,
  Clock, ChevronDown, ChevronUp, ReceiptText
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CashRegister } from '@/types/cashRegister';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Props {
  cashRegister: CashRegister;
}

interface PaymentRow {
  id: string;
  created_at: string;
  amount: number;
  payment_method: string | null;
  payment_status: string | null;
  description: string | null;
  ticket_code: string | null;
  metadata: any;
  paid_with_mixed: boolean | null;
  cash_amount: number | null;
  card_amount: number | null;
  yape_amount: number | null;
}

interface SectionTotals {
  cash: number;
  card: number;
  yape: number;
  credit: number;
  mixed_cash: number;
  mixed_card: number;
  mixed_yape: number;
  total: number;
  count: number;
}

function emptyTotals(): SectionTotals {
  return { cash: 0, card: 0, yape: 0, credit: 0, mixed_cash: 0, mixed_card: 0, mixed_yape: 0, total: 0, count: 0 };
}

const METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', yape: 'Yape',
  yape_qr: 'Yape QR', saldo: 'Saldo alumno', debt: 'Crédito',
  credito: 'Crédito', mixed: 'Mixto',
};
const METHOD_COLORS: Record<string, string> = {
  efectivo: 'bg-green-100 text-green-800',
  tarjeta:  'bg-blue-100 text-blue-800',
  yape:     'bg-purple-100 text-purple-800',
  yape_qr:  'bg-pink-100 text-pink-800',
  saldo:    'bg-teal-100 text-teal-800',
  debt:     'bg-amber-100 text-amber-800',
  credito:  'bg-amber-100 text-amber-800',
};

function methodBadge(method: string | null) {
  const key = (method || 'desconocido').toLowerCase();
  const label = METHOD_LABELS[key] || method || '—';
  const color = METHOD_COLORS[key] || 'bg-gray-100 text-gray-700';
  return <Badge className={cn('text-[10px] font-semibold px-1.5 py-0.5', color)}>{label}</Badge>;
}

function sumSection(rows: PaymentRow[]): SectionTotals {
  const t = emptyTotals();
  for (const r of rows) {
    const abs = Math.abs(r.amount);
    t.total += abs;
    t.count += 1;
    if (r.paid_with_mixed) {
      t.mixed_cash += r.cash_amount || 0;
      t.mixed_card += r.card_amount || 0;
      t.mixed_yape += r.yape_amount || 0;
    } else {
      const m = (r.payment_method || '').toLowerCase();
      if (m === 'efectivo')       t.cash   += abs;
      else if (m === 'tarjeta')   t.card   += abs;
      else if (m === 'yape' || m === 'yape_qr') t.yape += abs;
      else if (m === 'debt' || m === 'credito' || m === 'saldo') t.credit += abs;
    }
  }
  t.cash  += t.mixed_cash;
  t.card  += t.mixed_card;
  t.yape  += t.mixed_yape;
  return t;
}

function formatTime(iso: string) {
  try {
    return format(new Date(iso), 'HH:mm', { locale: es });
  } catch { return '—'; }
}

export default function CashIncomeReport({ cashRegister }: Props) {
  const [loading, setLoading]   = useState(true);
  const [posRows, setPosRows]   = useState<PaymentRow[]>([]);
  const [lunchRows, setLunchRows] = useState<PaymentRow[]>([]);
  const [rechargeRows, setRechargeRows] = useState<PaymentRow[]>([]);
  const [showPosDetail, setShowPosDetail]     = useState(false);
  const [showLunchDetail, setShowLunchDetail] = useState(false);
  const [showRechargeDetail, setShowRechargeDetail] = useState(false);

  const dayStr = format(new Date(cashRegister.opened_at), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, created_at, amount, payment_method, payment_status, description, ticket_code, metadata, paid_with_mixed, cash_amount, card_amount, yape_amount')
        .eq('school_id', cashRegister.school_id)
        .in('type', ['purchase', 'recharge'])
        .not('payment_status', 'eq', 'cancelled')
        .gte('created_at', `${dayStr}T00:00:00-05:00`)
        .lte('created_at', `${dayStr}T23:59:59-05:00`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []) as PaymentRow[];

      const pos     = rows.filter(r => !r.metadata?.lunch_order_id && Math.abs(r.amount) > 0 && r.amount < 0);
      const lunch   = rows.filter(r => !!r.metadata?.lunch_order_id && Math.abs(r.amount) > 0);
      const recharge = rows.filter(r => r.amount > 0); // recargas

      setPosRows(pos);
      setLunchRows(lunch);
      setRechargeRows(recharge);
    } catch (err) {
      console.error('Error cargando reporte ingresos:', err);
    } finally {
      setLoading(false);
    }
  }, [cashRegister.school_id, dayStr]);

  useEffect(() => { load(); }, [load]);

  const pos     = sumSection(posRows);
  const lunch   = sumSection(lunchRows);
  const recharge = { total: rechargeRows.reduce((s, r) => s + r.amount, 0), count: rechargeRows.length };
  const grandTotal = pos.total + lunch.total;

  // ── Totales consolidados por método ──
  const totalEfectivo = pos.cash   + lunch.cash;
  const totalTarjeta  = pos.card   + lunch.card;
  const totalYape     = pos.yape   + lunch.yape;
  const totalCredito  = pos.credit + lunch.credit;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        <span className="ml-3 text-gray-500 text-sm">Cargando reporte...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-3">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-emerald-600" />
            Reporte de Ingresos del Día
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {format(new Date(cashRegister.opened_at), "EEEE dd 'de' MMMM yyyy", { locale: es })} · Pagos recibidos hoy
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="h-8 gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {/* Resumen ejecutivo por método */}
      <Card className="border-2 border-emerald-200 bg-emerald-50/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm text-emerald-800">Resumen total — Caja del día</CardTitle>
          <CardDescription className="text-xs">POS + Almuerzos · pagos en efectivo real recibido</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {/* Gran total */}
          <div className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border-2 border-emerald-300 shadow-sm">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              <span className="font-black text-gray-800 text-base">TOTAL COBRADO</span>
            </div>
            <span className="text-2xl font-black text-emerald-700">S/ {grandTotal.toFixed(2)}</span>
          </div>

          {/* Desglose métodos */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Efectivo', val: totalEfectivo, icon: Banknote, color: 'text-green-700 bg-green-50 border-green-200' },
              { label: 'Tarjeta',  val: totalTarjeta,  icon: CreditCard, color: 'text-blue-700 bg-blue-50 border-blue-200' },
              { label: 'Yape',     val: totalYape,     icon: Smartphone, color: 'text-purple-700 bg-purple-50 border-purple-200' },
              { label: 'Crédito',  val: totalCredito,  icon: Users, color: 'text-amber-700 bg-amber-50 border-amber-200' },
            ].filter(x => x.val > 0).map(({ label, val, icon: Icon, color }) => (
              <div key={label} className={cn('rounded-lg border px-3 py-2 flex items-center justify-between', color)}>
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold">{label}</span>
                </div>
                <span className="text-sm font-black">S/ {val.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── SECCIÓN POS ── */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4 cursor-pointer" onClick={() => setShowPosDetail(v => !v)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-sm">POS — Punto de Venta</CardTitle>
              <Badge className="bg-blue-100 text-blue-700 text-[10px]">{pos.count} ventas</Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-blue-700">S/ {pos.total.toFixed(2)}</span>
              {showPosDetail ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </div>
          </div>
          {/* Mini resumen métodos POS */}
          <div className="flex gap-3 mt-1 text-[11px] text-gray-500">
            {pos.cash > 0   && <span className="text-green-700 font-semibold">💵 S/ {pos.cash.toFixed(2)}</span>}
            {pos.card > 0   && <span className="text-blue-700 font-semibold">💳 S/ {pos.card.toFixed(2)}</span>}
            {pos.yape > 0   && <span className="text-purple-700 font-semibold">📱 S/ {pos.yape.toFixed(2)}</span>}
            {pos.credit > 0 && <span className="text-amber-700 font-semibold">🤝 S/ {pos.credit.toFixed(2)}</span>}
          </div>
        </CardHeader>
        {showPosDetail && (
          <CardContent className="px-4 pb-4">
            {posRows.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No hay ventas POS hoy.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {posRows.map(row => (
                  <div key={row.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-gray-500 shrink-0">{formatTime(row.created_at)}</span>
                      {row.ticket_code && <span className="text-gray-400 shrink-0">#{row.ticket_code}</span>}
                      <span className="text-gray-700 truncate">{row.description || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {row.paid_with_mixed
                        ? <Badge className="bg-gray-100 text-gray-700 text-[9px]">Mixto</Badge>
                        : methodBadge(row.payment_method)}
                      <span className="font-bold text-gray-800">S/ {Math.abs(row.amount).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── SECCIÓN ALMUERZOS ── */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4 cursor-pointer" onClick={() => setShowLunchDetail(v => !v)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-orange-600" />
              <CardTitle className="text-sm">Almuerzos</CardTitle>
              <Badge className="bg-orange-100 text-orange-700 text-[10px]">{lunch.count} pedidos</Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-orange-700">S/ {lunch.total.toFixed(2)}</span>
              {showLunchDetail ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </div>
          </div>
          <div className="flex gap-3 mt-1 text-[11px] text-gray-500">
            {lunch.cash > 0   && <span className="text-green-700 font-semibold">💵 S/ {lunch.cash.toFixed(2)}</span>}
            {lunch.card > 0   && <span className="text-blue-700 font-semibold">💳 S/ {lunch.card.toFixed(2)}</span>}
            {lunch.yape > 0   && <span className="text-purple-700 font-semibold">📱 S/ {lunch.yape.toFixed(2)}</span>}
            {lunch.credit > 0 && <span className="text-amber-700 font-semibold">🤝 S/ {lunch.credit.toFixed(2)}</span>}
          </div>
        </CardHeader>
        {showLunchDetail && (
          <CardContent className="px-4 pb-4">
            {lunchRows.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No hay pagos de almuerzo hoy.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {lunchRows.map(row => (
                  <div key={row.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-gray-500 shrink-0">{formatTime(row.created_at)}</span>
                      <span className="text-gray-700 truncate">{row.description || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {methodBadge(row.payment_method)}
                      <span className="font-bold text-gray-800">S/ {Math.abs(row.amount).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── SECCIÓN RECARGAS (informativo) ── */}
      {recharge.count > 0 && (
        <Card className="border-teal-200 bg-teal-50/30">
          <CardHeader className="pb-2 pt-3 px-4 cursor-pointer" onClick={() => setShowRechargeDetail(v => !v)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-teal-600" />
                <CardTitle className="text-sm text-teal-800">Recargas recibidas</CardTitle>
                <Badge className="bg-teal-100 text-teal-700 text-[10px]">{recharge.count}</Badge>
                <Badge variant="outline" className="text-[9px] text-gray-500">Solo informativo</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-black text-teal-700">S/ {recharge.total.toFixed(2)}</span>
                {showRechargeDetail ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </div>
            </div>
            <p className="text-[11px] text-teal-600 mt-0.5">Dinero ingresado como saldo de alumnos. No entra en el cuadre de caja.</p>
          </CardHeader>
          {showRechargeDetail && (
            <CardContent className="px-4 pb-4">
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {rechargeRows.map(row => (
                  <div key={row.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-teal-100 text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-gray-500 shrink-0">{formatTime(row.created_at)}</span>
                      <span className="text-gray-700 truncate">{row.description || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {methodBadge(row.payment_method)}
                      <span className="font-bold text-teal-700">+S/ {row.amount.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Nota aclaratoria */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-700">ℹ️ Sobre este reporte</p>
        <p>Muestra todos los pagos con <strong>fecha de recepción = hoy</strong> ({dayStr}), sin importar la fecha del pedido de almuerzo.</p>
        <p>El crédito y saldo se muestran como referencia — <strong>no son dinero físico en caja</strong>.</p>
      </div>
    </div>
  );
}
