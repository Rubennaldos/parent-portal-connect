# 🎯 SISTEMA DE PERFILES Y CORRELATIVOS

## 📌 RESUMEN:

Este documento define cómo funcionarán:
1. La gestión de usuarios desde SuperAdmin
2. La creación de perfiles por sede
3. El sistema de correlativos de tickets

---

## 👥 1. MÓDULO: GESTIÓN DE USUARIOS (SuperAdmin)

### **Ubicación:**
- Dashboard SuperAdmin → Módulo "Gestión de Usuarios"

### **Funcionalidades:**

#### **A. Ver Todos los Usuarios**
Tabla con columnas:
- Email
- Nombre completo
- Rol (admin_general, pos, kitchen, parent)
- Sede asignada
- Método de registro (Google, Microsoft, Email)
- Fecha de creación
- Última conexión
- Estado (Activo/Inactivo)

**Filtros:**
- Por rol
- Por sede
- Por método de registro
- Por fecha

**Acciones:**
- Ver detalles completos
- Desactivar/Activar usuario
- Cambiar contraseña
- Eliminar usuario

#### **B. Crear Usuario Admin General**
Formulario:
- Email
- Nombre completo
- Contraseña temporal
- Confirmar contraseña
- Sedes asignadas (puede tener acceso a múltiples sedes)

**Proceso:**
1. SuperAdmin llena formulario
2. Sistema crea cuenta en Supabase
3. Sistema envía email con credenciales
4. Admin General debe cambiar contraseña en primer login

#### **C. Estadísticas**
Cards en el dashboard:
- Total usuarios por rol
- Usuarios creados hoy/semana/mes
- Métodos de registro más usados
- Usuarios activos vs inactivos

---

## 🏢 2. MÓDULO: CONTROL DE PERFILES (SuperAdmin)

### **Ubicación:**
- Dashboard SuperAdmin → Módulo "Control de Perfiles"

### **Funcionalidades:**

#### **A. Ver Perfiles por Sede**
Agrupado por sede:

```
Nordic (NRD)
├─ POS 1 - cajero1@nordic.com (Activo)
├─ POS 2 - cajero2@nordic.com (Activo)
└─ Kitchen 1 - cocina@nordic.com (Activo)

Saint George Villa (SGV)
├─ POS 1 - caja@sgv.com (Activo)
└─ Kitchen 1 - menu@sgv.com (Inactivo)
```

#### **B. Crear Perfiles POS/Kitchen**
Límite: **Máximo 3 perfiles por sede** (entre POS y Kitchen combinados)

Formulario:
- Sede (select)
- Tipo de perfil (POS o Kitchen)
- Número del punto (auto-calculado: 1, 2, 3)
- Email
- Nombre completo
- Contraseña temporal

**Validaciones:**
- ✅ Máximo 3 perfiles por sede
- ✅ Email único
- ✅ No duplicar número de punto

#### **C. Asignación Automática de Prefijo**
Al crear un usuario POS, se asigna automáticamente:

| Sede | Prefijo Base | Usuario POS 1 | Usuario POS 2 | Usuario POS 3 |
|------|-------------|--------------|--------------|--------------|
| Nordic (NRD) | FN | FN1 | FN2 | FN3 |
| Saint George Villa (SGV) | FSG | FSG1 | FSG2 | FSG3 |
| Saint George Miraflores (SGM) | FSGM | FSGM1 | FSGM2 | FSGM3 |
| Little Saint George (LSG) | FLSG | FLSG1 | FLSG2 | FLSG3 |
| Jean LeBouch (JLB) | FJL | FJL1 | FJL2 | FJL3 |
| Maristas Champagnat 1 (MC1) | FMC1 | FMC11 | FMC12 | FMC13 |
| Maristas Champagnat 2 (MC2) | FMC2 | FMC21 | FMC22 | FMC23 |

---

## 🎫 3. SISTEMA DE CORRELATIVOS DE TICKETS

### **Estructura del Ticket:**
```
[PREFIJO_SEDE][NUMERO_POS]-[CORRELATIVO]

Ejemplos:
- FN1-001, FN1-002, FN1-003... (Nordic, Cajero 1)
- FN2-001, FN2-002, FN2-003... (Nordic, Cajero 2)
- FSG1-001, FSG1-002...        (St. George Villa, Cajero 1)
- FSGM1-001, FSGM1-002...      (St. George Miraflores, Cajero 1)
```

### **Tabla en Base de Datos:**

```sql
CREATE TABLE ticket_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  pos_user_id UUID REFERENCES profiles(id),
  prefix TEXT NOT NULL,          -- 'FN1', 'FSG2', etc.
  current_number INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, pos_user_id)
);

-- Función para obtener siguiente número
CREATE OR REPLACE FUNCTION get_next_ticket_number(p_pos_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_next_number INTEGER;
  v_ticket_code TEXT;
BEGIN
  -- Obtener prefijo y siguiente número
  UPDATE ticket_sequences
  SET current_number = current_number + 1,
      updated_at = now()
  WHERE pos_user_id = p_pos_user_id
  RETURNING prefix, current_number INTO v_prefix, v_next_number;
  
  -- Formatear ticket: FN1-001
  v_ticket_code := v_prefix || '-' || LPAD(v_next_number::TEXT, 3, '0');
  
  RETURN v_ticket_code;
END;
$$ LANGUAGE plpgsql;
```

### **Uso en el POS:**

```typescript
// Al hacer una venta
const { data: ticketCode } = await supabase
  .rpc('get_next_ticket_number', {
    p_pos_user_id: user.id
  });

// ticketCode = "FN1-042"
```

### **Reinicio de Correlativos:**
- Automático: Cada día a las 00:00
- Manual: Desde SuperAdmin (solo en casos especiales)

---

## 🗄️ ESTRUCTURA DE BASE DE DATOS

### **Tabla: profiles (ACTUALIZAR)**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pos_number INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ticket_prefix TEXT;

-- Ejemplo de registro:
-- user: cajero1@nordic.com
-- role: pos
-- school_id: [UUID de Nordic]
-- pos_number: 1
-- ticket_prefix: 'FN1'
```

### **Tabla: ticket_sequences (NUEVA)**
```sql
-- Ya mostrada arriba
```

### **Tabla: transactions (ACTUALIZAR)**
```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ticket_code TEXT;

-- Ejemplo de registro:
-- ticket_code: 'FN1-042'
-- type: 'purchase'
-- amount: 15.50
-- student_id: [UUID]
-- created_by: [UUID del cajero]
```

---

## 🔐 PERMISOS (RLS)

### **Tabla: ticket_sequences**
```sql
-- Solo el cajero ve su secuencia
CREATE POLICY "POS can view own sequence"
ON ticket_sequences FOR SELECT
USING (pos_user_id = auth.uid());

-- Solo el sistema puede actualizar
CREATE POLICY "System can update sequences"
ON ticket_sequences FOR UPDATE
USING (true);
```

---

## 📊 DASHBOARDS

### **SuperAdmin Dashboard:**
```
┌─────────────────────────────────────┐
│  GESTIÓN DE USUARIOS                │
├─────────────────────────────────────┤
│  📊 Total Usuarios: 45              │
│  👤 Admin General: 5                │
│  💰 POS: 12                         │
│  👨‍🍳 Kitchen: 8                      │
│  👪 Padres: 20                      │
│                                     │
│  [Ver Todos] [Crear Admin]          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  CONTROL DE PERFILES                │
├─────────────────────────────────────┤
│  🏫 Nordic (NRD)                    │
│     POS: 2/3 - Kitchen: 1/3         │
│  🏫 Saint George Villa (SGV)        │
│     POS: 3/3 - Kitchen: 0/3         │
│                                     │
│  [Gestionar Sedes]                  │
└─────────────────────────────────────┘
```

---

## 🎯 FLUJO DE CREACIÓN DE USUARIOS

### **Flujo 1: Admin General**
```
SuperAdmin → Gestión Usuarios → Crear Admin General
  ↓
Formulario (email, nombre, sedes)
  ↓
Sistema crea cuenta en Supabase
  ↓
Email con credenciales enviado
  ↓
Admin debe cambiar password en primer login
```

### **Flujo 2: POS/Kitchen**
```
SuperAdmin → Control Perfiles → Seleccionar Sede
  ↓
Ver perfiles actuales (ej: 2/3 usado)
  ↓
Crear nuevo perfil (tipo, email, nombre)
  ↓
Sistema asigna prefijo automático (ej: FN3)
  ↓
Crea secuencia de tickets (FN3-001)
  ↓
Email con credenciales enviado
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

### **Fase 1: Base de Datos**
- [ ] Actualizar tabla `profiles` con `pos_number` y `ticket_prefix`
- [ ] Crear tabla `ticket_sequences`
- [ ] Crear función `get_next_ticket_number`
- [ ] Configurar RLS policies

### **Fase 2: SuperAdmin - Gestión Usuarios**
- [ ] Crear componente tabla de usuarios
- [ ] Agregar filtros
- [ ] Formulario crear Admin General
- [ ] Funcionalidad desactivar/activar usuarios

### **Fase 3: SuperAdmin - Control Perfiles**
- [ ] Vista agrupada por sede
- [ ] Contador de perfiles (X/3)
- [ ] Formulario crear POS/Kitchen
- [ ] Asignación automática de prefijo

### **Fase 4: POS - Sistema de Tickets**
- [ ] Integrar generación de ticket en venta
- [ ] Mostrar ticket code en recibo
- [ ] Guardar en tabla transactions

### **Fase 5: Pruebas**
- [ ] Crear múltiples usuarios POS por sede
- [ ] Verificar correlativos únicos
- [ ] Probar reinicio diario
- [ ] Validar límite de 3 perfiles por sede

---

**Este es el plan completo. ¿Empezamos con la Fase 1 (Base de Datos)?** 🚀

