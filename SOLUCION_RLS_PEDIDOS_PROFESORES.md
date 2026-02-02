# 🔧 FIX: Pedidos de Profesores Bloqueados por RLS

**Fecha:** 2 de Febrero, 2026  
**Tabla:** `public.lunch_orders`

---

## ❌ PROBLEMA

Los **pedidos de profesores** no aparecen para el **admin de sede** (gestor_unidad) aunque el filtro en el frontend esté correcto. Los logs muestran:

```
Pedidos cargados: 1
```

Solo carga el pedido del **alumno**, pero **NO** el del **profesor**.

---

## 🔍 CAUSA RAÍZ

Las **políticas RLS (Row Level Security)** de la tabla `lunch_orders` solo verifican si existe un `student` con `school_id` del gestor, pero **NO verifican** si existe un `teacher` con `school_id_1` del gestor.

### Política Problemática:

```sql
-- ❌ Solo verifica students.school_id
CREATE POLICY "Staff can view all lunch orders from their school"
ON public.lunch_orders
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM students s
      WHERE s.id = lunch_orders.student_id
      AND s.school_id = p.school_id  -- ❌ Solo alumnos
    )
  )
);
```

---

## ✅ SOLUCIÓN

### Paso 1: Ejecutar Diagnóstico

Ejecuta este SQL en **Supabase SQL Editor** para verificar el problema:

```sql
-- Ver todos los pedidos de la fecha (sin RLS)
SELECT 
  lo.id,
  lo.order_date,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'ALUMNO'
    WHEN lo.teacher_id IS NOT NULL THEN 'PROFESOR'
  END as tipo_pedido,
  s.full_name as alumno_nombre,
  t.full_name as profesor_nombre,
  t.school_id_1 as profesor_school
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles t ON lo.teacher_id = t.id
WHERE lo.order_date = '2026-02-02';
```

**Archivo:** `DIAGNOSTICO_PEDIDOS_PROFESOR.sql`

### Paso 2: Corregir Políticas RLS

Ejecuta este SQL para **corregir las políticas**:

```sql
-- Eliminar política antigua
DROP POLICY IF EXISTS "Staff can view all lunch orders from their school" 
  ON public.lunch_orders;

-- Crear política mejorada
CREATE POLICY "Gestores pueden ver pedidos de alumnos y profesores de su sede"
ON public.lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('gestor_unidad', 'admin_general')
    AND (
      p.role = 'admin_general'
      OR
      -- Pedidos de alumnos de su sede
      EXISTS (
        SELECT 1 FROM students s
        WHERE s.id = lunch_orders.student_id
        AND s.school_id = p.school_id
      )
      OR
      -- ✅ NUEVO: Pedidos de profesores de su sede
      EXISTS (
        SELECT 1 FROM teacher_profiles t
        WHERE t.id = lunch_orders.teacher_id
        AND t.school_id_1 = p.school_id
      )
    )
  )
);
```

**Archivo:** `FIX_RLS_LUNCH_ORDERS_PROFESORES.sql`

---

## 📊 NUEVA LÓGICA DE RLS

| Rol               | Ve Pedidos De...                                    |
|-------------------|-----------------------------------------------------|
| `admin_general`   | ✅ Todos los alumnos + ✅ Todos los profesores    |
| `gestor_unidad`   | ✅ Alumnos de su sede + ✅ Profesores de su sede  |
| `parent`          | ✅ Solo sus propios hijos                          |
| `teacher`         | ✅ Solo sus propios pedidos                        |

---

## 🔄 PASOS PARA APLICAR

1. **Ejecuta el diagnóstico:**
   ```bash
   Archivo: DIAGNOSTICO_PEDIDOS_PROFESOR.sql
   ```

2. **Ejecuta la corrección:**
   ```bash
   Archivo: FIX_RLS_LUNCH_ORDERS_PROFESORES.sql
   ```

3. **Recarga la página en el navegador**

4. **Verifica:**
   - Inicia sesión como admin de Jean LeBouch
   - Ve a "Gestión de Pedidos"
   - Deberías ver:
     - ✅ Pedido del alumno "prueba niño 1"
     - ✅ Pedido del profesor (debería aparecer con badge verde "Profesor")

---

## ⚠️ IMPORTANTE

Este cambio **NO afecta al frontend**. El problema estaba 100% en las **políticas RLS de la base de datos** que estaban bloqueando los registros de profesores a nivel de PostgreSQL.

---

## ✅ DESPUÉS DE APLICAR

Logs esperados:
```
Pedidos cargados: 2  ✅ (antes era 1)
- 1 pedido de alumno
- 1 pedido de profesor
```

---

**🔥 EJECUTA LOS 2 ARCHIVOS SQL EN SUPABASE PARA RESOLVER EL PROBLEMA!**
