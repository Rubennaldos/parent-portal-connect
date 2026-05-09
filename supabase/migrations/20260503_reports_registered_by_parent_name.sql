-- ============================================================================
-- Enriquecer fn_resolve_registered_by: nombre del padre vía alumno
-- Fecha: 2026-05-03
--
-- Si no hay full_name en profiles para created_by, pero hay student_id,
-- se busca el nombre del padre (students.parent_id → profiles.full_name).
-- Flujo portal/padre: "Realizado por el padre · {nombre}" si existe; si no, solo la frase.
-- Pasarela/tarjeta sin nombre de padre resuelto: sigue "Portal de Padres".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_resolve_registered_by(
  p_created_by      uuid,
  p_student_id      uuid,
  p_ticket_code     text,
  p_payment_method  text,
  p_gateway_ref_id  text,
  p_metadata        jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_name text;
  v_parent_name  text;
  v_source       text;
  v_source_chan  text;
BEGIN
  -- 1) Empleado / usuario que registró (nombre en perfil)
  SELECT NULLIF(trim(p.full_name), '')
  INTO v_profile_name
  FROM public.profiles p
  WHERE p.id = p_created_by
  LIMIT 1;

  IF v_profile_name IS NOT NULL THEN
    RETURN v_profile_name;
  END IF;

  v_source      := lower(COALESCE(p_metadata->>'source', ''));
  v_source_chan := lower(COALESCE(p_metadata->>'source_channel', ''));

  -- Nombre del padre del alumno (auditoría humana; no es "vendedor de caja")
  IF p_student_id IS NOT NULL THEN
    SELECT NULLIF(trim(pr.full_name), '')
    INTO v_parent_name
    FROM public.students s
    JOIN public.profiles pr ON pr.id = s.parent_id
    WHERE s.id = p_student_id
    LIMIT 1;
  END IF;

  -- 2) Flujo explícito padre / portal web
  IF v_source_chan = 'parent_web'
     OR v_source LIKE '%parent%'
     OR v_source LIKE '%unified_calendar%'
  THEN
    IF v_parent_name IS NOT NULL THEN
      RETURN 'Realizado por el padre · ' || v_parent_name;
    END IF;
    RETURN 'Realizado por el padre';
  END IF;

  -- 3) Pasarela / carrito unificado / tarjeta: intentar padre por alumno; si no, etiqueta portal
  IF v_source LIKE '%unified_payment%'
     OR v_source LIKE '%gateway%'
     OR COALESCE(p_gateway_ref_id, '') ILIKE 'GW-%'
     OR lower(COALESCE(p_payment_method, '')) = 'tarjeta'
  THEN
    IF v_parent_name IS NOT NULL THEN
      RETURN 'Realizado por el padre · ' || v_parent_name;
    END IF;
    RETURN 'Portal de Padres';
  END IF;

  -- 4) Ticket kiosco sin perfil de cajero
  IF COALESCE(p_ticket_code, '') ILIKE 'T-%' THEN
    RETURN 'Vendedor no identificado (kiosco)';
  END IF;

  RETURN 'Sistema';
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_registered_by IS
  'Vendedor/registrado: perfil created_by; si no, padre vía student_id; '
  'portal/padre con nombre; pasarela sin padre resuelto → Portal de Padres; kiosco sin dato → alerta.';

SELECT 'fn_resolve_registered_by enriquecido con nombre del padre ✅' AS resultado;
