# Pedidos de almuerzo por sede — 2026-04-29

**Fecha de servicio (menú):** `lunch_menus.date = 2026-04-29`  
**Métrica:** `COUNT(lunch_orders.id)` sin filtrar categoría, cancelados, método ni origen (admin/padre).

**Origen del dato:** instantánea de base de datos tipo **rescate / backup** (totales coherentes con ~218 pedidos del 29 en esa copia). Si ejecutas el mismo SQL en **producción**, los números serán distintos tras el incidente.

**Día siguiente (30 abr):** consultas globales, tabla por sede vacía para pegar resultados y enlace a la misma lógica por sede en [pedidos-2026-04-30-por-sede.md](./pedidos-2026-04-30-por-sede.md).

## Total


| Métrica                               | Valor   |
| ------------------------------------- | ------- |
| **Pedidos totales (todas las sedes)** | **218** |


## Por sede


| school_id                              | sede                    | pedidos_29_abr |
| -------------------------------------- | ----------------------- | -------------- |
| `7d6ca0e8-f68c-422e-89e8-35a21d673185` | Maristas Champagnat 2   | 93             |
| `9963c14c-22ff-4fcb-b5cc-599596896daa` | Maristas Champagnat 1   | 44             |
| `8a0dbd73-0571-4db1-af5c-65f4948c4c98` | Jean LeBouch            | 41             |
| `ba6219dd-05ce-43a4-b91b-47ca94744f97` | Nordic                  | 38             |
| `2a50533d-7fc1-4096-80a7-e20a41bda5a0` | St. George's Miraflores | 2              |


**Suma por filas:** 93 + 44 + 41 + 38 + 2 = **218** ✓

## Sedes sin pedidos en esta instantánea (29 abr)

En esta consulta **no aparecen** filas para, entre otras:

- **St. George's Villa** (`697243fe-f2d2-4fb4-a277-d43cb62ae861`)
- **Little St. George's** (`14eafb90-824b-4498-b0dd-1e9d0fe26795`)

Eso indica que en **esta copia de la BD** no había `lunch_menus` del 2026-04-29 para esas sedes (o no había pedidos enlazados), no necesariamente que “nunca pidieron” en la operación real del día completo.

## SQL usado

```sql
-- Por sede
SELECT
  lm.school_id,
  s.name AS sede,
  COUNT(lo.id) AS pedidos_29_abr
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN public.schools s ON s.id = lm.school_id
WHERE lm.date = DATE '2026-04-29'
GROUP BY lm.school_id, s.name
ORDER BY pedidos_29_abr DESC, s.name NULLS LAST;

-- Total
SELECT COUNT(lo.id) AS pedidos_29_abr_total
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-29';
```

---

## Menús del día (detalle) — 2026-04-29

Fuente: `public.lunch_menus` (campos `starter`, `main_course`, `beverage`, `dessert`, `notes`) + `lunch_categories.name`.

### Jean LeBouch (`8a0dbd73-0571-4db1-af5c-65f4948c4c98`)

#### Alumnos (`target_type = students`)


| menu_id                                | categoría                         | entrada (starter) | plato principal (main_course)            | bebida (beverage) | postre (dessert)  | notas |
| -------------------------------------- | --------------------------------- | ----------------- | ---------------------------------------- | ----------------- | ----------------- | ----- |
| `35bb97d3-8f75-4bf3-88cb-989c2d8b95f9` | Menú alumno inicial               | Huevo al nido     | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estacion |       |
| `f3838d9c-9da7-49b5-8c0f-23fec80a39ce` | Menú alumno inicial               | Huevo al nido     | Pollo chijaukay con arroz blanco         | Refresco del día  | Fruta de estación |       |
| `cdfb72d3-bccf-4e3b-a8fd-d3dd4899dc46` | Menú alumno primaria y secundaria | Huevo al nido     | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estación |       |
| `f5db3a1b-1485-46de-935b-7a57798e137b` | Menú alumno primaria y secundaria | Huevo al nido     | Pollo chijaukay con arroz blanco         | Refresco del día  | Fruta de estación |       |
| `aad55ff7-66d5-4e72-a4fc-9741075f3178` | Menú Ligth                        |                   | Menu Light                               |                   |                   |       |


#### Profesores (`target_type = teachers`)


| menu_id                                | categoría               | entrada (starter) | plato principal (main_course)            | bebida (beverage) | postre (dessert)  | notas |
| -------------------------------------- | ----------------------- | ----------------- | ---------------------------------------- | ----------------- | ----------------- | ----- |
| `1eeb3e91-d86d-4344-abdb-22968847f595` | Menú del día - Opción 1 | Huevo al nido     | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estación |       |
| `cfeee5f0-27dc-4ecc-aab8-a40aa2c83509` | Menú del día - Opción 2 | Hue               | Pollo chijaukay con arroz blanco         | Refresco del día  | Fruta de estación |       |
| `87f62fbc-9dd7-424f-89eb-0e7039dc1fc8` | Menú Light              |                   | Menu Light                               |                   |                   |       |


### Maristas Champagnat 1 (`9963c14c-22ff-4fcb-b5cc-599596896daa`)

#### Alumnos (`target_type = students`)


| menu_id                                | categoría                            | entrada (starter) | plato principal (main_course)            | bebida (beverage) | postre (dessert)  | notas                                                           |
| -------------------------------------- | ------------------------------------ | ----------------- | ---------------------------------------- | ----------------- | ----------------- | --------------------------------------------------------------- |
| `6f561e8d-0380-41ba-b45b-0ed6b453c939` | Menú del día : opción 1              | Huevo al nido     | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estación |                                                                 |
| `98d7a6f5-23b7-4542-a164-29aa94e94844` | Menú del día : opción 1, sin entrada | no                | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estación |                                                                 |
| `8af4a539-c95c-43ed-8328-8213f8197658` | Menú del día : opción 2              | Huevo al nido     | Pollo chijaukay con arroz blanco         | Refresco del día  | Fruta de estación |                                                                 |
| `95138709-706e-4329-9f78-6bf11357da7b` | Menú del día : opción 2, sin entrada | no                | Pollo chijaukay con arroz blanco         | Refresco del día  | Fruta de estación |                                                                 |
| `bdd0e1ce-bc15-4443-98c5-24b1bc28770c` | Menú Light                           |                   | Menú Light                               |                   |                   | El menú light lleva refresco, entrada, ensalada light y postre. |


#### Profesores (`target_type = teachers`)


| menu_id                                | categoría              | entrada (starter) | plato principal (main_course)              | bebida (beverage) | postre (dessert)  | notas                                                  |
| -------------------------------------- | ---------------------- | ----------------- | ------------------------------------------ | ----------------- | ----------------- | ------------------------------------------------------ |
| `9be1c631-d31f-4e78-b506-9724f5ff8e79` | Especial               | Huevo al nido     | Milanesa de pollo con arroz y papas fritas | Refresco del día  | Fruta de estación |                                                        |
| `b3c86592-4e10-42ed-a6c0-f89aee08173f` | Menú del día bandeja   | Huevo al nido     | Escabeche de pollo con camote sancochado   | Refresco del día  | Fruta de estación |                                                        |
| `bba5b15f-cc9e-46c6-8f83-cac62093316d` | Menú del día bandeja   | Huevo al nido     | Pollo chijaukay con arroz blanco           | Refresco del día  | Fruta de estación |                                                        |
| `014b5984-8382-4488-8e75-0b431c37ac72` | Menú del día en tapers | Huevo al nido     | Pollo chijaukay con arroz blanco           | Refresco del día  | Fruta de estación |                                                        |
| `cd3ead26-ef47-40d4-9538-23341adf9340` | Menú del día en tapers | Huevo al nido     | Escabeche de pollo con camote sancochado   | Refresco del día  | Fruta de estación |                                                        |
| `0c20f57e-97a4-48f2-bdd2-05d068588f72` | Menú light en bandeja  |                   | Menú light en bandeja                      |                   |                   | El menú light lleva refresco, ensalada light y postre. |
| `dddbec3a-b41c-47ef-80e2-fedd8eb0ab46` | Menú Light en Tapers   |                   | Menú Light en Tapers                       |                   |                   | El menú light lleva refresco, ensalada light y postre. |


### Maristas Champagnat 2 (`7d6ca0e8-f68c-422e-89e8-35a21d673185`)

#### Alumnos (`target_type = students`)


| menu_id                                | categoría               | entrada (starter) | plato principal (main_course)            | bebida (beverage) | postre (dessert)  | notas                                    |
| -------------------------------------- | ----------------------- | ----------------- | ---------------------------------------- | ----------------- | ----------------- | ---------------------------------------- |
| `371518c5-43d5-4c57-9284-89778d21de7d` | Almuerzos Ligth Alumnos |                   | Filete de pollo o pescado a la plancha   |                   |                   | Acompañado con entrada refresco y postre |
| `7c33c27f-f91a-4f45-958d-120d77ca9486` | Menú Alumno Opción 2    | Huevo al nido     | Pollo chijaukkai con arroz blanco        | Refresco del día  | Fruta de estación |                                          |
| `4e610399-6520-4bba-ba0f-ff969465df4e` | Menú Alumnos Opción 1   | Huevo al nido     | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estación |                                          |
| `b4e3068a-9280-4529-af57-4c33b9ef2426` | Menú Básico             | No trae           | Escabeche de pollo con camote sancochado | Refresco del día  | Fruta de estación |                                          |


#### Profesores (`target_type = teachers`)


| menu_id                                | categoría                      | entrada (starter) | plato principal (main_course)                         | bebida (beverage) | postre (dessert)  | notas                                   |
| -------------------------------------- | ------------------------------ | ----------------- | ----------------------------------------------------- | ----------------- | ----------------- | --------------------------------------- |
| `8cd21da6-b0a8-4084-bc1e-479991c0b47f` | Almuerzo Especial - Antojito 1 | Entrada del día   | Milanesa de pollo con papas fritas y arroz            | Refresco del día  | Fruta de estación |                                         |
| `94a30c82-d199-4434-802d-0743a89bb8da` | Almuerzo Especial - Antojito 2 | Entrada del día   | Filete de pescado empanizado con papas fritas y arroz | Refresco del día  | Fruta de estación |                                         |
| `d32dd754-5474-4ebe-827a-5c3497fbf809` | Almuerzo Opción 1              | Huevo al nido     | Escabeche de pollo con camote sancochado              | Refresco del día  | Fruta de estación |                                         |
| `1ddbde4e-53a4-4287-ab59-e550c4b1abfb` | Almuerzo Opción 2              | Huevo al nido     | Pollo chijaukai con arroz blanco                      | Refresco del día  | Fruta de estación |                                         |
| `cd646723-a415-46bd-b0bf-c348defca8b1` | Menú Ligth                     |                   | Filete de pollo o pescado a la plancha                |                   |                   | Acompañado de refresco entrada y postre |


### Nordic (`ba6219dd-05ce-43a4-b91b-47ca94744f97`)

#### Alumnos (`target_type = students`)


| menu_id                                | categoría    | entrada (starter) | plato principal (main_course)    | bebida (beverage) | postre (dessert)  | notas                             |
| -------------------------------------- | ------------ | ----------------- | -------------------------------- | ----------------- | ----------------- | --------------------------------- |
| `5c71d4c9-560b-4f04-93d1-f77dfc1b6a84` | Menú del día | Huevo al nido     | Pollo chijaukay con arroz blanco | Refresco del día  | Fruta de estación |                                   |
| `07c9ee90-522b-452a-ba76-c2553cbf5058` | Menú Light   |                   | Menú light del día               |                   |                   | Incluye refresco y postre del día |


#### Profesores (`target_type = teachers`)


| menu_id                                | categoría       | entrada (starter) | plato principal (main_course)                | bebida (beverage) | postre (dessert)  | notas                                     |
| -------------------------------------- | --------------- | ----------------- | -------------------------------------------- | ----------------- | ----------------- | ----------------------------------------- |
| `6f9367dc-d970-4444-a2a9-a5bb91e803b3` | Menú del día    | Huevo al nido     | Pollo chijaukay con arroz blanco             | Refresco del día  | Fruta de estación |                                           |
| `98f2c72e-89eb-4b74-9ffb-bae88ac319e2` | Menú Especial 1 |                   | Milanesa de pollo con papas fritas y arroz   |                   |                   | Incluye entrada refresco y postre del día |
| `24bc877b-df5d-41ba-a923-991af821a037` | Menú especial 2 |                   | Milanesa de pescado con papas fritas y arroz |                   |                   | Incluye entrada refresco y postre del día |
| `33928bc0-82a3-485c-af9d-4fb2dd2525c7` | Menú Ligth      |                   | Menú light del día                           |                   |                   | Incluye refresco y postre del día         |


### St. George's Miraflores (`2a50533d-7fc1-4096-80a7-e20a41bda5a0`)

#### Profesores (`target_type = teachers`)


| menu_id                                | categoría                         | entrada (starter) | plato principal (main_course) | bebida (beverage) | postre (dessert) | notas |
| -------------------------------------- | --------------------------------- | ----------------- | ----------------------------- | ----------------- | ---------------- | ----- |
| `371ffdf1-32d1-4590-a032-823974b7972e` | SGM Almuerzos Profesores Opción 1 | DEL DIA           | LOMO SALTADO                  | DEL DIA           | DEL DIA          |       |


## Maristas Champagnat 2 — referencia para comparar 29 vs 30

`**school_id` (MC2):** `7d6ca0e8-f68c-422e-89e8-35a21d673185`

### Cifras guardadas (instantánea / rescate, 2026-04-29)


| Concepto                                         | Cantidad |
| ------------------------------------------------ | -------- |
| Pedidos totales (incl. anulados)                 | 93       |
| Pedidos activos (excl. anulados)                 | 88       |
| Pedidos anulados                                 | 5        |
| Última TX `paid` (sobre los 88 activos)          | 62       |
| Última TX `pending` (sobre los 88 activos)       | 26       |
| Sin transacción vinculada (sobre los 88 activos) | 0        |


**Datos con UUID, nombres y correos:** no van pegados en este archivo (privacidad). **Guardalos vos** ejecutando el SQL de abajo en el SQL Editor y **Exportar → CSV**, o con `psql` y `\copy`. Guardá un archivo por fecha, por ejemplo `mc2_2026-04-29.csv` y `mc2_2026-04-30.csv`, en una carpeta **que no subas a git** si tiene datos personales.

### 1) Detalle completo (cambiá solo la fecha para el 30)

Misma lógica para **29** y **30**: reemplazá `:FECHA` por `DATE '2026-04-29'` o `DATE '2026-04-30'`.

```sql
-- Detalle MC2: pedidos, alumno, padre (perfil), pago última TX
-- Excluye anulados (misma regla que usaste para el 88)
SELECT
  lo.id AS lunch_order_id,
  lo.order_date,
  lo.status AS estado_pedido,
  COALESCE(lo.is_cancelled, false) AS cancelado,
  CASE
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    ELSE 'manual'
  END AS tipo,
  st.id AS alumno_id,
  st.full_name AS alumno_nombre,
  st.parent_id AS padre_profile_id,
  COALESCE(pp.full_name, pr.full_name) AS padre_nombre,
  pr.email AS padre_email,
  tp.id AS profesor_id,
  tp.full_name AS profesor_nombre,
  lo.manual_name,
  lo.final_price,
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
WHERE lm.date = DATE '2026-04-29'   -- cambiar a '2026-04-30' para el otro día
  AND lm.school_id = '7d6ca0e8-f68c-422e-89e8-35a21d673185'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

### 2) Resumen de cobro (misma fecha + MC2)

```sql
SELECT
  COUNT(*) FILTER (WHERE t.payment_status = 'paid') AS tx_pagado,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending') AS tx_pendiente,
  COUNT(*) FILTER (WHERE t.id IS NULL) AS sin_transaccion,
  COUNT(*) AS total_activos
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN LATERAL (
  SELECT tr.id, tr.payment_status
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '7d6ca0e8-f68c-422e-89e8-35a21d673185'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';
```

### 3) Contar anulados vs activos (MC2, una fecha)

```sql
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) = false AND lo.status IS DISTINCT FROM 'cancelled'
  ) AS pedidos_activos,
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) OR lo.status = 'cancelled'
  ) AS pedidos_anulados,
  COUNT(*) AS total_filas
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '7d6ca0e8-f68c-422e-89e8-35a21d673185';
```

### 4) Solo UUID — para guardar / comparar sin datos personales

**Sí:** en los datos completos entran **alumnos** (`student_id` relleno), **profesores** (`teacher_id` relleno cuando el pedido es de profe) y **manual** (ambos null, a veces solo texto en `manual_name` en el detalle largo; aquí no exportamos el nombre).

Ejecutá esto, exportá CSV si querés; cambiá la fecha para el **30**.

```sql
SELECT
  lo.id AS lunch_order_id,
  lm.id AS menu_id,
  lm.school_id,
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
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '7d6ca0e8-f68c-422e-89e8-35a21d673185'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, lunch_order_id;
```

### 5) Maristas Champagnat 1 (MC1) — 2026-04-29, activos: nombres, padres, saldo, pago

`**school_id` (MC1):** `9963c14c-22ff-4fcb-b5cc-599596896daa`

#### Cifras guardadas (activos, 2026-04-29 — última transacción por pedido)


| Métrica                      | Valor |
| ---------------------------- | ----- |
| **tx_pagado** (`paid`)       | 33    |
| **tx_pendiente** (`pending`) | 10    |
| **sin_transaccion**          | 0     |
| **total_activos**            | 43    |


**Para comparar con el día siguiente:** exportá solo UUID con la query de abajo (`fecha` 29 y después 30), p. ej. `mc1_uuids_2026-04-29.csv` y `mc1_uuids_2026-04-30.csv`. La clave estable es `**lunch_order_id`** (y si necesitás cruzar alumnos/padres, `alumno_id` / `padre_profile_id`).

#### Solo UUID — MC1 (sin nombres ni correos)

```sql
SELECT
  lo.id AS lunch_order_id,
  lm.id AS menu_id,
  lm.school_id,
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
WHERE lm.date = DATE '2026-04-29'   -- cambiar a '2026-04-30' para el otro día
  AND lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, lunch_order_id;
```

#### Resumen cobro (misma lógica que la tabla de arriba)

```sql
SELECT
  COUNT(*) FILTER (WHERE t.payment_status = 'paid') AS tx_pagado,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending') AS tx_pendiente,
  COUNT(*) FILTER (WHERE t.id IS NULL) AS sin_transaccion,
  COUNT(*) AS total_activos
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN LATERAL (
  SELECT tr.id, tr.payment_status
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-29'
  AND lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';
```

**Saldo / deuda:** se usa `**students.balance`** al momento de la consulta (misma lógica que el portal: negativo suele ser “debe”; positivo “a favor”; verificá con tu regla de negocio). En pedidos de **profesor** o **manual** no hay alumno → `saldo_alumno` sale NULL.

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
WHERE lm.date = DATE '2026-04-29'
  AND lm.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

### 6) Jean LeBouch (JLB) — 2026-04-29 (y 30): mismos datos que MC1 / MC2

`**school_id` (JLB):** `8a0dbd73-0571-4db1-af5c-65f4948c4c98`

**Referencia** (instantánea por sede del 29, *todos* los `lunch_orders` del día): en el resumen global de este doc figuraban **41** pedidos para JLB el **2026-04-29** (ese número **no** resta anulados; para activos usá las consultas de abajo).

#### Cifras guardadas (activos, 2026-04-29 — última transacción por pedido)


| Métrica                                   | Valor                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **tx_pagado** (`paid`)                    | 15                                                                                                  |
| **tx_pendiente** (`pending`)              | 24                                                                                                  |
| **sin_transaccion**                       | 0                                                                                                   |
| **total_activos**                         | 39                                                                                                  |
| **pedidos anulados** (29 abr, misma sede) | 2 *(41 filas totales en menú del día − 39 activos; confirmable con la query «Activos vs anulados»)* |


**Datos con UUID, nombres y correos:** no los pegues en este repo; exportá CSV local si los necesitás (igual que MC1 / MC2).

#### Resumen cobro — JLB, pedidos activos (cambiá la fecha para el 30)

```sql
SELECT
  COUNT(*) FILTER (WHERE t.payment_status = 'paid') AS tx_pagado,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending') AS tx_pendiente,
  COUNT(*) FILTER (WHERE t.id IS NULL) AS sin_transaccion,
  COUNT(*) AS total_activos
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN LATERAL (
  SELECT tr.id, tr.payment_status
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';
```

#### Activos vs anulados — JLB

```sql
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) = false AND lo.status IS DISTINCT FROM 'cancelled'
  ) AS pedidos_activos,
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) OR lo.status = 'cancelled'
  ) AS pedidos_anulados,
  COUNT(*) AS total_filas
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98';
```

#### Detalle completo — nombres, padres, saldo alumno, pago (solo activos)

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
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

#### Solo UUID — JLB (exportar para comparar 29 vs 30)

```sql
SELECT
  lo.id AS lunch_order_id,
  lm.id AS menu_id,
  lm.school_id,
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
WHERE lm.date = DATE '2026-04-29'   -- cambiar a '2026-04-30'
  AND lm.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, lunch_order_id;
```

Sugerencia de archivos: `jlb_detalle_2026-04-29.csv`, `jlb_uuids_2026-04-29.csv` (y lo mismo para el **30**).

### 7) Nordic — 2026-04-29 (y 30): mismos datos que MC1 / MC2 / JLB

`**school_id` (Nordic):** `ba6219dd-05ce-43a4-b91b-47ca94744f97`

**Referencia** (instantánea por sede del 29, *todos* los `lunch_orders` del día): en el resumen global de este doc figuraban **38** pedidos para Nordic el **2026-04-29** (ese número **no** resta anulados; para activos y cobro usá las consultas de abajo).

#### Cifras guardadas (activos, 2026-04-29 — última transacción por pedido)


| Métrica                                   | Valor                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| **tx_pagado** (`paid`)                    | 29                                                                                            |
| **tx_pendiente** (`pending`)              | 7                                                                                             |
| **sin_transaccion**                       | 0                                                                                             |
| **total_activos**                         | 36                                                                                            |
| **pedidos anulados** (29 abr, misma sede) | 2 *(38 `total_filas` en menú del día − 36 activos; coincide con query «Activos vs anulados»)* |


**Datos con UUID, nombres y correos:** exportá CSV local; no los pegues en este repo.

#### Resumen cobro — Nordic, pedidos activos (cambiá la fecha para el 30)

```sql
SELECT
  COUNT(*) FILTER (WHERE t.payment_status = 'paid') AS tx_pagado,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending') AS tx_pendiente,
  COUNT(*) FILTER (WHERE t.id IS NULL) AS sin_transaccion,
  COUNT(*) AS total_activos
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN LATERAL (
  SELECT tr.id, tr.payment_status
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';
```

#### Activos vs anulados — Nordic

```sql
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) = false AND lo.status IS DISTINCT FROM 'cancelled'
  ) AS pedidos_activos,
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) OR lo.status = 'cancelled'
  ) AS pedidos_anulados,
  COUNT(*) AS total_filas
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97';
```

#### Detalle completo — nombres, padres, saldo alumno, pago (solo activos)

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
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

#### Solo UUID — Nordic (exportar para comparar 29 vs 30)

```sql
SELECT
  lo.id AS lunch_order_id,
  lm.id AS menu_id,
  lm.school_id,
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
WHERE lm.date = DATE '2026-04-29'   -- cambiar a '2026-04-30'
  AND lm.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, lunch_order_id;
```

Sugerencia de archivos: `nordic_detalle_2026-04-29.csv`, `nordic_uuids_2026-04-29.csv` (y lo mismo para el **30**).

### 8) St. George's Miraflores — 2026-04-29 (y 30): misma lógica (pocos pedidos en esta instantánea)

`**school_id`:** `2a50533d-7fc1-4096-80a7-e20a41bda5a0`

**Referencia** (instantánea del 29, *todos* los `lunch_orders` del menú): **2** pedidos en la tabla «Por sede» de este doc.

#### Cifras guardadas (2026-04-29 — instantánea rescate)


| Métrica                       | Valor                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| **tx_pagado** (`paid`)        | *(ejecutar resumen cobro; no figura en export solo-UUID)*          |
| **tx_pendiente** (`pending`)  | *(ejecutar resumen cobro)*                                         |
| **sin_transaccion**           | 0 *(ambos pedidos activos listan `transaction_id` en export UUID)* |
| **total_activos**             | 2                                                                  |
| **pedidos anulados** (29 abr) | 0 *(2 filas totales en menú del día = 2 activos)*                  |


**Composición (export UUID 29 abr):** 1 **manual**, 1 **profesor** (mismo `menu_id` en ambos).

#### Resumen cobro — St. George's Miraflores, pedidos activos

```sql
SELECT
  COUNT(*) FILTER (WHERE t.payment_status = 'paid') AS tx_pagado,
  COUNT(*) FILTER (WHERE t.payment_status = 'pending') AS tx_pendiente,
  COUNT(*) FILTER (WHERE t.id IS NULL) AS sin_transaccion,
  COUNT(*) AS total_activos
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN LATERAL (
  SELECT tr.id, tr.payment_status
  FROM public.transactions tr
  WHERE tr.type = 'purchase'
    AND COALESCE(tr.is_deleted, false) = false
    AND tr.metadata->>'lunch_order_id' = lo.id::text
  ORDER BY tr.created_at DESC NULLS LAST
  LIMIT 1
) t ON true
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled';
```

#### Activos vs anulados

```sql
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) = false AND lo.status IS DISTINCT FROM 'cancelled'
  ) AS pedidos_activos,
  COUNT(*) FILTER (
    WHERE COALESCE(lo.is_cancelled, false) OR lo.status = 'cancelled'
  ) AS pedidos_anulados,
  COUNT(*) AS total_filas
FROM public.lunch_orders lo
JOIN public.lunch_menus lm ON lm.id = lo.menu_id
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0';
```

#### Detalle completo (solo activos)

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
WHERE lm.date = DATE '2026-04-29'   -- o '2026-04-30'
  AND lm.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, alumno_nombre NULLS LAST, profesor_nombre NULLS LAST, lo.created_at;
```

#### Solo UUID — St. George's Miraflores (29 vs 30)

```sql
SELECT
  lo.id AS lunch_order_id,
  lm.id AS menu_id,
  lm.school_id,
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
WHERE lm.date = DATE '2026-04-29'   -- cambiar a '2026-04-30'
  AND lm.school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY tipo, lunch_order_id;
```

Sugerencia: `stgeorges_miraflores_uuids_2026-04-29.csv` (y **30**).

### 9) Comparar dos CSV (fuera de la BD)

Cuando tengas pares por sede, por ejemplo `mc2_uuids_…`, `mc1_uuids_…`, `jlb_uuids_…`, `nordic_uuids_…` o `stgeorges_miraflores_uuids_2026-04-29.csv` / `…-04-30.csv`, la columna estable para cruzar pedidos es `**lunch_order_id`**. En Excel: tablas dinámicas o `BUSCARV` / Power Query. En la BD, podés cargar los IDs en una tabla temporal y hacer `JOIN` / `NOT IN` — eso lo hacés en el proyecto donde tengas permiso de crear tablas staging.

---

## Apéndice: IDs para cruzar padre / hijo / pedido (2026-04-29)

**Qué va en este archivo:** **UUID y tipos** (`lunch_order_id`, `student_id`, `padre_profile_id`, `menu_id`, `school_id`, `transaction_id`, `tipo`). Sirve para comparar “quién pidió” entre fechas o backups **sin** volver a correr SQL.

**Qué no pegues acá:** nombres completos, correos, DNI ni otros datos personales (eso en CSV local aparte si lo necesitás).

**Cómo rellenar sin trabajo doble:** ejecutá **una sola vez** la consulta de abajo → Exportar CSV → opcional: pegá en este apéndice solo las filas de una sede (filtrá por `school_id`) o guardá el CSV junto al repo con nombre fijo, p. ej. `exports/pedidos_2026-04-29_uuids_todas_sedes.csv` (y agregá `exports/` a `.gitignore` si no querés subirlo a git; si **sí** querés versionar solo UUIDs, pegá las tablas por sede más abajo).

### Una sola query — todas las sedes de este doc (29 abr, solo activos)

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
WHERE lm.date = DATE '2026-04-29'
  AND lm.school_id IN (
    '7d6ca0e8-f68c-422e-89e8-35a21d673185', -- MC2
    '9963c14c-22ff-4fcb-b5cc-599596896daa', -- MC1
    '8a0dbd73-0571-4db1-af5c-65f4948c4c98', -- JLB
    'ba6219dd-05ce-43a4-b91b-47ca94744f97', -- Nordic
    '2a50533d-7fc1-4096-80a7-e20a41bda5a0'  -- St. George's Miraflores
  )
  AND COALESCE(lo.is_cancelled, false) = false
  AND lo.status IS DISTINCT FROM 'cancelled'
ORDER BY lm.school_id, tipo, lunch_order_id;
```

### Plantillas por sede (pegá filas UUID aquí si querés versionarlas en git)

**Criterio de fila:** una fila = un pedido activo. Para **alumno**, `padre_profile_id` + `student_id` identifican “padre con hijo”; para **profesor**, `teacher_id`; para **manual**, `student_id`/`teacher_id`/`padre_profile_id` pueden ser NULL.

#### MC2 (`7d6ca0e8-f68c-422e-89e8-35a21d673185`)


| lunch_order_id  | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
| --------------- | ------- | ---------- | ---------- | ---------------- | -------------- | ---- |
| *(pegar o CSV)* |         |            |            |                  |                |      |


#### MC1 (`9963c14c-22ff-4fcb-b5cc-599596896daa`)


| lunch_order_id  | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
| --------------- | ------- | ---------- | ---------- | ---------------- | -------------- | ---- |
| *(pegar o CSV)* |         |            |            |                  |                |      |


#### JLB (`8a0dbd73-0571-4db1-af5c-65f4948c4c98`)


| lunch_order_id  | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
| --------------- | ------- | ---------- | ---------- | ---------------- | -------------- | ---- |
| *(pegar o CSV)* |         |            |            |                  |                |      |


#### Nordic (`ba6219dd-05ce-43a4-b91b-47ca94744f97`)


| lunch_order_id  | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
| --------------- | ------- | ---------- | ---------- | ---------------- | -------------- | ---- |
| *(pegar o CSV)* |         |            |            |                  |                |      |


#### St. George's Miraflores (`2a50533d-7fc1-4096-80a7-e20a41bda5a0`)


| lunch_order_id  | menu_id | student_id | teacher_id | padre_profile_id | transaction_id | tipo |
| --------------- | ------- | ---------- | ---------- | ---------------- | -------------- | ---- |
| *(pegar o CSV)* |         |            |            |                  |                |      |


