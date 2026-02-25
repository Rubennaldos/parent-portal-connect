import { useState, useRef } from 'react';
import { AlertTriangle, Lock, ArrowRight, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Props {
  schoolId: string;
  // Última caja cerrada (para referencia de monto)
  lastClosedAmount?: number | null;
  // Caja sin cerrar de día anterior
  hasUnclosedPrevious?: boolean;
  previousUnclosed?: any | null;
  onOpened: () => void; // callback cuando se abre exitosamente
}

export function CashOpeningModal({
  schoolId,
  lastClosedAmount,
  hasUnclosedPrevious,
  previousUnclosed,
  onOpened,
}: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<'unclosed_warning' | 'declaration'>(
    hasUnclosedPrevious ? 'unclosed_warning' : 'declaration'
  );
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [closingPrevious, setClosingPrevious] = useState(false);
  const isSubmittingRef = useRef(false);

  // Forzar cierre de la caja anterior sin datos (cierre de emergencia)
  const forceClosePrevious = async () => {
    if (!previousUnclosed || !user?.id) return;
    setClosingPrevious(true);
    try {
      const closureDate = format(new Date(previousUnclosed.opened_at), 'yyyy-MM-dd');

      // Crear registro de cierre forzado en cash_closures para que quede en historial
      await supabase.from('cash_closures').insert({
        cash_register_id: previousUnclosed.id,
        school_id: schoolId,
        closure_date: closureDate,
        initial_amount: previousUnclosed.initial_amount || 0,
        expected_final: previousUnclosed.initial_amount || 0,
        actual_final: 0,
        difference: -(previousUnclosed.initial_amount || 0),
        total_sales: 0,
        total_cash: 0,
        total_card: 0,
        total_yape: 0,
        total_yape_qr: 0,
        total_credit: 0,
        total_ingresos: 0,
        total_egresos: 0,
        pos_cash: 0, pos_card: 0, pos_yape: 0, pos_yape_qr: 0, pos_credit: 0,
        pos_mixed_cash: 0, pos_mixed_card: 0, pos_mixed_yape: 0, pos_total: 0,
        lunch_cash: 0, lunch_credit: 0, lunch_card: 0, lunch_yape: 0, lunch_total: 0,
        closed_by: user.id,
      });

      await supabase
        .from('cash_registers')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: user.id,
          notes: 'Cierre forzado por apertura de nueva caja (caja anterior sin cerrar)',
        })
        .eq('id', previousUnclosed.id);

      toast.warning('⚠️ Caja anterior cerrada de forma forzada. Revisa el historial.');
      setStep('declaration');
    } catch (error) {
      toast.error('Error al cerrar caja anterior');
    } finally {
      setClosingPrevious(false);
    }
  };

  const handleOpen = async () => {
    if (isSubmittingRef.current) return;
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) {
      toast.error('Ingresa un monto válido (puede ser S/ 0.00)');
      return;
    }
    if (!confirmed) {
      toast.error('Confirma que el monto es correcto');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('cash_registers')
        .insert({
          school_id: schoolId,
          opened_by: user?.id,
          initial_amount: val,
          status: 'open',
        });

      if (error) throw error;

      toast.success(`✅ Caja abierta con S/ ${val.toFixed(2)}`);
      onOpened();
    } catch (error: any) {
      isSubmittingRef.current = false;
      toast.error('Error al abrir caja: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── PANTALLA: CAJA ANTERIOR SIN CERRAR ────────────────────────────
  if (step === 'unclosed_warning') {
    const prevDate = previousUnclosed?.opened_at
      ? format(new Date(previousUnclosed.opened_at), "EEEE dd 'de' MMMM", { locale: es })
      : 'día anterior';

    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          {/* Header rojo */}
          <div className="bg-red-600 text-white p-6 text-center">
            <AlertTriangle className="h-14 w-14 mx-auto mb-3" />
            <h2 className="text-2xl font-black uppercase tracking-wide">
              ¡Caja sin cerrar!
            </h2>
            <p className="text-red-100 text-sm mt-1">
              Tienes una caja del {prevDate} que no fue cerrada
            </p>
          </div>

          {/* Cuerpo */}
          <div className="p-6 space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 space-y-1">
              <p className="font-bold">📅 Fecha de apertura: {prevDate}</p>
              <p>💰 Monto inicial: S/ {previousUnclosed?.initial_amount?.toFixed(2) ?? '0.00'}</p>
              <p className="text-xs text-red-600 mt-2">
                No puedes abrir una nueva caja sin cerrar la anterior. Esto ayuda a mantener
                el registro correcto de todas las operaciones.
              </p>
            </div>

            <p className="text-sm text-gray-600 text-center">
              Si no puedes hacer el cierre completo ahora, puedes forzar el cierre
              de la caja anterior. <strong>Esto quedará registrado.</strong>
            </p>

            <div className="space-y-2">
              <Button
                onClick={() => window.location.href = '/#/cash-register'}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                <Lock className="h-4 w-4 mr-2" />
                Ir a Cerrar Caja del {prevDate}
              </Button>
              <Button
                variant="outline"
                onClick={forceClosePrevious}
                disabled={closingPrevious}
                className="w-full border-red-300 text-red-700 hover:bg-red-50"
              >
                {closingPrevious ? 'Cerrando...' : '⚠️ Forzar cierre y continuar'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── PANTALLA: DECLARACIÓN DE APERTURA ─────────────────────────────
  const val = parseFloat(amount);
  const isValidAmount = !isNaN(val) && val >= 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header verde */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white p-6 text-center">
          <Banknote className="h-14 w-14 mx-auto mb-3" />
          <h2 className="text-2xl font-black uppercase tracking-wide">
            Apertura de Caja
          </h2>
          <p className="text-emerald-100 text-sm mt-1">
            {format(new Date(), "EEEE dd 'de' MMMM yyyy", { locale: es })}
          </p>
        </div>

        {/* Cuerpo */}
        <div className="p-6 space-y-5">
          <div className="text-center">
            <p className="text-gray-700 font-medium text-lg">
              ¿Cuánto efectivo tienes en caja ahora mismo?
            </p>
            <p className="text-gray-500 text-sm mt-1">
              Cuenta el dinero físico e ingresa el monto exacto
            </p>
          </div>

          {/* Input de monto */}
          <div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-400">
                S/
              </span>
              <Input
                type="number"
                step="0.50"
                min="0"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setConfirmed(false); }}
                placeholder="0.00"
                className="h-16 text-3xl font-black text-center pl-12 border-2 border-emerald-300 focus:border-emerald-500"
                autoFocus
              />
            </div>
          </div>

          {/* Checkbox de confirmación */}
          {isValidAmount && amount !== '' && (
            <label className="flex items-start gap-3 cursor-pointer bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 accent-emerald-600"
              />
              <span className="text-sm text-emerald-800">
                Confirmo que tengo{' '}
                <strong className="text-xl">S/ {val.toFixed(2)}</strong>{' '}
                en efectivo en caja al iniciar la jornada del día de hoy.
              </span>
            </label>
          )}

          {/* Botón principal */}
          <Button
            onClick={handleOpen}
            disabled={!isValidAmount || !confirmed || loading || amount === ''}
            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
          >
            {loading ? (
              'Abriendo caja...'
            ) : (
              <>
                <ArrowRight className="h-5 w-5 mr-2" />
                Iniciar Jornada
              </>
            )}
          </Button>

          <p className="text-xs text-gray-400 text-center">
            Este monto quedará registrado. Al cierre del día se comparará
            con el efectivo real para detectar diferencias.
          </p>
        </div>
      </div>
    </div>
  );
}
