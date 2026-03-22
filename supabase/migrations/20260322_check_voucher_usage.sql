CREATE OR REPLACE FUNCTION check_voucher_usage(p_operation_number TEXT)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
AS $body$
SELECT json_build_object(

  'transactions', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        tx.id,
        tx.created_at,
        tx.amount,
        tx.payment_method,
        tx.ticket_code,
        tx.payment_status,
        tx.metadata->>'operation_number'   AS operation_number,
        tx.metadata->>'source'             AS source,
        tx.metadata->>'lunch_order_id'     AS lunch_order_id,
        s.full_name                        AS student_name,
        sc.name                            AS school_name,
        p.full_name                        AS created_by_name,
        p.email                            AS created_by_email
      FROM transactions tx
      LEFT JOIN students  s  ON s.id  = tx.student_id
      LEFT JOIN schools   sc ON sc.id = tx.school_id
      LEFT JOIN profiles  p  ON p.id  = tx.created_by
      WHERE UPPER(TRIM(tx.metadata->>'operation_number')) = UPPER(TRIM(p_operation_number))
      ORDER BY tx.created_at DESC
      LIMIT 20
    ) t
  ),

  'recharge_requests', (
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
    FROM (
      SELECT
        rr.id,
        rr.created_at,
        rr.amount,
        rr.payment_method,
        rr.reference_code,
        rr.status,
        rr.request_type,
        rr.voucher_url,
        rr.notes,
        rr.description,
        rr.approved_at,
        s.full_name   AS student_name,
        pr.full_name  AS parent_name,
        pr.email      AS parent_email,
        pa.full_name  AS approved_by_name,
        sc.name       AS school_name
      FROM recharge_requests rr
      LEFT JOIN students  s   ON s.id   = rr.student_id
      LEFT JOIN profiles  pr  ON pr.id  = rr.parent_id
      LEFT JOIN profiles  pa  ON pa.id  = rr.approved_by
      LEFT JOIN schools   sc  ON sc.id  = rr.school_id
      WHERE UPPER(TRIM(rr.reference_code)) = UPPER(TRIM(p_operation_number))
      ORDER BY rr.created_at DESC
      LIMIT 20
    ) r
  )

);
$body$;
