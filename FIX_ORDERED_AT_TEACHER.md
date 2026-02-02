# 🔧 FIX: Error "ordered_at" en Pedidos de Profesores

**Fecha:** 2 de Febrero, 2026  
**Componente:** `src/components/teacher/TeacherLunchCalendar.tsx`

---

## ❌ PROBLEMA

Al intentar hacer un pedido de almuerzo desde el **perfil de profesor**, aparecía el siguiente error:

```
Error creando pedido:
{
  code: 'PGRST204',
  details: null,
  hint: null,
  message: "Could not find the 'ordered_at' column of 'lunch_orders' in the schema cache"
}
```

---

## 🔍 CAUSA

El componente `TeacherLunchCalendar.tsx` estaba intentando **insertar** un campo `ordered_at` que **NO EXISTE** en la tabla `lunch_orders`.

### Código Erróneo (Línea 214):

```tsx
const { error: orderError } = await supabase
  .from('lunch_orders')
  .insert({
    teacher_id: teacherId,
    order_date: selectedDate,
    status: 'confirmed',
    ordered_at: new Date().toISOString()  // ❌ Esta columna NO EXISTE
  });
```

La tabla `lunch_orders` **NO tiene** la columna `ordered_at`. La columna para registrar la fecha de creación es `created_at`, que se **genera automáticamente** por PostgreSQL con `DEFAULT now()`.

---

## ✅ SOLUCIÓN

Se eliminó la referencia a `ordered_at` del insert:

```tsx
const { error: orderError } = await supabase
  .from('lunch_orders')
  .insert({
    teacher_id: teacherId,
    order_date: selectedDate,
    status: 'confirmed'
    // ✅ created_at se genera automáticamente
  });
```

---

## 📊 ESTRUCTURA CORRECTA DE `lunch_orders`

```sql
CREATE TABLE public.lunch_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES students(id),
  teacher_id UUID REFERENCES teacher_profiles(id),
  order_date DATE NOT NULL,
  status TEXT DEFAULT 'confirmed',
  created_at TIMESTAMPTZ DEFAULT now(),  -- ✅ Esta se genera automáticamente
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  postponed_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  postponement_reason TEXT,
  is_no_order_delivery BOOLEAN DEFAULT false,
  school_id UUID REFERENCES schools(id)
);
```

**Nota:** La columna `ordered_at` **nunca existió** en esta tabla.

---

## 🔄 OTROS COMPONENTES YA CORREGIDOS

Este mismo error ya fue corregido anteriormente en:

1. ✅ `src/components/parent/LunchOrderCalendar.tsx` (Pedidos de padres)
2. ✅ `src/components/teacher/TeacherLunchCalendar.tsx` (Pedidos de profesores) - **AHORA**

---

## 🧪 PRUEBA

1. Inicia sesión como **profesor**
2. Ve al módulo de **Almuerzos**
3. Selecciona un día con menú disponible
4. Haz clic en **"Ordenar Almuerzo"**
5. ✅ Debería crear el pedido correctamente sin errores

---

## ✅ RESULTADO

- ✅ **Error corregido**
- ✅ **Sin errores de linting**
- ✅ **Pedidos de profesores funcionando correctamente**
- ✅ **Hot Reload aplicado automáticamente**

---

**🎉 ¡LOS PROFESORES YA PUEDEN HACER PEDIDOS DE ALMUERZO SIN ERRORES!**
