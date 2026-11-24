-- ============================================================================
-- CoolerCo 049 - keep Magnum (COM) data away from users who may not see Magnum
-- TEST first. Add-only: the existing rules on these tables are NOT changed.
-- Rollback: coolerco_049_rollback.sql
--
-- Problem (found 2026-11-24): COM cases, assets_live, the COM asset scans and the
-- routing tables let ANY signed-in user read them. The demo logins (and later the
-- Tiger users) are signed-in users, so a demo client user opening the Cases page
-- would see real Magnum stores, contacts and cases.
--
-- Fix: one extra "restrictive" rule per table. A restrictive rule is checked on top
-- of the table's existing rules, so it can only take rows away, never add them.
-- It takes rows away ONLY from a user who
--   * has CoolerCo access rows (coolerco_user_access), and
--   * none of them allows Magnum (not system admin / all-scope, not client MAGNUM,
--     not staff of a real RTMA warehouse).
-- Users without CoolerCo access rows (SmartDash, SmartSpares, routing app users),
-- server code using the secret key, and every RTMA / Magnum user see exactly what
-- they see today.
-- ============================================================================
do $$ begin
  if to_regclass('public.coolerco_user_access') is null or to_regprocedure('public.coolerco_can_see_magnum()') is null then
    raise exception 'Needs 016 (roles) and 041 (client split) first';
  end if;
end $$;

-- 1. True for a signed-in user whose CoolerCo access does not include Magnum
create or replace function public.coolerco_magnum_blocked()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.coolerco_user_access a where a.user_id = auth.uid() and a.active)
     and not public.coolerco_can_see_magnum();
$$;
revoke all on function public.coolerco_magnum_blocked() from public, anon;
grant execute on function public.coolerco_magnum_blocked() to authenticated;

-- 2. The extra rule on every Magnum / COM table the CoolerCo screens can reach
--    ("select ..." in brackets = worked out once per query, not once per row)
do $$
declare t text;
begin
  foreach t in array array[
    'cases', 'staging_cases', 'assets_live', 'asset_touch', 'magnum_assets_history',
    'routing_routes', 'routing_route_versions', 'routing_route_stops', 'routing_route_events',
    'routing_job_cards', 'routing_warehouse_preparation', 'routing_case_assignments',
    'routing_pos_assignments', 'routing_pos_contacts', 'routing_pos_contact_changes',
    'routing_pos_detail_overrides', 'routing_pos_detail_reports', 'routing_customers',
    'routing_partner_contacts', 'routing_portal_users', 'routing_driver_trip_history'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists coolerco_magnum_guard on public.%I', t);
      execute format('create policy coolerco_magnum_guard on public.%I as restrictive for all to authenticated '
                  || 'using ((select not public.coolerco_magnum_blocked())) '
                  || 'with check ((select not public.coolerco_magnum_blocked()))', t);
    end if;
  end loop;
end $$;

-- Check: which tables now have the guard
select tablename, policyname, permissive from pg_policies where policyname = 'coolerco_magnum_guard' order by 1;
