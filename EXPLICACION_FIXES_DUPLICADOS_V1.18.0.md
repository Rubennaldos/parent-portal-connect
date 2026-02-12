# 🔧 EXPLICACIÓN COMPLETA: Fixes para Duplicados y Pagos Automáticos
**Versión**: 1.18.0  
**Fecha**: 11 de febrero, 2026  
**Problema reportado**: Saint George Miraflores (y TODAS las sedes)

---

## 🍎 EL PROBLEMA EXPLICADO CON MANZANAS

### Situación inicial:
Imagina que tienes una frutería y un cuaderno para anotar las deudas de tus clientes.

**LO QUE PASABA:**

1. **Carmen Rosa** viene el lunes y te pide 5 manzanas para toda la semana:
   - Lunes: 1 manzana (S/ 15)
   - Martes: 1 manzana (S/ 14)
   - Miércoles: 1 manzana (S/ 15)
   - Jueves: 1 manzana (S/ 15)
   - Viernes: 1 manzana (S/ 15)

2. Tú anotas en tu cuaderno **el LUNES**:
   ```
   LUNES 9 de febrero:
   - Carmen Rosa debe S/ 15 por manzana del lunes
   - Carmen Rosa debe S/ 14 por manzana del martes
   - Carmen Rosa debe S/ 15 por manzana del miércoles
   - Carmen Rosa debe S/ 15 por manzana del jueves
   - Carmen Rosa debe S/ 15 por manzana del viernes
   ```

3. Luego, tu empleado (el sistema de cobranzas) revisa el cuaderno y dice:
   - "🤔 Veo una deuda de Carmen Rosa del 9 de febrero (lunes)"
   - "🤔 Veo una deuda de Carmen Rosa del 10 de febrero (martes)"
   - "🤔 ¿Miércoles, jueves, viernes? No veo deudas de esos días..."
   - **"¡Ah! Seguro olvidé anotarlas, voy a crearlas de nuevo"** ❌

4. AHORA Carmen Rosa aparece con:
   - ✅ 5 deudas REALES (las que anotaste el lunes)
   - ❌ 3 deudas DUPLICADAS (las que tu empleado creó "de nuevo")
   - **TOTAL: 8 deudas cuando solo debería tener 5** 😱

5. Cuando le cobras, el sistema crea OTRA transacción más (9 total) y algunas se marcan como "pagadas" aunque no tienen método de pago.

---

## 🔍 LA CAUSA RAÍZ TÉCNICA

### Problema #1: Matching defectuoso en `BillingCollection.tsx`

**ANTES:**
```typescript
// El sistema comparaba la FECHA DE CREACIÓN con la FECHA DEL PEDIDO
const transDate = t.created_at.split('T')[0]; // "2026-02-09" (lunes)
const orderDate = order.order_date; // "2026-02-13" (viernes)

// Diferencia: 4 días → NO MATCHEA → Crea duplicado virtual
```

**Ejemplo real de Carmen Rosa:**
- **9 de febrero** crea 5 transacciones con `created_at = "2026-02-09 14:59:XX"`
- Transacciones para: 9, 10, 11, 12, 13 de febrero
- El sistema solo matcheaba las del 9 y 10 (diferencia ≤ 1 día)
- **Las del 11, 12, 13 NO MATCHEABAN** → Creaba 3 duplicados virtuales

### Problema #2: Transacciones sin `metadata.lunch_order_id`

**ANTES:**
Los componentes creaban transacciones así:
```typescript
await supabase.from('transactions').insert({
  teacher_id: teacherId,
  amount: -15.00,
  description: "Almuerzo - 11 de febrero",
  payment_status: 'pending'
  // ❌ SIN metadata con lunch_order_id
});
```

Sin el `lunch_order_id`, el sistema no podía saber si una transacción YA EXISTÍA para ese pedido.

### Problema #3: `handleRegisterPayment` sin protección anti-duplicados

**ANTES:**
Cuando cobrabas, el sistema:
1. Materializaba transacciones virtuales (las duplicadas)
2. Las insertaba SIN verificar si ya existía una real
3. **NO registraba quién cobró** (`created_by = null`)
4. Resultado: duplicados en "Pagos Realizados"

### Problema #4: Transacciones marcadas "paid" sin payment_method

Cuando el sistema creaba duplicados y los materializaba, quedaban como:
```json
{
  "payment_status": "paid",
  "payment_method": null, // ❌ ¿Cómo pagó si no hay método?
  "created_by": null // ❌ ¿Quién cobró?
}
```

---

## ✅ LAS SOLUCIONES IMPLEMENTADAS

### Fix #1: Matching por fecha EN LA DESCRIPCIÓN (no created_at)

**Archivo**: `src/components/billing/BillingCollection.tsx` (líneas 445-487)

**DESPUÉS:**
```typescript
// Ahora extrae la fecha del pedido desde la descripción
const orderDateFormatted = "11 de febrero"; 

// Busca en la descripción: "Almuerzo - Menú Light - 11 de febrero"
if (t.description?.includes(orderDateFormatted)) {
  return true; // ✅ MATCHEA correctamente
}
```

**Resultado**: Ya NO se crean duplicados virtuales porque encuentra correctamente las transacciones reales.

---

### Fix #2: Agregar `metadata.lunch_order_id` en TODOS los puntos de creación

**Archivos modificados**:
1. ✅ `OrderLunchMenus.tsx` (línea ~510)
2. ✅ `LunchOrders.tsx` (línea ~615)
3. ✅ `TeacherLunchCalendar.tsx` (línea ~290)
4. ✅ `PhysicalOrderWizard.tsx` (línea ~351)
5. ✅ `LunchOrderCalendar.tsx` (padres, línea ~589)

**DESPUÉS:**
```typescript
await supabase.from('transactions').insert({
  teacher_id: teacherId,
  amount: -15.00,
  description: "Almuerzo - 11 de febrero",
  payment_status: 'pending',
  metadata: {
    lunch_order_id: insertedOrder.id, // ✅ LINK directo al pedido
    source: 'teacher_lunch_calendar',
    order_date: '2026-02-11'
  }
});
```

**Resultado**: Cada transacción queda "vinculada" a su lunch_order, imposible duplicar.

---

### Fix #3: Anti-duplicados en `handleRegisterPayment` + `created_by`

**Archivo**: `src/components/billing/BillingCollection.tsx` (líneas 814-871)

**DESPUÉS:**
```typescript
// 1. Verificar que no existan transacciones reales para estos lunch_orders
const existingTx = await supabase
  .from('transactions')
  .select('metadata');

existingTx.forEach((tx) => {
  if (tx.metadata?.lunch_order_id) {
    existingLunchOrderIds.add(tx.metadata.lunch_order_id);
  }
});

// 2. Filtrar las virtuales que YA tienen transacción real
const transactionsToCreate = virtualTransactions.filter((vt) => {
  if (existingLunchOrderIds.has(vt.metadata?.lunch_order_id)) {
    console.log('⏭️ Omitiendo duplicado');
    return false; // ✅ NO crear
  }
  return true;
});

// 3. Agregar created_by (quién cobró)
transaction.created_by = user.id; // ✅ Registra al cajero/admin
```

**Resultado**: 
- ✅ NO se crean duplicados al cobrar
- ✅ Queda registrado quién hizo el cobro
- ✅ Si un cajero intenta cobrar 2 veces, el sistema detecta que ya existe

---

## 🧪 CÓMO PROBAR LAS SOLUCIONES

### Prueba 1: Verificar que no se crean duplicados virtuales

**Pasos:**
1. Ve a "Cobranzas" → "Por Cobrar"
2. Busca a Carmen Rosa Rios Ramal
3. **Antes**: Veías 8 transacciones (5 reales + 3 duplicadas)
4. **Después**: Deberías ver solo 5 transacciones (las reales)

**Consola del navegador:**
```
✅ [BillingCollection] Pedido XXX (2026-02-11) tiene transacción real (sin metadata), omitiendo virtual
✅ [BillingCollection] Pedido YYY (2026-02-12) tiene transacción real (sin metadata), omitiendo virtual
```

---

### Prueba 2: Crear un pedido nuevo y verificar metadata

**Pasos:**
1. Como profesor, ve a tu perfil → "Pedir Almuerzo"
2. Selecciona un día futuro (ej: 14 de febrero)
3. Confirma el pedido
4. En Supabase, ejecuta:
   ```sql
   SELECT id, description, metadata 
   FROM transactions 
   WHERE teacher_id = 'TU_ID'
   ORDER BY created_at DESC 
   LIMIT 1;
   ```
5. **Resultado esperado**:
   ```json
   {
     "metadata": {
       "lunch_order_id": "abc-123-def",
       "source": "teacher_lunch_calendar",
       "order_date": "2026-02-14"
     }
   }
   ```

---

### Prueba 3: Cobrar una deuda y verificar que no duplica

**Pasos:**
1. Ve a "Cobranzas" → "Por Cobrar"
2. Selecciona una deuda de profesor (ej: Carmen Rosa, 1 transacción)
3. Haz clic en "Cobrar" → Ingresa método de pago (yape) y número de operación
4. Confirma el pago
5. Refresca la página
6. **Resultado esperado**:
   - ✅ La deuda desaparece de "Por Cobrar"
   - ✅ Aparece UNA VEZ en "Pagos Realizados" (no duplicada)
   - ✅ Muestra el método de pago ("yape") y el número de operación
   - ✅ Muestra "Registrado por: [Tu Nombre] - [Tu Rol]"

**Consola del navegador:**
```
✅ [BillingCollection] Transacciones nuevas creadas: 1
```

---

### Prueba 4: Intentar cobrar la misma deuda 2 veces (anti-duplicados)

**Pasos:**
1. Abre 2 pestañas del navegador
2. En ambas, ve a "Cobranzas" → "Por Cobrar"
3. En pestaña 1: Cobra una deuda de Carmen Rosa
4. **SIN REFRESCAR**, en pestaña 2: Intenta cobrar la misma deuda
5. **Resultado esperado**:
   - ✅ La segunda vez, el sistema detecta que ya existe y NO crea duplicado
   - ✅ En consola: `⏭️ Omitiendo duplicado para lunch_order: abc-123`

---

## 📊 SQL PARA VERIFICAR ESTADO ACTUAL

### Verificar duplicados existentes (ANTES de limpiar):

```sql
-- Duplicados por metadata
SELECT 
  t.metadata->>'lunch_order_id' as lunch_order_id,
  COUNT(*) as cantidad
FROM transactions t
WHERE t.metadata->>'lunch_order_id' IS NOT NULL
GROUP BY t.metadata->>'lunch_order_id'
HAVING COUNT(*) > 1;
```

### Verificar transacciones "paid" sin payment_method:

```sql
SELECT 
  tp.full_name as profesor,
  t.payment_status,
  t.payment_method,
  t.created_by,
  COUNT(*) as cantidad
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.payment_status = 'paid'
  AND t.payment_method IS NULL
  AND t.teacher_id IS NOT NULL
GROUP BY tp.full_name, t.payment_status, t.payment_method, t.created_by;
```

---

## 🧹 LIMPIEZA DE DATOS EXISTENTES

**Archivo SQL**: `supabase/migrations/FIX_SGM_DUPLICATES_AND_PAID.sql`

Este archivo contiene queries para:
1. ✅ Identificar duplicados existentes
2. ✅ Mover transacciones "paid" sin payment_method a "pending"
3. ✅ Eliminar transacciones duplicadas (virtuales materializadas a midnight)

**⚠️ IMPORTANTE**: Ejecutar este SQL MANUALMENTE después de revisar los resultados de las queries de diagnóstico.

---

## 📋 CHECKLIST DE VERIFICACIÓN

### Antes de hacer deploy:
- [x] Fix #1: Matching por fecha en descripción
- [x] Fix #2: Metadata con lunch_order_id en todos los puntos
- [x] Fix #3: Anti-duplicados en handleRegisterPayment
- [x] Fix #4: Agregar created_by al cobrar
- [x] SQL de limpieza creado
- [ ] **FALTA**: Ejecutar SQL de limpieza en producción
- [ ] **FALTA**: Hacer deploy de v1.18.0
- [ ] **FALTA**: Probar en producción con datos reales

### Después de hacer deploy:
- [ ] Prueba 1: Verificar que no se crean duplicados virtuales
- [ ] Prueba 2: Crear pedido nuevo y verificar metadata
- [ ] Prueba 3: Cobrar deuda y verificar que no duplica
- [ ] Prueba 4: Intentar cobrar 2 veces (anti-duplicados)
- [ ] Verificar TODAS las sedes (no solo SGM):
  - [ ] Saint George Miraflores
  - [ ] Otras sedes que tengas configuradas

---

## 🎯 RESUMEN EJECUTIVO

### ¿Qué causaba el problema?
1. El sistema comparaba FECHA DE CREACIÓN en vez de FECHA DEL PEDIDO
2. Las transacciones no tenían `lunch_order_id` para vincularlas al pedido
3. Al cobrar, no verificaba si ya existía una transacción para ese pedido

### ¿Cómo se resolvió?
1. ✅ Ahora busca la fecha del pedido EN LA DESCRIPCIÓN
2. ✅ Todas las transacciones tienen `metadata.lunch_order_id`
3. ✅ Al cobrar, verifica que no existan duplicados antes de insertar
4. ✅ Registra quién cobró (`created_by`)

### ¿Dónde aplica?
🌍 **TODAS LAS SEDES** (no solo Saint George Miraflores)

### ¿Qué falta hacer?
1. Ejecutar SQL de limpieza para datos existentes
2. Hacer deploy de v1.18.0
3. Probar en producción
4. Monitorear durante 24-48 horas para asegurar que no haya nuevos duplicados

---

## 🚨 NOTAS IMPORTANTES

- ⚠️ Los duplicados EXISTENTES en la base de datos NO se eliminan automáticamente
- ⚠️ Necesitas ejecutar el SQL de limpieza MANUALMENTE
- ⚠️ Revisa los resultados del SQL ANTES de ejecutar los DELETE/UPDATE
- ⚠️ Haz un backup de la BD antes de ejecutar la limpieza

---

**Creado por**: Claude Opus 4.6  
**Para**: Alberto Naldos  
**Proyecto**: Parent Portal Connect v1.18.0
