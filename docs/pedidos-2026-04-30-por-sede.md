# Pedidos de almuerzo por sede — 2026-04-30

**Fecha de servicio (menú):** `lunch_menus.date = 2026-04-30`  
**Métrica:** `COUNT(lunch_orders.id)` sin filtrar categoría, cancelados, método ni origen (admin/padre).

**Origen del dato:** misma instantánea tipo **rescate / backup** que uses para el 29. En **producción** los números pueden diferir.

**Lógica detallada (última TX, activos, UUID, etc.):** está en [pedidos-2026-04-29-por-sede.md](./pedidos-2026-04-29-por-sede.md). Para el **30**, en el SQL Editor **reemplazá** `DATE '2026-04-29'` por `DATE '2026-04-30'` en cada bloque (resumen cobro, activos vs anulados, detalle, solo UUID) y exportá con nombre acorde, p. ej. `mc2_uuids_2026-04-30.csv`.

---

## Total (instantánea rescate — corrida documentada)

| Métrica | Valor |
|---------|------:|
| **Pedidos totales (todas las sedes)** | **58** |

## Por sede (misma corrida)

En **esta** instantánea el `GROUP BY` solo devolvió **dos** sedes con menú/pedidos el **2026-04-30** (el **29 abr** en el mismo doc figuraban cinco sedes y **218** pedidos). Otras sedes pueden no tener `lunch_menus` del 30 en la copia o no haber tenido pedidos enlazados.

| school_id | sede | pedidos_30_abr |
|-----------|------|---------------:|
| `ba6219dd-05ce-43a4-b91b-47ca94744f97` | Nordic | 32 |
| `9963c14c-22ff-4fcb-b5cc-599596896daa` | Maristas Champagnat 1 | 26 |

**Suma por filas:** 32 + 26 = **58** ✓

## Resumen cobro (30 abr — última TX por pedido, solo activos)

| school_id | sede | tx_pagado | tx_pendiente | sin_transaccion | total_activos |
|-----------|------|----------:|-------------:|----------------:|--------------:|
| `ba6219dd-05ce-43a4-b91b-47ca94744f97` | Nordic | 27 | 3 | 0 | 30 |
| `9963c14c-22ff-4fcb-b5cc-599596896daa` | Maristas Champagnat 1 | 23 | 3 | 0 | 26 |

## Activos vs anulados (30 abr)

| school_id | sede | pedidos_activos | pedidos_anulados | total_filas |
|-----------|------|----------------:|-----------------:|------------:|
| `ba6219dd-05ce-43a4-b91b-47ca94744f97` | Nordic | 30 | 2 | 32 |
| `9963c14c-22ff-4fcb-b5cc-599596896daa` | Maristas Champagnat 1 | 26 | 0 | 26 |

### Verificación `COUNT(*)` — solo activos (misma fecha + `school_id`)

Coincide con **`total_activos`** del resumen cobro y con **`pedidos_activos`** de la tabla anterior.

| sede | cnt |
|------|----:|
| Maristas Champagnat 1 | 26 |
| Nordic | 30 |

```sql
-- MC1
SELECT COUNT(*) AS cnt
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';

-- Nordic
SELECT COUNT(*) AS cnt
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';
```

**Verificación cruzada (Nordic, 30 activos):** agregación por `payment_status` de la **última** transacción `purchase` por pedido da **27** `paid` + **3** `pending` (= **30**), alineado con la tabla «Resumen cobro» de arriba. Con eso alcanza para auditar cobro a nivel pedido **sin** exportar detalle con PII.

## SQL usado (30 abr)

```sql
-- Por sede
SELECT
  lm.school_id,
  s.name AS sede,
  COUNT(lo.id) AS pedidos_30_abr
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.schools s ON s.id = lm.school_id
WHERE lm.date = DATE '2026-04-30'
GROUP BY lm.school_id, s.name
ORDER BY pedidos_30_abr DESC, s.name NULLS LAST;

-- Total
SELECT COUNT(lo.id) AS pedidos_30_abr_total
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-30';
```

### Resumen cobro — todas las sedes a la vez (solo pedidos activos, 30 abr)

Misma lógica de última transacción `purchase` que en el doc del **29**.

```sql
SELECT
  lm.school_id,
  s.name AS sede,
  COUNT(*) FILTER (WHERE t.payment_status = 'paid') AS tx_pagado,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending') AS tx_pendiente,
  COUNT(*) FILTER (WHERE t.id IS NULL) AS sin_transaccion,
  COUNT(*) AS total_activos
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.schools s ON s.id = lm.school_id
LEFT JOIN LATERAL (
  SELECT tr.id, tr.payment_status
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-30'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
GROUP BY lm.school_id, s.name
ORDER BY total_activos DESC NULLS LAST, s.name NULLS LAST;
```

### Activos vs anulados — todas las sedes (30 abr)

```sql
SELECT
  lm.school_id,
  s.name AS sede,
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) = false AND lo.status IS DISTINCT FROM 'cancelled'
  ) AS pedidos_activos,
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) OR lo.status = 'cancelled'
  ) AS pedidos_anulados,
  COUNT(*) AS total_filas
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.schools s ON s.id = lm.school_id
WHERE lm.date = DATE '2026-04-30'
GROUP BY lm.school_id, s.name
ORDER BY total_filas DESC NULLS LAST, s.name NULLS LAST;
```

## Sedes sin pedidos el 30 (en esta copia)

Tras correr el `GROUP BY`, las sedes que **no** aparezcan no tuvieron `lunch_orders` enlazados a un menú con `lm.date = 2026-04-30` en esa instantánea (no implica ausencia en operación real).

## Detalle fila a fila (30 abr)

Misma lógica que el doc del **29** (última `purchase` no borrada por `lunch_order_id` en `metadata`). **Exportá CSV local** si necesitás nombres/correos; no pegues dumps en el repo.

### Nordic — solo activos

```sql
SELECT
  lo.id AS lunch_order_id,
  lo.order_date,
  lo.status AS estado_pedido,
  CASE
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    ELSE 'manual'
  END AS tipo,
  st.id AS alumno_id,
  st.full_name AS alumno_nombre,
  st.balance AS saldo_alumno,
  st.parent_id AS padre_profile_id,
  COALESCE(pp.full_name, pr.full_name) AS padre_nombre,
  pr.email AS padre_email,
  tp.id AS profesor_id,
  tp.full_name AS profesor_nombre,
  lo.manual_name,
  lo.final_price AS precio_pedido,
  t.id AS transaction_id,
  t.payment_status AS estado_pago,
  t.amount AS monto_tx,
  t.ticket_code
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.students st ON st.id = lo.student_id
LEFT JOIN public.parent_profiles pp ON pp.user_id = st.parent_id
LEFT JOIN public.profiles pr ON pr.id = st.parent_id
LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
LEFT JOIN LATERAL (
  SELECT tr.*
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

### Nordic — todos los pedidos del menú (incluye anulados; para ver los 32)

```sql
SELECT
  lo.id AS lunch_order_id,
  lo.order_date,
  lo.status AS estado_pedido,
  COALESCE(lo.is_cancelled, false) AS is_cancelled,
  CASE
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    ELSE 'manual'
  END AS tipo,
  st.id AS alumno_id,
  st.full_name AS alumno_nombre,
  st.balance AS saldo_alumno,
  st.parent_id AS padre_profile_id,
  COALESCE(pp.full_name, pr.full_name) AS padre_nombre,
  pr.email AS padre_email,
  tp.id AS profesor_id,
  tp.full_name AS profesor_nombre,
  lo.manual_name,
  lo.final_price AS precio_pedido,
  t.id AS transaction_id,
  t.payment_status AS estado_pago,
  t.amount AS monto_tx,
  t.ticket_code
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.students st ON st.id = lo.student_id
LEFT JOIN public.parent_profiles pp ON pp.user_id = st.parent_id
LEFT JOIN public.profiles pr ON pr.id = st.parent_id
LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
LEFT JOIN LATERAL (
  SELECT tr.*
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
ORDER BY COALESCE(lo.is_cancelled, false) DESC, lo.status, tipo, lo.created_at;
```

### Maristas Champagnat 1 (MC1) — solo activos

```sql
SELECT
  lo.id AS lunch_order_id,
  lo.order_date,
  lo.status AS estado_pedido,
  CASE
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    ELSE 'manual'
  END AS tipo,
  st.id AS alumno_id,
  st.full_name AS alumno_nombre,
  st.balance AS saldo_alumno,
  st.parent_id AS padre_profile_id,
  COALESCE(pp.full_name, pr.full_name) AS padre_nombre,
  pr.email AS padre_email,
  tp.id AS profesor_id,
  tp.full_name AS profesor_nombre,
  lo.manual_name,
  lo.final_price AS precio_pedido,
  t.id AS transaction_id,
  t.payment_status AS estado_pago,
  t.amount AS monto_tx,
  t.ticket_code
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.students st ON st.id = lo.student_id
LEFT JOIN public.parent_profiles pp ON pp.user_id = st.parent_id
LEFT JOIN public.profiles pr ON pr.id = st.parent_id
LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
LEFT JOIN LATERAL (
  SELECT tr.*
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

### Nordic + MC1 — solo activos (una sola grilla)

```sql
SELECT
  lm.school_id,
  s.name AS sede,
  lo.id AS lunch_order_id,
  lo.order_date,
  lo.status AS estado_pedido,
  CASE
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    ELSE 'manual'
  END AS tipo,
  st.full_name AS alumno_nombre,
  COALESCE(pp.full_name, pr.full_name) AS padre_nombre,
  pr.email AS padre_email,
  tp.full_name AS profesor_nombre,
  lo.manual_name,
  lo.final_price AS precio_pedido,
  t.payment_status AS estado_pago,
  t.ticket_code
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.schools s ON s.id = lm.school_id
LEFT JOIN public.students st ON st.id = lo.student_id
LEFT JOIN public.parent_profiles pp ON pp.user_id = st.parent_id
LEFT JOIN public.profiles pr ON pr.id = st.parent_id
LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
LEFT JOIN LATERAL (
  SELECT tr.*
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id IN (
    'ba6219dd-05ce-43a4-b91b-47ca94744f97',
    '9963c14c-22ff-4fcb-b5cc-599596896daa'
  )
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY sede, tipo, alumno_nombre NULLS LAST, lo.created_at;
```

## Cifras por sede — 30 abr (opcional, mismo criterio que el 29)

Para cada sede del doc del **29** (MC2, MC1, JLB, Nordic, St. George's Miraflores), ejecutá en la copia de rescate:

1. **Resumen cobro** (última `purchase` no borrada, `metadata->>'lunch_order_id'`).
2. **Activos vs anulados** (mismos filtros `is_cancelled` / `status`).
3. Export **solo UUID** para cruzar con el **29** (`lunch_order_id`).

No pegues en este repo tablas con **nombres ni correos**. **Sí podés** versionar **solo UUID** (ver apéndice abajo) para no repetir trabajo al comparar con el **29**.

## Comparar 29 vs 30

- Par de CSV por sede: `*_uuids_2026-04-29.csv` y `*_uuids_2026-04-30.csv`.  
- Clave: **`lunch_order_id`**.  
- Guía adicional: sección **### 9) Comparar dos CSV** y **Apéndice IDs** en [pedidos-2026-04-29-por-sede.md](./pedidos-2026-04-29-por-sede.md).

---

## Apéndice: IDs para cruzar padre / hijo / pedido (2026-04-30)

**En este archivo:** UUID (`lunch_order_id`, `student_id`, `padre_profile_id`, `menu_id`, `school_id`, `transaction_id`, `tipo`). **No** nombres ni emails.

### Una sola query — MC1 + Nordic (30 abr, solo activos)

En esta instantánea solo hubo pedidos del 30 en estas dos sedes; si tu backup trae más `school_id`, agregalos al `IN (...)`.

```sql
SELECT
  lm.school_id,
  lo.id AS lunch_order_id,
  lm.id AS menu_id,
  lo.student_id,
  lo.teacher_id,
  st.parent_id AS padre_profile_id,
  t.id AS transaction_id,
  CASE
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    ELSE 'manual'
  END AS tipo
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.students st ON st.id = lo.student_id
LEFT JOIN LATERAL (
  SELECT tr.id
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-30'
  AND lm.school_id IN (
    '9963c14c-22ff-4fcb-b5cc-599596896daa', -- MC1
    'ba6219dd-05ce-43a4-b91b-47ca94744f97'  -- Nordic
  )
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY lm.school_id, tipo, lunch_order_id;
```

### Plantillas (pegá filas UUID si querés versionarlas en git)

#### MC1 (`9963c14c-22ff-4fcb-b5cc-599596896daa`)

| lunch_order_id | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
|----------------|---------|------------|------------|-------------------|----------------|------|
| *(pegar o CSV)* | | | | | | |

#### Nordic (`ba6219dd-05ce-43a4-b91b-47ca94744f97`)

| lunch_order_id | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
|----------------|---------|------------|------------|-------------------|----------------|------|
| *(pegar o CSV)* | | | | | | |
