-- =====================================================================
-- GENERADOR DE INFORME MARKDOWN POR SEDE
-- Pedidos de Almuerzo — Próxima Semana (Lunes a Viernes)
-- =====================================================================
-- INSTRUCCIONES:
--   1. Abre Supabase Dashboard → SQL Editor
--   2. Copia y pega esta consulta completa
--   3. Ejecuta — obtendrás UNA celda con el Markdown completo
--   4. Copia el valor de la celda y compártelo con los administradores
-- =====================================================================

WITH

-- ── 1. RANGO DE FECHAS ──────────────────────────────────────────────
proxima_semana AS (
  SELECT
    CASE
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER
    END AS fecha_inicio,
    CASE
      WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE + 4
      ELSE CURRENT_DATE + (8 - EXTRACT(DOW FROM CURRENT_DATE))::INTEGER + 4
    END AS fecha_fin
),
fechas_semana AS (
  SELECT fecha_inicio + (generate_series(0, 4) || ' days')::INTERVAL AS fecha
  FROM proxima_semana
),

-- ── 2. PEDIDOS DE LA SEMANA ─────────────────────────────────────────
pedidos_semana AS (
  SELECT
    lo.id                                                    AS order_id,
    lo.order_date,
    lo.final_price,
    lo.quantity,
    lo.status,
    s.name                                                   AS estudiante_nombre,
    COALESCE(pp.full_name, p.email, 'No registrado')         AS padre_nombre,
    COALESCE(p.email,      '—')                              AS padre_email,
    COALESCE(pp.phone_1, pp.phone_2, '—')                   AS padre_telefono,
    sc.name                                                  AS sede_nombre,
    sc.code                                                  AS sede_codigo
  FROM lunch_orders lo
  INNER JOIN students         s  ON lo.student_id = s.id
  LEFT  JOIN profiles         p  ON s.parent_id   = p.id
  LEFT  JOIN parent_profiles  pp ON p.id           = pp.user_id
  LEFT  JOIN schools          sc ON lo.school_id   = sc.id
  INNER JOIN fechas_semana    fs ON lo.order_date  = fs.fecha::DATE
  WHERE lo.is_cancelled = false
    AND lo.status IN ('confirmed', 'pending_payment', 'delivered')
),

-- ── 3. ESTADO DE PAGO ───────────────────────────────────────────────
pagos_por_transaccion AS (
  SELECT DISTINCT
    (tx.metadata->>'lunch_order_id')::UUID AS order_id,
    true                                   AS pagado_por_transaccion
  FROM transactions tx
  WHERE tx.type IN ('purchase', 'debit')
    AND tx.metadata IS NOT NULL
    AND tx.metadata->>'lunch_order_id' IS NOT NULL
),
pagos_por_voucher AS (
  SELECT DISTINCT
    UNNEST(rr.lunch_order_ids) AS order_id,
    true                       AS pagado_por_voucher
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.lunch_order_ids IS NOT NULL
    AND array_length(rr.lunch_order_ids, 1) > 0
),
estado_pago AS (
  SELECT
    ps.order_id,
    COALESCE(pt.pagado_por_transaccion, false)
      OR COALESCE(pv.pagado_por_voucher, false) AS ha_pagado
  FROM pedidos_semana ps
  LEFT JOIN pagos_por_transaccion pt ON ps.order_id = pt.order_id
  LEFT JOIN pagos_por_voucher     pv ON ps.order_id = pv.order_id
),

-- ── 4. DATOS COMBINADOS ─────────────────────────────────────────────
datos AS (
  SELECT
    ps.*,
    ep.ha_pagado,
    (ps.final_price * ps.quantity) AS monto_orden
  FROM pedidos_semana ps
  INNER JOIN estado_pago ep ON ps.order_id = ep.order_id
),

-- ── 5. RESUMEN POR SEDE ─────────────────────────────────────────────
resumen_sede AS (
  SELECT
    sede_codigo,
    sede_nombre,
    COUNT(DISTINCT order_id)                                           AS total_pedidos,
    COUNT(DISTINCT CASE WHEN ha_pagado     THEN order_id END)          AS pedidos_pagados,
    COUNT(DISTINCT CASE WHEN NOT ha_pagado THEN order_id END)          AS pedidos_pendientes,
    SUM(CASE WHEN ha_pagado     THEN monto_orden ELSE 0 END)           AS monto_pagado,
    SUM(CASE WHEN NOT ha_pagado THEN monto_orden ELSE 0 END)           AS monto_pendiente,
    SUM(monto_orden)                                                   AS monto_total
  FROM datos
  GROUP BY sede_codigo, sede_nombre
),
sedes_numeradas AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY sede_codigo) AS num_sede
  FROM resumen_sede
),

-- ── 6. DETALLE POR PADRE/TUTOR ──────────────────────────────────────
detalle_padres AS (
  SELECT
    sede_codigo,
    sede_nombre,
    padre_nombre,
    padre_email,
    padre_telefono,
    STRING_AGG(DISTINCT estudiante_nombre, ', ' ORDER BY estudiante_nombre) AS hijos,
    COUNT(DISTINCT order_id)                                               AS total_pedidos,
    SUM(monto_orden)                                                       AS monto_total,
    SUM(CASE WHEN ha_pagado     THEN monto_orden ELSE 0 END)               AS monto_pagado,
    SUM(CASE WHEN NOT ha_pagado THEN monto_orden ELSE 0 END)               AS monto_pendiente,
    COUNT(DISTINCT CASE WHEN NOT ha_pagado THEN order_id END)              AS pedidos_pendientes,
    CASE
      WHEN COUNT(DISTINCT CASE WHEN NOT ha_pagado THEN order_id END) > 0
      THEN '⚠️ PENDIENTE'
      ELSE '✅ PAGADO'
    END AS estado_pago
  FROM datos
  GROUP BY sede_codigo, sede_nombre, padre_nombre, padre_email, padre_telefono
),
detalle_padres_numerados AS (
  SELECT
    dp.*,
    sn.num_sede,
    ROW_NUMBER() OVER (
      PARTITION BY dp.sede_codigo
      ORDER BY
        CASE WHEN dp.pedidos_pendientes > 0 THEN 0 ELSE 1 END,
        dp.padre_nombre
    ) AS rn_en_sede
  FROM detalle_padres dp
  INNER JOIN sedes_numeradas sn ON dp.sede_codigo = sn.sede_codigo
),

-- ── 7. LÍNEAS DE MARKDOWN ────────────────────────────────────────────
-- Cada fila = una línea del informe final, ordenada por sort_key
markdown_lines AS (

  -- ┌─ ENCABEZADO ───────────────────────────────────────────────────┐
  SELECT 0.0 AS sort_key,
    '# 📊 Informe de Pedidos de Almuerzo — Próxima Semana' || E'\n\n'
    || '| | |'                                              || E'\n'
    || '|---|---|'                                          || E'\n'
    || '| 📅 **Generado el** | '
        || TO_CHAR(NOW() AT TIME ZONE 'America/Lima', 'DD/MM/YYYY')
        || ' a las '
        || TO_CHAR(NOW() AT TIME ZONE 'America/Lima', 'HH24:MI') || ' |' || E'\n'
    || '| 🗓️ **Semana** | '
        || TO_CHAR(pm.fecha_inicio, 'DD/MM/YYYY')
        || ' — '
        || TO_CHAR(pm.fecha_fin, 'DD/MM/YYYY') || ' |'
    AS linea
  FROM proxima_semana pm

  -- ┌─ RESUMEN GENERAL (tabla multi-sede) ───────────────────────────┐
  UNION ALL SELECT 1.0,  E'\n---\n\n## 📈 Resumen General por Sede'
  UNION ALL SELECT 1.1,  E'\n| Sede | Total | ✅ Pagados | ⚠️ Pendientes | 💰 Monto Total | 💳 Cobrado | ⏳ Por Cobrar |'
  UNION ALL SELECT 1.2,  '|:-----|:-----:|:---------:|:------------:|:-------------:|:---------:|:------------:|'

  -- Fila por cada sede
  UNION ALL
  SELECT
    1.3 + num_sede * 0.001,
    '| **' || sede_nombre          || '** | '
    || total_pedidos               || ' | '
    || pedidos_pagados             || ' | '
    || pedidos_pendientes          || ' | S/ '
    || TO_CHAR(monto_total,        'FM999,999.00') || ' | S/ '
    || TO_CHAR(monto_pagado,       'FM999,999.00') || ' | S/ '
    || TO_CHAR(monto_pendiente,    'FM999,999.00') || ' |'
  FROM sedes_numeradas

  -- Fila TOTAL GENERAL
  UNION ALL
  SELECT 1.999,
    '| **🏆 TOTAL GENERAL** | **'
    || SUM(total_pedidos)      || '** | **'
    || SUM(pedidos_pagados)    || '** | **'
    || SUM(pedidos_pendientes) || '** | **S/ '
    || TO_CHAR(SUM(monto_total),     'FM999,999.00') || '** | **S/ '
    || TO_CHAR(SUM(monto_pagado),    'FM999,999.00') || '** | **S/ '
    || TO_CHAR(SUM(monto_pendiente), 'FM999,999.00') || '** |'
  FROM resumen_sede

  -- ┌─ SECCIÓN POR SEDE ─────────────────────────────────────────────┐
  -- 2a · Encabezado de sede
  UNION ALL
  SELECT
    2.0 + num_sede * 10.0,
    E'\n---\n\n'
    || '## 🏫 ' || sede_nombre || '  `(' || sede_codigo || ')`' || E'\n\n'
    || '> 📦 **' || total_pedidos     || ' pedido(s)** &nbsp;·&nbsp; '
    || '✅ **' || pedidos_pagados    || ' pagado(s)** &nbsp;·&nbsp; '
    || '⚠️ **' || pedidos_pendientes || ' pendiente(s)**' || E'\n'
    || '> 💰 Total: **S/ ' || TO_CHAR(monto_total,     'FM999,999.00') || '**'
    || ' &nbsp;·&nbsp; 💳 Cobrado: **S/ ' || TO_CHAR(monto_pagado,    'FM999,999.00') || '**'
    || ' &nbsp;·&nbsp; ⏳ Por cobrar: **S/ ' || TO_CHAR(monto_pendiente, 'FM999,999.00') || '**'
  FROM sedes_numeradas

  -- 2b · Cabecera de tabla
  UNION ALL
  SELECT
    2.0 + num_sede * 10.0 + 0.1,
    E'\n| Estado | Padre / Tutor | Email de contacto | Teléfono | Hijo(s) | Pedidos | Monto Total | Por Cobrar |'
  FROM sedes_numeradas

  UNION ALL
  SELECT
    2.0 + num_sede * 10.0 + 0.2,
    '|:------:|:-------------|:------------------|:---------|:--------|:-------:|------------:|-----------:|'
  FROM sedes_numeradas

  -- 2c · Fila por padre/tutor dentro de cada sede
  UNION ALL
  SELECT
    2.0 + num_sede * 10.0 + 0.3 + rn_en_sede * 0.001,
    '| ' || estado_pago
    || ' | ' || padre_nombre
    || ' | ' || padre_email
    || ' | ' || padre_telefono
    || ' | ' || hijos
    || ' | '   || total_pedidos
    || ' | S/ ' || TO_CHAR(monto_total,     'FM999,999.00')
    || ' | S/ ' || TO_CHAR(monto_pendiente, 'FM999,999.00')
    || ' |'
  FROM detalle_padres_numerados

  -- ┌─ PIE DE INFORME ────────────────────────────────────────────────┐
  UNION ALL
  SELECT 999999.0,
    E'\n---\n\n'
    || '_⚙️ Informe generado automáticamente desde el sistema de gestión de almuerzos._  ' || E'\n'
    || '_Solo incluye pedidos activos (`confirmed`, `pending_payment`, `delivered`) no cancelados._  ' || E'\n'
    || '_El estado de pago se verifica contra transacciones en caja/POS y vouchers aprobados._'

)

-- ── RESULTADO FINAL: un único valor de texto Markdown ────────────────
SELECT STRING_AGG(linea, E'\n' ORDER BY sort_key) AS informe_markdown
FROM markdown_lines;
