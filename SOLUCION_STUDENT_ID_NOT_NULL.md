# 🔧 SOLUCIÓN: Error "student_id NOT NULL" en Pedidos de Profesores

**Fecha:** 2 de Febrero, 2026  
**Tabla Afectada:** `public.lunch_orders`

---

## ❌ PROBLEMA

Al intentar hacer un pedido de almuerzo desde el **perfil de profesor**, aparece el siguiente error:

```
Error creando pedido:
{
  code: '23502',
  details: null,
  hint: null,
  message: 'null value in column "student_id" of relation "lunch_orders" violates not-null constraint'
}
```

---

## 🔍 CAUSA

La tabla `lunch_orders` tiene la columna `student_id` definida como **NOT NULL**, lo cual es incorrecto porque:

- Los **estudiantes** usan `student_id` (y `teacher_id = NULL`)
- Los **profesores** usan `teacher_id` (y `student_id = NULL`)

Ambos tipos de pedidos deben poder coexistir en la misma tabla.

---

## ✅ SOLUCIÓN

### Paso 1: Ejecutar la Migración SQL

Ve al **SQL Editor** de Supabase y ejecuta:

```sql
-- 1. Permitir NULL en student_id
ALTER TABLE public.lunch_orders 
  ALTER COLUMN student_id DROP NOT NULL;

-- 2. Agregar constraint para validar que exista student_id O teacher_id
ALTER TABLE public.lunch_orders 
  ADD CONSTRAINT lunch_orders_requires_student_or_teacher 
  CHECK (
    (student_id IS NOT NULL AND teacher_id IS NULL) OR 
    (teacher_id IS NOT NULL AND student_id IS NULL)
  );
```

### Paso 2: Verificar

Después de ejecutar la migración, intenta nuevamente hacer un pedido desde el perfil de profesor.

---

## 📊 ESTRUCTURA CORRECTA DE `lunch_orders`

### Antes (❌ Incorrecto):
```sql
student_id UUID NOT NULL REFERENCES students(id),  -- ❌ Siempre requerido
teacher_id UUID REFERENCES teacher_profiles(id)
```

### Después (✅ Correcto):
```sql
student_id UUID REFERENCES students(id),  -- ✅ Puede ser NULL
teacher_id UUID REFERENCES teacher_profiles(id),  -- ✅ Puede ser NULL
CONSTRAINT lunch_orders_requires_student_or_teacher 
  CHECK (
    (student_id IS NOT NULL AND teacher_id IS NULL) OR 
    (teacher_id IS NOT NULL AND student_id IS NULL)
  )
```

**Reglas:**
- ✅ Un pedido con `student_id` Y `teacher_id = NULL` → **Pedido de estudiante**
- ✅ Un pedido con `teacher_id` Y `student_id = NULL` → **Pedido de profesor**
- ❌ Un pedido con ambos NULL → **Rechazado** (constraint)
- ❌ Un pedido con ambos llenos → **Rechazado** (constraint)

---

## 🧪 PRUEBA

1. **Ejecuta la migración SQL** en Supabase SQL Editor
2. Inicia sesión como **profesor**
3. Ve al módulo de **Almuerzos**
4. Selecciona un día con menú disponible
5. Haz clic en **"Ordenar Almuerzo"**
6. ✅ Debería crear el pedido correctamente

---

## 📁 ARCHIVO DE MIGRACIÓN

Se creó: `supabase/migrations/FIX_LUNCH_ORDERS_STUDENT_ID_NULLABLE.sql`

---

**🔥 Ejecuta la migración SQL en Supabase para resolver este error!**
