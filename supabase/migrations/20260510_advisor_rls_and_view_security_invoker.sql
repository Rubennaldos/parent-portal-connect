-- ============================================================================
-- Supabase Security Advisor — cierre mínimo seguro (Lima_cafe_28 / mismo patrón)
-- 2026-05-10
--
-- Qué hace:
--   1) payment_gateway_config: sin acceso anon; RLS; solo superadmin lee (api_key).
--   2) Tablas catálogo / operación: RLS + lectura authenticated (anon sin política = bloqueado).
--   3) RBAC + billing + backups z_bk_*: RLS + solo staff; backups sin SELECT público.
--   4) Vistas marcadas security_definer: security_invoker = on (PG15+) si aplica.
--
-- Qué NO hace: no borra filas ni tablas.
--
-- Nota: tras aplicar, probá login padre/admin y cobranzas. Si algo falla,
-- ampliá políticas por tabla concreta (es normal afinar en 1–2 tablas).
-- ============================================================================

BEGIN;

-- ── Helper: rol staff (ajustá la lista si tu negocio usa otros roles) ─────
-- Usado en políticas de permisos / facturación / backups operativos.

-- ═══════════════════════════════════════════════════════════════════════════
-- A) payment_gateway_config (api_key — crítico)
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON TABLE public.payment_gateway_config FROM PUBLIC, anon;
-- RLS necesita privilegio de tabla; el filtro fino va en la policy.
GRANT SELECT ON TABLE public.payment_gateway_config TO authenticated;

ALTER TABLE public.payment_gateway_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_gateway_config_superadmin_select
  ON public.payment_gateway_config;
CREATE POLICY payment_gateway_config_superadmin_select
  ON public.payment_gateway_config
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.profiles p
      WHERE  p.id = auth.uid()
        AND  p.role = 'superadmin'
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- B) Catálogo / datos operativos: lectura para cualquier usuario autenticado
-- ═══════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'schools',
      'school_prefixes',
      'school_levels',
      'school_classrooms',
      'weekly_menus',
      'lunch_items_library',
      'ticket_sequences'
    ]::text[]) AS tbl
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      r.tbl
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'adv_authenticated_select_' || r.tbl,
      r.tbl
    );
    EXECUTE format(
      $f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (true)
      $f$,
      'adv_authenticated_select_' || r.tbl,
      r.tbl
    );
  END LOOP;
END
$do$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C) RBAC: solo staff autenticado
-- ═══════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'permissions',
      'role_permissions',
      'user_permissions'
    ]::text[]) AS tbl
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'adv_staff_select_' || r.tbl,
      r.tbl
    );
    EXECUTE format(
      $f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN (
                'superadmin', 'admin_general', 'gestor_unidad',
                'admin_sede', 'supervisor_red', 'operador_caja'
              )
          )
        )
      $f$,
      'adv_staff_select_' || r.tbl,
      r.tbl
    );
  END LOOP;
END
$do$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D) Billing / logs: solo staff (SELECT; ampliá INSERT/UPDATE si hace falta)
-- ═══════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'billing_periods',
      'billing_payments',
      'billing_messages',
      'auto_billing_logs',
      'billing_negative_alerts',
      'manual_reconciliation_log'
    ]::text[]) AS tbl
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'adv_billing_staff_select_' || r.tbl,
      r.tbl
    );
    EXECUTE format(
      $f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN (
                'superadmin', 'admin_general', 'gestor_unidad',
                'admin_sede', 'supervisor_red', 'operador_caja'
              )
          )
        )
      $f$,
      'adv_billing_staff_select_' || r.tbl,
      r.tbl
    );
  END LOOP;
END
$do$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E) Tablas backup z_bk_* y mass_approve_results: sin API para anon/auth
-- ═══════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'z_bk_items_mayo',
      'z_bk_transacciones_mayo',
      'z_bk_ventas_mayo',
      'z_bk_estudiantes_mayo',
      'z_bk_perfiles_mayo',
      'z_bk_precios_mayo',
      'z_bk_productos_mayo',
      'mass_approve_results'
    ]::text[]) AS tbl
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END
$do$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F) Vistas SECURITY DEFINER → SECURITY INVOKER (PG15+; reduce bypass RLS)
-- ═══════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  v text;
  v_list text[] := ARRAY[
    'lunch_monthly_summary',
    'v_parent_unread_count',
    'most_frequent_errors',
    'v_combos_runtime_status',
    'view_student_debts',
    'error_hotspots',
    'unified_system_monitor',
    'view_recharge_ledger',
    'payment_statistics',
    'error_statistics',
    'v_cash_reconciliation',
    'low_balance_students',
    'v_promotions_runtime_status'
  ];
BEGIN
  FOREACH v IN ARRAY v_list
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER VIEW public.%I SET (security_invoker = true)',
        v
      );
    EXCEPTION WHEN undefined_object THEN
      RAISE NOTICE 'Advisor views: omitido (no existe): %', v;
    WHEN invalid_parameter_value THEN
      RAISE NOTICE 'Advisor views: security_invoker no soportado o no aplica: %', v;
    WHEN OTHERS THEN
      RAISE NOTICE 'Advisor views: % — %', v, SQLERRM;
    END;
  END LOOP;
END
$do$;

COMMIT;
