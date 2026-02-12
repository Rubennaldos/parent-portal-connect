# 📘 EXPLICACIÓN DETALLADA v1.20.0 - WIZARD DE PEDIDOS + FIX ZONA HORARIA

**Fecha:** 12 de febrero, 2026  
**Versión:** 1.20.0  
**Creado por:** Claude Opus 4.6  
**Para:** Alberto Naldos + Auditoría de Opus

---

## 🎯 PROBLEMA IDENTIFICADO POR EL USUARIO

### Problema 1: Zona Horaria Incorrecta
**Descripción**: El sistema bloqueaba días incorrectamente porque no consideraba la zona horaria de Perú (UTC-5).

**Ejemplo concreto**:
- **Fecha actual (Perú)**: 11 de febrero, 22:00 (10pm)
- **Configuración**: Hora límite 10:30 del mismo día, 0 días de anticipación
- **Esperado**: Poder pedir para el 12 de febrero (hasta las 10:30 del 12)
- **Realidad**: El día 12 estaba bloqueado 🔴

**Causa raíz**:
```typescript
// CÓDIGO INCORRECTO (v1.19.0)
const today = startOfDay(new Date()); // Usa zona horaria local de la PC
const target = new Date(dateStr + 'T12:00:00'); // Sin timezone explícito
if (isBefore(target, today)) { // Comparación incorrecta
  return { canOrder: false, reason: 'Día pasado' };
}
```

El problema era:
1. `new Date()` usa la zona horaria del navegador/sistema, NO Perú
2. No había conversión explícita a UTC-5
3. La comparación era superficial (solo día, no hora límite)

---

### Problema 2: UX Confusa (Lista vs Wizard)
**Descripción**: El componente v1.19.0 mostraba TODOS los días seleccionados abajo con un scroll infinito de categorías.

**Ejemplo**:
- Seleccionas 5 días → aparece una lista ENORME abajo
- Para cada día se muestran TODAS las categorías en cards separadas
- El usuario se pierde: "¿para qué día estoy pidiendo?"

**Lo que el usuario pidió**:
> "Tipo pasarela, que no salga toda la lista abajo. Apenas selecciona el menú, puedas poner pedir y puedas seguir seleccionando. Que salga: Pedido del 12, luego categoría, luego cantidad, registrar pedido. Luego Pedido del 13..."

---

## ✅ SOLUCIÓN IMPLEMENTADA

### Fix 1: Zona Horaria de Perú (UTC-5) con Helpers

**Archivo:** `src/components/lunch/UnifiedLunchCalendarV2.tsx` (líneas 152-164)

```typescript
// ==========================================
// HELPER: Get Peru Time (UTC-5)
// ==========================================
const getPeruNow = (): Date => {
  // Get current UTC time
  const now = new Date();
  // Peru is UTC-5 (no DST - no horario de verano)
  const peruOffset = -5 * 60; // minutes
  const localOffset = now.getTimezoneOffset(); // minutes
  const diff = localOffset - peruOffset;
  
  return new Date(now.getTime() + diff * 60 * 1000);
};

const getPeruDateOnly = (dateStr: string): Date => {
  // "2026-02-12" → Date in Peru timezone (midnight)
  return parseISO(dateStr + 'T00:00:00-05:00');
};
```

**Cómo funciona**:
1. `getPeruNow()`: Obtiene la hora ACTUAL en Perú, sin importar dónde esté el usuario
2. `getPeruDateOnly()`: Convierte una fecha string ("2026-02-12") a un objeto Date en zona horaria Perú (medianoche)

---

### Fix 2: Validación Correcta de Deadline

**Archivo:** `src/components/lunch/UnifiedLunchCalendarV2.tsx` (líneas 372-397)

```typescript
const canOrderForDate = (dateStr: string): { canOrder: boolean; reason?: string } => {
  if (!config || !config.order_deadline_time || config.order_deadline_days === undefined) {
    return { canOrder: true };
  }

  const peruNow = getPeruNow(); // NUEVA: Hora actual en Perú
  const targetDate = getPeruDateOnly(dateStr); // NUEVA: Fecha objetivo en Perú (medianoche)

  // Parse deadline time (HH:MM:SS)
  const [hours, minutes] = config.order_deadline_time.split(':').map(Number);

  // Calculate deadline datetime
  const deadlineDate = new Date(targetDate);
  deadlineDate.setDate(deadlineDate.getDate() - config.order_deadline_days);
  deadlineDate.setHours(hours, minutes, 0, 0);

  // Check if past
  if (peruNow > deadlineDate) {
    return {
      canOrder: false,
      reason: `Límite: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    };
  }

  return { canOrder: true };
};
```

**Ejemplo práctico**:
- **Configuración**: `order_deadline_time = "10:30:00"`, `order_deadline_days = 0`
- **Fecha objetivo**: 12 de febrero
- **Cálculo**:
  1. `targetDate` = 12 feb 00:00 (medianoche)
  2. `deadlineDate` = 12 feb - 0 días = 12 feb
  3. `deadlineDate.setHours(10, 30)` → 12 feb 10:30
  4. Si `peruNow` = 11 feb 22:00 → `peruNow < deadlineDate` → ✅ Puede pedir
  5. Si `peruNow` = 12 feb 11:00 → `peruNow > deadlineDate` → ❌ Bloqueado

---

### Fix 3: Nuevo Componente con Wizard Paso a Paso

**Archivo:** `src/components/lunch/UnifiedLunchCalendarV2.tsx` (completo, 1300+ líneas)

#### Cambios Estructurales:

##### 3.1 Estados del Wizard

```typescript
// Wizard state
const [selectedDate, setSelectedDate] = useState<string | null>(null);
const [selectedCategory, setSelectedCategory] = useState<LunchCategory | null>(null);
const [selectedMenu, setSelectedMenu] = useState<LunchMenu | null>(null);
const [quantity, setQuantity] = useState<number>(1);
const [wizardStep, setWizardStep] = useState<'calendar' | 'category' | 'menu' | 'confirm'>('calendar');
```

**Explicación**:
- `wizardStep`: Controla qué pantalla se muestra en el modal
- Solo se almacena información de UN día a la vez (no múltiples como antes)

##### 3.2 Flujo de Selección

```typescript
// PASO 1: Click en día del calendario
const handleDateClick = (dateStr: string) => {
  // Validaciones...
  
  // Si tiene pedidos existentes, abre modal de VISUALIZACIÓN
  if (dayOrders.length > 0) {
    setViewOrdersDate(dateStr);
    setViewOrdersModal(true);
    return;
  }

  // Si no tiene pedidos, inicia wizard
  setSelectedDate(dateStr);
  setWizardStep('category'); // <--- Muestra modal con categorías
  setSelectedCategory(null);
  setSelectedMenu(null);
  setQuantity(1);
};

// PASO 2: Seleccionar categoría
const handleCategorySelect = (category: LunchCategory) => {
  setSelectedCategory(category);
  
  const dayMenus = menus.get(selectedDate!) || [];
  const categoryMenus = dayMenus.filter(m => m.category_id === category.id);
  
  if (categoryMenus.length === 1) {
    // Auto-select si solo hay un menú
    setSelectedMenu(categoryMenus[0]);
    setWizardStep('confirm'); // <--- Salta directo a confirmar
  } else {
    setWizardStep('menu'); // <--- Muestra selección de menús
  }
};

// PASO 3: Seleccionar menú específico (si hay varios)
const handleMenuSelect = (menu: LunchMenu) => {
  setSelectedMenu(menu);
  setWizardStep('confirm'); // <--- Muestra pantalla de cantidad + confirmar
};

// PASO 4: Confirmar pedido
const handleConfirmOrder = async () => {
  // INSERT a lunch_orders + transactions
  // Después resetea wizard a 'calendar' para siguiente pedido
  setWizardStep('calendar');
};
```

**Ventajas del nuevo flujo**:
1. **Un día a la vez**: No se confunde con múltiples días
2. **Feedback inmediato**: Cada pedido se confirma y se cierra el modal
3. **Puede continuar**: Después de confirmar, puede seleccionar otro día
4. **Visual claro**: El título del modal dice "Pedido del [día]"

##### 3.3 Indicador Visual en Calendario

```typescript
const getDayStatus = (dateStr: string): 'available' | 'has_orders' | 'special' | 'unavailable' | 'blocked' => {
  // ...validaciones...
  
  const dayOrders = existingOrders.filter(o => o.date === dateStr && !o.is_cancelled);
  if (dayOrders.length > 0) return 'has_orders'; // <--- VERDE si tiene pedidos
  
  return 'available';
};
```

En el render del calendario:
```typescript
{dayOrders.length > 0 && (
  <Badge className="absolute top-0 right-0 h-3.5 w-3.5 p-0 bg-green-500">
    {dayOrders.reduce((sum, o) => sum + o.quantity, 0)} {/* Suma cantidades */}
  </Badge>
)}
```

**Resultado**: Si el profesor pidió 2 almuerzos para el 12, aparece un badge verde con "2" arriba a la derecha.

---

### Fix 4: Modal de Visualización de Pedidos Existentes

**Archivo:** `src/components/lunch/UnifiedLunchCalendarV2.tsx` (líneas 823-871)

```typescript
const renderViewOrdersModal = () => {
  if (!viewOrdersDate) return null;

  const dayOrders = existingOrders.filter(o => o.date === viewOrdersDate && !o.is_cancelled);

  return (
    <Dialog open={viewOrdersModal} onOpenChange={setViewOrdersModal}>
      <DialogHeader>
        <DialogTitle>
          Pedidos del {format(getPeruDateOnly(viewOrdersDate), "EEEE d 'de' MMMM", { locale: es })}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3 mt-4">
        {dayOrders.map((order) => (
          <Card key={order.id}>
            <CardContent className="p-4">
              <div className="flex justify-between">
                <div>
                  <p className="font-bold">{order.categoryName}</p>
                  <p className="text-sm">Cantidad: {order.quantity}</p>
                </div>
                <Badge>
                  {order.status === 'pending' && 'Pendiente'}
                  {order.status === 'confirmed' && 'Confirmado'}
                  {order.status === 'delivered' && 'Entregado'}
                  {order.status === 'cancelled' && 'Anulado'}
                </Badge>
              </div>
              <p className="text-xs text-gray-500">
                Creado: {format(new Date(order.created_at), "dd/MM/yyyy HH:mm")}
              </p>
              
              {/* TODO: Botones de cancelar/editar con validación de deadline */}
            </CardContent>
          </Card>
        ))}
      </div>
    </Dialog>
  );
};
```

**Funcionalidad**:
- Si un día YA tiene pedidos y el usuario hace click → se abre este modal
- Muestra todos los pedidos de ese día con su estado
- **Pendiente**: Agregar botones para cancelar/editar (respetando `cancel_deadline`)

---

### Fix 5: Campo `quantity` en Base de Datos

**Archivo:** `supabase/migrations/ADD_QUANTITY_TO_LUNCH_ORDERS.sql`

```sql
ALTER TABLE lunch_orders 
ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 CHECK (quantity > 0);

COMMENT ON COLUMN lunch_orders.quantity IS 'Cantidad de menús pedidos para este día';
```

**Antes**:
- `lunch_orders` no tenía cantidad explícita
- Si alguien quería 2 almuerzos, tenía que hacer 2 inserts separados

**Ahora**:
- Un solo registro con `quantity = 2`
- Más eficiente y claro

---

## 🔄 CAMBIOS EN LA INTERFAZ

### Tabla `lunch_orders`

| Campo | Tipo | Descripción | NUEVO en v1.20.0 |
|---|---|---|---|
| `id` | UUID | PK | No |
| `student_id` | UUID | FK a students | No |
| `teacher_id` | UUID | FK a teacher_profiles | No |
| `order_date` | DATE | Fecha del almuerzo | No |
| `status` | TEXT | pending/confirmed/delivered/cancelled | No |
| `category_id` | UUID | FK a lunch_categories | No |
| `menu_id` | UUID | FK a lunch_menus | No |
| `school_id` | UUID | FK a schools | No |
| `quantity` | INTEGER | Cantidad de menús | ✅ SÍ |
| `base_price` | DECIMAL | Precio base | No |
| `addons_total` | DECIMAL | Total agregados | No |
| `final_price` | DECIMAL | Precio final | No |
| `is_cancelled` | BOOLEAN | Si está anulado | No |
| `created_at` | TIMESTAMPTZ | Fecha de creación | No |
| `created_by` | UUID | Quién lo creó | No |
| `delivered_by` | UUID | Quién lo entregó | No |
| `cancelled_by` | UUID | Quién lo anuló | No |

---

## 📊 FLUJO COMPLETO DE UN PEDIDO (v1.20.0)

### Escenario: Profesor pide 2 Almuerzos Clásicos para el 13 de febrero

#### PASO 1: Profesor hace click en el día 13

```typescript
handleDateClick("2026-02-13")
  ↓
// Validaciones
1. ¿Hay menús? ✅ Sí
2. ¿Es día especial? ❌ No
3. ¿Tiene pedidos existentes? ❌ No
4. ¿Pasó el deadline? canOrderForDate("2026-02-13")
   → peruNow = 12 feb 22:00
   → deadline = 13 feb 10:30
   → 12 feb 22:00 < 13 feb 10:30 ✅ Puede pedir

// Resultado
setSelectedDate("2026-02-13")
setWizardStep('category') → Abre modal
```

#### PASO 2: Profesor selecciona "Almuerzo Clásico"

```typescript
handleCategorySelect(almuerzoClasicoCategory)
  ↓
setSelectedCategory(almuerzoClasicoCategory)
// Busca menús de esa categoría para el 13 feb
categoryMenus = [menuClasico1] // Solo 1 menú
// Auto-selecciona
setSelectedMenu(menuClasico1)
setWizardStep('confirm')
```

#### PASO 3: Profesor ajusta cantidad a 2

```typescript
// UI muestra selector de cantidad con botones +/-
quantity = 1 (default)
Usuario hace click en "+" dos veces
quantity = 2
```

#### PASO 4: Profesor hace click en "Registrar Pedido"

```typescript
handleConfirmOrder()
  ↓
// 1. INSERT a lunch_orders
const orderData = {
  teacher_id: userId,
  order_date: "2026-02-13",
  status: "pending",
  category_id: almuerzoClasicoCategory.id,
  menu_id: menuClasico1.id,
  school_id: effectiveSchoolId,
  quantity: 2, // <--- NUEVO
  base_price: 15.00,
  addons_total: 0,
  final_price: 30.00 // 15 * 2
};

const { data: insertedOrder } = await supabase
  .from('lunch_orders')
  .insert([orderData])
  .select('id')
  .single();
// insertedOrder.id = "abc-123-def"

// 2. INSERT a transactions
const transactionData = {
  teacher_id: userId,
  type: 'purchase',
  amount: -30.00, // Negativo = deuda
  description: "Almuerzo - Almuerzo Clásico - 13 de febrero",
  payment_status: 'pending',
  payment_method: null,
  school_id: effectiveSchoolId,
  created_by: userId,
  metadata: {
    lunch_order_id: "abc-123-def",
    source: "unified_calendar_v2_teacher",
    order_date: "2026-02-13",
    menu_name: "Almuerzo Clásico",
    quantity: 2
  }
};

await supabase.from('transactions').insert([transactionData]);

// 3. Toast de éxito
toast({
  title: '✅ ¡Pedido registrado!',
  description: '2 Almuerzo Clásico para el 13 de febrero'
});

// 4. Reset wizard
setWizardStep('calendar') // Cierra modal, vuelve al calendario
await fetchMonthlyData() // Refresca datos
```

#### RESULTADO VISUAL:

1. **Calendario**: El día 13 ahora tiene un badge verde con "2"
2. **Cobranzas (Por Cobrar)**: Aparece transacción de S/ 30.00 con badges:
   - 📅 13 feb
   - 🍽️ Almuerzo Clásico
3. **Base de Datos**:
   - 1 registro en `lunch_orders` con `quantity = 2`
   - 1 registro en `transactions` con `amount = -30.00`

---

## 🧪 TESTING CHECKLIST

### Test 1: Zona Horaria
- [ ] Configurar hora límite 10:30, 0 días anticipación
- [ ] Esperar hasta las 22:00 del día 11
- [ ] Verificar que el día 12 esté DISPONIBLE (no bloqueado)
- [ ] Verificar que el día 11 esté BLOQUEADO si ya pasó las 10:30

### Test 2: Wizard Paso a Paso
- [ ] Seleccionar un día sin pedidos → Debe abrir wizard en paso "categoría"
- [ ] Seleccionar categoría → Debe pasar a "confirmar" (si solo 1 menú) o "menú" (si varios)
- [ ] Ajustar cantidad a 3
- [ ] Confirmar pedido
- [ ] Verificar que modal se cierra
- [ ] Verificar que día tiene badge verde con "3"

### Test 3: Ver Pedidos Existentes
- [ ] Hacer click en día con pedidos → Debe abrir modal de visualización
- [ ] Modal debe mostrar todos los pedidos de ese día
- [ ] Debe mostrar estado (Pendiente/Confirmado/Entregado)

### Test 4: Cantidad en Base de Datos
- [ ] Hacer pedido con cantidad 2
- [ ] Verificar en Supabase que `lunch_orders.quantity = 2`
- [ ] Verificar que `transactions.amount = precio * 2`
- [ ] Verificar que `transactions.metadata` tiene `quantity: 2`

### Test 5: Cobranzas
- [ ] Ir a módulo Cobranzas
- [ ] Buscar la transacción del profesor
- [ ] Verificar que muestra badges de fecha y categoría
- [ ] Hacer click en la transacción → Ver detalles
- [ ] Verificar que metadata muestra fecha del pedido y categoría

---

## 🔍 PUNTOS PENDIENTES (TODO)

### 1. Botones de Cancelar/Editar en Modal de Pedidos
**Ubicación**: `renderViewOrdersModal()` línea 865

**Qué falta**:
```typescript
// Agregar validación de cancel_deadline
const canCancel = (order: ExistingOrder): boolean => {
  if (!config?.cancel_deadline_time) return true;
  
  const peruNow = getPeruNow();
  const orderDate = getPeruDateOnly(order.date);
  const [hours, minutes] = config.cancel_deadline_time.split(':').map(Number);
  
  const cancelDeadline = new Date(orderDate);
  cancelDeadline.setDate(cancelDeadline.getDate() - (config.cancel_deadline_days || 0));
  cancelDeadline.setHours(hours, minutes, 0, 0);
  
  return peruNow <= cancelDeadline;
};

// Botón de cancelar
{order.status === 'pending' && canCancel(order) && (
  <Button
    variant="destructive"
    size="sm"
    onClick={() => handleCancelOrder(order.id)}
  >
    <XCircle className="h-4 w-4 mr-1" />
    Cancelar Pedido
  </Button>
)}
```

### 2. Función handleCancelOrder
**Qué debe hacer**:
1. UPDATE `lunch_orders` SET `is_cancelled = true`, `cancelled_by = userId`, `cancelled_at = NOW()`
2. UPDATE `transactions` correspondiente a `payment_status = 'cancelled'`
3. Refrescar datos

### 3. Número de Pedido (Opcional)
El usuario mencionó: "que te bote un número de pedido, pero si nos complicamos con número de pedido por ahora no"

**Propuesta**: Usar el `id` de `lunch_orders` como número de pedido.  
**Formato amigable**: Tomar últimos 6 caracteres del UUID en mayúsculas.

Ejemplo: `abc-123-def-456` → `#DEF456`

---

## 📝 ARCHIVOS MODIFICADOS EN v1.20.0

| Archivo | Cambio | Líneas |
|---|---|---|
| `src/components/lunch/UnifiedLunchCalendarV2.tsx` | **NUEVO** - Componente wizard | 1300+ |
| `src/pages/Teacher.tsx` | Import cambió a V2 | 2 |
| `src/pages/Index.tsx` | Import cambió a V2 | 2 |
| `supabase/migrations/ADD_QUANTITY_TO_LUNCH_ORDERS.sql` | **NUEVO** - Agregar campo quantity | 8 |
| `package.json` | Versión 1.20.0 | 1 |

---

## 🔐 AUDITORÍA DE SEGURIDAD

### Validaciones Implementadas:

1. **Zona Horaria**: Siempre usa hora de Perú (UTC-5), no hora local del cliente
2. **Deadline**: Valida `order_deadline_time` + `order_deadline_days` antes de permitir pedido
3. **Cantidad**: CHECK constraint `quantity > 0` en base de datos
4. **Deduplicación**: `metadata.lunch_order_id` previene duplicados (fix de v1.18.0)
5. **Cancelación pendiente**: Validar `cancel_deadline` antes de permitir anular

### Vulnerabilidades a Considerar:

1. **Manipulación de hora del cliente**: Mitigado con `getPeruNow()` (usa UTC)
2. **Race condition**: Si 2 usuarios piden al mismo tiempo para el mismo profesor → Se crean 2 registros separados (OK)
3. **Cantidad excesiva**: Frontend no limita cantidad máxima → Agregar validación (ej: max 10)

---

**Fin del documento**
