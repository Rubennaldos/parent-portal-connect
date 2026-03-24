import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Lock, ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
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

export default function CashReconciliationDialog({ open, onClose, session, schoolId, onClosed }: Props) {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const isAdmin = role === 'admin_general' || role === 'superadmin' || role === 'gestor_unidad';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Paso 1: Arqueo Ciego — el cajero ingresa lo que tiene
  // Paso 2: Comparación + Justificación si hay descuadre
  // Paso 3: Datos del cajero + firma
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Montos del sistema (calculados)
  const [systemCash, setSystemCash] = useState(0);
  const [systemTarjeta, setSystemTarjeta] = useState(0);
  const [digitalInfo, setDigitalInfo] = useState<{ yapePlin: number; transferencia: number }>({ yapePlin: 0, transferencia: 0 });

  // Montos declarados por el cajero (paso 1)
  const [declaredCash, setDeclaredCash] = useState('');
  const [declaredTarjeta, setDeclaredTarjeta] = useState('');

  // Justificación de descuadre (paso 2)
  const [justification, setJustification] = useState('');

  // Datos del cajero (paso 3)
  const [cashierName, setCashierName] = useState('');
  const [cashierDni, setCashierDni] = useState('');
  const [closureNotes, setClosureNotes] = useState('');

  // Firma digital
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setDeclaredCash('');
      setDeclaredTarjeta('');
      setJustification('');
      setCashierName('');
      setCashierDni('');
      setClosureNotes('');
      setHasSignature(false);
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

  // Varianzas
  const declaredCashNum = parseFloat(declaredCash) || 0;
  const declaredTarjetaNum = parseFloat(declaredTarjeta) || 0;
  const varianceCash = Number((systemCash - declaredCashNum).toFixed(2));
  const varianceTarjeta = Number((systemTarjeta - declaredTarjetaNum).toFixed(2));
  const varianceTotal = Number((varianceCash + varianceTarjeta).toFixed(2));
  const hasVariance = Math.abs(varianceTotal) >= 0.50;

  // Canvas de firma
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    setHasSignature(true);
    const rect = canvasRef.current!.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const stopDrawing = () => setIsDrawing(false);
  const clearSignature = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasSignature(false);
  };

  const handleGoToStep2 = () => {
    if (declaredCash === '' && declaredTarjeta === '') {
      toast({ variant: 'destructive', title: 'Ingresa al menos un monto', description: 'Escribe cuánto efectivo y/o tarjeta tienes en caja.' });
      return;
    }
    setStep(2);
  };

  const handleGoToStep3 = () => {
    if (hasVariance && !justification.trim()) {
      toast({ variant: 'destructive', title: 'Justificación requerida', description: 'Hay un descuadre. Debes explicar el motivo antes de continuar.' });
      return;
    }
    setStep(3);
  };

  const handleClose = async () => {
    if (!user) return;
    if (!cashierName.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido', description: 'Ingresa el nombre del cajero responsable.' });
      return;
    }

    setSaving(true);
    try {
      const signatureData = hasSignature && canvasRef.current ? canvasRef.current.toDataURL('image/png') : null;

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
          cashier_name: cashierName.trim(),
          cashier_dni: cashierDni.trim() || null,
          cashier_signature: signatureData,
          closure_notes: closureNotes.trim() || null,
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

      toast({ title: '✅ Caja cerrada', description: 'La reconciliación y cierre se completaron correctamente.' });
      onClosed();
      onClose();
    } catch (err: any) {
      console.error('[CashReconciliation] Error closing:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo cerrar la caja.' });
    } finally {
      setSaving(false);
    }
  };

  const renderVarianceBadge = (v: number) => {
    if (Math.abs(v) < 0.50) return <span className="text-green-600 font-bold">✓ Cuadra</span>;
    if (v > 0) return <span className="text-red-600 font-bold">Faltante S/ {v.toFixed(2)}</span>;
    return <span className="text-amber-600 font-bold">Sobrante S/ {Math.abs(v).toFixed(2)}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Lock className="h-6 w-6 text-slate-700" />
            Cierre de Caja
          </DialogTitle>
          <p className="text-sm text-gray-500">
            {format(new Date(session.session_date + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es })}
          </p>
          {/* Indicador de pasos */}
          <div className="flex items-center gap-2 mt-3">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`flex items-center gap-1.5 text-xs font-medium ${step >= s ? 'text-blue-700' : 'text-gray-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > s ? 'bg-green-500 text-white' : step === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {step > s ? '✓' : s}
                </div>
                <span className="hidden sm:inline">{s === 1 ? 'Conteo' : s === 2 ? 'Comparación' : 'Firma'}</span>
                {s < 3 && <ArrowRight className="h-3 w-3 text-gray-300" />}
              </div>
            ))}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">

            {/* ═══ PASO 1: ARQUEO CIEGO ═══ */}
            {step === 1 && (
              <div className="space-y-5">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p><strong>Arqueo ciego:</strong> Cuenta el dinero físico en tu cajón y anótalo aquí. NO te mostraremos el monto del sistema hasta el siguiente paso.</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="font-semibold text-base">💵 Efectivo en cajón (S/)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={declaredCash}
                      onChange={(e) => setDeclaredCash(e.target.value)}
                      placeholder="0.00"
                      className="h-14 text-2xl text-center font-bold"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold text-base">💳 Total Tarjeta (vouchers / reportes POS) (S/)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={declaredTarjeta}
                      onChange={(e) => setDeclaredTarjeta(e.target.value)}
                      placeholder="0.00"
                      className="h-14 text-2xl text-center font-bold"
                    />
                  </div>
                </div>

                {(digitalInfo.yapePlin > 0 || digitalInfo.transferencia > 0) && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 space-y-1">
                    <p className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-1">📱 Digital (referencia — no se cuenta)</p>
                    {digitalInfo.yapePlin > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-purple-600">Yape / Plin</span>
                        <span className="font-bold text-purple-800">S/ {digitalInfo.yapePlin.toFixed(2)}</span>
                      </div>
                    )}
                    {digitalInfo.transferencia > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-cyan-600">Transferencia</span>
                        <span className="font-bold text-cyan-800">S/ {digitalInfo.transferencia.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
                  <Button variant="outline" onClick={onClose}>Cancelar</Button>
                  <Button onClick={handleGoToStep2} className="bg-blue-600 hover:bg-blue-700 h-12 text-base">
                    Siguiente: Comparar <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* ═══ PASO 2: COMPARACIÓN + JUSTIFICACIÓN ═══ */}
            {step === 2 && (
              <div className="space-y-5">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-300">
                      <th className="text-left py-2 px-3 font-semibold text-gray-700">Medio</th>
                      <th className="text-right py-2 px-3 font-semibold text-blue-700">Sistema</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">Declarado</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="py-2.5 px-3 font-medium">💵 Efectivo</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-blue-700">S/ {systemCash.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">S/ {declaredCashNum.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">{renderVarianceBadge(varianceCash)}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="py-2.5 px-3 font-medium">💳 Tarjeta</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-blue-700">S/ {systemTarjeta.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">S/ {declaredTarjetaNum.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">{renderVarianceBadge(varianceTarjeta)}</td>
                    </tr>
                    <tr className="border-t-2 border-gray-400 bg-gray-50 font-bold">
                      <td className="py-3 px-3">TOTAL</td>
                      <td className="py-3 px-3 text-right text-blue-800">S/ {safeAdd(systemCash, systemTarjeta).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right">S/ {safeAdd(declaredCashNum, declaredTarjetaNum).toFixed(2)}</td>
                      <td className={`py-3 px-3 text-right font-bold ${Math.abs(varianceTotal) < 0.50 ? 'text-green-700' : 'text-red-700'}`}>
                        {renderVarianceBadge(varianceTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {!hasVariance && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-green-800 text-sm">
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <p><strong>¡Perfecto!</strong> La caja cuadra. Puedes continuar al cierre.</p>
                  </div>
                )}

                {hasVariance && (
                  <div className="space-y-3">
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-red-800 text-sm">
                      <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                      <p><strong>Hay un descuadre de S/ {Math.abs(varianceTotal).toFixed(2)}.</strong> Debes justificar la diferencia para poder cerrar.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="font-semibold">Justificación del descuadre *</Label>
                      <Textarea
                        value={justification}
                        onChange={(e) => setJustification(e.target.value)}
                        placeholder="Explica por qué hay diferencia (ej: se dio vuelto de más, cliente pagó después, error en cobro, etc.)"
                        className="min-h-[80px]"
                      />
                    </div>
                  </div>
                )}

                <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Volver
                  </Button>
                  <Button onClick={handleGoToStep3} className="bg-blue-600 hover:bg-blue-700 h-12 text-base">
                    Siguiente: Firmar <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* ═══ PASO 3: DATOS CAJERO + FIRMA ═══ */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="font-semibold">Cajero Responsable *</Label>
                    <Input value={cashierName} onChange={(e) => setCashierName(e.target.value)} placeholder="Nombre completo" autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold">DNI</Label>
                    <Input value={cashierDni} onChange={(e) => setCashierDni(e.target.value)} placeholder="DNI del cajero" maxLength={11} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="font-semibold">Notas de Cierre (opcional)</Label>
                  <Input value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} placeholder="Observaciones..." />
                </div>

                {/* Resumen compacto */}
                <div className="bg-slate-50 border rounded-xl px-4 py-3 text-sm space-y-1">
                  <p className="font-bold text-slate-700">Resumen del cierre:</p>
                  <p>💵 Efectivo: Declarado S/ {declaredCashNum.toFixed(2)} vs Sistema S/ {systemCash.toFixed(2)}</p>
                  <p>💳 Tarjeta: Declarado S/ {declaredTarjetaNum.toFixed(2)} vs Sistema S/ {systemTarjeta.toFixed(2)}</p>
                  {hasVariance && <p className="text-red-600 font-semibold">⚠️ Descuadre: S/ {Math.abs(varianceTotal).toFixed(2)} — {justification.substring(0, 80)}{justification.length > 80 ? '...' : ''}</p>}
                  {!hasVariance && <p className="text-green-600 font-semibold">✓ Caja cuadrada</p>}
                </div>

                {/* Firma digital */}
                <div className="space-y-2">
                  <Label className="font-semibold">Firma Digital del Cajero</Label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-1 bg-white">
                    <canvas
                      ref={canvasRef}
                      width={500}
                      height={120}
                      className="w-full cursor-crosshair"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs text-gray-500">
                    Limpiar firma
                  </Button>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStep(2)} disabled={saving}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Volver
                  </Button>
                  <Button
                    onClick={handleClose}
                    disabled={saving || loading}
                    className="bg-slate-800 hover:bg-slate-900 h-12 text-base"
                  >
                    {saving
                      ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Cerrando...</>
                      : <><Lock className="h-5 w-5 mr-2" /> Confirmar y Cerrar Caja</>
                    }
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
