-- ============================================================
-- Fase 6.2B — Estado runtime de promociones (hora Lima)
-- ============================================================
-- Propósito: permitir filtros administrativos por estado sin depender
-- del reloj del navegador.

CREATE OR REPLACE VIEW public.v_promotions_runtime_status AS
WITH now_lima AS (
  SELECT timezone('America/Lima', now())::date AS today_lima
)
SELECT
  p.id,
  p.name,
  p.active,
  p.valid_from,
  p.valid_until,
  CASE
    WHEN NOT p.active THEN 'pausada'
    WHEN p.valid_from IS NOT NULL AND p.valid_from > nl.today_lima THEN 'programada'
    WHEN p.valid_until IS NOT NULL AND p.valid_until < nl.today_lima THEN 'vencida'
    ELSE 'vigente'
  END AS runtime_status,
  (
    p.active
    AND (p.valid_from IS NULL OR p.valid_from <= nl.today_lima)
    AND (p.valid_until IS NULL OR p.valid_until >= nl.today_lima)
  ) AS is_active_now
FROM public.promotions p
CROSS JOIN now_lima nl;

COMMENT ON VIEW public.v_promotions_runtime_status IS
'Estado operativo de promociones usando fecha oficial de America/Lima.';
