import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, CheckCircle2, Clock, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession, TreasuryTransfer } from '@/types/cashRegisterV2';

interface Props {
  open: boolean;
  onClose: () => void;
  session: CashSession;
  schoolId: string;
}

export default function TreasuryTransferFlow({ open, onClose, session, schoolId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transfers, setTransfers] = useState<TreasuryTransfer[]>([]);

  // Crear nueva transferencia
  const [showCreate, setShowCreate] = useState(false);
  const [amountCash, setAmountCash] = useState('0');
  const [senderName, setSenderName] = useState('');
  const [notes, setNotes] = useState('');

  // Recibir transferencia
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const receiverCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasReceiverSignature, setHasReceiverSignature] = useState(false);

  useEffect(() => {
    if (open) loadTransfers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadTransfers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('treasury_transfers')
        .select('*')
        .eq('cash_session_id', session.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTransfers(data || []);
    } catch (err) {
      console.error('[TreasuryTransferFlow] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!senderName.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido', description: 'Ingresa el nombre del cajero que entrega.' });
      return;
    }
    const cash = parseFloat(amountCash) || 0;
    if (cash <= 0) {
      toast({ variant: 'destructive', title: 'Monto requerido', description: 'Ingresa al menos un monto a transferir.' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('treasury_transfers').insert({
        cash_session_id: session.id,
        school_id: schoolId,
        amount_cash: cash,
        amount_total: cash,
        status: 'in_transit',
        sender_id: user.id,
        sender_name: senderName.trim(),
        notes: notes.trim() || null,
      });

      if (error) throw error;

      toast({ title: '✅ Transferencia creada', description: `S/ ${cash.toFixed(2)} en tránsito a tesorería.` });
      setShowCreate(false);
      setAmountCash('0');
      setSenderName('');
      setNotes('');
      loadTransfers();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleReceive = async (transferId: string) => {
    if (!user) return;
    if (!receiverName.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido', description: 'Ingresa el nombre de quien recibe.' });
      return;
    }

    const signatureData = hasReceiverSignature && receiverCanvasRef.current
      ? receiverCanvasRef.current.toDataURL('image/png')
      : null;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('treasury_transfers')
        .update({
          status: 'received',
          receiver_id: user.id,
          receiver_name: receiverName.trim(),
          receiver_signature: signatureData,
          received_at: new Date().toISOString(),
        })
        .eq('id', transferId);

      if (error) throw error;

      toast({ title: '✅ Transferencia recibida', description: 'La cadena de custodia ha sido completada.' });
      setReceivingId(null);
      setReceiverName('');
      setHasReceiverSignature(false);
      loadTransfers();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Canvas helpers
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ctx = receiverCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    setHasReceiverSignature(true);
    const rect = receiverCanvasRef.current!.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const drawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const ctx = receiverCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    const rect = receiverCanvasRef.current!.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    created: { label: 'Creado', color: 'text-gray-700', bg: 'bg-gray-100' },
    in_transit: { label: 'En Tránsito', color: 'text-amber-700', bg: 'bg-amber-100' },
    received: { label: 'Recibido', color: 'text-green-700', bg: 'bg-green-100' },
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Send className="h-5 w-5 text-indigo-600" />
            Transferencias a Tesorería
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700">
            <Send className="h-4 w-4 mr-2" /> Nueva Transferencia
          </Button>

          {/* Lista de transferencias */}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : transfers.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No hay transferencias registradas hoy.</p>
          ) : (
            <div className="space-y-3">
              {transfers.map((t) => {
                const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.created;
                return (
                  <Card key={t.id} className="border-l-4 border-l-indigo-400">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-lg">S/ {t.amount_total.toFixed(2)}</span>
                            <Badge className={`${st.bg} ${st.color} border-0`}>{st.label}</Badge>
                          </div>
                          <p className="text-sm text-gray-600">
                            Entregado por: <span className="font-semibold">{t.sender_name}</span>
                          </p>
                          {t.receiver_name && (
                            <p className="text-sm text-gray-600">
                              Recibido por: <span className="font-semibold">{t.receiver_name}</span>
                              {t.received_at && (
                                <span className="text-xs text-gray-400 ml-1">
                                  ({format(new Date(t.received_at), 'dd/MM HH:mm', { locale: es })})
                                </span>
                              )}
                            </p>
                          )}
                          {t.notes && <p className="text-xs text-gray-500 mt-1">{t.notes}</p>}
                          <p className="text-xs text-gray-400 mt-1">
                            {format(new Date(t.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {t.status === 'in_transit' && (
                            <Button
                              size="sm"
                              onClick={() => setReceivingId(t.id)}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar Recepción
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal crear transferencia */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nueva Transferencia a Tesorería</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label className="font-semibold">💵 Efectivo a Transferir (S/)</Label>
                <Input type="number" step="0.01" min="0" value={amountCash} onChange={(e) => setAmountCash(e.target.value)} className="h-12 text-lg" />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold">Cajero que Entrega *</Label>
                <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Nombre completo" />
              </div>
              <div className="space-y-1.5">
                <Label className="font-semibold">Notas (opcional)</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones..." />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Generar Transferencia
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal recibir transferencia */}
        <Dialog open={!!receivingId} onOpenChange={() => setReceivingId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirmar Recepción en Tesorería</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label className="font-semibold">Nombre de quien Recibe *</Label>
                <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Ej: Raúl - Tesorería" />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold">Firma del Receptor</Label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-1 bg-white">
                  <canvas
                    ref={receiverCanvasRef}
                    width={400}
                    height={100}
                    className="w-full cursor-crosshair"
                    onMouseDown={startDraw}
                    onMouseMove={drawMove}
                    onMouseUp={() => setIsDrawing(false)}
                    onMouseLeave={() => setIsDrawing(false)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setReceivingId(null)}>Cancelar</Button>
              <Button onClick={() => receivingId && handleReceive(receivingId)} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Confirmar Recepción
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
