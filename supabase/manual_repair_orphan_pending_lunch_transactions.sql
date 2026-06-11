-- =============================================================================
-- REPARACIÓN MANUAL (no es migración automática): huérfanos lunch_order
--
-- PROBLEMA:
--   Pedido en lunch_orders ya anulado (is_cancelled = true) pero la compra
--   en transactions sigue payment_status = 'pending' → deuda fantasma en UI.
--
-- QUÉ HACE:
--   Pone payment_status = 'cancelled' en esas filas y añade trazas en metadata.
--   El trigger trg_transactions_balance_sync recalcula students.balance vía
--   fn_sync_student_balance (solo suma 'pending').
--
-- RIESGOS (leer antes de ejecutar):
--   • Si is_cancelled quedó mal por datos sucios manuales, podrías “perdonar”
--     una deuda real. Por eso: PREVIEW obligatorio y transacción explícita.
--   • No toca filas is_deleted = true ni type distinto de 'purchase'.
--
-- USO recomendado (SQL Editor Supabase):
--   1) Ejecutar solo el bloque PREVIEW y revisar filas.
--   2) Aplicar con el bloque «OPCIÓN A» (una sola vez, autocommit) — evita el
--      error clásico: BEGIN sin COMMIT → al cerrar la sesión Postgres hace
--      ROLLBACK y el RETURNING mostró cancelled pero la base siguió en pending.
--   3) Si prefieres transacción explícita, usa OPCIÓN B y NO cierres la pestaña
--      hasta ejecutar COMMIT; o ROLLBACK si algo no cuadra.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) PREVIEW — revisar candidatas (no modifica nada)
--     Columnas: ticket, alumno, monto a limpiar (ABS del compromiso), total filas.
-- -----------------------------------------------------------------------------
SELECT
  t.ticket_code                               AS codigo_ticket,
  COALESCE(s.full_name, '(sin alumno)')       AS nombre_alumno,
  ROUND(ABS(t.amount)::numeric, 2)            AS monto_a_limpiar_pen,
  COUNT(*) OVER ()                            AS total_filas_afectadas,
  t.id                                        AS transaction_id,
  t.student_id,
  t.amount                                    AS amount_raw,
  t.created_at,
  t.metadata->>'lunch_order_id'               AS lunch_order_id,
  lo.status                                   AS lunch_status,
  lo.cancelled_at
FROM public.transactions t
INNER JOIN public.lunch_orders lo
  ON lo.id = (t.metadata->>'lunch_order_id')::uuid
 AND lo.student_id IS NOT DISTINCT FROM t.student_id
LEFT JOIN public.students s
  ON s.id = t.student_id
WHERE t.is_deleted = false
  AND t.type = 'purchase'
  AND t.payment_status = 'pending'
  AND lo.is_cancelled = true
  AND (t.metadata ? 'lunch_order_id')
  AND (t.metadata->>'lunch_order_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ORDER BY t.created_at;

-- -----------------------------------------------------------------------------
-- 2) APLICAR
-- -----------------------------------------------------------------------------

-- ── OPCIÓN A (recomendada en SQL Editor): un solo UPDATE — se confirma solo ──
UPDATE public.transactions t
SET
  payment_status = 'cancelled',
  metadata = COALESCE(t.metadata, '{}'::jsonb)
    || jsonb_build_object(
         'cancelled_at', to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'cancel_reason',
           'DATA_REPAIR: lunch_orders.is_cancelled=true pero transactions permaneció pending (sincronización huérfana)'
       )
FROM public.lunch_orders lo
WHERE lo.id = (t.metadata->>'lunch_order_id')::uuid
  AND lo.student_id IS NOT DISTINCT FROM t.student_id
  AND t.is_deleted = false
  AND t.type = 'purchase'
  AND t.payment_status = 'pending'
  AND lo.is_cancelled = true
  AND (t.metadata ? 'lunch_order_id')
  AND (t.metadata->>'lunch_order_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RETURNING
  t.id,
  t.ticket_code,
  t.student_id,
  t.payment_status;

-- Luego ejecutar de nuevo el SELECT de verificación (count huérfanos) del chat.

-- ── OPCIÓN B: transacción explícita (todo en un mismo Run) ───────────────────
-- BEGIN;
-- UPDATE public.transactions t
-- SET
--   payment_status = 'cancelled',
--   metadata = COALESCE(t.metadata, '{}'::jsonb)
--     || jsonb_build_object(
--          'cancelled_at', to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
--          'cancel_reason',
--            'DATA_REPAIR: lunch_orders.is_cancelled=true pero transactions permaneció pending (sincronización huérfana)'
--        )
-- FROM public.lunch_orders lo
-- WHERE lo.id = (t.metadata->>'lunch_order_id')::uuid
--   AND lo.student_id IS NOT DISTINCT FROM t.student_id
--   AND t.is_deleted = false
--   AND t.type = 'purchase'
--   AND t.payment_status = 'pending'
--   AND lo.is_cancelled = true
--   AND (t.metadata ? 'lunch_order_id')
--   AND (t.metadata->>'lunch_order_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
-- RETURNING t.id, t.ticket_code, t.payment_status;
-- COMMIT;
