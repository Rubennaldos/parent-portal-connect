# 📝 PROMPT PARA CLAUDE OPUS - v1.19.0 CALENDARIO UNIFICADO + LIMPIEZA

## 🎯 CONTEXTO

El sistema **Parent Portal Connect** tuvo un problema CRÍTICO de **transacciones duplicadas** que ya fue resuelto en código. Ahora se implementó el **Calendario Unificado v1.19.0** para profesores y padres.

**IMPORTANTE**: Lee primero `EXPLICACION_FIXES_DUPLICADOS_V1.18.0.md` para el contexto de duplicados.

---

## ✅ CAMBIOS EN v1.19.0 (12 feb 2026)

### 1. Nuevo Componente: `UnifiedLunchCalendar.tsx`
- **Archivo**: `src/components/lunch/UnifiedLunchCalendar.tsx`
- **Reemplaza**: `OrderLunchMenus` (tarjetas semanales) tanto en `Teacher.tsx` como en `Index.tsx`
- **Funcionalidades**:
  - Calendario mensual con selección de MÚLTIPLES días
  - Selector de categoría POR DÍA (cada día puede tener diferente categoría)
  - Selector de CANTIDAD por categoría (puede pedir 2x del mismo menú)
  - Bloqueo ESTRICTO de días pasados
  - Respeta hora límite de `lunch_configuration` (bloquea visualmente)
  - Carrito resumen con total antes de confirmar
  - Funciona para profesores Y padres (misma lógica)
  - Crea `lunch_order` + `transaction` con metadata completa (`lunch_order_id`, `source`, `order_date`, `menu_name`)

### 2. Fix del Gap en `BillingCollection.tsx`
- **fetchDebtors** ahora busca TAMBIÉN transacciones `paid` SIN metadata cuando hace matching por descripción
- Antes solo buscaba en `validTransactions` (pending); ahora combina pending + paid
- Esto cierra el gap donde viejas transacciones paid sin `metadata.lunch_order_id` generaban virtuales

### 3. Mejora del Display en Cobranzas
- Cada transacción individual ahora muestra:
  - Badge con fecha del pedido (📅 10 feb)
  - Badge con categoría del menú (Almuerzo Clásico)
  - Descripción y hora de registro más compacta
- El modal "Ver Detalles" muestra sección extra del metadata:
  - Fecha exacta del pedido
  - Categoría del menú
  - Origen del pedido (Calendario del Profesor, Administrador, etc.)

### 4. Integración
- `Teacher.tsx` → Usa `UnifiedLunchCalendar` en vez de `OrderLunchMenus`
- `Index.tsx` (padres) → Usa `UnifiedLunchCalendar` en vez de `OrderLunchMenus`

---

## 📁 ARCHIVOS MODIFICADOS EN v1.19.0

| Archivo | Cambio |
|---|---|
| `src/components/lunch/UnifiedLunchCalendar.tsx` | **NUEVO** - Componente unificado |
| `src/pages/Teacher.tsx` | Import cambió a UnifiedLunchCalendar |
| `src/pages/Index.tsx` | Import cambió a UnifiedLunchCalendar |
| `src/components/billing/BillingCollection.tsx` | Fix gap paid + mejor display |
| `package.json` | Versión 1.19.0 |

---

## 📋 TAREAS PENDIENTES

### 🔴 Prioridad 1: Limpieza de datos (SQL)
- Ejecutar `supabase/migrations/LIMPIEZA_INTEGRAL_TODAS_SEDES.sql` paso por paso
- PASOS 1-5: Solo diagnóstico
- PASOS 6-9: Limpieza (con backup)
- PASOS 10-11: Verificación

### 🟡 Prioridad 2: Testing post-deploy
1. Probar como profesor: seleccionar 3 días en calendario → confirmar → verificar que aparecen 3 transacciones separadas en Cobranzas
2. Cobrar una deuda → verificar que NO se duplica
3. Verificar que el detalle muestra fecha del pedido y categoría
4. Probar como padre: mismo flujo
5. Verificar hora límite: intentar pedir para un día pasado → debe estar bloqueado
6. Verificar cantidad múltiple: pedir 2x del mismo menú para un día

### 🟢 Prioridad 3: Verificación cruzada
- Verificar TODAS las sedes
- Confirmar con admins que no hay nuevos duplicados

---

## ⚠️ REGLAS IMPORTANTES

1. **NO toques el módulo POS/Punto de Venta** - Solo calendario de almuerzos y cobranzas
2. **`OrderLunchMenus.tsx` sigue existiendo** pero ya no se usa en Teacher ni Index. El `PhysicalOrderWizard.tsx` SÍ sigue activo para pedidos presenciales del admin/cajero
3. **El `TeacherLunchCalendar.tsx` viejo sigue existiendo** pero tampoco se usa ya
4. Las transacciones SIEMPRE deben crearse como `pending` y solo pasar a `paid` por el módulo de Cobranzas
5. El metadata SIEMPRE debe incluir: `lunch_order_id`, `source`, `order_date`, `menu_name`

---

## 🧪 SQL DE DEBUGGING RÁPIDO

```sql
-- Verificar que no hay nuevos duplicados (post-fix)
SELECT t.metadata->>'lunch_order_id', COUNT(*)
FROM transactions t
WHERE t.metadata->>'lunch_order_id' IS NOT NULL
GROUP BY t.metadata->>'lunch_order_id'
HAVING COUNT(*) > 1;

-- Ver transacciones de un profesor específico
SELECT t.id, t.created_at, t.description, t.payment_status, t.payment_method,
  t.metadata->>'order_date' as order_date,
  t.metadata->>'menu_name' as menu_category,
  t.metadata->>'source' as source
FROM transactions t
JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%nombre%'
ORDER BY t.created_at;

-- Verificar pedidos del calendario unificado
SELECT t.id, t.created_at, t.description, t.payment_status,
  t.metadata->>'source' as source
FROM transactions t
WHERE t.metadata->>'source' LIKE 'unified_calendar%'
ORDER BY t.created_at DESC
LIMIT 20;
```

---

**Fecha**: 12 de febrero, 2026
**Versión**: v1.19.0
**Creado por**: Claude Opus 4.6
**Para**: Siguiente sesión de Claude
**Usuario**: Alberto Naldos
