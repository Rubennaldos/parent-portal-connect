# 🚨 FIX URGENTE - POS NO GENERA CORRELATIVO Y NO BAJA SALDO

## Problema Detectado

1. **Función `get_next_ticket_number` no existe o tiene el parámetro incorrecto**
2. **El saldo del estudiante no se está actualizando**

## Solución Paso a Paso

### PASO 1: Ejecutar el script SQL para arreglar la función

Ve a Supabase → SQL Editor y ejecuta el archivo:

```
FIX_FUNCION_TICKET_NUMBER.sql
```

Este script va a:
- Eliminar la función anterior si existe
- Crear la función con el parámetro correcto (`p_user_id` en lugar de `p_pos_user_id`)
- Verificar que se creó correctamente

### PASO 2: Verificar que el usuario POS tiene su secuencia de tickets

Ejecuta esta consulta en Supabase:

```sql
-- Ver si el usuario POS actual tiene una secuencia
SELECT 
  p.email,
  p.full_name,
  p.role,
  p.pos_number,
  p.ticket_prefix,
  ts.prefix,
  ts.current_number
FROM profiles p
LEFT JOIN ticket_sequences ts ON ts.pos_user_id = p.id
WHERE p.role = 'pos';
```

Si el resultado muestra `NULL` en `ticket_sequences`, significa que NO se creó la secuencia cuando se creó el usuario.

### PASO 3: Si falta la secuencia, crearla manualmente

Si en el paso anterior viste `NULL` en la secuencia, ejecuta esto (reemplaza los valores):

```sql
-- Crear secuencia de tickets para el usuario POS
INSERT INTO ticket_sequences (
  school_id,
  pos_user_id,
  prefix,
  current_number,
  last_reset_date
)
SELECT 
  p.school_id,
  p.id,
  p.ticket_prefix,
  0,
  CURRENT_DATE
FROM profiles p
WHERE p.role = 'pos' 
  AND p.ticket_prefix IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ticket_sequences ts 
    WHERE ts.pos_user_id = p.id
  );
```

### PASO 4: Verificar permisos RLS en la tabla `students`

El saldo no se actualiza si el usuario POS no tiene permiso para modificar la tabla `students`.

```sql
-- Ver políticas actuales de students
SELECT * FROM pg_policies WHERE tablename = 'students';

-- Asegurar que staff (POS) puede actualizar students
CREATE POLICY IF NOT EXISTS "Staff can update students balance"
ON students FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('pos', 'kitchen', 'admin_general', 'superadmin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('pos', 'kitchen', 'admin_general', 'superadmin')
  )
);
```

### PASO 5: Probar en el frontend

1. Abre la consola del navegador (F12)
2. Selecciona un estudiante en el POS
3. Agrega productos al carrito
4. Haz clic en COBRAR
5. Confirma la venta

**En la consola deberías ver:**

```
🔵 INICIANDO CHECKOUT
✅ Correlativo generado: FN1-001
💳 ESTUDIANTE A CRÉDITO
✅ Transacción creada
✅ Items creados
💰 ACTUALIZANDO SALDO DEL ESTUDIANTE
✅ Saldo actualizado correctamente
```

Si ves algún ❌ (error), revisa el mensaje de error detallado.

## Errores Comunes

### Error: "Could not find the function public.get_next_ticket_number"

**Solución:** Ejecuta `FIX_FUNCION_TICKET_NUMBER.sql`

### Error: "new row violates row-level security policy for table students"

**Solución:** Ejecuta la política de RLS del PASO 4

### Error: "null value in column prefix violates not-null constraint"

**Solución:** El usuario POS no tiene `ticket_prefix` asignado. Ejecuta:

```sql
-- Ver usuarios POS sin prefix
SELECT id, email, full_name, school_id, pos_number, ticket_prefix
FROM profiles
WHERE role = 'pos' AND ticket_prefix IS NULL;

-- Si hay alguno, asignarle el prefix manualmente
UPDATE profiles
SET ticket_prefix = 'FN1'  -- Cambiar según corresponda
WHERE id = 'ID_DEL_USUARIO_POS';
```

### El saldo no se actualiza en la UI después de la venta

**Solución:** El estado local del estudiante se actualiza al volver a la pantalla de selección. Cuando hagas clic en "Continuar (Siguiente Cliente)", se debería resetear y al volver a seleccionar al estudiante, verás el saldo actualizado.

## Verificación Final

Después de aplicar todos los pasos, verifica:

1. ✅ La venta genera un correlativo (FN1-001, FN1-002, etc.)
2. ✅ El saldo del estudiante se reduce en la base de datos
3. ✅ El ticket muestra el saldo restante
4. ✅ Al volver a seleccionar al estudiante, muestra el saldo actualizado

---

**Última actualización:** 30/12/2025
**Archivos modificados:**
- `FIX_FUNCION_TICKET_NUMBER.sql` (nuevo)
- `src/pages/POS.tsx` (logs agregados)

