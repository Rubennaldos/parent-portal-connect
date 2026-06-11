-- ============================================================================
-- FASE 1 — SSOT del Boleteo Masivo (solo lectura, no cambia ningún flujo)
-- Fecha: 2026-06-05
--
-- QUÉ PROBLEMA RESUELVE (en simple):
--   Hoy el "Cierre Mensual" y el cron de Vercel deciden EN JAVASCRIPT qué
--   ventas se boletean, sumando dinero en el navegador y calculando fechas
--   con el reloj del computador. Eso:
--     1. Viola las reglas de oro #11.A (cero cálculos de dinero en cliente)
--        y #11.C (reloj de PostgreSQL, no del dispositivo).
--     2. Dejó ~830 ventas invisibles para el boleteo:
--          · 'mixto'  → nunca estaba en la lista de métodos.
--          · 'CARD'   → el webhook de IziPay lo guarda en MAYÚSCULA y la
--                       lista solo buscaba 'card' en minúscula.
--     3. No respeta una regla de la dueña: en un pago MIXTO, la parte en
--        EFECTIVO no debe ir a SUNAT (solo la parte digital).
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   Crea UNA vista (`v_billing_masivo_pending`) que es la ÚNICA fuente de
--   verdad de "qué ticket digital está pendiente de boletear y por cuánto".
--   La lógica de dinero y de tiempo vive aquí, en la base de datos.
--
-- POR QUÉ ES SEGURO (no rompe nada):
--   · Es una VISTA de SOLO LECTURA. No inserta, no actualiza, no borra.
--   · No reemplaza ninguna función, trigger ni tabla existente.
--   · NINGÚN flujo la consume todavía. El boleteo masivo sigue funcionando
--     EXACTAMENTE igual que hoy. Esto solo permite VALIDAR las cifras
--     correctas en paralelo (modo sombra) antes de conectar el flujo.
--   · security_invoker = true → respeta la seguridad por sede (RLS) del
--     usuario que consulta; no abre una puerta para ver otras sedes.
--
-- REGLA DE LA DUEÑA RESPETADA:
--   · Efectivo sin boleta → NUNCA entra (no está en la lista de métodos).
--   · Mixto → solo la parte NO efectivo (monto_total - cash_amount).
--   · El "boleteo masivo" sigue siendo solo para ventas tipo 'ticket'
--     pagadas con medio digital.
--
-- IMPORTANTE: este archivo NO se ejecuta automáticamente en producción.
--   Revísalo y córrelo manualmente cuando estés conforme. Al ser una vista
--   de solo lectura, ejecutarlo no afecta dinero ni comprobantes.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_billing_masivo_pending
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.school_id,
  t.created_at,
  t.payment_method,
  t.amount,

  -- Día de la venta en hora REAL de Lima (regla #11.C: reloj de PostgreSQL).
  (t.created_at AT TIME ZONE 'America/Lima')::date          AS dia_venta_lima,

  -- Monto que SÍ se debe boletear (regla #11.A: el cálculo vive en la DB).
  --   · Mixto  → total menos la parte en efectivo (la dueña no boletea efectivo).
  --   · Resto  → el monto completo (ya es 100% digital).
  CASE
    WHEN lower(btrim(t.payment_method)) = 'mixto'
      THEN round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2)
    ELSE round(abs(t.amount), 2)
  END                                                        AS monto_boleteable,

  -- Días transcurridos desde la venta (para el candado de fecha SUNAT).
  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date )     AS dias_desde_venta,

  -- CANDADO DE FECHA: SUNAT no acepta boletas resumen muy antiguas.
  -- Se marca como extemporáneo lo que supera la ventana legal (7 días).
  -- El flujo masivo deberá OMITIR estas filas; el backlog histórico se
  -- trata aparte, en frío, con la contadora.
  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date ) > 7 AS es_extemporaneo,

  t.metadata
FROM public.transactions t
WHERE t.is_taxable     = true
  AND t.billing_status = 'pending'
  AND t.document_type  = 'ticket'
  AND t.payment_status = 'paid'
  AND COALESCE(t.is_deleted, false) = false
  AND t.amount <> 0
  -- Métodos DIGITALES (case-insensitive). Efectivo/saldo/wallet quedan FUERA
  -- intencionalmente (regla de la dueña: efectivo sin boleta no va a SUNAT).
  AND lower(btrim(t.payment_method)) IN (
        'yape', 'yape_qr', 'yape_numero',
        'plin', 'plin_qr', 'plin_numero',
        'transferencia', 'transfer',
        'tarjeta', 'card',
        'mixto'
      )
  -- Excluir pedidos de almuerzo anulados (paridad con el flujo actual).
  -- Comparación por texto para evitar errores de casteo si el metadata es raro.
  AND NOT EXISTS (
        SELECT 1
        FROM public.lunch_orders lo
        WHERE lo.id::text = (t.metadata->>'lunch_order_id')
          AND (lo.status = 'cancelled' OR lo.is_cancelled = true)
      )
  -- Si el mixto resultó 100% efectivo (parte digital = 0), no hay nada que boletear.
  AND (
        lower(btrim(t.payment_method)) <> 'mixto'
        OR round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2) > 0
      );

COMMENT ON VIEW public.v_billing_masivo_pending IS
  'SSOT del boleteo masivo. Devuelve tickets digitales pendientes con el monto '
  'boleteable correcto (mixto = solo parte no-efectivo) y bandera es_extemporaneo '
  '(candado de fecha SUNAT, 7 días). Solo lectura; ningún flujo la consume aún. '
  'Reemplaza el cálculo en JavaScript de CierreMensual.tsx y api/cron/auto-invoice.ts.';

GRANT SELECT ON public.v_billing_masivo_pending TO authenticated, service_role;


-- ============================================================================
-- VALIDACIÓN EN MODO SOMBRA (ejecutar manualmente; son solo SELECT)
-- ============================================================================
-- Estas consultas NO cambian nada. Sirven para comparar la cifra CORRECTA
-- (esta vista) contra el comportamiento actual antes de conectar el flujo.

-- 1) Pendiente boleteable por sede, separando lo emitible HOY vs lo extemporáneo:
-- SELECT
--   s.name AS sede,
--   COUNT(*) FILTER (WHERE NOT v.es_extemporaneo)              AS ventas_emitibles,
--   ROUND(SUM(v.monto_boleteable) FILTER (WHERE NOT v.es_extemporaneo), 2) AS monto_emitible,
--   COUNT(*) FILTER (WHERE v.es_extemporaneo)                  AS ventas_backlog_viejo,
--   ROUND(SUM(v.monto_boleteable) FILTER (WHERE v.es_extemporaneo), 2)     AS monto_backlog_viejo
-- FROM v_billing_masivo_pending v
-- JOIN schools s ON s.id = v.school_id
-- GROUP BY s.name
-- ORDER BY monto_emitible DESC NULLS LAST;

-- 2) Cuánto aporta el mixto y el CARD (lo que antes quedaba colgado):
-- SELECT
--   s.name AS sede,
--   lower(btrim(v.payment_method)) AS metodo,
--   COUNT(*) AS cantidad,
--   ROUND(SUM(v.monto_boleteable), 2) AS monto_boleteable
-- FROM v_billing_masivo_pending v
-- JOIN schools s ON s.id = v.school_id
-- WHERE lower(btrim(v.payment_method)) IN ('mixto', 'card')
-- GROUP BY s.name, lower(btrim(v.payment_method))
-- ORDER BY cantidad DESC;

-- 3) Control: en mixto, cuánto efectivo se EXCLUYE de SUNAT (regla de la dueña):
-- SELECT
--   s.name AS sede,
--   COUNT(*) AS ventas_mixto,
--   ROUND(SUM(t.cash_amount), 2)                       AS efectivo_excluido_sunat,
--   ROUND(SUM(abs(t.amount) - COALESCE(t.cash_amount,0)), 2) AS digital_a_boletear
-- FROM transactions t
-- JOIN schools s ON s.id = t.school_id
-- WHERE t.is_taxable = true
--   AND t.billing_status = 'pending'
--   AND t.document_type = 'ticket'
--   AND t.payment_status = 'paid'
--   AND lower(btrim(t.payment_method)) = 'mixto'
-- GROUP BY s.name
-- ORDER BY ventas_mixto DESC;
-- ============================================================================
