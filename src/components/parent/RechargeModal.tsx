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
  /** Callback para el botÃ³n "Cancelar" (volver sin pagar) */
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
  /** DescripciÃ³n del pago (ej: "Almuerzo - MenÃº NiÃ±os - 20 de febrero") */
  requestDescription?: string;
  /** IDs de lunch_orders asociados (solo para lunch_payment) */
  lunchOrderIds?: string[];
  /** IDs de transacciones que se estÃ¡n pagando (para debt_payment) */
  paidTransactionIds?: string[];
  /** Desglose de Ã­tems que se estÃ¡n pagando */
  breakdownItems?: BreakdownItem[];
  /** IDs de todos los estudiantes incluidos en un pago combinado */
  combinedStudentIds?: string[];
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
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  // â”€â”€ Comprobantes adicionales (pago en partes) â”€â”€
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
        setAmount(String(suggestedAmount));
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

      // Auto-seleccionar el primer mÃ©todo disponible
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
      toast({ title: 'Imagen muy grande', description: 'MÃ¡ximo 5 MB', variant: 'destructive' });
      return;
    }

    setVoucherFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setVoucherPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // â”€â”€ Helper: comprimir imagen antes de subir â”€â”€
  // Convierte CUALQUIER formato (HEIC, HEIF, PNG, WebP, etc.) a JPEG comprimido.
  // MÃ¡ximo 800px, calidad 60% â†’ resultado siempre menor a 200 KB.
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
              // (el admin al menos verÃ¡ que llegÃ³ algo, aunque no se visualice)
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

  // â”€â”€ Helper: subir imagen a storage â”€â”€
  // âš ï¸ LANZA error si falla â€” asÃ­ el insert no se hace sin foto
  const uploadVoucherImage = async (file: File, userId: string): Promise<string> => {
    const compressed = await compressImage(file);
    const safeName = `voucher_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    const fileName = `${userId}/${safeName}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vouchers')
      .upload(fileName, compressed, { upsert: false, contentType: 'image/jpeg' });
    if (uploadError) {
      console.error('Error al subir imagen del voucher:', uploadError.message);
      throw new Error(`No se pudo subir la foto del comprobante: ${uploadError.message}. Verifica tu conexiÃ³n e intenta nuevamente.`);
    }
    const { data: { publicUrl } } = supabase.storage.from('vouchers').getPublicUrl(uploadData.path);
    if (!publicUrl) {
      throw new Error('No se pudo obtener la URL pÃºblica de la imagen. Contacta al administrador.');
    }
    return publicUrl;
  };

  // â”€â”€ Helper: verificar duplicado de cÃ³digo de operaciÃ³n â”€â”€
  const checkDuplicate = async (code: string): Promise<boolean> => {
    const { data } = await supabase
      .from('recharge_requests')
      .select('id')
      .eq('reference_code', code.trim())
      .neq('status', 'rejected')
      .limit(1);
    return !!(data && data.length > 0);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (loading) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast({ title: 'Monto invÃ¡lido', description: 'Ingresa un monto mayor a S/ 0', variant: 'destructive' });
      return;
    }
    if (requestType === 'recharge' && numAmount > 2000) {
      toast({ title: 'Monto muy alto', description: 'El monto mÃ¡ximo de recarga es S/ 2,000. Para montos mayores, contacta al administrador.', variant: 'destructive' });
      return;
    }

    // â”€â”€ Validar cÃ³digo principal obligatorio â”€â”€
    if (!referenceCode.trim()) {
      toast({
        title: 'ðŸš« NÃºmero de operaciÃ³n obligatorio',
        description: 'Debes ingresar el nÃºmero de operaciÃ³n o cÃ³digo de transacciÃ³n para continuar.',
        variant: 'destructive',
      });
      return;
    }

    // â”€â”€ Validar foto del comprobante principal obligatoria â”€â”€
    if (!voucherFile) {
      toast({
        title: 'ðŸš« Foto del comprobante obligatoria',
        description: 'Debes adjuntar la captura o foto del comprobante de pago para continuar.',
        variant: 'destructive',
      });
      return;
    }

    // â”€â”€ Validar comprobantes adicionales â”€â”€
    for (const ev of extraVouchers) {
      if (!ev.referenceCode.trim()) {
        toast({
          variant: 'destructive',
          title: 'ðŸš« CÃ³digo obligatorio en comprobante adicional',
          description: 'Cada comprobante adicional debe tener su nÃºmero de operaciÃ³n.',
        });
        return;
      }
      if (!ev.voucherFile) {
        toast({
          variant: 'destructive',
          title: 'ðŸš« Foto obligatoria en comprobante adicional',
          description: 'Cada comprobante adicional debe tener su foto adjuntada.',
        });
        return;
      }
      const evAmount = parseFloat(ev.amount);
      if (!evAmount || evAmount <= 0) {
        toast({
          variant: 'destructive',
          title: 'Monto invÃ¡lido en comprobante adicional',
          description: 'Ingresa el monto pagado en cada comprobante adicional.',
        });
        return;
      }
    }

    // â”€â”€ Verificar que no haya cÃ³digos repetidos entre sÃ­ â”€â”€
    const allCodes = [referenceCode.trim(), ...extraVouchers.map(ev => ev.referenceCode.trim())];
    const uniqueCodes = new Set(allCodes);
    if (uniqueCodes.size !== allCodes.length) {
      toast({
        variant: 'destructive',
        title: 'ðŸš« CÃ³digos repetidos',
        description: 'Cada comprobante debe tener un cÃ³digo de operaciÃ³n diferente.',
      });
      return;
    }

    setLoading(true);
    try {
      // â”€â”€ Verificar duplicados en BD para TODOS los cÃ³digos â”€â”€
      for (const code of allCodes) {
        const isDuplicate = await checkDuplicate(code);
        if (isDuplicate) {
          toast({
            variant: 'destructive',
            title: 'ðŸš« Voucher ya emitido o usado',
            description: `El cÃ³digo "${code}" ya fue registrado en el sistema. Si crees que es un error, contacta al administrador.`,
            duration: 8000,
          });
          setLoading(false);
          return;
        }
      }

      // â”€â”€ Prevenir doble envÃ­o de voucher para los mismos pedidos â”€â”€
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
            title: 'âš ï¸ Comprobante ya enviado',
            description: 'Ya enviaste un comprobante para estos pedidos. Espera la revisiÃ³n del administrador.',
          });
          setLoading(false);
          return;
        }
      }

      // Nota: debt_payment permite mÃºltiples envÃ­os (pagos en partes / diferencias)
      // No se bloquea aquÃ­ â€” el admin verÃ¡ todos los comprobantes y los conciliarÃ¡

      const { data: student } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .single();

      // â”€â”€ PASO 1: Subir TODAS las imÃ¡genes primero (si falla alguna, no insertamos nada) â”€â”€
      const voucherUrl = await uploadVoucherImage(voucherFile, user.id);

      const extraUrls: string[] = [];
      for (const ev of extraVouchers) {
        const evUrl = await uploadVoucherImage(ev.voucherFile!, user.id);
        extraUrls.push(evUrl);
      }

      const baseDescription = requestDescription || (
        requestType === 'lunch_payment' ? 'Pago de almuerzo' :
        requestType === 'debt_payment' ? (isCombinedPayment ? `Pago combinado: ${studentName}` : 'Pago de deuda pendiente') :
        'Recarga de saldo'
      );

      const totalParts = 1 + extraVouchers.length;

      const effectiveNotes = isCombinedPayment
        ? `${notes.trim() ? notes.trim() + ' | ' : ''}Pago combinado: ${studentName}`
        : (notes.trim() || null);

      // â”€â”€ PASO 2: Insertar TODOS los registros (imÃ¡genes ya estÃ¡n subidas) â”€â”€
      const { error: insertError } = await supabase.from('recharge_requests').insert({
        student_id: studentId,
        parent_id: user.id,
        school_id: student?.school_id || null,
        amount: numAmount,
        payment_method: selectedMethod,
        reference_code: referenceCode.trim(),
        voucher_url: voucherUrl,
        notes: effectiveNotes,
        status: 'pending',
        request_type: requestType,
        description: totalParts > 1 ? `${baseDescription} (Pago 1 de ${totalParts})` : baseDescription,
        lunch_order_ids: lunchOrderIds || null,
        paid_transaction_ids: paidTransactionIds || null,
      });
      if (insertError) throw insertError;

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

      setStep('success');
    } catch (err: any) {
      console.error('Error al enviar solicitud:', err);
      toast({
        title: 'Error al enviar',
        description: err.message || 'OcurriÃ³ un error. Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // â”€â”€ Copiar al portapapeles con feedback visual â”€â”€
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
      hint: 'Abre tu app de Yape y transfiere al nÃºmero indicado.',
    },
    plin: {
      label: 'Plin',
      icon: <PlinLogo className="w-8 h-8" />,
      color: 'green',
      enabled: paymentConfig?.plin_enabled ?? true,
      number: paymentConfig?.plin_number || null,
      holder: paymentConfig?.plin_holder || null,
      hint: 'Abre tu app de Plin y transfiere al nÃºmero indicado.',
    },
    transferencia: {
      label: 'Transferencia',
      icon: <Building2 className="h-7 w-7 text-orange-600" />,
      color: 'orange',
      enabled: paymentConfig?.transferencia_enabled ?? true,
      // number se usa para saber si estÃ¡ disponible
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PASO 1: Monto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderStepAmount = () => (
    <div className="space-y-5">

      {/* âš ï¸ AVISO IMPORTANTE: solo para recarga de kiosco */}
      {requestType === 'recharge' && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xl font-black">!</span>
            </div>
            <div>
              <p className="font-bold text-amber-900 text-base leading-tight mb-1">
                âš ï¸ Â¿Para quÃ© sirve esta recarga?
              </p>
              <p className="text-amber-800 text-sm leading-relaxed">
                Este saldo es <strong>Ãºnicamente para compras en el kiosco</strong> (recreo, snacks, etc.).
              </p>
              <p className="text-amber-700 text-sm leading-relaxed mt-2">
                ðŸ‘‰ Si deseas <strong>pagar los almuerzos</strong>, hazlo desde la pestaÃ±a{' '}
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
        <Label className="font-semibold">Â¿CuÃ¡nto deseas recargar?</Label>
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
          <span className="text-gray-600">Saldo despuÃ©s de recarga:</span>
          <span className="font-bold text-green-700">S/ {(currentBalance + parseFloat(amount)).toFixed(2)}</span>
        </div>
      )}

      <Button
        onClick={() => setStep('method')}
        disabled={!amount || parseFloat(amount) <= 0}
        className="w-full h-12 text-base font-semibold bg-blue-600 hover:bg-blue-700"
      >
        Continuar â†’
      </Button>
    </div>
  );

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PASO 2: MÃ©todo + instrucciones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
              El colegio aÃºn no ha configurado nÃºmeros de Yape, Plin o cuenta bancaria. 
              Contacta a la administraciÃ³n del colegio.
            </p>
          </div>
        ) : (
          <>
            {/* Selector de mÃ©todo */}
            <div className="space-y-2">
              <Label className="font-semibold text-sm">Elige cÃ³mo vas a pagar</Label>
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
                      ðŸ“‹ Pasos a seguir
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
                        <span>Toma captura del comprobante y envÃ­alo en el siguiente paso</span>
                      </div>
                    </div>

                    {/* â”€â”€ Datos de pago con botones COPIAR â”€â”€ */}
                    <div className="bg-white border-2 border-dashed border-blue-300 rounded-xl overflow-hidden">
                      <div className="bg-blue-50 px-3 py-1.5 border-b border-blue-200">
                        <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wider">
                          {selectedMethod === 'transferencia' ? 'ðŸ¦ Datos bancarios â€” copia los nÃºmeros' : `ðŸ“± NÃºmero de ${currentMethodInfo?.label}`}
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
                            {/* Titular â€” solo display, sin botÃ³n copiar */}
                            {currentMethodInfo?.holder && (
                              <div className="pb-1.5 border-b border-gray-100">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Titular</p>
                                <p className="text-sm font-semibold text-gray-800">{currentMethodInfo?.holder}</p>
                              </div>
                            )}
                            {/* Cuenta Corriente â€” con botÃ³n copiar */}
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
                                  {copiedField === 'account' ? 'Â¡Copiado!' : 'Copiar'}
                                </button>
                              </div>
                            )}
                            {/* CCI â€” con botÃ³n copiar */}
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
                                  {copiedField === 'cci' ? 'Â¡Copiado!' : 'Copiar'}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {/* Titular Yape/Plin â€” solo display, sin botÃ³n copiar */}
                            {currentMethodInfo?.holder && (
                              <div className="pb-1.5 border-b border-gray-100">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Titular</p>
                                <p className="text-sm font-semibold text-gray-800">{currentMethodInfo?.holder}</p>
                              </div>
                            )}
                            {/* NÃºmero â€” con botÃ³n copiar */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-gray-400 uppercase tracking-wide">NÃºmero</p>
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
                                {copiedField === 'number' ? 'Â¡Copiado!' : 'Copiar'}
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
            Ya paguÃ© â†’ Enviar comprobante
          </Button>
          <div className="flex gap-2">
            {!skipAmountStep && (
              <Button variant="outline" onClick={() => setStep('amount')} className="flex-1 h-10">
                â† AtrÃ¡s
              </Button>
            )}
            {/* BotÃ³n "Pagar despuÃ©s" desactivado â€” padres deben pagar obligatoriamente */}
            {/* {(requestType === 'lunch_payment' || requestType === 'debt_payment') && (
              <Button
                variant="ghost"
                onClick={onClose}
                className="flex-1 h-10 text-gray-500 hover:text-gray-700"
              >
                Pagar despuÃ©s
              </Button>
            )} */}
          </div>
        </div>
      </div>
    );
  };

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PASO 3: Subir voucher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderStepVoucher = () => (
    <div className="space-y-5">
      {/* Resumen del pago */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between text-sm">
        <span className="text-gray-600">{requestType === 'lunch_payment' ? 'Pago almuerzo:' : requestType === 'debt_payment' ? 'Pago deuda:' : 'Recarga solicitada:'}</span>
        <span className="font-bold text-blue-700">S/ {parseFloat(amount).toFixed(2)} vÃ­a {currentMethodInfo?.label}</span>
      </div>

      {/* â”€â”€ Desglose de compras (solo para debt_payment) â”€â”€ */}
      {requestType === 'debt_payment' && breakdownItems && breakdownItems.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBreakdown(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition-colors"
          >
            <span>ðŸ“‹ Ver desglose de lo que estÃ¡s pagando ({breakdownItems.length} compra{breakdownItems.length !== 1 ? 's' : ''})</span>
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

      {/* NÃºmero de operaciÃ³n â€” OBLIGATORIO */}
      <div className={`space-y-1.5 rounded-xl p-3 border-2 ${referenceCode.trim() ? 'border-green-300 bg-green-50' : 'border-red-400 bg-red-50'}`}>
        <Label className="font-bold text-sm flex items-center gap-1.5">
          <Hash className="h-4 w-4 text-red-500" />
          NÃºmero de operaciÃ³n
          <span className="text-red-600 font-black">* OBLIGATORIO</span>
        </Label>
        <Input
          placeholder="Ej: 123456789 (lo encuentras en tu app despuÃ©s de pagar)"
          value={referenceCode}
          onChange={(e) => setReferenceCode(e.target.value)}
          className={`font-mono text-base font-semibold border-2 h-11 ${referenceCode.trim() ? 'border-green-400 bg-white' : 'border-red-400 bg-white'}`}
        />
        {!referenceCode.trim() ? (
          <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
            âš ï¸ Sin este nÃºmero no se puede procesar tu pago. Lo encuentras en Yape/Plin/banco tras realizar la transferencia.
          </p>
        ) : (
          <p className="text-xs text-green-700 font-medium flex items-center gap-1">
            âœ… CÃ³digo ingresado correctamente.
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
            <p className="text-xs text-green-700 font-medium mt-1 flex items-center gap-1">âœ… Foto adjuntada correctamente.</p>
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
              <span className="text-xs">JPG, PNG â€” mÃ¡x. 5 MB</span>
            </button>
            <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
              âš ï¸ Debes adjuntar la foto o captura del comprobante de pago para continuar.
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

      {/* â”€â”€ Comprobantes adicionales (pago en partes) â”€â”€ */}
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
              Como pagas en partes, indica cuÃ¡nto cubre <strong>este voucher</strong> (puede ser una parte del total).
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

          {/* CÃ³digo de operaciÃ³n adicional */}
          <div className="space-y-1">
            <Label className="text-sm font-semibold">
              CÃ³digo de operaciÃ³n <span className="text-red-500">*</span>
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
                <p className="text-xs text-green-700 font-medium mt-1">âœ… Foto adjuntada.</p>
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
                <p className="text-xs text-red-600 font-semibold">âš ï¸ Obligatorio para este comprobante.</p>
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
                  toast({ title: 'Imagen muy grande', description: 'MÃ¡ximo 5 MB', variant: 'destructive' });
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

      {/* BotÃ³n agregar otro comprobante */}
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
        <Button variant="outline" onClick={() => setStep('method')} className="flex-1 h-11">â† AtrÃ¡s</Button>
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
            !referenceCode.trim() ? 'Falta el nÃºmero de operaciÃ³n' :
            !voucherFile ? 'Falta adjuntar la foto del comprobante' :
            extraVouchers.some(ev => !ev.referenceCode.trim()) ? 'Falta cÃ³digo en un comprobante adicional' :
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

      {/* BotÃ³n cancelar (solo cuando hay callback de cancelar, ej. desde PaymentsTab) */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 underline py-1 transition-colors"
        >
          Cancelar â€” volver a la pestaÃ±a de pagos
        </button>
      )}
    </div>
  );

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ VISTA COMBINADA (1 sola pantalla) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderCombinedView = () => {
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
                <strong>âš ï¸ Esta recarga es solo para compras en el kiosco.</strong> Para almuerzos, usa la pestaÃ±a Pagos.
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
            <p className="text-xs text-amber-600">Contacta a la administraciÃ³n del colegio.</p>
          </div>
        ) : (
          <>
            {/* Method tabs â€” horizontal */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">MÃ©todo de pago</p>
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
                    {selectedMethod === 'transferencia' ? 'ðŸ¦ Datos bancarios' : `ðŸ“± ${currentMethodInfo?.label}`}
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
                          <p className="text-[9px] text-gray-400 uppercase">NÃºmero</p>
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
                NÂ° de operaciÃ³n <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="Ej: 123456789"
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                className="font-mono text-sm font-semibold h-10"
              />
              {referenceCode.trim() && <p className="text-[10px] text-green-600 font-medium">âœ… CÃ³digo ingresado</p>}
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
                  <p className="text-[10px] text-green-600 font-medium mt-1">âœ… Foto adjuntada</p>
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
                    placeholder="NÂ° operaciÃ³n"
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
                      if (file.size > 5 * 1024 * 1024) { toast({ title: 'Imagen muy grande', description: 'MÃ¡ximo 5 MB', variant: 'destructive' }); return; }
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

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="w-full h-12 bg-green-600 hover:bg-green-700 font-bold text-base shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enviando...</>
              ) : !selectedMethod ? (
                <>Selecciona el mÃ©todo de pago</>
              ) : !referenceCode.trim() ? (
                <>Falta el NÂ° de operaciÃ³n</>
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PASO 4: Ã‰xito â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderStepSuccess = () => (
    <div className="text-center space-y-5 py-4">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-12 w-12 text-green-600" />
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-900">Â¡Comprobante enviado!</h3>
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
          <Clock className="h-4 w-4" /> Â¿QuÃ© pasa ahora?
        </p>
        <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
          <li>Un administrador verificarÃ¡ tu comprobante</li>
          {requestType === 'lunch_payment' ? (
            <>
              <li>Tu pedido de almuerzo quedarÃ¡ <strong>confirmado</strong> al aprobarse</li>
              <li>RecibirÃ¡s la confirmaciÃ³n en la app</li>
            </>
          ) : requestType === 'debt_payment' ? (
            <>
              <li>Tus compras pendientes se marcarÃ¡n como <strong>pagadas</strong></li>
              <li>La deuda desaparecerÃ¡ de tu cuenta al aprobarse</li>
            </>
          ) : (
            <>
              <li>El saldo se acreditarÃ¡ en menos de 24 horas</li>
              <li>PodrÃ¡s ver el saldo actualizado en la app</li>
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
        <DialogContent className="max-w-sm">
          <div className="text-center space-y-4 py-4">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Recargas en mantenimiento</h3>
            <p className="text-sm text-gray-600">
              El mÃ³dulo de recargas estÃ¡ temporalmente suspendido mientras lo mejoramos.
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
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            {step === 'success'
              ? 'Â¡Listo!'
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

