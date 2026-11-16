-- ============================================================================
-- CoolerCo 029 — Tracking admin (Setup → 📡 Tracking)
--
-- One admin screen for GPS tracking switches that live in this database:
--   • SMART Track (schema smart_track): company switch + Field app + trip sheet switches
--   • CoolerCo-Ops: tracking in the Field app
-- RouteIQ has its own switch on its own settings page (it runs on the production database).
-- Tracking runs only when every switch on its path is on. All start OFF.
--
-- Who: system_admin may change; system_admin and administrator may look. Every change is logged.
-- Needs: 003 (coolerco_settings), 016 (roles). SMART Track 001 + 002 for the SMART Track switches
-- (without them the screen says so; nothing breaks).
-- Run on: TEST first. Rollback: coolerco_029_rollback.sql
-- ============================================================================

create table if not exists public.coolerco_tracking_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  setting     text not null,
  value       boolean,
  note        text
);
alter table public.coolerco_tracking_log enable row level security;
revoke all on public.coolerco_tracking_log from public, anon, authenticated;

insert into public.coolerco_settings (key, value) values
  ('field_app_tracking', 'false'::jsonb),            -- CoolerCo Field app sends GPS (off until approved)
  ('smart_track_company_code', '"rtma"'::jsonb)      -- which SMART Track company this app belongs to
on conflict (key) do nothing;

-- Everything the screen shows, in one call
create or replace function public.coolerco_tracking_settings()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code text; v_installed boolean; v_ready boolean; v_tenant uuid; v_switches jsonb; v_keys int;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator']) then
    raise exception 'Only administrators can see the tracking settings';
  end if;
  v_code := coalesce((select value #>> '{}' from public.coolerco_settings where key = 'smart_track_company_code'), 'rtma');
  v_installed := to_regnamespace('smart_track') is not null;
  v_ready := v_installed and to_regprocedure('smart_track.set_switches(text,boolean,boolean,boolean)') is not null;
  if v_installed then
    execute 'select id from smart_track.tenants where code = $1' into v_tenant using v_code;
    if v_tenant is not null then
      execute 'select count(*)::int from smart_track.api_keys where tenant_id = $1 and revoked_at is null' into v_keys using v_tenant;
      if v_ready then execute 'select smart_track.get_switches($1) -> ''body''' into v_switches using v_tenant; end if;
    end if;
  end if;
  return jsonb_build_object(
    'can_change', public.coolerco_has_role(array['system_admin']),
    'field_app_tracking', coalesce((select (value #>> '{}')::boolean from public.coolerco_settings where key = 'field_app_tracking'), false),
    'smart_track', jsonb_build_object(
      'installed', v_installed, 'switches_ready', v_ready, 'company_code', v_code,
      'company_exists', v_tenant is not null, 'server_keys', coalesce(v_keys, 0),
      'switches', coalesce(v_switches, jsonb_build_object('enabled', false, 'field_app', false, 'tripsheet', false))),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'by', user_email, 'setting', setting, 'value', value, 'note', note) order by at desc)
                       from (select * from public.coolerco_tracking_log order by at desc limit 15) x), '[]'::jsonb));
end $$;

-- Flip one switch (system_admin only). p_setting: field_app_tracking | smart_track_enabled | smart_track_field_app | smart_track_tripsheet
create or replace function public.coolerco_tracking_set(p_setting text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_email text := auth.jwt() ->> 'email';
begin
  if not public.coolerco_has_role(array['system_admin']) then
    raise exception 'Only a system administrator can change tracking settings';
  end if;
  if p_on is null then raise exception 'Choose on or off'; end if;
  v_code := coalesce((select value #>> '{}' from public.coolerco_settings where key = 'smart_track_company_code'), 'rtma');

  if p_setting = 'field_app_tracking' then
    update public.coolerco_settings set value = to_jsonb(p_on), updated_at = now(), updated_by = v_email where key = 'field_app_tracking';
  elsif p_setting in ('smart_track_enabled', 'smart_track_field_app', 'smart_track_tripsheet') then
    if to_regprocedure('smart_track.set_switches(text,boolean,boolean,boolean)') is null then
      raise exception 'SMART Track switches are not installed: run smart_track_002_switches.sql';
    end if;
    execute 'select smart_track.set_switches($1, $2, $3, $4)' using v_code,
      case when p_setting = 'smart_track_enabled'   then p_on end,
      case when p_setting = 'smart_track_field_app' then p_on end,
      case when p_setting = 'smart_track_tripsheet' then p_on end;
  else
    raise exception 'Unknown tracking setting %', p_setting;
  end if;

  insert into public.coolerco_tracking_log (user_id, user_email, setting, value) values (auth.uid(), v_email, p_setting, p_on);
  return public.coolerco_tracking_settings();
end $$;

-- Create the SMART Track company once (system_admin only). The server key is returned ONCE:
-- copy it into RouteIQ's Netlify settings (SMART_TRACK_KEY). Only its hash is stored.
create or replace function public.coolerco_tracking_create_company()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_exists boolean; v_key text; v_email text := auth.jwt() ->> 'email';
begin
  if not public.coolerco_has_role(array['system_admin']) then
    raise exception 'Only a system administrator can set up SMART Track';
  end if;
  if to_regnamespace('smart_track') is null then raise exception 'SMART Track is not installed in this database'; end if;
  v_code := coalesce((select value #>> '{}' from public.coolerco_settings where key = 'smart_track_company_code'), 'rtma');
  execute 'select exists (select 1 from smart_track.tenants where code = $1)' into v_exists using v_code;
  if v_exists then raise exception 'SMART Track company % already exists', v_code; end if;
  execute 'select smart_track.create_tenant($1, $2)' into v_key using v_code, 'RTMA / CoolerCo';
  insert into public.coolerco_tracking_log (user_id, user_email, setting, note) values (auth.uid(), v_email, 'smart_track_company', 'Company ' || v_code || ' created; server key issued');
  return jsonb_build_object('company_code', v_code, 'server_key', v_key);
end $$;

revoke all on function public.coolerco_tracking_settings() from public, anon;
revoke all on function public.coolerco_tracking_set(text, boolean) from public, anon;
revoke all on function public.coolerco_tracking_create_company() from public, anon;
grant execute on function public.coolerco_tracking_settings() to authenticated;
grant execute on function public.coolerco_tracking_set(text, boolean) to authenticated;
grant execute on function public.coolerco_tracking_create_company() to authenticated;
