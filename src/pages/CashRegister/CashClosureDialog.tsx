import { useState, useEffect, useRef } from 'react';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  Lock, 
  AlertTriangle, 
  CheckCircle2, 
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  ChevronRight,
  ArrowLeft
} from 'lucide-react';
import { CashRegister, CashMovement, CashRegisterConfig, DailyTotals } from '@/types/cashRegister';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

type WizardStep = 'summary' | 'close';

interface Props {
  cashRegister: CashRegister;
  movements: CashMovement[];
  config: CashRegisterConfig | null;
  onClose: () => void;
  onClosed: () => void;
}

export default function CashClosureDialog({ cashRegister, movements, config, onClose, onClosed }: Props) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<WizardStep>('summary');
  const [loading, setLoading] = useState(false);
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);
  const [actualAmount, setActualAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    loadDailyTotals();
  }, []);

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
      toast.error('Error al cargar totales');
    }
  };

  if (!dailyTotals) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-lg">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Cálculos ────────────────────────────────────────────────────
  const totalIngresos = movements.filter(m => m.type === 'ingreso').reduce((s, m) => s + m.amount, 0);
  const totalEgresos  = movements.filter(m => m.type === 'egreso').reduce((s, m) => s + m.amount, 0);
  const totalCash  = dailyTotals.pos.cash + dailyTotals.pos.mixed_cash + dailyTotals.lunch.cash;
  const totalCard  = dailyTotals.pos.card + dailyTotals.pos.mixed_card + dailyTotals.lunch.card;
  const totalYape  = dailyTotals.pos.yape + dailyTotals.pos.mixed_yape + dailyTotals.lunch.yape;
  const totalYapeQR = dailyTotals.pos.yape_qr;
  const totalCredit = dailyTotals.pos.credit + dailyTotals.lunch.credit;
  const totalSales  = dailyTotals.pos.total + dailyTotals.lunch.total;

  const expectedFinal = cashRegister.initial_amount + totalCash + totalIngresos - totalEgresos;
  const actualFinal   = actualAmount ? parseFloat(actualAmount) : null;
  const difference    = actualFinal !== null ? actualFinal - expectedFinal : null;
  const hasDifference = difference !== null && Math.abs(difference) > 0.01;
  const isFaltante    = hasDifference && difference! < 0;

  // ── Realizar cierre ─────────────────────────────────────────────
  const performClosure = async () => {
    if (isSubmittingRef.current) return;
    if (actualFinal === null) { toast.error('Ingresa el monto real de caja'); return; }
    if (hasDifference && !adjustmentReason.trim()) { toast.error('Escribe el motivo de la diferencia'); return; }

    isSubmittingRef.current = true;
    try {
      setLoading(true);

      const { error: closureError } = await supabase.from('cash_closures').insert({
        cash_register_id: cashRegister.id,
        school_id: cashRegister.school_id,
        closure_date: format(new Date(cashRegister.opened_at), 'yyyy-MM-dd'),
        pos_cash: dailyTotals.pos.cash + dailyTotals.pos.mixed_cash,
        pos_card: dailyTotals.pos.card + dailyTotals.pos.mixed_card,
        pos_yape: dailyTotals.pos.yape + dailyTotals.pos.mixed_yape,
        pos_yape_qr: dailyTotals.pos.yape_qr,
        pos_credit: dailyTotals.pos.credit,
        pos_mixed_cash: dailyTotals.pos.mixed_cash,
        pos_mixed_card: dailyTotals.pos.mixed_card,
        pos_mixed_yape: dailyTotals.pos.mixed_yape,
        pos_total: dailyTotals.pos.total,
        lunch_cash: dailyTotals.lunch.cash,
        lunch_credit: dailyTotals.lunch.credit,
        lunch_card: dailyTotals.lunch.card,
        lunch_yape: dailyTotals.lunch.yape,
        lunch_total: dailyTotals.lunch.total,
        total_cash: totalCash,
        total_card: totalCard,
        total_yape: totalYape,
        total_yape_qr: totalYapeQR,
        total_credit: totalCredit,
        total_sales: totalSales,
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        initial_amount: cashRegister.initial_amount,
        expected_final: expectedFinal,
        actual_final: actualFinal,
        difference: difference || 0,
        closed_by: user?.id,
        admin_validated_by: user?.id,
        whatsapp_phone: config?.whatsapp_phone || null,
      });

      if (closureError) throw closureError;

      if (hasDifference) {
        await supabase.from('cash_movements').insert({
          cash_register_id: cashRegister.id,
          school_id: cashRegister.school_id,
          type: 'ajuste',
          amount: Math.abs(difference!),
          reason: `Ajuste de Cierre — ${isFaltante ? 'FALTANTE' : 'SOBRANTE'} S/ ${Math.abs(difference!).toFixed(2)}: ${adjustmentReason}`,
          responsible_name: (profile as any)?.full_name || 'Responsable',
          responsible_id: user?.id,
          created_by: user?.id,
          requires_signature: true,
        });
      }

      await supabase.from('cash_registers').update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: user?.id,
        expected_amount: expectedFinal,
        actual_amount: actualFinal,
        difference: difference || 0,
        admin_password_validated: false,
        notes: hasDifference ? `Diferencia justificada: ${adjustmentReason}` : null,
      }).eq('id', cashRegister.id);

      toast.success('✅ Caja cerrada correctamente');
      onClosed();
    } catch (error) {
      console.error(error);
      isSubmittingRef.current = false;
      toast.error('Error al cerrar la caja');
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Lock className="h-5 w-5 text-red-600" />
            Cierre de Caja —{' '}
            {format(new Date(cashRegister.opened_at), "dd 'de' MMMM yyyy", { locale: es })}
          </DialogTitle>
        </DialogHeader>

        {/* Barra de progreso simple: 2 pasos */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`flex-1 h-2 rounded-full ${step === 'summary' || step === 'close' ? 'bg-emerald-500' : 'bg-gray-200'}`} />
          <div className={`flex-1 h-2 rounded-full ${step === 'close' ? 'bg-emerald-500' : 'bg-gray-200'}`} />
        </div>
        <div className="flex justify-between text-xs text-gray-400 mb-3 -mt-1">
          <span className={step === 'summary' ? 'text-emerald-600 font-semibold' : ''}>1. Resumen del día</span>
          <span className={step === 'close' ? 'text-emerald-600 font-semibold' : ''}>2. Cerrar caja</span>
        </div>

        {/* ─── PASO 1: RESUMEN DEL DÍA ─────────────────────────── */}
        {step === 'summary' && (
          <div className="space-y-4">
            {/* Ventas por módulo */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <p className="text-xs text-blue-600 font-medium uppercase mb-1">POS</p>
                <p className="text-2xl font-black text-blue-700">S/ {dailyTotals.pos.total.toFixed(2)}</p>
              </div>
              <div className="bg-orange-50 rounded-xl p-4 text-center">
                <p className="text-xs text-orange-600 font-medium uppercase mb-1">Almuerzos</p>
                <p className="text-2xl font-black text-orange-700">S/ {dailyTotals.lunch.total.toFixed(2)}</p>
              </div>
            </div>

            {/* Desglose métodos de pago */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <h3 className="font-semibold text-sm text-gray-700 mb-2">Métodos de pago</h3>
              {[
                { label: 'Efectivo', val: totalCash, icon: Banknote, color: 'text-green-700' },
                { label: 'Tarjeta',  val: totalCard, icon: CreditCard, color: 'text-blue-700' },
                { label: 'Yape',     val: totalYape, icon: Smartphone, color: 'text-purple-700' },
                ...(totalYapeQR > 0 ? [{ label: 'Yape QR', val: totalYapeQR, icon: Smartphone, color: 'text-pink-700' }] : []),
                ...(totalCredit > 0 ? [{ label: 'Crédito', val: totalCredit, icon: DollarSign, color: 'text-amber-700' }] : []),
              ].map(({ label, val, icon: Icon, color }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span>{label}</span>
                  </div>
                  <span className={`font-bold ${color}`}>S/ {val.toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>Total Ventas</span>
                <span className="text-gray-900">S/ {totalSales.toFixed(2)}</span>
              </div>
            </div>

            {/* Resumen de caja */}
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-gray-600">Abrió con:</span>
                <span className="text-right font-semibold">S/ {cashRegister.initial_amount.toFixed(2)}</span>
                <span className="text-green-600">+ Efectivo ventas:</span>
                <span className="text-right font-semibold text-green-700">S/ {totalCash.toFixed(2)}</span>
                {totalIngresos > 0 && <>
                  <span className="text-green-600">+ Ingresos:</span>
                  <span className="text-right font-semibold text-green-700">S/ {totalIngresos.toFixed(2)}</span>
                </>}
                {totalEgresos > 0 && <>
                  <span className="text-red-600">− Egresos:</span>
                  <span className="text-right font-semibold text-red-700">S/ {totalEgresos.toFixed(2)}</span>
                </>}
                <span className="text-base font-black border-t pt-1 mt-1">Caja esperada:</span>
                <span className={`text-right text-base font-black border-t pt-1 mt-1 ${expectedFinal < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  S/ {expectedFinal.toFixed(2)}
                </span>
              </div>
              {expectedFinal < 0 && (
                <p className="text-xs text-red-600 mt-2 bg-red-50 rounded p-2">
                  ⚠️ La caja esperada es negativa porque los egresos superan el efectivo disponible.
                </p>
              )}
            </div>

            <Button onClick={() => setStep('close')} className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-base font-bold">
              Continuar — Cerrar Caja <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        )}

        {/* ─── PASO 2: CONTAR Y CERRAR ─────────────────────────── */}
        {step === 'close' && (
          <div className="space-y-4">
            {/* Recordatorio de caja esperada */}
            <div className="text-center bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">El sistema espera en caja</p>
              <p className={`text-3xl font-black mt-1 ${expectedFinal < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                S/ {expectedFinal.toFixed(2)}
              </p>
            </div>

            {/* Input monto real */}
            <div>
              <Label htmlFor="actual" className="text-base font-semibold">
                💵 ¿Cuánto efectivo tienes en caja?
              </Label>
              <p className="text-xs text-gray-500 mb-2">Cuenta billetes y monedas. No incluyas tarjeta ni Yape.</p>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-gray-400">S/</span>
                <Input
                  id="actual"
                  type="number"
                  step="0.01"
                  value={actualAmount}
                  onChange={(e) => setActualAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-14 text-2xl font-black text-center pl-10 border-2 border-emerald-300 focus:border-emerald-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Resultado automático */}
            {actualFinal !== null && (
              <div className={`rounded-2xl p-4 text-center border-2 ${
                !hasDifference 
                  ? 'bg-emerald-50 border-emerald-300' 
                  : isFaltante 
                    ? 'bg-red-50 border-red-300' 
                    : 'bg-yellow-50 border-yellow-300'
              }`}>
                {!hasDifference ? (
                  <>
                    <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-1" />
                    <p className="text-lg font-black text-emerald-700">¡Todo cuadra!</p>
                    <Badge className="mt-1 bg-emerald-100 text-emerald-800">Diferencia: S/ 0.00</Badge>
                  </>
                ) : (
                  <>
                    <AlertTriangle className={`h-10 w-10 mx-auto mb-1 ${isFaltante ? 'text-red-500' : 'text-yellow-500'}`} />
                    <p className={`text-lg font-black ${isFaltante ? 'text-red-700' : 'text-yellow-700'}`}>
                      {isFaltante ? 'FALTANTE' : 'SOBRANTE'}
                    </p>
                    <p className={`text-3xl font-black ${isFaltante ? 'text-red-600' : 'text-yellow-600'}`}>
                      {isFaltante ? '−' : '+'} S/ {Math.abs(difference!).toFixed(2)}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Motivo de diferencia (solo si hay) */}
            {hasDifference && (
              <div>
                <Label htmlFor="reason" className="font-semibold">
                  📝 Motivo de la diferencia <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="reason"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Ej: Se devolvió cambio, compra de insumos, etc."
                  rows={2}
                  className="mt-1 border-2 border-red-200 focus:border-red-400"
                />
              </div>
            )}

            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Una vez cerrada, la caja queda registrada y <strong>no se puede modificar</strong>.
              </AlertDescription>
            </Alert>

            {/* Botones */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('summary')} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-1" /> Atrás
              </Button>
              <Button
                onClick={performClosure}
                disabled={loading || !actualAmount || (hasDifference && !adjustmentReason.trim())}
                className="flex-1 bg-red-600 hover:bg-red-700 h-12 font-bold"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Cerrando...
                  </span>
                ) : (
                  <>🔒 Cerrar Caja</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
