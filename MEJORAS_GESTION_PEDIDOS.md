# ✨ MEJORAS: Gestión de Pedidos de Almuerzo

**Fecha:** 2 de Febrero, 2026  
**Componente:** `src/pages/LunchOrders.tsx`

---

## 🎯 OBJETIVO

Mejorar la visualización y filtrado de pedidos de almuerzo para:

1. **Distinguir visualmente entre ALUMNOS y PROFESORES**
2. **Fecha por defecto basada en configuración de entrega** (no siempre "mañana")
3. **Botón para volver a la fecha configurada**

---

## ✅ CAMBIOS IMPLEMENTADOS

### 1. **DISTINCIÓN VISUAL: ALUMNO vs PROFESOR**

#### **Nombre más Grande:**
```tsx
// ANTES:
<p className="font-semibold text-gray-900">
  {order.student?.full_name || order.teacher?.full_name}
</p>

// AHORA:
<p className="font-bold text-lg text-gray-900">
  {order.student?.full_name || order.teacher?.full_name}
</p>
```

#### **Badges de Identificación:**
- **Alumno:** Badge azul con texto "Alumno"
- **Profesor:** Badge verde con texto "Profesor"
- **Puente Temporal:** Badge morado con icono y texto "🎫 Puente Temporal"

```tsx
{order.teacher && (
  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-xs">
    Profesor
  </Badge>
)}
{order.student && !order.student.is_temporary && (
  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-xs">
    Alumno
  </Badge>
)}
```

#### **Foto/Avatar con Indicador:**
- **Alumnos:** Avatar azul con borde azul
- **Profesores:** Avatar verde con borde verde + emoji 👨‍🏫 en esquina inferior
- **Temporales:** Ícono morado `UserPlus` en esquina superior

```tsx
{order.teacher && (
  <div className="absolute -bottom-1 -right-1 bg-green-600 rounded-full p-1">
    <span className="text-white text-[10px] font-bold px-1">👨‍🏫</span>
  </div>
)}
```

#### **Tamaño de Avatar:**
- Aumentado de `h-12 w-12` a `h-14 w-14`
- Borde `border-2` para mayor visibilidad

---

### 2. **FECHA POR DEFECTO BASADA EN CONFIGURACIÓN**

#### **Lógica Implementada:**

```tsx
const fetchConfigAndInitialize = async () => {
  // 1. Obtener configuración de entrega de la sede
  const { data: config } = await supabase
    .from('lunch_configuration')
    .select('delivery_start_time, delivery_end_time')
    .eq('school_id', schoolId)
    .maybeSingle();

  // 2. Calcular fecha por defecto
  const now = new Date();
  const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const currentHour = peruTime.getHours();
  
  const deliveryStartHour = config?.delivery_start_time 
    ? parseInt(config.delivery_start_time.split(':')[0]) 
    : 11; // Default 11 AM

  // 3. Si ya pasó la hora de entrega, mostrar pedidos de mañana
  //    Si no, mostrar pedidos de hoy
  let defaultDate = new Date(peruTime);
  if (currentHour >= deliveryStartHour) {
    defaultDate.setDate(defaultDate.getDate() + 1);
  }

  setDefaultDeliveryDate(format(defaultDate, 'yyyy-MM-dd'));
  setSelectedDate(format(defaultDate, 'yyyy-MM-dd'));
};
```

#### **Ejemplo de Comportamiento:**

| Hora Actual | `delivery_start_time` | Fecha Mostrada |
|-------------|----------------------|----------------|
| 8:00 AM     | 11:00:00            | **HOY**        |
| 10:30 AM    | 11:00:00            | **HOY**        |
| 11:00 AM    | 11:00:00            | **MAÑANA**     |
| 14:00 PM    | 11:00:00            | **MAÑANA**     |
| 9:00 AM     | 12:00:00            | **HOY**        |
| 13:00 PM    | 12:00:00            | **MAÑANA**     |

---

### 3. **BOTÓN PARA VOLVER A FECHA CONFIGURADA**

#### **Implementación:**

```tsx
<div className="flex gap-2">
  <Input
    type="date"
    value={selectedDate}
    onChange={(e) => setSelectedDate(e.target.value)}
    className="w-full"
  />
  {selectedDate !== defaultDeliveryDate && (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setSelectedDate(defaultDeliveryDate)}
      className="whitespace-nowrap"
      title="Volver a fecha de entrega configurada"
    >
      <Calendar className="h-4 w-4" />
    </Button>
  )}
</div>
```

#### **Comportamiento:**
- ✅ El botón **solo aparece** si el usuario cambió la fecha manualmente
- ✅ Al hacer clic, **vuelve a la fecha configurada** según la hora de entrega
- ✅ Tooltip explicativo al pasar el mouse

---

## 🎨 DISEÑO VISUAL

### **ANTES:**
```
[📷] Juan Pérez
     Temporal - 3ro A
     Pedido: 08:30
```

### **AHORA - ALUMNO:**
```
[📷] 🔵 Juan Pérez         [Alumno]
           Pedido a las 08:30
```

### **AHORA - PROFESOR:**
```
[📷👨‍🏫] 🟢 María López     [Profesor]
            Pedido a las 09:15
```

### **AHORA - TEMPORAL:**
```
[📷🎫] 🟣 Carlos Gómez      
           🎫 Puente Temporal - 5to B
           Pedido a las 10:00
```

---

## 📊 RESUMEN DE COLORES

| Tipo           | Color Avatar | Badge         | Indicador        |
|----------------|--------------|---------------|------------------|
| **Alumno**     | Azul         | Azul "Alumno" | -                |
| **Profesor**   | Verde        | Verde "Profesor" | 👨‍🏫           |
| **Temporal**   | Morado       | (Texto morado) | 🎫 UserPlus     |

---

## ✅ RESULTADO

- ✅ **Nombres más grandes y visibles**
- ✅ **Badges claros para identificar tipo**
- ✅ **Fecha inteligente basada en configuración**
- ✅ **Botón para resetear fecha fácilmente**
- ✅ **Sin errores de linting**
- ✅ **Hot Reload aplicado automáticamente**

---

**🎉 ¡GESTIÓN DE PEDIDOS MEJORADA CON DISTINCIÓN CLARA ENTRE ALUMNOS Y PROFESORES!**
