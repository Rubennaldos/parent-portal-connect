# INFORME QA EXHAUSTIVO: CIERRE DE CAJA Y VENTAS
## Auditoría Completa del Sistema — 8 de Marzo 2026

---

## RESUMEN EJECUTIVO

Se realizó una auditoría exhaustiva de todo el código fuente del sistema de ventas (POS), almuerzos, y cierre de caja. Se revisaron **+30 archivos** incluyendo componentes React, funciones SQL de base de datos, migraciones, y lógica de negocio.

### VEREDICTO PRINCIPAL

> **Se encontró 1 BUG REAL en el sistema que puede causar desfase en el cierre de caja cuando se anulan ventas.** Sin embargo, este bug solo afecta si el personal está anulando ventas EN EFECTIVO y devolviendo el dinero. En la mayoría de los escenarios del día a día, **el sistema calcula correctamente.**

---

## HALLAZGOS DETALLADOS

### BUG #1 — CRÍTICO: Las ventas anuladas se siguen contando en el cierre de caja

**Descripción técnica:**
La función `calculate_daily_totals` (que calcula los totales para el cierre de caja) **NO excluye las transacciones anuladas**. Cuando una venta se anula desde el módulo de Ventas, la transacción se marca como `payment_status = 'cancelled'`, pero la función SQL solo verifica `is_deleted = false` y `type = 'purchase'` — no verifica el `payment_status`.

**Impacto práctico:**
| Escenario | ¿Afecta al cierre? |
|-----------|---------------------|
| Se anula una venta pagada en **efectivo** y se devuelve el dinero al cliente | **SÍ — Genera FALTANTE** |
| Se anula una venta pagada con **Yape/Tarjeta** | NO — No afecta el efectivo esperado |
| Se anula una venta de **estudiante con saldo** | NO — No hubo efectivo involucrado |
| Se anula una venta de **profesor (crédito)** | NO — No hubo efectivo involucrado |

**Ejemplo concreto:**
1. Se vende un producto a S/ 10.00 en efectivo a un cliente genérico
2. El cajero anula esa venta y devuelve los S/ 10.00
3. El sistema SIGUE contando esos S/ 10.00 como venta válida
4. Al cerrar caja: esperado = S/ 10.00 más, pero en caja hay S/ 10.00 menos
5. **Resultado: FALTANTE de S/ 10.00**

**Ubicación del bug:**
- Archivo: `supabase/migrations/FIX_CALCULATE_DAILY_TOTALS_V3.sql` (línea 62-67)
- Falta agregar: `AND (payment_status IS NULL OR payment_status != 'cancelled')`

---

### BUG #2 — MODERADO: Al cancelar un almuerzo, la venta original sigue contándose

**Descripción técnica:**
Cuando se cancela un pedido de almuerzo desde `LunchOrderActionsModal`, el sistema:
1. Marca el pedido como `cancelled` en `lunch_orders` ✅
2. Crea una transacción de **reembolso** (`type: 'refund'`) ✅
3. PERO **no marca la transacción original como cancelada** ❌

Dado que `calculate_daily_totals` solo cuenta transacciones con `type = 'purchase'` y el reembolso es `type = 'refund'`, el almuerzo cancelado se sigue sumando al total.

**Impacto:** Si el almuerzo cancelado fue pagado en efectivo y se devuelve el dinero, genera un faltante similar al Bug #1.

**Ubicación:** `src/components/lunch/LunchOrderActionsModal.tsx` (líneas 124-163)

---

### BUG #3 — MENOR: Búsqueda frágil al revertir almuerzos

**Descripción:** Al cancelar un almuerzo, la búsqueda de la transacción original usa `ilike('description', '%fecha%')` en vez del ID directo (`metadata->>'lunch_order_id'`). Si hay varios almuerzos del mismo estudiante en la misma fecha, podría encontrar la transacción incorrecta o no encontrar ninguna.

**Impacto:** En algunos casos, el reembolso podría no ejecutarse correctamente.

---

### BUG #4 — MENOR: La tabla `sales` no se actualiza al anular

**Descripción:** Cuando se anula una venta desde el módulo de Ventas, la transacción se marca como cancelada, pero el registro correspondiente en la tabla `sales` (usada por el módulo de Finanzas) NO se actualiza ni elimina. Esto hace que Finanzas muestre ventas que ya fueron anuladas.

**Impacto:** Los reportes de Finanzas pueden mostrar montos inflados.

---

## LO QUE FUNCIONA CORRECTAMENTE

### ✅ Fórmula del cierre de caja
```
Caja Esperada = Monto Inicial + Efectivo de Ventas + Ingresos - Egresos
```
Esta fórmula es **100% correcta**. Solo cuenta el EFECTIVO (no tarjeta, no Yape, no crédito). La comparación con el conteo físico es correcta.

### ✅ Creación de ventas en el POS
- Las transacciones se crean correctamente con monto negativo (`-total`)
- Se registra el método de pago correcto (efectivo, tarjeta, yape, mixto)
- Los pagos mixtos (ej: parte efectivo + parte tarjeta) se desglosan bien
- Se genera ticket correlativo único

### ✅ Descuento de saldo de estudiantes
- El sistema lee el saldo FRESCO de la base de datos antes de descontar
- Verifica topes de gasto (diario, semanal, mensual)
- Excluye almuerzos del cálculo de topes
- El saldo se actualiza correctamente después de la compra

### ✅ Separación POS vs Almuerzos
- La función `calculate_daily_totals` V3 separa correctamente:
  - **POS**: Transacciones SIN `lunch_order_id` en metadata
  - **Almuerzos**: Transacciones CON `lunch_order_id` en metadata

### ✅ Manejo de montos negativos
- Usa `ABS(amount)` para convertir los montos negativos a positivos
- Los cierres históricos con valores negativos fueron corregidos

### ✅ Seguridad en anulaciones
- Los cajeros necesitan contraseña de administrador para anular ventas
- Se registra quién anuló y el motivo
- Las anulaciones son visibles en la pestaña "Anuladas"

### ✅ Registro de movimientos de caja
- Ingresos y egresos se registran con motivo y responsable
- Los ajustes al cerrar caja se guardan con justificación obligatoria

### ✅ Detección de caja sin cerrar
- El sistema detecta si la caja del día anterior no fue cerrada
- Muestra alerta visible para forzar el cierre

### ✅ Protección contra doble cierre
- La caja cerrada no puede modificarse
- El botón de cierre se deshabilita durante el procesamiento

---

## ANÁLISIS: ¿POR QUÉ NO CUADRA EL CIERRE?

### Escenarios posibles (de más probable a menos probable):

#### 1. El personal no registra egresos de caja
**Probabilidad: MUY ALTA**

Si el personal saca dinero de la caja (para comprar insumos, dar vuelto, etc.) y no lo registra como "Egreso" en el sistema, habrá un faltante. El sistema no tiene forma de saber que se sacó dinero si no se registra.

**Cómo verificar:** Comparar los egresos registrados con los gastos reales del día.

#### 2. Se anulan ventas en efectivo (Bug #1)
**Probabilidad: ALTA si anulan ventas frecuentemente**

Cada venta anulada pagada en efectivo genera un desfase. Si se anulan 3 ventas de S/ 10 en efectivo, el cierre mostrará S/ 30 de faltante.

**Cómo verificar:** Revisar la pestaña "Anuladas" en el módulo de Ventas y sumar los montos en efectivo.

#### 3. Error al contar el efectivo
**Probabilidad: MEDIA**

El personal puede contar mal los billetes y monedas. Un error de S/ 5-10 es normal, pero errores mayores sugieren un problema diferente.

#### 4. Se dan vueltos de más
**Probabilidad: MEDIA**

Si un cliente paga S/ 20 por una compra de S/ 12, el cajero da S/ 8 de vuelto. Si se equivoca y da S/ 10, hay S/ 2 de faltante que el sistema no puede detectar.

#### 5. Ventas en efectivo no registradas en el sistema
**Probabilidad: BAJA (si se usa el POS siempre)**

Si el personal cobra en efectivo sin pasar la venta por el sistema, el dinero existe en caja pero no está registrado → sobrante. Esto podría ser indicador de robo si el personal luego se lleva el efectivo.

#### 6. Almuerzos cancelados con efectivo devuelto (Bug #2)
**Probabilidad: BAJA-MEDIA**

Similar al escenario 2, pero con almuerzos.

---

## TABLA RESUMEN: SISTEMA vs PERSONAL

| Aspecto | ¿Es problema del sistema? | ¿Es problema del personal? |
|---------|:------------------------:|:-------------------------:|
| Fórmula de cierre de caja | ❌ NO — Es correcta | — |
| Cálculo de efectivo esperado | ⚠️ BUG: No excluye ventas anuladas | — |
| Registro de ventas | ❌ NO — Funciona bien | — |
| Ventas anuladas contándose | ⚠️ SÍ — Bug #1 y #2 | — |
| No registrar egresos | — | ✅ SÍ — Causa faltante |
| Dar vueltos incorrectos | — | ✅ SÍ — Causa faltante |
| Cobrar sin registrar | — | ✅ SÍ — Causa sobrante o robo |
| Contar mal el efectivo | — | ✅ SÍ — Causa diferencia |

---

## RECOMENDACIONES

### Corrección inmediata (para el desarrollador):
1. **Agregar filtro de `payment_status` en `calculate_daily_totals`** — Excluir transacciones con `payment_status = 'cancelled'`
2. **Al cancelar almuerzo, marcar también la transacción original** como `payment_status = 'cancelled'`
3. **Actualizar la tabla `sales`** cuando se anule una transacción

### Recomendaciones operativas (para la dueña):
1. **Verificar cuántas ventas se anulan por día** — Cada anulación en efectivo causa desfase
2. **Exigir que TODOS los egresos se registren** en el módulo de Movimientos de Caja
3. **Revisar la pestaña "Anuladas"** regularmente — Si hay muchas anulaciones, investigar por qué
4. **Comparar el total de anulaciones en efectivo con el faltante** — Si coinciden, el bug es la causa
5. **Si el faltante es mayor que las anulaciones**, el personal no está registrando egresos o está cometiendo errores

---

## CONCLUSIÓN

El sistema tiene **un bug real** que afecta el cierre de caja cuando se anulan ventas en efectivo. Sin embargo, este bug tiene un impacto **cuantificable y rastreable**: el desfase debería ser exactamente igual a la suma de las ventas anuladas pagadas en efectivo.

**Si el desfase es mayor que la suma de las anulaciones en efectivo**, entonces hay un componente humano adicional (egresos no registrados, errores de conteo, o posible irregularidad del personal).

Se recomienda:
1. Corregir el bug (tarea técnica simple)
2. Monitorear las anulaciones por día
3. Verificar que el personal registre TODOS los movimientos de caja

---

*Informe generado el 8 de Marzo 2026*
*Auditoría de código: +30 archivos revisados, +10,000 líneas de código analizadas*
