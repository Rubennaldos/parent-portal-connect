import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
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
}

type PaymentMethod = 'yape' | 'plin' | 'transferencia';
type PaymentMethodOrNull = PaymentMethod | null;

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
}: RechargeModalProps) {
  const RECHARGES_MAINTENANCE = true; // Cambiar a false cuando se reactive

  const isCombinedPayment = !!(combinedStudentIds && combinedStudentIds.length > 1);
  const { user } = useAuth();
  const { toast } = useToast();
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
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  // 0-100 mientras se sube, null cuando no hay subida activa
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhaseLabel, setUploadPhaseLabel] = useState('');
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  // ── Comprobantes adicionales (pago en partes) ──
  const [extraVouchers, setExtraVouchers] = useState<ExtraVoucher[]>([]);
  const extraFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const quickAmounts = [10, 20, 50, 100, 150, 200];

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
    }
  }, [isOpen, studentId]);

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
        .select('yape_number, yape_holder, yape_enabled, plin_number, plin_holder, plin_enabled, bank_account_info, bank_account_holder, transferencia_enabled, bank_name, bank_account_number, bank_cci, show_payment_info')
        .eq('school_id', student.school_id)
        .single();

      setPaymentConfig(config || null);

      // Auto-seleccionar el primer método disponible
      if (config) {
        if (config.yape_enabled !== false && config.yape_number) {
          setSelectedMethod('yape');
        } else if (config.plin_enabled !== false && config.plin_number) {
          setSelectedMethod('plin');
        } else if (config.transferencia_enabled !== false && (config.bank_account_number || config.bank_cci || config.bank_account_info)) {
          setSelectedMethod('transferencia');
        } else {
          setSelectedMethod(null);
        }
      }
    } catch (err) {
      console.error('Error al cargar config de pagos:', err);
    } finally {
      setLoadingConfig(false);
    }
  };

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

  // ── Helper: comprimir imagen antes de subir ──
  // Convierte CUALQUIER formato (HEIC, HEIF, PNG, WebP, etc.) a JPEG comprimido.
  // Máximo 800px, calidad 60% → resultado siempre menor a 200 KB.
  // Si el navegador no puede decodificar el formato (ej. HEIC en Android),
  // intenta de todas formas y si falla convierte el archivo crudo a Blob seguro.
  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const MAX_PX  = 800;
      const QUALITY = 0.60;

      const convertViaCanvas = (src: string) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(src);
          let { width, height } = img;
          if (width > MAX_PX || height > MAX_PX) {
            const ratio = Math.min(MAX_PX / width, MAX_PX / height);
            width  = Math.round(width  * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => resolve(blob ?? new Blob([file], { type: 'image/jpeg' })),
            'image/jpeg',
            QUALITY
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(src);
          // Si el browser no puede decodificar (ej. HEIC en Android),
          // intentar con FileReader como fallback antes de rendirnos
          const reader = new FileReader();
          reader.onload = (e) => {
            const img2 = new Image();
            img2.onload = () => {
              let { width, height } = img2;
              if (width > MAX_PX || height > MAX_PX) {
                const ratio = Math.min(MAX_PX / width, MAX_PX / height);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
              }
              const canvas2 = document.createElement('canvas');
              canvas2.width  = width;
              canvas2.height = height;
              const ctx2 = canvas2.getContext('2d')!;
              ctx2.fillStyle = '#ffffff';
              ctx2.fillRect(0, 0, width, height);
              ctx2.drawImage(img2, 0, 0, width, height);
              canvas2.toBlob(
                (blob) => resolve(blob ?? new Blob([file], { type: 'image/jpeg' })),
                'image/jpeg',
                QUALITY
              );
            };
            img2.onerror = () => {
              // Ãšltimo recurso: subir el archivo original como blob binario
              // (el admin al menos verá que llegó algo, aunque no se visualice)
              resolve(new Blob([file], { type: file.type || 'image/jpeg' }));
            };
            img2.src = e.target?.result as string;
          };
          reader.onerror = () => resolve(new Blob([file], { type: file.type || 'image/jpeg' }));
          reader.readAsDataURL(file);
        };
        img.src = src;
      };

      convertViaCanvas(URL.createObjectURL(file));
    });
  };

  // ── Helper: subir imagen a storage ──
  // ⚠️ LANZA error si falla â€” así el insert no se hace sin foto
  const uploadVoucherImage = async (
    file: File,
    userId: string,
    onProgress?: (pct: number) => void
  ): Promise<string> => {
    const compressed = await compressImage(file);
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const retryName = `${userId}/voucher_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        // onUploadProgress disponible en @supabase/storage-js >= 2.5; se ignora en versiones anteriores
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uploadOptions: any = { upsert: false, contentType: 'image/jpeg' };
        if (onProgress) {
          uploadOptions.onUploadProgress = (ev: { loaded: number; total: number }) => {
            if (ev?.total > 0) onProgress(Math.round((ev.loaded / ev.total) * 100));
          };
        }
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vouchers')
          .upload(retryName, compressed, uploadOptions);

        if (uploadError) {
          console.error(`[Voucher] Intento ${attempt}/3:`, uploadError.message, (uploadError as any)?.statusCode);
          lastError = Object.assign(new Error(uploadError.message), {
            statusCode: (uploadError as any)?.statusCode,
          });
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }

        const { data: { publicUrl } } = supabase.storage.from('vouchers').getPublicUrl(uploadData.path);
        return publicUrl;
      } catch (networkErr: unknown) {
        console.error(`[Voucher] Error de red intento ${attempt}/3:`, networkErr);
        lastError = networkErr instanceof Error ? networkErr : new Error('Error de red');
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }

    // Clasificar el error para dar un mensaje accionable según la causa real
    const msg  = lastError?.message?.toLowerCase() ?? '';
    const code = String((lastError as any)?.statusCode ?? '');
    let userMsg: string;
    if (code === '413' || msg.includes('413') || msg.includes('payload too large') || msg.includes('too large')) {
      userMsg = 'La imagen es demasiado pesada. Toma una captura de pantalla del comprobante en lugar de adjuntar la foto original (la captura pesa mucho menos).';
    } else if (code === '403' || msg.includes('403') || msg.includes('not allowed') || msg.includes('permission')) {
      userMsg = 'El servidor rechazó la imagen por restricciones de seguridad. Usa una imagen JPG o PNG estándar y vuelve a intentar.';
    } else if (lastError?.name === 'AbortError' || msg.includes('timeout') || msg.includes('timed out')) {
      userMsg = 'La subida está tardando demasiado. Intenta conectarte a WiFi en lugar de datos móviles.';
    } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch') || msg.includes('load failed')) {
      userMsg = 'No se pudo conectar con el servidor. Verifica que tienes internet activo. Si usas datos móviles, prueba cambiando a WiFi.';
    } else {
      userMsg = `No se pudo subir la foto del comprobante. ${lastError?.message || 'Intenta de nuevo en unos minutos.'}`;
    }
    throw new Error(userMsg);
  };

  // ── Helper: verificar duplicado de código de operación ──
  // Devuelve { isDuplicate: false } si el único registro existente está en 'rejected'
  // (los rechazados se pueden reutilizar). Solo bloquea 'pending' y 'approved'.
  // Si el código ya existe Y es del mismo padre → isOwnRequest = true (no es un error,
  // significa que su solicitud YA está registrada y puede ir directo a éxito).
  const checkDuplicate = async (
    code: string,
    parentId: string
  ): Promise<{ isDuplicate: boolean; isOwnRequest: boolean; existingStatus?: string }> => {
    const { data } = await supabase
      .from('recharge_requests')
      .select('id, status, parent_id')
      .eq('reference_code', code.trim())
      .neq('status', 'rejected')   // rechazados NO bloquean el reintento
      .limit(1);
    if (data && data.length > 0) {
      return {
        isDuplicate: true,
        isOwnRequest: data[0].parent_id === parentId,
        existingStatus: data[0].status,
      };
    }
    return { isDuplicate: false, isOwnRequest: false };
  };

  // ── Pago 100% con billetera: no requiere voucher bancario ───────────────────
  const isFullWalletPayment =
    requestType === 'debt_payment' &&
    walletAmountToUse > 0 &&
    walletAmountToUse >= (suggestedAmount ?? 0);

  const handleSubmit = async () => {
    if (!user) return;
    if (loading) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    // ── CAMINO A: Pago 100% con billetera interna ─────────────────────────────
    // No se pide voucher ni código de operación. El RPC valida y ejecuta en BD.
    if (isFullWalletPayment) {
      setLoading(true);
      try {
        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          'pay_debt_with_wallet_only',
          {
            p_student_id:      studentId,
            p_debt_tx_ids:     (paidTransactionIds || []) as any,
            p_lunch_order_ids: (lunchOrderIds || []) as any,
          }
        );
        if (rpcErr) {
          const msg = rpcErr.message || '';
          if (msg.includes('INSUFFICIENT_WALLET')) {
            toast({
              title: '⚠️ Saldo insuficiente',
              description: 'Tu saldo ya no alcanza. Recarga la página e intenta de nuevo.',
              variant: 'destructive',
            });
          } else if (msg.includes('CONFLICT')) {
            toast({
              title: '⚠️ Deuda ya cobrada',
              description: 'Este pago fue procesado por otro canal. Recarga la página.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Error al procesar el pago',
              description: msg || 'Intenta de nuevo en unos segundos.',
              variant: 'destructive',
            });
          }
          return;
        }
        setStep('success');
      } catch (err: any) {
        toast({
          title: 'Error inesperado',
          description: err.message || 'Contacta al administrador.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
        setUploadProgress(null);
        submittingRef.current = false;
      }
      return;
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast({ title: 'Monto inválido', description: 'Ingresa un monto mayor a S/ 0', variant: 'destructive' });
      submittingRef.current = false;
      return;
    }
    // Helper local: salida limpia antes del try (resetea ambos guards)
    const earlyExit = (title: string, description: string) => {
      submittingRef.current = false;
      toast({ title, description, variant: 'destructive' });
    };

    if (requestType === 'recharge' && numAmount > 2000) {
      earlyExit('Monto muy alto', 'El monto máximo de recarga es S/ 2,000. Para montos mayores, contacta al administrador.');
      return;
    }

    // ── Validar código principal obligatorio ──
    if (!referenceCode.trim()) {
      earlyExit('🚫 Número de operación obligatorio', 'Debes ingresar el número de operación o código de transacción para continuar.');
      return;
    }

    // ── Validar foto del comprobante principal obligatoria ──
    if (!voucherFile) {
      earlyExit('🚫 Foto del comprobante obligatoria', 'Debes adjuntar la captura o foto del comprobante de pago para continuar.');
      return;
    }

    // ── Validar comprobantes adicionales ──
    for (const ev of extraVouchers) {
      if (!ev.referenceCode.trim()) {
        earlyExit('🚫 Código obligatorio en comprobante adicional', 'Cada comprobante adicional debe tener su número de operación.');
        return;
      }
      if (!ev.voucherFile) {
        earlyExit('🚫 Foto obligatoria en comprobante adicional', 'Cada comprobante adicional debe tener su foto adjuntada.');
        return;
      }
      const evAmount = parseFloat(ev.amount);
      if (!evAmount || evAmount <= 0) {
        earlyExit('Monto inválido en comprobante adicional', 'Ingresa el monto pagado en cada comprobante adicional.');
        return;
      }
    }

    // ── Verificar que no haya códigos repetidos entre sí ──
    const allCodes = [referenceCode.trim(), ...extraVouchers.map(ev => ev.referenceCode.trim())];
    const uniqueCodes = new Set(allCodes);
    if (uniqueCodes.size !== allCodes.length) {
      earlyExit('🚫 Códigos repetidos', 'Cada comprobante debe tener un código de operación diferente.');
      return;
    }

    setLoading(true);
    // Flag para saber en qué fase ocurrió el error (determina el mensaje genérico correcto)
    let uploadStarted = false;
    try {
      // ── Verificar duplicados en BD para TODOS los códigos ──
      for (const code of allCodes) {
        const { isDuplicate, isOwnRequest, existingStatus } = await checkDuplicate(code, user.id);
        if (isDuplicate) {
          // Si el código ya existe Y es solicitud PROPIA en pending/approved → ya está registrado.
          // No es un error: mostrar pantalla de éxito directamente.
          if (isOwnRequest && (existingStatus === 'pending' || existingStatus === 'approved')) {
            setStep('success');
            setLoading(false);
            submittingRef.current = false;
            return;
          }
          // Código de otro padre o estado inesperado → pedir número diferente
          const statusLabel =
            existingStatus === 'approved' ? 'ya fue APROBADO' :
            existingStatus === 'pending'  ? 'está PENDIENTE de revisión' :
                                            'ya está en proceso';
          toast({
            variant: 'destructive',
            title: '🚫 Código ya registrado',
            description:
              `El código "${code}" ${statusLabel} en el sistema. ` +
              `Si tu comprobante anterior fue RECHAZADO, puedes usar el mismo código sin problema. ` +
              `Si está pendiente o aprobado, usa un número de operación diferente.`,
            duration: 10000,
          });
          return;
        }
      }

      // ── Prevenir doble envío de voucher para los mismos pedidos ──
      if ((requestType === 'lunch_payment' || requestType === 'debt_payment') && lunchOrderIds && lunchOrderIds.length > 0) {
        const { data: existingReq } = await supabase
          .from('recharge_requests')
          .select('id, status')
          .eq('parent_id', user.id)
          .in('request_type', ['lunch_payment', 'debt_payment'])
          .eq('status', 'pending')
          .contains('lunch_order_ids', lunchOrderIds);

        if (existingReq && existingReq.length > 0) {
          toast({
            variant: 'destructive',
            title: '⚠️ Comprobante ya enviado',
            description: 'Ya enviaste un comprobante para estos pedidos. Espera la revisión del administrador.',
          });
          setLoading(false);
          return;
        }
      }

      // Nota: debt_payment permite múltiples envíos (pagos en partes / diferencias)
      // No se bloquea aquí â€” el admin verá todos los comprobantes y los conciliará

      const { data: student } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .single();

      // ── PASO 1: Subir TODAS las imágenes primero (si falla alguna, no insertamos nada) ──
      const totalImages = 1 + extraVouchers.length;

      // Calcula el rango de progreso que corresponde a esta imagen dentro del total.
      // Ej: 2 imágenes → imagen 0 va de 0% a 47%, imagen 1 va de 47% a 94%.
      const imageSlice = Math.floor(94 / totalImages);

      setUploadPhaseLabel('Subiendo foto...');
      setUploadProgress(0);
      uploadStarted = true;

      const voucherUrl = await uploadVoucherImage(voucherFile, user.id, (pct) => {
        setUploadProgress(Math.round((pct * imageSlice) / 100));
      });

      const extraUrls: string[] = [];
      for (let i = 0; i < extraVouchers.length; i++) {
        const ev = extraVouchers[i];
        const baseOffset = imageSlice * (i + 1);
        setUploadPhaseLabel(
          extraVouchers.length > 1 ? `Subiendo foto ${i + 2} de ${totalImages}...` : 'Subiendo foto adicional...'
        );
        const evUrl = await uploadVoucherImage(ev.voucherFile!, user.id, (pct) => {
          setUploadProgress(baseOffset + Math.round((pct * imageSlice) / 100));
        });
        extraUrls.push(evUrl);
      }

      setUploadPhaseLabel('Guardando registro...');
      setUploadProgress(96);

      const baseDescription = requestDescription || (
        requestType === 'lunch_payment' ? 'Pago de almuerzo' :
        requestType === 'debt_payment' ? (isCombinedPayment ? `Pago combinado: ${studentName}` : 'Pago de deuda pendiente') :
        'Recarga de saldo'
      );

      const totalParts = 1 + extraVouchers.length;

      const effectiveNotes = isCombinedPayment
        ? `${notes.trim() ? notes.trim() + ' | ' : ''}Pago combinado: ${studentName}`
        : (notes.trim() || null);

      // ── PASO 2: Registrar el pago ─────────────────────────────────────────────
      // CAMINO B: Pago dividido (billetera + voucher) → RPC con validación server-side
      // CAMINO C: Pago sin billetera → INSERT directo (flujo existente)
      if (walletAmountToUse > 0) {
        // CAMINO B: usar RPC para que el backend valide que wallet_amount ≤ wallet_balance real.
        // Esto cierra la vulnerabilidad de payload tampering (Escenario 2 de QA).
        const { error: rpcError } = await supabase.rpc('submit_voucher_with_split', {
          p_student_id:          studentId,
          p_debt_tx_ids:         (paidTransactionIds || []) as any,
          p_lunch_order_ids:     (lunchOrderIds || []) as any,
          p_wallet_amount:       walletAmountToUse,
          p_voucher_amount:      numAmount,
          p_voucher_url:         voucherUrl,
          p_reference_code:      referenceCode.trim(),
          p_invoice_type:        invoiceType || null,
          p_invoice_client_data: (invoiceClientData as any) || null,
        });
        if (rpcError) {
          const msg = rpcError.message || '';
          if (msg.includes('INSUFFICIENT_WALLET')) {
            throw new Error(
              'Tu saldo a favor bajó entre que abriste la pantalla y enviaste el pago. ' +
              'Recarga la página e intenta de nuevo.'
            );
          }
          throw rpcError;
        }
      } else {
        // CAMINO C: pago sin billetera → INSERT directo (sin cambios al flujo existente)
        const { error: insertError } = await supabase.from('recharge_requests').insert({
          student_id: studentId,
          parent_id: user.id,
          school_id: student?.school_id || null,
          amount: numAmount,
          wallet_amount: 0,
          payment_method: selectedMethod,
          reference_code: referenceCode.trim(),
          voucher_url: voucherUrl,
          notes: effectiveNotes,
          status: 'pending',
          request_type: requestType,
          description: totalParts > 1 ? `${baseDescription} (Pago 1 de ${totalParts})` : baseDescription,
          lunch_order_ids: lunchOrderIds || null,
          paid_transaction_ids: paidTransactionIds || null,
          invoice_type: invoiceType || null,
          invoice_client_data: invoiceClientData || null,
        });
        if (insertError) throw insertError;
      }

      for (let i = 0; i < extraVouchers.length; i++) {
        const ev = extraVouchers[i];
        const { error: evError } = await supabase.from('recharge_requests').insert({
          student_id: studentId,
          parent_id: user.id,
          school_id: student?.school_id || null,
          amount: parseFloat(ev.amount),
          payment_method: selectedMethod,
          reference_code: ev.referenceCode.trim(),
          voucher_url: extraUrls[i],
          notes: effectiveNotes,
          status: 'pending',
          request_type: requestType,
          description: `${baseDescription} (Pago ${i + 2} de ${totalParts})`,
          lunch_order_ids: lunchOrderIds || null,
          paid_transaction_ids: paidTransactionIds || null,
        });
        if (evError) throw evError;
      }

      setUploadProgress(100);
      setUploadPhaseLabel('');
      setStep('success');
    } catch (err: any) {
      const rawMsg: string = err?.message || err?.details || String(err) || '';
      console.error('[RechargeModal] Error al enviar solicitud:', rawMsg, err);

      // ── Clasificar el error y dar mensaje humano ──────────────────────────

      // 1. Código de operación duplicado (constraint BD — race condition entre tabs / doble tap)
      if (
        rawMsg.includes('idx_recharge_unique_ref_code') ||
        (rawMsg.toLowerCase().includes('duplicate key') && rawMsg.toLowerCase().includes('reference'))
      ) {
        // Verificar si el registro que chocó ES del mismo padre.
        // Si es propio y está pending/approved → el insert anterior llegó bien → mostrar éxito.
        try {
          const { data: myReq } = await supabase
            .from('recharge_requests')
            .select('id, status')
            .eq('reference_code', referenceCode.trim())
            .eq('parent_id', user.id)
            .neq('status', 'rejected')
            .limit(1);
          if (myReq && myReq.length > 0) {
            setStep('success');
            return;
          }
        } catch {
          // si falla la consulta de recuperación, caer en el toast de error
        }
        toast({
          variant: 'destructive',
          title: '⚠️ Código ya registrado',
          description:
            `Ese número de operación ya tiene un pago en el sistema. ` +
            `Si ya enviaste este comprobante, recarga la página para verlo. ` +
            `Si tu pago anterior fue RECHAZADO, actualiza la página e intenta de nuevo.`,
          duration: 12000,
        });
        return;
      }

      // 2. Error del upload de foto (mensaje ya viene accionable)
      const isUploadError =
        rawMsg.toLowerCase().includes('foto') ||
        rawMsg.toLowerCase().includes('subir') ||
        rawMsg.toLowerCase().includes('imagen') ||
        rawMsg.toLowerCase().includes('servidor') ||
        rawMsg.toLowerCase().includes('internet') ||
        rawMsg.toLowerCase().includes('wifi') ||
        rawMsg.toLowerCase().includes('tardando');

      if (isUploadError) {
        toast({
          title: 'Error al subir la foto',
          description: rawMsg,
          variant: 'destructive',
          duration: 10000,
        });
        return;
      }

      // 3. Error genérico: distinguir si ocurrió antes o después del upload
      if (!uploadStarted) {
        // El error fue antes de intentar subir la foto (BD caída, red cortada, etc.)
        toast({
          title: 'No se pudo verificar tu solicitud',
          description:
            'Hubo un problema de conexión antes de enviar el comprobante. ' +
            'Tu foto NO fue subida. Verifica tu conexión e intenta de nuevo.',
          variant: 'destructive',
          duration: 10000,
        });
      } else {
        // El error fue después del upload: foto en storage pero registro no guardado
        toast({
          title: 'Error al guardar tu solicitud',
          description:
            'La foto se subió correctamente, pero no se pudo registrar el comprobante. ' +
            'Espera un momento y vuelve a intentarlo. Si el error persiste, contacta al administrador.',
          variant: 'destructive',
          duration: 10000,
        });
      }
    } finally {
      setLoading(false);
      setUploadProgress(null);
      setUploadPhaseLabel('');
      submittingRef.current = false;
    }
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
    bankName?: string | null;
    accountNumber?: string | null;
    cci?: string | null;
  }> = {
    yape: {
      label: 'Yape',
      icon: <YapeLogo className="w-8 h-8" />,
      color: 'purple',
      enabled: paymentConfig?.yape_enabled ?? true,
      number: paymentConfig?.yape_number || null,
      holder: paymentConfig?.yape_holder || null,
      hint: 'Abre tu app de Yape y transfiere al número indicado.',
    },
    plin: {
      label: 'Plin',
      icon: <PlinLogo className="w-8 h-8" />,
      color: 'green',
      enabled: paymentConfig?.plin_enabled ?? true,
      number: paymentConfig?.plin_number || null,
      holder: paymentConfig?.plin_holder || null,
      hint: 'Abre tu app de Plin y transfiere al número indicado.',
    },
    transferencia: {
      label: 'Transferencia',
      icon: <Building2 className="h-7 w-7 text-orange-600" />,
      color: 'orange',
      enabled: paymentConfig?.transferencia_enabled ?? true,
      // number se usa para saber si está disponible
      number: (paymentConfig?.bank_account_number || paymentConfig?.bank_cci || paymentConfig?.bank_account_info) ? 'available' : null,
      holder: paymentConfig?.bank_account_holder || null,
      hint: 'Realiza una transferencia bancaria con los datos indicados.',
      bankName: paymentConfig?.bank_name || null,
      accountNumber: paymentConfig?.bank_account_number || null,
      cci: paymentConfig?.bank_cci || null,
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
    const hasAnyMethod = !!(
      (paymentConfig?.yape_enabled !== false && paymentConfig?.yape_number) ||
      (paymentConfig?.plin_enabled !== false && paymentConfig?.plin_number) ||
      (paymentConfig?.transferencia_enabled !== false && (paymentConfig?.bank_account_number || paymentConfig?.bank_cci || paymentConfig?.bank_account_info))
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
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(methodInfo) as PaymentMethod[]).map((m) => {
                  const info = methodInfo[m];
                  const isAvailable = !!info.number && info.enabled;
                  const isSelected = selectedMethod === m;
                  return (
                    <button
                      key={m}
                      onClick={() => isAvailable && setSelectedMethod(m)}
                      disabled={!isAvailable}
                      className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all
                        ${isSelected && isAvailable ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white'}
                        ${!isAvailable ? 'opacity-30 cursor-not-allowed' : 'hover:border-gray-300 cursor-pointer'}
                      `}
                    >
                      <div className="h-10 w-10 flex items-center justify-center">{info.icon}</div>
                      <span className="text-xs font-semibold text-gray-800">{info.label}</span>
                      {!isAvailable && <span className="text-[10px] text-gray-400">No disponible</span>}
                    </button>
                  );
                })}
              </div>
            </div>

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

    const hasAnyMethod = !!(
      (paymentConfig?.yape_enabled !== false && paymentConfig?.yape_number) ||
      (paymentConfig?.plin_enabled !== false && paymentConfig?.plin_number) ||
      (paymentConfig?.transferencia_enabled !== false && (paymentConfig?.bank_account_number || paymentConfig?.bank_cci || paymentConfig?.bank_account_info))
    );

    const canSubmit = !!(
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
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(methodInfo) as PaymentMethod[]).map((m) => {
                  const info = methodInfo[m];
                  const isAvailable = !!info.number && info.enabled;
                  const isSelected = selectedMethod === m;
                  return (
                    <button
                      key={m}
                      onClick={() => isAvailable && setSelectedMethod(m)}
                      disabled={!isAvailable}
                      className={cn(
                        "p-2 rounded-xl border-2 flex flex-col items-center gap-0.5 transition-all",
                        isSelected && isAvailable ? "border-blue-500 bg-blue-50 shadow-sm" : "border-gray-200 bg-white",
                        !isAvailable && "opacity-30 cursor-not-allowed",
                        isAvailable && !isSelected && "hover:border-gray-300"
                      )}
                    >
                      <div className="h-8 w-8 flex items-center justify-center">{info.icon}</div>
                      <span className="text-[10px] font-bold text-gray-800">{info.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment details card */}
            {currentMethodInfo?.number && (
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

            {/* Reference code + Voucher â€” inline */}
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

            {/* Extra vouchers â€” COLLAPSIBLE */}
            {extraVouchers.map((ev, idx) => {
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

            {/* Add extra voucher */}
            <button
              onClick={() => {
                // Collapse all complete previous vouchers
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

            {/* Submit + barra de progreso */}
            {uploadProgress !== null && (
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
            <Button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="w-full h-12 bg-green-600 hover:bg-green-700 font-bold text-base shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{uploadPhaseLabel || 'Enviando...'}</>
              ) : !selectedMethod ? (
                <>Selecciona el método de pago</>
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

  // ─────────────────────── PASO 4: Ã‰xito ───────────────────────
  const renderStepSuccess = () => (
    <div className="text-center space-y-5 py-4">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-12 w-12 text-green-600" />
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-900">¡Comprobante enviado!</h3>
        <p className="text-gray-500 mt-2 text-sm">
          {requestType === 'lunch_payment'
            ? <>Recibimos tu pago de almuerzo de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
            : requestType === 'debt_payment'
            ? isCombinedPayment
              ? <>Recibimos tu pago combinado de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
              : <>Recibimos tu pago de deuda de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
            : <>Recibimos tu solicitud de recarga de <strong>S/ {parseFloat(amount).toFixed(2)}</strong> para <strong>{studentName}</strong>.</>
          }
        </p>
      </div>

      {isCombinedPayment && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-left">
          <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
            ðŸ‘¨â€ðŸ‘§â€ðŸ‘¦ Pago combinado para {combinedStudentIds?.length || 0} alumno(s)
          </p>
          <p className="text-[11px] text-emerald-600 mt-1">
            Este comprobante cubre las deudas de todos tus hijos incluidos.
          </p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left space-y-2">
        <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
          <Clock className="h-4 w-4" /> ¿Qué pasa ahora?
        </p>
        <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
          <li>Un administrador verificará tu comprobante</li>
          {requestType === 'lunch_payment' ? (
            <>
              <li>Tu pedido de almuerzo quedará <strong>confirmado</strong> al aprobarse</li>
              <li>Recibirás la confirmación en la app</li>
            </>
          ) : requestType === 'debt_payment' ? (
            <>
              <li>Tus compras pendientes se marcarán como <strong>pagadas</strong></li>
              <li>La deuda desaparecerá de tu cuenta al aprobarse</li>
            </>
          ) : (
            <>
              <li>El saldo se acreditará en menos de 24 horas</li>
              <li>Podrás ver el saldo actualizado en la app</li>
            </>
          )}
        </ul>
      </div>

      <Button onClick={onClose} className="w-full h-11 bg-blue-600 hover:bg-blue-700 font-semibold">
        Entendido
      </Button>
    </div>
  );

  if (RECHARGES_MAINTENANCE && requestType === 'recharge') {
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
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

