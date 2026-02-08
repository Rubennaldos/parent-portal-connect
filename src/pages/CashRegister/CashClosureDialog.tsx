import { useState, useEffect } from 'react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Lock, 
  AlertTriangle, 
  CheckCircle, 
  Printer, 
  Download,
  Send
} from 'lucide-react';
import { CashRegister, CashMovement, CashRegisterConfig, DailyTotals } from '@/types/cashRegister';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Props {
  cashRegister: CashRegister;
  movements: CashMovement[];
  config: CashRegisterConfig | null;
  onClose: () => void;
  onClosed: () => void;
}

export default function CashClosureDialog({ cashRegister, movements, config, onClose, onClosed }: Props) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<'summary' | 'password' | 'actual'>('summary');
  const [loading, setLoading] = useState(false);
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  // Cargar totales
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
    return null;
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

  const actualFinal = actualAmount ? parseFloat(actualAmount) : null;
  const difference = actualFinal !== null ? actualFinal - expectedFinal : null;

  const hasDifference = difference !== null && Math.abs(difference) > 0.01;
  const exceedsThreshold = hasDifference && 
                          config?.alert_on_difference && 
                          Math.abs(difference) > (config.difference_threshold || 10);

  // Validar contraseña del admin
  const validatePassword = async () => {
    if (!adminPassword) {
      toast.error('Ingresa la contraseña del administrador');
      return;
    }

    try {
      setLoading(true);

      // ⚠️ CLAVE MAESTRA DEL SISTEMA PARA PRUEBAS ⚠️
      const MASTER_PASSWORD = 'beto123';
      
      if (adminPassword === MASTER_PASSWORD) {
        setStep('actual');
        toast.success('✅ Clave maestra aceptada (modo pruebas)');
        setLoading(false);
        return;
      }

      // Validar con contraseña del admin
      const { data, error } = await supabase
        .rpc('validate_admin_password', {
          p_password: adminPassword
        });

      if (error) throw error;

      if (data) {
        setStep('actual');
        toast.success('Contraseña correcta');
      } else {
        toast.error('Contraseña incorrecta');
      }
    } catch (error) {
      console.error('Error al validar contraseña:', error);
      toast.error('Error al validar contraseña');
    } finally {
      setLoading(false);
    }
  };

  // Realizar cierre
  const performClosure = async () => {
    if (actualFinal === null) {
      toast.error('Ingresa el monto real en caja');
      return;
    }

    if (hasDifference && !adjustmentReason.trim()) {
      toast.error('Ingresa el motivo del ajuste');
      return;
    }

    try {
      setLoading(true);

      // Crear el cierre
      const { data: closureData, error: closureError } = await supabase
        .from('cash_closures')
        .insert({
          cash_register_id: cashRegister.id,
          school_id: cashRegister.school_id,
          closure_date: format(new Date(cashRegister.opened_at), 'yyyy-MM-dd'),
          
          // POS
          pos_cash: dailyTotals.pos.cash + dailyTotals.pos.mixed_cash,
          pos_card: dailyTotals.pos.card + dailyTotals.pos.mixed_card,
          pos_yape: dailyTotals.pos.yape + dailyTotals.pos.mixed_yape,
          pos_yape_qr: dailyTotals.pos.yape_qr,
          pos_credit: dailyTotals.pos.credit,
          pos_mixed_cash: dailyTotals.pos.mixed_cash,
          pos_mixed_card: dailyTotals.pos.mixed_card,
          pos_mixed_yape: dailyTotals.pos.mixed_yape,
          pos_total: dailyTotals.pos.total,
          
          // Lunch
          lunch_cash: dailyTotals.lunch.cash,
          lunch_credit: dailyTotals.lunch.credit,
          lunch_card: dailyTotals.lunch.card,
          lunch_yape: dailyTotals.lunch.yape,
          lunch_total: dailyTotals.lunch.total,
          
          // Totales
          total_cash: totalCash,
          total_card: totalCard,
          total_yape: totalYape,
          total_yape_qr: totalYapeQR,
          total_credit: totalCredit,
          total_sales: totalSales,
          
          // Movimientos
          total_ingresos: totalIngresos,
          total_egresos: totalEgresos,
          
          // Caja
          initial_amount: cashRegister.initial_amount,
          expected_final: expectedFinal,
          actual_final: actualFinal,
          difference: difference || 0,
          
          closed_by: user?.id,
          admin_validated_by: user?.id,
          whatsapp_phone: config?.whatsapp_phone || '991236870',
        })
        .select()
        .single();

      if (closureError) throw closureError;

      // Si hay diferencia, crear movimiento de ajuste
      if (hasDifference) {
        const { error: adjustmentError } = await supabase
          .from('cash_movements')
          .insert({
            cash_register_id: cashRegister.id,
            school_id: cashRegister.school_id,
            type: 'ajuste',
            amount: Math.abs(difference!),
            reason: `Ajuste de Caja: ${adjustmentReason}. ${difference! > 0 ? 'Sobrante' : 'Faltante'}: S/ ${Math.abs(difference!).toFixed(2)}`,
            responsible_name: profile?.full_name || 'Admin',
            responsible_id: user?.id,
            created_by: user?.id,
            requires_signature: true,
          });

        if (adjustmentError) throw adjustmentError;
      }

      // Cerrar el registro
      const { error: updateError } = await supabase
        .from('cash_registers')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: user?.id,
          expected_amount: expectedFinal,
          actual_amount: actualFinal,
          difference: difference || 0,
          admin_password_validated: true,
        })
        .eq('id', cashRegister.id);

      if (updateError) throw updateError;

      toast.success('Cierre de caja realizado exitosamente');
      onClosed();
    } catch (error) {
      console.error('Error al cerrar caja:', error);
      toast.error('Error al realizar el cierre');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Cierre de Caja
          </DialogTitle>
          <DialogDescription>
            Fecha: {format(new Date(cashRegister.opened_at), "dd 'de' MMMM yyyy", { locale: es })}
          </DialogDescription>
        </DialogHeader>

        {step === 'summary' && (
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <h3 className="font-semibold mb-2">Resumen del Día</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Caja Inicial:</div>
                <div className="font-semibold text-right">S/ {cashRegister.initial_amount.toFixed(2)}</div>
                
                <div>Efectivo Recibido:</div>
                <div className="font-semibold text-right text-green-600">+ S/ {totalCash.toFixed(2)}</div>
                
                <div>Ingresos:</div>
                <div className="font-semibold text-right text-green-600">+ S/ {totalIngresos.toFixed(2)}</div>
                
                <div>Egresos:</div>
                <div className="font-semibold text-right text-red-600">- S/ {totalEgresos.toFixed(2)}</div>
                
                <div className="border-t pt-2 font-bold">Caja Esperada:</div>
                <div className="border-t pt-2 font-bold text-right text-primary">S/ {expectedFinal.toFixed(2)}</div>
              </div>
            </div>

            <div className="bg-muted p-4 rounded-lg space-y-2">
              <h3 className="font-semibold mb-2">Ventas por Método de Pago</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Efectivo:</div>
                <div className="font-semibold text-right">S/ {totalCash.toFixed(2)}</div>
                <div>Tarjeta:</div>
                <div className="font-semibold text-right">S/ {totalCard.toFixed(2)}</div>
                <div>Yape:</div>
                <div className="font-semibold text-right">S/ {totalYape.toFixed(2)}</div>
                {totalYapeQR > 0 && (
                  <>
                    <div>Yape QR:</div>
                    <div className="font-semibold text-right">S/ {totalYapeQR.toFixed(2)}</div>
                  </>
                )}
                {totalCredit > 0 && (
                  <>
                    <div>Crédito:</div>
                    <div className="font-semibold text-right">S/ {totalCredit.toFixed(2)}</div>
                  </>
                )}
                <div className="border-t pt-2 font-bold">TOTAL:</div>
                <div className="border-t pt-2 font-bold text-right">S/ {totalSales.toFixed(2)}</div>
              </div>
            </div>

            <Button
              onClick={() => setStep(config?.require_admin_password ? 'password' : 'actual')}
              className="w-full"
            >
              Continuar al Cierre
            </Button>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-4">
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription>
                Para realizar el cierre de caja, ingresa la contraseña del administrador
              </AlertDescription>
            </Alert>

            <div>
              <Label htmlFor="password">Contraseña del Administrador</Label>
              <Input
                id="password"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    validatePassword();
                  }
                }}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  window.location.href = '/#/dashboard';
                }}
                className="flex-1"
              >
                Volver al Dashboard
              </Button>
              <Button
                variant="outline"
                onClick={() => setStep('summary')}
                className="flex-1"
              >
                Atrás
              </Button>
              <Button
                onClick={validatePassword}
                disabled={loading}
                className="flex-1"
              >
                {loading ? 'Validando...' : 'Validar'}
              </Button>
            </div>
          </div>
        )}

        {step === 'actual' && (
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Cuenta el efectivo físico en caja e ingresa el monto exacto
              </AlertDescription>
            </Alert>

            <div className="bg-muted p-4 rounded-lg">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Caja Esperada</p>
                <p className="text-2xl font-bold text-primary">
                  S/ {expectedFinal.toFixed(2)}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="actual">Efectivo Real en Caja (S/)</Label>
              <Input
                id="actual"
                type="number"
                step="0.01"
                value={actualAmount}
                onChange={(e) => setActualAmount(e.target.value)}
                placeholder="0.00"
                className="text-xl font-semibold"
              />
            </div>

            {hasDifference && (
              <>
                <Alert variant={exceedsThreshold ? 'destructive' : 'default'}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Diferencia detectada: S/ {Math.abs(difference!).toFixed(2)}</strong>
                    <br />
                    {difference! > 0 ? 'SOBRANTE' : 'FALTANTE'} de dinero
                    {exceedsThreshold && ' - Excede el límite configurado'}
                  </AlertDescription>
                </Alert>

                <div>
                  <Label htmlFor="adjustment">Motivo del Ajuste *</Label>
                  <Textarea
                    id="adjustment"
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder="Explica el motivo de la diferencia..."
                    rows={3}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Se generará un comprobante de ajuste firmado
                  </p>
                </div>
              </>
            )}

            {actualFinal !== null && !hasDifference && (
              <Alert>
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-600">
                  <strong>¡Perfecto!</strong> El monto coincide con lo esperado
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStep(config?.require_admin_password ? 'password' : 'summary')}
                className="flex-1"
              >
                Atrás
              </Button>
              <Button
                onClick={performClosure}
                disabled={loading || !actualAmount || (hasDifference && !adjustmentReason.trim())}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                {loading ? 'Cerrando...' : 'Cerrar Caja'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
