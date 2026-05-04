import { useState, useEffect, useRef, useCallback } from 'react';
import { useViewAsStore } from '@/stores/viewAsStore';
import { useRechargeSubmit } from '@/hooks/useRechargeSubmit';
import { useSystemStatus, PAYMENT_METHOD_DEFAULTS } from '@/hooks/useSystemStatus';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/config/supabase.config';
import { cn } from '@/lib/utils';
import { YapeLogo } from '@/components/ui/YapeLogo';
import { PlinLogo } from '@/components/ui/PlinLogo';
import {
  CreditCard,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  Clock,
  Image as ImageIcon,
  X,
  Send,
  Wallet,
  Copy,
  Check,
  PlusCircle,
  Hash,
} from 'lucide-react';

interface ExtraVoucher {
  id: string;
  referenceCode: string;
  voucherFile: File | null;
  voucherPreview: string | null;
  amount: string;
}

interface BreakdownItem {
  description: string;
  amount: number;
}

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Callback para el botón "Cancelar" (volver sin pagar) */
  onCancel?: () => void;
  studentName: string;
  studentId: string;
  currentBalance: number;
  accountType: string;
  onRecharge: (amount: number, method: string) => Promise<void>;
  /** Si viene con monto pre-definido, salta el paso de monto */
  suggestedAmount?: number;
  /** Tipo de solicitud: 'recharge', 'lunch_payment' o 'debt_payment' */
  requestType?: 'recharge' | 'lunch_payment' | 'debt_payment';
  /** Descripción del pago (ej: "Almuerzo - Menú Niños - 20 de febrero") */
  requestDescription?: string;
  /** IDs de lunch_orders asociados (solo para lunch_payment) */
  lunchOrderIds?: string[];
  /** IDs de transacciones que se están pagando (para debt_payment) */
  paidTransactionIds?: string[];
  /** Desglose de ítems que se están pagando */
  breakdownItems?: BreakdownItem[];
  /** IDs de todos los estudiantes incluidos en un pago combinado */
  combinedStudentIds?: string[];
  /** Tipo de comprobante solicitado por el padre (boleta/factura) */
  invoiceType?: 'boleta' | 'factura' | null;
  /** Datos del cliente para emitir boleta/factura */
  invoiceClientData?: Record<string, unknown> | null;
  /** Monto de billetera interna a descontar (S/ a favor del alumno).
   *  Si > 0, el padre solo sube voucher por (suggestedAmount - walletAmountToUse). */
  walletAmountToUse?: number;
  /** Callback que se ejecuta en cuanto el pago se envía exitosamente
   *  (antes de que el padre cierre el modal). Útil para refrescar listas. */
  onSuccess?: () => void;
  /**
   * Monto puro de recarga de carrito (sin deudas).
   * Se usa para el pago con IziPay: el servidor suma los importes de las deudas
   * desde la DB (vía paidTransactionIds) y añade este excedente.
   * Para pagos puros de recarga, este campo iguala a suggestedAmount.
   */
  rechargeCartAmount?: number;
  /**
   * SOLO PARA USO DEL ADMIN EN /admin/test-izipay.
   * Si true: habilita IziPay aunque RECHARGES_MAINTENANCE=true y salta la
   * pantalla de mantenimiento. Ningún padre real tiene acceso a esta prop.
   */
  izipayTestMode?: boolean;
}

interface PaymentConfig {
  yape_number: string | null;
  yape_holder: string | null;
  yape_enabled: boolean;
  plin_number: string | null;
  plin_holder: string | null;
  plin_enabled: boolean;
  bank_account_info: string | null;
  bank_account_holder: string | null;
  transferencia_enabled: boolean;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_cci: string | null;
  show_payment_info: boolean;
  izipay_enabled: boolean;
}

type PaymentMethod = 'yape' | 'plin' | 'transferencia' | 'izipay';
type PaymentMethodOrNull = PaymentMethod | null;

interface IziPayGatewayConfig {
  public_key: string | null;
  kr_js_url: string | null;
}

export function RechargeModal({
  isOpen,
  onClose,
  onCancel,
  studentName,
  studentId,
  currentBalance,
  accountType,
  onRecharge,
  suggestedAmount,
  requestType = 'recharge',
  requestDescription,
  lunchOrderIds,
  paidTransactionIds,
  breakdownItems,
  combinedStudentIds,
  invoiceType,
  invoiceClientData,
  walletAmountToUse = 0,
  onSuccess,
  rechargeCartAmount,
  izipayTestMode = false,
}: RechargeModalProps) {
  const RECHARGES_MAINTENANCE = false; // Pasarela activa en producción
  const isCombinedPayment = !!(combinedStudentIds && combinedStudentIds.length > 1);
  const { user } = useAuth();
  const { toast } = useToast();
  const { isViewAsMode } = useViewAsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipAmountStep = !!suggestedAmount && suggestedAmount > 0;

  const [step, setStep] = useState<'amount' | 'method' | 'voucher' | 'combined' | 'success'>('combined');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [collapsedExtras, setCollapsedExtras] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodOrNull>(null);
  const [referenceCode, setReferenceCode] = useState('');
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
  const [voucherPreview, setVoucherPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const onSuccessCalledRef = useRef(false);

  // ── IziPay: estado del flujo de pago (modo redirección) ──
  const [izipayStep, setIzipayStep] = useState<'idle' | 'locked'>('idle');
  // true mientras se hacen las llamadas API y se redirige a IziPay
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  // IziPay habilitado según la configuración de la sede (billing_config.izipay_enabled).
  // El admin puede activar/desactivar por sede desde Facturación → Configuración SUNAT.
  const isIzipayPilotUser = false; // Mantenido por compatibilidad con izipayTestMode
  const IZIPAY_ENABLED = izipayTestMode
    ? true
    : (paymentConfig?.izipay_enabled ?? false);

  // ── Control global de métodos de pago (SuperAdmin → Status) ──────────────
  // Regla defensiva: si falla la lectura → todos los métodos activos.
  const { status: systemStatus } = useSystemStatus();
  const globalPm = systemStatus.payment_methods_config ?? PAYMENT_METHOD_DEFAULTS;
  /**
   * Puente: si el correo del padre logueado está en parent_bypass_emails,
   * ve TODOS los métodos aunque estén desactivados globalmente.
   * Mismo mecanismo que el bypass de mantenimiento.
   */
  const userEmail = (user?.email ?? '').toLowerCase();
  const isBridgeUser = (systemStatus.parent_bypass_emails ?? [])
    .map(e => e.toLowerCase())
    .includes(userEmail);
  /** Devuelve true si el método puede mostrarse a este usuario. */
  const isMethodGloballyAllowed = (key: 'yape_active' | 'plin_active' | 'transferencia_active' | 'izipay_active') =>
    isBridgeUser || (globalPm[key] ?? true);
  // ── Comprobantes adicionales (pago en partes) ──
  const [extraVouchers, setExtraVouchers] = useState<ExtraVoucher[]>([]);
  const extraFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const quickAmounts = [10, 20, 50, 100, 150, 200];
  const IZIPAY_MIN_AMOUNT = 3;

  // Constante derivada usada en el render: si el saldo cubre toda la deuda
  // no se muestra el formulario de voucher sino la vista simplificada.
  const isFullWalletPayment =
    requestType === 'debt_payment' &&
    walletAmountToUse > 0 &&
    walletAmountToUse >= (suggestedAmount ?? 0);

  // ── Hook de envío: orquesta upload + validaciones + BD ─────────────────
  const {
    handleSubmit: doSubmit,
    loading,
    submittingRef,
    uploadProgress,
    uploadPhaseLabel,
  } = useRechargeSubmit({
    studentId,
    studentName,
    requestType,
    requestDescription,
    lunchOrderIds,
    paidTransactionIds,
    invoiceType,
    invoiceClientData,
    walletAmountToUse,
    suggestedAmount,
    isCombinedPayment,
    onStepSuccess: () => setStep('success'),
  });

  // Wrapper que empaqueta el form state actual al llamar al hook
  const handleSubmit = useCallback(() => {
    if (!user) return;

    // Guard de seguridad: si el padre intenta enviar un voucher manual con un
    // método que el admin desactivó globalmente, lo bloqueamos aquí (frontend).
    // El backend (trigger BD) es la segunda barrera que no se puede bypassear.
    if (selectedMethod && selectedMethod !== 'izipay') {
      const globalKey = (
        selectedMethod === 'yape' ? 'yape_active' :
        selectedMethod === 'plin' ? 'plin_active' : 'transferencia_active'
      ) as 'yape_active' | 'plin_active' | 'transferencia_active';
      if (!isMethodGloballyAllowed(globalKey)) {
        toast({
          title: 'Metodo no disponible',
          description: 'Este metodo de pago esta desactivado. Elige otro metodo o contacta a la administracion.',
          variant: 'destructive',
        });
        return;
      }
    }

    doSubmit({
      userId: user.id,
      amount,
      referenceCode,
      voucherFile,
      extraVouchers,
      notes,
      selectedMethod,
    });
  }, [user, doSubmit, amount, referenceCode, voucherFile, extraVouchers, notes, selectedMethod, isMethodGloballyAllowed, toast]);

  useEffect(() => {
    if (isOpen && studentId) {
      fetchPaymentConfig();
      // Reset estado al abrir
      setReferenceCode('');
      setVoucherFile(null);
      setVoucherPreview(null);
      setNotes('');
      setExtraVouchers([]);

      setCollapsedExtras(new Set());
      setSelectedMethod(null);
      if (skipAmountStep) {
        // Si hay saldo de billetera, el voucher es por la diferencia
        const voucherAmt = walletAmountToUse > 0
          ? Math.max(0, (suggestedAmount ?? 0) - walletAmountToUse)
          : (suggestedAmount ?? 0);
        setAmount(String(voucherAmt));
      } else {
        setAmount('');
      }
      setStep('combined');
      onSuccessCalledRef.current = false; // Reset al abrir el modal
    }
  }, [isOpen, studentId]);

  // Auto-refresh: notifica al padre en cuanto el pago se envía exitosamente,
  // sin esperar a que el usuario cierre el modal manualmente.
  useEffect(() => {
    if (step === 'success' && !onSuccessCalledRef.current) {
      onSuccessCalledRef.current = true;
      onSuccess?.();
    }
  }, [step, onSuccess]);

  const fetchPaymentConfig = async () => {
    setLoadingConfig(true);
    try {
      const { data: student } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .single();

      if (!student?.school_id) return;

      const { data: config } = await supabase
        .from('billing_config')
        .select('yape_number, yape_holder, yape_enabled, plin_number, plin_holder, plin_enabled, bank_account_info, bank_account_holder, transferencia_enabled, bank_name, bank_account_number, bank_cci, show_payment_info, izipay_enabled')
        .eq('school_id', student.school_id)
        .single();

      setPaymentConfig(config || null);

      setSelectedMethod(null);
    } catch (err) {
      console.error('Error al cargar config de pagos:', err);
    } finally {
      setLoadingConfig(false);
    }
  };

  // ── IziPay: iniciar pago en línea (modo redirección) ─────────────────────
  // REGLA DE SEGURIDAD: el frontend NO envía el monto a cobrar.
  // Envía los IDs de deuda + el excedente de recarga del carrito.
  // El servidor (Edge Function) recalcula el total desde la DB.
  //
  // FLUJO:
  //   Click → overlay → API calls → localStorage → window.location.href
  //   IziPay → pago → redirect a /pago/retorno → GatewayPaymentWaiting
  const handleInitIziPay = async () => {
    if (!user) return;
    if (isRedirecting) return;

    // SEGURIDAD: un administrador en modo "Ver como padre" NO puede iniciar
    // pagos reales. Solo el padre autenticado puede tocar su dinero.
    if (isViewAsMode) {
      toast({
        title: 'Acción no permitida',
        description: 'Estás en modo "Ver como". No puedes iniciar pagos en nombre de un padre. Sal del modo de vista primero.',
        variant: 'destructive',
      });
      return;
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast({ title: 'Monto inválido', description: 'Ingresa un monto mayor a S/ 0', variant: 'destructive' });
      return;
    }
    if (numAmount < IZIPAY_MIN_AMOUNT) {
      toast({
        title: 'Monto mínimo para tarjeta',
        description: 'Monto mínimo para tarjeta: S/ 3.00. Agrega una pequeña recarga para continuar.',
        variant: 'destructive',
      });
      return;
    }

    // Calcular qué parte es recarga pura (excedente del carrito).
    const hasTxIds = Array.isArray(paidTransactionIds) && paidTransactionIds.length > 0;
    const isDebtOrLunchFlow = requestType === 'debt_payment' || requestType === 'lunch_payment';
    if (isDebtOrLunchFlow && !hasTxIds) {
      toast({
        title: 'No se encontraron deudas para pagar',
        description: 'Por seguridad, no se puede continuar si no hay tickets/deudas vinculados al pago.',
        variant: 'destructive',
      });
      return;
    }
    const surplusToSend = hasTxIds
      ? (rechargeCartAmount ?? 0)
      : numAmount;

    // Mostrar overlay ANTES de cualquier await — el padre ve respuesta inmediata
    setIsRedirecting(true);

    try {
      // ── AUTORIDAD ÚNICA: fetch directo (no supabase.functions.invoke) ─
      const { data: { session } } = await supabase!.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('No hay sesión activa. Inicia sesión e intenta de nuevo.');

      const edgeFnUrl = 'https://duxqzozoahvrvqseinji.supabase.co/functions/v1/izipay-create-order';
      const requestBody = {
        studentId:        studentId,
        paid_tx_ids:      paidTransactionIds ?? [],
        recharge_surplus: surplusToSend,
        request_type:     requestType ?? 'recharge',
      };

      const httpResponse = await fetch(edgeFnUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey':        supabaseConfig.anonKey,
        },
        body: JSON.stringify(requestBody),
      });

      const fnData = await httpResponse.json().catch(() => ({} as Record<string, unknown>));

      // 409 = sesión activa del mismo alumno → mostrar cuenta regresiva
      if (httpResponse.status === 409 && (fnData as any)?.error_code === 'SESSION_ACTIVE') {
        const secs = Math.max(5, Number((fnData as any)?.expires_in_seconds ?? 60));
        setLockSecondsLeft(secs);
        setIzipayStep('locked');
        setIsRedirecting(false);
        return;
      }

      if (!httpResponse.ok || !fnData?.paymentUrl) {
        const serverMsg = (fnData as { error?: string } | null)?.error;
        throw new Error(serverMsg || `Error ${httpResponse.status} al crear la orden. Intenta nuevamente.`);
      }

      const serverAmount: number = Number(fnData.server_amount ?? numAmount);
      const responseOrderId = String(fnData.orderId ?? '');
      const rawPaymentUrl = String(fnData.paymentUrl ?? '');

      if (!rawPaymentUrl || !responseOrderId) {
        throw new Error('Respuesta incompleta de la pasarela. Falta paymentUrl u orderId.');
      }

      // ── Crear payment_session ──────────────────────────────────────────
      const { data: studentData } = await supabase!
        .from('students').select('school_id').eq('id', studentId).single();

      const { data: paymentSession, error: sessionError } = await supabase!
        .from('payment_sessions')
        .insert({
          parent_id:         user.id,
          student_id:        studentId,
          school_id:         studentData?.school_id,
          request_type:      requestType ?? 'recharge',
          debt_tx_ids:       paidTransactionIds ?? [],
          lunch_order_ids:   lunchOrderIds ?? [],
          gateway_amount:    serverAmount,
          total_debt_amount: serverAmount,
          wallet_amount:     0,
          gateway_name:      'izipay',
          gateway_reference: responseOrderId,
          status:            'initiated',
          gateway_status:    'pending',
          expires_at:        new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
        .select('id').single();

      if (sessionError) {
        if ((sessionError as any)?.message?.includes('idx_ps_student_one_active_izipay')) {
          setLockSecondsLeft(60);
          setIzipayStep('locked');
          setIsRedirecting(false);
          return;
        }
        throw sessionError;
      }

      // ── Guardar sesión en localStorage ANTES de redirigir ─────────────
      // El componente PaymentReturn leerá estos datos al regresar.
      const returnUrl = `${window.location.origin}/pago/retorno`;
      localStorage.setItem('izipay_redirect_pending', JSON.stringify({
        sessionId:   paymentSession.id,
        amount:      parseFloat(amount),
        studentName,
        studentId,
        savedAt:     Date.now(),
      }));

      // ── Construir URL final con return_url y sid ───────────────────────
      // return_url: a dónde redirige izipay-frame.html al completar el pago.
      // sid: ID de sesión para que la página de retorno sepa qué sondear.
      const finalUrl =
        `${rawPaymentUrl}` +
        `&return_url=${encodeURIComponent(returnUrl)}` +
        `&sid=${encodeURIComponent(paymentSession.id)}`;

      // ── Redirigir (la página completa navega a IziPay) ─────────────────
      // No hay más lógica aquí: el componente se desmonta con la navegación.
      window.location.href = finalUrl;

    } catch (err: any) {
      setIsRedirecting(false);
      toast({
        title: 'Error al iniciar el pago',
        description: err.message || 'Intenta nuevamente en unos segundos.',
        variant: 'destructive',
      });
    }
    // Sin finally: en caso de éxito la página navega y el componente desaparece.
  };


  // ── Cuenta regresiva cuando la sesión está bloqueada ────────────────────
  // Cuando el padre intenta pagar pero ya hay una sesión activa (doble click /
  // doble pestaña), mostramos exactamente cuántos segundos faltan para que el
  // candado se libere. Al llegar a 0 se auto-habilita el botón.
  useEffect(() => {
    if (izipayStep !== 'locked' || lockSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setLockSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setIzipayStep('idle');
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [izipayStep, lockSecondsLeft]);


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Imagen muy grande', description: 'Máximo 5 MB', variant: 'destructive' });
        return;
      }

    setVoucherFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setVoucherPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };


  // ── Copiar al portapapeles con feedback visual ──
  const handleCopy = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // fallback para navegadores sin clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const methodInfo: Record<PaymentMethod, {
    label: string;
    icon: React.ReactNode;
    color: string;
    number: string | null;
    holder: string | null;
    hint: string;
    enabled: boolean;
    isGateway?: boolean;
    bankName?: string | null;
    accountNumber?: string | null;
    cci?: string | null;
  }> = {
    yape: {
      label: 'Yape',
      icon: <YapeLogo className="w-8 h-8" />,
      color: 'purple',
      // enabled = activo en sede Y activo globalmente (o usuario con puente)
      enabled: (paymentConfig?.yape_enabled ?? true) && isMethodGloballyAllowed('yape_active'),
      number: paymentConfig?.yape_number || null,
      holder: paymentConfig?.yape_holder || null,
      hint: 'Abre tu app de Yape y transfiere al número indicado.',
    },
    plin: {
      label: 'Plin',
      icon: <PlinLogo className="w-8 h-8" />,
      color: 'green',
      enabled: (paymentConfig?.plin_enabled ?? true) && isMethodGloballyAllowed('plin_active'),
      number: paymentConfig?.plin_number || null,
      holder: paymentConfig?.plin_holder || null,
      hint: 'Abre tu app de Plin y transfiere al número indicado.',
    },
    transferencia: {
      label: 'Transferencia',
      icon: <Building2 className="h-7 w-7 text-orange-600" />,
      color: 'orange',
      enabled: (paymentConfig?.transferencia_enabled ?? true) && isMethodGloballyAllowed('transferencia_active'),
      number: (paymentConfig?.bank_account_number || paymentConfig?.bank_cci || paymentConfig?.bank_account_info) ? 'available' : null,
      holder: paymentConfig?.bank_account_holder || null,
      hint: 'Realiza una transferencia bancaria con los datos indicados.',
      bankName: paymentConfig?.bank_name || null,
      accountNumber: paymentConfig?.bank_account_number || null,
      cci: paymentConfig?.bank_cci || null,
    },
    izipay: {
      label: 'Tarjeta / Yape',
      icon: <CreditCard className={`h-7 w-7 ${IZIPAY_ENABLED && isMethodGloballyAllowed('izipay_active') ? 'text-red-600' : 'text-gray-400'}`} />,
      color: 'red',
      enabled: IZIPAY_ENABLED && isMethodGloballyAllowed('izipay_active'),
      // Siempre se muestra en el selector; null = deshabilitado visualmente (gris)
      number: 'available',
      holder: null,
      hint: IZIPAY_ENABLED && isMethodGloballyAllowed('izipay_active')
        ? 'Paga al instante con tarjeta Visa/Mastercard o Yape QR.'
        : 'Método no disponible para esta sede.',
      isGateway: true,
    },
  };

  const currentMethodInfo = selectedMethod ? methodInfo[selectedMethod] : null;

  // Determinar pasos visibles
  const visibleSteps = skipAmountStep 
    ? ['method', 'voucher'] as const
    : ['amount', 'method', 'voucher'] as const;
  const currentStepIndex = visibleSteps.indexOf(step as any);

  // ─────────────────────── PASO 1: Monto ───────────────────────
  const renderStepAmount = () => (
    <div className="space-y-5">

      {/* ⚠️ AVISO IMPORTANTE: solo para recarga de kiosco */}
      {requestType === 'recharge' && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xl font-black">!</span>
            </div>
            <div>
              <p className="font-bold text-amber-900 text-base leading-tight mb-1">
                ⚠️ ¿Para qué sirve esta recarga?
              </p>
              <p className="text-amber-800 text-sm leading-relaxed">
                Este saldo es <strong>únicamente para compras en el kiosco</strong> (recreo, snacks, etc.).
              </p>
              <p className="text-amber-700 text-sm leading-relaxed mt-2">
                👉 Si deseas <strong>pagar los almuerzos</strong>, hazlo desde la pestaña{' '}
                <span className="bg-amber-200 text-amber-900 font-bold px-1.5 py-0.5 rounded">
                  ðŸ’³ Pagos
                </span>{' '}
                al finalizar tu pedido de almuerzo.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">Saldo actual de {studentName}</p>
          <p className="text-2xl font-bold text-blue-700">S/ {currentBalance.toFixed(2)}</p>
        </div>
        <Badge className="bg-blue-100 text-blue-800 text-xs">Con Recargas</Badge>
      </div>

      <div className="space-y-2">
        <Label className="font-semibold">¿Cuánto deseas recargar?</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-lg">S/</span>
          <Input
            id="recharge-modal-amount"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-2xl h-14 text-center font-bold pl-10"
            min="1"
            step="1"
          />
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2">
          {quickAmounts.map((q) => (
            <Button
              key={q}
              variant={amount === q.toString() ? 'default' : 'outline'}
              onClick={() => setAmount(q.toString())}
              className="h-11 font-semibold"
            >
              S/ {q}
            </Button>
          ))}
        </div>
      </div>

      {amount && parseFloat(amount) > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex justify-between text-sm">
          <span className="text-gray-600">Saldo después de recarga:</span>
          <span className="font-bold text-green-700">S/ {(currentBalance + parseFloat(amount)).toFixed(2)}</span>
        </div>
      )}

      <Button
        onClick={() => setStep('method')}
        disabled={!amount || parseFloat(amount) <= 0}
        className="w-full h-12 text-base font-semibold bg-blue-600 hover:bg-blue-700"
      >
        Continuar →
      </Button>
    </div>
  );

  // ─────────────────────── PASO 2: Método + instrucciones ───────────────────────
  const renderStepMethod = () => {
    const numericAmount = parseFloat(amount || '0');
    const canUseIzipay = numericAmount >= IZIPAY_MIN_AMOUNT;
    // methodInfo.X.enabled ya incorpora isMethodGloballyAllowed, por lo que
    // hasAnyMethod refleja exactamente lo que el padre PUEDE ver y usar.
    const hasAnyMethod = (Object.values(methodInfo) as Array<typeof methodInfo[keyof typeof methodInfo]>).some(
      info => info.enabled && !!info.number
    );

    return (
      <div className="space-y-4">
        {/* Resumen de recarga */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">{requestType === 'lunch_payment' ? `Pago almuerzo â€” ${studentName}` : requestType === 'debt_payment' ? `Pago deuda â€” ${studentName}` : `Recarga para ${studentName}`}</p>
            <p className="text-xl font-bold text-blue-700">S/ {parseFloat(amount || '0').toFixed(2)}</p>
          </div>
          {!skipAmountStep && (
            <button onClick={() => setStep('amount')} className="text-xs text-blue-600 hover:underline">
              Cambiar
            </button>
          )}
        </div>

        {!hasAnyMethod ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center space-y-2">
            <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
            <p className="text-sm font-medium text-amber-800">Medios de pago no configurados</p>
            <p className="text-xs text-amber-600">
              El colegio aún no ha configurado números de Yape, Plin o cuenta bancaria. 
              Contacta a la administración del colegio.
            </p>
          </div>
        ) : (
          <>
            {/* Selector de método */}
            <div className="space-y-2">
              <Label className="font-semibold text-sm">Elige cómo vas a pagar</Label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(methodInfo) as PaymentMethod[]).map((m) => {
                  const info = methodInfo[m];
                  const isDisabledBySede = m === 'izipay' && !IZIPAY_ENABLED;
                  const isAvailable = !!info.number && info.enabled && !isDisabledBySede && (m !== 'izipay' || canUseIzipay);
                  const isSelected = selectedMethod === m;

                  // Si el switch global del método está OFF (y no es usuario puente),
                  // no renderizar el botón. Menos opciones = menos confusión.
                  const globalKey = (
                    m === 'yape' ? 'yape_active' :
                    m === 'plin' ? 'plin_active' :
                    m === 'transferencia' ? 'transferencia_active' : 'izipay_active'
                  ) as 'yape_active' | 'plin_active' | 'transferencia_active' | 'izipay_active';
                  if (!isMethodGloballyAllowed(globalKey)) return null;

                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => isAvailable && setSelectedMethod(m)}
                      disabled={!isAvailable}
                      title={isDisabledBySede ? 'Metodo no disponible para esta sede' : undefined}
                      className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all
                        ${isSelected && isAvailable
                          ? m === 'izipay'
                            ? 'border-red-600 bg-red-50 shadow-sm'
                            : 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-gray-200 bg-white'}
                        ${!isAvailable
                          ? isDisabledBySede
                            ? 'opacity-40 cursor-not-allowed grayscale'
                            : 'opacity-30 cursor-not-allowed'
                          : 'hover:border-gray-300 cursor-pointer'}
                      `}
                    >
                      <div className="h-10 w-10 flex items-center justify-center">{info.icon}</div>
                      <span className={`text-xs font-semibold ${isDisabledBySede ? 'text-gray-400' : 'text-gray-800'}`}>{info.label}</span>
                      {isDisabledBySede
                        ? <span className="text-[10px] text-gray-400">No disponible</span>
                        : !isAvailable && <span className="text-[10px] text-gray-400">No disponible</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {IZIPAY_ENABLED && !canUseIzipay && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
                Monto mínimo para tarjeta: S/ 3.00. Agrega una pequeña recarga para continuar.
              </div>
            )}

                {/* Instrucciones de pago */}
                {currentMethodInfo?.number && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-bold text-gray-700 flex items-center gap-2">
                      📋 Pasos a seguir
                    </p>
                    
                    <div className="space-y-2 text-sm text-gray-600">
                      <div className="flex items-start gap-2">
                        <span className="bg-blue-100 text-blue-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                        <span>{currentMethodInfo?.hint}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-blue-100 text-blue-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                        <span>Transfiere exactamente <strong>S/ {parseFloat(amount).toFixed(2)}</strong></span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-blue-100 text-blue-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                        <span>Toma captura del comprobante y envíalo en el siguiente paso</span>
                      </div>
                    </div>

                    {/* ── Datos de pago con botones COPIAR ── */}
                    <div className="bg-white border-2 border-dashed border-blue-300 rounded-xl overflow-hidden">
                      <div className="bg-blue-50 px-3 py-1.5 border-b border-blue-200">
                        <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wider">
                          {selectedMethod === 'transferencia' ? 'ðŸ¦ Datos bancarios â€” copia los números' : `📱 Número de ${currentMethodInfo?.label}`}
                        </p>
                      </div>

                      <div className="p-3 space-y-2">
                        {selectedMethod === 'transferencia' ? (
                          <>
                            {/* Banco â€” solo display */}
                            {methodInfo.transferencia.bankName && (
                              <div className="pb-1.5 border-b border-gray-100">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Banco</p>
                                <p className="text-sm font-semibold text-gray-800">{methodInfo.transferencia.bankName}</p>
                              </div>
                            )}
                            {/* Titular â€” solo display, sin botón copiar */}
                            {currentMethodInfo?.holder && (
                              <div className="pb-1.5 border-b border-gray-100">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Titular</p>
                                <p className="text-sm font-semibold text-gray-800">{currentMethodInfo?.holder}</p>
                              </div>
                            )}
                            {/* Cuenta Corriente â€” con botón copiar */}
                            {methodInfo.transferencia.accountNumber && (
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Cuenta Corriente</p>
                                  <p className="text-base font-bold font-mono text-gray-900 break-all">{methodInfo.transferencia.accountNumber}</p>
                                </div>
                                <button
                                  onClick={() => handleCopy(methodInfo.transferencia.accountNumber!, 'account')}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 transition-all shrink-0 active:scale-95 ${
                                    copiedField === 'account'
                                      ? 'bg-green-100 text-green-700 border-green-300'
                                      : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                  }`}
                                >
                                  {copiedField === 'account' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  {copiedField === 'account' ? '¡Copiado!' : 'Copiar'}
                                </button>
                              </div>
                            )}
                            {/* CCI â€” con botón copiar */}
                            {methodInfo.transferencia.cci && (
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">CCI</p>
                                  <p className="text-base font-bold font-mono text-gray-900 break-all">{methodInfo.transferencia.cci}</p>
                                </div>
                                <button
                                  onClick={() => handleCopy(methodInfo.transferencia.cci!, 'cci')}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 transition-all shrink-0 active:scale-95 ${
                                    copiedField === 'cci'
                                      ? 'bg-green-100 text-green-700 border-green-300'
                                      : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                  }`}
                                >
                                  {copiedField === 'cci' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  {copiedField === 'cci' ? '¡Copiado!' : 'Copiar'}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {/* Titular Yape/Plin â€” solo display, sin botón copiar */}
                            {currentMethodInfo?.holder && (
                              <div className="pb-1.5 border-b border-gray-100">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Titular</p>
                                <p className="text-sm font-semibold text-gray-800">{currentMethodInfo?.holder}</p>
                              </div>
                            )}
                            {/* Número â€” con botón copiar */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Número</p>
                                <p className="text-2xl font-bold text-gray-900 tracking-widest">{currentMethodInfo?.number}</p>
                              </div>
                              <button
                                onClick={() => handleCopy(currentMethodInfo?.number!, 'number')}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all shrink-0 active:scale-95 ${
                                  copiedField === 'number'
                                    ? 'bg-green-100 text-green-700 border-green-300'
                                    : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                }`}
                              >
                                {copiedField === 'number' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                {copiedField === 'number' ? '¡Copiado!' : 'Copiar'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
                      <Clock className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>Verificaremos tu pago y <strong>acreditaremos el saldo en menos de 24 horas</strong>.</span>
                    </div>
                  </div>
                )}
          </>
        )}

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => setStep('voucher')}
            disabled={!currentMethodInfo?.number}
            className="h-11 bg-blue-600 hover:bg-blue-700 font-semibold w-full"
          >
            Ya pagué → Enviar comprobante
          </Button>
          <div className="flex gap-2">
            {!skipAmountStep && (
              <Button variant="outline" onClick={() => setStep('amount')} className="flex-1 h-10">
                ← Atrás
              </Button>
            )}
            {/* Botón "Pagar después" desactivado â€” padres deben pagar obligatoriamente */}
            {/* {(requestType === 'lunch_payment' || requestType === 'debt_payment') && (
              <Button
                variant="ghost"
                onClick={onClose}
                className="flex-1 h-10 text-gray-500 hover:text-gray-700"
              >
                Pagar después
              </Button>
            )} */}
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────── PASO 3: Subir voucher ───────────────────────
  const renderStepVoucher = () => (
    <div className="space-y-5">
      {/* Resumen del pago — con o sin billetera */}
      {walletAmountToUse > 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2 text-sm">
          <p className="font-bold text-emerald-800 flex items-center gap-1.5">
            <Wallet className="h-4 w-4" />
            Pago dividido con Saldo a Favor
          </p>
          <div className="space-y-1">
            <div className="flex justify-between text-gray-700">
              <span>Deuda total:</span>
              <span className="font-semibold">
                S/ {((suggestedAmount ?? 0)).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>— Saldo a favor:</span>
              <span className="font-bold text-emerald-700">
                − S/ {walletAmountToUse.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-blue-800 border-t border-emerald-200 pt-1 mt-1">
              <span>A pagar con voucher:</span>
              <span>S/ {parseFloat(amount || '0').toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs text-emerald-700">
            Solo debes transferir <strong>S/ {parseFloat(amount || '0').toFixed(2)}</strong>.
            Los S/ {walletAmountToUse.toFixed(2)} de tu saldo a favor
            se descontarán automáticamente al aprobar el admin.
          </p>
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between text-sm">
          <span className="text-gray-600">{requestType === 'lunch_payment' ? 'Pago almuerzo:' : requestType === 'debt_payment' ? 'Pago deuda:' : 'Recarga solicitada:'}</span>
          <span className="font-bold text-blue-700">S/ {parseFloat(amount).toFixed(2)} vía {currentMethodInfo?.label}</span>
        </div>
      )}

      {/* ── Desglose de compras (solo para debt_payment) ── */}
      {requestType === 'debt_payment' && breakdownItems && breakdownItems.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBreakdown(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition-colors"
          >
            <span>📋 Ver desglose de lo que estás pagando ({breakdownItems.length} compra{breakdownItems.length !== 1 ? 's' : ''})</span>
            <span className="text-gray-500">{showBreakdown ? 'â–²' : 'â–¼'}</span>
          </button>
          {showBreakdown && (
            <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {breakdownItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-gray-700 truncate flex-1 mr-2">{item.description}</span>
                  <span className="font-semibold text-red-600 flex-shrink-0">S/ {item.amount.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 font-bold text-xs">
                <span className="text-gray-800">Total a pagar</span>
                <span className="text-blue-700">S/ {breakdownItems.reduce((s, i) => s + i.amount, 0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Número de operación â€” OBLIGATORIO */}
      <div className={`space-y-1.5 rounded-xl p-3 border-2 ${referenceCode.trim() ? 'border-green-300 bg-green-50' : 'border-red-400 bg-red-50'}`}>
        <Label className="font-bold text-sm flex items-center gap-1.5">
          <Hash className="h-4 w-4 text-red-500" />
          Número de operación
          <span className="text-red-600 font-black">* OBLIGATORIO</span>
        </Label>
        <Input
          placeholder="Ej: 123456789 (lo encuentras en tu app después de pagar)"
          value={referenceCode}
          onChange={(e) => setReferenceCode(e.target.value)}
          className={`font-mono text-base font-semibold border-2 h-11 ${referenceCode.trim() ? 'border-green-400 bg-white' : 'border-red-400 bg-white'}`}
        />
        {!referenceCode.trim() ? (
          <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
            ⚠️ Sin este número no se puede procesar tu pago. Lo encuentras en Yape/Plin/banco tras realizar la transferencia.
          </p>
        ) : (
          <p className="text-xs text-green-700 font-medium flex items-center gap-1">
            ✅ Código ingresado correctamente.
          </p>
        )}
      </div>

      {/* Subir imagen â€” OBLIGATORIO */}
      <div className={`space-y-2 rounded-xl p-3 border-2 ${voucherFile ? 'border-green-300 bg-green-50' : 'border-red-400 bg-red-50'}`}>
        <Label className="font-bold text-sm flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-red-500" />
          Foto del comprobante
          <span className="text-red-600 font-black">* OBLIGATORIO</span>
        </Label>

        {voucherPreview ? (
          <div className="relative">
            <img src={voucherPreview} alt="Voucher" className="w-full max-h-48 object-contain rounded-lg border border-green-300" />
            <button
              onClick={() => { setVoucherFile(null); setVoucherPreview(null); }}
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
            >
              <X className="h-3 w-3" />
            </button>
            <p className="text-xs text-green-700 font-medium mt-1 flex items-center gap-1">✅ Foto adjuntada correctamente.</p>
          </div>
        ) : (
          <>
            <button
              id="recharge-modal-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-28 border-2 border-dashed border-red-400 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-red-500 hover:bg-red-100 transition-all text-red-500"
            >
              <Upload className="h-6 w-6" />
              <span className="text-sm font-semibold">Toca para adjuntar la captura del pago</span>
              <span className="text-xs">JPG, PNG â€” máx. 5 MB</span>
            </button>
            <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
              ⚠️ Debes adjuntar la foto o captura del comprobante de pago para continuar.
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Nota adicional */}
      <div className="space-y-1">
        <Label className="text-sm">Nota adicional <span className="text-gray-400">(opcional)</span></Label>
        <Input
          placeholder={requestType === 'debt_payment' ? 'Ej: Pago de deudas pendientes' : requestType === 'lunch_payment' ? 'Ej: Pago de almuerzo del 20/02' : 'Ej: Recarga para la semana del 20/02'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* ── Comprobantes adicionales (pago en partes) ── */}
      {extraVouchers.map((ev, idx) => (
        <div key={ev.id} className="border-2 border-blue-200 rounded-xl p-4 space-y-3 bg-blue-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-blue-700">ðŸ’³ Comprobante adicional {idx + 2}</span>
            <button
              onClick={() => setExtraVouchers(prev => prev.filter(v => v.id !== ev.id))}
              className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Monto del pago parcial */}
          <div className="space-y-1">
            <Label className="text-sm font-semibold">
              Monto exacto de <em>este</em> comprobante <span className="text-red-500">*</span>
            </Label>
            <p className="text-[11px] text-blue-600">
              Como pagas en partes, indica cuánto cubre <strong>este voucher</strong> (puede ser una parte del total).
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">S/</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={ev.amount}
                onChange={(e) => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, amount: e.target.value } : v))}
                className="pl-9 font-mono"
              />
            </div>
          </div>

          {/* Código de operación adicional */}
          <div className="space-y-1">
            <Label className="text-sm font-semibold">
              Código de operación <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="Ej: 987654321"
              value={ev.referenceCode}
              onChange={(e) => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, referenceCode: e.target.value } : v))}
              className="font-mono"
            />
            <p className="text-xs text-red-500 font-medium">Campo obligatorio â€” debe ser diferente al anterior.</p>
          </div>

          {/* Imagen adicional â€” OBLIGATORIO */}
          <div className={`space-y-1 rounded-lg p-2 border-2 ${ev.voucherFile ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
            <Label className="text-sm font-bold flex items-center gap-1">
              <ImageIcon className="h-3.5 w-3.5 text-red-500" />
              Foto del comprobante <span className="text-red-600 font-black">* OBLIGATORIO</span>
            </Label>
            {ev.voucherPreview ? (
              <div className="relative">
                <img src={ev.voucherPreview} alt="Voucher adicional" className="w-full max-h-32 object-contain rounded-lg border border-green-200" />
                <button
                  onClick={() => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, voucherFile: null, voucherPreview: null } : v))}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
                <p className="text-xs text-green-700 font-medium mt-1">✅ Foto adjuntada.</p>
              </div>
            ) : (
              <>
                <button
                  onClick={() => extraFileRefs.current[ev.id]?.click()}
                  className="w-full h-20 border-2 border-dashed border-red-300 rounded-xl flex flex-col items-center justify-center gap-1 hover:border-red-500 hover:bg-red-100 transition-all text-red-500"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-xs font-semibold">Adjuntar captura</span>
                </button>
                <p className="text-xs text-red-600 font-semibold">⚠️ Obligatorio para este comprobante.</p>
              </>
            )}
            <input
              ref={el => { extraFileRefs.current[ev.id] = el; }}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  toast({ title: 'Imagen muy grande', description: 'Máximo 5 MB', variant: 'destructive' });
                  return;
                }
                const reader = new FileReader();
                reader.onload = (ev2) => setExtraVouchers(prev => prev.map(v => v.id === ev.id
                  ? { ...v, voucherFile: file, voucherPreview: ev2.target?.result as string }
                  : v
                ));
                reader.readAsDataURL(file);
              }}
            />
          </div>
        </div>
      ))}

      {/* Botón agregar otro comprobante */}
      <button
        onClick={() => setExtraVouchers(prev => [...prev, {
          id: `extra_${Date.now()}`,
          referenceCode: '',
          voucherFile: null,
          voucherPreview: null,
          amount: '',
        }])}
        className="w-full h-11 border-2 border-dashed border-blue-400 rounded-xl flex items-center justify-center gap-2 text-blue-600 font-semibold hover:bg-blue-50 transition-all text-sm"
      >
        <PlusCircle className="h-4 w-4" />
        Adjuntar otro comprobante (pago en partes)
      </button>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep('method')} className="flex-1 h-11">← Atrás</Button>
        <Button
          id="recharge-modal-submit-btn"
          onClick={handleSubmit}
          disabled={
            loading ||
            !referenceCode.trim() ||
            !voucherFile ||
            extraVouchers.some(ev => !ev.referenceCode.trim() || !ev.amount || !ev.voucherFile)
          }
          title={
            !referenceCode.trim() ? 'Falta el número de operación' :
            !voucherFile ? 'Falta adjuntar la foto del comprobante' :
            extraVouchers.some(ev => !ev.referenceCode.trim()) ? 'Falta código en un comprobante adicional' :
            extraVouchers.some(ev => !ev.voucherFile) ? 'Falta foto en un comprobante adicional' : ''
          }
          className="flex-grow h-11 bg-green-600 hover:bg-green-700 font-semibold gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
          ) : extraVouchers.length > 0 ? (
            <><Send className="h-4 w-4" /> Enviar {1 + extraVouchers.length} comprobantes</>
          ) : (
            <><Send className="h-4 w-4" /> Enviar comprobante</>
          )}
        </Button>
      </div>

      {/* Botón cancelar (solo cuando hay callback de cancelar, ej. desde PaymentsTab) */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 underline py-1 transition-colors"
        >
          Cancelar â€” volver a la pestaña de pagos
        </button>
      )}
    </div>
  );

  // ─────────────────────── VISTA COMBINADA (1 sola pantalla) ───────────────────────
  // ── Vista de pago 100% con billetera (sin voucher) ───────────────────────────
  const renderWalletOnlyView = () => (
    <div className="space-y-4">
      {/* Banner principal */}
      <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-emerald-600 shrink-0" />
          <p className="font-bold text-emerald-800 text-sm">Pago completo con Saldo a Favor</p>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-700">
            <span>Deuda total:</span>
            <span className="font-semibold text-rose-600">S/ {(suggestedAmount ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-emerald-700">
            <span>Tu saldo a favor cubre:</span>
            <span className="font-bold">− S/ {(suggestedAmount ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-emerald-800 border-t border-emerald-200 pt-1.5">
            <span>A pagar ahora:</span>
            <span className="text-lg">S/ 0.00</span>
          </div>
        </div>
        <p className="text-xs text-emerald-700 bg-emerald-100 rounded-lg px-3 py-2">
          No necesitas hacer ninguna transferencia ni subir foto.
          Tu saldo a favor se descontará automáticamente al confirmar.
        </p>
      </div>

      {/* Desglose de lo que se va a pagar */}
      {breakdownItems && breakdownItems.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBreakdown(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-600 transition-colors"
          >
            <span>📋 Ver desglose ({breakdownItems.length} ítem{breakdownItems.length !== 1 ? 's' : ''})</span>
            <span>{showBreakdown ? '▲' : '▼'}</span>
          </button>
          {showBreakdown && (
            <div className="divide-y divide-gray-100 max-h-36 overflow-y-auto">
              {breakdownItems.map((item, i) => (
                <div key={i} className="flex justify-between px-3 py-1.5 text-xs">
                  <span className="text-gray-700 truncate flex-1 mr-2">{item.description}</span>
                  <span className="font-semibold text-rose-600">S/ {item.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Botón de confirmación */}
      <Button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <Wallet className="h-5 w-5" />
            Pagar S/ {(suggestedAmount ?? 0).toFixed(2)} con Saldo a Favor
          </>
        )}
      </Button>
    </div>
  );

  const renderCombinedView = () => {
    // Si el saldo cubre toda la deuda, mostrar vista simplificada (sin voucher)
    if (isFullWalletPayment) return renderWalletOnlyView();

    const numericAmount = parseFloat(amount || '0');
    const canUseIzipay = numericAmount >= IZIPAY_MIN_AMOUNT;
    const hasAnyMethod = (Object.values(methodInfo) as Array<typeof methodInfo[keyof typeof methodInfo]>).some(
      info => info.enabled && !!info.number
    );

    const isIziPayMethod = selectedMethod === 'izipay';
    const canSubmit = isIziPayMethod
      // Para IziPay: solo necesita monto y el método seleccionado
      ? !!(selectedMethod && currentMethodInfo?.enabled && (skipAmountStep || (amount && parseFloat(amount) > 0)))
      // Para métodos manuales: requiere código + foto
      : !!(
          (skipAmountStep || (amount && parseFloat(amount) > 0)) &&
          selectedMethod &&
          currentMethodInfo?.number &&
          referenceCode.trim() &&
          voucherFile &&
          !extraVouchers.some(ev => !ev.referenceCode.trim() || !ev.amount || !ev.voucherFile)
        );

    return (
      <div className="space-y-3">
        {/* Amount section (compact) â€” only for recharge */}
        {!skipAmountStep && (
          <div className="space-y-2">
            {requestType === 'recharge' && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs text-amber-800">
                <strong>⚠️ Esta recarga es solo para compras en el kiosco.</strong> Para almuerzos, usa la pestaña Pagos.
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">S/</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="text-xl h-11 text-center font-bold pl-8"
                  min="1"
                  step="1"
                />
              </div>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {quickAmounts.map((q) => (
                <Button
                  key={q}
                  variant={amount === q.toString() ? 'default' : 'outline'}
                  onClick={() => setAmount(q.toString())}
                  size="sm"
                  className="h-8 text-xs font-semibold"
                >
                  S/{q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Summary bar */}
        {(skipAmountStep && parseFloat(amount) > 0) && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-gray-500">
                {requestType === 'lunch_payment' ? 'Pago almuerzo' : requestType === 'debt_payment' ? 'Pago deuda' : 'Recarga'}
                {' â€” '}{studentName}
              </p>
              <p className="text-lg font-black text-blue-700">S/ {parseFloat(amount).toFixed(2)}</p>
            </div>
            {requestType === 'debt_payment' && breakdownItems && breakdownItems.length > 0 && (
              <button
                onClick={() => setShowBreakdown(v => !v)}
                className="text-[10px] text-blue-600 hover:underline"
              >
                {showBreakdown ? 'Ocultar' : 'Ver'} desglose
              </button>
            )}
          </div>
        )}

        {/* Breakdown (debt_payment) */}
        {showBreakdown && breakdownItems && breakdownItems.length > 0 && (
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-32 overflow-y-auto text-xs">
            {breakdownItems.map((item, i) => (
              <div key={i} className="flex justify-between px-3 py-1.5">
                <span className="text-gray-700 truncate flex-1 mr-2">{item.description}</span>
                <span className="font-semibold text-red-600">S/ {item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {!hasAnyMethod ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center space-y-2">
            <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
            <p className="text-sm font-medium text-amber-800">Medios de pago no configurados</p>
            <p className="text-xs text-amber-600">Contacta a la administración del colegio.</p>
          </div>
        ) : (
          <>
            {/* Method tabs â€” horizontal */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Método de pago</p>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(methodInfo) as PaymentMethod[]).map((m) => {
                  const info = methodInfo[m];
                  const isDisabledBySede = m === 'izipay' && !IZIPAY_ENABLED;
                  const isAvailable = !!info.number && info.enabled && !isDisabledBySede && (m !== 'izipay' || canUseIzipay);
                  const isSelected = selectedMethod === m;

                  // Switch global OFF -> ocultar totalmente el boton
                  const globalKey = (
                    m === 'yape' ? 'yape_active' :
                    m === 'plin' ? 'plin_active' :
                    m === 'transferencia' ? 'transferencia_active' : 'izipay_active'
                  ) as 'yape_active' | 'plin_active' | 'transferencia_active' | 'izipay_active';
                  if (!isMethodGloballyAllowed(globalKey)) return null;

                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => isAvailable && setSelectedMethod(m)}
                      disabled={!isAvailable}
                      title={isDisabledBySede ? 'Metodo no disponible para esta sede' : undefined}
                      className={cn(
                        "p-2 rounded-xl border-2 flex flex-col items-center gap-0.5 transition-all duration-150",
                        isSelected && isAvailable
                          ? m === 'izipay'
                            ? "border-red-600 bg-red-50 shadow-md ring-2 ring-red-300 scale-[1.05]"
                            : "border-blue-600 bg-blue-100 shadow-md ring-2 ring-blue-300 scale-[1.05]"
                          : "border-gray-200 bg-white",
                        !isAvailable && (isDisabledBySede ? "opacity-40 cursor-not-allowed grayscale" : "opacity-30 cursor-not-allowed"),
                        isAvailable && !isSelected && "hover:border-blue-200 hover:bg-blue-50/40"
                      )}
                    >
                      <div className="h-8 w-8 flex items-center justify-center">{info.icon}</div>
                      <span className={`text-[10px] font-bold ${isSelected && isAvailable ? (m === 'izipay' ? 'text-red-700' : 'text-blue-700') : isDisabledBySede ? 'text-gray-400' : 'text-gray-700'}`}>{info.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {IZIPAY_ENABLED && !canUseIzipay && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
                Monto mínimo para tarjeta: S/ 3.00. Agrega una pequeña recarga para continuar.
              </div>
            )}

            {/* Hint cuando no se ha elegido método aún */}
            {!selectedMethod && (
              <p className="text-center text-xs text-gray-400 py-2 animate-in fade-in duration-200">
                Selecciona un método de pago para continuar ↑
              </p>
            )}

            {/* Divulgación progresiva: todo lo de abajo aparece con animación suave */}
            {selectedMethod && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">

            {/* Payment details card (solo para métodos manuales — no IziPay) */}
            {currentMethodInfo?.number && selectedMethod !== 'izipay' && (
              <div className="bg-white border-2 border-blue-200 rounded-xl overflow-hidden">
                <div className="bg-blue-50 px-3 py-1.5 border-b border-blue-200">
                  <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wider">
                    {selectedMethod === 'transferencia' ? 'ðŸ¦ Datos bancarios' : `📱 ${currentMethodInfo?.label}`}
                  </p>
                </div>
                <div className="p-3 space-y-2">
                  {selectedMethod === 'transferencia' ? (
                    <>
                      {methodInfo.transferencia.bankName && (
                        <div className="pb-1 border-b border-gray-100">
                          <p className="text-[9px] text-gray-400 uppercase">Banco</p>
                          <p className="text-sm font-semibold text-gray-800">{methodInfo.transferencia.bankName}</p>
                        </div>
                      )}
                      {currentMethodInfo?.holder && (
                        <div className="pb-1 border-b border-gray-100">
                          <p className="text-[9px] text-gray-400 uppercase">Titular</p>
                          <p className="text-sm font-semibold text-gray-800">{currentMethodInfo?.holder}</p>
                        </div>
                      )}
                      {methodInfo.transferencia.accountNumber && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] text-gray-400 uppercase">Cta. Corriente</p>
                            <p className="text-sm font-bold font-mono text-gray-900 break-all">{methodInfo.transferencia.accountNumber}</p>
                          </div>
                          <button
                            onClick={() => handleCopy(methodInfo.transferencia.accountNumber!, 'account')}
                            className={cn(
                              "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border-2 transition-all shrink-0 active:scale-95",
                              copiedField === 'account' ? "bg-green-100 text-green-700 border-green-300" : "bg-blue-600 text-white border-blue-600"
                            )}
                          >
                            {copiedField === 'account' ? <><Check className="h-3 w-3" />Copiado</> : <><Copy className="h-3 w-3" />Copiar</>}
                          </button>
                        </div>
                      )}
                      {methodInfo.transferencia.cci && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] text-gray-400 uppercase">CCI</p>
                            <p className="text-sm font-bold font-mono text-gray-900 break-all">{methodInfo.transferencia.cci}</p>
                          </div>
                          <button
                            onClick={() => handleCopy(methodInfo.transferencia.cci!, 'cci')}
                            className={cn(
                              "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border-2 transition-all shrink-0 active:scale-95",
                              copiedField === 'cci' ? "bg-green-100 text-green-700 border-green-300" : "bg-blue-600 text-white border-blue-600"
                            )}
                          >
                            {copiedField === 'cci' ? <><Check className="h-3 w-3" />Copiado</> : <><Copy className="h-3 w-3" />Copiar</>}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {currentMethodInfo?.holder && (
                        <div className="pb-1 border-b border-gray-100">
                          <p className="text-[9px] text-gray-400 uppercase">Titular</p>
                          <p className="text-sm font-semibold text-gray-800">{currentMethodInfo?.holder}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] text-gray-400 uppercase">Número</p>
                          <p className="text-xl font-bold text-gray-900 tracking-widest">{currentMethodInfo?.number}</p>
                        </div>
                        <button
                          onClick={() => handleCopy(currentMethodInfo?.number!, 'number')}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold border-2 transition-all shrink-0 active:scale-95",
                            copiedField === 'number' ? "bg-green-100 text-green-700 border-green-300" : "bg-blue-600 text-white border-blue-600"
                          )}
                        >
                          {copiedField === 'number' ? <><Check className="h-3.5 w-3.5" />Copiado</> : <><Copy className="h-3.5 w-3.5" />Copiar</>}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {selectedMethod !== 'izipay' && (<>
            {/* Reference code + Voucher (solo métodos manuales) â€” inline */}
            <div className={cn(
              "rounded-xl p-3 border-2 space-y-1.5",
              referenceCode.trim() ? "border-green-300 bg-green-50/50" : "border-amber-300 bg-amber-50/30"
            )}>
              <Label className="font-bold text-xs flex items-center gap-1">
                <Hash className="h-3.5 w-3.5 text-red-500" />
                N° de operación <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="Ej: 123456789"
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                className="font-mono text-sm font-semibold h-10"
              />
              {referenceCode.trim() && <p className="text-[10px] text-green-600 font-medium">✅ Código ingresado</p>}
            </div>

            <div className={cn(
              "rounded-xl p-3 border-2 space-y-1.5",
              voucherFile ? "border-green-300 bg-green-50/50" : "border-amber-300 bg-amber-50/30"
            )}>
              <Label className="font-bold text-xs flex items-center gap-1">
                <ImageIcon className="h-3.5 w-3.5 text-red-500" />
                Foto del comprobante <span className="text-red-500">*</span>
              </Label>

              {voucherPreview ? (
                <div className="relative">
                  <img src={voucherPreview} alt="Voucher" className="w-full max-h-36 object-contain rounded-lg border border-green-300" />
                  <button
                    onClick={() => { setVoucherFile(null); setVoucherPreview(null); }}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="text-[10px] text-green-600 font-medium mt-1">✅ Foto adjuntada</p>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-20 border-2 border-dashed border-amber-400 rounded-lg flex flex-col items-center justify-center gap-1 hover:border-amber-500 hover:bg-amber-100/50 transition-all text-amber-600"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-xs font-semibold">Toca para adjuntar captura</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>

            {/* Note */}
            <Input
              placeholder="Nota adicional (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs h-9"
            />
            </>)}

            {/* Extra vouchers â€” COLLAPSIBLE */}
            {selectedMethod !== 'izipay' && extraVouchers.map((ev, idx) => {
              const isCollapsed = collapsedExtras.has(ev.id);
              const isComplete = !!(ev.referenceCode.trim() && ev.voucherFile && ev.amount && parseFloat(ev.amount) > 0);

              if (isCollapsed && isComplete) {
                // Collapsed summary
                return (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 cursor-pointer"
                    onClick={() => setCollapsedExtras(prev => { const n = new Set(prev); n.delete(ev.id); return n; })}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span className="text-xs font-semibold text-gray-700">
                        Voucher {idx + 2} â€” S/ {parseFloat(ev.amount).toFixed(2)} â€” {currentMethodInfo?.label} âœ“
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setExtraVouchers(prev => prev.filter(v => v.id !== ev.id)); }}
                      className="text-red-400 hover:text-red-600 p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              }

              // Expanded form
              return (
                <div key={ev.id} className="border-2 border-blue-200 rounded-xl p-3 space-y-2 bg-blue-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-700">ðŸ’³ Comprobante {idx + 2}</span>
                    <button onClick={() => setExtraVouchers(prev => prev.filter(v => v.id !== ev.id))} className="text-red-400 hover:text-red-600 p-0.5">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-xs">S/</span>
                    <Input type="number" min="0.01" step="0.01" placeholder="Monto" value={ev.amount}
                      onChange={(e) => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, amount: e.target.value } : v))}
                      className="pl-8 font-mono text-sm h-9" />
                  </div>

                  <Input
                    placeholder="N° operación"
                    value={ev.referenceCode}
                    onChange={(e) => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, referenceCode: e.target.value } : v))}
                    className="font-mono text-sm h-9"
                  />

                  {ev.voucherPreview ? (
                    <div className="relative">
                      <img src={ev.voucherPreview} alt="Voucher" className="w-full max-h-28 object-contain rounded-lg border border-green-200" />
                      <button onClick={() => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, voucherFile: null, voucherPreview: null } : v))}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => extraFileRefs.current[ev.id]?.click()}
                        className="w-full h-16 border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center gap-1 hover:bg-blue-100/50 text-blue-500 text-xs font-semibold">
                        <Upload className="h-4 w-4" />
                        Adjuntar foto
                      </button>
                    </>
                  )}
                  <input
                    ref={el => { extraFileRefs.current[ev.id] = el; }}
                    type="file" accept="image/*" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) { toast({ title: 'Imagen muy grande', description: 'Máximo 5 MB', variant: 'destructive' }); return; }
                      const reader = new FileReader();
                      reader.onload = (ev2) => setExtraVouchers(prev => prev.map(v => v.id === ev.id ? { ...v, voucherFile: file, voucherPreview: ev2.target?.result as string } : v));
                      reader.readAsDataURL(file);
                    }}
                  />

                  {/* Collapse button when complete */}
                  {isComplete && (
                    <Button size="sm" variant="outline" className="w-full text-xs h-8 text-blue-600 border-blue-300"
                      onClick={() => setCollapsedExtras(prev => { const n = new Set(prev); n.add(ev.id); return n; })}>
                      âœ“ Minimizar
                    </Button>
                  )}
                </div>
              );
            })}

            {/* Add extra voucher — solo métodos manuales */}
            {selectedMethod !== 'izipay' && (
            <button
              onClick={() => {
                const newCollapsed = new Set(collapsedExtras);
                extraVouchers.forEach(ev => {
                  if (ev.referenceCode.trim() && ev.voucherFile && ev.amount && parseFloat(ev.amount) > 0) {
                    newCollapsed.add(ev.id);
                  }
                });
                setCollapsedExtras(newCollapsed);
                setExtraVouchers(prev => [...prev, { id: `extra_${Date.now()}`, referenceCode: '', voucherFile: null, voucherPreview: null, amount: '' }]);
              }}
              className="w-full h-9 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center gap-1.5 text-gray-500 font-semibold hover:bg-gray-50 transition-all text-xs"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Otro comprobante (pago en partes)
            </button>
            )}

            {/* ── BLOQUE IziPay: pago por redirección ── */}
            {IZIPAY_ENABLED && selectedMethod === 'izipay' && (
              <div className="space-y-3">

                {/* ── Cuenta regresiva: sesión activa de intento anterior ── */}
                {izipayStep === 'locked' && (
                  <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 space-y-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
                        <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                      </div>
                      <p className="font-bold text-amber-800 text-sm">
                        Sesión de pago en proceso
                      </p>
                    </div>

                    <p className="text-xs text-amber-700 leading-relaxed">
                      Hay un intento de pago activo para este alumno.<br/>
                      Puede ser una página que quedó abierta.
                    </p>

                    <div className="flex flex-col items-center gap-1">
                      <div className="w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-300 flex items-center justify-center">
                        <span className="text-3xl font-black text-amber-700 tabular-nums">
                          {lockSecondsLeft}
                        </span>
                      </div>
                      <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">
                        {lockSecondsLeft === 1 ? 'segundo' : 'segundos'} restante{lockSecondsLeft !== 1 ? 's' : ''}
                      </p>
                    </div>

                    <p className="text-[11px] text-amber-600">
                      El botón se habilitará automáticamente cuando llegue a <strong>0</strong>.
                    </p>

                    {/* Si el padre ya pagó, lo enviamos a la página de estado */}
                    <a
                      href="/pago/retorno"
                      className="flex items-center justify-center gap-1.5 w-full text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg py-2 px-3 hover:bg-emerald-100 transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      ¿Ya pagaste? — Ver estado del pago
                    </a>
                  </div>
                )}

                {/* Botón para iniciar pago */}
                {izipayStep === 'idle' && (
                  <div className="space-y-2">
                    {isViewAsMode && (
                      <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 text-xs text-amber-800 font-semibold flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                        Modo "Ver como" activo. Los pagos con tarjeta están bloqueados por seguridad.
                      </div>
                    )}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                      <p className="font-bold flex items-center gap-1.5">
                        <CreditCard className="h-4 w-4" /> Pago instantáneo en línea
                      </p>
                      <p className="text-xs text-blue-600 mt-1">
                        Tarjeta Visa/Mastercard o Yape QR.
                        Tu saldo se acredita <strong>inmediatamente</strong>.
                        Serás redirigido a la pasarela segura de IziPay.
                      </p>
                    </div>
                    <Button
                      onClick={handleInitIziPay}
                      disabled={isRedirecting || !amount || parseFloat(amount) < IZIPAY_MIN_AMOUNT || isViewAsMode}
                      className="w-full h-12 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 font-bold text-base gap-2 shadow-lg shadow-red-200 disabled:from-gray-300 disabled:to-gray-300"
                    >
                      {isRedirecting
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Preparando pago...</>
                        : <><CreditCard className="h-4 w-4" /> Pagar con Tarjeta / Yape — S/ {parseFloat(amount || '0').toFixed(2)}</>
                      }
                    </Button>

                    {/* Sellos de seguridad */}
                    <div className="pt-1 space-y-2">
                      <div className="flex items-center justify-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <path d="m9 12 2 2 4-4"/>
                          </svg>
                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-none">SSL</span>
                        </div>
                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                          <svg viewBox="0 0 780 500" className="h-3.5 w-auto opacity-50" xmlns="http://www.w3.org/2000/svg">
                            <rect width="780" height="500" fill="#1a1f71" rx="40"/>
                            <text x="390" y="330" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="280" fill="white" fontStyle="italic">VISA</text>
                          </svg>
                        </div>
                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                          <svg viewBox="0 0 152 108" className="h-3.5 w-auto opacity-50" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="52" cy="54" r="40" fill="#eb001b"/>
                            <circle cx="100" cy="54" r="40" fill="#f79e1b"/>
                            <path d="M76 22.4a40 40 0 0 1 0 63.2A40 40 0 0 1 76 22.4z" fill="#ff5f00"/>
                          </svg>
                        </div>
                        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                          <svg viewBox="0 0 24 24" className="w-3 h-3 text-gray-400 flex-shrink-0" fill="currentColor">
                            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
                          </svg>
                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-none">PCI DSS</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 text-center leading-relaxed px-1">
                        Transacción tokenizada · HMAC-SHA256 · No almacenamos datos de tu tarjeta
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Submit + barra de progreso (solo para métodos manuales) */}
            {selectedMethod !== 'izipay' && uploadProgress !== null && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-500 font-medium">
                  <span>{uploadPhaseLabel || 'Procesando...'}</span>
                  <span className="font-bold text-blue-600">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-center">
                  No cierres esta ventana hasta que el comprobante se envíe.
                </p>
              </div>
            )}
            {selectedMethod !== 'izipay' && (
            <Button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="w-full h-12 bg-green-600 hover:bg-green-700 font-bold text-base shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{uploadPhaseLabel || 'Enviando...'}</>
              ) : !referenceCode.trim() ? (
                <>Falta el N° de operación</>
              ) : !voucherFile ? (
                <>Falta adjuntar la foto</>
              ) : extraVouchers.length > 0 ? (
                <><Send className="h-4 w-4 mr-2" />Enviar {1 + extraVouchers.length} comprobantes</>
              ) : (
                <><Send className="h-4 w-4 mr-2" />Enviar comprobante</>
              )}
            </Button>
            )}

            </div>
            )} {/* fin divulgación progresiva */}

            {onCancel && (
              <button type="button" onClick={onCancel} className="w-full text-center text-[10px] text-gray-400 hover:text-gray-600 underline py-0.5">
                Cancelar â€” volver
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  // ─────────────────────── PASO 4: Éxito ───────────────────────
  const renderStepSuccess = () => {
    // El éxito de IziPay se muestra en /pago/retorno (modo redirección).
    // Este paso solo aplica para pagos manuales (Yape, Plin, Transferencia).
    const wasIzipay = false;

    return (
      <div className="text-center space-y-4 py-2">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-12 w-12 text-green-600" />
      </div>

      <div>
          <h3 className="text-xl font-bold text-gray-900">
            {wasIzipay ? '¡Pago confirmado!' : '¡Comprobante enviado!'}
          </h3>
          <p className="text-gray-500 mt-1 text-sm">
          {requestType === 'lunch_payment'
              ? <>Pago de almuerzo de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
            : requestType === 'debt_payment'
            ? isCombinedPayment
                ? <>Pago combinado de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
                : <>Pago de deuda de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
              : <>Recarga de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
          }
        </p>
      </div>


      {isCombinedPayment && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-left">
            <p className="text-xs font-semibold text-emerald-800">
              Pago combinado para {combinedStudentIds?.length || 0} alumno(s)
          </p>
        </div>
      )}

        {/* Próximos pasos — solo para pagos manuales */}
        {!wasIzipay && (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left space-y-2">
        <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
          <Clock className="h-4 w-4" /> ¿Qué pasa ahora?
        </p>
        <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
          <li>Un administrador verificará tu comprobante</li>
          {requestType === 'lunch_payment' ? (
                <><li>Tu pedido quedará <strong>confirmado</strong> al aprobarse</li></>
          ) : requestType === 'debt_payment' ? (
                <><li>Tus compras pendientes se marcarán como <strong>pagadas</strong></li></>
          ) : (
                <><li>El saldo se acreditará en menos de 24 horas</li></>
          )}
        </ul>
      </div>
        )}

      <Button onClick={onClose} className="w-full h-11 bg-blue-600 hover:bg-blue-700 font-semibold">
        Entendido
      </Button>
    </div>
  );
  };

  if (RECHARGES_MAINTENANCE && requestType === 'recharge' && !izipayTestMode && !isIzipayPilotUser) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Diálogo</DialogTitle>
          <div className="text-center space-y-4 py-4">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Recargas en mantenimiento</h3>
            <p className="text-sm text-gray-600">
              El módulo de recargas está temporalmente suspendido mientras lo mejoramos.
              Su saldo actual sigue activo para compras en el kiosco.
            </p>
            <p className="text-xs text-gray-500">
              Para consultas: <strong>991 236 870</strong> (WhatsApp)
            </p>
            <Button onClick={onClose} className="w-full h-10 bg-amber-600 hover:bg-amber-700">
              Entendido
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={isRedirecting ? undefined : onClose}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>

        {/* ── Overlay de redirección ───────────────────────────────────────────
            Aparece mientras se prepara la orden y se redirige a IziPay.
            Cubre toda la pantalla para que el padre no toque nada durante el proceso. */}
        {isRedirecting && (
          <div className="fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center gap-5 p-6">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
              <Loader2 className="h-9 w-9 animate-spin text-blue-600" />
            </div>
            <div className="text-center space-y-2 max-w-xs">
              <p className="text-lg font-bold text-gray-900">Preparando pago seguro...</p>
              <p className="text-sm text-gray-500 leading-relaxed">
                Conectando con IziPay. Serás redirigido en un momento.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
              <svg className="h-4 w-4 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4"/>
              </svg>
              <p className="text-xs font-semibold text-blue-700">Conexión segura · TLS · PCI DSS</p>
            </div>
          </div>
        )}

        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            {step === 'success'
              ? '¡Listo!'
              : isCombinedPayment
              ? 'Pagar Todo Junto'
              : requestType === 'lunch_payment'
              ? 'Pagar Almuerzo'
              : requestType === 'debt_payment'
              ? 'Pagar Deuda'
              : 'Recargar Saldo'}
          </DialogTitle>
          {step !== 'success' && (
            <DialogDescription>
              {isCombinedPayment ? (
                <>
                  Para <strong>{studentName}</strong>
                  <span className="ml-1 text-emerald-600 text-[10px] font-semibold">(pago combinado)</span>
                </>
              ) : (
                <>Para <strong>{studentName}</strong></>
              )}
              {step !== 'amount' && <> â€” <strong>S/ {parseFloat(amount || '0').toFixed(2)}</strong></>}
            </DialogDescription>
          )}
        </DialogHeader>

        {loadingConfig ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            {step === 'combined' && renderCombinedView()}
            {step === 'success' && renderStepSuccess()}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

