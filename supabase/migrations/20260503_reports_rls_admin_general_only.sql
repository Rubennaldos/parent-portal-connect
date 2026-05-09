-- Reports Security Hardening
-- Solo lectura para reportes si auth.jwt()->>'role' = 'admin_general'
--
-- Nota:
-- - Esta migración crea una policy RESTRICTIVE de SELECT en tablas sensibles.
-- - Las operaciones de escritura (INSERT/UPDATE/DELETE) quedan gobernadas por
--   sus políticas existentes.

create or replace function public.is_admin_general_jwt()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'role') = 'admin_general', false);
$$;

comment on function public.is_admin_general_jwt is
  'Valida si el JWT actual pertenece al rol admin_general.';

do $$
declare
  v_tables text[] := array[
    'public.sales',
    'public.transactions',
    'public.auditoria_vouchers',
    'public.recharge_requests',
    'public.audit_logs',
    'public.audit_billing_logs',
    'public.cancellation_alerts'
  ];
  v_table text;
  v_policy_name text := 'reports_select_admin_general_only';
begin
  foreach v_table in array v_tables loop
    if to_regclass(v_table) is null then
      raise notice '[reports-rls] Tabla no existe, se omite: %', v_table;
      continue;
    end if;

    execute format('alter table %s enable row level security', v_table);

    execute format('drop policy if exists %I on %s', v_policy_name, v_table);

    execute format(
      'create policy %I on %s as restrictive for select to authenticated using (public.is_admin_general_jwt())',
      v_policy_name,
      v_table
    );
  end loop;
end
$$;
