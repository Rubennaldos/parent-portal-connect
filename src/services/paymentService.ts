/**
 * Servicio de integración con Pasarelas de Pago
 * Soporta: Niubiz, Izipay, Culqi, Mercado Pago
 */

import { supabase } from '@/lib/supabase';

export interface PaymentRequest {
  amount: number;
  studentId: string;
  paymentMethod: 'card' | 'yape' | 'plin' | 'bank_transfer';
  gateway?: 'niubiz' | 'izipay' | 'culqi' | 'mercadopago' | 'manual';
}

export interface PaymentTransaction {
  id: string;
  amount: number;
  status: 'pending' | 'processing' | 'approved' | 'rejected' | 'cancelled';
  payment_gateway: string;
  payment_method: string;
  transaction_reference?: string;
  created_at: string;
}

/**
 * Inicia una transacción de pago
 * Crea el registro en la BD y devuelve el ID para tracking
 */
export async function initiatePayment(
  request: PaymentRequest,
  userId: string
): Promise<{ transaction: PaymentTransaction; checkoutUrl?: string }> {
  try {
    // 1. Determinar la pasarela según el método de pago
    const gateway = request.gateway || determineGateway(request.paymentMethod);

    // 2. Validar que la pasarela esté activa
    const { data: gatewayConfig, error: configError } = await supabase
      .from('payment_gateway_config')
      .select('*')
      .eq('gateway_name', gateway)
      .eq('is_active', true)
      .single();

    if (configError || !gatewayConfig) {
      throw new Error(`La pasarela ${gateway} no está disponible en este momento`);
    }

    // 3. Validar monto mínimo y máximo
    if (request.amount < gatewayConfig.min_amount) {
      throw new Error(`El monto mínimo es S/ ${gatewayConfig.min_amount.toFixed(2)}`);
    }
    if (request.amount > gatewayConfig.max_amount) {
      throw new Error(`El monto máximo es S/ ${gatewayConfig.max_amount.toFixed(2)}`);
    }

    // 4. Crear transacción en BD (estado: pending)
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .insert({
        user_id: userId,
        student_id: request.studentId,
        amount: request.amount,
        currency: 'PEN',
        payment_gateway: gateway,
        payment_method: request.paymentMethod,
        status: 'pending',
        expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 horas
      })
      .select()
      .single();

    if (txError) throw txError;

    // 5. Generar URL de checkout según la pasarela
    let checkoutUrl: string | undefined;

    if (gateway === 'niubiz') {
      checkoutUrl = await generateNiubizCheckout(transaction.id, request.amount, gatewayConfig);
    } else if (gateway === 'izipay') {
      checkoutUrl = await generateIzipayCheckout(transaction.id, request.amount, request.paymentMethod, gatewayConfig);
    } else if (gateway === 'manual') {
      // Pago manual: no hay URL, el admin verificará manualmente
      checkoutUrl = undefined;
    }

    console.log('✅ Transacción creada:', transaction.id, 'Gateway:', gateway);

    return {
      transaction,
      checkoutUrl,
    };
  } catch (error: any) {
    console.error('❌ Error al iniciar pago:', error);
    throw new Error(error.message || 'Error al procesar el pago');
  }
}

/**
 * Determina qué pasarela usar según el método de pago
 */
function determineGateway(paymentMethod: string): string {
  if (paymentMethod === 'card') {
    return 'niubiz'; // Niubiz es mejor para tarjetas
  } else if (paymentMethod === 'yape' || paymentMethod === 'plin') {
    return 'izipay'; // Izipay soporta Yape/Plin
  } else if (paymentMethod === 'bank_transfer') {
    return 'manual'; // Verificación manual
  }
  return 'niubiz'; // Default
}

/**
 * Genera URL de checkout de Niubiz (Visa)
 */
async function generateNiubizCheckout(
  transactionId: string,
  amount: number,
  config: any
): Promise<string> {
  try {
    // En producción, esto llamaría a una Edge Function que se comunica con Niubiz
    // Por ahora, devolvemos una URL de simulación
    
    const baseUrl = config.is_production
      ? 'https://apiprod.vnforapps.com'
      : 'https://apisandbox.vnforapps.com';

    // TODO: Implementar llamada real a Edge Function
    // const response = await fetch('/api/niubiz/session', {
    //   method: 'POST',
    //   body: JSON.stringify({ transactionId, amount, merchantId: config.merchant_id })
    // });

    // Por ahora, URL de simulación
    const checkoutUrl = `${baseUrl}/checkout?merchantId=${config.merchant_id}&amount=${amount * 100}&purchaseNumber=${transactionId}`;
    
    console.log('🔗 Niubiz Checkout URL:', checkoutUrl);
    return checkoutUrl;
  } catch (error) {
    console.error('Error generando checkout Niubiz:', error);
    throw error;
  }
}

/**
 * Inicia un pago con IziPay llamando al Edge Function izipay-create-order.
 * Devuelve { formToken, publicKey } para renderizar el formulario embebido.
 */
export async function initiateIzipayPayment(
  orderId: string,
  amount: number,
  studentId: string,
  currency = 'PEN'
): Promise<{ formToken: string; publicKey: string; orderId: string }> {
  const { data, error } = await supabase.functions.invoke('izipay-create-order', {
    body: { orderId, amount, studentId, currency },
  });

  if (error) throw new Error(error.message || 'Error al crear la orden en IziPay');
  if (!data?.formToken) throw new Error('IziPay no devolvió un formToken válido');

  return {
    formToken:  data.formToken,
    publicKey:  data.publicKey ?? '',
    orderId,
  };
}

/**
 * Consulta el estado de una payment_session (usada por GatewayPaymentWaiting).
 * Devuelve el gateway_status y el gateway_reference del registro.
 */
export async function getPaymentSessionStatus(sessionId: string) {
  const { data, error } = await supabase
    .from('payment_sessions')
    .select('id, gateway_status, gateway_reference, status, completed_at')
    .eq('id', sessionId)
    .single();

  if (error) return null;
  return data;
}

/**
 * @deprecated Usar initiateIzipayPayment en su lugar.
 * Se mantiene para retrocompatibilidad con código legado.
 */
async function generateIzipayCheckout(
  transactionId: string,
  amount: number,
  _paymentMethod: string,
  _config: any
): Promise<string> {
  try {
    const { formToken } = await initiateIzipayPayment(transactionId, amount, '');
    return `izipay-form-token:${formToken}`;
  } catch (error) {
    console.error('Error generando checkout Izipay:', error);
    throw error;
  }
}

/**
 * Consulta el estado de una transacción
 */
export async function getPaymentStatus(
  transactionId: string
): Promise<PaymentTransaction | null> {
  try {
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al consultar estado de pago:', error);
    return null;
  }
}

/**
 * Cancela una transacción pendiente
 */
export async function cancelPayment(transactionId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('payment_transactions')
      .update({ status: 'cancelled' })
      .eq('id', transactionId)
      .eq('status', 'pending');

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error al cancelar pago:', error);
    return false;
  }
}

/**
 * Obtiene las pasarelas disponibles para el usuario
 */
export async function getAvailableGateways(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('payment_gateway_config')
      .select('gateway_name, min_amount, max_amount, is_active')
      .eq('is_active', true);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error al obtener pasarelas:', error);
    return [];
  }
}

// ── Detección de pagos duplicados (extraído de RechargeModal) ────────────────

export interface DuplicateCodeResult {
  isDuplicate: boolean;
  isOwnRequest: boolean;
  existingStatus?: string;
}

/**
 * Verifica si un código de operación ya existe en recharge_requests.
 *
 * Reglas:
 *  - Rechazados (rejected) NO bloquean → el padre puede reutilizar el código.
 *  - Si el código existe y es del mismo padre → isOwnRequest = true.
 *    El caller puede decidir mostrar éxito en lugar de bloquear.
 */
export async function checkReferenceCodeDuplicate(
  code: string,
  parentId: string,
): Promise<DuplicateCodeResult> {
  const { data } = await supabase
    .from('recharge_requests')
    .select('id, status, parent_id')
    .eq('reference_code', code.trim())
    .neq('status', 'rejected')
    .limit(1);

  if (data && data.length > 0) {
    return {
      isDuplicate:   true,
      isOwnRequest:  data[0].parent_id === parentId,
      existingStatus: data[0].status,
    };
  }
  return { isDuplicate: false, isOwnRequest: false };
}

export interface LunchOrderDuplicateResult {
  /** true → bloquear el envío (ya existe una solicitud pendiente con foto) */
  blocked: boolean;
  /** true → redirigir a success (primer envío funcionó, padre no lo vio) */
  redirectToSuccess: boolean;
}

/**
 * Verifica si ya existe una solicitud pending con los mismos lunchOrderIds.
 * Si la solicitud ya tiene voucher_url → el pago se registró correctamente.
 * Redirigir al padre a la pantalla de éxito en lugar de mostrar error.
 */
export async function checkLunchOrderDuplicate(
  lunchOrderIds: string[],
  parentId: string,
  requestType: string,
): Promise<LunchOrderDuplicateResult> {
  if (
    (requestType !== 'lunch_payment' && requestType !== 'debt_payment') ||
    lunchOrderIds.length === 0
  ) {
    return { blocked: false, redirectToSuccess: false };
  }

  const { data: existingReq } = await supabase
    .from('recharge_requests')
    .select('id, status, voucher_url')
    .eq('parent_id', parentId)
    .in('request_type', ['lunch_payment', 'debt_payment'])
    .eq('status', 'pending')
    .contains('lunch_order_ids', lunchOrderIds);

  if (!existingReq || existingReq.length === 0) {
    return { blocked: false, redirectToSuccess: false };
  }

  const req = existingReq[0];
  if (req.voucher_url) {
    // El comprobante ya llegó al sistema → el padre solo no vio la pantalla de éxito.
    return { blocked: true, redirectToSuccess: true };
  }

  // Registro huérfano (sin foto): no bloquear — el nuevo intento lo sobreescribirá
  // o el trigger DUPLICATE_PAYMENT de la BD lo manejará.
  return { blocked: false, redirectToSuccess: false };
}

export interface DuplicatePaymentRecoveryResult {
  /** true → la solicitud conflictiva ES del mismo padre y tiene foto → mostrar éxito */
  redirectToSuccess: boolean;
}

/**
 * Intenta recuperarse del error DUPLICATE_PAYMENT del trigger de BD.
 *
 * El mensaje del trigger incluye el UUID de la solicitud conflictiva:
 *   "DUPLICATE_PAYMENT: ... (solicitud xxxxxxxx-xxxx-...) ..."
 *
 * Si ese UUID pertenece al mismo padre y tiene voucher_url → el primer envío
 * funcionó y el padre no lo vio. Redirigir a éxito es seguro porque:
 *   - La solicitud real ya existe en BD con los datos correctos.
 *   - La aprobación sigue siendo exclusiva de admins (RLS + trigger).
 *   - El padre no puede manipular este flujo para auto-aprobarse.
 */
export async function recoverFromDuplicatePayment(
  rawMsg: string,
  userId: string,
): Promise<DuplicatePaymentRecoveryResult> {
  const uuidMatch = rawMsg.match(
    /\(solicitud ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i,
  );
  const conflictingId = uuidMatch?.[1];
  if (!conflictingId) return { redirectToSuccess: false };

  try {
    const { data: conflictReq } = await supabase
      .from('recharge_requests')
      .select('id, status, parent_id, voucher_url')
      .eq('id', conflictingId)
      .single();

    if (conflictReq?.parent_id === userId && conflictReq?.voucher_url) {
      return { redirectToSuccess: true };
    }
  } catch {
    // Fallo silencioso → el caller mostrará el toast de error estándar.
  }

  return { redirectToSuccess: false };
}

