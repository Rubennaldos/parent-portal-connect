-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA FORENSE: Familia Vicuña Pacheco — St. George's Miraflores
-- Fecha: 2026-04-08
-- Objetivo: Rastrear el origen de los "abonos previos" mostrados en el modal
--           y determinar cómo entró dinero con recargas suspendidas.
-- ═══════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════
-- BLOQUE 1: Identificar a los alumnos
-- ════════════════════════════════════

SELECT
  s.id                AS student_id,
  s.full_name,
  s.balance,
  s.free_account,
  s.kiosk_disabled,
  sc.name             AS sede,
  p.full_name         AS nombre_padre,
  p.email             AS email_padre
FROM   students s
JOIN   schools  sc ON sc.id = s.school_id
LEFT   JOIN profiles p ON p.id = s.parent_id
WHERE  s.full_name ILIKE '%Vicu%a%Pacheco%'
   OR  s.full_name ILIKE '%Vicuna%Pacheco%'
   OR  s.full_name ILIKE '%Luhana%Vicu%'
   OR  s.full_name ILIKE '%Luis%Vicu%'
ORDER BY s.full_name;


-- ════════════════════════════════════════════════════════════
-- BLOQUE 2: Todos los movimientos de los últimos 90 días
-- (Reemplaza los UUIDs con los resultados del Bloque 1)
-- ════════════════════════════════════════════════════════════

SELECT
  t.id                                        AS transaction_id,
  t.type,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.description,
  to_char(t.created_at AT TIME ZONE 'America/Lima',
          'DD/MM/YYYY HH24:MI')               AS fecha_lima,

  -- ¿Quién lo creó?
  COALESCE(p_creator.full_name, t.created_by::text, 'Sistema')  AS creado_por,

  -- Rastreo de origen en metadata
  t.metadata->>'source'                       AS fuente,
  t.metadata->>'recharge_request_id'          AS voucher_id,
  t.metadata->>'approved_by'                  AS aprobado_por_id,
  t.metadata->>'payment_approved'             AS fue_aprobado,
  t.metadata->>'payment_source'               AS tipo_pago,
  t.ticket_code

FROM   transactions t
LEFT   JOIN profiles p_creator ON p_creator.id = t.created_by

WHERE  t.student_id IN (
         -- Pega aquí los student_ids del Bloque 1
         -- Ejemplo: 'uuid-luis', 'uuid-luhana'
         SELECT s2.id FROM students s2
         WHERE (s2.full_name ILIKE '%Vicu%a%Pacheco%'
            OR  s2.full_name ILIKE '%Vicuna%Pacheco%'
            OR  s2.full_name ILIKE '%Luhana%Vicu%'
            OR  s2.full_name ILIKE '%Luis%Vicu%')
       )
  AND  t.created_at >= NOW() - INTERVAL '90 days'
  AND  t.is_deleted = false
ORDER BY t.created_at DESC;


-- ════════════════════════════════════════════════════════════════
-- BLOQUE 3: Historial COMPLETO de recharge_requests de la familia
-- ════════════════════════════════════════════════════════════════

SELECT
  rr.id                AS request_id,
  rr.request_type,
  rr.amount,
  rr.status,
  rr.payment_method,
  rr.reference_code,
  to_char(rr.created_at  AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS creado,
  to_char(rr.approved_at AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS aprobado,
  COALESCE(p_admin.full_name, rr.approved_by::text) AS aprobado_por,
  rr.rejection_reason,
  rr.paid_transaction_ids,
  rr.wallet_amount,
  s.full_name          AS alumno
FROM   recharge_requests rr
JOIN   students          s    ON s.id = rr.student_id
LEFT   JOIN profiles     p_admin ON p_admin.id = rr.approved_by
WHERE  s.full_name ILIKE '%Vicu%a%Pacheco%'
   OR  s.full_name ILIKE '%Vicuna%Pacheco%'
   OR  s.full_name ILIKE '%Luhana%Vicu%'
   OR  s.full_name ILIKE '%Luis%Vicu%'
ORDER BY rr.created_at DESC;


-- ════════════════════════════════════════════════════════════════
-- BLOQUE 4: Rastrear el origen de los "Abonos previos"
-- (transacciones de tipo 'recharge' o montos positivos)
-- ════════════════════════════════════════════════════════════════

SELECT
  t.id,
  s.full_name         AS alumno,
  t.type,
  t.amount,
  t.payment_method,
  t.description,
  to_char(t.created_at AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS fecha,
  t.metadata->>'source'               AS fuente,
  t.metadata->>'recharge_request_id'  AS voucher_origen,
  COALESCE(p.full_name, t.created_by::text, 'Sistema') AS creado_por,
  -- ¿Fue creado por un admin? (distinto al parent_id del alumno)
  CASE WHEN t.created_by IS NOT NULL AND t.created_by <> s.parent_id
    THEN '⚠️ ADMIN' ELSE 'Padre/Sistema' END AS origen_rol
FROM   transactions t
JOIN   students  s ON s.id = t.student_id
LEFT   JOIN profiles p ON p.id = t.created_by
WHERE  (s.full_name ILIKE '%Vicu%a%Pacheco%'
   OR   s.full_name ILIKE '%Vicuna%Pacheco%'
   OR   s.full_name ILIKE '%Luhana%Vicu%'
   OR   s.full_name ILIKE '%Luis%Vicu%')
  AND  t.type IN ('recharge', 'deposit', 'manual_adjustment', 'adjustment')
  AND  t.is_deleted = false
ORDER BY t.created_at DESC;


-- ════════════════════════════════════════════════════════════════
-- BLOQUE 5: Verificar si hay recharge_requests aprobados
--           DESPUÉS de que se activó el mantenimiento (~01/04/2026)
--           (posible backdoor: request creado antes, aprobado durante mantenimiento)
-- ════════════════════════════════════════════════════════════════

SELECT
  rr.id,
  s.full_name,
  rr.request_type,
  rr.amount,
  rr.status,
  to_char(rr.created_at  AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS fecha_creacion,
  to_char(rr.approved_at AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS fecha_aprobacion,
  COALESCE(p.full_name, rr.approved_by::text) AS aprobado_por,
  CASE
    WHEN rr.created_at < '2026-04-01' AND rr.approved_at >= '2026-04-01'
      THEN '🚨 CREADO ANTES / APROBADO DURANTE MANTENIMIENTO'
    WHEN rr.approved_at >= '2026-04-01'
      THEN '⚠️ Aprobado durante período de mantenimiento'
    ELSE '✅ Normal'
  END AS alerta
FROM   recharge_requests rr
JOIN   students  s ON s.id = rr.student_id
LEFT   JOIN profiles p ON p.id = rr.approved_by
WHERE  rr.request_type = 'recharge'
  AND  rr.status = 'approved'
  AND  rr.approved_at >= '2026-03-15'  -- 3 semanas antes para ver contexto
ORDER BY rr.approved_at DESC
LIMIT 50;
