-- ============================================================================
-- Vista optimizada para detalle de transacción en módulo de Ventas
-- Retorna un JSON estructurado por transaction_id para evitar cargas innecesarias
-- ============================================================================

CREATE OR REPLACE VIEW public.v_transaction_detail_view AS
SELECT
  t.id AS transaction_id,
  jsonb_build_object(
    'fecha', to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY'),
    'hora', to_char(timezone('America/Lima', t.created_at), 'HH24:MI:SS'),
    'numero_comprobante', COALESCE(t.ticket_code, t.id::text),
    'vendedor_nombre', COALESCE(p.full_name, p.email, 'Sistema'),
    'productos_detalle_json', COALESCE(ti.items_json, '[]'::jsonb),
    'sunat_documento_numero', inv.sunat_documento_numero
  ) AS detail_json
FROM public.transactions t
LEFT JOIN public.profiles p
  ON p.id = t.created_by
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
           jsonb_build_object(
             'description', COALESCE(i.product_name, 'Producto'),
             'qty',         COALESCE(i.quantity, 0),
             'unit_price',  COALESCE(i.unit_price, 0),
             'total',       COALESCE(i.subtotal, 0)
           )
           ORDER BY i.id
         ) AS items_json
  FROM public.transaction_items i
  WHERE i.transaction_id = t.id
) ti ON true
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN i.serie IS NOT NULL AND i.numero IS NOT NULL
        THEN i.serie || '-' || LPAD(i.numero::text, 8, '0')
      ELSE NULL
    END AS sunat_documento_numero
  FROM public.invoices i
  WHERE (i.id = t.invoice_id OR i.transaction_id = t.id)
    AND i.document_type_code IN ('01', '03')
    AND i.sunat_status IN ('accepted', 'processing', 'pending')
  ORDER BY (i.id = t.invoice_id) DESC, i.created_at DESC
  LIMIT 1
) inv ON true;

GRANT SELECT ON public.v_transaction_detail_view TO authenticated;

COMMENT ON VIEW public.v_transaction_detail_view IS
  'Detalle optimizado por transacción: info general + items + documento SUNAT válido.';
