# 🔧 SOLUCIÓN RÁPIDA A ERRORES

## ❌ ERROR 1: "No se encontró ningún estudiante activo"

### Causa:
No hay estudiantes creados en la base de datos.

### Solución:

#### **OPCIÓN A: Crear estudiante desde el portal (RECOMENDADO)**
```
1. Ir a: https://parent-portal-connect.vercel.app/register
2. Registrarse como padre (o login si ya tienes cuenta)
3. En el portal, click en el botón "+" (Agregar Estudiante)
4. Llenar los datos:
   - Nombre completo
   - Grado
   - Sección
   - Sede
5. Click en "Agregar Estudiante"
6. ✅ Ahora puedes ejecutar CREAR_DEUDA_AUTOMATICA.sql
```

#### **OPCIÓN B: Crear estudiante desde SQL**
```sql
-- En Supabase SQL Editor:

-- Paso 1: Obtener IDs necesarios
SELECT 
  pp.id as parent_profile_id,
  s.id as school_id,
  p.email as padre_email
FROM parent_profiles pp
JOIN profiles p ON p.id = pp.user_id
JOIN schools s ON s.is_active = true
LIMIT 1;

-- Paso 2: Crear estudiante (ajusta los IDs)
INSERT INTO students (
  parent_id,
  school_id,
  full_name,
  grade,
  section,
  balance,
  daily_limit,
  is_active
) VALUES (
  'PEGA_AQUI_PARENT_PROFILE_ID', -- Del paso 1
  'PEGA_AQUI_SCHOOL_ID',         -- Del paso 1
  'Estudiante de Prueba',
  '1ro',
  'A',
  0,
  20,
  true
);
```

---

## ❌ ERROR 2: Error en el POS al hacer venta

### Posibles causas:
1. No existe la tabla `ticket_sequences`
2. No existe la función `get_next_ticket_number`

### Diagnóstico:
```sql
-- Ejecuta esto en Supabase:
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'ticket_sequences'
) as tabla_existe,
EXISTS (
  SELECT FROM pg_proc 
  WHERE proname = 'get_next_ticket_number'
) as funcion_existe;
```

**Resultado esperado:**
```
tabla_existe: true
funcion_existe: true
```

### Solución:
```sql
-- Si alguno es FALSE, ejecuta:
INSTALAR_TICKETS_PERSONALIZADOS.sql
```

---

## 🔍 DIAGNÓSTICO COMPLETO

### Ejecuta este SQL para ver el estado de todo:
```
DIAGNOSTICO_BASE_DATOS.sql
```

**Te mostrará:**
- ✅ Cuántos estudiantes hay (activos/inactivos)
- ✅ Cuántos padres hay
- ✅ Si existe la tabla de tickets
- ✅ Si existe la función de tickets
- ✅ Si existe la tabla de delay

---

## 📋 ORDEN CORRECTO DE EJECUCIÓN:

### 1️⃣ Primero: Instalar sistemas base
```sql
# En Supabase SQL Editor, ejecutar en orden:

1. INSTALAR_TICKETS_PERSONALIZADOS.sql
   ✅ Crea sistema de tickets

2. SETUP_PURCHASE_VISIBILITY_DELAY.sql
   ✅ Crea sistema de delay
```

### 2️⃣ Segundo: Crear datos de prueba
```
# En el navegador:

1. Registrar padre en /register
2. Agregar estudiante desde el portal
```

### 3️⃣ Tercero: Crear deuda de prueba
```sql
# En Supabase:

CREAR_DEUDA_AUTOMATICA.sql
✅ Ahora sí funcionará porque hay estudiantes
```

---

## 🎯 VERIFICACIÓN RÁPIDA:

### ✅ Checklist antes de probar:
```
□ SQL 1: INSTALAR_TICKETS_PERSONALIZADOS.sql ejecutado
□ SQL 2: SETUP_PURCHASE_VISIBILITY_DELAY.sql ejecutado
□ Padre registrado en /register
□ Al menos 1 estudiante creado
□ SQL 3: CREAR_DEUDA_AUTOMATICA.sql ejecutado
□ Deploy completado en Vercel
```

---

## 🆘 SI NADA FUNCIONA:

### Reset completo (¡CUIDADO! Borra todo excepto superadmin):
```sql
-- Solo si es necesario:
PRODUCTION_READY_RESET.sql

-- Luego volver a ejecutar:
1. INSTALAR_TICKETS_PERSONALIZADOS.sql
2. SETUP_PURCHASE_VISIBILITY_DELAY.sql
3. Registrar padre
4. Crear estudiante
5. CREAR_DEUDA_AUTOMATICA.sql
```

---

**Fecha:** 23 enero, 2026  
**Versión:** 1.2.6  
**Estado:** Guía de solución de errores
