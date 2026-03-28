import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
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

interface Props {
  open: boolean;
  onClose: () => void;
  session: CashSession;
  schoolId: string;
  onClosed: () => void;
  /** Si true: admin ve montos del sistema + comparativa. Si false: cajero hace cierre a ciegas. */
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

      // RPC de totales POS + almuerzo
      const { data: rpcData } = await supabase.rpc('calculate_daily_totals', {
        p_school_id: schoolId,
        p_date: today,
      });

      const d = rpcData || { pos: {}, lunch: {} };
      const pos = d.pos || {};
      const lunch = d.lunch || {};

      // Ingresos/egresos manuales de esta sesión
      const { data: entries } = await supabase
        .from('cash_manual_entries')
        .select('entry_type, amount')
        .eq('cash_session_id', session.id);

      const manualIncome  = (entries || []).filter(e => e.entry_type === 'income').reduce((s, e) => s + e.amount, 0);
      const manualExpense = (entries || []).filter(e => e.entry_type === 'expense').reduce((s, e) => s + e.amount, 0);

      // ── FIX: Cobranzas aprobadas en efectivo del día ─────────────────────
      // Los pagos de cobranza hechos en efectivo NO pasan por POS, así que
      // no entran en calculate_daily_totals (que solo lee transactions).
      // Se suman aquí con filtro insensible a mayúsculas (ilike) para cubrir
      // variantes: "efectivo", "Efectivo", "EFECTIVO", "cash", "money".
      const { data: billingCash } = await supabase
        .from('recharge_requests')
        .select('amount')
        .eq('school_id', schoolId)
        .eq('status', 'approved')
        .or('payment_method.ilike.efectivo,payment_method.ilike.cash,payment_method.ilike.money,payment_method.ilike.en efectivo')
        .gte('approved_at', `${today}T00:00:00-05:00`)
        .lt('approved_at',  `${today}T23:59:59-05:00`);

      const billingCashTotal = (billingCash || []).reduce((s, r) => s + (r.amount || 0), 0);

      const cashSales        = safeAdd(pos.cash, lunch.cash, pos.mixed_cash);
      const tarjetaSales     = safeAdd(pos.card, lunch.card, pos.mixed_card);
      const yapePlinTotal    = safeAdd(pos.yape, pos.plin, lunch.yape, lunch.plin, pos.mixed_yape);
      const transferenciaTotal = safeAdd(pos.transferencia, lunch.transferencia);

      // systemCash = efectivo inicial + ventas en efectivo (POS+almuerzo) + cobranzas efectivo + manuales
      setSystemCash(safeAdd(session.initial_cash, cashSales, billingCashTotal, manualIncome, -manualExpense));
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

      // ── Log de auditoría del cierre ──────────────────────────────────────
      // Queda registrado: quién cerró, cuánto declaró el cajero vs. el sistema.
      // El admin puede ver este log en el módulo de Auditoría.
      try {
        await supabase.from('huella_digital_logs').insert({
          usuario_id:  user.id,
          accion:      isAdmin ? 'CIERRE_CAJA_ADMIN' : 'CIERRE_CAJA_CAJERO',
          modulo:      'CIERRE_CAJA',
          school_id:   schoolId,
          contexto: {
            session_id:         session.id,
            session_date:       session.session_date,
            tipo_cierre:        isAdmin ? 'con_vision_sistema' : 'ciegas',
            declarado_efectivo: declaredCashNum,
            declarado_tarjeta:  declaredTarjetaNum,
            sistema_efectivo:   systemCash,
            sistema_tarjeta:    systemTarjeta,
            descuadre_efectivo: varianceCash,
            descuadre_tarjeta:  varianceTarjeta,
            descuadre_total:    varianceTotal,
            justificacion:      justification.trim() || null,
          },
        });
      } catch (logErr) {
        console.warn('[CashReconciliation] No se pudo guardar log de auditoría:', logErr);
      }

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

            {/* ─── BANNER cierre a ciegas (solo cajero) ─── */}
            {!isAdmin && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2 text-amber-800 text-sm">
                <EyeOff className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <p>
                  <strong>Cierre a ciegas:</strong> Cuenta el dinero físico y escribe lo que hay.
                  No se muestran los totales del sistema para garantizar un arqueo honesto.
                </p>
              </div>
            )}

            {/* ─── MODO ADMIN: muestra montos del sistema + comparativa ─── */}
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

            {/* ─── CAMPOS DE ARQUEO (cajero y admin) ─── */}
            <div className="space-y-5">
              <p className="text-sm font-bold text-gray-700">
                {isAdmin ? 'Montos declarados por el cajero:' : 'Cuenta el dinero y escribe lo que hay:'}
              </p>

              {/* 1. Efectivo — siempre primero y más destacado */}
              <div className={`space-y-2 ${!isAdmin ? 'bg-orange-50 border-2 border-orange-200 rounded-2xl p-4' : ''}`}>
                <Label className={`font-black ${!isAdmin ? 'text-orange-800 text-lg' : 'text-base text-gray-800'}`}>
                  💵 Efectivo físico en caja
                </Label>
                {!isAdmin && (
                  <p className="text-xs text-orange-600">Cuenta todos los billetes y monedas que hay en la caja</p>
                )}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={declaredCash}
                  onChange={(e) => setDeclaredCash(e.target.value)}
                  placeholder="0.00"
                  className={`text-center font-black border-2 ${!isAdmin
                    ? 'h-20 text-4xl border-orange-400 focus:border-orange-500 bg-white'
                    : 'h-14 text-2xl'
                  }`}
                  autoFocus
                />
                {/* Comparativa solo para admin */}
                {isAdmin && declaredCash !== '' && (
                  <div className={`flex justify-between items-center px-3 py-2 rounded-lg text-sm font-medium
                    ${Math.abs(varianceCash) < 0.50 ? 'bg-green-50 text-green-700' : varianceCash > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    <span>Sistema: S/ {systemCash.toFixed(2)}</span>
                    <span>{renderVarianceBadge(varianceCash)}</span>
                  </div>
                )}
              </div>

              {/* 2. Tarjeta */}
              <div className={`space-y-2 ${!isAdmin ? 'bg-blue-50 border-2 border-blue-200 rounded-2xl p-4' : ''}`}>
                <Label className={`font-black ${!isAdmin ? 'text-blue-800 text-lg' : 'text-base text-gray-800'}`}>
                  💳 Vouchers POS (tarjetas)
                </Label>
                {!isAdmin && (
                  <p className="text-xs text-blue-600">Suma los vouchers impresos del posnet/POS</p>
                )}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={declaredTarjeta}
                  onChange={(e) => setDeclaredTarjeta(e.target.value)}
                  placeholder="0.00"
                  className={`text-center font-black border-2 ${!isAdmin
                    ? 'h-20 text-4xl border-blue-400 focus:border-blue-500 bg-white'
                    : 'h-14 text-2xl'
                  }`}
                />
                {/* Comparativa solo para admin */}
                {isAdmin && declaredTarjeta !== '' && (
                  <div className={`flex justify-between items-center px-3 py-2 rounded-lg text-sm font-medium
                    ${Math.abs(varianceTarjeta) < 0.50 ? 'bg-green-50 text-green-700' : varianceTarjeta > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    <span>Sistema: S/ {systemTarjeta.toFixed(2)}</span>
                    <span>{renderVarianceBadge(varianceTarjeta)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ─── Resumen total (admin) ─── */}
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

            {/* ─── Confirmación cuadre (cajero) ─── */}
            {!isAdmin && (declaredCash !== '' || declaredTarjeta !== '') && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2 text-slate-700 text-sm">
                <CheckCircle2 className="h-5 w-5 text-slate-500 shrink-0" />
                <p>Total registrado: <strong>S/ {safeAdd(declaredCashNum, declaredTarjetaNum).toFixed(2)}</strong>. El admin verá el arqueo completo.</p>
              </div>
            )}

            {/* ─── Justificación si hay descuadre (admin) ─── */}
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
