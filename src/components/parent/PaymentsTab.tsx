import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CreditCard, Check, Clock, Receipt, XCircle, Send, Banknote, CheckSquare, Square, UtensilsCrossed, Users, FileText, ChevronDown, ChevronUp, Info, Wallet, ShoppingBag, Gift, Sparkles, History, ArrowDownLeft } from 'lucide-react';
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

interface WalletTransaction {
  id: string;
  student_id: string;
  student_name?: string;
  amount: number;
  type: 'cancellation_credit' | 'payment_debit' | 'manual_adjustment';
  description: string | null;
  created_at: string;
}

interface PaymentsTabProps {
  userId: string;
  isActive?: boolean; // 🔄 Para refrescar cuando la pestaña se activa
}

/** Compras kiosco pendientes (UUID en transactions), sin almuerzos ni fila sintética de saldo. */
function isKioskPendingPurchase(tx: PendingTransaction): boolean {
  if (tx.metadata?.is_kiosk_balance_debt) return false;
  if (tx.metadata?.lunch_order_id) return false;
  if (tx.id.startsWith('lunch_')) return false;
  if (tx.id.startsWith('kiosk_balance_')) return false;
  return true;
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

  // ── Billetera virtual: datos globales ──
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [totalWalletBalance, setTotalWalletBalance] = useState<number>(0);
  const [walletHistoryOpen, setWalletHistoryOpen] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);

  // ── UI: acordeón por hijo + info hub ──
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [infoHubOpen, setInfoHubOpen] = useState(false);

  // ── Modal de detalle de consumos POS ──
  const [posDetailStudent, setPosDetailStudent] = useState<{ id: string; name: string; readonly?: boolean } | null>(null);

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
    fetchWalletData();
  }, [userId]);

  useEffect(() => {
    if (isActive) {
      fetchDebts();
      fetchWalletData();
    }
  }, [isActive]);

  // Auto-refresh cuando admin aprueba/rechaza voucher (Realtime desde otra PC)
  useEffect(() => {
    if (voucherSyncTs > 0) {
      fetchDebts();
      fetchWalletData();
      toast({ title: '🔄 Carrito actualizado', description: 'Un administrador procesó tu comprobante.', duration: 4000 });
    }
  }, [voucherSyncTs]);

  const fetchDebts = async () => {
    try {
      setLoading(true);

      // ── Una sola fuente de verdad: get_parent_debts + students en paralelo ──
      // Antes: 1 query a students + N queries a transactions (una por hijo).
      // Ahora: 2 queries en paralelo, sin importar cuántos hijos tenga el padre.
      const [studentsResult, debtsResult] = await Promise.all([
        supabase
          .from('students')
          .select('id, full_name, photo_url, school_id, balance, wallet_balance')
          .eq('parent_id', userId)
          .eq('is_active', true),
        supabase.rpc('get_parent_debts', { p_parent_id: userId }),
      ]);

      if (studentsResult.error) throw studentsResult.error;
      if (debtsResult.error)    throw debtsResult.error;

      const students  = studentsResult.data ?? [];
      const debtRows  = (debtsResult.data ?? []) as Array<{
        deuda_id:    string;
        student_id:  string;
        school_id:   string;
        monto:       number;
        descripcion: string;
        fecha:       string;
        fuente:      string;
        es_almuerzo: boolean;
        metadata:    any;
        ticket_code: string | null;
      }>;

      if (students.length === 0) {
        setDebts([]);
        return;
      }

      // Índice: student_id → info del alumno
      const studentMap = new Map(students.map(s => [s.id, s]));

      // Agrupar filas de deuda por alumno
      const rowsByStudent = new Map<string, typeof debtRows>();
      for (const row of debtRows) {
        if (!row.student_id) continue;
        const existing = rowsByStudent.get(row.student_id) ?? [];
        existing.push(row);
        rowsByStudent.set(row.student_id, existing);
      }

      // Construir StudentDebt[] manteniendo el mismo shape que usa el render
      const debtsData: StudentDebt[] = [];

      for (const student of students) {
        const rows = rowsByStudent.get(student.id) ?? [];
        if (rows.length === 0) continue;

        const mappedTransactions: PendingTransaction[] = rows.map(row => ({
          id:          row.deuda_id,
          student_id:  student.id,
          student_name: student.full_name,
          amount:      Number(row.monto),
          description: row.descripcion,
          created_at:  row.fecha,
          ticket_code: row.ticket_code ?? undefined,
          metadata:    row.metadata,
        }));

        const totalDebt = mappedTransactions.reduce((sum, t) => sum + t.amount, 0);
        debtsData.push({
          student_id:      student.id,
          student_name:    student.full_name,
          student_photo:   student.photo_url,
          student_balance: student.balance    ?? 0,
          wallet_balance:  student.wallet_balance ?? 0,
          school_id:       student.school_id,
          total_debt:      totalDebt,
          pending_transactions: mappedTransactions,
        });
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

  const fetchWalletData = async () => {
    setLoadingWallet(true);
    try {
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, full_name, wallet_balance')
        .eq('parent_id', userId)
        .eq('is_active', true);

      if (studentsError) throw studentsError;

      const allStudents = students ?? [];
      const total = allStudents.reduce((sum, s) => sum + (Number(s.wallet_balance) || 0), 0);
      setTotalWalletBalance(total);

      if (total > 0) {
        const studentIds = allStudents.map(s => s.id);
        const { data: txs, error: txError } = await supabase
          .from('wallet_transactions')
          .select('id, student_id, amount, type, description, created_at')
          .in('student_id', studentIds)
          .order('created_at', { ascending: false })
          .limit(30);

        if (txError) throw txError;

        const nameMap = new Map(allStudents.map(s => [s.id, s.full_name]));
        setWalletTransactions(
          (txs ?? []).map(tx => ({
            ...tx,
            amount: Number(tx.amount),
            type: tx.type as WalletTransaction['type'],
            student_name: nameMap.get(tx.student_id),
          }))
        );
      } else {
        setWalletTransactions([]);
      }
    } catch (err: any) {
      console.error('Error al cargar billetera:', err);
    } finally {
      setLoadingWallet(false);
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

  /**
   * Llamado desde PosConsumptionModal al pagar deuda cafetería: selecciona solo
   * transacciones kiosco pendientes (misma suma que get_kiosk_pending_debt_total).
   */
  const handlePosPayment = (studentId: string, totalFromModal: number) => {
    setPosDetailStudent(null);
    const debt = debts.find(d => d.student_id === studentId);
    if (!debt) return;

    const kioskTxs = debt.pending_transactions.filter(isKioskPendingPurchase);
    const sumLista = kioskTxs.reduce((s, tx) => s + tx.amount, 0);
    if (kioskTxs.length === 0 || sumLista < 0.005) {
      toast({
        variant: 'destructive',
        title: 'Sin compras pendientes',
        description: 'No hay consumos de cafetería pendientes para pagar.',
      });
      return;
    }

    if (Math.abs(sumLista - totalFromModal) > 0.05) {
      console.warn('[PaymentsTab] Total modal vs lista pendientes', { totalFromModal, sumLista });
    }

    setSelectedTxByStudent(prev => new Map(prev).set(studentId, new Set(kioskTxs.map(t => t.id))));
    setSelectedDebt(debt);
    setPendingInvoiceTotal(sumLista);
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

  // ── COMPONENTE: Banner de Billetera Virtual ─────────────────────────────────
  const WalletBanner = () => {
    const hasBalance = totalWalletBalance > 0;

    if (!hasBalance && walletTransactions.length === 0 && !loadingWallet) return null;

    return (
      <div
        className={`rounded-2xl overflow-hidden transition-all duration-300 ${
          hasBalance
            ? 'shadow-lg shadow-emerald-100 border border-emerald-200 bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-50'
            : 'border border-slate-100 bg-white shadow-sm'
        }`}
      >
        {/* Cabecera del banner */}
        <div className="px-4 py-3 flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              hasBalance
                ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-md shadow-emerald-200'
                : 'bg-slate-100'
            }`}
          >
            {hasBalance ? (
              <Sparkles className="h-5 w-5 text-white" />
            ) : (
              <Wallet className="h-5 w-5 text-slate-400" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {loadingWallet ? (
              <div className="h-4 w-32 bg-slate-200 animate-pulse rounded" />
            ) : hasBalance ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                  Billetera Virtual
                </p>
                <p className="text-xl font-black text-emerald-700 leading-tight">
                  S/ {totalWalletBalance.toFixed(2)}{' '}
                  <span className="text-sm font-semibold text-emerald-500">a favor</span>
                </p>
                <p className="text-[10px] text-emerald-600 mt-0.5">
                  ✨ Se descuenta automáticamente al pagar
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Billetera Virtual
                </p>
                <p className="text-sm font-semibold text-slate-400">Sin saldo disponible</p>
              </>
            )}
          </div>

          {(hasBalance || walletTransactions.length > 0) && (
            <button
              onClick={() => setWalletHistoryOpen(p => !p)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                hasBalance
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 active:scale-95'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 active:scale-95'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              {walletHistoryOpen ? 'Ocultar' : 'Historial'}
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-200 ${
                  walletHistoryOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          )}
        </div>

        {/* Historial de movimientos */}
        {walletHistoryOpen && (
          <div className="border-t border-emerald-100 px-4 pb-4 pt-3 space-y-2">
            {walletTransactions.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-2">
                Aún no hay movimientos registrados
              </p>
            ) : (
              walletTransactions.map(tx => (
                <div
                  key={tx.id}
                  className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0"
                >
                  {/* Badge tipo */}
                  {tx.type === 'cancellation_credit' ? (
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                      <Gift className="h-2.5 w-2.5" />
                      CRÉDITO
                    </span>
                  ) : tx.type === 'payment_debit' ? (
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                      <ArrowDownLeft className="h-2.5 w-2.5" />
                      PAGO APLICADO
                    </span>
                  ) : (
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                      <CreditCard className="h-2.5 w-2.5" />
                      AJUSTE
                    </span>
                  )}

                  {/* Descripción y fecha */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 leading-snug">
                      {tx.description ??
                        (tx.type === 'cancellation_credit'
                          ? 'Devolución por almuerzo anulado'
                          : tx.type === 'payment_debit'
                          ? 'Descuento aplicado en pago'
                          : 'Ajuste de saldo')}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-slate-400">
                        {format(new Date(tx.created_at), "dd/MM/yyyy · HH:mm", { locale: es })}
                      </p>
                      {tx.student_name && debts.length > 1 && (
                        <p className="text-[10px] text-slate-400 truncate">
                          · {tx.student_name.split(' ')[0]}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Monto */}
                  <p
                    className={`shrink-0 text-sm font-black ${
                      tx.amount > 0 ? 'text-emerald-600' : 'text-blue-600'
                    }`}
                  >
                    {tx.amount > 0 ? '+' : ''}S/ {Math.abs(tx.amount).toFixed(2)}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
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
      <div className="space-y-4 pb-6">
        {/* Billetera aunque no haya deuda */}
        <WalletBanner />

        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <Check className="h-8 w-8 text-emerald-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-1">Todo al día</h3>
          <p className="text-sm text-slate-400 text-center">
            No tienes pagos pendientes. Aquí aparecerán tus almuerzos y consumos por pagar.
          </p>
        </div>
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

      {/* ── Billetera Virtual — siempre lo primero que ve el padre ── */}
      <WalletBanner />

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

      {/* ── Barra de Total Pendiente — suma de ítems de get_parent_debts (sin saldo almacenado) ── */}
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
                  const isPos = !isKioskBalance && !isLunch;
                  const isSelected = selectedIds.has(transaction.id);
                  const vStatus = voucherStatuses.get(transaction.id);
                  const isCoveredByPending = coveredByPendingVoucher.includes(transaction.id);

                  return (
                    <div
                      key={transaction.id}
                      onClick={() => {
                        if (isKioskBalance) {
                          setPosDetailStudent({ id: debt.student_id, name: debt.student_name });
                        } else if (isPos && !isCoveredByPending) {
                          // Abre detalle en modo solo lectura (sin botón de pago)
                          setPosDetailStudent({ id: debt.student_id, name: debt.student_name, readonly: true });
                        } else if (!isCoveredByPending) {
                          toggleTransaction(debt.student_id, transaction.id, payableTxIds.length > 0 ? payableTxIds : allTxIds);
                        }
                      }}
                      className={`p-3 rounded-xl border bg-white transition-all ${
                        isKioskBalance
                          ? 'border-rose-200 bg-rose-50/20 cursor-pointer hover:bg-rose-50/60 active:scale-[0.98]'
                          : isPos && !isCoveredByPending
                          ? 'border-slate-200 cursor-pointer hover:border-rose-200 hover:bg-rose-50/10 active:scale-[0.98]'
                          : isCoveredByPending
                          ? 'border-blue-100 opacity-70 cursor-default'
                          : `cursor-pointer ${isSelected ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {isKioskBalance ? (
                          <div className="h-4 w-4 shrink-0 flex items-center justify-center">
                            <ShoppingBag className="h-4 w-4 text-rose-400" />
                          </div>
                        ) : !isCoveredByPending ? (
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
                        {!isKioskBalance && (
                          isLunch
                            ? <UtensilsCrossed className="h-4 w-4 text-orange-400 shrink-0" />
                            : <Receipt className="h-4 w-4 text-slate-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-slate-800 truncate">{transaction.description}</p>
                          {isKioskBalance ? (
                            <p className="text-[10px] text-rose-500 font-semibold mt-0.5 flex items-center gap-1">
                              👁 Toca para ver qué consumió tu hijo
                            </p>
                          ) : isPos && !isCoveredByPending ? (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {format(new Date(transaction.created_at), "d 'de' MMMM, yyyy • HH:mm", { locale: es })}
                              {transaction.ticket_code && ` · ${transaction.ticket_code}`}
                              <span className="ml-1.5 text-rose-400 font-medium">· Ver detalle →</span>
                            </p>
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
          onPay={posDetailStudent.readonly ? undefined : (total) => handlePosPayment(posDetailStudent.id, total)}
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

