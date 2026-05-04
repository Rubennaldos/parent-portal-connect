-- ============================================================================
-- Reparación puntual: T-MAD-000118 / T-MAD-000119 (Plin debt_payment 23/04)
--
-- CONTEXTO (evidencia en DB):
--   Voucher aprobado con lunch_order_ids del 23/04, pero la compra pagada
--   quedó con metadata.lunch_order_id de pedidos del 22/04 y recharge_request_id
--   del voucher (mismatch documentado en incidente v8.0 emergencia).
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   Corrige SOLO esas dos filas: metadata.lunch_order_id al UUID del pedido
--   que declara el recharge_request, y description alineada a ese lunch_order.
--   No cambia amount ni payment_status (sigue siendo un único -16 paid por alumno).
--   Inserta audit_billing_logs si el UPDATE afectó fila (idempotente).
--
-- PREREQUISITO PARA "QUE NO VUELVA A PASAR":
--   Debe estar aplicada 20260423_fix_process_approval_v81.sql (RPC v8.1).
--   Esta migración NO reemplaza a v8.1.
--
-- NO CUBRE:
--   Los demás recharge_requests "huérfanos" del inventario 22–23/04; requieren
--   el mismo nivel de evidencia antes de tocar datos.
-- ============================================================================

-- ── 1) T-MAD-000118 → pedido f4f4e00a… (voucher 04760a73… / ref 39459614) ───
WITH u AS (
  UPDATE public.transactions t
  SET
    description = COALESCE(
      (
        SELECT
          'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
          CASE
            WHEN COALESCE(lo.quantity, 1) > 1 THEN ' (' || lo.quantity::text || 'x)'
            ELSE ''
          END ||
          ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
        FROM public.lunch_orders lo
        LEFT JOIN public.lunch_categories lc ON lc.id = lo.category_id
        WHERE lo.id = 'f4f4e00a-81c8-4823-bb60-a219200d1a47'::uuid
      ),
      t.description
    ),
    metadata = COALESCE(t.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'lunch_order_id', 'f4f4e00a-81c8-4823-bb60-a219200d1a47',
        'lunch_metadata_repair', '20260424_tmad_plin',
        'lunch_metadata_repair_prior_lunch_order_id', t.metadata->>'lunch_order_id'
      )
  WHERE t.id = '76f732f1-7be5-41c7-9738-5a8e20850a2e'::uuid
    AND t.is_deleted = false
    AND t.type = 'purchase'
    AND t.payment_status = 'paid'
    AND (t.metadata->>'recharge_request_id') = '04760a73-f3f5-4366-8b76-af6841efb107'
    AND (t.metadata->>'lunch_order_id') = '5294b731-a753-4484-9b06-21372783b208'
  RETURNING t.id, t.school_id, t.ticket_code
)
INSERT INTO public.audit_billing_logs (
  action_type,
  record_id,
  table_name,
  changed_by_user_id,
  school_id,
  new_data
)
SELECT
  'lunch_metadata_repair',
  u.id,
  'transactions',
  NULL,
  u.school_id,
  jsonb_build_object(
    'ticket_code', u.ticket_code,
    'lunch_order_id_before', '5294b731-a753-4484-9b06-21372783b208',
    'lunch_order_id_after', 'f4f4e00a-81c8-4823-bb60-a219200d1a47',
    'recharge_request_id', '04760a73-f3f5-4366-8b76-af6841efb107',
    'reference_code', '39459614',
    'migration', '20260424_repair_tmad_plin_lunch_order_metadata'
  )
FROM u;

-- ── 2) T-MAD-000119 → pedido 1e643fee… (voucher 7a73d09e… / ref 39489864) ───
WITH u AS (
  UPDATE public.transactions t
  SET
    description = COALESCE(
      (
        SELECT
          'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
          CASE
            WHEN COALESCE(lo.quantity, 1) > 1 THEN ' (' || lo.quantity::text || 'x)'
            ELSE ''
          END ||
          ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
        FROM public.lunch_orders lo
        LEFT JOIN public.lunch_categories lc ON lc.id = lo.category_id
        WHERE lo.id = '1e643fee-780c-449d-b637-99650bb5fe6e'::uuid
      ),
      t.description
    ),
    metadata = COALESCE(t.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'lunch_order_id', '1e643fee-780c-449d-b637-99650bb5fe6e',
        'lunch_metadata_repair', '20260424_tmad_plin',
        'lunch_metadata_repair_prior_lunch_order_id', t.metadata->>'lunch_order_id'
      )
  WHERE t.id = 'dd5d807a-f192-413f-8cb1-b5a5f00b9dd7'::uuid
    AND t.is_deleted = false
    AND t.type = 'purchase'
    AND t.payment_status = 'paid'
    AND (t.metadata->>'recharge_request_id') = '7a73d09e-7880-49bd-8b58-4769e31ad77e'
    AND (t.metadata->>'lunch_order_id') = '23305b00-a471-46f0-92c5-e67d52c6e143'
  RETURNING t.id, t.school_id, t.ticket_code
)
INSERT INTO public.audit_billing_logs (
  action_type,
  record_id,
  table_name,
  changed_by_user_id,
  school_id,
  new_data
)
SELECT
  'lunch_metadata_repair',
  u.id,
  'transactions',
  NULL,
  u.school_id,
  jsonb_build_object(
    'ticket_code', u.ticket_code,
    'lunch_order_id_before', '23305b00-a471-46f0-92c5-e67d52c6e143',
    'lunch_order_id_after', '1e643fee-780c-449d-b637-99650bb5fe6e',
    'recharge_request_id', '7a73d09e-7880-49bd-8b58-4769e31ad77e',
    'reference_code', '39489864',
    'migration', '20260424_repair_tmad_plin_lunch_order_metadata'
  )
FROM u;

SELECT '20260424_repair_tmad_plin_lunch_order_metadata aplicada (0–2 filas si ya estaba ok)' AS resultado;
