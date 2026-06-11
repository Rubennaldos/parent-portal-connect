-- =============================================================================
-- DIAGNÓSTICO: quispe@limacafe28.com entra como PADRE (formulario responsable)
--
-- CAUSA RAÍZ (cadena, verificada en código):
--   1. useRole.ts hace SELECT profiles WHERE id = auth.uid() con el JWT del cliente
--   2. Si RLS bloquea → 0 filas → PGRST116 / HTTP 406 con .single()
--   3. catch en useRole fuerza role = 'parent' (línea 68)
--   4. Auth.tsx redirige a '/' (ruta solo de padres)
--   5. Index.tsx ejecuta checkOnboardingStatus → parent_profiles vacío → ParentDataForm
--
-- buscar_usuarios_admin SÍ ve el perfil porque es SECURITY DEFINER (ignora RLS).
-- El panel Superadmin usa RPC; el login usa cliente anon+JWT → SÍ aplica RLS.
--
-- Ejecutar TODO y revisar cada bloque.
-- =============================================================================


-- A) ¿Auth id = profiles id? (si ids_match = false → RLS nunca verá la fila)
SELECT
  'A ids' AS bloque,
  au.id AS auth_user_id,
  p.id AS profile_id,
  au.id = p.id AS ids_coinciden,
  au.email AS auth_email,
  p.email AS profile_email,
  p.role
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE lower(au.email) = lower('quispe@limacafe28.com');


-- B) ¿Perfil duplicado por email con otro id?
SELECT 'B duplicados email' AS bloque, id, email, role
FROM public.profiles
WHERE lower(email) LIKE '%quispe%limacafe28%';


-- C) Políticas RLS activas en profiles (debe existir lectura propia: auth.uid() = id)
SELECT
  'C policies' AS bloque,
  policyname,
  cmd,
  qual::text AS using_expr
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY policyname;

SELECT 'C rls enabled' AS bloque, relrowsecurity AS rls_activo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'profiles';


-- D) check_is_admin debe incluir admin_general (si no → políticas admin rotas)
SELECT
  'D check_is_admin' AS bloque,
  pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'check_is_admin';


-- E) Simular lo que hace useRole (como postgres ve la fila sin RLS)
SELECT 'E fila real' AS bloque, id, email, role, is_active
FROM public.profiles
WHERE lower(email) = lower('quispe@limacafe28.com');


-- =============================================================================
-- REPARACIÓN ESTRUCTURAL (solo si A muestra ids_coinciden = true)
-- Garantiza que el usuario autenticado pueda leer SU propia fila (sin recursión).
-- =============================================================================

-- E1) Alinear id si el perfil quedó con otro UUID que el de Auth
/*
UPDATE public.profiles p
SET id = au.id, email = lower(au.email), updated_at = now()
FROM auth.users au
WHERE lower(au.email) = lower('quispe@limacafe28.com')
  AND lower(p.email) = lower('quispe@limacafe28.com')
  AND p.id <> au.id;
*/

-- E2) Política mínima: leer y editar el propio perfil (obligatoria para useRole)
DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "users_view_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;

CREATE POLICY "profiles_self_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- E3) check_is_admin con admin_general (si D no lo incluye, ejecutar):
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'superadmin', 'admin_general')
  );
END;
$$;

-- E4) Confirmar rol
UPDATE public.profiles
SET role = 'admin_general', is_active = true, updated_at = now()
WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('quispe@limacafe28.com'));

SELECT 'POST fix' AS bloque, id, email, role FROM public.profiles
WHERE lower(email) = lower('quispe@limacafe28.com');
