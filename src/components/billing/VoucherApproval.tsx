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
  Ticket,
  AlertTriangle,
  Search,
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
  request_type?: 'recharge' | 'lunch_payment' | 'debt_payment';
  description?: string | null;
  lunch_order_ids?: string[] | null;
  paid_transaction_ids?: string[] | null;
  // Joins
  students?: { full_name: string; balance: number };
  profiles?: { full_name: string; email: string };
  schools?: { name: string };
  // Computed
  _ticket_codes?: string[];
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
  const [searchTerm, setSearchTerm] = useState('');

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

      // ── Enriquecer con ticket_codes de las transacciones asociadas ──
      // ✅ OPTIMIZADO: en vez de 1 query por pedido, se hace 1 sola query con todos los IDs
      const enriched = (data || []) as any[];

      // --- 1. Recoger todos los lunch_order_ids de golpe ---
      const allLunchOrderIds = enriched
        .filter(r => (r.request_type === 'lunch_payment' || r.request_type === 'debt_payment') && r.lunch_order_ids?.length)
        .flatMap((r: any) => r.lunch_order_ids as string[]);

      // Mapa: lunch_order_id → ticket_code
      // ✅ JSONB: Supabase no soporta .in() con metadata->>key,
      //    así que usamos .or() con contains para batches pequeños
      const ticketByOrderId = new Map<string, string>();
      if (allLunchOrderIds.length > 0) {
        try {
          // Dividir en lotes de 30 para evitar queries muy largas
          const uniqueIds = [...new Set(allLunchOrderIds)];
          const batchSize = 30;
          for (let i = 0; i < uniqueIds.length; i += batchSize) {
            const batch = uniqueIds.slice(i, i + batchSize);
            const orFilter = batch.map(id => `metadata.cs.{"lunch_order_id":"${id}"}`).join(',');
            const { data: txRows } = await supabase
              .from('transactions')
              .select('ticket_code, metadata')
              .eq('type', 'purchase')
              .not('ticket_code', 'is', null)
              .or(orFilter);

            for (const tx of txRows || []) {
              const orderId = (tx.metadata as any)?.lunch_order_id;
              if (orderId && tx.ticket_code) ticketByOrderId.set(orderId, tx.ticket_code);
            }
          }
        } catch (e) {
          console.warn('No se pudieron obtener tickets de lunch_orders en batch:', e);
        }
      }

      // Asignar _ticket_codes usando el mapa
      for (const req of enriched) {
        if ((req.request_type === 'lunch_payment' || req.request_type === 'debt_payment') && req.lunch_order_ids?.length) {
          req._ticket_codes = (req.lunch_order_ids as string[])
            .map((id: string) => ticketByOrderId.get(id))
            .filter(Boolean) as string[];
        }
      }

      // --- 2. Recoger todos los paid_transaction_ids de golpe ---
      const allTxIds = enriched
        .filter(r => r.request_type === 'debt_payment' && r.paid_transaction_ids?.length)
        .flatMap((r: any) => r.paid_transaction_ids as string[]);

      // Mapa: tx_id → ticket_code
      const ticketByTxId = new Map<string, string>();
      if (allTxIds.length > 0) {
        try {
          const { data: txRows2 } = await supabase
            .from('transactions')
            .select('id, ticket_code')
            .not('ticket_code', 'is', null)
            .in('id', allTxIds);

          for (const tx of txRows2 || []) {
            if (tx.id && tx.ticket_code) ticketByTxId.set(tx.id, tx.ticket_code);
          }
        } catch (e) {
          console.warn('No se pudieron obtener tickets de paid_transaction_ids en batch:', e);
        }
      }

      // Completar _ticket_codes con paid_transaction_ids
      for (const req of enriched) {
        if (req.request_type === 'debt_payment' && req.paid_transaction_ids?.length) {
          const existing: string[] = req._ticket_codes || [];
          for (const txId of req.paid_transaction_ids as string[]) {
            const code = ticketByTxId.get(txId);
            if (code && !existing.includes(code)) existing.push(code);
          }
          req._ticket_codes = existing;
        }
      }

      setRequests(enriched);
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
      const isLunchPayment = req.request_type === 'lunch_payment';
      const isDebtPayment = req.request_type === 'debt_payment';

      // ── VALIDAR pedidos de almuerzo (si los hay) ──
      if ((isLunchPayment || isDebtPayment) && req.lunch_order_ids && req.lunch_order_ids.length > 0) {
        const { data: orders } = await supabase
          .from('lunch_orders')
          .select('id, status, is_cancelled')
          .in('id', req.lunch_order_ids);

        const cancelledOrders = orders?.filter(o => o.is_cancelled || o.status === 'cancelled') || [];
        if (cancelledOrders.length > 0) {
          toast({
            variant: 'destructive',
            title: '⚠️ Pedidos cancelados',
            description: `${cancelledOrders.length} pedido(s) de almuerzo fueron cancelados. Verifica antes de aprobar.`,
          });
          // No bloqueamos completamente para debt_payment que puede incluir no-lunch transactions
          if (isLunchPayment) {
            setProcessingId(null);
            return;
          }
        }
      }

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

      if (isLunchPayment || isDebtPayment) {
        // ── PAGO DE ALMUERZO / DEUDA ──
        const paymentMeta = {
          payment_approved: true,
          payment_source: isDebtPayment ? 'debt_voucher_payment' : 'lunch_voucher_payment',
          recharge_request_id: req.id,
          reference_code: req.reference_code,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          voucher_url: req.voucher_url,
        };

        // A) Manejar lunch_order_ids (si hay)
        if (req.lunch_order_ids && req.lunch_order_ids.length > 0) {
          // Obtener estado real de las órdenes para no reactivar canceladas
          const { data: currentOrders } = await supabase
            .from('lunch_orders')
            .select('id, status, is_cancelled')
            .in('id', req.lunch_order_ids);

          const activeOrderIds = (currentOrders || [])
            .filter(o => !o.is_cancelled && o.status !== 'cancelled')
            .map(o => o.id);

          for (const orderId of req.lunch_order_ids) {
            const { data: existingTx } = await supabase
              .from('transactions')
              .select('id, metadata')
              .eq('type', 'purchase')
              .contains('metadata', { lunch_order_id: orderId })
              .maybeSingle();

            if (existingTx) {
              await supabase
                .from('transactions')
                .update({
                  payment_status: 'paid',
                  payment_method: req.payment_method,
                  metadata: { ...(existingTx.metadata || {}), ...paymentMeta, last_payment_rejected: false },
                })
                .eq('id', existingTx.id);
            }
          }

          // Solo confirmar órdenes que NO están canceladas
          if (activeOrderIds.length > 0) {
            await supabase
              .from('lunch_orders')
              .update({ status: 'confirmed' })
              .in('id', activeOrderIds);
          }
        }

        // B) Manejar paid_transaction_ids (transacciones directas sin lunch_order)
        if (req.paid_transaction_ids && req.paid_transaction_ids.length > 0) {
          // Filtrar IDs que ya fueron manejados por lunch_order_ids
          const alreadyHandled = new Set<string>();
          if (req.lunch_order_ids) {
            for (const orderId of req.lunch_order_ids) {
              const { data: ltx } = await supabase
                .from('transactions')
                .select('id')
                .contains('metadata', { lunch_order_id: orderId })
                .maybeSingle();
              if (ltx) alreadyHandled.add(ltx.id);
            }
          }

          const remainingTxIds = req.paid_transaction_ids.filter(id => !alreadyHandled.has(id));

          if (remainingTxIds.length > 0) {
            // Obtener metadata existente y actualizar cada transacción
            for (const txId of remainingTxIds) {
              const { data: existingTx } = await supabase
                .from('transactions')
                .select('id, metadata')
                .eq('id', txId)
                .maybeSingle();

              if (existingTx) {
                await supabase
                  .from('transactions')
                  .update({
                    payment_status: 'paid',
                    payment_method: req.payment_method,
                    metadata: { ...(existingTx.metadata || {}), ...paymentMeta, last_payment_rejected: false },
                  })
                  .eq('id', txId);
              }
            }
          }
        }

        const label = isDebtPayment ? 'Pago de deuda aprobado' : 'Pago de almuerzo aprobado';
        toast({
          title: `✅ ${label}`,
          description: `Se confirmó el pago de S/ ${req.amount.toFixed(2)} de ${req.students?.full_name || 'el alumno'}.`,
        });
      } else {
        // ── RECARGA DE SALDO ──
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
      }

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
      // 1. Actualizar estado de la solicitud
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

      // 2. Marcar rechazo en metadata de transacciones (lunch y debt)
      const rejectionMeta = {
        last_payment_rejected: true,
        rejection_reason: reason || 'Comprobante no válido',
        rejected_at: new Date().toISOString(),
        rejected_request_id: req.id,
      };

      // A) Lunch orders
      if ((req.request_type === 'lunch_payment' || req.request_type === 'debt_payment') && req.lunch_order_ids?.length) {
        for (const orderId of req.lunch_order_ids) {
          const { data: existingTx } = await supabase
            .from('transactions')
            .select('id, metadata')
            .eq('type', 'purchase')
            .contains('metadata', { lunch_order_id: orderId })
            .maybeSingle();

          if (existingTx) {
            await supabase
              .from('transactions')
              .update({ metadata: { ...(existingTx.metadata || {}), ...rejectionMeta } })
              .eq('id', existingTx.id);
          }
        }
      }

      // B) Transacciones directas (debt_payment)
      if (req.request_type === 'debt_payment' && req.paid_transaction_ids?.length) {
        const handledByLunch = new Set<string>();
        if (req.lunch_order_ids) {
          for (const orderId of req.lunch_order_ids) {
            const { data: ltx } = await supabase
              .from('transactions').select('id').contains('metadata', { lunch_order_id: orderId }).maybeSingle();
            if (ltx) handledByLunch.add(ltx.id);
          }
        }
        const remaining = req.paid_transaction_ids.filter(id => !handledByLunch.has(id));
        for (const txId of remaining) {
          const { data: existingTx } = await supabase
            .from('transactions').select('id, metadata').eq('id', txId).maybeSingle();
          if (existingTx) {
            await supabase
              .from('transactions')
              .update({ metadata: { ...(existingTx.metadata || {}), ...rejectionMeta } })
              .eq('id', txId);
          }
        }
      }

      const isDebtOrLunch = req.request_type === 'lunch_payment' || req.request_type === 'debt_payment';
      toast({
        title: '❌ Solicitud rechazada',
        description: isDebtOrLunch
          ? `Pago rechazado. Las deudas de ${req.students?.full_name || 'el alumno'} siguen pendientes.`
          : `Se notificará al padre/madre de ${req.students?.full_name || 'el alumno'}.`,
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

  // Filtrar por búsqueda inteligente
  const filteredRequests = requests.filter((req) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase().trim();
    return (
      (req.students?.full_name || '').toLowerCase().includes(search) ||
      (req.profiles?.full_name || '').toLowerCase().includes(search) ||
      (req.profiles?.email || '').toLowerCase().includes(search) ||
      (req.schools?.name || '').toLowerCase().includes(search) ||
      (req.reference_code || '').toLowerCase().includes(search) ||
      (req.description || '').toLowerCase().includes(search) ||
      (req.notes || '').toLowerCase().includes(search) ||
      (req.amount?.toFixed(2) || '').includes(search) ||
      ((req as any)._ticket_codes || []).some((tc: string) => tc.toLowerCase().includes(search))
    );
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            Vouchers de Pago
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Revisa los comprobantes enviados por los padres (recargas, almuerzos y deudas).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRequests} className="gap-2 self-start">
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* Barra de búsqueda inteligente */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Buscar por alumno, padre, sede, monto, N° operación, ticket..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 h-11"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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
        {searchTerm && (
          <span className="px-3 py-2 text-xs text-gray-500 italic">
            {filteredRequests.length} resultado(s) para "{searchTerm}"
          </span>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">
            {searchTerm ? `Sin resultados para "${searchTerm}"` : `Sin solicitudes ${filter !== 'all' ? `"${filter}"` : ''}`}
          </p>
          <p className="text-sm">
            {searchTerm ? 'Intenta con otro término de búsqueda.' : 'Cuando los padres envíen comprobantes aparecerán aquí.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredRequests.map((req) => {
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
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Cabecera */}
                      <div className="flex items-center flex-wrap gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          req.request_type === 'lunch_payment'
                            ? 'bg-orange-100 text-orange-800 border-orange-300'
                            : req.request_type === 'debt_payment'
                            ? 'bg-red-100 text-red-800 border-red-300'
                            : 'bg-blue-100 text-blue-800 border-blue-300'
                        }`}>
                          {req.request_type === 'lunch_payment' ? '🍽️ Almuerzo' : req.request_type === 'debt_payment' ? '📋 Deuda' : '💰 Recarga'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {format(new Date(req.created_at), "d 'de' MMM · HH:mm", { locale: es })}
                        </span>
                        {req.status === 'pending' && req.expires_at && new Date(req.expires_at) < new Date() && (
                          <span className="text-xs text-red-500 font-medium">⚠️ Expirado</span>
                        )}
                      </div>

                      {/* Descripción del pago */}
                      {req.description && (
                        <p className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 mt-1">
                          📋 {req.description}
                        </p>
                      )}

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

                      {/* Tickets asociados (para pagos de almuerzo) */}
                      {(req as any)._ticket_codes && (req as any)._ticket_codes.length > 0 && (
                        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                          <Ticket className="h-4 w-4 text-indigo-500" />
                          <span className="text-xs text-indigo-600">Ticket(s):</span>
                          <span className="text-sm font-mono font-bold text-indigo-800">
                            {(req as any)._ticket_codes.join(', ')}
                          </span>
                        </div>
                      )}

                      {/* Código de referencia */}
                      {req.reference_code && (
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                          <Hash className="h-4 w-4 text-gray-400" />
                          <span className="text-xs text-gray-500">N° Operación:</span>
                          <span className="text-sm font-mono font-semibold text-gray-800">{req.reference_code}</span>
                        </div>
                      )}

                      {/* Padre */}
                      {req.profiles?.email && (
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <User className="h-3 w-3" />
                          <span>Enviado por: {req.profiles.full_name || req.profiles.email}</span>
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
                    <div className="flex sm:flex-col items-start sm:items-end gap-3 sm:shrink-0 sm:w-[140px]">
                      {/* Voucher imagen */}
                      {req.voucher_url ? (
                        <button
                          onClick={() => setSelectedImage(req.voucher_url)}
                          className="border-2 border-dashed border-blue-300 rounded-lg overflow-hidden hover:border-blue-500 transition-colors w-20 h-16 sm:w-24 sm:h-20 shrink-0"
                        >
                          <img
                            src={req.voucher_url}
                            alt="Voucher"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="border border-dashed border-gray-200 rounded-lg w-20 h-16 sm:w-24 sm:h-20 shrink-0 flex flex-col items-center justify-center text-gray-300">
                          <ImageIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                          <span className="text-[9px] sm:text-[10px]">Sin imagen</span>
                        </div>
                      )}

                      {/* Acciones (solo para pending) */}
                      {req.status === 'pending' && (
                        <div className="flex-1 sm:flex-none sm:w-full space-y-2">
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
                                className="h-9 bg-green-600 hover:bg-green-700 gap-1.5 font-semibold w-full text-xs sm:text-sm"
                                onClick={() => handleApprove(req)}
                                disabled={isProcessing}
                              >
                                {isProcessing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                                {req.request_type === 'debt_payment' ? `Aprobar pago S/ ${req.amount.toFixed(0)}` : `Aprobar +S/ ${req.amount.toFixed(0)}`}
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
                          <span>{req.request_type === 'lunch_payment' ? 'Pedido confirmado' : req.request_type === 'debt_payment' ? 'Deuda cancelada' : 'Saldo acreditado'}</span>
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
