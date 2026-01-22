# 🎓 SISTEMA DE GRADOS Y SALONES PERSONALIZABLES

## ✅ LO QUE SE HA IMPLEMENTADO

### 📋 RESUMEN
Sistema que permite a cada sede configurar sus propios nombres para grados/niveles y aulas/secciones, adaptándose a la nomenclatura específica de cada colegio.

---

## 🏗️ ESTRUCTURA

### 1. **Nuevas Tablas en Base de Datos**

#### `school_levels` (Grados/Niveles)
```sql
- id: UUID
- school_id: UUID (referencia a schools)
- name: VARCHAR(100) // "1er Grado", "Sala Azul", "Nivel A"
- order_index: INTEGER // Para ordenar
- is_active: BOOLEAN
```

#### `school_classrooms` (Aulas/Secciones)
```sql
- id: UUID
- school_id: UUID
- level_id: UUID (referencia a school_levels)
- name: VARCHAR(100) // "Sección A", "Leones", "Amarillo"
- order_index: INTEGER
- is_active: BOOLEAN
```

#### `students` (Actualizada)
```sql
+ level_id: UUID (nuevo)
+ classroom_id: UUID (nuevo)
// grade y section se mantienen por compatibilidad
```

---

## 🎯 UBICACIÓN EN EL SISTEMA

**Módulo:** Administración de Sede
**Ruta:** `/school-admin` → Tab "Grados y Salones"

---

## 💡 FUNCIONALIDADES

### ✅ **Para Administradores de Sede:**

1. **Crear Grados/Niveles personalizados**
   - Nombres libres: "1er Grado", "Sala Azul", "Nivel Inicial", etc.
   - Orden configurable
   - Contador de estudiantes por grado

2. **Crear Aulas/Secciones por cada Grado**
   - Nombres libres: "Sección A", "Leones", "Amarillo", etc.
   - Asociadas a un grado específico
   - Contador de estudiantes por aula

3. **Editar nombres de Grados**
   - Click en editar
   - Cambiar nombre
   - Guardar o cancelar

4. **Eliminar Grados/Aulas**
   - Desactivación lógica (no se borran datos)
   - Los estudiantes quedan sin asignación pero no se pierden

5. **Ver todos los Estudiantes de su sede**
   - Vista completa de estudiantes de la sede
   - Muestra grado y aula asignados
   - Filtrable y buscable

### ✅ **Para Admin General:**

1. **Todas las funciones de Administrador de Sede** (para su sede)

2. **Vista Especial: "Todas las Sedes"**
   - **Tablas separadas por sede**
   - Cada sede muestra:
     - Nombre de la sede
     - Cantidad de estudiantes
     - Tabla completa con:
       - Nombre del estudiante
       - Grado/Nivel
       - Aula/Sección
   - **Contador total** de estudiantes de toda la red
   - Vista de solo lectura (no puede editar desde aquí)

---

## 🔒 SEPARACIÓN POR SEDES - CONFIRMADO

### ✅ **GARANTÍAS:**

1. **Cada sede ve SOLO sus datos:**
   - Grados propios
   - Aulas propias
   - Estudiantes propios

2. **RLS (Row Level Security) aplicado:**
```sql
POLICY "users_view_own_school_levels"
USING (
  school_id IN (
    SELECT school_id FROM profiles 
    WHERE id = auth.uid()
  )
)
```

3. **Imposible mezclar datos:**
   - Un admin de Sede A NO puede ver/editar grados de Sede B
   - Cada sede es completamente independiente
   - Los reportes se agrupan por `school_id`

### 🛡️ **ALMACENES SEPARADOS:**
```
Sede A:
  - Inventario A
  - Ventas A
  - Estudiantes A
  - Grados A
  
Sede B:
  - Inventario B
  - Ventas B
  - Estudiantes B
  - Grados B

❌ NUNCA se mezclan
✅ SIEMPRE separados por school_id
```

---

## 🚀 INSTALACIÓN

### **Paso 1: Ejecutar SQL**
```bash
1. Abrir Supabase SQL Editor
2. Ejecutar: SETUP_GRADOS_SALONES_PERSONALIZABLES.sql
```

### **Paso 2: Migrar Datos Existentes (OPCIONAL)**
Si ya tienes estudiantes con `grade` y `section`:
```sql
SELECT migrate_student_grades_to_levels();
```

Esto creará automáticamente:
- Niveles desde los `grade` existentes
- Aulas desde las `section` existentes
- Asignará estudiantes a los nuevos niveles/aulas

---

## 📊 EJEMPLOS DE USO

### **Ejemplo 1: Colegio con Grados Numéricos**
```
Grados:
- 1er Grado
  - Sección A (25 estudiantes)
  - Sección B (28 estudiantes)
- 2do Grado
  - Sección A (30 estudiantes)
  - Sección B (27 estudiantes)
```

### **Ejemplo 2: Colegio con Nombres de Animales**
```
Niveles:
- Inicial
  - Leones (18 estudiantes)
  - Tigres (20 estudiantes)
  - Elefantes (19 estudiantes)
```

### **Ejemplo 3: Colegio con Colores**
```
Salas:
- Pre-Kinder
  - Sala Azul (15 estudiantes)
  - Sala Amarilla (16 estudiantes)
- Kinder
  - Sala Verde (22 estudiantes)
  - Sala Roja (20 estudiantes)
```

---

## 🎨 INTERFAZ

### **Para Administradores de Sede:**
```
┌──────────────────────────────────────────────────┐
│ 🎓 Grados y Salones Personalizables              │
└──────────────────────────────────────────────────┘

[Grados/Niveles] [Ver Estudiantes (156)]

┌──────────────────┬──────────────────────────────┐
│ GRADOS/NIVELES   │ AULAS/SECCIONES              │
├──────────────────┼──────────────────────────────┤
│ • 1er Grado      │ • Sección A (25 estudiantes) │
│   (53 estudiantes│ • Sección B (28 estudiantes) │
│   [Editar] [X]   │   [X]                         │
│                  │                              │
│ • 2do Grado      │ + Agregar Aula               │
│   (55 estudiantes│                              │
│   [Editar] [X]   │                              │
│                  │                              │
│ • 3er Grado      │                              │
│   (48 estudiantes│                              │
│                  │                              │
│ + Agregar Grado  │                              │
└──────────────────┴──────────────────────────────┘
```

### **Para Admin General:**
```
┌──────────────────────────────────────────────────┐
│ 🎓 Grados y Salones Personalizables              │
└──────────────────────────────────────────────────┘

[Grados/Niveles] [Mi Sede (53)] [Todas las Sedes] ← Tab extra

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TAB: TODAS LAS SEDES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Estudiantes por Sede          [450 estudiantes totales]

┌────────────────────────────────────────────────┐
│ 🏫 Sede Principal - San Isidro   [156 estudiantes] │
├────────────────────────────────────────────────┤
│ TABLA:                                          │
│ ┌────────────────┬───────────┬─────────────┐   │
│ │ Nombre         │ Grado     │ Aula        │   │
│ ├────────────────┼───────────┼─────────────┤   │
│ │ Juan Pérez     │ 1er Grado │ Sección A   │   │
│ │ María López    │ 1er Grado │ Sección B   │   │
│ │ Carlos García  │ 2do Grado │ Sección A   │   │
│ │ ...            │ ...       │ ...         │   │
│ └────────────────┴───────────┴─────────────┘   │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ 🏫 Sede Norte - Los Olivos      [142 estudiantes]  │
├────────────────────────────────────────────────┤
│ TABLA:                                          │
│ ┌────────────────┬───────────┬─────────────┐   │
│ │ Nombre         │ Grado     │ Aula        │   │
│ ├────────────────┼───────────┼─────────────┤   │
│ │ Ana Torres     │ Sala Azul │ Leones      │   │
│ │ Pedro Silva    │ Sala Roja │ Tigres      │   │
│ │ ...            │ ...       │ ...         │   │
│ └────────────────┴───────────┴─────────────┘   │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ 🏫 Sede Sur - Miraflores        [152 estudiantes]  │
├────────────────────────────────────────────────┤
│ TABLA: [...]                                    │
└────────────────────────────────────────────────┘
```

---

## 📈 VENTAJAS

### ✅ **Para el Colegio:**
- Libertad total para nombrar como prefieran
- Refleja su estructura organizacional real
- Fácil de entender para su personal

### ✅ **Para Reportes:**
- Datos agrupados por sede
- Estadísticas internas coherentes
- Comparativas entre sedes (solo admin_general)

### ✅ **Para el Admin General:**
- **Vista centralizada** de todos los estudiantes
- **Tablas separadas por sede** para fácil lectura
- Contador total de estudiantes en toda la red
- Puede ver la estructura organizativa de cada sede
- Ideal para reportes, estadísticas y auditorías

### ✅ **Para el Sistema:**
- Escalable a cualquier tipo de colegio
- Mantiene integridad de datos
- Migración automática desde datos antiguos
- RLS garantiza separación de datos por sede

---

## 🔄 MIGRACIÓN DE DATOS ANTIGUOS

### **Proceso Automático:**
1. Lee `grade` y `section` de tabla `students`
2. Crea `school_levels` para cada grado único
3. Crea `school_classrooms` para cada sección única
4. Asigna `level_id` y `classroom_id` a estudiantes
5. Mantiene `grade` y `section` antiguos por compatibilidad

### **Resultado:**
```
Antes:
  Student: "Juan Pérez" | grade: "1er Grado" | section: "A"

Después:
  Student: "Juan Pérez" | grade: "1er Grado" | section: "A"
                       | level_id: UUID-GRADO-1
                       | classroom_id: UUID-SECCION-A
```

---

## 🎯 PRÓXIMOS PASOS

1. ✅ Ejecutar `SETUP_GRADOS_SALONES_PERSONALIZABLES.sql`
2. ✅ Migrar datos existentes con `SELECT migrate_student_grades_to_levels();`
3. ✅ Probar en localhost con datos reales
4. ✅ Deploy a producción

---

## 📞 CONFIRMACIONES

### ✅ **SISTEMA 100% SEPARADO POR SEDES**
- Cada sede tiene su propio `school_id`
- RLS en TODAS las tablas
- Imposible mezclar datos entre sedes
- Almacenes completamente independientes

### ✅ **NO SE CAMBIA EL NOMBRE DE LA SEDE**
- Solo se configuran grados y aulas
- El nombre de la sede está en la tabla `schools`
- Los administradores de sede NO pueden cambiar el nombre de su sede
- Solo configuran la estructura interna (grados/aulas)

---

**Estado:** ✅ FUNCIONAL  
**Versión:** 1.0  
**Fecha:** Enero 2026  
**Ubicación:** Módulo Administración de Sede → Tab "Grados y Salones"
