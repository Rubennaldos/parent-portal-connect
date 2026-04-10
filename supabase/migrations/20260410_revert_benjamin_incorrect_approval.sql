-- ============================================================
-- CORRECCIÓN FINANCIERA: 13 almuerzos de Benjamín Torres Lázaro
-- ============================================================
-- Problema:
--   Admin Ericka cobró 13 almuerzos futuros (abril 10-28) usando
--   op# de marzo. Las transacciones tienen boleta SUNAT (BSM3-269)
--   → el trigger fn_prevent_modifying_sent_transactions bloquea revertir.
--
-- Solución:
--   1. Actualizar prevent_duplicate_lunch_transaction para permitir
--      transacciones compensatorias (flag: source='compensacion').
--   2. Crear 13 nuevas transacciones PENDING como deuda real.
--   3. Revertir lunch_orders futuros a 'pending'.
--   4. Registrar en audit log.
-- ============================================================

BEGIN;

-- ── PASO 0: ACTUALIZAR TRIGGER PARA PERMITIR COMPENSACIONES ──────────────
-- El trigger devuelve NULL (bloquea) si ya hay una tx para el mismo
-- lunch_order_id. Añadimos una excepción: si metadata->>'source' = 'compensacion',
-- se permite la inserción aunque ya exista otra transacción para ese orden.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_lunch_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing_count INTEGER;
  v_lunch_order_id TEXT;
BEGIN
  IF NEW.metadata ? 'lunch_order_id' AND NEW.type = 'purchase' THEN
    -- Excepción: transacciones compensatorias explícitas siempre se permiten
    IF (NEW.metadata->>'source') = 'compensacion' THEN
      RETURN NEW;
    END IF;

    v_lunch_order_id := NEW.metadata->>'lunch_order_id';

    SELECT COUNT(*) INTO v_existing_count
    FROM transactions
    WHERE metadata->>'lunch_order_id' = v_lunch_order_id
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND payment_status != 'cancelled'
      AND is_deleted = false;

    IF v_existing_count > 0 THEN
      RAISE NOTICE '⚠️ Ya existe una transacción activa para lunch_order_id: %. No se creará duplicado.', v_lunch_order_id;
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DO $$ BEGIN RAISE NOTICE '✅ PASO 0 OK: Trigger actualizado para permitir compensaciones.'; END $$;


-- ── PASO 1: VERIFICAR PRECONDICIÓN ────────────────────────────────────────
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)
  INTO   v_count
  FROM   transactions
  WHERE  id IN (
    '7925eaaf-73b8-4514-a059-defcee55f61d',
    'cd39c714-07d9-4a88-8e6b-7df47aa2381c',
    'd1b49f32-5261-45aa-8ae2-805b2cba4a29',
    '5bb95fd3-d065-4117-8d2d-e72298b32058',
    'cabbf484-31e9-4fe3-8164-f1f48e4c46f1',
    '0e410df8-0dc3-4424-a8f4-32861f38c5ed',
    '8fa26f44-f719-4b89-8911-f126e0f858ca',
    '5541bb34-f98f-4f40-bcfb-80d4a53e0db8',
    '4ff96b3e-161f-4628-a0b3-5c2bd91a51b5',
    'd2e9a7e4-c28f-46b0-9483-1cbec105896b',
    '7239bb59-99d9-4ad6-9e6e-55df9cd78e3a',
    'cee27c7e-fe78-41a1-ad39-1436640c8578',
    '7719060c-1e80-4fb1-853a-d06e802adf9b'
  )
  AND payment_status   = 'paid'
  AND billing_status   = 'sent'
  AND operation_number = '15200963';

  IF v_count <> 13 THEN
    RAISE EXCEPTION
      'PRECONDICIÓN FALLIDA: Se esperaban 13 transacciones, se encontraron %. '
      'Revisar manualmente.', v_count;
  END IF;

  RAISE NOTICE '✅ PASO 1 OK: 13 transacciones originales verificadas.';
END $$;


-- ── PASO 2: ANTI-DUPLICADO ────────────────────────────────────────────────
DO $$
DECLARE
  v_existing integer;
BEGIN
  SELECT COUNT(*)
  INTO   v_existing
  FROM   transactions
  WHERE  metadata->>'source'                     = 'compensacion'
    AND  metadata->>'compensacion_tx_original'  IS NOT NULL
    AND  payment_status                          = 'pending'
    AND  student_id                              = 'b7ff2764-7db0-4349-90cb-8792e2a8a7be';

  IF v_existing >= 13 THEN
    RAISE EXCEPTION
      'ANTI-DUPLICADO: Ya existen % compensatorias para este alumno. '
      'Esta migración ya fue aplicada.', v_existing;
  END IF;

  RAISE NOTICE '✅ PASO 2 OK: Sin duplicados.';
END $$;


-- ── PASO 3: CREAR TRANSACCIONES COMPENSATORIAS ────────────────────────────
-- Las compensatorias SÍ llevan lunch_order_id en metadata, porque ahora
-- el trigger permite source='compensacion'. Esto las identifica como
-- almuerzos en CXC y en el portal del padre.
INSERT INTO transactions (
  type, amount, payment_status, payment_method, operation_number,
  description, student_id, school_id, is_deleted,
  is_taxable, billing_status, metadata
)
SELECT
  'purchase'                         AS type,
  t.amount                           AS amount,
  'pending'                          AS payment_status,
  NULL                               AS payment_method,
  NULL                               AS operation_number,
  REPLACE(t.description, 'Almuerzo', '[CORRECCIÓN] Almuerzo') AS description,
  t.student_id,
  t.school_id,
  false                              AS is_deleted,
  false                              AS is_taxable,
  'excluded'                         AS billing_status,
  jsonb_build_object(
    'lunch_order_id',                 t.metadata->>'lunch_order_id',
    'source',                         'compensacion',
    'compensacion_tx_original',       t.id::text,
    'compensacion_motivo',
      'Cobro incorrecto el 2026-04-05 por admin Ericka Orrego Lava '
      'usando op# 15200963 del mes de marzo. '
      'Esta transacción representa la deuda real del periodo.'
  )                                  AS metadata
FROM transactions t
WHERE t.id IN (
  '7925eaaf-73b8-4514-a059-defcee55f61d',
  'cd39c714-07d9-4a88-8e6b-7df47aa2381c',
  'd1b49f32-5261-45aa-8ae2-805b2cba4a29',
  '5bb95fd3-d065-4117-8d2d-e72298b32058',
  'cabbf484-31e9-4fe3-8164-f1f48e4c46f1',
  '0e410df8-0dc3-4424-a8f4-32861f38c5ed',
  '8fa26f44-f719-4b89-8911-f126e0f858ca',
  '5541bb34-f98f-4f40-bcfb-80d4a53e0db8',
  '4ff96b3e-161f-4628-a0b3-5c2bd91a51b5',
  'd2e9a7e4-c28f-46b0-9483-1cbec105896b',
  '7239bb59-99d9-4ad6-9e6e-55df9cd78e3a',
  'cee27c7e-fe78-41a1-ad39-1436640c8578',
  '7719060c-1e80-4fb1-853a-d06e802adf9b'
);

DO $$ BEGIN RAISE NOTICE '✅ PASO 3 OK: Compensatorias insertadas.'; END $$;


-- ── PASO 4: REVERTIR LUNCH_ORDERS FUTUROS A PENDING ──────────────────────
UPDATE lunch_orders
SET
  status       = 'pending',
  delivered_at = NULL
WHERE id IN (
  '564feb47-775c-47aa-b9b0-2f89da3d2d04',
  '92a9235a-5ac1-4cee-898b-a15ab6d38d68',
  'ac9b1b49-d9f4-44aa-9735-df9e8c94e92b',
  'f8cac91f-32e4-43c7-b0b6-4517a636dcfd',
  'ace6d386-a028-422e-af53-34c937df9dfe',
  '4dc82f8e-41a0-456c-a360-34f2ca8abfc4',
  '7c7585e2-b86d-42fd-9d04-9cb19649aa90',
  '66f87241-d100-47ae-b15e-f825dae6fe93',
  '26cec251-7f5d-43e3-87dd-60044ad40e70',
  'c4c0ab19-8266-4734-92e5-7a4efc38b75c',
  'c1c32527-c6b6-447f-9079-79ed557c1a62',
  '33d33249-8080-48bf-a973-5cd06bbb7f8d',
  '062f462e-0565-46e5-9c86-71c4e0b60b8c'
)
AND order_date   >= CURRENT_DATE
AND status        = 'delivered'
AND is_cancelled  = false;

DO $$ BEGIN RAISE NOTICE '✅ PASO 4 OK: Lunch orders futuros revertidos a pending.'; END $$;


-- ── PASO 5: AUDIT LOG ─────────────────────────────────────────────────────
INSERT INTO huella_digital_logs (
  usuario_id, accion, modulo, contexto, school_id, creado_at
)
SELECT
  NULL,
  'CORRECCION_COBRO_INCORRECTO',
  'COBRANZAS',
  jsonb_build_object(
    'motivo',
      'Admin Ericka (90c5d1af) cobró 13 almuerzos futuros (abril 10-28) '
      'con op# 15200963 de marzo. Boleta SUNAT BSM3-00000269 bloquea reversión. '
      'Se crearon 13 transacciones compensatorias pending. Deuda: S/ 208.',
    'alumno',                  'Benjamín Torres Lázaro',
    'student_id',              'b7ff2764-7db0-4349-90cb-8792e2a8a7be',
    'admin_que_cobro_mal',     '90c5d1af-aefe-4817-8d4c-3ad411291a93',
    'boleta_sunat',            'BSM3-00000269',
    'monto_deuda_nueva_soles', 208,
    'approach',                'compensating_transactions_with_lunch_order_id'
  ),
  (SELECT school_id FROM students WHERE id = 'b7ff2764-7db0-4349-90cb-8792e2a8a7be' LIMIT 1),
  NOW();

DO $$ BEGIN RAISE NOTICE '✅ PASO 5 OK: Audit log registrado.'; END $$;


-- ── VERIFICACIÓN FINAL ────────────────────────────────────────────────────
DO $$
DECLARE
  v_comp_count  integer;
  v_total_monto numeric;
BEGIN
  SELECT COUNT(*), SUM(ABS(amount))
  INTO   v_comp_count, v_total_monto
  FROM   transactions
  WHERE  metadata->>'source'                    = 'compensacion'
    AND  metadata->>'compensacion_tx_original' IS NOT NULL
    AND  payment_status                         = 'pending'
    AND  student_id                             = 'b7ff2764-7db0-4349-90cb-8792e2a8a7be'
    AND  is_deleted                             = false;

  IF v_comp_count <> 13 THEN
    RAISE EXCEPTION
      'VERIFICACIÓN FINAL FALLIDA: se esperaban 13, hay %. ROLLBACK.',
      v_comp_count;
  END IF;

  RAISE NOTICE
    '✅ VERIFICACIÓN FINAL OK: % transacciones compensatorias. S/ % de deuda recuperada.',
    v_comp_count, v_total_monto;
END $$;

COMMIT;
