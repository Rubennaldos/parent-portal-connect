import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';
import type { ManualEntryType } from '@/types/cashRegisterV2';

interface Props {
  open: boolean;
  onClose: () => void;
  entryType: ManualEntryType;
  cashSessionId: string;
  schoolId: string;
  onCreated: () => void;
}

const PAYMENT_METHODS = [
  { key: 'cash',          label: '💵 Efectivo' },
  { key: 'yape',          label: '📱 Yape' },
  { key: 'plin',          label: '📲 Plin' },
  { key: 'tarjeta',       label: '💳 Tarjeta POS' },
  { key: 'transferencia', label: '🏦 Transferencia' },
  { key: 'otro',          label: '🔀 Otro' },
] as const;

type PaymentMethod = typeof PAYMENT_METHODS[number]['key'];

const INCOME_REASONS = [
  'Pago deuda almuerzo',
  'Pago saldo kiosco',
  'Devolución de proveedor',
  'Cobro de servicio',
  'Otro',
];
const EXPENSE_REASONS = [
  'Compra insumos kiosco',
  'Devolución a padre/alumno',
  'Pago a proveedor',
  'Gastos de operación',
  'Otro',
];

// EC-5: Límite máximo razonable para un kiosco escolar
const MAX_AMOUNT = 10000;

// EC-5: Normaliza a exactamente 2 decimales para evitar floating-point drift
function safeAmount(value: string): number | null {
  const raw = parseFloat(value);
  if (isNaN(raw)) return null;
  return Number(raw.toFixed(2));
}

// EC-5: Valida que el string no tenga más de 2 decimales
function hasExcessDecimals(value: string): boolean {
  const dotIndex = value.indexOf('.');
  if (dotIndex === -1) return false;
  return value.substring(dotIndex + 1).length > 2;
}

function resetForm(
  setAmount: (v: string) => void,
  setPaymentMethod: (v: PaymentMethod) => void,
  setSelectedReason: (v: string) => void,
  setCustomReason: (v: string) => void,
  setAmountError: (v: string) => void,
) {
  setAmount('');
  setPaymentMethod('cash');
  setSelectedReason('');
  setCustomReason('');
  setAmountError('');
}

export default function ManualCashEntryModal({
  open, onClose, entryType, cashSessionId, schoolId, onCreated,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  // EC-1: useRef como guard atómico contra doble clic — se actualiza ANTES de setState
  const isSubmittingRef = useRef(false);
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  const isIncome = entryType === 'income';
  const reasons = isIncome ? INCOME_REASONS : EXPENSE_REASONS;
  const finalDescription = selectedReason === 'Otro' ? customReason.trim() : selectedReason;

  // EC-2: Resetear estado al abrir (por si el componente se monta con open=true directamente)
  useEffect(() => {
    if (open) {
      resetForm(setAmount, setPaymentMethod, setSelectedReason, setCustomReason, setAmountError);
      isSubmittingRef.current = false;
    }
  }, [open]);

  const handleClose = () => {
    if (isSubmittingRef.current) return; // EC-1: no cerrar mientras se envía
    resetForm(setAmount, setPaymentMethod, setSelectedReason, setCustomReason, setAmountError);
    onClose();
  };

  // EC-5: Validación en tiempo real del monto mientras escribe
  const handleAmountChange = (value: string) => {
    setAmountError('');
    if (hasExcessDecimals(value)) {
      setAmountError('Máximo 2 decimales permitidos.');
      return; // no actualizar si excede decimales
    }
    setAmount(value);
    const parsed = safeAmount(value);
    if (parsed !== null && parsed > MAX_AMOUNT) {
      setAmountError(`El monto no puede superar S/ ${MAX_AMOUNT.toLocaleString()}.`);
    }
  };

  const handleSubmit = async () => {
    if (!user) return;

    // EC-1: Guard atómico — si ya hay un envío en curso, ignorar completamente
    if (isSubmittingRef.current) return;

    // EC-5: Validación completa del monto
    const parsedAmount = safeAmount(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast({ variant: 'destructive', title: 'Monto inválido', description: 'Ingresa un monto mayor a 0.' });
      return;
    }
    if (parsedAmount > MAX_AMOUNT) {
      toast({ variant: 'destructive', title: 'Monto excesivo', description: `El máximo permitido es S/ ${MAX_AMOUNT.toLocaleString()}.` });
      return;
    }
    if (!selectedReason) {
      toast({ variant: 'destructive', title: 'Motivo requerido', description: 'Selecciona el motivo del movimiento.' });
      return;
    }
    if (selectedReason === 'Otro' && !customReason.trim()) {
      toast({ variant: 'destructive', title: 'Describe el motivo', description: 'Escribe el motivo en el campo de texto.' });
      return;
    }

    // EC-1: Marcar como en proceso ANTES de cualquier await
    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error } = await supabase.from('cash_manual_entries').insert({
        cash_session_id: cashSessionId,
        school_id: schoolId,
        entry_type: entryType,
        amount: parsedAmount,
        // EC-TZ: usar hora Lima para que entry_date sea el día correcto
        entry_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }),
        category: 'miscellaneous',
        description: finalDescription,
        payment_method: paymentMethod,
        created_by: user.id,
      });

      // EC-4: si hay error de Supabase, throw lo captura el catch — NO se cierra el modal
      if (error) throw error;

      const methodLabel = PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label || paymentMethod;
      toast({
        title: `✅ ${isIncome ? 'Ingreso' : 'Egreso'} registrado`,
        description: `S/ ${parsedAmount.toFixed(2)} — ${methodLabel} — ${finalDescription}`,
      });

      // Solo cerramos y recargamos si el insert fue exitoso
      resetForm(setAmount, setPaymentMethod, setSelectedReason, setCustomReason, setAmountError);
      onClose();
      onCreated();
    } catch (err: any) {
      // EC-4: Toast con mensaje de red/timeout, modal permanece abierto
      // EC-LIMBO: mensaje especial si la caja fue cerrada mientras el modal estaba abierto
      console.error('[ManualCashEntryModal] Error:', err);
      const msg: string = err.message || '';
      const isSessionClosed = msg.includes('cash_session_closed');
      const isNetworkError = !msg || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('fetch');

      toast({
        variant: 'destructive',
        title: isSessionClosed ? 'La caja ya fue cerrada' : 'No se pudo registrar',
        description: isSessionClosed
          ? 'Otra persona cerró la caja mientras tenías el formulario abierto. Recarga la página para continuar.'
          : isNetworkError
            ? 'Sin conexión o tiempo de espera agotado. Verifica tu internet e intenta de nuevo.'
            : (msg || 'Ocurrió un error inesperado.'),
      });
      // EC-4 + EC-LIMBO: El modal NO se cierra — el usuario puede ver el error y decidir
    } finally {
      // EC-1: Liberar el guard al terminar (éxito o error)
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const isFormBlocked = loading || isSubmittingRef.current;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={`text-xl ${isIncome ? 'text-green-700' : 'text-red-700'}`}>
            {isIncome ? '📥 Registrar Ingreso Manual' : '📤 Registrar Egreso Manual'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Monto — EC-5: max, step forzado, validación en tiempo real */}
          <div className="space-y-1.5">
            <Label className="font-semibold">
              Monto (S/) <span className="text-red-500">*</span>
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={MAX_AMOUNT}
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0.00"
              className={`text-lg h-12 ${amountError ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
              disabled={isFormBlocked}
              autoFocus
            />
            {amountError && (
              <p className="flex items-center gap-1 text-xs text-red-600 mt-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {amountError}
              </p>
            )}
          </div>

          {/* Medio de pago — EC-1: deshabilitado durante envío */}
          <div className="space-y-1.5">
            <Label className="font-semibold">
              Medio de pago <span className="text-red-500">*</span>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  disabled={isFormBlocked}
                  onClick={() => setPaymentMethod(m.key)}
                  className={`rounded-lg border-2 p-2.5 text-xs font-medium transition-all text-center disabled:opacity-50 disabled:cursor-not-allowed ${
                    paymentMethod === m.key
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 hover:border-blue-300 text-gray-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo — EC-1: deshabilitado durante envío */}
          <div className="space-y-1.5">
            <Label className="font-semibold">
              Motivo <span className="text-red-500">*</span>
            </Label>
            <div className="space-y-1.5">
              {reasons.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={isFormBlocked}
                  onClick={() => setSelectedReason(reason)}
                  className={`w-full text-left rounded-lg border-2 px-3 py-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    selectedReason === reason
                      ? isIncome
                        ? 'border-green-500 bg-green-50 text-green-800 font-semibold'
                        : 'border-red-500 bg-red-50 text-red-800 font-semibold'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            {selectedReason === 'Otro' && (
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe el motivo..."
                className="mt-2 h-10"
                disabled={isFormBlocked}
                autoFocus
                maxLength={200}
              />
            )}
          </div>

          {/* Resumen — EC-3: muestra valor ya normalizado */}
          {amount && selectedReason && !amountError && (
            <div className={`rounded-lg p-3 text-sm border-2 ${isIncome ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className="font-semibold text-gray-700">Resumen del movimiento:</p>
              <p className="text-gray-600 mt-0.5">
                <strong>{isIncome ? '+' : '-'}S/ {(safeAmount(amount) ?? 0).toFixed(2)}</strong>
                {' · '}{PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label}
                {' · '}{selectedReason === 'Otro' ? (customReason || '...') : selectedReason}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose} disabled={isFormBlocked}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isFormBlocked || !!amountError}
            className={isIncome ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
          >
            {isFormBlocked ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isIncome ? 'Registrar Ingreso' : 'Registrar Egreso'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
