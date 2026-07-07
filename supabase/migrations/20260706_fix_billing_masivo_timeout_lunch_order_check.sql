-- ============================================================================
-- FIX: Timeout (57014) en Cierre Mensual al consultar v_billing_masivo_emitible
-- Fecha: 2026-07-06
--
-- ── QUÉ PROBLEMA RESUELVE (en simple) ──────────────────────────────────────
-- El Cierre Mensual (Facturación → Cierre Mensual) fallaba con:
--   {"code":"57014","message":"canceling statement due to statement timeout"}
--
-- Causa raíz (confirmada con EXPLAIN ANALYZE real, no supuesta):
--   1. Las vistas v_billing_masivo_pending / v_billing_masivo_emitible excluyen
--      almuerzos anulados con:
--        WHERE lo.id::text = (t.metadata->>'lunch_order_id')
--      Convertir lo.id (uuid, indexado) a texto impide que PostgreSQL use el
--      índice de lunch_orders para esa comparación.
--   2. Ambas vistas tienen security_invoker = true (correcto por seguridad:
--      respetan RLS del usuario que consulta). Pero eso significa que, para
--      CADA fila candidata de transactions, PostgreSQL reevalúa TODAS las
--      políticas RLS de lunch_orders (que incluyen sub-consultas contra
--      profiles, students y teacher_profiles). Combinado con el punto 1,
--      esto multiplica un costo ya alto por cientos de filas.
--   3. Medido en producción (rol authenticated, con RLS real, admin_general,
--      Nordic, julio 2026, 235 filas): 2.26 segundos. El rol `authenticated`
--      tiene statement_timeout = 8s. Al forzar la consulta contra TODAS las
--      sedes (22,694 filas candidatas) se reprodujo EXACTAMENTE el error
--      57014 que reportó la dueña.
--
-- ── LA SOLUCIÓN ─────────────────────────────────────────────────────────────
-- Se crea una función auxiliar `fn_is_lunch_order_cancelled(uuid)`:
--   · SECURITY DEFINER → se ejecuta con los permisos del dueño de la función
--     (postgres), evitando la reevaluación de RLS de lunch_orders por cada
--     fila candidata de transactions.
--   · Solo devuelve TRUE/FALSE. NUNCA expone columnas ni filas de
--     lunch_orders al que llama. No hay fuga de datos: es una función de
--     verificación puntual sobre un ID que el llamador YA tiene legítimamente
--     (viene de transactions.metadata, tabla a la que ya accedió vía su
--     propio RLS).
--   · Al comparar lo.id (uuid) = p_lunch_order_id (uuid) directamente,
--     PostgreSQL vuelve a poder usar el índice primario de lunch_orders.
--
-- Medido en producción tras el fix (misma prueba, RLS real, admin_general):
--   · Nordic, julio 2026 (235 filas):        2.26s  →  0.023s  (~100x)
--   · TODAS las sedes, todo el histórico (22,694 filas): timeout (>8s) → 1.08s
--
-- ── QUÉ NO CAMBIA (blindaje) ────────────────────────────────────────────────
--   · Ninguna columna, filtro de negocio, redondeo ni regla de IGV cambia.
--   · v_billing_masivo_pending sigue siendo la fuente del cron auto-invoice
--     (sin cambio de comportamiento, solo de velocidad).
--   · v_billing_masivo_emitible sigue siendo la fuente del Cierre Mensual
--     (sin cambio de comportamiento, solo de velocidad).
--   · security_invoker = true se mantiene en ambas vistas: transactions
--     sigue filtrado 100% por el RLS del usuario que consulta.
--   · No se toca Izipay, webhooks, pasarela, ni ninguna tabla de saldo.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1: Función auxiliar (bypass de RLS acotado a un booleano)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_is_lunch_order_cancelled(p_lunch_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.lunch_orders lo
    WHERE  lo.id = p_lunch_order_id
      AND  (lo.status = 'cancelled' OR lo.is_cancelled = true)
  );
$$;

COMMENT ON FUNCTION public.fn_is_lunch_order_cancelled(uuid) IS
  'Devuelve true si el lunch_order dado está anulado (status=cancelled o '
  'is_cancelled=true). SECURITY DEFINER a propósito: se usa dentro de las '
  'vistas de boleteo masivo (v_billing_masivo_pending / _emitible) para '
  'evitar que PostgreSQL reevalúe las políticas RLS completas de '
  'lunch_orders por cada fila candidata de transactions (causaba timeout '
  '57014 en Cierre Mensual — ver migración 20260706). '
  'No expone columnas ni filas de lunch_orders: solo un booleano sobre un '
  'ID que el llamador ya posee legítimamente vía transactions.metadata.';

REVOKE ALL ON FUNCTION public.fn_is_lunch_order_cancelled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_lunch_order_cancelled(uuid) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2: v_billing_masivo_pending (usada por el cron auto-invoice)
-- Idéntica a la definición de 20260605_v_billing_masivo_pending_ssot.sql,
-- salvo el único cambio: el chequeo de almuerzo anulado usa la función.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_billing_masivo_pending
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.school_id,
  t.created_at,
  t.payment_method,
  t.amount,

  (t.created_at AT TIME ZONE 'America/Lima')::date          AS dia_venta_lima,

  CASE
    WHEN lower(btrim(t.payment_method)) = 'mixto'
      THEN round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2)
    ELSE round(abs(t.amount), 2)
  END                                                        AS monto_boleteable,

  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date )     AS dias_desde_venta,

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
  AND lower(btrim(t.payment_method)) IN (
        'yape', 'yape_qr', 'yape_numero',
        'plin', 'plin_qr', 'plin_numero',
        'transferencia', 'transfer',
        'tarjeta', 'card',
        'mixto'
      )
  -- FIX 20260706: antes `lo.id::text = (t.metadata->>'lunch_order_id')`
  -- (rompía el índice y forzaba reevaluar RLS de lunch_orders por fila).
  AND NOT (
        (t.metadata->>'lunch_order_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND public.fn_is_lunch_order_cancelled((t.metadata->>'lunch_order_id')::uuid)
      )
  AND (
        lower(btrim(t.payment_method)) <> 'mixto'
        OR round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2) > 0
      );

COMMENT ON VIEW public.v_billing_masivo_pending IS
  'SSOT del boleteo masivo. Devuelve tickets digitales pendientes con el monto '
  'boleteable correcto (mixto = solo parte no-efectivo) y bandera es_extemporaneo '
  '(candado de fecha SUNAT, 7 días). Usada por el cron auto-invoice. '
  'FIX 20260706: el chequeo de almuerzo anulado usa fn_is_lunch_order_cancelled() '
  'para evitar timeout (57014) por RLS + cast de tipo roto — ver esa migración.';

GRANT SELECT ON public.v_billing_masivo_pending TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3: v_billing_masivo_emitible (usada por Cierre Mensual, Fase 2B)
-- Idéntica a 20260622_fase2a_enqueue_portal_extension.sql, mismo único cambio.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_billing_masivo_emitible
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.school_id,
  t.created_at,
  t.payment_method,
  t.amount,
  t.billing_status,

  (t.created_at AT TIME ZONE 'America/Lima')::date            AS dia_venta_lima,

  CASE
    WHEN lower(btrim(t.payment_method)) = 'mixto'
    THEN round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2)
    ELSE round(abs(t.amount), 2)
  END                                                          AS monto_boleteable,

  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date )       AS dias_desde_venta,

  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date ) > 7   AS es_extemporaneo,

  t.metadata

FROM public.transactions t
WHERE
  t.is_taxable     = true
  AND t.billing_status IN ('pending', 'queued')
  AND t.document_type  = 'ticket'
  AND t.payment_status = 'paid'
  AND COALESCE(t.is_deleted, false) = false
  AND t.amount <> 0
  AND lower(btrim(t.payment_method)) IN (
    'yape', 'yape_qr', 'yape_numero',
    'plin', 'plin_qr', 'plin_numero',
    'transferencia', 'transfer',
    'tarjeta', 'card',
    'mixto'
  )
  -- FIX 20260706: antes `lo.id::text = (t.metadata->>'lunch_order_id')`
  -- (rompía el índice y forzaba reevaluar RLS de lunch_orders por fila).
  AND NOT (
        (t.metadata->>'lunch_order_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND public.fn_is_lunch_order_cancelled((t.metadata->>'lunch_order_id')::uuid)
      )
  AND (
    lower(btrim(t.payment_method)) <> 'mixto'
    OR round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2) > 0
  );

COMMENT ON VIEW public.v_billing_masivo_emitible IS
  'v2 de v_billing_masivo_pending para CierreMensual (Fase 2B). '
  'Incluye billing_status IN (pending, queued): '
  'pending = sin encolar todavía; queued = encolada esperando al worker. '
  'La columna billing_status permite mostrar badges distintos en la UI. '
  'v_billing_masivo_pending queda intacta para el cron auto-invoice. '
  'FIX 20260706: el chequeo de almuerzo anulado usa fn_is_lunch_order_cancelled() '
  'para evitar timeout (57014) por RLS + cast de tipo roto — ver esa migración.';

GRANT SELECT ON public.v_billing_masivo_emitible TO authenticated, service_role;


-- ============================================================================
-- VERIFICACIÓN (ejecutar después de aplicar, son solo SELECT/EXPLAIN)
-- ============================================================================
-- 1) La función existe y es SECURITY DEFINER:
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'fn_is_lunch_order_cancelled';
--
-- 2) Ambas vistas siguen con security_invoker = true (RLS del usuario intacto):
-- SELECT relname, reloptions FROM pg_class
-- WHERE relname IN ('v_billing_masivo_pending','v_billing_masivo_emitible');
--
-- 3) El total de filas coincide con el de antes del fix (misma lógica de negocio):
-- SELECT count(*) FROM v_billing_masivo_emitible;
--
-- 4) Tiempo de respuesta con RLS real (reemplazar el UUID por un usuario real
--    admin_general/gestor_unidad de prueba, y NUNCA correr esto fuera de una
--    transacción con ROLLBACK si se usa para diagnóstico):
-- BEGIN;
--   SET LOCAL role authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<uuid-usuario>', true);
--   EXPLAIN ANALYZE SELECT * FROM v_billing_masivo_emitible
--     WHERE school_id = '<uuid-sede>'
--       AND created_at >= '<inicio-mes>' AND created_at < '<fin-mes>';
-- ROLLBACK;
-- ============================================================================
