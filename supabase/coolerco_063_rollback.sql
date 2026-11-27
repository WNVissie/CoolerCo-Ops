-- Rollback for coolerco_063_com_uploads.sql (TEST). Puts coolerco_case_route_events back as in 038 and removes 063's objects.
-- Queue lines and their history stay (only the two new columns on coolerco_com_updates are dropped).
drop trigger if exists coolerco_route_auto_wpt on public.routing_routes;
drop trigger if exists coolerco_route_auto_wpt on public.routing_route_stops;
drop trigger if exists coolerco_route_auto_wpt on public.coolerco_test_routes;
drop trigger if exists coolerco_com_updates_fill on public.coolerco_com_updates;
drop trigger if exists coolerco_job_card_com_repair on public.coolerco_field_job_cards;

drop function if exists public.coolerco_route_auto_wpt();
drop function if exists public.coolerco_com_wpt_for_route(uuid);
drop function if exists public.coolerco_com_export_rows(text, text);
drop function if exists public.coolerco_com_step_rank(text);
drop function if exists public.coolerco_com_repairs_mark(uuid[], text, text);
drop function if exists public.coolerco_com_repair_save(uuid, text, jsonb);
drop function if exists public.coolerco_job_card_com_repair();
drop function if exists public.coolerco_com_updates_fill();
drop function if exists public.coolerco_com_users();
drop function if exists public.coolerco_com_user_set(text, text, text);
drop function if exists public.coolerco_com_workshop_candidates(text);
drop function if exists public.coolerco_com_workshop_wpt(text[], text);
drop function if exists public.coolerco_com_repair_names();
drop function if exists public.coolerco_com_user_for(uuid, text, text, text);
drop function if exists public.coolerco_is_workshop_case(text);
drop table if exists public.coolerco_com_case_repairs;
drop table if exists public.coolerco_user_com_portal;
delete from public.coolerco_settings where key = 'com_auto_wpt';

alter table public.coolerco_com_updates drop column if exists notified_by_portal_user;
alter table public.coolerco_com_updates drop column if exists created_by;
alter table public.coolerco_clients drop column if exists com_send_routing;
alter table public.coolerco_warehouse_settings drop column if exists com_logistics_user;
alter table public.coolerco_warehouse_settings drop column if exists com_workshop_user;
alter table public.coolerco_field_slots drop column if exists com_portal_user;
-- (the demo warehouses keep the com_portal_user 063 gave them; clear by hand if wanted)

-- 038 version of the manual "Find WPT steps"
create or replace function public.coolerco_case_route_events(p_from date default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v_n int := 0; v jsonb;
begin
  for s in select distinct on (st.case_number) st.case_number, r.id route_id
             from public.routing_route_stops st join public.routing_routes r on r.id = st.route_id
             join public.routing_route_versions rv on rv.id = st.route_version_id and rv.is_current
             join public.coolerco_all_cases c on c.case_number = st.case_number
            where r.status in ('finalised', 'dispatched', 'partially_completed', 'completed')
              and r.route_date >= coalesce(p_from, (now() at time zone 'Africa/Johannesburg')::date - 3)
              and c.status_reason in ('Open', 'In Progress')
              and not exists (select 1 from public.coolerco_com_updates u where u.case_number = st.case_number and u.notification = 'WITHIN PROPOSED TIME')
  loop
    v := public.coolerco_case_apply_event(s.case_number, 'route_final', 'route', null, jsonb_build_object('route_id', s.route_id));
    if v ? 'ok' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.coolerco_case_route_events(date) from public, anon;
grant execute on function public.coolerco_case_route_events(date) to authenticated;
