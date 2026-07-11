import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Lock, AlertTriangle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession } from '@/types/cashRegisterV2';
import {
  closeCashSession,
  fetchCashDaySummary,
  type CashDaySummaryAdmin,
} from '@/features/cash/services/cashSessionService';

interface Props {
  open: boolean;
  onClose: () => void;
  session: CashSession;
  schoolId: string;
  onClosed: () => void;
  /** Admin ve montos del sistema. Operador: cierre ciego (sin totales). */
  isAdmin?: boolean;
}

function safeAdd(...values: number[]): number {
  return Number(values.reduce((acc, v) => acc + (v || 0), 0).toFixed(2));
}

export default function CashReconciliationDialog({
  open,
  onClose,
  session,
  schoolId,
  onClosed,
  isAdmin = false,
}: Props) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Solo admin carga montos del sistema (vía RPC; nunca desde el cliente)
  const [systemCash, setSystemCash] = useState(0);
  const [systemTarjeta, setSystemTarjeta] = useState(0);
  const [digitalInfo, setDigitalInfo] = useState<{ yapePlin: number; transferencia: number }>({
    yapePlin: 0,
    transferencia: 0,
  });

  const [declaredCash, setDeclaredCash] = useState('');
  const [declaredTarjeta, setDeclaredTarjeta] = useState('');
  const [justification, setJustification] = useState('');
  const [showJustification, setShowJustification] = useState(false);

  useEffect(() => {
    if (!open) return;

    setDeclaredCash('');
    setDeclaredTarjeta('');
    setJustification('');
    setShowJustification(false);
    setSystemCash(0);
    setSystemTarjeta(0);
    setDigitalInfo({ yapePlin: 0, transferencia: 0 });

    // Operador: no consulta totales (cierre ciego real)
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadAdminBalances = async () => {
      setLoading(true);
      try {
        const { data, error } = await fetchCashDaySummary(schoolId, session.session_date);
        if (cancelled) return;
        if (error) throw new Error(error);
        if (!data || data.mode !== 'admin') {
          throw new Error('No se pudieron cargar los montos del sistema.');
        }
        const admin = data as CashDaySummaryAdmin;
        const bal = admin.computed_balances;
        setSystemCash(Number(bal?.system_cash ?? 0));
        setSystemTarjeta(Number(bal?.system_tarjeta ?? 0));
        setDigitalInfo({
          yapePlin: Number(bal?.system_yape ?? 0),
          transferencia: Number(bal?.system_transferencia ?? 0),
        });
      } catch (err) {
        console.error('[CashReconciliation] Error cargando balances admin:', err);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err instanceof Error ? err.message : 'No se pudieron cargar los montos.',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAdminBalances();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin, schoolId, session.session_date]);

  const declaredCashNum = parseFloat(declaredCash.replace(',', '.')) || 0;
  const declaredTarjetaNum = parseFloat(declaredTarjeta.replace(',', '.')) || 0;
  const varianceCash = Number((systemCash - declaredCashNum).toFixed(2));
  const varianceTarjeta = Number((systemTarjeta - declaredTarjetaNum).toFixed(2));
  const varianceTotal = Number((varianceCash + varianceTarjeta).toFixed(2));
  const hasVariance = Math.abs(varianceTotal) >= 0.50;

  const renderVarianceBadge = (v: number) => {
    if (Math.abs(v) < 0.50) return <span className="text-green-600 font-semibold text-sm">✓ Cuadra</span>;
    if (v > 0) return <span className="text-red-600 font-semibold text-sm">Faltante S/ {v.toFixed(2)}</span>;
    return <span className="text-amber-600 font-semibold text-sm">Sobrante S/ {Math.abs(v).toFixed(2)}</span>;
  };

  const sanitizeAmount = (raw: string): string =>
    raw.replace(',', '.').replace(/[^0-9.]/g, '');

  const handleCerrarCaja = async () => {
    if (saving) return;

    if (session.status === 'closed') {
      toast({ title: 'Esta caja ya fue cerrada', description: 'No se puede volver a cerrar una caja ya cerrada.' });
      onClose();
      return;
    }

    const cashRaw = sanitizeAmount(declaredCash.trim());
    const tarjetaRaw = sanitizeAmount(declaredTarjeta.trim());
    if (cashRaw !== '') {
      const v = parseFloat(cashRaw);
      if (isNaN(v) || v < 0) {
        toast({
          variant: 'destructive',
          title: 'Efectivo inválido',
          description: 'Ingresa solo números. Usa punto para decimales: ej. 150.50',
        });
        return;
      }
    }
    if (tarjetaRaw !== '') {
      const v = parseFloat(tarjetaRaw);
      if (isNaN(v) || v < 0) {
        toast({
          variant: 'destructive',
          title: 'Tarjeta inválida',
          description: 'Ingresa solo números. Usa punto para decimales: ej. 320.00',
        });
        return;
      }
    }

    if (isAdmin) {
      if (hasVariance && !showJustification) {
        setShowJustification(true);
        return;
      }
      if (hasVariance && !justification.trim()) {
        toast({
          variant: 'destructive',
          title: 'Justificación requerida',
          description: 'Hay un descuadre. Escribe una justificación antes de cerrar.',
        });
        return;
      }
    }

    setSaving(true);
    try {
      // Solo montos físicos. La BD calcula system_* y variance_*.
      const { data, error } = await closeCashSession({
        sessionId: session.id,
        physicalCash: declaredCashNum,
        physicalTarjeta: declaredTarjetaNum,
        varianceJustification: isAdmin ? justification.trim() || null : null,
      });

      if (error) throw new Error(error);
      if (!data?.ok) throw new Error('No se pudo cerrar la caja.');

      toast({
        title: '✅ Caja cerrada exitosamente',
        description: isAdmin
          ? 'El cierre y arqueo se guardaron correctamente.'
          : 'Tu turno fue registrado correctamente.',
      });
      onClosed();
      onClose();
    } catch (err: unknown) {
      console.error('[CashReconciliation] Error closing:', err);
      const msg = err instanceof Error ? err.message : '';

      if (msg.includes('SESSION_ALREADY_CLOSED')) {
        toast({
          title: 'Esta caja ya fue cerrada',
          description: 'Otro usuario cerró la caja al mismo tiempo. Actualiza la página.',
        });
        onClosed();
        onClose();
        return;
      }

      if (msg.includes('SESSION_NOT_FOUND')) {
        toast({
          variant: 'destructive',
          title: 'Sesión no encontrada',
          description: 'La sesión de caja no existe. Recarga la página.',
        });
        return;
      }

      if (msg.includes('VARIANCE_JUSTIFICATION_REQUIRED')) {
        setShowJustification(true);
        toast({
          variant: 'destructive',
          title: 'Justificación requerida',
          description: 'Hay un descuadre. Escribe una justificación antes de cerrar.',
        });
        return;
      }

      const isNetworkError =
        err instanceof TypeError ||
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('Failed') ||
        msg.includes('NetworkError');
      const friendlyMsg = isNetworkError
        ? 'Error de red: tu cierre no se guardó. Revisa tu conexión e intenta de nuevo.'
        : msg || 'No se pudo cerrar la caja.';

      toast({ variant: 'destructive', title: 'Error al cerrar caja', description: friendlyMsg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent
        className="max-w-lg max-h-[95vh] overflow-y-auto"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            {isAdmin ? <Eye className="h-5 w-5 text-slate-700" /> : <EyeOff className="h-5 w-5 text-amber-600" />}
            {isAdmin ? 'Cierre de Caja — Vista Admin' : 'Cierre de Turno'}
          </DialogTitle>
          <p className="text-sm text-gray-500">
            {format(new Date(session.session_date + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es })}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            {!isAdmin && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2 text-amber-800 text-sm">
                <EyeOff className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <p>
                  <strong>Cierre a ciegas:</strong> Cuenta el dinero físico y escribe lo que hay.
                  No se muestran los totales del sistema para garantizar un arqueo honesto.
                </p>
              </div>
            )}

            {isAdmin && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Montos calculados por el sistema</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white rounded-lg p-3 border border-blue-100">
                    <p className="text-xs text-gray-500">💵 Efectivo (sistema)</p>
                    <p className="text-xl font-black text-blue-800">S/ {systemCash.toFixed(2)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">incl. fondo inicial + cobranzas</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-blue-100">
                    <p className="text-xs text-gray-500">💳 Tarjeta (sistema)</p>
                    <p className="text-xl font-black text-blue-800">S/ {systemTarjeta.toFixed(2)}</p>
                  </div>
                </div>
                {(digitalInfo.yapePlin > 0 || digitalInfo.transferencia > 0) && (
                  <div className="flex gap-4 text-xs text-purple-700 pt-1">
                    <span>📱 Yape/Plin: <strong>S/ {digitalInfo.yapePlin.toFixed(2)}</strong></span>
                    <span>🏦 Transfer.: <strong>S/ {digitalInfo.transferencia.toFixed(2)}</strong></span>
                    <span className="text-gray-400">(digital — no va a caja)</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-5">
              <p className="text-sm font-bold text-gray-700">
                {isAdmin ? 'Montos declarados por el cajero:' : 'Cuenta el dinero y escribe lo que hay:'}
              </p>

              <div className={`space-y-2 ${!isAdmin ? 'bg-orange-50 border-2 border-orange-200 rounded-2xl p-4' : ''}`}>
                <Label className={`font-black ${!isAdmin ? 'text-orange-800 text-lg' : 'text-base text-gray-800'}`}>
                  💵 Efectivo físico en caja
                </Label>
                {!isAdmin && (
                  <p className="text-xs text-orange-600">Cuenta todos los billetes y monedas que hay en la caja</p>
                )}
                <Input
                  type="text"
                  inputMode="decimal"
                  value={declaredCash}
                  onChange={(e) => {
                    const clean = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
                    setDeclaredCash(clean);
                  }}
                  placeholder="0.00"
                  className={`text-center font-black border-2 ${!isAdmin
                    ? 'h-20 text-4xl border-orange-400 focus:border-orange-500 bg-white'
                    : 'h-14 text-2xl'
                  }`}
                  autoFocus
                />
                {isAdmin && declaredCash !== '' && (
                  <div className={`flex justify-between items-center px-3 py-2 rounded-lg text-sm font-medium
                    ${Math.abs(varianceCash) < 0.50 ? 'bg-green-50 text-green-700' : varianceCash > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    <span>Sistema: S/ {systemCash.toFixed(2)}</span>
                    <span>{renderVarianceBadge(varianceCash)}</span>
                  </div>
                )}
              </div>

              <div className={`space-y-2 ${!isAdmin ? 'bg-blue-50 border-2 border-blue-200 rounded-2xl p-4' : ''}`}>
                <Label className={`font-black ${!isAdmin ? 'text-blue-800 text-lg' : 'text-base text-gray-800'}`}>
                  💳 Vouchers POS (tarjetas)
                </Label>
                {!isAdmin && (
                  <p className="text-xs text-blue-600">Suma los vouchers impresos del posnet/POS</p>
                )}
                <Input
                  type="text"
                  inputMode="decimal"
                  value={declaredTarjeta}
                  onChange={(e) => {
                    const clean = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
                    setDeclaredTarjeta(clean);
                  }}
                  placeholder="0.00"
                  className={`text-center font-black border-2 ${!isAdmin
                    ? 'h-20 text-4xl border-blue-400 focus:border-blue-500 bg-white'
                    : 'h-14 text-2xl'
                  }`}
                />
                {isAdmin && declaredTarjeta !== '' && (
                  <div className={`flex justify-between items-center px-3 py-2 rounded-lg text-sm font-medium
                    ${Math.abs(varianceTarjeta) < 0.50 ? 'bg-green-50 text-green-700' : varianceTarjeta > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    <span>Sistema: S/ {systemTarjeta.toFixed(2)}</span>
                    <span>{renderVarianceBadge(varianceTarjeta)}</span>
                  </div>
                )}
              </div>
            </div>

            {isAdmin && (declaredCash !== '' || declaredTarjeta !== '') && (
              <div className={`rounded-xl p-4 border-2 ${hasVariance ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                <div className="flex justify-between items-center text-sm font-bold">
                  <span>Total declarado:</span>
                  <span>S/ {safeAdd(declaredCashNum, declaredTarjetaNum).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-gray-600 mt-1">
                  <span>Total sistema:</span>
                  <span>S/ {safeAdd(systemCash, systemTarjeta).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center font-black text-base mt-2 pt-2 border-t">
                  <span>Resultado:</span>
                  <span>{renderVarianceBadge(varianceTotal)}</span>
                </div>
              </div>
            )}

            {!isAdmin && (declaredCash !== '' || declaredTarjeta !== '') && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2 text-slate-700 text-sm">
                <CheckCircle2 className="h-5 w-5 text-slate-500 shrink-0" />
                <p>
                  Total registrado:{' '}
                  <strong>S/ {safeAdd(declaredCashNum, declaredTarjetaNum).toFixed(2)}</strong>.
                  El admin verá el arqueo completo.
                </p>
              </div>
            )}

            {isAdmin && showJustification && hasVariance && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-red-800 text-sm">
                  <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                  <p>
                    <strong>Descuadre de S/ {Math.abs(varianceTotal).toFixed(2)}.</strong>{' '}
                    Escribe una justificación para poder cerrar.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold">Justificación del descuadre *</Label>
                  <Textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Ej: se dio vuelto de más, cliente pagó después, error en cobro..."
                    className="min-h-[70px]"
                    autoFocus
                  />
                </div>
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2 pt-1">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button
                onClick={handleCerrarCaja}
                disabled={saving || loading || (declaredCash === '' && declaredTarjeta === '')}
                className={`text-base font-bold transition-all ${isAdmin
                  ? 'h-12 bg-slate-800 hover:bg-slate-900'
                  : 'h-16 text-lg bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-200 w-full rounded-xl'
                }`}
              >
                {saving
                  ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Cerrando...</>
                  : isAdmin && hasVariance && !showJustification
                    ? <><AlertTriangle className="h-5 w-5 mr-2" /> Ver Descuadre y Cerrar</>
                    : isAdmin
                      ? <><Lock className="h-5 w-5 mr-2" /> Confirmar y Cerrar Caja</>
                      : <><Lock className="h-6 w-6 mr-2" /> Registrar y Cerrar Turno</>
                }
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
