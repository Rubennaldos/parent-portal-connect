-- ============================================================
-- Fase 6.1 — Combos con archivado + vigencia oficial (Lima)
-- ============================================================
-- Objetivo:
-- 1) No borrar historial: soft-delete con is_archived
-- 2) Vigencia oficial desde BD (America/Lima), no desde frontend
-- 3) POS/kiosco consumen combos "vendibles" por sede en un solo RPC
--
-- NOTA:
-- - Reutilizamos valid_from / valid_until como unica fuente temporal.
-- - No agregamos starts_at / ends_at para evitar "dos relojes".
-- ============================================================

ALTER TABLE public.combos
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.combos
ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id);

COMMENT ON COLUMN public.combos.is_archived IS
'Soft delete de combo. true = archivado (no vendible), sin perder trazabilidad historica.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'combos_valid_date_range_chk'
      AND conrelid = 'public.combos'::regclass
  ) THEN
    ALTER TABLE public.combos
    ADD CONSTRAINT combos_valid_date_range_chk
    CHECK (
      valid_from IS NULL
      OR valid_until IS NULL
      OR valid_from <= valid_until
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_combos_archive_active_dates
  ON public.combos (is_archived, active, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_combos_school_id
  ON public.combos (school_id);

-- Estado legible para paneles administrativos.
CREATE OR REPLACE VIEW public.v_combos_runtime_status AS
WITH now_lima AS (
  SELECT timezone('America/Lima', now())::date AS today_lima
)
SELECT
  c.id,
  c.name,
  c.active,
  c.is_archived,
  c.valid_from,
  c.valid_until,
  CASE
    WHEN c.is_archived THEN 'archivado'
    WHEN NOT c.active THEN 'pausado'
    WHEN c.valid_from IS NOT NULL AND c.valid_from > nl.today_lima THEN 'programado'
    WHEN c.valid_until IS NOT NULL AND c.valid_until < nl.today_lima THEN 'vencido'
    ELSE 'vigente'
  END AS runtime_status,
  (
    NOT c.is_archived
    AND c.active
    AND (c.valid_from IS NULL OR c.valid_from <= nl.today_lima)
    AND (c.valid_until IS NULL OR c.valid_until >= nl.today_lima)
  ) AS is_sellable_now
FROM public.combos c
CROSS JOIN now_lima nl;

COMMENT ON VIEW public.v_combos_runtime_status IS
'Estado de combos calculado con fecha oficial Lima. Fuente de verdad para semaforo de vigencia.';

-- RPC sellable para POS/kiosco con guardas de sede por rol.
DROP FUNCTION IF EXISTS public.get_active_combos_for_school(UUID);

CREATE OR REPLACE FUNCTION public.get_active_combos_for_school(p_school_id UUID)
RETURNS TABLE (
  combo_id UUID,
  combo_name VARCHAR,
  combo_description TEXT,
  combo_price DECIMAL,
  combo_image_url TEXT,
  runtime_status TEXT,
  products JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_user_school UUID;
  v_today_lima DATE := timezone('America/Lima', now())::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sesión requerida';
  END IF;

  SELECT role, school_id
    INTO v_role, v_user_school
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'PROFILE_REQUIRED: perfil no encontrado';
  END IF;

  -- Operativos solo consultan su propia sede.
  IF v_role IN ('gestor_unidad', 'cajero', 'operador_caja') THEN
    IF v_user_school IS NULL THEN
      RAISE EXCEPTION 'SCHOOL_REQUIRED: usuario sin sede asignada';
    END IF;
    IF p_school_id IS DISTINCT FROM v_user_school THEN
      RAISE EXCEPTION 'SCHOOL_SCOPE_DENIED: solo puedes consultar tu propia sede';
    END IF;
  ELSIF v_role NOT IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED: rol no autorizado para consultar combos activos';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.description,
    c.combo_price,
    c.image_url,
    v.runtime_status,
    json_agg(
      json_build_object(
        'product_id', ci.product_id,
        'product_name', p.name,
        'quantity', ci.quantity,
        'has_stock', p.has_stock,
        'price', p.price_sale
      )
      ORDER BY p.name
    )::json AS products
  FROM public.combos c
  JOIN public.v_combos_runtime_status v
    ON v.id = c.id
  JOIN public.combo_items ci
    ON ci.combo_id = c.id
  JOIN public.products p
    ON p.id = ci.product_id
  WHERE v.is_sellable_now
    AND (
      c.school_id = p_school_id
      OR c.school_ids IS NULL
      OR cardinality(c.school_ids) = 0
      OR p_school_id::text = ANY(c.school_ids::text[])
    )
  GROUP BY
    c.id, c.name, c.description, c.combo_price, c.image_url, v.runtime_status;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_combos_for_school(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_combos_for_school(UUID) TO authenticated;
