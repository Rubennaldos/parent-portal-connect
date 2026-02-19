import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  Wallet,
  User,
  School,
  Image as ImageIcon,
  Hash,
  FileText,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface RechargeRequest {
  id: string;
  student_id: string;
  parent_id: string;
  school_id: string | null;
  amount: number;
  payment_method: string;
  reference_code: string | null;
  voucher_url: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  expires_at: string;
  // Joins
  students?: { full_name: string; balance: number };
  profiles?: { full_name: string; email: string };
  schools?: { name: string };
}

const METHOD_LABELS: Record<string, string> = {
  yape: '💜 Yape',
  plin: '💚 Plin',
  transferencia: '🏦 Transferencia',
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { label: 'Aprobado', className: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-800 border-red-300' },
};

export const VoucherApproval = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [requests, setRequests] = useState<RechargeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState<Record<string, boolean>>({});
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);

  const canViewAll = role === 'admin_general';

  useEffect(() => {
    fetchUserSchool();
  }, [user]);

  useEffect(() => {
    if (userSchoolId !== undefined) fetchRequests();
  }, [filter, userSchoolId]);

  const fetchUserSchool = async () => {
    if (!user) return;
    if (canViewAll) {
      setUserSchoolId(null);
      return;
    }
    const { data } = await supabase.from('profiles').select('school_id').eq('id', user.id).single();
    setUserSchoolId(data?.school_id || null);
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('recharge_requests')
        .select(`
          *,
          students(full_name, balance),
          profiles!recharge_requests_parent_id_fkey(full_name, email),
          schools(name)
        `)
        .order('created_at', { ascending: false });

      if (filter !== 'all') query = query.eq('status', filter);
      if (!canViewAll && userSchoolId) query = query.eq('school_id', userSchoolId);

      const { data, error } = await query;
      if (error) throw error;
      setRequests(data || []);
    } catch (err: any) {
      console.error('Error al cargar solicitudes:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (req: RechargeRequest) => {
    if (!user) return;
    setProcessingId(req.id);
    try {
      // 1. Actualizar estado de la solicitud
      const { error: reqErr } = await supabase
        .from('recharge_requests')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', req.id);

      if (reqErr) throw reqErr;

      // 2. Crear transacción de recarga en el estudiante
      const { error: txErr } = await supabase.from('transactions').insert({
        student_id: req.student_id,
        school_id: req.school_id,
        type: 'recharge',
        amount: req.amount,
        description: `Recarga aprobada — ${METHOD_LABELS[req.payment_method] || req.payment_method}${req.reference_code ? ` (Ref: ${req.reference_code})` : ''}`,
        payment_status: 'paid',
        payment_method: req.payment_method,
        metadata: {
          source: 'voucher_recharge',
          recharge_request_id: req.id,
          reference_code: req.reference_code,
          approved_by: user.id,
          voucher_url: req.voucher_url,
        },
      });

      if (txErr) throw txErr;

      // 3. Actualizar saldo del estudiante
      const newBalance = (req.students?.balance || 0) + req.amount;
      const { error: stuErr } = await supabase
        .from('students')
        .update({ balance: newBalance })
        .eq('id', req.student_id);

      if (stuErr) throw stuErr;

      toast({
        title: '✅ Recarga aprobada',
        description: `Se acreditaron S/ ${req.amount.toFixed(2)} a ${req.students?.full_name || 'el alumno'}.`,
      });

      fetchRequests();
    } catch (err: any) {
      console.error('Error al aprobar:', err);
      toast({ title: 'Error al aprobar', description: err.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (req: RechargeRequest) => {
    if (!user) return;
    const reason = rejectionReason[req.id]?.trim();
    setProcessingId(req.id);
    try {
      const { error } = await supabase
        .from('recharge_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason || 'Comprobante no válido',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', req.id);

      if (error) throw error;

      toast({
        title: '❌ Solicitud rechazada',
        description: `Se notificará al padre/madre de ${req.students?.full_name || 'el alumno'}.`,
        variant: 'destructive',
      });

      setShowRejectInput((prev) => ({ ...prev, [req.id]: false }));
      fetchRequests();
    } catch (err: any) {
      toast({ title: 'Error al rechazar', description: err.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            Aprobación de Recargas
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Revisa los comprobantes enviados por los padres y aprueba las recargas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRequests} className="gap-2 self-start">
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'pending', label: 'Pendientes', color: 'amber' },
          { key: 'approved', label: 'Aprobados', color: 'green' },
          { key: 'rejected', label: 'Rechazados', color: 'red' },
          { key: 'all', label: 'Todos', color: 'gray' },
        ] as const).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all
              ${filter === key
                ? `bg-${color}-100 text-${color}-800 border-${color}-300 shadow-sm`
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
          >
            {label}
            {key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">Sin solicitudes {filter !== 'all' ? `"${filter}"` : ''}</p>
          <p className="text-sm">Cuando los padres envíen comprobantes aparecerán aquí.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((req) => {
            const statusInfo = STATUS_BADGES[req.status];
            const isProcessing = processingId === req.id;

            return (
              <Card key={req.id} className={`border-l-4 ${
                req.status === 'pending' ? 'border-l-amber-400' :
                req.status === 'approved' ? 'border-l-green-400' : 'border-l-red-400'
              }`}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    {/* Info principal */}
                    <div className="flex-1 space-y-2">
                      {/* Cabecera */}
                      <div className="flex items-center flex-wrap gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {format(new Date(req.created_at), "d 'de' MMM · HH:mm", { locale: es })}
                        </span>
                        {req.status === 'pending' && new Date(req.expires_at) < new Date() && (
                          <span className="text-xs text-red-500 font-medium">⚠️ Expirado</span>
                        )}
                      </div>

                      {/* Datos principales */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                        <div className="flex items-start gap-1.5">
                          <User className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Alumno</p>
                            <p className="text-sm font-semibold text-gray-800">{req.students?.full_name || '—'}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <Wallet className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Monto</p>
                            <p className="text-lg font-bold text-blue-700">S/ {req.amount.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <FileText className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Método</p>
                            <p className="text-sm font-medium">{METHOD_LABELS[req.payment_method] || req.payment_method}</p>
                          </div>
                        </div>
                        {req.schools?.name && (
                          <div className="flex items-start gap-1.5">
                            <School className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400">Sede</p>
                              <p className="text-sm font-medium text-gray-700">{req.schools.name}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Código de referencia */}
                      {req.reference_code && (
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                          <Hash className="h-4 w-4 text-gray-400" />
                          <span className="text-xs text-gray-500">N° Operación:</span>
                          <span className="text-sm font-mono font-semibold text-gray-800">{req.reference_code}</span>
                        </div>
                      )}

                      {/* Nota */}
                      {req.notes && (
                        <p className="text-xs text-gray-500 italic bg-gray-50 rounded px-2 py-1">
                          💬 {req.notes}
                        </p>
                      )}

                      {/* Razón de rechazo */}
                      {req.status === 'rejected' && req.rejection_reason && (
                        <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700">
                          <strong>Motivo de rechazo:</strong> {req.rejection_reason}
                        </div>
                      )}
                    </div>

                    {/* Columna derecha: imagen + acciones */}
                    <div className="flex flex-col items-end gap-3 min-w-[140px]">
                      {/* Voucher imagen */}
                      {req.voucher_url ? (
                        <button
                          onClick={() => setSelectedImage(req.voucher_url)}
                          className="border-2 border-dashed border-blue-300 rounded-lg overflow-hidden hover:border-blue-500 transition-colors w-24 h-20"
                        >
                          <img
                            src={req.voucher_url}
                            alt="Voucher"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="border border-dashed border-gray-200 rounded-lg w-24 h-20 flex flex-col items-center justify-center text-gray-300">
                          <ImageIcon className="h-5 w-5" />
                          <span className="text-[10px]">Sin imagen</span>
                        </div>
                      )}

                      {/* Acciones (solo para pending) */}
                      {req.status === 'pending' && (
                        <div className="w-full space-y-2">
                          {showRejectInput[req.id] ? (
                            <div className="space-y-1">
                              <Input
                                placeholder="Motivo del rechazo..."
                                value={rejectionReason[req.id] || ''}
                                onChange={(e) =>
                                  setRejectionReason((prev) => ({ ...prev, [req.id]: e.target.value }))
                                }
                                className="text-xs h-8"
                              />
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1 h-7 text-xs gap-1"
                                  onClick={() => handleReject(req)}
                                  disabled={isProcessing}
                                >
                                  {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                  Rechazar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-2"
                                  onClick={() => setShowRejectInput((prev) => ({ ...prev, [req.id]: false }))}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <Button
                                size="sm"
                                className="h-9 bg-green-600 hover:bg-green-700 gap-1.5 font-semibold w-full"
                                onClick={() => handleApprove(req)}
                                disabled={isProcessing}
                              >
                                {isProcessing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                                Aprobar +S/ {req.amount.toFixed(0)}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1 w-full"
                                onClick={() => setShowRejectInput((prev) => ({ ...prev, [req.id]: true }))}
                                disabled={isProcessing}
                              >
                                <XCircle className="h-3 w-3" />
                                Rechazar
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {req.status === 'approved' && (
                        <div className="flex items-center gap-1 text-green-600 text-xs">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Saldo acreditado</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal imagen ampliada */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-lg w-full">
            <button
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
              onClick={() => setSelectedImage(null)}
            >
              <X className="h-6 w-6" />
            </button>
            <img src={selectedImage} alt="Comprobante" className="w-full rounded-xl shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
};
