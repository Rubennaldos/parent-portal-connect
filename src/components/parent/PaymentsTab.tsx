import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CreditCard, Check, Clock, Receipt, XCircle, Send, Banknote, CheckSquare, Square, UtensilsCrossed, Users, FileText, ChevronDown, ChevronUp, Info, Wallet, ShoppingBag } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSync } from '@/stores/billingSync';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RechargeModal } from './RechargeModal';
import { PosConsumptionModal } from './PosConsumptionModal';
import { InvoiceClientModal, type InvoiceClientData, type InvoiceType } from '@/components/billing/InvoiceClientModal';

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
  wallet_balance: number;
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

  // ── Comprobante (Boleta/Factura) ──
  const [invoiceType, setInvoiceType] = useState<InvoiceType | null>(null);
  const [invoiceClientData, setInvoiceClientData] = useState<InvoiceClientData | null>(null);
  const [showInvoiceSelector, setShowInvoiceSelector] = useState(false);
  const [showInvoiceClientModal, setShowInvoiceClientModal] = useState(false);
  // Monto del pago en curso — necesario para la validación SUNAT de S/ 700
  const [pendingInvoiceTotal, setPendingInvoiceTotal] = useState<number>(0);

  // ── Estado para detectar si hay voucher pendiente de tipo debt_payment por estudiante ──
  const [pendingDebtVoucherStudents, setPendingDebtVoucherStudents] = useState<Set<string>>(new Set());

  // ── Billetera interna: toggle "usar saldo a favor" por alumno ──────────────
  // Map: student_id → true/false (si el padre quiere usar el saldo disponible)
  const [useWalletByStudent, setUseWalletByStudent] = useState<Map<string, boolean>>(new Map());
  const getUseWallet = (studentId: string) => useWalletByStudent.get(studentId) ?? false;
  const toggleWallet = (studentId: string) =>
    setUseWalletByStudent(prev => new Map(prev).set(studentId, !prev.get(studentId)));

  // ── UI: acordeón por hijo + info hub ──
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [infoHubOpen, setInfoHubOpen] = useState(false);

  // ── Modal de detalle de consumos POS ──
  const [posDetailStudent, setPosDetailStudent] = useState<{ id: string; name: string; debt: number } | null>(null);

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
        .select('id, full_name, photo_url, free_account, school_id, balance, wallet_balance')
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

        const mappedTransactions: PendingTransaction[] = (transactions || []).map(t => ({
          id: t.id,
          student_id: t.student_id,
          student_name: student.full_name,
          amount: Math.abs(t.amount),
          description: t.description,
          created_at: t.created_at,
          ticket_code: t.ticket_code,
          metadata: t.metadata,
        }));

        // Inyectar deuda de kiosco SOLO si el balance es negativo Y no existen
        // transacciones pendientes de cafetería en la BD.
        // Si ya hay transacciones "Compra POS (Cuenta Libre)" con payment_status='pending',
        // esas transacciones YA representan la misma deuda que el balance negativo.
        // Añadir el item sintético encima causaría doble conteo.
        const hasPendingCafeTransactions = mappedTransactions.some(
          t => !(t.metadata as any)?.lunch_order_id
        );
        const kioskDebt = student.balance < 0 && !hasPendingCafeTransactions
          ? Math.abs(student.balance)
          : 0;
        if (kioskDebt > 0) {
          mappedTransactions.unshift({
            id: `__kiosk_balance__${student.id}`,
            student_id: student.id,
            student_name: student.full_name,
            amount: kioskDebt,
            description: 'Deuda de Cafetería / Kiosco',
            created_at: new Date().toISOString(),
            ticket_code: undefined,
            metadata: { is_kiosk_balance_debt: true },
          });
        }

        if (mappedTransactions.length > 0) {
          const totalDebt = mappedTransactions.reduce((sum, t) => sum + t.amount, 0);
          debtsData.push({
            student_id: student.id,
            student_name: student.full_name,
            student_photo: student.photo_url,
            student_balance: student.balance || 0,
            wallet_balance: student.wallet_balance || 0,
            school_id: student.school_id,
            total_debt: totalDebt,
            pending_transactions: mappedTransactions,
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

  // ── REGLA DE COBRANZAS: excluir "en revisión" del total a pagar ──
  // Solo se suman deudas con estado pending (sin voucher) o rejected (voucher rechazado).
  // Las transacciones cubiertas por un voucher pendiente se muestran como "en revisión" — no se cobran dos veces.
  const totalPayable = debts.reduce((sum, d) => {
    return sum + d.pending_transactions
      .filter(tx => voucherStatuses.get(tx.id)?.status !== 'pending')
      .reduce((s, tx) => s + tx.amount, 0);
  }, 0);
  const totalInReview = Math.max(0, totalDebt - totalPayable);
  const payableItemsCount = debts.reduce((sum, d) =>
    sum + d.pending_transactions.filter(tx => voucherStatuses.get(tx.id)?.status !== 'pending').length, 0);

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
        // Excluir transacciones cubiertas por voucher pendiente (en revisión)
        if (voucherStatuses.get(tx.id)?.status === 'pending') continue;
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
      totalAmount: totalPayable, // Solo lo pagable — no incluye "en revisión"
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
    // Calcular el total combinado antes de abrir el selector (para la regla de S/ 700)
    const combined = buildCombinedPaymentData();
    setPendingInvoiceTotal(combined.totalAmount);
    setCombinedMode(true);
    setSelectedDebt(null);
    setShowInvoiceSelector(true);
  };

  /**
   * Abre el modal de pago para un estudiante (con las transacciones seleccionadas)
   */
  const handlePayDebt = (debt: StudentDebt) => {
    const allIds = debt.pending_transactions.map(t => t.id);
    if (!selectedTxByStudent.has(debt.student_id)) {
      setSelectedTxByStudent(prev => new Map(prev).set(debt.student_id, new Set(allIds)));
    }
    setSelectedDebt(debt);
    // Calcular el total seleccionado antes de abrir el selector (para la regla de S/ 700).
    // Usa la misma lógica que getPaymentData: si hay selección parcial la usa; si no, todos.
    const existingSelection = selectedTxByStudent.get(debt.student_id);
    const effectiveIds = existingSelection && existingSelection.size > 0 ? existingSelection : new Set(allIds);
    const total = debt.pending_transactions
      .filter(tx => effectiveIds.has(tx.id))
      .reduce((sum, tx) => sum + tx.amount, 0);
    setPendingInvoiceTotal(total);
    setShowInvoiceSelector(true);
  };

  const proceedToPayment = (type: InvoiceType) => {
    setInvoiceType(type);
    setShowInvoiceSelector(false);
    // Tanto boleta como factura pasan por InvoiceClientModal:
    //  - Factura: requiere RUC + Razón Social + Dirección (obligatorios)
    //  - Boleta:  requiere DNI si el monto >= S/ 700 (regla SUNAT)
    setShowInvoiceClientModal(true);
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
      // Los IDs sintéticos de kiosco no van a la BD (no son UUIDs reales)
      if (!tx.id.startsWith('__kiosk_balance__')) {
        transactionIds.push(tx.id);
      }
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
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Cargando pagos...</p>
        </div>
      </div>
    );
  }

  if (debts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 mb-1">Todo al día</h3>
        <p className="text-sm text-slate-400 text-center">No tienes pagos pendientes. Aquí aparecerán tus almuerzos y consumos por pagar.</p>
      </div>
    );
  }

  // No mostrar la barra flotante "Pagar seleccionadas" encima de modales (selector de comprobante,
  // datos SUNAT, pasarela de pago, detalle POS) — Radix Dialog suele usar z-50 y quedar tapado.
  const hideStickyPayBar =
    showPaymentModal ||
    showInvoiceClientModal ||
    showInvoiceSelector ||
    !!posDetailStudent;

  return (
    <div className="space-y-3">

      {/* ── SmartInfoCard — Hub de información colapsable ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <button
          onClick={() => setInfoHubOpen(p => !p)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60 active:bg-slate-100/60 transition-colors"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center shrink-0">
            <Info className="w-4 h-4 text-violet-500" />
          </div>
          <span className="flex-1 text-sm font-semibold text-slate-700">💡 Lo que necesitas saber</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${infoHubOpen ? 'rotate-180' : ''}`} />
        </button>

        {infoHubOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
            {/* ¿Cómo pagar? */}
            <div className="flex items-start gap-2.5">
              <CreditCard className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600 leading-relaxed">
                <strong className="text-slate-700">¿Cómo pagar?</strong> — Puedes pagar presencialmente en caja
                o enviando un comprobante (Yape, Plin, transferencia) tocando el botón <strong>"Pagar"</strong> de cada hijo.
              </p>
            </div>

            {/* Sedes distintas vs. misma sede */}
            {isMultiSchool ? (
              <div className="flex items-start gap-2.5 bg-amber-50 rounded-xl px-3 py-2.5 border border-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-amber-800">⚠️ Hijos en sedes distintas</p>
                  <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                    Cada sede tiene una cuenta bancaria distinta. <strong>Paga por separado</strong> usando el botón individual de cada hijo.
                  </p>
                </div>
              </div>
            ) : debts.length >= 2 ? (
              <div className="flex items-start gap-2.5 bg-emerald-50 rounded-xl px-3 py-2.5 border border-emerald-200">
                <Users className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-emerald-800">Todos en la misma sede</p>
                  <p className="text-xs text-emerald-700 mt-0.5">Puedes enviar un solo comprobante para todos tus hijos.</p>
                </div>
                {!hasCombinedPendingVoucher ? (
                  <button
                    onClick={() => { setInfoHubOpen(false); handleCombinedPay(); }}
                    className="shrink-0 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm active:scale-95 transition-all"
                  >
                    Pagar todo
                  </button>
                ) : (
                  <span className="shrink-0 px-3 py-1.5 rounded-xl bg-blue-100 text-blue-700 text-xs font-semibold">En revisión</span>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Barra de Total Pendiente — solo muestra lo pagable (excluye "en revisión") ── */}
      <div id="cart-total-pending-card" className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-3 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Total pendiente</p>
          <p className="text-2xl font-black text-slate-800">
            S/ <span className="text-rose-500">{(totalPayable || 0).toFixed(2)}</span>
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {payableItemsCount} ítem(s) por pagar
            {debts.length >= 2 && ` · ${debts.length} alumnos`}
            {totalInReview > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-blue-500 font-semibold">
                · S/ {totalInReview.toFixed(2)} en revisión
              </span>
            )}
          </p>
        </div>
        {/* Botón pagar todo: solo si hay algo pagable y aplica */}
        {debts.length >= 2 && !isMultiSchool && !hasCombinedPendingVoucher && totalPayable > 0 && (
          <button
            onClick={handleCombinedPay}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-sm font-bold shadow-md active:scale-95 transition-all"
          >
            <Receipt className="h-4 w-4" />
            Pagar todo
          </button>
        )}
        {hasCombinedPendingVoucher && totalPayable === 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200">
            <Send className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-blue-700">En revisión</span>
          </div>
        )}
      </div>

      {/* ── Lista de hijos — filas compactas con acordeón ── */}
      {debts.map((debt) => {
        const allTxIds = debt.pending_transactions.map(t => t.id);
        const coveredByPendingVoucher = debt.pending_transactions
          .filter(tx => voucherStatuses.get(tx.id)?.status === 'pending')
          .map(t => t.id);
        const hasSomeCovered = coveredByPendingVoucher.length > 0;
        const payableTxIds = allTxIds.filter(id => !coveredByPendingVoucher.includes(id));
        const hasPayableItems = payableTxIds.length > 0;

        const selectedIds = selectedTxByStudent.has(debt.student_id)
          ? selectedTxByStudent.get(debt.student_id)!
          : new Set(payableTxIds.length > 0 ? payableTxIds : allTxIds);

        const allSelected = selectedIds.size === allTxIds.length;
        const noneSelected = selectedIds.size === 0;
        const selectedTotal = debt.pending_transactions
          .filter(tx => selectedIds.has(tx.id))
          .reduce((sum, tx) => sum + tx.amount, 0);

        const isExpanded = expandedStudentId === debt.student_id;
        const initials = debt.student_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

        // Monto por alumno: solo lo pagable (sin "en revisión")
        const studentPayable = debt.pending_transactions
          .filter(tx => voucherStatuses.get(tx.id)?.status !== 'pending')
          .reduce((s, tx) => s + tx.amount, 0);
        const studentInReview = Math.max(0, debt.total_debt - studentPayable);

        return (
          <div
            key={debt.student_id}
            id={debt.student_id === debts[0]?.student_id ? 'cart-student-debt-card' : undefined}
            className="bg-white rounded-2xl shadow-sm border border-slate-100"
          >
            {/* ── Fila compacta del hijo — sticky mientras se hace scroll en el detalle ── */}
            <div className={`flex items-center gap-3 px-4 py-3 bg-white rounded-t-2xl${isExpanded ? ' sticky top-0 z-10 shadow-sm' : ''}`}>
              {/* Avatar */}
              <div className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-rose-400 to-orange-400 flex items-center justify-center shadow-md overflow-hidden">
                {debt.student_photo ? (
                  <img src={debt.student_photo} alt={debt.student_name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-white">{initials}</span>
                )}
              </div>

              {/* Nombre + conteo */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-800 truncate">{debt.student_name.split(' ')[0]}</p>
                <p className="text-xs text-slate-400">{debt.pending_transactions.length} compra{debt.pending_transactions.length !== 1 ? 's' : ''}</p>
              </div>

              {/* Monto + botón pagar */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-base font-black text-rose-500">S/ {(studentPayable || 0).toFixed(2)}</p>
                  {studentInReview > 0 && (
                    <p className="text-[9px] text-blue-500 font-semibold mt-0.5 flex items-center gap-0.5 justify-end">
                      <Send className="h-2.5 w-2.5" />S/ {studentInReview.toFixed(2)} en revisión
                    </p>
                  )}
                  {/* Badge de saldo a favor */}
                  {(debt.wallet_balance || 0) > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleWallet(debt.student_id); }}
                      className={`mt-0.5 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all border ${
                        getUseWallet(debt.student_id)
                          ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                          : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                      }`}
                      title={getUseWallet(debt.student_id) ? 'Toca para no usar el saldo' : 'Toca para usar tu saldo a favor'}
                    >
                      <Wallet className="h-2.5 w-2.5 shrink-0" />
                      {getUseWallet(debt.student_id)
                        ? `−S/ ${Math.min(debt.wallet_balance, debt.total_debt).toFixed(2)} aplicado`
                        : `S/ ${debt.wallet_balance.toFixed(2)} a favor`}
                    </button>
                  )}
                </div>
                {hasPayableItems && (
                  <div className="flex flex-col items-end gap-0.5">
                    {!noneSelected && !allSelected && (
                      <span className="text-[9px] text-emerald-600 font-semibold">
                        {selectedIds.size} selec. · S/ {selectedTotal.toFixed(2)}
                      </span>
                    )}
                    <button
                      id="cart-pay-selected-btn"
                      onClick={(e) => { e.stopPropagation(); handlePayDebt(debt); }}
                      className="px-3 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-bold shadow-md active:scale-95 transition-all whitespace-nowrap"
                    >
                      {noneSelected
                        ? 'Pagar'
                        : !allSelected
                        ? `Pagar S/ ${selectedTotal.toFixed(2)}`
                        : 'Pagar'}
                    </button>
                  </div>
                )}
                {hasSomeCovered && !hasPayableItems && (
                  <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-blue-50 border border-blue-200">
                    <Send className="h-3 w-3 text-blue-500" />
                    <span className="text-[10px] font-semibold text-blue-700">Revisión</span>
                  </div>
                )}
                {/* Chevron para expandir */}
                <button
                  onClick={() => setExpandedStudentId(isExpanded ? null : debt.student_id)}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center active:scale-90 transition-all"
                  aria-label={isExpanded ? 'Colapsar' : 'Ver detalle'}
                >
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* ── Detalle expandible ── */}
            {isExpanded && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-2 rounded-b-2xl">

                {/* Aviso revisión parcial */}
                {hasSomeCovered && hasPayableItems && (
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                    <Send className="h-3 w-3 text-blue-500 shrink-0" />
                    <p className="text-[10px] text-blue-700">
                      {coveredByPendingVoucher.length} compra(s) ya están en revisión. Puedes pagar las restantes.
                    </p>
                  </div>
                )}

                {/* Selección */}
                {hasPayableItems && (
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <button
                      onClick={() => toggleAllTx(debt.student_id, payableTxIds.length > 0 ? payableTxIds : allTxIds)}
                      className="flex items-center gap-1.5 text-emerald-600 hover:text-emerald-800 font-semibold"
                    >
                      {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                    </button>
                    <span className="text-slate-400">{selectedIds.size} de {payableTxIds.length || allTxIds.length} selec.</span>
                  </div>
                )}

                {/* Transacciones */}
                {debt.pending_transactions.map((transaction) => {
                  const isKioskBalance = !!transaction.metadata?.is_kiosk_balance_debt;
                  const isLunch = !isKioskBalance && !!(transaction.metadata?.lunch_order_id || transaction.description?.toLowerCase().includes('almuerzo'));
                  const isSelected = selectedIds.has(transaction.id);
                  const vStatus = voucherStatuses.get(transaction.id);
                  const isCoveredByPending = coveredByPendingVoucher.includes(transaction.id);

                  return (
                    <div
                      key={transaction.id}
                      onClick={() => !isCoveredByPending && toggleTransaction(debt.student_id, transaction.id, payableTxIds.length > 0 ? payableTxIds : allTxIds)}
                      className={`p-3 rounded-xl border bg-white transition-all ${
                        isCoveredByPending
                          ? 'border-blue-100 opacity-70 cursor-default'
                          : `cursor-pointer ${isSelected ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {!isCoveredByPending ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleTransaction(debt.student_id, transaction.id, payableTxIds.length > 0 ? payableTxIds : allTxIds)}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0"
                          />
                        ) : (
                          <div className="h-4 w-4 shrink-0 flex items-center justify-center">
                            <Send className="h-3.5 w-3.5 text-blue-400" />
                          </div>
                        )}
                        {isKioskBalance
                          ? <ShoppingBag className="h-4 w-4 text-rose-400 shrink-0" />
                          : isLunch
                          ? <UtensilsCrossed className="h-4 w-4 text-orange-400 shrink-0" />
                          : <Receipt className="h-4 w-4 text-slate-400 shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-slate-800 truncate">{transaction.description}</p>
                          {isKioskBalance ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPosDetailStudent({
                                  id: debt.student_id,
                                  name: debt.student_name,
                                  debt: transaction.amount,
                                });
                              }}
                              className="text-[10px] text-blue-500 hover:text-blue-700 font-semibold mt-0.5 flex items-center gap-1 active:scale-95 transition-all"
                            >
                              👁 Ver detalle de consumos
                            </button>
                          ) : (
                            <p className="text-[10px] text-slate-400">
                              {format(new Date(transaction.created_at), "d 'de' MMMM, yyyy • HH:mm", { locale: es })}
                              {transaction.ticket_code && ` · ${transaction.ticket_code}`}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-black text-rose-500">S/ {(transaction.amount || 0).toFixed(2)}</p>
                          {isCoveredByPending ? (
                            <Badge variant="outline" className="text-[9px] border-blue-200 text-blue-600 mt-0.5">
                              <Send className="h-2.5 w-2.5 mr-0.5" />En revisión
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] border-amber-200 text-amber-600 mt-0.5">
                              <Clock className="h-2.5 w-2.5 mr-0.5" />Pendiente
                            </Badge>
                          )}
                        </div>
                      </div>

                      {isLunch && !vStatus && (
                        <div className="mt-2 flex items-start gap-1.5 bg-orange-50 border border-orange-100 rounded-lg px-2 py-1.5">
                          <UtensilsCrossed className="h-3 w-3 text-orange-400 mt-0.5 shrink-0" />
                          <p className="text-[10px] text-orange-700 leading-tight">
                            Este almuerzo <strong>no se procesará</strong> hasta que pagues la deuda pendiente.
                          </p>
                        </div>
                      )}
                      {renderVoucherStatus(transaction)}
                    </div>
                  );
                })}

                {/* Espacio para que el contenido no quede tapado por el botón sticky */}
                {hasPayableItems && <div className="h-14" />}
              </div>
            )}
          {/* ── Botón sticky fondo de pantalla — solo cuando el acordeón está abierto ── */}
          {isExpanded && hasPayableItems && !hideStickyPayBar && (
            <div className="fixed bottom-[6.5rem] left-0 right-0 z-[60] px-4 pointer-events-none">
              <button
                onClick={() => handlePayDebt(debt)}
                disabled={noneSelected}
                className="pointer-events-auto w-full py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-sm font-bold shadow-xl active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ boxShadow: '0 4px 24px rgba(16,185,129,0.35)' }}
              >
                <Banknote className="h-5 w-5 shrink-0" />
                {noneSelected
                  ? 'Selecciona al menos 1 compra'
                  : `Pagar seleccionadas — S/ ${selectedTotal.toFixed(2)}`}
              </button>
            </div>
          )}
          </div>
        );
      })}

      {/* ── Selector de tipo de comprobante ── */}
      <Dialog open={showInvoiceSelector} onOpenChange={(open) => {
        if (!open) {
          setShowInvoiceSelector(false);
          if (!showPaymentModal) {
            setSelectedDebt(null);
            setCombinedMode(false);
          }
        }
      }}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-center">¿Qué comprobante necesitas?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {pendingInvoiceTotal > 0 && (
              <p className="text-center text-sm text-slate-500">
                Total a pagar: <span className="font-bold text-slate-700">S/ {pendingInvoiceTotal.toFixed(2)}</span>
              </p>
            )}
            <Button
              variant="outline"
              className="w-full h-14 text-base justify-start gap-3 hover:bg-green-50 hover:border-green-300"
              onClick={() => proceedToPayment('boleta')}
            >
              <Receipt className="h-5 w-5 text-green-600" />
              <div className="text-left">
                <p className="font-medium">Boleta electrónica</p>
                <p className="text-xs text-gray-500">
                  {pendingInvoiceTotal >= 700
                    ? 'Requiere DNI obligatorio (monto mayor a S/ 700)'
                    : 'A nombre del padre/madre o Consumidor Final'}
                </p>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full h-14 text-base justify-start gap-3 hover:bg-purple-50 hover:border-purple-300"
              onClick={() => proceedToPayment('factura')}
            >
              <FileText className="h-5 w-5 text-purple-600" />
              <div className="text-left">
                <p className="font-medium">Factura electrónica</p>
                <p className="text-xs text-gray-500">Para empresas — requiere RUC y razón social</p>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modal de datos del cliente (boleta Y factura) ── */}
      <InvoiceClientModal
        open={showInvoiceClientModal}
        onClose={() => {
          setShowInvoiceClientModal(false);
          setSelectedDebt(null);
          setCombinedMode(false);
          setInvoiceType(null);
        }}
        defaultType={invoiceType ?? 'boleta'}
        lockedType
        totalAmount={pendingInvoiceTotal}
        parentId={userId}
        onConfirm={(data) => {
          setInvoiceClientData(data);
          setShowInvoiceClientModal(false);
          setShowPaymentModal(true);
        }}
      />

      {/* ── Modal de Pago (individual) ── */}
      {!combinedMode && selectedDebt && (() => {
        const payData = getPaymentData(selectedDebt);
        const walletBalance = selectedDebt.wallet_balance || 0;
        const useWallet = getUseWallet(selectedDebt.student_id);
        // Cuánto se descuenta de la billetera: mínimo entre saldo disponible y deuda total
        const walletToUse = useWallet
          ? Math.min(walletBalance, payData.totalSelected)
          : 0;
        return (
          <RechargeModal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setSelectedDebt(null);
              setInvoiceType(null);
              setInvoiceClientData(null);
              fetchDebts();
            }}
            onCancel={() => {
              setShowPaymentModal(false);
              setSelectedDebt(null);
              setInvoiceType(null);
              setInvoiceClientData(null);
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
            invoiceType={invoiceType}
            invoiceClientData={invoiceClientData as unknown as Record<string, unknown> | null}
            walletAmountToUse={walletToUse}
          />
        );
      })()}

      {/* ── Modal de detalle de consumos POS ── */}
      {posDetailStudent && (
        <PosConsumptionModal
          open={!!posDetailStudent}
          onClose={() => setPosDetailStudent(null)}
          studentId={posDetailStudent.id}
          studentName={posDetailStudent.name}
          kioskDebt={posDetailStudent.debt}
        />
      )}

      {/* ── Modal de Pago (combinado — todos los hijos juntos) ── */}
      {combinedMode && (() => {
        const combined = buildCombinedPaymentData();
        return (
          <RechargeModal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setCombinedMode(false);
              setInvoiceType(null);
              setInvoiceClientData(null);
              fetchDebts();
            }}
            onCancel={() => {
              setShowPaymentModal(false);
              setCombinedMode(false);
              setInvoiceType(null);
              setInvoiceClientData(null);
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
            invoiceType={invoiceType}
            invoiceClientData={invoiceClientData as unknown as Record<string, unknown> | null}
          />
        );
      })()}
    </div>
  );
};

