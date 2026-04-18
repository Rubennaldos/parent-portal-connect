/**
 * Hook que orquesta el flujo completo de envío de un voucher de pago.
 *
 * Extrae toda la lógica de handleSubmit de RechargeModal.tsx (originalmente
 * ~420 líneas) dejando el componente solo con responsabilidad de UI.
 *
 * Mejoras de arquitectura respecto al código original:
 *  - Registros huérfanos: si el INSERT falla después del upload, se borra
 *    el archivo de Storage automáticamente.
 *  - Detección de duplicados delegada a paymentService (un solo punto).
 *  - AbortController gestionado por useVoucherUpload (sin memory leaks).
 *  - Manejo de errores concentrado en classifyAndShowError.
 */

import { useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useVoucherUpload } from './useVoucherUpload';
import {
  checkReferenceCodeDuplicate,
  checkLunchOrderDuplicate,
  recoverFromDuplicatePayment,
} from '@/services/paymentService';

// ── Tipos mínimos necesarios para el hook ────────────────────────────────────

/** Comprobante adicional (pago en partes). */
export interface ExtraVoucherInput {
  id: string;
  referenceCode: string;
  voucherFile: File | null;
  amount: string;
}

/** Config estable: valores de props que no cambian mientras el modal está abierto. */
export interface RechargeSubmitConfig {
  studentId: string;
  studentName: string;
  requestType: 'recharge' | 'lunch_payment' | 'debt_payment';
  requestDescription?: string;
  lunchOrderIds?: string[] | null;
  paidTransactionIds?: string[] | null;
  invoiceType?: 'boleta' | 'factura' | null;
  invoiceClientData?: Record<string, unknown> | null;
  walletAmountToUse?: number;
  suggestedAmount?: number;
  isCombinedPayment?: boolean;
  /** Llamado cuando el pago se registra exitosamente (setStep('success')). */
  onStepSuccess: () => void;
}

/** Estado del formulario en el momento de hacer submit. */
export interface SubmitFormState {
  userId: string;
  amount: string;
  referenceCode: string;
  voucherFile: File | null;
  extraVouchers: ExtraVoucherInput[];
  notes: string;
  selectedMethod: string | null;
}

export interface UseRechargeSubmitReturn {
  handleSubmit: (form: SubmitFormState) => Promise<void>;
  loading: boolean;
  /** Expuesto para que el componente pueda resetear el progress en el finally. */
  submittingRef: React.MutableRefObject<boolean>;
  uploadProgress: number | null;
  uploadPhaseLabel: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRechargeSubmit(config: RechargeSubmitConfig): UseRechargeSubmitReturn {
  const {
    studentId,
    studentName,
    requestType,
    requestDescription,
    lunchOrderIds,
    paidTransactionIds,
    invoiceType,
    invoiceClientData,
    walletAmountToUse = 0,
    isCombinedPayment = false,
    onStepSuccess,
  } = config;

  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const { toast } = useToast();
  const {
    upload,
    deleteOrphanedFile,
    uploadProgress,
    uploadPhaseLabel,
    setUploadProgress,
    setUploadPhaseLabel,
    reset: resetUpload,
  } = useVoucherUpload();

  // ── Helpers de UI ──────────────────────────────────────────────────────────

  const showError = useCallback((title: string, description: string, duration = 10000) => {
    toast({ title, description, variant: 'destructive', duration });
  }, [toast]);

  /** Salida anticipada antes del try: resetea guards y muestra toast. */
  const earlyExit = useCallback((title: string, description: string) => {
    submittingRef.current = false;
    showError(title, description);
  }, [showError]);

  // ── Clasificador de errores ────────────────────────────────────────────────

  const classifyAndShowError = useCallback(async (
    err: unknown,
    ctx: { uploadStarted: boolean; referenceCode: string; userId: string }
  ) => {
    const rawMsg: string = (err as any)?.message || (err as any)?.details || String(err) || '';
    console.error('[useRechargeSubmit] Error al enviar solicitud:', rawMsg, err);

    // 1. Código de operación duplicado (constraint BD)
    if (
      rawMsg.includes('idx_recharge_unique_ref_code') ||
      (rawMsg.toLowerCase().includes('duplicate key') && rawMsg.toLowerCase().includes('reference'))
    ) {
      try {
        const { data: myReq } = await supabase
          .from('recharge_requests')
          .select('id, status')
          .eq('reference_code', ctx.referenceCode.trim())
          .eq('parent_id', ctx.userId)
          .neq('status', 'rejected')
          .limit(1);
        if (myReq && myReq.length > 0) {
          onStepSuccess();
          return;
        }
      } catch { /* si falla la consulta de recuperación, caer al toast */ }

      showError(
        '⚠️ Código ya registrado',
        `Ese número de operación ya tiene un pago en el sistema. ` +
        `Si ya enviaste este comprobante, recarga la página para verlo. ` +
        `Si tu pago anterior fue RECHAZADO, actualiza la página e intenta de nuevo.`,
        12000,
      );
      return;
    }

    // 2. Items ya incluidos en otro pago pendiente (trigger anti-duplicados)
    if (rawMsg.includes('DUPLICATE_PAYMENT')) {
      const { redirectToSuccess } = await recoverFromDuplicatePayment(rawMsg, ctx.userId);
      if (redirectToSuccess) {
        onStepSuccess();
        return;
      }
      showError(
        '⚠️ Pago duplicado detectado',
        'Algunos de los ítems que seleccionaste ya están incluidos en otro pago que todavía está en revisión. ' +
        'Recarga la página para ver el estado actualizado. Si ese pago fue rechazado, aparecerá disponible nuevamente.',
        12000,
      );
      return;
    }

    // 3. Error de upload (mensaje ya viene legible del servicio)
    const isUploadError = ['foto', 'subir', 'imagen', 'servidor', 'internet', 'wifi', 'tardando']
      .some(kw => rawMsg.toLowerCase().includes(kw));
    if (isUploadError) {
      showError('Error al subir la foto', rawMsg, 10000);
      return;
    }

    // 4. Error genérico: distinguir si fue antes o después del upload
    if (!ctx.uploadStarted) {
      showError(
        'No se pudo verificar tu solicitud',
        'Hubo un problema de conexión antes de enviar el comprobante. ' +
        'Tu foto NO fue subida. Verifica tu conexión e intenta de nuevo.',
      );
    } else {
      showError(
        'Error al guardar tu solicitud',
        'La foto se subió correctamente, pero no se pudo registrar el comprobante. ' +
        'Espera un momento y vuelve a intentarlo. Si el error persiste, contacta al administrador.',
      );
    }
  }, [onStepSuccess, showError]);

  // ── handleSubmit ───────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (form: SubmitFormState) => {
    const { userId, amount, referenceCode, voucherFile, extraVouchers, notes, selectedMethod } = form;

    if (loading) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    // ── CAMINO A: Pago 100% con billetera interna ──────────────────────────
    const isFullWalletPayment =
      requestType === 'debt_payment' &&
      walletAmountToUse > 0 &&
      walletAmountToUse >= (config.suggestedAmount ?? 0);

    if (isFullWalletPayment) {
      setLoading(true);
      try {
        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          'pay_debt_with_wallet_only',
          {
            p_student_id:      studentId,
            p_debt_tx_ids:     (paidTransactionIds || []) as any,
            p_lunch_order_ids: (lunchOrderIds || []) as any,
          },
        );
        // rpcResult es null si hay error, ignorar
        void rpcResult;
        if (rpcErr) {
          const msg = rpcErr.message || '';
          if (msg.includes('INSUFFICIENT_WALLET')) {
            showError('⚠️ Saldo insuficiente', 'Tu saldo ya no alcanza. Recarga la página e intenta de nuevo.');
          } else if (msg.includes('CONFLICT')) {
            showError('⚠️ Deuda ya cobrada', 'Este pago fue procesado por otro canal. Recarga la página.');
          } else {
            showError('Error al procesar el pago', msg || 'Intenta de nuevo en unos segundos.');
          }
          return;
        }
        onStepSuccess();
      } catch (err: any) {
        showError('Error inesperado', err.message || 'Contacta al administrador.');
      } finally {
        setLoading(false);
        resetUpload();
        submittingRef.current = false;
      }
      return;
    }

    // ── Validaciones previas al try ────────────────────────────────────────

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      earlyExit('Monto inválido', 'Ingresa un monto mayor a S/ 0');
      return;
    }
    if (requestType === 'recharge' && numAmount > 2000) {
      earlyExit('Monto muy alto', 'El monto máximo de recarga es S/ 2,000. Para montos mayores, contacta al administrador.');
      return;
    }
    if (!referenceCode.trim()) {
      earlyExit('🚫 Número de operación obligatorio', 'Debes ingresar el número de operación o código de transacción para continuar.');
      return;
    }
    if (!voucherFile) {
      earlyExit('🚫 Foto del comprobante obligatoria', 'Debes adjuntar la captura o foto del comprobante de pago para continuar.');
      return;
    }
    for (const ev of extraVouchers) {
      if (!ev.referenceCode.trim()) {
        earlyExit('🚫 Código obligatorio en comprobante adicional', 'Cada comprobante adicional debe tener su número de operación.');
        return;
      }
      if (!ev.voucherFile) {
        earlyExit('🚫 Foto obligatoria en comprobante adicional', 'Cada comprobante adicional debe tener su foto adjuntada.');
        return;
      }
      if (!parseFloat(ev.amount) || parseFloat(ev.amount) <= 0) {
        earlyExit('Monto inválido en comprobante adicional', 'Ingresa el monto pagado en cada comprobante adicional.');
        return;
      }
    }
    const allCodes = [referenceCode.trim(), ...extraVouchers.map(ev => ev.referenceCode.trim())];
    if (new Set(allCodes).size !== allCodes.length) {
      earlyExit('🚫 Códigos repetidos', 'Cada comprobante debe tener un código de operación diferente.');
      return;
    }

    setLoading(true);
    let uploadStarted = false;
    // Rutas de Storage de las imágenes ya subidas (para limpiar si el INSERT falla).
    const uploadedPaths: string[] = [];

    try {
      // ── PASO 1: Verificar duplicados de código en BD ──────────────────────
      for (const code of allCodes) {
        const { isDuplicate, isOwnRequest, existingStatus } = await checkReferenceCodeDuplicate(code, userId);
        if (isDuplicate) {
          if (isOwnRequest && (existingStatus === 'pending' || existingStatus === 'approved')) {
            onStepSuccess();
            return;
          }
          const statusLabel =
            existingStatus === 'approved' ? 'ya fue APROBADO' :
            existingStatus === 'pending'  ? 'está PENDIENTE de revisión' :
                                            'ya está en proceso';
          showError(
            '🚫 Código ya registrado',
            `El código "${code}" ${statusLabel} en el sistema. ` +
            `Si tu comprobante anterior fue RECHAZADO, puedes usar el mismo código sin problema. ` +
            `Si está pendiente o aprobado, usa un número de operación diferente.`,
            10000,
          );
          return;
        }
      }

      // ── PASO 2: Verificar duplicado de lunchOrderIds ──────────────────────
      if (lunchOrderIds && lunchOrderIds.length > 0) {
        const { blocked, redirectToSuccess } = await checkLunchOrderDuplicate(
          lunchOrderIds, userId, requestType,
        );
        if (blocked) {
          if (redirectToSuccess) { onStepSuccess(); return; }
          return;
        }
      }

      // ── PASO 3: Subir TODAS las imágenes ─────────────────────────────────
      const totalImages = 1 + extraVouchers.length;
      setUploadPhaseLabel('Subiendo foto...');
      setUploadProgress(0);
      uploadStarted = true;

      const { publicUrl: voucherUrl, storagePath: voucherPath } = await upload(
        voucherFile, userId, { totalImages, imageIndex: 0, phaseLabel: 'Subiendo foto...' },
      );
      uploadedPaths.push(voucherPath);

      const extraResults: Array<{ publicUrl: string; storagePath: string }> = [];
      for (let i = 0; i < extraVouchers.length; i++) {
        const ev = extraVouchers[i];
        const label = extraVouchers.length > 1
          ? `Subiendo foto ${i + 2} de ${totalImages}...`
          : 'Subiendo foto adicional...';
        const result = await upload(ev.voucherFile!, userId, {
          totalImages, imageIndex: i + 1, phaseLabel: label,
        });
        extraResults.push(result);
        uploadedPaths.push(result.storagePath);
      }

      setUploadPhaseLabel('Guardando registro...');
      setUploadProgress(96);

      // ── PASO 4: Registrar en BD ───────────────────────────────────────────
      const { data: student } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .single();

      const baseDescription = requestDescription || (
        requestType === 'lunch_payment'  ? 'Pago de almuerzo' :
        requestType === 'debt_payment'   ? (isCombinedPayment ? `Pago combinado: ${studentName}` : 'Pago de deuda pendiente') :
        'Recarga de saldo'
      );
      const totalParts = 1 + extraVouchers.length;
      const effectiveNotes = isCombinedPayment
        ? `${notes.trim() ? notes.trim() + ' | ' : ''}Pago combinado: ${studentName}`
        : (notes.trim() || null);

      if (walletAmountToUse > 0) {
        // CAMINO B: RPC con validación server-side de la billetera interna
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
              'Recarga la página e intenta de nuevo.',
            );
          }
          throw rpcError;
        }
      } else {
        // CAMINO C: INSERT directo sin billetera
        const { error: insertError } = await supabase.from('recharge_requests').insert({
          student_id:           studentId,
          parent_id:            userId,
          school_id:            student?.school_id || null,
          amount:               numAmount,
          wallet_amount:        0,
          payment_method:       selectedMethod,
          reference_code:       referenceCode.trim(),
          voucher_url:          voucherUrl,
          notes:                effectiveNotes,
          status:               'pending',
          request_type:         requestType,
          description:          totalParts > 1 ? `${baseDescription} (Pago 1 de ${totalParts})` : baseDescription,
          lunch_order_ids:      lunchOrderIds || null,
          paid_transaction_ids: paidTransactionIds || null,
          invoice_type:         invoiceType || null,
          invoice_client_data:  invoiceClientData || null,
        });
        if (insertError) throw insertError;
      }

      // Registrar comprobantes adicionales (pagos en partes)
      for (let i = 0; i < extraVouchers.length; i++) {
        const ev = extraVouchers[i];
        const { error: evError } = await supabase.from('recharge_requests').insert({
          student_id:           studentId,
          parent_id:            userId,
          school_id:            student?.school_id || null,
          amount:               parseFloat(ev.amount),
          payment_method:       selectedMethod,
          reference_code:       ev.referenceCode.trim(),
          voucher_url:          extraResults[i].publicUrl,
          notes:                effectiveNotes,
          status:               'pending',
          request_type:         requestType,
          description:          `${baseDescription} (Pago ${i + 2} de ${totalParts})`,
          lunch_order_ids:      lunchOrderIds || null,
          paid_transaction_ids: paidTransactionIds || null,
          invoice_type:         invoiceType || null,
          invoice_client_data:  invoiceClientData || null,
        });
        if (evError) throw evError;
      }

      setUploadProgress(100);
      setUploadPhaseLabel('');
      onStepSuccess();

    } catch (err: unknown) {
      // Limpiar archivos huérfanos: si el INSERT falló, los archivos ya están
      // en Storage pero ninguna fila de BD apunta a ellos.
      if (uploadStarted && uploadedPaths.length > 0) {
        for (const p of uploadedPaths) {
          await deleteOrphanedFile(p);
        }
      }
      await classifyAndShowError(err, {
        uploadStarted,
        referenceCode,
        userId,
      });
    } finally {
      setLoading(false);
      resetUpload();
      submittingRef.current = false;
    }
  }, [
    loading, config.suggestedAmount, requestType, walletAmountToUse,
    studentId, studentName, requestDescription, lunchOrderIds,
    paidTransactionIds, invoiceType, invoiceClientData, isCombinedPayment,
    onStepSuccess, upload, deleteOrphanedFile, setUploadProgress, setUploadPhaseLabel,
    resetUpload, earlyExit, showError, classifyAndShowError,
  ]);

  return { handleSubmit, loading, submittingRef, uploadProgress, uploadPhaseLabel };
}
