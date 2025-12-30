# 🔐 Separación de Roles: Técnico vs Negocio

## ✅ CORRECCIÓN APLICADA

Se ha corregido la confusión entre el rol **técnico** (SuperAdmin) y el rol de **negocio** (Admin General).

---

## 👨‍💻 SUPERADMIN (Programador) - Panel Técnico

### Ruta Principal
- **`/superadmin`** (Panel morado/rosa oscuro)

### ¿Qué ES?
- Perfil de **PROGRAMADOR**
- Maneja aspectos **TÉCNICOS** del sistema
- **NO tiene nada que ver con el negocio**

### ¿Qué PUEDE hacer?
- ✅ Crear usuarios `admin_general` (dueños del negocio)
- ✅ Ver logs del sistema
- ✅ Gestionar credenciales (API keys)
- ✅ Acceso directo a base de datos (Supabase)
- ✅ Configuración técnica del sistema
- ✅ Debugging y troubleshooting

### ¿Qué NO PUEDE hacer?
- ❌ Ver módulos de negocio (POS, Cobranzas, Finanzas, etc.)
- ❌ Acceder al Dashboard de módulos (`/dashboard`)
- ❌ Hacer ventas o cobros
- ❌ Ver reportes de negocio
- ❌ Gestionar empleados del negocio

### Usuario Ejemplo
```
Email: superadmin@limacafe28.com
Rol: superadmin
Acceso: /superadmin (solo panel técnico)
```

---

## 👔 ADMIN GENERAL (Dueño del Negocio) - Panel de Negocio

### Ruta Principal
- **`/dashboard`** (Dashboard de módulos)

### ¿Qué ES?
- Perfil del **DUEÑO** o **GERENTE GENERAL**
- Maneja todo lo relacionado al **NEGOCIO**
- **NO tiene acceso técnico**

### ¿Qué PUEDE hacer?
- ✅ Ver Dashboard de módulos de negocio
- ✅ Acceder a módulo POS (Punto de Venta)
- ✅ Acceder a módulo Cobranzas
- ✅ Acceder a módulo Finanzas
- ✅ Acceder a módulo Auditoría
- ✅ Acceder a módulo Logística
- ✅ Acceder a módulo Configuración de Padres
- ✅ Asignar módulos a empleados (cuando se implemente)
- ✅ Gestionar sedes y puntos de venta
- ✅ Ver reportes de ventas y finanzas

### ¿Qué NO PUEDE hacer?
- ❌ Ver configuración técnica del sistema
- ❌ Acceder al panel SuperAdmin (`/superadmin`)
- ❌ Ver logs técnicos
- ❌ Gestionar credenciales de API
- ❌ Acceder directamente a la base de datos

### Usuario Ejemplo
```
Email: fiorella@limacafe28.com
Rol: admin_general
Acceso: /dashboard (Dashboard de módulos de negocio)
```

---

## 📊 Comparación Visual

```
┌──────────────────────────────────────────────────────────────┐
│                    SUPERADMIN vs ADMIN GENERAL               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  👨‍💻 SUPERADMIN                    👔 ADMIN GENERAL         │
│  (Programador)                    (Dueño del Negocio)       │
│                                                              │
│  Ruta: /superadmin               Ruta: /dashboard           │
│  Color: 🟣 Morado/Rosa            Color: 🔵 Azul/Blanco      │
│                                                              │
│  ✅ Crear usuarios                ✅ Dashboard de módulos    │
│  ✅ Ver logs técnicos             ✅ Módulo POS              │
│  ✅ Gestionar API keys            ✅ Módulo Cobranzas        │
│  ✅ Acceso a BD                   ✅ Módulo Finanzas         │
│  ✅ Debugging                     ✅ Módulo Auditoría        │
│                                   ✅ Módulo Logística        │
│  ❌ NO ve Dashboard negocio       ✅ Gestionar empleados     │
│  ❌ NO hace ventas                ✅ Ver reportes            │
│  ❌ NO ve módulos                 ✅ Asignar módulos         │
│                                                              │
│                                   ❌ NO ve panel técnico     │
│                                   ❌ NO accede a BD          │
│                                   ❌ NO ve logs técnicos     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Usuarios

### Flujo SuperAdmin (Programador)

```
1. SuperAdmin inicia sesión
   ↓
2. Sistema detecta rol: superadmin
   ↓
3. Redirige a: /superadmin (panel morado)
   ↓
4. Ve opciones técnicas:
   - Crear admin_general
   - Ver logs
   - Gestionar credenciales
   - Acceso a BD
   ↓
5. Crea un admin_general (ej: fiorella@limacafe28.com)
   ↓
6. Ese admin_general irá automáticamente a /dashboard
```

### Flujo Admin General (Dueño)

```
1. Admin General inicia sesión
   ↓
2. Sistema detecta rol: admin_general
   ↓
3. Redirige a: /dashboard (Dashboard de módulos)
   ↓
4. Ve 6 tarjetas de módulos:
   ├── 💰 Punto de Venta (✅ Funcional)
   ├── 💵 Cobranzas (🚧 Próximamente)
   ├── 👨‍👩‍👧 Config Padres (🚧 Próximamente)
   ├── 📊 Auditoría (🚧 Próximamente)
   ├── 📈 Finanzas (🚧 Próximamente)
   └── 📦 Logística (🚧 Próximamente)
   ↓
5. Hace clic en "Punto de Venta"
   ↓
6. Accede al módulo POS y hace ventas
```

---

## 🎯 Casos de Uso

### Caso 1: Instalar el Sistema (Primera vez)

```
1. Programador crea proyecto en Supabase
2. Programador ejecuta scripts SQL
3. Programador corre `npm run dev`
4. Programador crea su cuenta: superadmin@limacafe28.com
5. Programador ejecuta SQL para cambiar su rol a 'superadmin'
6. Programador inicia sesión → Va a /superadmin
7. Programador crea el primer admin_general (dueño del negocio)
8. El dueño ahora puede gestionar el negocio desde /dashboard
```

### Caso 2: Dueño Gestiona el Negocio

```
1. Dueño inicia sesión como admin_general
2. Va automáticamente a /dashboard
3. Ve sus 6 módulos de negocio
4. Accede a POS y hace ventas
5. Revisa reportes en Finanzas (cuando esté listo)
6. Asigna módulos a empleados
```

### Caso 3: Problema Técnico

```
1. Hay un error en el sistema
2. Dueño NO puede arreglarlo (no tiene acceso técnico)
3. Llama al programador
4. Programador inicia sesión como superadmin
5. Va a /superadmin → pestaña "Logs"
6. Ve el error técnico
7. Arregla el problema desde el panel técnico
8. Dueño puede seguir usando /dashboard normalmente
```

---

## 📋 Resumen de Cambios Aplicados

### Archivos Modificados:

1. **`src/hooks/useRole.ts`**
   - `superadmin` redirige a `/superadmin` (panel técnico)
   - `admin_general` redirige a `/dashboard` (panel negocio)

2. **`src/App.tsx`**
   - Ruta `/dashboard` solo para `admin_general, pos, kitchen`
   - SuperAdmin NO puede acceder a `/dashboard`

3. **`src/pages/Dashboard.tsx`**
   - Título cambiado a "Dashboard de Negocio"
   - Si es `admin_general` → Ve todos los módulos
   - Si es otro rol → Ve solo sus módulos asignados
   - SuperAdmin NO llega aquí

4. **`src/pages/SuperAdmin.tsx`**
   - Descripción actualizada: "Create Business Owner / Admin"
   - Nota agregada: Explica que admin_general va a /dashboard
   - Panel sigue siendo técnico/programación

---

## ✅ CONCLUSIÓN

```
┌────────────────────────────────────────────────────┐
│         ✅ SEPARACIÓN CORRECTA APLICADA            │
├────────────────────────────────────────────────────┤
│                                                    │
│  👨‍💻 SuperAdmin = Panel Técnico (/superadmin)     │
│     - Programador                                 │
│     - Maneja sistema, no negocio                  │
│                                                    │
│  👔 Admin General = Panel Negocio (/dashboard)     │
│     - Dueño/Gerente                               │
│     - Maneja negocio, no sistema técnico          │
│                                                    │
│  ✅ Cada uno en su carril                         │
│  ✅ Sin confusiones                               │
│  ✅ Separación clara de responsabilidades         │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

**Fecha:** Diciembre 2025
**Commit:** b385c3b
**Estado:** ✅ CORREGIDO Y APLICADO


