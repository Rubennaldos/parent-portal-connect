# 📋 Resumen de Mejoras - Portal de Padres

## 🆕 Nuevas Funcionalidades

### 1. **Anular Pedidos Individuales**
Los padres ahora pueden anular pedidos de almuerzo directamente desde la pestaña **"Mis Pedidos"**.

**¿Cómo funciona?**
- Cada pedido muestra un botón **"Anular pedido"** si cumple las condiciones
- El sistema verifica automáticamente:
  - ✅ Si el pedido está dentro del plazo de cancelación
  - ✅ Si el pedido ya fue pagado o no

**Casos especiales:**
- **Pedido ya pagado:** Muestra mensaje indicando que deben contactar a la administración para gestionar el reembolso
- **Fuera del plazo:** Muestra mensaje indicando que ya venció el plazo de cancelación
- **Pedido cancelado:** Al anular, se cancela automáticamente la deuda asociada

---

### 2. **Desactivar Kiosco Escolar**
Los padres pueden desactivar la cuenta del kiosco para sus hijos, permitiendo solo pedidos de almuerzo.

**¿Dónde se configura?**
- Durante el proceso de registro inicial (onboarding)
- En la configuración de límites de gasto de cada estudiante

**¿Qué implica?**
- El estudiante **NO podrá comprar** productos en el kiosco
- El estudiante **SÍ podrá pedir** almuerzos a través del calendario
- En el POS, el estudiante aparece con estado **"Sin cuenta — Solo almuerzo"**

---

### 3. **Pago Selectivo de Deudas**
Los padres pueden elegir qué transacciones pagar, en lugar de pagar toda la deuda de una vez.

**¿Cómo funciona?**
- En la pestaña **"Pagos"**, cada transacción tiene un checkbox
- El padre selecciona las transacciones que desea pagar
- El sistema muestra un desglose claro de lo que se está pagando
- Se puede ver el detalle antes de enviar el comprobante

---

## 🔧 Mejoras Técnicas

### **Sistema de Cancelación Inteligente**
- Verifica automáticamente el estado de pago de cada pedido
- Respeta los plazos de cancelación configurados por colegio
- Cancela automáticamente las deudas asociadas cuando se anula un pedido

### **Mejoras en la Visualización**
- Badges de estado más claros (Pago aprobado, Pendiente, Anulado)
- Mensajes informativos cuando no se puede anular un pedido
- Advertencias visibles para pedidos que requieren atención del administrador

---

## ⚠️ Importante para Administradores

### **Pedidos Ya Pagados**
Si un padre quiere anular un pedido que **ya fue pagado y aprobado**, el sistema **NO permite** la anulación automática. En estos casos:

1. El padre verá un mensaje indicando que debe contactar a la administración
2. El administrador debe:
   - Revisar el caso en el módulo de **Cobranzas → Vouchers**
   - Si corresponde, rechazar el voucher de pago
   - O gestionar el reembolso según las políticas del colegio

### **Plazos de Cancelación**
Los plazos de cancelación se configuran en la tabla `lunch_configuration` por colegio:
- `cancellation_deadline_time`: Hora límite (ej: "23:59:59")
- `cancellation_deadline_days`: Días antes de la fecha del pedido

---

## 📝 Notas Adicionales

- Todos los cambios son retrocompatibles
- No se requiere migración de datos adicional
- Los pedidos históricos mantienen su estado original
- El sistema valida automáticamente todas las condiciones antes de permitir acciones

---

**Última actualización:** Marzo 2025
