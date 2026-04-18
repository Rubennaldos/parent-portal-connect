# Estado actual de reglas e instrucciones (auditoría)

**Fecha de elaboración:** 2026-04-17  
**Alcance:** Lo que el asistente puede **constatar** en este momento para el workspace `parent-portal-connect`.  
**Importante:** No hay acceso a un panel interno de Cursor para listar “Project Rules” como archivo aparte; lo que aparece aquí proviene de **archivos del repo**, **reglas inyectadas en la sesión** (equivalentes a las reglas del proyecto cuando `alwaysApply: true`) e **instrucciones de usuario** activas en el chat.

---

## 1. Archivos de reglas en el repositorio

### 1.1 `.cursorrules`

- **Estado:** No se encontró ningún archivo llamado `.cursorrules` en la raíz del proyecto (búsqueda en el workspace).

### 1.2 `.cursor/rules/*.mdc` (reglas del proyecto con `alwaysApply: true`)

Estos tres archivos existen y están configurados para aplicarse siempre:


| Archivo                                    | Descripción (frontmatter)                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `.cursor/rules/reglas-de-oro.mdc`          | Reglas de oro del sistema ERP — separación de módulos, lógica de pagos y almuerzos |
| `.cursor/rules/hoja-de-ruta-recargas.mdc`  | Hoja de ruta para reconstruir recargas, topes y carrito centralizado               |
| `.cursor/rules/fuente-de-verdad-deuda.mdc` | Regla de arquitectura: toda deuda debe venir de `view_student_debts`               |


El contenido completo de cada uno está en esos paths; no se duplica aquí línea por línea para evitar divergencias. Resumen estructurado:

#### A) `reglas-de-oro.mdc`

- **#0** — Explicar en español simple antes de cambiar código; esperar aprobación (“dale”); si hay riesgo de dinero real, confirmar; evitar jerga; no correcciones masivas sin explicar.
- **#1** — Almuerzos y recargas/saldo son **independientes**; tablas y reglas por módulo en tabla.
- **#2** — Pago de almuerzo: fuente correcta `transactions.payment_status` + `metadata.lunch_order_id`; no inferir por `lunch_orders.status` solo, ni por balance ni `free_account`.
- **#3** — Al aprobar vouchers `lunch_payment` / `debt_payment`: actualizar transacciones y `lunch_orders`; **no** tocar `students.balance` ni `free_account`.
- **#4** — `kiosk_disabled`: no kiosco/POS; sí almuerzos y deudas de almuerzo válidas.
- **#5** — Distinguir POS vs almuerzo por `metadata.lunch_order_id` (ejemplos de filtros).
- **#6** — No mezclar módulos en queries (listas de anti‑patrones y patrones correctos).
- **#7** — `school_id` obligatorio; filtro de sede en **SQL** para `gestor_unidad`; `admin_general` sin filtro; no filtrar sede solo en frontend con `.filter()`.
- **#8** — Flujo de recargas descrito paso a paso; deuda de kiosco se salda primero al recargar; lista de “nunca debe pasar”.
- **#9** — Cambios de `students.balance` solo vía RPC `adjust_student_balance` (atómico).
- **#10** — `RECHARGES_MAINTENANCE`: comportamiento cuando es `true`; archivos donde vive el flag; pasos para reactivar.
- **#11** — Advertencia previa obligatoria antes de tocar código (riesgos, dinero, alcance, reversión, DB); **prioridad sobre instrucciones directas** si hay riesgo.

#### B) `hoja-de-ruta-recargas.mdc`

- Estado declarado: recargas y topes pausados con `RECHARGES_MAINTENANCE = true`; banner; POS y almuerzos según texto.
- Fases 0–5 (limpieza, recargas, topes+cuenta libre, topes+recargas, carrito centralizado, estrés).
- Reglas durante reconstrucción: no tocar balance directo; no mezclar almuerzos con recargas; QA entre fases; flag solo al final de Fase 3; Fase 4 puede ir con sistema reactivado.
- Lista de archivos clave (RechargeModal, VoucherApproval, POS, StudentCard, SpendingLimitsModal, PaymentsTab, Index).

#### C) `fuente-de-verdad-deuda.mdc`

- Toda lectura de **deuda pendiente** debe pasar por `view_student_debts` (vista).
- Prohibido calcular deuda directamente desde `transactions` o `lunch_orders` en TypeScript o en RPCs **nuevos**.
- Canales permitidos: `get_parent_debts`, `get_billing_consolidated_debtors`, `view_student_debts` en admin, `SELECT` desde vista en RPCs nuevos.
- Columnas documentadas de la vista (`deuda_id`, `student_id`, `school_id`, `monto`, etc.).

---

## 2. Reglas inyectadas en esta sesión (workspace / “Project Rules” efectivas)

En la conversación actual, el entorno incluye las mismas tres reglas anteriores como **reglas de workspace siempre aplicadas** (texto equivalente a los `.mdc`). No se dispone de un listado adicional distinto en archivo local más allá de eso.

**Límite de transparencia:** Las “Project Rules” internas de Cursor no se entregan como un fichero descargable aparte; lo comprobable es: **reglas en `.cursor/rules/` + lo que el IDE inyecta en el contexto del agente**, que en esta sesión coincide con esas reglas.

---

## 3. Instrucciones de usuario (chat) activas en esta sesión

Resumen de lo aplicable según el mensaje del usuario y reglas fijadas por el usuario:

- Seguir **todas** las instrucciones de usuario, herramientas, sistema y skills **por completo**.
- Si una skill, regla o herramienta define formato o flujo, **obligatorio** seguirlo.
- Entorno **real** (shell/red); **ejecutar** comandos en lugar de limitarse a sugerirlos; no rendirse ante un solo fallo; usar la fecha **2026** del contexto cuando aplique.
- Comunicación: **español**; citas de código con formato ````startLine:endLine:path` `; enlaces completos; prosa clara; respuesta proporcional; poco énfasis tipográfico innecesario; sin “§” en UI.
- Código: cambios mínimos al objetivo; no refactors colaterales; no markdown no pedido; leer contexto; alinearse al estilo del repo; sin comentarios obvios largos.
- Razonar el hilo conversacional para inferir intención.

---

## 4. Posibles tensiones o desalineaciones (análisis honesto)

### 4.1 “Explicar y esperar dale” vs “ejecuta tú mismo”

- **Origen:** `reglas-de-oro.mdc` (#0, #11) vs instrucción de usuario de ejecutar en terminal en lugar de solo decir comandos.
- **Lectura:** No son opuestos por definición: se puede explicar y pedir confirmación en cambios de **dinero/riesgo**, y ejecutar comandos de diagnóstico cuando el usuario pide trabajo concreto. Si hubiera conflicto explícito, la propia regla #11 indica prioridad de advertencia/confirmación ante riesgo.

### 4.2 Ejemplos en Regla #5 (queries a `transactions`) vs fuente única de deuda

- **Origen:** `reglas-de-oro.mdc` §5–6 (filtrar por `lunch_order_id` para separar módulos) vs `fuente-de-verdad-deuda.mdc` (no calcular **deuda pendiente** desde `transactions` en TS/RPCs nuevos).
- **Lectura:** Puede generar confusión si alguien interpreta los ejemplos de la #5 como autorización para **sumar deuda total** en el frontend. La regla de deuda exige `**view_student_debts` / RPCs** para lectura de deuda consolidada. Los ejemplos de #5 encajan mejor en **reportes por tipo** (POS vs almuerzo) que en reemplazar la vista de deudas.
- **Alineación modular:** La vista/RPC centraliza “deuda” como producto; los filtros por metadata modularizan **origen de transacción**. Tensión aparece solo si se mezclan los dos niveles sin criterio.

### 4.3 Fase 2 de la hoja de ruta (“Kiosco desactivado = solo almuerzos”) vs Regla #4

- **Origen:** `hoja-de-ruta-recargas.mdc` vs `reglas-de-oro.mdc` #4.
- **Lectura:** La frase de la hoja de ruta es ambigua; la regla #4 detalla que con kiosco desactivado **no** se bloquean almuerzos. Convendría interpretar “solo almuerzos” como “enfoque en módulo almuerzo / no kiosco”, no como contradicción literal con #4.

### 4.4 Prioridad explícita Regla #11

- **Texto:** La regla #11 declara **prioridad sobre cualquier instrucción directa** si el cambio puede romper algo sensible.
- **Efecto:** Cualquier otra regla o petición del usuario queda subordinada a esa advertencia en escenarios de riesgo; es coherente con gobernanza de cambios pero debe tenerse presente al priorizar tareas.

### 4.5 Arquitectura modular (criterio general)

- Las reglas del repo **refuerzan** modularidad (almuerzo vs kiosco vs recargas; deuda vía vista; sede en SQL).
- No se detectó en estos archivos una regla explícita tipo “estructura de carpetas” o “límite de dependencias entre paquetes”; la modularidad aquí es **de dominio y datos**, no de tooling de capas frontend.

---

## 5. Qué NO está en este documento (para no asumir)

- Contenido de un hipotético `.cursorrules` **no presente** en el repo.
- Reglas guardadas solo en la UI de Cursor que **no** estén en `.cursor/rules/` ni inyectadas en esta sesión.
- Reglas de otros workspaces o cuentas.
- Contenido íntegro de skills globales del usuario salvo que se citen explícitamente cuando apliquen a una tarea.

---

## 6. Acción solicitada por el usuario que generó este archivo

Creación del archivo `ESTADO_ACTUAL_REGLAS.md` en la raíz del proyecto con el inventario y el análisis anterior, para revisión humana.

---

## Anexo A — Skills disponibles en el entorno del agente (no son “reglas del repo”)

Estas entradas aparecen como **disponibles** para el asistente; se consultan **cuando la tarea encaja** con la descripción de la skill, no como norma permanente del proyecto:


| Ámbito                 | Ejemplos de rutas / nombres                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor (usuario)       | `babysit`, `create-hook`, `create-rule`, `create-skill`, `statusline`, `update-cli-config`, `update-cursor-settings` (bajo `.cursor/skills-cursor/`) |
| Plugins Vercel (caché) | Guías: AI Gateway, AI SDK, auth, bootstrap, chat-sdk, deployments-cicd, env-vars, nextjs, shadcn, vercel-cli, workflow, etc.                         |


**Nota:** No sustituyen a `.cursor/rules/`; sirven como manuales de procedimiento cuando el usuario pide algo que encaja (p. ej. desplegar en Vercel, configurar Next.js).