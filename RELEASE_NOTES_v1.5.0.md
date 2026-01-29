# 🎉 Release Notes - Versión 1.5.0

**Fecha**: 29 de Enero, 2026  
**Tipo**: Major Feature Release

---

## ✨ **NUEVAS FUNCIONALIDADES**

### 🍽️ **Sistema Completo de Almuerzos v2.0**

#### **1. Portal de Padres - Gestión de Pedidos**
- ✅ Nueva sección "Mis Pedidos de Almuerzo"
- ✅ Vista de historial completo de pedidos (próximos y pasados)
- ✅ Estados detallados: Confirmado, Entregado, Anulado, Postergado
- ✅ Notificación de almuerzos entregados sin pedido previo (genera deuda automática)
- ✅ Filtros inteligentes (Todos, Próximos, Pasados)

#### **2. Portal del Profesor - Nueva Pestaña "Pagos"**
- ✅ Balance de cuenta en tiempo real
- ✅ Historial completo de transacciones
- ✅ Detalle de cada compra con items
- ✅ Visualización de deudas pendientes

#### **3. Módulo Admin - Gestión de Pedidos (Integrado en Calendario de Almuerzos)**
- ✅ Nueva pestaña "🍽️ Pedidos" dentro del módulo existente
- ✅ Vista consolidada de todos los pedidos del día
- ✅ Filtros avanzados (fecha, sede, estado, búsqueda)
- ✅ Acciones disponibles:
  - **Entregar**: Marcar pedido como entregado
  - **Postergar**: Con justificación (solo antes de 9 AM)
  - **Anular**: Con justificación (solo antes de 9 AM)

#### **4. Opción A - "Entregar sin Pedido Previo"**
- ✅ Para estudiantes con cuenta crédito cuyos padres olvidaron pedir
- ✅ Genera deuda automática
- ✅ El padre ve la deuda en su portal
- ✅ Búsqueda inteligente de estudiantes

#### **5. Opción B - "Puentes Temporales"**
- ✅ Crear estudiantes temporales sin padre asociado
- ✅ Para niños que no están en el sistema pero necesitan almuerzo
- ✅ Cuenta crédito automática sin límites
- ✅ Registro manual de salón y notas
- ✅ Seguimiento de deudas temporales

#### **6. Sistema de Restricción Horaria**
- ✅ Postergar/Anular solo disponible antes de las 9:00 AM (hora Perú)
- ✅ Después de las 9 AM: solo se puede marcar como "Entregado"
- ✅ Validación automática con zona horaria

---

## 🗄️ **BASE DE DATOS**

### **Nuevas Funciones RPC:**
- `create_lunch_delivery_no_order()` - Registra entrega sin pedido y crea deuda
- `create_temporary_student()` - Crea estudiante temporal (puente)
- `can_modify_lunch_order()` - Valida restricción horaria (9 AM)

### **Nuevas Columnas:**
**Tabla `lunch_orders`:**
- `delivered_at`, `cancelled_at`, `postponed_at`
- `cancellation_reason`, `postponement_reason`
- `delivered_by`, `cancelled_by`, `postponed_by`
- `is_no_order_delivery` (Opción A)

**Tabla `students`:**
- `is_temporary` (flag para puentes temporales)
- `temporary_classroom_name`
- `temporary_notes`

**Tabla `transactions` y `sales`:**
- `teacher_id` (soporte para profesores)

---

## 🔧 **MEJORAS Y CORRECCIONES**

### **Profesores:**
- ✅ Sistema de delay implementado (respeta configuración por sede)
- ✅ Calendario de almuerzos funcional (pestaña "Menú")
- ✅ Nueva pestaña "Pagos" con balance y transacciones
- ✅ Pedidos de almuerzo con cuenta libre (sin límites)

### **Arquitectura:**
- ✅ Funcionalidad de pedidos integrada correctamente en módulo existente
- ✅ Componentes reutilizables y modulares
- ✅ Manejo robusto de errores
- ✅ Consultas optimizadas

### **Correcciones:**
- 🐛 Fix: Error 400 al consultar `profiles.assigned_schools`
- 🐛 Fix: Columna `ordered_at` cambiada a `created_at`
- 🐛 Fix: Manejo de casos donde no existen configuraciones
- 🐛 Fix: Políticas RLS para profesores y estudiantes temporales

---

## 📋 **FLUJO COMPLETO**

### **Para Padres:**
1. Portal → Pestaña "Almuerzos"
2. Ver pedidos realizados (sección "Mis Pedidos")
3. Hacer nuevos pedidos (calendario)
4. Ver deudas en pestaña "Pagos"

### **Para Profesores:**
1. Portal → Pestaña "Menú" (hacer pedidos)
2. Portal → Pestaña "Pagos" (ver balance)
3. Portal → Pestaña "Historial" (ver compras)

### **Para Admins/Cajeros:**
1. Dashboard → "Calendario de Almuerzos"
2. Pestaña "Pedidos" → Ver todos los pedidos del día
3. Opciones:
   - Entregar pedidos confirmados
   - Postergar/Anular (antes de 9 AM)
   - Entregar sin pedido previo (genera deuda)
   - Crear puente temporal (niño sin cuenta)

---

## 🎯 **PRÓXIMAS FUNCIONALIDADES**

- [ ] Integración con pasarela de pagos para padres sin cuenta crédito
- [ ] Reportes avanzados de almuerzos por sede/fecha
- [ ] Notificaciones automáticas a padres
- [ ] Sistema de facturación electrónica (SUNAT)

---

## 📞 **SOPORTE**

Para soporte técnico contactar a:  
**Email**: fiorella@limacafe28.com

---

**Desarrollado por**: ARQUISIA Soluciones  
**Cliente**: Lima Café 28  
**Versión**: 1.5.0
