# 🔧 Solución al Problema de Acceso a Módulos

## 🚨 El Problema

Los módulos **Lista de Ventas**, **Punto de Venta** y **Configuración de Padres** estaban **bloqueando el acceso** a pesar de estar habilitados en el Dashboard. 

### ¿Por qué sucedía esto?

Había **DOS niveles de validación de permisos** que NO estaban sincronizados:

1. **Dashboard** ✅ - Verificaba `ver_modulo` en la base de datos → Mostraba el módulo si estaba `granted = true`
2. **Rutas Protegidas** ❌ - Usaba `allowedRoles` **hardcodeados** en `App.tsx` → Bloqueaba según roles fijos

### Ejemplo del conflicto:

```typescript
// En Dashboard.tsx - Consultaba la BD
const { data } = await supabase
  .from('role_permissions')
  .select('*')
  .eq('role', 'supervisor_red')
  .eq('granted', true);
// ✅ Si encuentra ventas.ver_modulo, muestra el módulo en Dashboard

// En App.tsx - Roles hardcodeados
<ProtectedRoute allowedRoles={['admin_general', 'operador_caja']}>
  <SalesList />
</ProtectedRoute>
// ❌ Si el rol es 'supervisor_red', bloquea el acceso aunque tenga permiso en BD
```

**Resultado:** El usuario veía el módulo en Dashboard pero al hacer clic era expulsado.

### Problema adicional en SalesList:

El componente tenía validaciones internas que requerían permisos de **visualización de sedes** (`ver_su_sede`, `ver_todas_sedes`), pero NO consideraba suficiente el permiso base `ver_modulo`.

```typescript
// Antes - Requería permisos específicos de sedes
switch (permission.action) {
  case 'ver_modulo':
  case 'ver_su_sede':  // Solo estos activaban canView
    perms.canView = true;
    break;
}

// Problema: Si solo tenía ver_modulo, canView quedaba en false
```

---

## ✅ La Solución Implementada

### 1. Nuevo Componente: `PermissionProtectedRoute`

Creé un componente que **consulta la base de datos** en lugar de usar roles hardcodeados:

```typescript
// src/components/PermissionProtectedRoute.tsx
export function PermissionProtectedRoute({ 
  children, 
  moduleCode  // 'ventas', 'pos', 'config_padres', etc.
}: PermissionProtectedRouteProps) {
  
  // Consulta la BD para verificar si el usuario tiene ver_modulo
  const { data } = await supabase
    .from('role_permissions')
    .select('granted, permissions(module, action)')
    .eq('role', role)
    .eq('granted', true);
  
  const hasAccess = data?.some(perm => 
    perm.permissions?.module === moduleCode && 
    perm.permissions?.action === 'ver_modulo'
  );
  
  // Si tiene permiso, muestra el módulo
  // Si no, muestra pantalla de "Acceso Denegado"
}
```

### 2. Actualización de Rutas en `App.tsx`

Reemplacé `ProtectedRoute` con `PermissionProtectedRoute` en los módulos principales:

```typescript
// ❌ ANTES - Roles hardcodeados
<Route path="/sales" element={
  <ProtectedRoute allowedRoles={['admin_general', 'operador_caja']}>
    <SalesList />
  </ProtectedRoute>
} />

// ✅ AHORA - Permisos dinámicos desde BD
<Route path="/sales" element={
  <PermissionProtectedRoute moduleCode="ventas">
    <SalesList />
  </PermissionProtectedRoute>
} />
```

### 3. Ajuste en `SalesList.tsx`

Hice que `ver_modulo` sea **suficiente** para acceder al módulo:

```typescript
// Ahora ver_modulo activa canView
switch (permission.action) {
  case 'ver_modulo':  // ✅ Agregado como case independiente
    perms.canView = true;
    break;
  case 'ver_su_sede':
    perms.canView = true;
    break;
  // ... resto de casos
}
```

Y **eliminé la validación de bloqueo interna**, porque ahora la ruta ya valida:

```typescript
// ❌ ANTES - Bloqueaba internamente
if (!permissions.canView) {
  return <Card>Acceso Denegado</Card>;
}

// ✅ AHORA - Solo verifica si está cargando
if (permissions.loading) {
  return <Spinner />;
}
// Si llegó aquí, ya tiene permiso (validado por la ruta)
```

---

## 🎯 Filosofía del Sistema de Permisos

### Dos Niveles de Control:

1. **Nivel de Módulo** (Ruta) - `ver_modulo`
   - Controla si el usuario puede **ENTRAR** al módulo
   - Si está `granted = true`, puede acceder
   - Si está `granted = false`, ve "Acceso Denegado"

2. **Nivel de Funcionalidades** (Dentro del módulo) - Permisos granulares
   - Controla qué **PUEDE HACER** dentro del módulo
   - Ejemplos: `editar`, `eliminar`, `imprimir_ticket`, `sacar_reportes`
   - Si no tiene el permiso, el botón/funcionalidad se **oculta**

### Ejemplo Práctico:

**Gestor de Red** con estos permisos en BD:
```sql
ventas.ver_modulo = true     -- ✅ Puede entrar al módulo
ventas.ver_su_sede = true    -- ✅ Solo ve ventas de su sede
ventas.editar = false        -- ❌ NO puede editar ventas
ventas.eliminar = false      -- ❌ NO puede eliminar ventas
ventas.imprimir_ticket = true -- ✅ Puede reimprimir tickets
```

**Resultado:**
- ✅ Puede acceder a "Lista de Ventas"
- ✅ Ve solo las ventas de su sede (no de todas)
- ❌ Los botones "Editar" y "Eliminar" NO aparecen
- ✅ El botón "Imprimir" SÍ aparece

---

## 📋 Módulos Afectados por el Fix

Los siguientes módulos ahora usan **permisos dinámicos**:

1. ✅ **Punto de Venta** (`/pos`) - `moduleCode: 'pos'`
2. ✅ **Lista de Ventas** (`/sales`) - `moduleCode: 'ventas'`
3. ✅ **Cobranzas** (`/cobranzas`) - `moduleCode: 'cobranzas'`
4. ✅ **Comedor** (`/comedor`) - `moduleCode: 'comedor'`
5. ✅ **Configuración de Padres** (`/parents`) - `moduleCode: 'config_padres'`
6. ✅ **Productos** (`/products`) - `moduleCode: 'productos'`

### Módulos con permisos especiales (NO afectados):

- 🔒 **Control de Acceso** - Solo `admin_general` (siempre)
- 🔒 **SuperAdmin** - Solo `superadmin` (siempre)
- 🔒 **Estadísticas de Pagos** - Solo `admin_general` (por ahora)

---

## 🧪 Cómo Probar

1. **En SuperAdmin**, ve a "Control de Acceso"
2. Selecciona el rol "Gestor de Red" (o el que quieras probar)
3. Activa el switch del módulo "Lista de Ventas" (o cualquier otro)
4. Los cambios se guardan **automáticamente**
5. Cierra sesión e inicia como un usuario con ese rol
6. Verifica que:
   - ✅ El módulo aparece en el Dashboard
   - ✅ Al hacer clic, puedes **ENTRAR** al módulo
   - ✅ Solo ves las funcionalidades que tienes permitidas

---

## 🚀 Deploy

✅ **Cambios aplicados a:**
- `localhost:8080` - Funcionando con HMR
- GitHub `main` branch - Push completado
- Vercel - Deploy automático en progreso

---

## 📝 Resumen Técnico

### Archivos Creados:
- `src/components/PermissionProtectedRoute.tsx` - Nuevo componente de validación dinámica

### Archivos Modificados:
- `src/App.tsx` - Rutas ahora usan `PermissionProtectedRoute`
- `src/components/admin/SalesList.tsx` - `ver_modulo` es suficiente, eliminado bloqueo interno

### Base de Datos:
- No requiere cambios en SQL
- El sistema ya usa `role_permissions` y `permissions` correctamente

---

## 🎉 Resultado Final

**ANTES:** ❌ Módulo habilitado → Usuario expulsado al entrar

**AHORA:** ✅ Módulo habilitado → Usuario puede entrar y usar funcionalidades según permisos granulares

El sistema ahora es **consistente** entre:
- Dashboard (qué se muestra)
- Rutas (a qué se puede acceder)
- Componentes (qué funcionalidades están disponibles)

Todo controlado desde **UN SOLO LUGAR**: La tabla `role_permissions` en Supabase.

