import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CreditCard, Check, Clock, Receipt, XCircle, Send, Wallet, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RechargeModal } from './RechargeModal';

interface PendingTransaction {
  id: string;
  student_id: string;
  student_name: string;
  amount: number;
  description: string;
  created_at: string;
  ticket_code?: string;
  metadata?: any;
}

interface VoucherStatus {
  transaction_id: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  created_at?: string;
}

interface StudentDebt {
  student_id: string;
  student_name: string;
  student_photo: string | null;
  student_balance: number;
  total_debt: number;
  pending_transactions: PendingTransaction[];
}

interface PaymentsTabProps {
  userId: string;
}

export const PaymentsTab = ({ userId }: PaymentsTabProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<StudentDebt[]>([]);
  const [voucherStatuses, setVoucherStatuses] = useState<Map<string, VoucherStatus>>(new Map());

  // ── Estado para el modal de pago ──
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<StudentDebt | null>(null);

  // ── Estado para detectar si hay voucher pendiente de tipo debt_payment por estudiante ──
  const [pendingDebtVoucherStudents, setPendingDebtVoucherStudents] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchDebts();
  }, [userId]);

  const fetchDebts = async () => {
    try {
      setLoading(true);

      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, full_name, photo_url, free_account, school_id, balance')
        .eq('parent_id', userId)
        .eq('is_active', true);

      if (studentsError) throw studentsError;

      if (!students || students.length === 0) {
        setDebts([]);
        return;
      }

      const debtsData: StudentDebt[] = [];

      for (const student of students) {
        // ✅ Sin delay — se muestra en tiempo real
        const { data: transactions, error: transError } = await supabase
          .from('transactions')
          .select('*')
          .eq('student_id', student.id)
          .eq('type', 'purchase')
          .eq('payment_status', 'pending')
          .order('created_at', { ascending: false });

        if (transError) throw transError;

        if (transactions && transactions.length > 0) {
          const totalDebt = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

          debtsData.push({
            student_id: student.id,
            student_name: student.full_name,
            student_photo: student.photo_url,
            student_balance: student.balance || 0,
            total_debt: totalDebt,
            pending_transactions: transactions.map(t => ({
              id: t.id,
              student_id: t.student_id,
              student_name: student.full_name,
              amount: Math.abs(t.amount),
              description: t.description,
              created_at: t.created_at,
              ticket_code: t.ticket_code,
              metadata: t.metadata,
            })),
          });
        }
      }

      setDebts(debtsData);

      // ── Obtener estados de vouchers enviados por este padre ──
      if (debtsData.length > 0) {
        const studentIds = debtsData.map(d => d.student_id);

        // Buscar vouchers pendientes o rechazados (lunch_payment y debt_payment)
        const { data: rechargeRequests } = await supabase
          .from('recharge_requests')
          .select('id, student_id, status, rejection_reason, created_at, lunch_order_ids, request_type, paid_transaction_ids')
          .eq('parent_id', userId)
          .in('request_type', ['lunch_payment', 'debt_payment'])
          .in('student_id', studentIds)
          .in('status', ['pending', 'rejected'])
          .order('created_at', { ascending: false });

        if (rechargeRequests && rechargeRequests.length > 0) {
          const statusMap = new Map<string, VoucherStatus>();
          const pendingDebtStudents = new Set<string>();

          // Para debt_payment, los paid_transaction_ids nos dan mapeo directo
          rechargeRequests.forEach(req => {
            // Solo bloquear el botón si hay un debt_payment pendiente (no lunch_payment)
            if (req.status === 'pending' && req.request_type === 'debt_payment') {
              pendingDebtStudents.add(req.student_id);
            }

            // Mapear paid_transaction_ids directamente
            if (req.paid_transaction_ids) {
              req.paid_transaction_ids.forEach((txId: string) => {
                const existing = statusMap.get(txId);
                if (!existing || new Date(req.created_at) > new Date(existing.created_at || '')) {
                  statusMap.set(txId, {
                    transaction_id: txId,
                    status: req.status as any,
                    rejection_reason: req.rejection_reason || undefined,
                    created_at: req.created_at,
                  });
                }
              });
            }

            // También mapear por lunch_order_ids (para lunch payments)
            if (req.lunch_order_ids) {
              // Necesitamos mapear lunch_order_id -> transaction_id
              // Lo haremos después con las transacciones que tenemos
              const allTx = debtsData.flatMap(d => d.pending_transactions);
              req.lunch_order_ids.forEach((orderId: string) => {
                const matchingTx = allTx.find(tx => tx.metadata?.lunch_order_id === orderId);
                if (matchingTx) {
                  const existing = statusMap.get(matchingTx.id);
                  if (!existing || new Date(req.created_at) > new Date(existing.created_at || '')) {
                    statusMap.set(matchingTx.id, {
                      transaction_id: matchingTx.id,
                      status: req.status as any,
                      rejection_reason: req.rejection_reason || undefined,
                      created_at: req.created_at,
                    });
                  }
                }
              });
            }
          });

          setVoucherStatuses(statusMap);
          setPendingDebtVoucherStudents(pendingDebtStudents);
        }
      }
    } catch (error: any) {
      console.error('Error fetching debts:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las deudas pendientes',
      });
    } finally {
      setLoading(false);
    }
  };

  const totalDebt = debts.reduce((sum, d) => sum + d.total_debt, 0);

  /**
   * Abre el modal de pago para un estudiante
   */
  const handlePayDebt = (debt: StudentDebt) => {
    setSelectedDebt(debt);
    setShowPaymentModal(true);
  };

  /**
   * Construye los datos para el modal de pago
   */
  const getPaymentData = (debt: StudentDebt) => {
    // Recoger lunch_order_ids de transacciones con metadata
    const lunchOrderIds: string[] = [];
    const transactionIds: string[] = [];

    debt.pending_transactions.forEach(tx => {
      transactionIds.push(tx.id);
      if (tx.metadata?.lunch_order_id) {
        lunchOrderIds.push(tx.metadata.lunch_order_id);
      }
    });

    // Construir descripción
    const count = debt.pending_transactions.length;
    const description = `Pago de deuda: ${count} compra(s) pendiente(s) — ${debt.student_name}`;

    return { lunchOrderIds, transactionIds, description };
  };

  /**
   * Renderiza un badge de estado del voucher para la transacción
   */
  const renderVoucherStatus = (transaction: PendingTransaction) => {
    const vStatus = voucherStatuses.get(transaction.id);
    const wasRejected = transaction.metadata?.last_payment_rejected;

    if (vStatus?.status === 'pending') {
      return (
        <div className="mt-1.5 bg-blue-50 border border-blue-200 rounded px-2 py-1">
          <div className="flex items-center gap-1.5 text-blue-700">
            <Send className="h-3 w-3" />
            <span className="text-[10px] sm:text-xs font-semibold">Comprobante enviado — en revisión</span>
          </div>
        </div>
      );
    }

    if (vStatus?.status === 'rejected' || wasRejected) {
      const reason = vStatus?.rejection_reason || transaction.metadata?.rejection_reason || 'Comprobante no válido';
      return (
        <div className="mt-1.5 bg-red-50 border border-red-200 rounded px-2 py-1">
          <div className="flex items-center gap-1.5 text-red-700">
            <XCircle className="h-3 w-3" />
            <span className="text-[10px] sm:text-xs font-semibold">Pago rechazado</span>
          </div>
          <p className="text-[10px] text-red-600 mt-0.5 ml-[18px]">
            Motivo: {reason}. Puedes enviar un nuevo comprobante.
          </p>
        </div>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Cargando deudas...</p>
        </div>
      </div>
    );
  }

  if (debts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Check className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">¡Todo al día!</h3>
            <p className="text-gray-500">
              No tienes deudas pendientes con el kiosco escolar.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 💳 AVISO: Cómo pagar */}
      <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-blue-100 rounded-full flex-shrink-0">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-800">💳 ¿Cómo pagar?</p>
              <p className="text-xs text-blue-600 mt-1">
                Puedes pagar tus deudas <strong>presencialmente en caja</strong> o enviando un <strong>comprobante de pago</strong> (Yape, Plin, transferencia) desde aquí.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumen de Deuda Total */}
      <Card className="border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardContent className="pt-6 pb-5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-amber-700 font-semibold uppercase">Deuda Total Pendiente</p>
              <p className="text-4xl font-black text-amber-900">S/ {(totalDebt || 0).toFixed(2)}</p>
              <p className="text-xs text-amber-600 mt-1">
                {debts.reduce((sum, d) => sum + d.pending_transactions.length, 0)} compra(s) pendientes
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deudas por Estudiante */}
      {debts.map((debt) => {
        const hasPendingVoucher = pendingDebtVoucherStudents.has(debt.student_id);

        return (
          <Card key={debt.student_id} className="border-2">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 pb-3">
              <div className="flex items-center gap-4">
                {debt.student_photo && (
                  <img
                    src={debt.student_photo}
                    alt={debt.student_name}
                    className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-lg"
                  />
                )}
                <div className="flex-1">
                  <CardTitle className="text-lg">{debt.student_name}</CardTitle>
                  <CardDescription className="text-sm">
                    Deuda: <span className="font-bold text-red-600">S/ {(debt.total_debt || 0).toFixed(2)}</span>
                    {' • '}
                    {debt.pending_transactions.length} compra(s)
                  </CardDescription>
                </div>
              </div>

              {/* ── Botón de Pagar ── */}
              <div className="mt-3">
                {hasPendingVoucher ? (
                  <div className="w-full bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                    <Send className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="text-xs font-semibold text-blue-800">Comprobante en revisión</p>
                      <p className="text-[10px] text-blue-600">Un administrador verificará tu pago pronto.</p>
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={() => handlePayDebt(debt)}
                    className="w-full h-11 bg-green-600 hover:bg-green-700 font-semibold gap-2 text-sm shadow-md"
                  >
                    <Banknote className="h-5 w-5" />
                    Pagar deuda — S/ {debt.total_debt.toFixed(2)}
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="pt-3">
              <div className="space-y-2">
                {debt.pending_transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="p-3 rounded-lg border bg-white border-gray-200"
                  >
                    <div className="flex items-center gap-3">
                      <Receipt className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs sm:text-sm truncate">{transaction.description}</p>
                        <p className="text-[10px] sm:text-xs text-gray-500">
                          {format(new Date(transaction.created_at), "d 'de' MMMM, yyyy • HH:mm", { locale: es })}
                          {transaction.ticket_code && ` • Ticket: ${transaction.ticket_code}`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm sm:text-base font-bold text-red-600">S/ {(transaction.amount || 0).toFixed(2)}</p>
                        <Badge variant="outline" className="text-[9px] sm:text-[10px] border-amber-300 text-amber-700">
                          <Clock className="h-2.5 w-2.5 mr-0.5" />
                          Pendiente
                        </Badge>
                      </div>
                    </div>
                    {renderVoucherStatus(transaction)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* ── Modal de Pago ── */}
      {selectedDebt && (() => {
        const payData = getPaymentData(selectedDebt);
        return (
          <RechargeModal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setSelectedDebt(null);
              // Refrescar datos después de cerrar
              fetchDebts();
            }}
            studentName={selectedDebt.student_name}
            studentId={selectedDebt.student_id}
            currentBalance={selectedDebt.student_balance}
            accountType="free_account"
            onRecharge={async () => {}}
            suggestedAmount={selectedDebt.total_debt}
            requestType="debt_payment"
            requestDescription={payData.description}
            lunchOrderIds={payData.lunchOrderIds.length > 0 ? payData.lunchOrderIds : undefined}
            paidTransactionIds={payData.transactionIds}
          />
        );
      })()}
    </div>
  );
};

