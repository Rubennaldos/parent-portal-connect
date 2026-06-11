-- ============================================================================
-- Soporte padres: WhatsApp de administración por sede
-- 2026-05-24
--
-- - Columna schools.admin_whatsapp (configurable por sede)
-- - get_student_recharge_ledger devuelve bloque school con admin_whatsapp
--   (SSOT para modal de soporte y monedero del alumno activo)
-- Sin cambios a políticas RLS.
-- ============================================================================

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admin_whatsapp character varying(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_admin_whatsapp_format_chk'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_admin_whatsapp_format_chk
      CHECK (
        admin_whatsapp IS NULL
        OR btrim(admin_whatsapp) = ''
        OR btrim(admin_whatsapp) ~ '^\+?[0-9]{10,15}$'
      );
  END IF;
END $$;

COMMENT ON COLUMN public.schools.admin_whatsapp IS
  'Número WhatsApp de administración de la sede (solo dígitos, ej. 51999999999). '
  'Usado por el portal de padres — opción Gestión de Sede.';

-- ── get_student_recharge_ledger: incluir sede vinculada al alumno ─────────────
CREATE OR REPLACE FUNCTION public.get_student_recharge_ledger(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ledger          jsonb;
  v_pending         jsonb;
  v_total_remaining numeric := 0;
  v_pending_total   numeric := 0;
  v_school          jsonb;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object(
      'ledger',          '[]'::jsonb,
      'pending',         '[]'::jsonb,
      'total_remaining', 0,
      'pending_total',   0,
      'school',          NULL
    );
  END IF;

  SELECT jsonb_build_object(
    'id',              s.id,
    'name',            s.name,
    'admin_whatsapp',  s.admin_whatsapp
  )
  INTO v_school
  FROM public.students st
  JOIN public.schools s ON s.id = st.school_id
  WHERE st.id = p_student_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'rec_code',            'REC-' || LPAD(sub.rn::text, 3, '0'),
        'recharge_request_id', sub.recharge_request_id,
        'recharge_amount',     sub.recharge_amount,
        'consumed',            sub.consumed_from_this_recharge,
        'remaining',           sub.recharge_remaining,
        'effective_at',        sub.recharge_effective_at,
        'status',              sub.recharge_status,
        'nro_operacion',       sub.nro_operacion,
        'payment_method',      sub.recharge_payment_method
      )
      ORDER BY sub.rn DESC
    ),
    '[]'::jsonb
  )
  INTO v_ledger
  FROM (
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY vrl.recharge_effective_at ASC, vrl.recharge_request_id ASC
      )                                     AS rn,
      vrl.recharge_request_id,
      vrl.recharge_amount,
      vrl.consumed_from_this_recharge,
      vrl.recharge_remaining,
      vrl.recharge_effective_at,
      vrl.recharge_status,
      vrl.nro_operacion,
      vrl.recharge_payment_method
    FROM public.view_recharge_ledger vrl
    WHERE vrl.student_id = p_student_id
  ) sub;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',             rr.id,
          'amount',         rr.amount,
          'payment_method', rr.payment_method,
          'reference_code', rr.reference_code,
          'created_at',     rr.created_at
        )
        ORDER BY rr.created_at DESC
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM(rr.amount), 0)
  INTO v_pending, v_pending_total
  FROM public.recharge_requests rr
  WHERE rr.student_id   = p_student_id
    AND rr.request_type = 'recharge'
    AND rr.status       = 'pending';

  SELECT COALESCE(
    (SELECT MAX(vrl2.recharge_remaining_student)
     FROM   public.view_recharge_ledger vrl2
     WHERE  vrl2.student_id = p_student_id),
    0
  ) INTO v_total_remaining;

  RETURN jsonb_build_object(
    'ledger',          v_ledger,
    'pending',         v_pending,
    'total_remaining', v_total_remaining,
    'pending_total',   v_pending_total,
    'school',          v_school
  );
END;
$fn$;

COMMENT ON FUNCTION public.get_student_recharge_ledger(uuid)
IS 'Monedero REC + sede del alumno (name, admin_whatsapp). '
   'Incluye pending_total (Regla 11.A). SSOT: view_recharge_ledger. No modifica tablas.';

SELECT 'OK: schools.admin_whatsapp + get_student_recharge_ledger.school' AS resultado;
