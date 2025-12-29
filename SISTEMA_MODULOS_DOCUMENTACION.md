# 🏢 Sistema Híbrido de Módulos y Sedes
## Lima Café 28 - Parent Portal Connect

---

## 📋 Índice
1. [Arquitectura del Sistema](#arquitectura)
2. [Módulos Disponibles](#módulos)
3. [Sistema de Sedes y Correlativos](#sedes)
4. [Permisos y Asignación](#permisos)
5. [Uso del Sistema](#uso)
6. [Próximos Pasos](#próximos-pasos)

---

## 🏗️ ARQUITECTURA DEL SISTEMA {#arquitectura}

### Concepto Principal

**Sistema Híbrido**: No se basa solo en roles predefinidos, sino en **módulos personalizables por usuario**.

```
Usuario → Módulos Asignados → Permisos Específicos
```

### Diferencia con Sistema Tradicional

| Sistema Tradicional (Por Roles) | Sistema Híbrido (Por Módulos) |
|----------------------------------|--------------------------------|
| ❌ Admin = Todos los permisos fijos | ✅ Admin = Módulos configurables |
| ❌ Cajero = Solo POS (fijo) | ✅ Cajero = POS + otros módulos |
| ❌ Rígido | ✅ Flexible |

---

## 🎯 MÓDULOS DISPONIBLES {#módulos}

### 1. 💰 Punto de Venta (POS)
- **Estado:** ✅ FUNCIONAL
- **Código:** `pos`
- **Color:** Verde
- **Ruta:** `/pos`
- **Descripción:** Sistema completo de cobro y ventas
- **Funcionalidades:**
  - Registro de ventas
  - Generación de comprobantes
  - Control de correlativos
  - Asignación de series por usuario

### 2. 💵 Cobranzas
- **Estado:** 🚧 En desarrollo
- **Código:** `cobranzas`
- **Color:** Rojo
- **Ruta:** `/cobranzas`
- **Descripción:** Gestión de cuentas por cobrar
- **Funcionalidades (Futuras):**
  - Ver saldos pendientes
  - Enviar recordatorios por WhatsApp
  - Reportes de morosidad
  - Historial de pagos

### 3. 👨‍👩‍👧 Configuración de Padres
- **Estado:** 🚧 En desarrollo
- **Código:** `config_padres`
- **Color:** Azul
- **Ruta:** `/config-padres`
- **Descripción:** Gestión de padres y estudiantes
- **Funcionalidades (Futuras):**
  - Agregar/editar padres
  - Agregar/editar estudiantes
  - Asignar padres a estudiantes
  - Configurar topes de consumo

### 4. 📊 Auditoría
- **Estado:** 🚧 En desarrollo
- **Código:** `auditoria`
- **Color:** Morado
- **Ruta:** `/auditoria`
- **Descripción:** Logs y seguimiento del sistema
- **Funcionalidades (Futuras):**
  - Historial de acciones
  - Logs de ventas
  - Logs de modificaciones
  - Exportar reportes

### 5. 📈 Finanzas
- **Estado:** 🚧 En desarrollo
- **Código:** `finanzas`
- **Color:** Amarillo
- **Ruta:** `/finanzas`
- **Descripción:** Reportes financieros y análisis
- **Funcionalidades (Futuras):**
  - Dashboard financiero
  - Gráficos de ventas
  - Comparativas mensuales
  - Proyecciones

### 6. 📦 Logística
- **Estado:** 🚧 En desarrollo
- **Código:** `logistica`
- **Color:** Naranja
- **Ruta:** `/logistica`
- **Descripción:** Inventario y compras
- **Funcionalidades (Futuras):**
  - Control de stock
  - Alertas de inventario bajo
  - Órdenes de compra
  - Proveedores

---

## 🏢 SISTEMA DE SEDES Y CORRELATIVOS {#sedes}

### Estructura Jerárquica

```
🏢 EMPRESA
├── 📍 SEDE (Location)
│   ├── 💰 PUNTO DE VENTA 1 (POS Point)
│   │   └── 📄 Serie: F001 → Correlativos: 1-9999
│   ├── 💰 PUNTO DE VENTA 2 (POS Point)
│   │   └── 📄 Serie: F002 → Correlativos: 1-9999
│   └── 💰 PUNTO DE VENTA 3 (POS Point)
│       └── 📄 Serie: T001 → Correlativos: 1-9999
└── 📍 SUCURSAL
    └── 💰 PUNTO DE VENTA
        └── 📄 Serie: F003 → Correlativos: 1-9999
```

### Ejemplo Real: Lima Café 28

```
🏢 Lima Café 28
│
├── 📍 Sede Central (SEDE-001)
│   ├── 💰 Caja Principal (POS-001)
│   │   └── Serie: F001 → Comprobantes: F001-00001, F001-00002...
│   ├── 💰 Caja Secundaria (POS-002)
│   │   └── Serie: F002 → Comprobantes: F002-00001, F002-00002...
│   └── 💰 Caja Express (POS-003)
│       └── Serie: T001 → Tickets: T001-00001, T001-00002...
│
├── 📍 Sucursal Norte (SUC-NORTE)
│   ├── 💰 Caja 1 Norte (POS-004)
│   │   └── Serie: F003 → Comprobantes: F003-00001, F003-00002...
│   └── 💰 Caja 2 Norte (POS-005)
│       └── Serie: F004 → Comprobantes: F004-00001, F004-00002...
│
└── 📍 Sucursal Sur (SUC-SUR)
    └── 💰 Caja Única Sur (POS-006)
        └── Serie: F005 → Comprobantes: F005-00001, F005-00002...
```

### Manejo de Correlativos Sin Colisión

#### ❌ Problema (Sistema Antiguo):
```
Juanita (Caja 1): F001-00001, F001-00002, F001-00003
Carlos (Caja 2):  F001-00001, F001-00002 ← ⚠️ COLISIÓN!
```

#### ✅ Solución (Sistema Nuevo):
```
Juanita (Caja 1 Norte): F003-00001, F003-00002, F003-00003
Carlos (Caja 2 Norte):  F004-00001, F004-00002, F004-00003 ← ✅ SIN COLISIÓN
```

### Función de Base de Datos

```sql
-- Obtener el siguiente correlativo de forma segura
SELECT get_next_correlative('POS-004');
-- Retorna: F003-00001

SELECT get_next_correlative('POS-004');
-- Retorna: F003-00002 (incrementa automáticamente)
```

---

## 🔐 PERMISOS Y ASIGNACIÓN {#permisos}

### Jerarquía de Usuarios

```
┌─────────────────────────────────────────────────────┐
│  👑 DUEÑO (SuperAdmin)                              │
│  ✅ Todos los módulos habilitados                   │
│  ✅ Acceso a todas las sedes                        │
│  ✅ Puede asignar módulos a otros usuarios          │
│  ✅ Serie asignada: F001 (Sede Central)             │
└─────────────────────────────────────────────────────┘
          │
          ├── Crea → 👔 ADMIN GENERAL (Gerente)
          │          ✅ Módulos: POS, Cobranzas, Finanzas
          │          ✅ Acceso a todas las sedes
          │          ✅ Serie asignada: F002
          │
          ├── Crea → 💰 CAJERA (Juanita)
          │          ✅ Módulos: Solo POS
          │          ✅ Sede: Sucursal Norte
          │          ✅ Serie asignada: F003
          │
          └── Crea → 💰 CAJERO (Carlos)
                     ✅ Módulos: Solo POS
                     ✅ Sede: Sucursal Norte
                     ✅ Serie asignada: F004
```

### Ejemplo de Asignación

#### Usuario: fiorella@limacafe28.com (Admin General)

```json
{
  "email": "fiorella@limacafe28.com",
  "role": "admin_general",
  "modules": [
    { "code": "pos", "enabled": true },
    { "code": "cobranzas", "enabled": true },
    { "code": "finanzas", "enabled": true },
    { "code": "config_padres", "enabled": false },
    { "code": "auditoria", "enabled": false },
    { "code": "logistica", "enabled": false }
  ],
  "pos_assignment": {
    "location": "Sede Central",
    "pos_point": "POS-002",
    "series": "F002"
  }
}
```

#### Usuario: juanita@limacafe28.com (Cajera)

```json
{
  "email": "juanita@limacafe28.com",
  "role": "pos",
  "modules": [
    { "code": "pos", "enabled": true },
    { "code": "cobranzas", "enabled": false },
    { "code": "finanzas", "enabled": false },
    { "code": "config_padres", "enabled": false },
    { "code": "auditoria", "enabled": false },
    { "code": "logistica", "enabled": false }
  ],
  "pos_assignment": {
    "location": "Sucursal Norte",
    "pos_point": "POS-004",
    "series": "F003"
  }
}
```

---

## 💻 USO DEL SISTEMA {#uso}

### Para el Dueño (SuperAdmin)

#### 1. Iniciar Sesión
```
Email: superadmin@limacafe28.com
Tipo: Personal Administrativo
```

#### 2. Ver Dashboard de Módulos
- Todos los 6 módulos aparecen
- Solo "Punto de Venta" está activo
- Los demás dicen "Próximamente"

#### 3. Acceder al Panel SuperAdmin
- Ruta: `/superadmin`
- Pantalla morada
- Crear admins generales

#### 4. Crear Usuario con Módulos (Futuro)
- Ir a `/superadmin` → "Crear Usuarios"
- Ingresar datos del usuario
- **Seleccionar módulos** a habilitar
- **Asignar sede y punto de venta**
- Guardar

### Para Admin General

#### 1. Iniciar Sesión
```
Email: fiorella@limacafe28.com
Tipo: Personal Administrativo
```

#### 2. Ver Dashboard de Módulos
- Ver solo módulos habilitados por el dueño
- Hacer clic para acceder

#### 3. Usar Módulo POS
- Clic en "Punto de Venta"
- Realizar ventas
- Correlativos automáticos según su serie asignada

### Para Cajero/Personal POS

#### 1. Iniciar Sesión
```
Email: juanita@limacafe28.com
Tipo: Personal Administrativo
```

#### 2. Ver Dashboard
- Solo ve módulo "Punto de Venta"
- Los demás están bloqueados

#### 3. Trabajar en POS
- Solo puede usar su serie asignada (ej: F003)
- Correlativos van de F003-00001 en adelante
- No puede pisar los correlativos de otros

---

## 🚀 PRÓXIMOS PASOS {#próximos-pasos}

### Fase 1: Base de Datos ✅
- [x] Crear tablas de módulos
- [x] Crear tablas de sedes
- [x] Crear tablas de puntos de venta
- [x] Crear tablas de asignación
- [x] Función para correlativos

### Fase 2: UI Dashboard ✅
- [x] Dashboard de módulos responsive
- [x] Tarjetas interactivas
- [x] Indicadores de estado
- [x] Navegación entre módulos

### Fase 3: Gestión de Usuarios (En Curso)
- [ ] Interfaz para asignar módulos
- [ ] Interfaz para asignar sedes
- [ ] Interfaz para asignar puntos de venta
- [ ] Ver permisos de usuarios

### Fase 4: Módulo POS Completo (En Curso)
- [ ] Integrar sistema de correlativos
- [ ] Obtener serie del usuario logueado
- [ ] Generar comprobantes con serie correcta
- [ ] Validar límites de correlativos

### Fase 5: Otros Módulos
- [ ] Desarrollar módulo Cobranzas
- [ ] Desarrollar módulo Config Padres
- [ ] Desarrollar módulo Auditoría
- [ ] Desarrollar módulo Finanzas
- [ ] Desarrollar módulo Logística

---

## 📊 RESUMEN EJECUTIVO

```
┌──────────────────────────────────────────────────────┐
│         🎯 SISTEMA HÍBRIDO IMPLEMENTADO              │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ✅ Dashboard de Módulos (Responsive)                │
│  ✅ 6 Módulos definidos (1 funcional)                │
│  ✅ Sistema de Sedes (3 sedes ejemplo)               │
│  ✅ Sistema de Puntos de Venta (6 cajas)             │
│  ✅ Control de Correlativos Sin Colisión             │
│  ✅ Función SQL para obtener correlativos            │
│  ✅ Arquitectura escalable                           │
│                                                      │
│  🚧 EN DESARROLLO:                                   │
│     - Interfaz de asignación de módulos             │
│     - Integración POS con correlativos              │
│     - Resto de módulos                              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

**Sistema creado por:** AI Assistant
**Fecha:** Diciembre 2025
**Proyecto:** Lima Café 28 - Parent Portal Connect

