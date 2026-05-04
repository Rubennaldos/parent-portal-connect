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
  /** Estado del voucher vinculado a esta deuda (null = sin voucher pendiente) */
  voucher_status?: 'pending' | 'rejected' | null;
  voucher_request_id?: string | null;
  voucher_rejection_reason?: string | null;
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
  /** Deuda bruta del alumno — proviene de summary_student_total (DB v2.2) */
  total_debt: number;
  /** Lo que puede pagar ahora (excl. vouchers en revisión) — DB v2.2 */
  student_payable: number;
  /** Lo que ya está en revisión — DB v2.2 */
  student_in_review: number;
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

interface RechargeCartItem {
  id: string;
  student_id: string;
  student_name: string;
  school_id?: string | null;
  amount: number;
  created_at: string;
}

interface PaymentsTabProps {
  userId: string;
  isActive?: boolean; // 🔄 Para refrescar cuando la pestaña se activa
  rechargeCartItems: RechargeCartItem[];
  onRemoveRechargeItem: (itemId: string) => void;
  onClearRechargeCart: () => void;
}

/** Compras kiosco pendientes (UUID en transactions), sin almuerzos ni fila sintética de saldo. */
function isKioskPendingPurchase(tx: PendingTransaction): boolean {
  if (tx.metadata?.is_kiosk_balance_debt) return false;
  if (tx.metadata?.lunch_order_id) return false;
  if (tx.id.startsWith('lunch_')) return false;
  if (tx.id.startsWith('kiosk_balance_')) return false;
  return true;
}

export const PaymentsTab = ({
  userId,
  isActive,
  rechargeCartItems,
  onRemoveRechargeItem,
  onClearRechargeCart,
}: PaymentsTabProps) => {
  const { toast } = useToast();
  const voucherSyncTs = useDebouncedSync('vouchers', 800);
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<StudentDebt[]>([]);
  const [voucherStatuses, setVoucherStatuses] = useState<Map<string, VoucherStatus>>(new Map());

  // ── Resumen financiero: valores calculados en DB (Ley de No-Cálculo) ──────
  // Se leen de summary_* en la primera fila del RPC get_parent_debts_v2.
  // El frontend NO realiza sumas sobre estos valores — solo los pinta.
  const [serverSummary, setServerSummary] = useState<{
    totalBruto:    number;
    inReview:      number;
    netoPayable:   number;
  }>({ totalBruto: 0, inReview: 0, netoPayable: 0 });

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
  const [posDetailStudent, setPosDetailStudent] = useState<{ id: string; name: string; readonly?: boolean; showHistory?: boolean } | null>(null);

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
        supabase.rpc('get_parent_debts_v2', { p_parent_id: userId }),
      ]);

      if (studentsResult.error) throw studentsResult.error;
      if (debtsResult.error)    throw debtsResult.error;

      const students  = studentsResult.data ?? [];
      const debtRows  = (debtsResult.data ?? []) as Array<{
        deuda_id:                 string;
        student_id:               string;
        school_id:                string;
        monto:                    number;
        descripcion:              string;
        fecha:                    string;
        fuente:                   string;
        es_almuerzo:              boolean;
        metadata:                 any;
        ticket_code:              string | null;
        voucher_status:           'pending' | 'rejected' | null;
        voucher_request_id:       string | null;
        voucher_rejection_reason: string | null;
        // v2.1 — resumen GLOBAL (mismo valor en cada fila)
        summary_total_bruto:      number | null;
        summary_in_review:        number | null;
        summary_neto_payable:     number | null;
        // v2.2 — resumen POR ALUMNO (varía según student_id)
        summary_student_total:     number | null;
        summary_student_payable:   number | null;
        summary_student_in_review: number | null;
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
          id:                       row.deuda_id,
          student_id:               student.id,
          student_name:             student.full_name,
          amount:                   Number(row.monto),
          description:              row.descripcion,
          created_at:               row.fecha,
          ticket_code:              row.ticket_code ?? undefined,
          metadata:                 row.metadata,
          voucher_status:           row.voucher_status ?? null,
          voucher_request_id:       row.voucher_request_id ?? null,
          voucher_rejection_reason: row.voucher_rejection_reason ?? null,
        }));

        // Totales por alumno: vienen de las window functions de DB (v2.2).
        // La primera fila tiene el mismo valor para todo el grupo del alumno.
        const firstRow = rows[0];
        debtsData.push({
          student_id:        student.id,
          student_name:      student.full_name,
          student_photo:     student.photo_url,
          student_balance:   student.balance         ?? 0,
          wallet_balance:    student.wallet_balance  ?? 0,
          school_id:         student.school_id,
          total_debt:        Number(firstRow?.summary_student_total     ?? 0),
          student_payable:   Number(firstRow?.summary_student_payable   ?? 0),
          student_in_review: Number(firstRow?.summary_student_in_review ?? 0),
          pending_transactions: mappedTransactions,
        });
      }

      setDebts(debtsData);

      // ── Resumen del servidor (v2.1): leer de la primera fila ─────────────
      // Si la DB todavía no tiene la migración v2.1, se hace fallback a 0
      // (el RPC aún funciona, solo falta el resumen visual).
      const firstRow = debtRows[0];
      setServerSummary({
        totalBruto:  Number(firstRow?.summary_total_bruto  ?? 0),
        inReview:    Number(firstRow?.summary_in_review    ?? 0),
        netoPayable: Number(firstRow?.summary_neto_payable ?? 0),
      });

      // ── Derivar voucherStatuses y pendingDebtVoucherStudents desde los datos del RPC v2 ──
      // get_parent_debts_v2 ya embebe el voucher_status por deuda en una query atómica.
      // No se necesita una segunda query a recharge_requests.
      {
        const statusMap = new Map<string, VoucherStatus>();
        const pendingDebtStudents = new Set<string>();

        for (const debt of debtsData) {
          for (const tx of debt.pending_transactions) {
            if (tx.voucher_status === 'pending' || tx.voucher_status === 'rejected') {
              statusMap.set(tx.id, {
                transaction_id: tx.id,
                status:         tx.voucher_status,
                rejection_reason: tx.voucher_rejection_reason ?? undefined,
                created_at:     tx.created_at,
              });
              if (tx.voucher_status === 'pending') {
                pendingDebtStudents.add(debt.student_id);
              }
            }
          }

          // Marcar alumno si TODAS sus transacciones están en revisión
          if (debt.pending_transactions.length > 0) {
            const allCovered = debt.pending_transactions.every(
              tx => tx.voucher_status === 'pending'
            );
            if (allCovered) pendingDebtStudents.add(debt.student_id);
          }
        }

        setVoucherStatuses(statusMap);
        setPendingDebtVoucherStudents(pendingDebtStudents);
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
      // Suma de wallet_balance: viene del RPC (Regla 11.A — sin .reduce() financiero)
      const [studentsResult, walletTotalResult] = await Promise.all([
        supabase
          .from('students')
          .select('id, full_name, wallet_balance')
          .eq('parent_id', userId)
          .eq('is_active', true),
        supabase.rpc('get_parent_wallet_total', { p_parent_id: userId }),
      ]);

      if (studentsResult.error) throw studentsResult.error;

      const allStudents = studentsResult.data ?? [];
      const total = Number(walletTotalResult.data ?? 0);
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

  // ── Totales del carrito (frontend: solo items de recarga) ────────────────
  const rechargeCartTotal = rechargeCartItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const rechargeCartCount = rechargeCartItems.length;

  // ── Totales financieros: vienen del servidor (Ley de No-Cálculo) ─────────
  // serverSummary se actualiza en cada llamada a fetchDebts.
  // El frontend SOLO suma el carrito de recargas (estado local que el RPC no conoce).
  const totalDebt     = serverSummary.totalBruto;   // alias para compatibilidad con código de pago por alumno
  const totalInReview = serverSummary.inReview;
  const totalPayable  = serverSummary.netoPayable;
  const checkoutTotal = totalPayable + rechargeCartTotal;

  // Conteo de ítems pagables (necesario para el subtítulo; lo calculamos localmente)
  const payableItemsCount = debts.reduce((sum, d) =>
    sum + d.pending_transactions.filter(tx => voucherStatuses.get(tx.id)?.status !== 'pending').length, 0);
  const checkoutItemsCount = payableItemsCount + rechargeCartCount;

  // ── Detectar si las deudas pertenecen a sedes distintas ──
  const uniqueSchoolIds = [...new Set([
    ...debts.map(d => d.school_id).filter(Boolean),
    ...rechargeCartItems.map(i => i.school_id).filter(Boolean),
  ])];
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
        // IDs sintéticos no son UUIDs reales — no van a paid_transaction_ids
        const isSyntheticId = tx.id.startsWith('kiosk_balance_') || tx.id.startsWith('lunch_');
        if (!isSyntheticId) {
          allTransactionIds.push(tx.id);
        }
        if (tx.metadata?.lunch_order_id) {
          allLunchOrderIds.push(tx.metadata.lunch_order_id);
        }
        allBreakdownItems.push({
          description: `${debt.student_name}: ${tx.description}`,
          amount: tx.amount,
        });
      }
    }

    const rechargeItems = rechargeCartItems.map((item) => ({
      id: item.id,
      student_id: item.student_id,
      student_name: item.student_name,
      amount: Number(item.amount || 0),
    }));
    const rechargeTotal = rechargeItems.reduce((sum, item) => sum + item.amount, 0);
    const nameSet = new Set<string>([...allStudentNames, ...rechargeItems.map((i) => i.student_name)]);
    const mergedNames = [...nameSet];
    const combinedNames = mergedNames.length <= 2
      ? mergedNames.join(' y ')
      : mergedNames.slice(0, -1).join(', ') + ' y ' + mergedNames[mergedNames.length - 1];

    return {
      allTransactionIds,
      allLunchOrderIds,
      allBreakdownItems: [
        ...allBreakdownItems,
        ...rechargeItems.map((item) => ({
          description: `Recarga carrito: ${item.student_name}`,
          amount: item.amount,
        })),
      ],
      allStudentIds,
      combinedNames,
      totalAmount: totalPayable + rechargeTotal, // Deudas + recargas de carrito
      debtAmount: totalPayable,
      rechargeAmount: rechargeTotal,
      hasDebtItems: allTransactionIds.length > 0 || allLunchOrderIds.length > 0,
      rechargeItems,
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
    const combined = buildCombinedPaymentData();
    if (combined.totalAmount <= 0) {
      toast({
        title: 'Sin ítems por pagar',
        description: 'No hay deudas ni recargas en el carrito para procesar.',
      });
      return;
    }
    // Calcular el total combinado antes de abrir el selector (para la regla de S/ 700)
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
    // Inicializar solo con transacciones pagables (excluir voucher_status="pending")
    const payableIdsForInit = debt.pending_transactions
      .filter(tx => tx.voucher_status !== 'pending')
      .map(t => t.id);
    if (!selectedTxByStudent.has(debt.student_id)) {
      setSelectedTxByStudent(prev => new Map(prev).set(
        debt.student_id,
        new Set(payableIdsForInit.length > 0 ? payableIdsForInit : allIds),
      ));
    }
    setSelectedDebt(debt);
    // Total para el umbral SUNAT (S/ 700): usar el valor por alumno que viene de DB.
    // Si el padre desmarcó ítems manualmente (selección parcial), calcular solo lo seleccionado.
    const existingSelection = selectedTxByStudent.get(debt.student_id);
    const hasCustomSelection =
      existingSelection !== undefined &&
      existingSelection.size > 0 &&
      existingSelection.size < allIds.length;

    let total: number;
    if (hasCustomSelection) {
      // Selección parcial del padre: calcular solo los ítems marcados (estado UI puro).
      total = debt.pending_transactions
        .filter(tx => existingSelection!.has(tx.id) && tx.voucher_status !== 'pending')
        .reduce((sum, tx) => sum + tx.amount, 0);
    } else {
      // Caso por defecto: usar el total pagable calculado en DB (Regla 11.A).
      total = debt.student_payable;
    }
    // Checkout integral: deudas seleccionadas + recargas en carrito.
    setPendingInvoiceTotal(total + rechargeCartTotal);
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
    // Checkout integral: deudas seleccionadas + recargas en carrito.
    setPendingInvoiceTotal(sumLista + rechargeCartTotal);
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
    const isDefaultSelection = selectedIds.size === 0;
    const effectiveIds = isDefaultSelection ? new Set(allIds) : selectedIds;

    // Excluir transacciones que ya tienen un voucher pendiente (voucher_status='pending').
    // El servidor embebe ese campo en cada tx via get_parent_debts_v2.
    // Doble seguro: el trigger tg_block_duplicate_debt_payment también lo rechazaría.
    const selectedTxList = debt.pending_transactions.filter(
      tx => effectiveIds.has(tx.id) && tx.voucher_status !== 'pending'
    );
    const lunchOrderIds: string[] = [];
    const transactionIds: string[] = [];

    selectedTxList.forEach(tx => {
      // IDs sintéticos (kiosk_balance_UUID, lunch_UUID) NO son UUIDs reales
      // y no pueden guardarse en paid_transaction_ids uuid[]. Se excluyen aquí.
      const isSyntheticId = tx.id.startsWith('kiosk_balance_') || tx.id.startsWith('lunch_');
      if (!isSyntheticId) {
        transactionIds.push(tx.id);
      }
      if (tx.metadata?.lunch_order_id) {
        lunchOrderIds.push(tx.metadata.lunch_order_id);
      }
    });

    // Total seleccionado:
    //  · Caso por defecto (todos los ítems): usar valor precalculado de DB (Regla 11.A).
    //  · Selección parcial del padre: calcular solo los ítems marcados (estado UI puro).
    const totalSelected = isDefaultSelection
      ? debt.student_payable
      : selectedTxList.reduce((sum, tx) => sum + tx.amount, 0);
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

  if (debts.length === 0 && rechargeCartItems.length === 0) {
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

      {/* ── Barra de Total — desglose 3 líneas cuando hay ítems en revisión ── */}
      <div id="cart-total-pending-card" className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
            {totalInReview > 0 ? 'Desglose de pagos' : 'Total pendiente'}
          </p>

          {totalInReview > 0 ? (
            /* ── Desglose 3 líneas: Bruto → En Revisión → Neto ── */
            <div className="mt-1.5 space-y-1">
              {/* Línea 1: Total bruto (tachado, muy discreta) */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-300">Deuda total</span>
                <span className="text-[10px] font-medium text-slate-300 line-through">
                  S/ {(totalDebt + rechargeCartTotal).toFixed(2)}
                </span>
              </div>
              {/* Línea 2: En revisión (descuento) */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-blue-500 flex items-center gap-1">
                  <Send className="h-2.5 w-2.5 shrink-0" />
                  En revisión
                </span>
                <span className="text-[11px] font-bold text-blue-500">
                  − S/ {totalInReview.toFixed(2)}
                </span>
              </div>
              {/* Separador + Neto a pagar (protagonista) */}
              <div className="border-t border-slate-200 pt-1.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black text-slate-700 tracking-tight">
                    Neto a pagar
                  </span>
                  <span className="text-2xl font-black text-rose-500 leading-none">
                    S/ {(checkoutTotal || 0).toFixed(2)}
                  </span>
                </div>
                {/* ── Desglose por alumno: valores vienen de la DB (Regla 11.A) ── */}
                {debts.length >= 1 && (
                  <div className="space-y-0.5 pt-0.5">
                    {debts.map(d => {
                      // Regla 11.A: usar los valores calculados en la DB (summary_student_payable
                      // y summary_student_in_review de get_parent_debts_v2 v2.2).
                      const sNeto = d.student_payable;
                      const sInReview = d.student_in_review;
                      if (sNeto <= 0 && sInReview <= 0) return null;
                      return (
                        <div key={d.student_id} className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-500 flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-600 shrink-0">
                              {d.student_name[0]}
                            </span>
                            <span className="font-semibold text-slate-600">{d.student_name.split(' ')[0]}</span>
                            {sInReview > 0 && (
                              <span className="text-blue-400 font-medium">
                                · S/ {sInReview.toFixed(2)} en revisión
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] font-bold text-slate-700">
                            S/ {sNeto.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                    {rechargeCartTotal > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-emerald-600 font-semibold">🛒 Recarga en carrito</span>
                        <span className="text-[11px] font-bold text-emerald-700">S/ {rechargeCartTotal.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Vista simple: solo el total ── */
            <p className="text-2xl font-black text-slate-800 mt-0.5">
              S/ <span className="text-rose-500">{(checkoutTotal || 0).toFixed(2)}</span>
            </p>
          )}

          {/* Subtítulo: conteo de ítems + recarga en carrito */}
          <p className="text-[10px] text-slate-400 mt-1">
            {checkoutItemsCount} ítem(s) por pagar
            {debts.length >= 2 && ` · ${debts.length} alumnos`}
            {rechargeCartTotal > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-emerald-600 font-semibold">
                · +S/ {rechargeCartTotal.toFixed(2)} recarga(s)
              </span>
            )}
          </p>
        </div>

        {/* Botón pagar todo: solo si hay algo pagable y aplica */}
        {!isMultiSchool && !hasCombinedPendingVoucher && checkoutTotal > 0 && (
          <button
            onClick={handleCombinedPay}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-sm font-bold shadow-md active:scale-95 transition-all"
          >
            <Receipt className="h-4 w-4" />
            Pagar todo
          </button>
        )}
        {hasCombinedPendingVoucher && checkoutTotal === 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200">
            <Send className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-blue-700">En revisión</span>
          </div>
        )}
      </div>

      {/* ── Ítems de recarga en carrito ── */}
      {rechargeCartItems.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Recargas en carrito
            </p>
            <button
              onClick={onClearRechargeCart}
              className="text-[10px] font-semibold text-slate-400 hover:text-slate-600"
            >
              Limpiar
            </button>
          </div>
          <div className="space-y-2">
            {rechargeCartItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-800 truncate">{item.student_name}</p>
                  <p className="text-[10px] text-emerald-600">Item de recarga</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-black text-emerald-700">S/ {Number(item.amount).toFixed(2)}</span>
                  <button
                    onClick={() => onRemoveRechargeItem(item.id)}
                    className="text-[10px] font-semibold text-slate-500 hover:text-rose-500"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

        // allSelected: true cuando todos los ítems PAGABLES están marcados
        const allSelected = payableTxIds.length > 0
          ? payableTxIds.every(id => selectedIds.has(id))
          : selectedIds.size === allTxIds.length;
        const noneSelected = selectedIds.size === 0;
        // selectedTotal — Regla 11.A:
        //   · Caso por defecto (todos pagables seleccionados): usar valor de DB.
        //   · Selección parcial (el padre desmarcó ítems): calcular solo los marcados (estado UI puro,
        //     no hay alternativa — la DB no conoce qué ítems eligió el padre).
        const selectedTotal = allSelected
          ? debt.student_payable
          : debt.pending_transactions
              .filter(tx => selectedIds.has(tx.id) && tx.voucher_status !== 'pending')
              .reduce((sum, tx) => sum + tx.amount, 0);

        const isExpanded = expandedStudentId === debt.student_id;
        const initials = debt.student_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

        // Monto por alumno: proviene de la DB (v2.2) — Regla 11.A Cero Cálculos en el Cliente.
        const studentPayable  = debt.student_payable;
        const studentInReview = debt.student_in_review;

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
                        : studentPayable > 0
                        ? `Pagar S/ ${studentPayable.toFixed(2)}`
                        : `Pagar S/ ${selectedTotal.toFixed(2)}`}
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
                      onClick={(e) => {
                        const target = e.target as HTMLElement | null;
                        if (target?.closest('[data-no-row-click="true"]')) return;
                        if (isKioskBalance) {
                          setPosDetailStudent({ id: debt.student_id, name: debt.student_name, showHistory: true });
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
                          <button
                            type="button"
                            data-no-row-click="true"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTransaction(debt.student_id, transaction.id, payableTxIds.length > 0 ? payableTxIds : allTxIds);
                            }}
                            className="shrink-0 -m-1 p-1 rounded-md hover:bg-emerald-50 active:scale-95 transition-all"
                            aria-label={isSelected ? 'Deseleccionar compra' : 'Seleccionar compra'}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {}}
                              className="shrink-0 pointer-events-none"
                            />
                          </button>
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
        const totalWithRechargeCart = payData.totalSelected + rechargeCartTotal;
        const mergedBreakdownItems = [
          ...payData.selectedTxList.map(tx => ({
            description: tx.description,
            amount: tx.amount,
          })),
          ...rechargeCartItems.map((item) => ({
            description: `Recarga carrito: ${item.student_name}`,
            amount: Number(item.amount || 0),
          })),
        ];
        const walletBalance = selectedDebt.wallet_balance || 0;
        const useWallet = getUseWallet(selectedDebt.student_id);
        // Cuánto se descuenta de la billetera: mínimo entre saldo disponible y deuda total
        const walletToUse = useWallet
          ? Math.min(walletBalance, totalWithRechargeCart)
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
            suggestedAmount={totalWithRechargeCart}
            requestType="debt_payment"
            requestDescription={
              rechargeCartTotal > 0
                ? `${payData.description} + recarga carrito S/ ${rechargeCartTotal.toFixed(2)}`
                : payData.description
            }
            lunchOrderIds={payData.lunchOrderIds.length > 0 ? payData.lunchOrderIds : undefined}
            paidTransactionIds={payData.transactionIds}
            breakdownItems={mergedBreakdownItems}
            invoiceType={invoiceType}
            invoiceClientData={invoiceClientData as unknown as Record<string, unknown> | null}
            walletAmountToUse={walletToUse}
            rechargeCartAmount={rechargeCartTotal}
            onSuccess={async () => {
              if (rechargeCartTotal > 0) onClearRechargeCart();
              await fetchDebts();
              await fetchWalletData();
            }}
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
          showHistory={posDetailStudent.showHistory}
          onPay={posDetailStudent.readonly || posDetailStudent.showHistory ? undefined : (total) => handlePosPayment(posDetailStudent.id, total)}
        />
      )}

      {/* ── Modal de Pago (combinado — todos los hijos juntos) ── */}
      {combinedMode && (() => {
        const combined = buildCombinedPaymentData();
        const rechargeLabel = combined.rechargeAmount > 0
          ? ` + recarga S/ ${combined.rechargeAmount.toFixed(2)}`
          : '';
        const requestType = combined.hasDebtItems ? 'debt_payment' : 'recharge';
        const modalStudentId = debts[0]?.student_id || combined.rechargeItems[0]?.student_id || '';
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
            onSuccess={async () => {
              onClearRechargeCart();
              await fetchDebts();
              await fetchWalletData();
            }}
            studentName={combined.combinedNames}
            studentId={modalStudentId}
            currentBalance={0}
            accountType="free_account"
            onRecharge={async () => {}}
            suggestedAmount={combined.totalAmount}
            requestType={requestType}
            requestDescription={
              combined.hasDebtItems
                ? `Pago combinado: ${combined.combinedNames} — ${combined.allTransactionIds.length} compra(s)${rechargeLabel}`
                : `Recarga de carrito: ${combined.combinedNames}`
            }
            lunchOrderIds={combined.allLunchOrderIds.length > 0 ? combined.allLunchOrderIds : undefined}
            paidTransactionIds={combined.allTransactionIds}
            breakdownItems={combined.allBreakdownItems}
            combinedStudentIds={combined.allStudentIds}
            rechargeCartAmount={combined.rechargeAmount}
            invoiceType={invoiceType}
            invoiceClientData={invoiceClientData as unknown as Record<string, unknown> | null}
          />
        );
      })()}
    </div>
  );
};

