# 🔐 GUÍA DE INTEGRACIÓN DE PASARELAS DE PAGO

## 📋 Índice
1. [Pasarelas Disponibles en Perú](#pasarelas-disponibles)
2. [Niubiz (Visa) - Recomendada](#niubiz)
3. [Izipay - Para Yape/Plin](#izipay)
4. [Culqi - Alternativa](#culqi)
5. [Flujo de Integración](#flujo)
6. [Configuración SQL](#sql)

---

## 1. 🏦 Pasarelas Disponibles en Perú

### Recomendación según necesidad:

| Pasarela | Tarjetas | Yape/Plin | Comisión | Tiempo Acreditación |
|----------|----------|-----------|----------|---------------------|
| **Niubiz** | ✅ Sí | ❌ No | 2.5-3.5% | Inmediato |
| **Izipay** | ✅ Sí | ✅ Sí | 3.5-4.5% | Inmediato |
| **Culqi** | ✅ Sí | ❌ No | 3.5% | Inmediato |
| **MercadoPago** | ✅ Sí | ✅ Sí | 4.5% | 24-48h |

**Recomendación:** 
- **Niubiz** para tarjetas (más barato)
- **Izipay** para Yape/Plin (único que los soporta bien)

---

## 2. 💳 NIUBIZ (Visa) - Integración

### ¿Qué es Niubiz?
Es el procesador de pagos de Visa Perú. Permite aceptar tarjetas Visa, Mastercard, Amex, Diners.

### Paso 1: Contratar el servicio
1. Ir a https://www.niubiz.com.pe/
2. Contactar con un ejecutivo comercial
3. Presentar:
   - RUC de Lima Café 28
   - Documento de constitución
   - Cuenta bancaria (BCP, Interbank, etc.)
4. Firmar contrato

### Paso 2: Obtener credenciales
Recibirás:
- **Merchant ID**: Tu ID de comercio (ej: `523212345`)
- **Terminal ID**: ID del terminal virtual (ej: `00000001`)
- **API Key**: Para producción y sandbox
- **Certificado SSL**: Para webhooks

### Paso 3: Configurar en Supabase

```sql
-- Actualizar configuración de Niubiz
UPDATE payment_gateway_config
SET 
  is_active = true,
  is_production = true, -- false para sandbox
  merchant_id = '523212345', -- TU MERCHANT ID
  api_key = 'TU_API_KEY_AQUI',
  api_secret = 'TU_API_SECRET_AQUI',
  api_url = 'https://apiprod.vnforapps.com', -- Producción
  -- api_url = 'https://apisandbox.vnforapps.com', -- Sandbox
  settings = jsonb_build_object(
    'terminal_id', '00000001',
    'currency', 'PEN',
    '3ds_enabled', true
  )
WHERE gateway_name = 'niubiz';
```

### Paso 4: Código Frontend (React)

```typescript
// src/services/niubizService.ts

export async function initiateNiubizPayment(
  amount: number,
  studentId: string,
  userId: string
) {
  try {
    // 1. Crear transacción en nuestra DB
    const { data: transaction, error } = await supabase
      .from('payment_transactions')
      .insert({
        user_id: userId,
        student_id: studentId,
        amount: amount,
        currency: 'PEN',
        payment_gateway: 'niubiz',
        status: 'pending',
        payment_method: 'card'
      })
      .select()
      .single();

    if (error) throw error;

    // 2. Obtener token de sesión de Niubiz
    const sessionResponse = await fetch('/api/niubiz/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amount * 100, // Niubiz trabaja en centavos
        transactionId: transaction.id
      })
    });

    const { sessionToken } = await sessionResponse.json();

    // 3. Abrir modal de Niubiz (SDK)
    window.VisanetCheckout.configure({
      sessiontoken: sessionToken,
      channel: 'web',
      merchantid: 'TU_MERCHANT_ID',
      purchasenumber: transaction.id,
      amount: amount,
      expirationminutes: '20',
      timeouturl: `${window.location.origin}/payment/timeout`,
      merchantlogo: 'https://tu-logo.com/logo.png',
      formbuttoncolor: '#0066CC'
    });

    window.VisanetCheckout.open();

    // 4. Escuchar respuesta
    return new Promise((resolve, reject) => {
      window.addEventListener('niubiz-response', (event: any) => {
        if (event.detail.status === 'success') {
          resolve(event.detail);
        } else {
          reject(event.detail);
        }
      });
    });

  } catch (error) {
    console.error('Error en pago Niubiz:', error);
    throw error;
  }
}
```

### Paso 5: Backend/Edge Function para Webhooks

```typescript
// supabase/functions/niubiz-webhook/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const payload = await req.json()
    
    // 1. Verificar firma del webhook
    const signature = req.headers.get('x-niubiz-signature')
    if (!verifySignature(signature, payload)) {
      return new Response('Invalid signature', { status: 401 })
    }

    // 2. Actualizar transacción
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const { error } = await supabase
      .from('payment_transactions')
      .update({
        status: payload.status === 'approved' ? 'approved' : 'rejected',
        transaction_reference: payload.transactionUUID,
        authorization_code: payload.authorizationCode,
        card_brand: payload.cardBrand,
        card_last_four: payload.cardNumber.slice(-4),
        gateway_response: payload,
        processed_at: new Date().toISOString()
      })
      .eq('id', payload.purchasenumber)

    // El trigger apply_payment_recharge() aplicará la recarga automáticamente

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
```

---

## 3. 📱 IZIPAY - Para Yape/Plin

### ¿Por qué Izipay?
Es el único procesador en Perú que integra **Yape** y **Plin** directamente.

### Integración similar a Niubiz:

```typescript
export async function initiateIzipayPayment(
  amount: number,
  method: 'yape' | 'plin' | 'card',
  studentId: string
) {
  // 1. Crear orden en Izipay
  const orderResponse = await fetch('/api/izipay/order', {
    method: 'POST',
    body: JSON.stringify({
      amount: amount * 100,
      currency: 'PEN',
      paymentMethod: method,
      studentId: studentId
    })
  });

  const { formToken } = await orderResponse.json();

  // 2. Mostrar formulario de Izipay
  window.KRGlue.loadLibrary(
    'https://api.micuentaweb.pe',
    'TU_PUBLIC_KEY'
  ).then(({ KR }) => {
    KR.setFormConfig({
      formToken: formToken,
      'kr-language': 'es-PE'
    });

    if (method === 'yape' || method === 'plin') {
      // Mostrar QR para escanear
      KR.showForm();
    } else {
      // Mostrar formulario de tarjeta
      KR.renderElements('#payment-form');
    }
  });
}
```

---

## 4. 🔄 FLUJO COMPLETO DE PAGO

```
┌─────────────┐
│   PADRE     │
│ (Frontend)  │
└──────┬──────┘
       │
       │ 1. Elige monto y método
       ▼
┌─────────────────┐
│ RechargeModal   │
│ (Tu componente) │
└──────┬──────────┘
       │
       │ 2. Crea registro en payment_transactions (pending)
       ▼
┌──────────────────┐
│  Supabase DB     │
└──────┬───────────┘
       │
       │ 3. Redirige a pasarela
       ▼
┌──────────────────┐
│  NIUBIZ/IZIPAY   │
│  (Externo)       │
└──────┬───────────┘
       │
       │ 4. Procesa pago
       ▼
┌──────────────────┐
│   Webhook        │
│ (Edge Function)  │
└──────┬───────────┘
       │
       │ 5. Actualiza status a 'approved'
       ▼
┌──────────────────┐
│   TRIGGER SQL    │
│ (Automático)     │
└──────┬───────────┘
       │
       │ 6. Aplica recarga al saldo
       ▼
┌──────────────────┐
│  students.balance│
│  (Actualizado)   │
└──────────────────┘
```

---

## 5. 💰 COSTOS Y REQUISITOS

### Costos de apertura:
- **Niubiz**: S/ 0 (sin costo de apertura)
- **Izipay**: S/ 300-500 (setup)

### Comisiones por transacción:
- **Niubiz**: 2.5% + S/ 0.30
- **Izipay**: 3.5% + S/ 0.50
- **Yape/Plin (via Izipay)**: 2.5% + S/ 0.30

### Ejemplo práctico:
Si un padre recarga **S/ 50**:
- Con Niubiz: Paga S/ 51.55 (S/ 1.55 de comisión)
- Con Izipay: Paga S/ 52.25 (S/ 2.25 de comisión)

**Tip:** Puedes absorber la comisión o pasarla al cliente.

---

## 6. 🔒 SEGURIDAD

### Checklist obligatorio:
- ✅ SSL/HTTPS activado
- ✅ Credenciales en variables de entorno (NO en código)
- ✅ Webhook firmado y verificado
- ✅ 3D Secure activado (obligatorio para tarjetas)
- ✅ RLS activado en Supabase
- ✅ Logs de transacciones
- ✅ Timeouts para pagos pendientes

---

## 7. 📞 CONTACTOS

### Niubiz:
- Web: https://www.niubiz.com.pe/
- Teléfono: (01) 311-9898
- Email: comercial@niubiz.com.pe

### Izipay:
- Web: https://secure.micuentaweb.pe/
- Teléfono: (01) 708-5000
- Email: soporte@izipay.pe

---

## 8. ✅ PRÓXIMOS PASOS

1. **Hoy:**
   - ✅ Ejecutar `SISTEMA_CUENTA_LIBRE_Y_PAGOS.sql`
   - ✅ Probar interfaz en modo sandbox

2. **Esta semana:**
   - Contactar con Niubiz/Izipay
   - Solicitar credenciales sandbox
   - Implementar Edge Functions

3. **Próxima semana:**
   - Hacer pruebas reales
   - Certificar integración
   - Activar producción

---

**¿Necesitas ayuda con la integración? Escríbeme y te guío paso a paso.**

