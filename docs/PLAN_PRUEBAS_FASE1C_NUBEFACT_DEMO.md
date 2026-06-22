# FASE 1C — Plan de pruebas en Nubefact DEMO (cola asíncrona de facturación)

> Objetivo: demostrar, **antes de producción**, que el nuevo flujo NUNCA quema un
> correlativo, NUNCA duplica una boleta y reintenta de forma segura ante fallas.
> Todo se prueba contra el **ambiente DEMO de Nubefact** y un proyecto Supabase
> de **Preview/staging** — nunca contra producción.

---

## 0. Pre-requisitos (en este orden)

1. **Aplicar migraciones (Preview/staging primero):**
   - `20260621_fase1a_billing_emission_jobs_foundation.sql` (columnas + estados).
   - `20260621_fase1b_reserve_invoice_number_for_queue.sql` (RPC de reserva).
   - Verificar que ambas terminaron sin error:
     ```sql
     SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.billing_queue'::regclass AND contype='c';
     SELECT proname FROM pg_proc WHERE proname='reserve_invoice_number_for_queue';
     ```
2. **Desplegar Edge Functions modificadas al proyecto demo/preview:**
   - `generate-document` (soporta `reserved_numero` + ya no salta números reservados).
   - `process-billing-queue` (worker v2 con reserva + clasificación de errores).
3. **Confirmar credenciales DEMO en Vault** (`nubefact_ruta`, token) apuntando a
   `https://api.nubefact.com/api/v1/...` **del ambiente de pruebas**, no producción.
4. **Anotar el correlativo actual** de la serie de prueba antes de empezar:
   ```sql
   SELECT serie, ultimo_numero FROM invoice_sequences
   WHERE school_id = '<SCHOOL_ID_DEMO>' ORDER BY serie;
   ```
   Guarda este valor: es tu “línea base” para verificar que NO hay saltos.

> ⚠️ Regla 0.A: NO se toca izipay-webhook, HMAC, ni apply_gateway_credit. El worker
> sigue procesando filas legacy de Izipay con su camino actual (`fn_build_billing_payload`).

---

## 1. Consultas de verificación (se reutilizan en cada caso)

```sql
-- Estado de una fila de cola
SELECT id, status, emit_attempts, reserved_serie, reserved_numero, reserved_at,
       invoice_id, error_message, fatal_reason
FROM   billing_queue WHERE id = '<QUEUE_ID>';

-- ¿Se creó el comprobante? (idempotencia local)
SELECT id, serie, numero, sunat_status, total
FROM   invoices
WHERE  school_id='<SCHOOL_ID_DEMO>' AND serie='<SERIE>' AND numero=<NUMERO>;

-- ¿Hay HUECOS en la secuencia? (la prueba reina)
SELECT serie, numero,
       numero - LAG(numero) OVER (PARTITION BY serie ORDER BY numero) AS salto
FROM   invoices WHERE school_id='<SCHOOL_ID_DEMO>'
ORDER  BY serie, numero;
-- salto > 1 en cualquier fila = HUECO = falla la prueba.
```

---

## 2. Casos de prueba

### T1 — Éxito normal (happy path)
- **Setup:** insertar una fila `pending` en `billing_queue` con un voucher/tx demo real.
- **Acción:** invocar el worker (`process-billing-queue`) con ese `queue_id`.
- **Esperado:**
  - `billing_queue.status='emitted'`, `reserved_numero` = el número que muestra Nubefact.
  - `invoices` tiene la fila con ese `serie-numero`.
  - `transactions.billing_status='sent'`.
  - La secuencia avanzó exactamente **+1**.

### T2 — Timeout / caída de red durante el envío (TRANSITORIO)
- **Setup:** apuntar temporalmente `nubefact_ruta` a una URL que no responde (o cortar
  red del proyecto demo) para forzar el `catch (netErr)` del worker.
- **Acción:** correr el worker. Luego restaurar la URL correcta y correr de nuevo.
- **Esperado:**
  - 1er intento: `status` vuelve a `pending`, `reserved_numero` **se conserva**,
    `error_message` empieza con `NETWORK:`.
  - 2do intento: usa **el MISMO** `reserved_numero` (no pide otro) → emite.
  - Secuencia avanzó **+1 en total** (no +2). **Cero huecos.**

### T3 — Worker “zombie” (muere en processing)
- **Setup:** forzar manualmente el estado intermedio:
  ```sql
  UPDATE billing_queue
  SET status='processing',
      processing_started_at = now() - interval '20 minutes',
      reserved_serie='<SERIE>', reserved_numero=<N>, reserved_at=now()
  WHERE id='<QUEUE_ID>';
  ```
- **Acción:** invocar `fn_reset_billing_queue_zombies(10)` (o dejar que el worker lo
  llame), luego correr el worker.
- **Esperado:**
  - El zombie vuelve a `pending` **conservando `reserved_numero`** (la función
    anti-zombie NO borra reserved_*).
  - El reintento reutiliza ese número → emite. Secuencia **+1**, sin huecos.

### T4 — Nubefact dice “ya existe” y el invoice SÍ está local (idempotente)
- **Setup:** ejecutar T1 (emitir B001-N). Luego, sin tocar `invoices`, regresar la fila
  a pending conservando el número:
  ```sql
  UPDATE billing_queue
  SET status='pending', processing_started_at=NULL
  WHERE id='<QUEUE_ID>';   -- reserved_numero SIGUE seteado
  ```
- **Acción:** correr el worker.
- **Esperado:**
  - El **pre-check** detecta el invoice existente → marca `emitted` **sin llamar a
    Nubefact**. (`reused` idempotente.) Secuencia NO avanza. Cero huecos, cero duplicado.

### T5 — Nubefact dice “ya existe” pero NO hay invoice local (reconciliación)
- **Setup:** emitir un número directamente en el panel Nubefact DEMO (o vía una llamada
  manual) para “ocupar” un número. Crear una fila de cola y reservar **ese mismo número**:
  ```sql
  UPDATE billing_queue SET reserved_serie='<SERIE>', reserved_numero=<N_OCUPADO>,
         reserved_at=now() WHERE id='<QUEUE_ID>';
  ```
- **Acción:** correr el worker.
- **Esperado:**
  - `generate-document` responde `duplicate:true` (NO salta a otro número).
  - El worker no encuentra invoice local → `status='failed'`, `error_message` empieza con
    `DUPLICATE_RESERVED: ... Reconciliar manualmente`. Número **conservado**, sin hueco.

### T6 — Nubefact responde HTTP 5xx (TRANSITORIO)
- **Setup:** simular 5xx (mock temporal de `nubefact_ruta` que devuelva 500/503).
- **Acción:** correr el worker; luego restaurar y correr de nuevo.
- **Esperado:** 1er intento `pending` con `HTTP_5XX:` y número conservado; 2do intento
  emite con el MISMO número. **+1**, sin huecos.

### T7 — Rechazo de CONTENIDO (datos inválidos / IGV) → failed → dead_letter
- **Setup:** crear una fila con un dato inválido a propósito (p.ej. RUC mal formado en
  el cliente del payload de prueba) para que Nubefact rechace por contenido (no 5xx).
- **Acción:** correr el worker **4 veces** seguidas.
- **Esperado:**
  - Intentos 1–3: `status='failed'`, `error_message` con `NUBEFACT_ERROR:`.
  - Intento ≥4 (emit_attempts ≥ 3): `status='dead_letter'`, `fatal_reason` seteado.
  - El número reservado se conserva; NO se salta ni se emite mal.

### T8 — Documento extemporáneo (fecha/periodo rechazado por SUNAT)
- **Setup:** forzar `emission_date` antiguo (o un caso que Nubefact DEMO rechace por
  fecha/periodo) — recordar que el worker recalcula la fecha en hora Lima.
- **Esperado:** `status='blocked_extemporaneo'`, `fatal_reason` con el detalle. Estado
  permanente para gestión manual del contador. Sin hueco.

### T9 — Concurrencia (dos invocaciones del worker a la vez)
- **Setup:** una sola fila `pending`. Disparar el worker **dos veces casi simultáneas**.
- **Esperado:** gracias a `FOR UPDATE SKIP LOCKED` (en `fn_build_billing_payload`) y al
  `FOR UPDATE` de la RPC de reserva, solo UNA invocación procesa; la otra hace `skip`.
  Un solo número consumido, un solo invoice.

---

## 3. Criterio de aprobación (TODOS deben cumplirse)

- [ ] T1–T9 ejecutados en DEMO sin un solo **hueco** (consulta de saltos = todo `1`).
- [ ] Ningún caso produjo **dos invoices** para el mismo trabajo (sin duplicados).
- [ ] Los transitorios (T2, T3, T6) **reutilizaron** el mismo `reserved_numero`.
- [ ] Los permanentes (T7, T8) quedaron en `dead_letter` / `blocked_extemporaneo`,
      nunca en bucle infinito de reintentos.
- [ ] `transactions.billing_status` quedó `sent` solo cuando hubo invoice real.

## 4. Limpieza post-prueba

```sql
-- Solo en DEMO/staging. NUNCA en producción.
DELETE FROM billing_queue WHERE school_id='<SCHOOL_ID_DEMO>' AND created_at::date = CURRENT_DATE;
-- invoices de prueba se dejan para reconciliar con el panel Nubefact DEMO.
```

## 5. Gate hacia producción
Solo tras aprobar TODOS los casos y completar la **Fase 1E** (reconciliación de
`invoice_sequences` vs panel Nubefact con la contadora), se habilita el cron del worker
en producción. Antes de eso, producción sigue con el flujo actual.
