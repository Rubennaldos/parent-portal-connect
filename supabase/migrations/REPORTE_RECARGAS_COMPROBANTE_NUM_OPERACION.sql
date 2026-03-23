-- ============================================================
-- REPORTE: Solo recargas con comprobante y número de operación confirmadas
-- Ejecutar en el Editor SQL de Supabase para exportar o auditar
-- ============================================================

SELECT
  ROW_NUMBER() OVER (ORDER BY rr.approved_at DESC NULLS LAST, rr.created_at DESC) AS n,
  p.full_name   AS padre,
  p.email       AS email_padre,
  s.full_name   AS alumno,
  s.grade       AS grado,
  s.section     AS seccion,
  sch.name      AS sede,
  rr.amount     AS monto_soles,
  rr.reference_code AS numero_operacion,
  rr.payment_method AS metodo_pago,
  rr.voucher_url    AS url_comprobante,
  rr.approved_at AT TIME ZONE 'America/Lima' AS aprobado_el,
  aprobador.full_name AS aprobado_por,
  rr.request_type AS tipo_solicitud
FROM recharge_requests rr
INNER JOIN students s ON s.id = rr.student_id
INNER JOIN profiles p ON p.id = s.parent_id
LEFT JOIN schools sch ON sch.id = rr.school_id
LEFT JOIN profiles aprobador ON aprobador.id = rr.approved_by
WHERE rr.status = 'approved'
  AND rr.request_type = 'recharge'
  AND rr.voucher_url IS NOT NULL
  AND TRIM(COALESCE(rr.reference_code, '')) <> ''
ORDER BY rr.approved_at DESC NULLS LAST, rr.created_at DESC;
