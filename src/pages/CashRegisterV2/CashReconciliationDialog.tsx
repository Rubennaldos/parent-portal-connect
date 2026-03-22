import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, ArrowLeft, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession, DailySalesTotals, PAYMENT_METHODS } from '@/types/cashRegisterV2';

interface Props {
  open: boolean;
  onClose: () => void;
  session: CashSession;
  schoolId: string;
  onClosed: () => void;
}

interface MethodRow {
  key: string;
  label: string;
  icon: string;
  systemBalance: number;
  physicalCount: string;
}

export default function CashReconciliationDialog({ open, onClose, session, schoolId, onClosed }: Props) {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  // admin_general, superadmin y gestor_unidad ven el cierre completo (sistema vs físico + varianza)
  // operadores normales solo ven el conteo físico (cierre ciego / blind close)
  const isAdmin = role === 'admin_general' || role === 'superadmin' || role === 'gestor_unidad';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [digitalInfo, setDigitalInfo] = useState<{ yapePlin: number; transferencia: number }>({ yapePlin: 0, transferencia: 0 });
  const [cashierName, setCashierName] = useState('');
  const [cashierDni, setCashierDni] = useState('');
  const [declaredOverage, setDeclaredOverage] = useState('0');
  const [declaredDeficit, setDeclaredDeficit] = useState('0');
  const [closureNotes, setClosureNotes] = useState('');

  // Firma digital
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    if (open) loadSystemBalances();
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

      // Ingresos/Egresos manuales de la sesión
      const { data: entries } = await supabase
        .from('cash_manual_entries')
        .select('entry_type, amount')
        .eq('cash_session_id', session.id);

      const manualIncome = (entries || []).filter(e => e.entry_type === 'income').reduce((s, e) => s + e.amount, 0);
      const manualExpense = (entries || []).filter(e => e.entry_type === 'expense').reduce((s, e) => s + e.amount, 0);

      // Calcular balance del sistema por método
      // Solo Efectivo y Tarjeta van físicamente a caja.
      // Yape/Plin y Transferencia son digitales — se muestran como referencia.
      const cashSales = (pos.cash || 0) + (lunch.cash || 0) + (pos.mixed_cash || 0);
      const tarjetaSales = (pos.card || 0) + (lunch.card || 0) + (pos.mixed_card || 0);
      // Digital (informativo, no va a caja)
      // v8 RPC: yape ya incluye yape_qr + yape_numero; plin incluye plin_qr + plin_numero
      const yapePlinTotal = (pos.yape || 0) + (pos.plin || 0) + (lunch.yape || 0) + (lunch.plin || 0)
                          + (pos.mixed_yape || 0);
      const transferenciaTotal = (pos.transferencia || 0) + (lunch.transferencia || 0);

      const systemCash = session.initial_cash + cashSales + manualIncome - manualExpense;
      const systemTarjeta = tarjetaSales;

      setMethods([
        { key: 'cash',    label: 'Efectivo',    icon: '💵', systemBalance: systemCash,    physicalCount: '' },
        { key: 'tarjeta', label: 'Tarjeta P.O.S', icon: '💳', systemBalance: systemTarjeta, physicalCount: '' },
      ]);
      // Guardar totales digitales para mostrar como referencia
      setDigitalInfo({ yapePlin: yapePlinTotal, transferencia: transferenciaTotal });
    } catch (err) {
      console.error('[CashReconciliation] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const updatePhysical = (key: string, value: string) => {
    setMethods((prev) => prev.map((m) => m.key === key ? { ...m, physicalCount: value } : m));
  };

  const getVariance = (m: MethodRow) => {
    const physical = parseFloat(m.physicalCount) || 0;
    return m.systemBalance - physical;
  };

  const systemTotal = methods.reduce((s, m) => s + m.systemBalance, 0);
  const physicalTotal = methods.reduce((s, m) => s + (parseFloat(m.physicalCount) || 0), 0);
  const varianceTotal = systemTotal - physicalTotal;

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
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setHasSignature(false);
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

      // 1. Insertar reconciliación
      const { error: reconError } = await supabase.from('cash_reconciliations').insert({
        cash_session_id: session.id,
        school_id: schoolId,
        system_cash: methods.find(m => m.key === 'cash')?.systemBalance || 0,
        system_yape: digitalInfo.yapePlin,              // total Yape+Plin real del sistema
        system_plin: 0,                                 // plin ya está consolidado en system_yape
        system_transferencia: digitalInfo.transferencia, // total Transferencia real del sistema
        system_tarjeta: methods.find(m => m.key === 'tarjeta')?.systemBalance || 0,
        system_mixto: 0,
        system_total: systemTotal,
        physical_cash: parseFloat(methods.find(m => m.key === 'cash')?.physicalCount || '0') || 0,
        physical_yape: 0,             // digital — no se cuenta físicamente
        physical_plin: 0,
        physical_transferencia: 0,    // digital — no se cuenta físicamente
        physical_tarjeta: parseFloat(methods.find(m => m.key === 'tarjeta')?.physicalCount || '0') || 0,
        physical_mixto: 0,
        physical_total: physicalTotal,
        variance_cash: getVariance(methods.find(m => m.key === 'cash')!),
        variance_yape: 0,             // digital: varianza no aplica
        variance_plin: 0,
        variance_transferencia: 0,    // digital: varianza no aplica
        variance_tarjeta: getVariance(methods.find(m => m.key === 'tarjeta')!),
        variance_mixto: 0,
        variance_total: varianceTotal,
        declared_overage: parseFloat(declaredOverage) || 0,
        declared_deficit: parseFloat(declaredDeficit) || 0,
        reconciled_by: user.id,
      });

      if (reconError) throw reconError;

      // 2. Cerrar la sesión
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Lock className="h-6 w-6 text-slate-700" />
            Reconciliación Final de Cierre
          </DialogTitle>
          <p className="text-sm text-gray-500">
            Caja del {format(new Date(session.session_date + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es })}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Tabla de reconciliación */}
            <div className="overflow-x-auto">
              {/* Aviso cierre ciego para cajeros */}
              {!isAdmin && (
                <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p>
                    <strong>Cierre ciego:</strong> Ingresa el monto físico que tienes en mano
                    para cada medio de pago. El administrador revisará y comparará con el sistema.
                  </p>
                </div>
              )}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="text-left py-2 px-3 font-semibold text-gray-700">Categoría</th>
                    {isAdmin && (
                      <th className="text-right py-2 px-3 font-semibold text-blue-700">Balance Sistema</th>
                    )}
                    <th className="text-center py-2 px-3 font-semibold text-gray-700">Conteo Físico</th>
                    {isAdmin && (
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">Varianza</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => {
                    const v = getVariance(m);
                    return (
                      <tr key={m.key} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2.5 px-3 font-medium">
                          {m.icon} {m.label}
                        </td>
                        {isAdmin && (
                          <td className="py-2.5 px-3 text-right font-semibold text-blue-700">
                            S/ {m.systemBalance.toFixed(2)}
                          </td>
                        )}
                        <td className="py-2.5 px-3">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={m.physicalCount}
                            onChange={(e) => updatePhysical(m.key, e.target.value)}
                            placeholder="0.00"
                            className="h-9 text-center max-w-[130px] mx-auto"
                          />
                        </td>
                        {isAdmin && (
                          <td className={`py-2.5 px-3 text-right font-bold ${
                            Math.abs(v) < 0.01 ? 'text-green-600' :
                            v > 0 ? 'text-red-600' : 'text-amber-600'
                          }`}>
                            {v > 0 ? '+' : ''}{v.toFixed(2)}
                            {Math.abs(v) >= 1 && <AlertTriangle className="inline h-3.5 w-3.5 ml-1" />}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Totales */}
                  <tr className="border-t-2 border-gray-400 bg-gray-50 font-bold">
                    <td className="py-3 px-3">TOTAL (S/)</td>
                    {isAdmin && (
                      <td className="py-3 px-3 text-right text-blue-800">S/ {systemTotal.toFixed(2)}</td>
                    )}
                    <td className="py-3 px-3 text-center text-gray-800">S/ {physicalTotal.toFixed(2)}</td>
                    {isAdmin && (
                      <td className={`py-3 px-3 text-right ${
                        Math.abs(varianceTotal) < 0.01 ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {varianceTotal > 0 ? '+' : ''}{varianceTotal.toFixed(2)}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Referencia digital — Yape/Plin y Transferencia NO van al cierre físico */}
            {(digitalInfo.yapePlin > 0 || digitalInfo.transferencia > 0) && (
              <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 space-y-1">
                <p className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-2">
                  📱 Pagos Digitales (referencia — no entran al conteo físico)
                </p>
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

            {/* Campos del formato antiguo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="font-semibold">Cajero Responsable *</Label>
                <Input value={cashierName} onChange={(e) => setCashierName(e.target.value)} placeholder="Nombre completo" />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold">DNI</Label>
                <Input value={cashierDni} onChange={(e) => setCashierDni(e.target.value)} placeholder="DNI del cajero" maxLength={11} />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold">SOBRES (Sobrante S/)</Label>
                <Input type="number" step="0.01" min="0" value={declaredOverage} onChange={(e) => setDeclaredOverage(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold">MONTO/REVESA S/ (Faltante)</Label>
                <Input type="number" step="0.01" min="0" value={declaredDeficit} onChange={(e) => setDeclaredDeficit(e.target.value)} />
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-1.5">
              <Label className="font-semibold">Notas de Cierre (opcional)</Label>
              <Input value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} placeholder="Observaciones del cierre..." />
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
          </div>
        )}

        <DialogFooter className="mt-6 flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <Button
            onClick={handleClose}
            disabled={saving || loading}
            className="bg-slate-800 hover:bg-slate-900 h-12 text-base"
          >
            {saving
              ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Cerrando...</>
              : <><Lock className="h-5 w-5 mr-2" /> Confirmar y Cerrar Caja Definitivamente</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
