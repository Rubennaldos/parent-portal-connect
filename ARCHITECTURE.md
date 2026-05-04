# ARCHITECTURE MAP — parent-portal-connect

Actualizado: 2026-04-23  
Fuente: estructura real del repo (frontend + supabase)

## 1) Regla operativa de mantenimiento

Desde este punto, cada vez que se cree una carpeta nueva de dominio, este archivo se debe actualizar en el mismo cambio (mismo commit/PR) con:
- ruta nueva
- dominio funcional al que pertenece
- motivo breve de su existencia

## 2) Estado actual (foto real)

Hoy el proyecto esta organizado principalmente en:
- `src/pages/` (pantallas)
- `src/components/` (UI y modulos funcionales)
- `src/hooks/` (orquestacion y estado)
- `src/services/` (acceso a datos y servicios)
- `src/lib/` (utilitarios transversales)
- `supabase/functions/` (edge functions)
- `supabase/migrations/` (logica y estructura SQL)

Nota: aun no existe una migracion completa a `src/features/[modulo]/` en todo el repo; conviven modulos por carpeta funcional bajo `src/components`.

---

## 3) Mapa por dominio

## NFC

### Frontend (UI/App)
- `src/components/admin/NFCCardsManager.tsx`
- `src/pages/SchoolAdmin.tsx` (pantalla que integra administracion escolar y tarjetas)

### Base de datos / SQL (historico y soporte)
- `supabase/migrations/20260305_create_nfc_cards.sql`
- `supabase/migrations/20260305_fix_nfc_cards_rls.sql`
- `supabase/migrations/20260305_fix_get_nfc_holder.sql`

### Estado del modulo
- Dominio identificado y activo.
- Dependencias fuertes con alumnos y control de acceso.

---

## Pagos

### Frontend (UI/App)
- `src/pages/Cobranzas.tsx`
- `src/pages/Facturacion.tsx`
- `src/pages/PaymentStats.tsx`
- `src/pages/IziPayTest.tsx`
- `src/components/parent/PaymentsTab.tsx`
- `src/components/parent/PaymentHistoryTab.tsx`
- `src/components/parent/RechargeModal.tsx`
- `src/components/parent/IziPayEmbeddedForm.tsx`
- `src/components/parent/GatewayPaymentWaiting.tsx`
- `src/components/billing/` (dashboard, aprobacion voucher, reportes, historial, periodos, etc.)

### Servicios frontend
- `src/services/paymentService.ts`
- `src/services/voucherUploadService.ts`
- `src/hooks/useRechargeSubmit.ts`

### Backend (Supabase Functions)
- `supabase/functions/izipay-create-order/index.ts`
- `supabase/functions/izipay-webhook/index.ts`
- `supabase/functions/analizar-voucher/index.ts`
- `supabase/functions/auto-billing/index.ts`
- `supabase/functions/process-billing-queue/index.ts`
- `supabase/functions/check-invoice-status/index.ts`
- `supabase/functions/generate-document/index.ts`
- `supabase/functions/consult-document/index.ts`

### Base de datos / SQL (alta actividad)
- `supabase/migrations/` con foco en: billing, voucher, izipay, debt, collection, payment sessions.
- Ejemplos recientes: `20260423_*`, `20260421_*`, `20260420_*`, `20260419_*`.

### Estado del modulo
- Es el dominio mas grande y critico.
- Debe seguir reglas SSOT/idempotencia/atomicidad como prioridad maxima.

---

## Alumnos

### Frontend (UI/App)
- `src/components/admin/StudentsManagement.tsx`
- `src/components/admin/StudentsDirectory.tsx`
- `src/components/parent/StudentCard.tsx`
- `src/components/parent/EditStudentModal.tsx`
- `src/components/parent/StudentLinksManager.tsx`
- `src/components/AddStudentModal.tsx`
- `src/hooks/useStudentBalance.ts`

### Base de datos / SQL
- Dominio transversal en migraciones de saldo, deudas y seguridad.
- SSOT financiero actual: `alumnos.saldo_actual` (regla de oro).

### Estado del modulo
- Dominio central, compartido por padres, admin y facturacion.
- Se cruza con NFC, Pedidos y Pagos.

---

## Pedidos

### Frontend (UI/App)
- `src/pages/LunchOrders.tsx`
- `src/pages/Comedor.tsx`
- `src/pages/LunchCalendar.tsx`
- `src/components/lunch/OrderLunchMenus.tsx`
- `src/components/lunch/LunchOrderActionsModal.tsx`
- `src/components/lunch/PhysicalOrderWizard.tsx`
- `src/components/lunch/DeliverWithoutOrderModal.tsx`
- `src/components/lunch/UnifiedLunchCalendar.tsx`
- `src/components/lunch/UnifiedLunchCalendarV2.tsx`
- `src/components/parent/ParentLunchOrders.tsx`
- `src/components/parent/LunchOrderCalendar.tsx`

### Base de datos / SQL
- `supabase/migrations/` con foco en lunch orders, cancelaciones, guardas y deuda asociada.
- Ejemplos: `*cancel_lunch_order*`, `*lunch_debt*`, `*lunch_orders*`.

### Estado del modulo
- Dominio acoplado a inventario/logistica y a pagos de kiosco/comedor.
- Requiere consistencia temporal (America/Lima) y bloqueo backend first.

---

## 4) Mapeo objetivo recomendado (sin mover nada aun)

Para alinearse a la regla de dominio, objetivo gradual:
- `src/features/nfc/`
- `src/features/pagos/`
- `src/features/alumnos/`
- `src/features/pedidos/`

Estructura interna por modulo:
- `components/`
- `hooks/`
- `services/`

No aplica esta regla a:
- `supabase/`
- `scripts/`
- `docs/`
- archivos de configuracion global

---

## 5) Protocolo de actualizacion de este mapa

Actualizar `ARCHITECTURE.md` cuando ocurra cualquiera de estos eventos:
- creacion de carpeta nueva en `src/features` o `src/components` de dominio
- nuevo subdominio funcional (ej. antifraude pagos, conciliacion, NFC emit)
- nueva edge function en `supabase/functions`
- migraciones que creen tablas/triggers nucleares de un dominio

Checklist minimo de actualizacion:
1. agregar ruta
2. asignar dominio (NFC/Pagos/Alumnos/Pedidos u otro)
3. marcar impacto (UI, Servicio, Function, SQL)
4. registrar fecha de actualizacion arriba

