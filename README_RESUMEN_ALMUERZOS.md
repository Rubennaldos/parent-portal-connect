# 📊 Resumen de Pedidos de Almuerzo - Próxima Semana

Este conjunto de consultas SQL te permite obtener un resumen detallado de todos los pedidos de almuerzo para la próxima semana (lunes a viernes), agrupados por sede.

## 📁 Archivos Disponibles

### 1. `RESUMEN_ALMUERZOS_SIMPLE.sql`
**Resumen rápido por sede**
- Total de pedidos
- Pedidos pagados vs pendientes
- Montos totales, pagados y pendientes
- **Úsalo para:** Ver el panorama general rápidamente

### 2. `DETALLE_ALMUERZOS_POR_SEDE.sql`
**Lista completa de pedidos con todos los detalles**
- Fecha del pedido
- Nombre del padre e hijo
- Email y teléfono del padre
- Monto del pedido
- Estado de pago (✅ PAGADO / ⚠️ PENDIENTE)
- Método de pago
- **Úsalo para:** Ver cada pedido individual con toda su información

### 3. `LISTA_CONTACTOS_PADRES.sql`
**Agrupado por padre para contacto masivo**
- Lista de padres con sus hijos
- Total de pedidos por padre
- Estado de pago (si tiene pendientes o todo pagado)
- Montos consolidados
- **Úsalo para:** Preparar la lista de contactos para notificar a los padres

### 4. `RESUMEN_ALMUERZOS_PROXIMA_SEMANA.sql`
**Consulta completa con múltiples vistas**
- Incluye 3 consultas en un solo archivo:
  1. Resumen por sede
  2. Detalle completo
  3. Resumen por padre
- **Úsalo para:** Tener todas las vistas en un solo lugar

### 5. `GENERAR_INFORME_MD_SEDES.sql` ⭐ NUEVO
**Generador de informe Markdown listo para enviar a administradores**
- Ejecuta UNA sola consulta → devuelve **una celda con el Markdown completo**
- Secciones separadas por cada sede
- Resumen general con totales globales
- Tabla detallada por padre/tutor (⚠️ pendientes primero)
- Columnas: estado de pago, nombre padre, email, teléfono, hijo(s), pedidos, monto total, por cobrar
- **Úsalo para:** Copiar el resultado y enviarlo directamente por correo/WhatsApp a los administradores

## 🚀 Cómo Usar

1. **Abre Supabase Dashboard** → SQL Editor
2. **Copia y pega** la consulta que necesites
3. **Ejecuta** la consulta
4. **Exporta** los resultados a CSV o Excel para trabajar con ellos

## 📋 Información Incluida

Todas las consultas incluyen:

- ✅ **Sede** (código y nombre)
- ✅ **Fecha del pedido**
- ✅ **Nombre del padre**
- ✅ **Nombre del hijo**
- ✅ **Email del padre** (para contacto)
- ✅ **Teléfono del padre** (si está registrado)
- ✅ **Cantidad y monto** del pedido
- ✅ **Estado de pago** (Pagado / Pendiente)
- ✅ **Método de pago** (Transacción, Voucher, o Pendiente)

## 🔍 Cómo Determina si Está Pagado

Un pedido se considera **PAGADO** si:
- ✅ Tiene una transacción tipo `purchase` o `debit` con `metadata.lunch_order_id`
- ✅ O está incluido en un `recharge_request` aprobado con `status = 'approved'`

Un pedido se considera **PENDIENTE** si:
- ⚠️ No cumple ninguna de las condiciones anteriores

## 📅 Rango de Fechas

Las consultas calculan automáticamente:
- **Inicio:** Próximo lunes (o hoy si es lunes)
- **Fin:** Viernes de esa semana

## 💡 Próximos Pasos

Una vez que tengas la lista:

1. **Revisa el resumen simple** para ver el panorama general
2. **Exporta el detalle completo** para trabajar con los datos
3. **Usa la lista de contactos** para preparar los correos/mensajes
4. **Prepara la migración SQL** para reprogramar los pedidos

## ⚠️ Notas Importantes

- Solo incluye pedidos **NO cancelados** (`is_cancelled = false`)
- Solo incluye pedidos con estado: `confirmed`, `pending_payment`, o `delivered`
- Los padres sin email aparecerán con `NULL` en el campo email
- Los padres sin teléfono aparecerán como "No registrado"
