import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession } from '@/types/cashRegisterV2';

interface Props {
  open: boolean;
  onClose: () => void;
  session: CashSession;
  schoolId: string;
  onClosed: () => void;
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
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Montos del sistema
  const [systemCash, setSystemCash] = useState(0);
  const [systemTarjeta, setSystemTarjeta] = useState(0);
  const [digitalInfo, setDigitalInfo] = useState<{ yapePlin: number; transferencia: number }>({ yapePlin: 0, transferencia: 0 });

  // Montos declarados por el cajero
  const [declaredCash, setDeclaredCash] = useState('');
  const [declaredTarjeta, setDeclaredTarjeta] = useState('');

  // Justificación (solo si hay descuadre)
  const [justification, setJustification] = useState('');
  const [showJustification, setShowJustification] = useState(false);

  useEffect(() => {
    if (open) {
      setDeclaredCash('');
      setDeclaredTarjeta('');
      setJustification('');
      setShowJustification(false);
      loadSystemBalances();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadSystemBalances = async () => {
    setLoading(true);
    try {
      const today = session.session_date;
      const { data: rpcData } = await supabase.rpc('calculate_daily_totals', {
        p_school_id: schoolId,
        p_date: today,
      });

      const d = rpcData || { pos: {}, lunch: {} };
      const pos = d.pos || {};
      const lunch = d.lunch || {};

      const { data: entries } = await supabase
        .from('cash_manual_entries')
        .select('entry_type, amount')
        .eq('cash_session_id', session.id);

      const manualIncome = (entries || []).filter(e => e.entry_type === 'income').reduce((s, e) => s + e.amount, 0);
      const manualExpense = (entries || []).filter(e => e.entry_type === 'expense').reduce((s, e) => s + e.amount, 0);

      const cashSales = safeAdd(pos.cash, lunch.cash, pos.mixed_cash);
      const tarjetaSales = safeAdd(pos.card, lunch.card, pos.mixed_card);
      const yapePlinTotal = safeAdd(pos.yape, pos.plin, lunch.yape, lunch.plin, pos.mixed_yape);
      const transferenciaTotal = safeAdd(pos.transferencia, lunch.transferencia);

      setSystemCash(safeAdd(session.initial_cash, cashSales, manualIncome, -manualExpense));
      setSystemTarjeta(tarjetaSales);
      setDigitalInfo({ yapePlin: yapePlinTotal, transferencia: transferenciaTotal });
    } catch (err) {
      console.error('[CashReconciliation] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const declaredCashNum = parseFloat(declaredCash) || 0;
  const declaredTarjetaNum = parseFloat(declaredTarjeta) || 0;
  const varianceCash = Number((systemCash - declaredCashNum).toFixed(2));
  const varianceTarjeta = Number((systemTarjeta - declaredTarjetaNum).toFixed(2));
  const varianceTotal = Number((varianceCash + varianceTarjeta).toFixed(2));
  const hasVariance = Math.abs(varianceTotal) >= 0.50;

  const renderVarianceBadge = (v: number) => {
    if (Math.abs(v) < 0.50) return <span className="text-green-600 font-semibold text-sm">✓ Cuadra</span>;
    if (v > 0) return <span className="text-red-600 font-semibold text-sm">Faltante S/ {v.toFixed(2)}</span>;
    return <span className="text-amber-600 font-semibold text-sm">Sobrante S/ {Math.abs(v).toFixed(2)}</span>;
  };

  const handleCerrarCaja = async () => {
    // Si hay descuadre y no hemos mostrado la justificación aún, mostrarla
    if (hasVariance && !showJustification) {
      setShowJustification(true);
      return;
    }

    // Si hay descuadre y justificación vacía, bloquear
    if (hasVariance && !justification.trim()) {
      toast({ variant: 'destructive', title: 'Justificación requerida', description: 'Hay un descuadre. Escribe una justificación antes de cerrar.' });
      return;
    }

    if (!user) return;
    setSaving(true);
    try {
      const { error: reconError } = await supabase.from('cash_reconciliations').insert({
        cash_session_id: session.id,
        school_id: schoolId,
        system_cash: systemCash,
        system_yape: digitalInfo.yapePlin,
        system_plin: 0,
        system_transferencia: digitalInfo.transferencia,
        system_tarjeta: systemTarjeta,
        system_mixto: 0,
        system_total: safeAdd(systemCash, systemTarjeta),
        physical_cash: declaredCashNum,
        physical_yape: 0,
        physical_plin: 0,
        physical_transferencia: 0,
        physical_tarjeta: declaredTarjetaNum,
        physical_mixto: 0,
        physical_total: safeAdd(declaredCashNum, declaredTarjetaNum),
        variance_cash: varianceCash,
        variance_yape: 0,
        variance_plin: 0,
        variance_transferencia: 0,
        variance_tarjeta: varianceTarjeta,
        variance_mixto: 0,
        variance_total: varianceTotal,
        declared_overage: varianceTotal < 0 ? Math.abs(varianceTotal) : 0,
        declared_deficit: varianceTotal > 0 ? varianceTotal : 0,
        reconciled_by: user.id,
      });
      if (reconError) throw reconError;

      const { error: closeError } = await supabase
        .from('cash_sessions')
        .update({
          status: 'closed',
          closed_by: user.id,
          closed_at: new Date().toISOString(),
          declared_cash: declaredCashNum,
          declared_tarjeta: declaredTarjetaNum,
          system_cash: systemCash,
          system_tarjeta: systemTarjeta,
          variance_cash: varianceCash,
          variance_tarjeta: varianceTarjeta,
          variance_total: varianceTotal,
          variance_justification: justification.trim() || null,
        })
        .eq('id', session.id);
      if (closeError) throw closeError;

      toast({ title: '✅ Caja cerrada', description: 'El cierre y arqueo se guardaron correctamente.' });
      onClosed();
      onClose();
    } catch (err: any) {
      console.error('[CashReconciliation] Error closing:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo cerrar la caja.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Lock className="h-5 w-5 text-slate-700" />
            Cierre de Caja
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

            {/* ─── Tabla de arqueo ─── */}
            <div className="border rounded-xl overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                Arqueo de Caja
              </div>
              <div className="divide-y">

                {/* Efectivo */}
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">💵 Efectivo</p>
                    <p className="text-xs text-blue-700 font-medium">Sistema: S/ {systemCash.toFixed(2)}</p>
                  </div>
                  <div className="w-36 space-y-1">
                    <Label className="text-xs text-gray-500">Monto real en físico</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={declaredCash}
                      onChange={(e) => setDeclaredCash(e.target.value)}
                      placeholder="0.00"
                      className="h-10 text-center font-bold text-base"
                      autoFocus
                    />
                  </div>
                  <div className="w-28 text-right">
                    {declaredCash !== '' && renderVarianceBadge(varianceCash)}
                  </div>
                </div>

                {/* Tarjeta */}
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">💳 Tarjeta</p>
                    <p className="text-xs text-blue-700 font-medium">Sistema: S/ {systemTarjeta.toFixed(2)}</p>
                  </div>
                  <div className="w-36 space-y-1">
                    <Label className="text-xs text-gray-500">Monto real en voucher</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={declaredTarjeta}
                      onChange={(e) => setDeclaredTarjeta(e.target.value)}
                      placeholder="0.00"
                      className="h-10 text-center font-bold text-base"
                    />
                  </div>
                  <div className="w-28 text-right">
                    {declaredTarjeta !== '' && renderVarianceBadge(varianceTarjeta)}
                  </div>
                </div>

                {/* Digital — solo informativo */}
                {(digitalInfo.yapePlin > 0 || digitalInfo.transferencia > 0) && (
                  <div className="px-4 py-3 bg-purple-50">
                    <p className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-1.5">
                      📱 Digital procesado en Kiosco (referencia — no se cuenta)
                    </p>
                    <div className="flex gap-6 text-sm">
                      {digitalInfo.yapePlin > 0 && (
                        <span className="text-purple-700">Yape/Plin: <strong>S/ {digitalInfo.yapePlin.toFixed(2)}</strong></span>
                      )}
                      {digitalInfo.transferencia > 0 && (
                        <span className="text-cyan-700">Transferencia: <strong>S/ {digitalInfo.transferencia.toFixed(2)}</strong></span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Total si ambos campos tienen valor */}
              {(declaredCash !== '' || declaredTarjeta !== '') && (
                <div className={`px-4 py-3 flex justify-between items-center font-bold text-sm border-t-2 ${hasVariance ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                  <span>TOTAL DECLARADO</span>
                  <span>S/ {safeAdd(declaredCashNum, declaredTarjetaNum).toFixed(2)}</span>
                  <span>vs Sistema S/ {safeAdd(systemCash, systemTarjeta).toFixed(2)}</span>
                  <span>{renderVarianceBadge(varianceTotal)}</span>
                </div>
              )}
            </div>

            {/* ─── Resultado del arqueo ─── */}
            {(declaredCash !== '' || declaredTarjeta !== '') && !hasVariance && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-green-800 text-sm">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <p><strong>¡Perfecto!</strong> La caja cuadra. Puedes cerrar.</p>
              </div>
            )}

            {/* ─── Justificación si hay descuadre ─── */}
            {showJustification && hasVariance && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-red-800 text-sm">
                  <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                  <p>
                    <strong>Descuadre de S/ {Math.abs(varianceTotal).toFixed(2)}.</strong>{' '}
                    Escribe una justificación para poder cerrar la caja.
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
                className="bg-slate-800 hover:bg-slate-900 h-12 text-base font-bold"
              >
                {saving
                  ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Cerrando...</>
                  : hasVariance && !showJustification
                    ? <><AlertTriangle className="h-5 w-5 mr-2" /> Ver Descuadre y Cerrar</>
                    : <><Lock className="h-5 w-5 mr-2" /> Confirmar y Cerrar Caja</>
                }
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
