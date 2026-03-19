import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CreditCard, Check, Clock, Receipt, XCircle, Send, Banknote, CheckSquare, Square, UtensilsCrossed, Users } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSync } from '@/stores/billingSync';
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
  school_id: string;
  total_debt: number;
  pending_transactions: PendingTransaction[];
}

interface PaymentsTabProps {
  userId: string;
  isActive?: boolean; // 🔄 Para refrescar cuando la pestaña se activa
}

export const PaymentsTab = ({ userId, isActive }: PaymentsTabProps) => {
  const { toast } = useToast();
  const voucherSyncTs = useDebouncedSync('vouchers', 800);
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<StudentDebt[]>([]);
  const [voucherStatuses, setVoucherStatuses] = useState<Map<string, VoucherStatus>>(new Map());

  // ── Estado para el modal de pago ──
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<StudentDebt | null>(null);

  // ── Modo pago combinado (todos los hijos juntos) ──
  const [combinedMode, setCombinedMode] = useState(false);

  // ── Estado para detectar si hay voucher pendiente de tipo debt_payment por estudiante ──
  const [pendingDebtVoucherStudents, setPendingDebtVoucherStudents] = useState<Set<string>>(new Set());

  // ── Selección individual de transacciones por estudiante ──
  // Mapa: student_id → Set de transaction IDs seleccionados
  const [selectedTxByStudent, setSelectedTxByStudent] = useState<Map<string, Set<string>>>(new Map());

  const getSelectedTx = (studentId: string) =>
    selectedTxByStudent.get(studentId) ?? new Set<string>();

  const toggleTransaction = (studentId: string, txId: string, allTxIds: string[]) => {
    setSelectedTxByStudent(prev => {
      const next = new Map(prev);
      const current = new Set(next.get(studentId) ?? allTxIds); // Por defecto, todo seleccionado
      if (current.has(txId)) {
        current.delete(txId);
      } else {
        current.add(txId);
      }
      next.set(studentId, current);
      return next;
    });
  };

  const toggleAllTx = (studentId: string, allTxIds: string[]) => {
    setSelectedTxByStudent(prev => {
      const next = new Map(prev);
      const current = next.get(studentId) ?? new Set(allTxIds);
      if (current.size === allTxIds.length) {
        next.set(studentId, new Set()); // Deseleccionar todo
      } else {
        next.set(studentId, new Set(allTxIds)); // Seleccionar todo
      }
      return next;
    });
  };

  useEffect(() => {
    fetchDebts();
  }, [userId]);

  useEffect(() => {
    if (isActive) {
      fetchDebts();
    }
  }, [isActive]);

  // Auto-refresh cuando admin aprueba/rechaza voucher (Realtime desde otra PC)
  useEffect(() => {
    if (voucherSyncTs > 0) {
      fetchDebts();
      toast({ title: '🔄 Carrito actualizado', description: 'Un administrador procesó tu comprobante.', duration: 4000 });
    }
  }, [voucherSyncTs]);

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
          .in('payment_status', ['pending', 'partial'])
          .eq('is_deleted', false)
          .order('created_at', { ascending: false });

        if (transError) throw transError;

        if (transactions && transactions.length > 0) {
          const totalDebt = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

          debtsData.push({
            student_id: student.id,
            student_name: student.full_name,
            student_photo: student.photo_url,
            student_balance: student.balance || 0,
            school_id: student.school_id,
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

          // ── También marcar estudiantes cuyas transacciones YA están cubiertas por un voucher pendiente ──
          debtsData.forEach(debt => {
            if (debt.pending_transactions.length > 0) {
              const allCovered = debt.pending_transactions.every(
                tx => statusMap.get(tx.id)?.status === 'pending'
              );
              if (allCovered) pendingDebtStudents.add(debt.student_id);
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

  // ── Detectar si las deudas pertenecen a sedes distintas ──
  const uniqueSchoolIds = [...new Set(debts.map(d => d.school_id).filter(Boolean))];
  const isMultiSchool = uniqueSchoolIds.length > 1;

  // ── Datos para pago combinado ──
  // Solo bloqueamos el pago combinado si TODAS las transacciones de TODOS los hijos
  // ya están cubiertas por vouchers pendientes (no basta con que alguna lo esté)
  const allCombinedTransactions = debts.flatMap(d => d.pending_transactions);
  const combinedCoveredCount = allCombinedTransactions.filter(
    tx => voucherStatuses.get(tx.id)?.status === 'pending'
  ).length;
  const hasCombinedPendingVoucher = allCombinedTransactions.length > 0 &&
    combinedCoveredCount === allCombinedTransactions.length;

  const buildCombinedPaymentData = () => {
    const allTransactionIds: string[] = [];
    const allLunchOrderIds: string[] = [];
    const allBreakdownItems: { description: string; amount: number }[] = [];
    const allStudentIds: string[] = [];
    const allStudentNames: string[] = [];

    for (const debt of debts) {
      allStudentIds.push(debt.student_id);
      allStudentNames.push(debt.student_name);

      for (const tx of debt.pending_transactions) {
        allTransactionIds.push(tx.id);
        if (tx.metadata?.lunch_order_id) {
          allLunchOrderIds.push(tx.metadata.lunch_order_id);
        }
        allBreakdownItems.push({
          description: `${debt.student_name}: ${tx.description}`,
          amount: tx.amount,
        });
      }
    }

    const combinedNames = allStudentNames.length <= 2
      ? allStudentNames.join(' y ')
      : allStudentNames.slice(0, -1).join(', ') + ' y ' + allStudentNames[allStudentNames.length - 1];

    return {
      allTransactionIds,
      allLunchOrderIds,
      allBreakdownItems,
      allStudentIds,
      combinedNames,
      totalAmount: totalDebt,
    };
  };

  const handleCombinedPay = () => {
    if (isMultiSchool) {
      toast({
        title: '⚠️ Sedes distintas',
        description: 'No puedes combinar pagos de sedes distintas. Por favor, selecciona y paga las deudas de cada sede por separado, ya que tienen números de cuenta diferentes.',
        variant: 'destructive',
        duration: 7000,
      });
      return;
    }
    setCombinedMode(true);
    setSelectedDebt(null);
    setShowPaymentModal(true);
  };

  /**
   * Abre el modal de pago para un estudiante (con las transacciones seleccionadas)
   */
  const handlePayDebt = (debt: StudentDebt) => {
    const allIds = debt.pending_transactions.map(t => t.id);
    // Si no hay selección explícita, inicializar con todo seleccionado
    if (!selectedTxByStudent.has(debt.student_id)) {
      setSelectedTxByStudent(prev => new Map(prev).set(debt.student_id, new Set(allIds)));
    }
    setSelectedDebt(debt);
    setShowPaymentModal(true);
  };

  /**
   * Construye los datos para el modal de pago (solo las transacciones seleccionadas)
   */
  const getPaymentData = (debt: StudentDebt) => {
    const selectedIds = getSelectedTx(debt.student_id);
    const allIds = debt.pending_transactions.map(t => t.id);
    const effectiveIds = selectedIds.size > 0 ? selectedIds : new Set(allIds);

    const selectedTxList = debt.pending_transactions.filter(tx => effectiveIds.has(tx.id));
    const lunchOrderIds: string[] = [];
    const transactionIds: string[] = [];

    selectedTxList.forEach(tx => {
      transactionIds.push(tx.id);
      if (tx.metadata?.lunch_order_id) {
        lunchOrderIds.push(tx.metadata.lunch_order_id);
      }
    });

    const totalSelected = selectedTxList.reduce((sum, tx) => sum + tx.amount, 0);
    const count = selectedTxList.length;
    const description = `Pago de deuda: ${count} compra(s) — ${debt.student_name}`;

    return { lunchOrderIds, transactionIds, description, totalSelected, selectedTxList };
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
            <XCircle className="h-3 w-3 flex-shrink-0" />
            <span className="text-[10px] sm:text-xs font-semibold">Pago rechazado:</span>
            <span className="text-[10px] sm:text-xs text-red-600">{reason}</span>
          </div>
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
          <p className="text-gray-500">Cargando carrito...</p>
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
            <h3 className="text-xl font-bold text-gray-900 mb-2">Carrito vacío</h3>
            <p className="text-gray-500">
              No tienes pagos pendientes. Aquí aparecerán tus almuerzos y consumos por pagar.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 💳 AVISO: Cómo pagar */}
      <Card id="cart-how-to-pay-card" className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50">
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

      {/* Resumen del Carrito */}
      <Card id="cart-total-pending-card" className="border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardContent className="pt-6 pb-5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-amber-700 font-semibold uppercase">Total Pendiente</p>
              <p className="text-4xl font-black text-amber-900">S/ {(totalDebt || 0).toFixed(2)}</p>
              <p className="text-xs text-amber-600 mt-1">
                {debts.reduce((sum, d) => sum + d.pending_transactions.length, 0)} item(s) en el carrito
                {debts.length >= 2 && ` de ${debts.length} alumnos`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 🧾 Pagar Todo Junto (solo si hay 2+ hijos con deuda) */}
      {debts.length >= 2 && (
        <Card className="border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2.5 bg-emerald-100 rounded-full flex-shrink-0">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-800">🧾 Pagar todo junto</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  Envía <strong>un solo comprobante</strong> que cubra las deudas de todos tus hijos.
                  El administrador verá un único voucher.
                </p>
              </div>
            </div>
            {isMultiSchool ? (
              <div className="w-full bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Pago conjunto no disponible</p>
                  <p className="text-[10px] text-amber-700 mt-0.5">Tus hijos están en sedes distintas con cuentas bancarias diferentes. Paga cada sede por separado usando el botón individual de cada alumno.</p>
                </div>
              </div>
            ) : hasCombinedPendingVoucher ? (
              <div className="w-full bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                <Send className="h-4 w-4 text-blue-600" />
                <div>
                  <p className="text-xs font-semibold text-blue-800">Comprobante en revisión</p>
                  <p className="text-[10px] text-blue-600">Todas las deudas ya tienen un pago pendiente de aprobación.</p>
                </div>
              </div>
            ) : (
              <>
                {combinedCoveredCount > 0 && (
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded px-3 py-1.5 mb-1">
                    <Send className="h-3 w-3 text-blue-500 flex-shrink-0" />
                    <p className="text-[10px] text-blue-700">
                      {combinedCoveredCount} de {allCombinedTransactions.length} compra(s) ya tienen comprobante en revisión.
                    </p>
                  </div>
                )}
                <Button
                  onClick={handleCombinedPay}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 font-bold gap-2 text-base shadow-md"
                >
                  <Receipt className="h-5 w-5" />
                  Pagar Todo Junto — S/ {(totalDebt || 0).toFixed(2)}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deudas por Estudiante */}
      {debts.map((debt) => {
        const allTxIds = debt.pending_transactions.map(t => t.id);

        // Transacciones YA cubiertas por un voucher pendiente (no se pueden volver a pagar)
        const coveredByPendingVoucher = debt.pending_transactions
          .filter(tx => voucherStatuses.get(tx.id)?.status === 'pending')
          .map(t => t.id);
        const hasSomeCovered = coveredByPendingVoucher.length > 0;
        // Transacciones que NO están cubiertas y se pueden pagar ahora
        const payableTxIds = allTxIds.filter(id => !coveredByPendingVoucher.includes(id));
        const hasPayableItems = payableTxIds.length > 0;

        // Inicializar selección: por defecto solo las pagables seleccionadas
        const selectedIds = selectedTxByStudent.has(debt.student_id)
          ? selectedTxByStudent.get(debt.student_id)!
          : new Set(payableTxIds.length > 0 ? payableTxIds : allTxIds);

        const allSelected = selectedIds.size === allTxIds.length;
        const noneSelected = selectedIds.size === 0;
        const selectedTotal = debt.pending_transactions
          .filter(tx => selectedIds.has(tx.id))
          .reduce((sum, tx) => sum + tx.amount, 0);

        return (
          <Card key={debt.student_id} id={debt.student_id === debts[0]?.student_id ? 'cart-student-debt-card' : undefined} className="border-2">
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
                    Deuda total: <span className="font-bold text-red-600">S/ {(debt.total_debt || 0).toFixed(2)}</span>
                    {' • '}
                    {debt.pending_transactions.length} compra(s)
                  </CardDescription>
                </div>
              </div>

              {/* ── Botón de Pagar ── */}
              <div className="mt-3 space-y-2">
                {hasSomeCovered && !hasPayableItems ? (
                  /* Todas las deudas ya están cubiertas por voucher pendiente */
                  <div className="w-full bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                    <Send className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="text-xs font-semibold text-blue-800">Comprobante en revisión</p>
                      <p className="text-[10px] text-blue-600">Un administrador verificará tu pago pronto.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Aviso informativo si hay algunas en revisión pero quedan pagables */}
                    {hasSomeCovered && (
                      <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                        <Send className="h-3 w-3 text-blue-500 flex-shrink-0" />
                        <p className="text-[10px] text-blue-700">
                          {coveredByPendingVoucher.length} compra(s) ya tienen comprobante en revisión. Puedes pagar las restantes.
                        </p>
                      </div>
                    )}
                    {/* Resumen de selección — solo sobre ítems pagables */}
                    <div className="flex items-center justify-between text-xs px-1">
                      <button
                        onClick={() => toggleAllTx(debt.student_id, payableTxIds.length > 0 ? payableTxIds : allTxIds)}
                        className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {allSelected
                          ? <CheckSquare className="h-4 w-4" />
                          : <Square className="h-4 w-4" />
                        }
                        {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                      </button>
                      <span className="text-gray-500">
                        {selectedIds.size} de {payableTxIds.length || allTxIds.length} seleccionadas
                      </span>
                    </div>
                    <Button
                      id="cart-pay-selected-btn"
                      onClick={() => handlePayDebt(debt)}
                      disabled={noneSelected}
                      className="w-full h-11 bg-green-600 hover:bg-green-700 font-semibold gap-2 text-sm shadow-md disabled:opacity-50"
                    >
                      <Banknote className="h-5 w-5" />
                      {noneSelected
                        ? 'Selecciona al menos 1 compra'
                        : `Pagar seleccionadas — S/ ${selectedTotal.toFixed(2)}`}
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>

            <CardContent className="pt-3">
              <div className="space-y-2">
                {debt.pending_transactions.map((transaction) => {
                  const isLunch = !!(transaction.metadata?.lunch_order_id || transaction.description?.toLowerCase().includes('almuerzo'));
                  const isSelected = selectedIds.has(transaction.id);
                  const vStatus = voucherStatuses.get(transaction.id);
                  // Esta transacción específica ya está cubierta por un voucher pendiente
                  const isCoveredByPending = coveredByPendingVoucher.includes(transaction.id);

                  return (
                    <div
                      key={transaction.id}
                      className={`p-3 rounded-lg border bg-white transition-all ${
                        isCoveredByPending
                          ? 'border-blue-200 bg-blue-50/30 opacity-70'
                          : `cursor-pointer ${isSelected ? 'border-green-400 bg-green-50/40' : 'border-gray-200'}`
                      }`}
                      onClick={() => !isCoveredByPending && toggleTransaction(debt.student_id, transaction.id, allTxIds)}
                    >
                      <div className="flex items-center gap-3">
                        {/* Checkbox — solo si no está cubierta por voucher pendiente */}
                        {!isCoveredByPending ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleTransaction(debt.student_id, transaction.id, allTxIds)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          />
                        ) : (
                          <div className="h-4 w-4 flex-shrink-0 flex items-center justify-center">
                            <Send className="h-3.5 w-3.5 text-blue-400" />
                          </div>
                        )}
                        {isLunch
                          ? <UtensilsCrossed className="h-4 w-4 text-orange-400 flex-shrink-0" />
                          : <Receipt className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs sm:text-sm truncate">{transaction.description}</p>
                          <p className="text-[10px] sm:text-xs text-gray-500">
                            {format(new Date(transaction.created_at), "d 'de' MMMM, yyyy • HH:mm", { locale: es })}
                            {transaction.ticket_code && ` • Ticket: ${transaction.ticket_code}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm sm:text-base font-bold text-red-600">S/ {(transaction.amount || 0).toFixed(2)}</p>
                          {isCoveredByPending ? (
                            <Badge variant="outline" className="text-[9px] sm:text-[10px] border-blue-300 text-blue-700">
                              <Send className="h-2.5 w-2.5 mr-0.5" />
                              En revisión
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] sm:text-[10px] border-amber-300 text-amber-700">
                              <Clock className="h-2.5 w-2.5 mr-0.5" />
                              Pendiente
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* ⚠️ Advertencia para almuerzos */}
                      {isLunch && !vStatus && (
                        <div className="mt-2 flex items-start gap-1.5 bg-orange-50 border border-orange-200 rounded px-2 py-1.5">
                          <UtensilsCrossed className="h-3.5 w-3.5 text-orange-500 mt-0.5 flex-shrink-0" />
                          <p className="text-[10px] text-orange-700 font-medium leading-tight">
                            ⚠️ Este almuerzo <strong>no se procesará</strong> hasta que pagues la deuda pendiente.
                          </p>
                        </div>
                      )}

                      {renderVoucherStatus(transaction)}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* ── Modal de Pago (individual) ── */}
      {!combinedMode && selectedDebt && (() => {
        const payData = getPaymentData(selectedDebt);
        return (
          <RechargeModal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setSelectedDebt(null);
              fetchDebts();
            }}
            onCancel={() => {
              setShowPaymentModal(false);
              setSelectedDebt(null);
            }}
            studentName={selectedDebt.student_name}
            studentId={selectedDebt.student_id}
            currentBalance={selectedDebt.student_balance}
            accountType="free_account"
            onRecharge={async () => {}}
            suggestedAmount={payData.totalSelected}
            requestType="debt_payment"
            requestDescription={payData.description}
            lunchOrderIds={payData.lunchOrderIds.length > 0 ? payData.lunchOrderIds : undefined}
            paidTransactionIds={payData.transactionIds}
            breakdownItems={payData.selectedTxList.map(tx => ({
              description: tx.description,
              amount: tx.amount,
            }))}
          />
        );
      })()}

      {/* ── Modal de Pago (combinado — todos los hijos juntos) ── */}
      {combinedMode && (() => {
        const combined = buildCombinedPaymentData();
        return (
          <RechargeModal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setCombinedMode(false);
              fetchDebts();
            }}
            onCancel={() => {
              setShowPaymentModal(false);
              setCombinedMode(false);
            }}
            studentName={combined.combinedNames}
            studentId={debts[0]?.student_id || ''}
            currentBalance={0}
            accountType="free_account"
            onRecharge={async () => {}}
            suggestedAmount={combined.totalAmount}
            requestType="debt_payment"
            requestDescription={`Pago combinado: ${combined.combinedNames} — ${combined.allTransactionIds.length} compra(s)`}
            lunchOrderIds={combined.allLunchOrderIds.length > 0 ? combined.allLunchOrderIds : undefined}
            paidTransactionIds={combined.allTransactionIds}
            breakdownItems={combined.allBreakdownItems}
            combinedStudentIds={combined.allStudentIds}
          />
        );
      })()}
    </div>
  );
};

