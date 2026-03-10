# 📋 Explicación: Pedidos Cancelados y Aprobación de Vouchers

## 📊 Flujo Visual del Proceso

```
┌─────────────────────────────────────────────────────────────┐
│  FLUJO NORMAL (Sin cancelación)                             │
└─────────────────────────────────────────────────────────────┘

1. Padre hace pedido de almuerzo
   └─> Se crea: lunch_order (status: 'pending')
   └─> Se crea: transaction (payment_status: 'pending') ← DEUDA

2. Padre envía voucher de pago
   └─> Se crea: recharge_request (status: 'pending')
   └─> Voucher aparece en tu panel como "Pendiente"

3. Tú apruebas el voucher
   └─> recharge_request → status: 'approved' ✅
   └─> transaction → payment_status: 'paid' ✅
   └─> lunch_order → status: 'confirmed' ✅
   └─> DEUDA DESAPARECE del módulo de pagos del padre

┌─────────────────────────────────────────────────────────────┐
│  FLUJO CON CANCELACIÓN (Caso problemático)                  │
└─────────────────────────────────────────────────────────────┘

1. Padre hace pedido de almuerzo
   └─> Se crea: lunch_order (status: 'pending')
   └─> Se crea: transaction (payment_status: 'pending') ← DEUDA

2. Padre envía voucher de pago
   └─> Se crea: recharge_request (status: 'pending')
   └─> Voucher aparece en tu panel como "Pendiente"

3. ⚠️ Padre (o tú) CANCELA el pedido
   └─> lunch_order → is_cancelled: true, status: 'cancelled' ❌
   └─> transaction → payment_status: 'cancelled' ❌
   └─> PERO el voucher sigue "Pendiente" (no se borra)

4. Tú intentas aprobar el voucher
   └─> Sistema detecta: "Pedido cancelado" ⚠️
   └─> ANTES: Bloqueaba la aprobación ❌
   └─> AHORA: Te avisa pero permite aprobar ✅

5. Tú apruebas el voucher (aunque esté cancelado)
   └─> recharge_request → status: 'approved' ✅
   └─> transaction → payment_status: 'paid' ✅ (se actualiza)
   └─> DEUDA DESAPARECE del módulo de pagos del padre ✅
   └─> Pedido sigue cancelado (no se entregará) ⚠️
```

## 🎯 Conceptos Importantes

### ❌ **ANULAR/CANCELAR un pedido** (NO es pagar)
- **Significa:** Eliminar el pedido de almuerzo antes de que se entregue
- **NO significa:** Que el padre ya pagó
- **En el sistema:** "Cancelar" y "Anular" son **sinónimos** (ambos eliminan el pedido)
- **Estado:** El pedido queda como `is_cancelled = true` y `status = 'cancelled'`
- **Deuda:** La deuda sigue pendiente hasta que se apruebe un voucher

### ✅ **APROBAR un voucher** (SÍ es pagar)
- **Significa:** El padre **ya envió el comprobante** (Yape, Plin, transferencia)
- **Tu acción:** Verificas el comprobante y apruebas el pago
- **Resultado:** La deuda se **liquida** y desaparece del módulo de pagos del padre

### 🔑 **Diferencia clave:**
- **Cancelar/Anular pedido** = Eliminar el pedido (el padre **NO pagó** todavía)
- **Aprobar voucher** = Confirmar que el padre **SÍ pagó** (ya envió el comprobante)

---

## ⚠️ ¿Cómo puede haber un voucher pendiente si el pedido está cancelado?

### Escenario 1: El padre canceló DESPUÉS de enviar el voucher
1. **Día 1 (10:00 AM):** Padre hace pedido de almuerzo → Se crea deuda pendiente
2. **Día 1 (11:00 AM):** Padre envía voucher de pago → Voucher queda "Pendiente" en tu panel
3. **Día 1 (2:00 PM):** Padre cancela el pedido porque cambió de opinión → Pedido queda "Cancelado"
4. **Día 2:** Tú intentas aprobar el voucher → El sistema detecta que el pedido está cancelado

### Escenario 2: El admin canceló el pedido, pero el padre ya había enviado el voucher
1. **Día 1 (10:00 AM):** Padre hace pedido de almuerzo → Se crea deuda pendiente
2. **Día 1 (11:00 AM):** Padre envía voucher de pago → Voucher queda "Pendiente"
3. **Día 1 (12:00 PM):** Tú cancelas el pedido (ej: no hay menú ese día) → Pedido queda "Cancelado"
4. **Día 2:** Intentas aprobar el voucher → El sistema detecta que el pedido está cancelado

---

## 🔴 ANTES (Comportamiento Anterior)

### ❌ Problema:
- Si el sistema detectaba que el pedido estaba **cancelado**, **bloqueaba completamente** la aprobación
- Mostraba error rojo: "Pedidos cancelados. Verifica antes de aprobar"
- **No podías aprobar el voucher** aunque el padre ya hubiera pagado

### 💔 Consecuencia:
- El padre **ya pagó** (envió el comprobante)
- Pero la deuda **no se descontaba** porque no podías aprobar
- El padre seguía viendo la deuda pendiente en su módulo de pagos
- **Confusión y reclamos**

---

## ✅ AHORA (Comportamiento Nuevo)

### ✅ Solución:
- El sistema **detecta** si hay pedidos cancelados
- Te **avisa** con un mensaje naranja (no bloquea)
- **Permite aprobar el voucher** de todas formas

### 📊 Mensajes que verás:

#### Caso 1: Todos los pedidos están cancelados
```
⚠️ Pedidos cancelados — aprobando de todas formas
1 pedido(s) ya estaban cancelados. Se aprueba el comprobante 
y se libera la deuda pendiente.
```

#### Caso 2: Algunos cancelados, algunos activos
```
⚠️ Atención
1 pedido(s) cancelado(s). Se aprobará el pago de los 2 pedido(s) activos.
```

#### Caso 3: Ninguno cancelado (normal)
```
✅ Pago de almuerzo aprobado ✔
Se confirmó el pago total de S/ 13.00 de Aitana Mur Ordaya.
```

---

## 🎯 ¿Qué debes hacer como administrador?

### ✅ **SIEMPRE aprueba el voucher si:**
- El comprobante es **válido** (número de operación correcto, monto correcto)
- El padre **ya pagó** (envió Yape, Plin, transferencia)

### ⚠️ **Aviso sobre pedidos cancelados:**
- Es solo una **información** para que sepas qué pasó
- **NO impide** que apruebes el voucher
- El sistema **liquida la deuda** aunque el pedido esté cancelado

### 📝 **Ejemplo práctico:**

**Situación:**
- Padre pidió almuerzo para el 6 de marzo
- Padre envió voucher de S/ 13.00
- Luego canceló el pedido (o tú lo cancelaste)
- Ahora intentas aprobar el voucher

**Acción:**
1. ✅ Verifica que el comprobante sea válido
2. ✅ Verifica que el monto sea correcto (S/ 13.00)
3. ✅ Haz clic en "Aprobar" aunque veas el aviso naranja
4. ✅ El sistema aprobará el pago y liquidará la deuda

---

## 🔑 Resumen para Administradores

| Situación | ¿Qué hacer? |
|-----------|-------------|
| Voucher válido + Pedido activo | ✅ Aprobar normalmente |
| Voucher válido + Pedido cancelado | ✅ Aprobar igual (el aviso es solo informativo) |
| Voucher inválido (monto incorrecto, sin número de operación) | ❌ Rechazar |

---

## ❓ Preguntas Frecuentes

### ¿Un padre puede pagar sin que se apruebe el voucher?
**NO.** El flujo es:
1. Padre hace pedido → Se crea deuda pendiente
2. Padre envía voucher → Voucher queda "Pendiente" (NO está pagado todavía)
3. Admin aprueba voucher → **AHORA SÍ** el pago se registra y la deuda se liquida

**Hasta que TÚ apruebes el voucher, el padre NO ha pagado oficialmente en el sistema.**

### ¿Por qué el padre puede cancelar un pedido si ya envió el voucher?
**Buena pregunta.** Esto puede pasar porque:
- El padre **envió el voucher** (paso 2 del flujo anterior)
- Pero el voucher **aún está pendiente** (no lo has aprobado)
- El padre puede **cancelar el pedido** mientras espera tu aprobación
- Cuando intentas aprobar, encuentras el pedido cancelado

**Importante:** Aunque el pedido esté cancelado, si el voucher es válido, **debes aprobarlo** porque el padre ya hizo el pago (envió el comprobante).

### ¿Qué pasa si apruebo un voucher de un pedido cancelado?
- ✅ El pago se registra como aprobado
- ✅ La deuda se liquida (desaparece del módulo de pagos del padre)
- ✅ El pedido sigue cancelado (no se entregará el almuerzo)
- ✅ Todo queda correcto en el sistema

### ¿Debo contactar al padre si veo el aviso de pedido cancelado?
- **No es necesario** si el comprobante es válido
- El aviso es solo para que sepas qué pasó
- Puedes aprobar directamente

---

## 📞 Si tienes dudas

Si ves un caso que no está cubierto aquí, contacta al equipo técnico con:
- Screenshot del voucher
- Nombre del alumno
- Fecha del pedido
- Motivo de la duda
