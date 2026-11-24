-- CoolerCo-Ops · 026 · Users & roles screen + warehouse roles (Wanda 12 Nov: stock controller, supervisor, warehouse
-- assistant; overrides = supervisors only). Additive: new roles (data), audit table, functions. Needs 016.
-- Reads auth.users only through security definer functions for administrators. Rollback: coolerco_026_rollback.sql

insert into public.coolerco_roles (code, label, description, can_log, can_update, can_approve, can_edit_data, can_delete, own_only, sort_order) values
  ('supervisor',          'Supervisor',          'Warehouse supervisor: everything a stock controller does + overrides (pick anyway, short loading, wrong area), alerts', true, true, true, false, false, false, 35),
  ('stock_controller',    'Stock controller',    'Picks, scans, audits returns, loads driver bays',                                                                      true, true, false, false, false, false, 36),
  ('warehouse_assistant', 'Warehouse assistant', 'Scans and picks in a smaller warehouse',                                                                                 true, true, false, false, false, false, 37)
on conflict (code) do nothing;

-- Who may override an alarm (setting, so it can change without code)
insert into public.coolerco_settings (key, value) values ('override_roles', '["system_admin","manager","supervisor"]'::jsonb)
on conflict (key) do nothing;

-- Audit of every role change
create table if not exists public.coolerco_access_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  user_email  text,
  action      text not null check (action in ('added', 'switched_off', 'switched_on')),
  role_code   text not null,
  warehouse_code text,
  client_code text,
  by_user     uuid default auth.uid(),
  by_label    text,
  at          timestamptz not null default now()
);
alter table public.coolerco_access_events enable row level security;
drop policy if exists coolerco_access_events_admin on public.coolerco_access_events;
create policy coolerco_access_events_admin on public.coolerco_access_events for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator']));
revoke all on public.coolerco_access_events from anon, authenticated;
grant select on public.coolerco_access_events to authenticated;

-- May the signed-in user override alarms (optionally: in this warehouse code, e.g. 'JHB')?
create or replace function public.coolerco_can_override(p_warehouse text default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.coolerco_user_access a
                  where a.user_id = auth.uid() and a.active
                    and a.role_code in (select jsonb_array_elements_text(coalesce((select value from public.coolerco_settings where key = 'override_roles'),
                                                                                '["system_admin","manager","supervisor"]'::jsonb)))
                    and (a.warehouse_code is null or p_warehouse is null or a.warehouse_code = p_warehouse))
$$;

-- 👥 All SmartHub users with their CoolerCo roles (+ SmartHub mapping as a hint). Administrators only.
create or replace function public.coolerco_users_admin()
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator']) then return jsonb_build_object('error', 'not_allowed'); end if;
  return jsonb_build_object(
    'me', auth.uid(),
    'roles', (select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'description', description) order by sort_order) from public.coolerco_roles),
    'users', coalesce((select jsonb_agg(u order by u ->> 'email') from (
      select jsonb_build_object(
        'id', au.id, 'email', au.email,
        'name', coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'),
        'last_sign_in', au.last_sign_in_at, 'created', au.created_at,
        'smarthub', (select jsonb_agg(distinct jsonb_build_object('role', m.role, 'warehouse', w.code)) from public.user_warehouse_mapping m
                       left join public.warehouses w on w.id = m.warehouse_id where m.user_id = au.id),
        'access', (select jsonb_agg(jsonb_build_object('id', a.id, 'role', a.role_code, 'warehouse', a.warehouse_code, 'client', a.client_code, 'active', a.active,
                                                       'updated_at', coalesce(a.updated_at, a.created_at), 'updated_by', coalesce(a.updated_by, a.created_by))
                                    order by a.active desc, a.role_code)
                     from public.coolerco_user_access a where a.user_id = au.id)) u
        from auth.users au where au.deleted_at is null) x), '[]'::jsonb));
end $$;

-- ➕ Give a role (optionally for one warehouse / client). Re-activates an existing switched-off row instead of duplicating.
create or replace function public.coolerco_user_access_add(p_user uuid, p_role text, p_warehouse text default null, p_client text default null)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text); v_id uuid; v_email text;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator']) then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_role in ('system_admin', 'administrator') and not public.coolerco_has_role(array['system_admin']) then return jsonb_build_object('error', 'only_system_admin'); end if;
  if not exists (select 1 from public.coolerco_roles where code = p_role) then return jsonb_build_object('error', 'unknown_role'); end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then return jsonb_build_object('error', 'unknown_user'); end if;
  p_warehouse := nullif(trim(coalesce(p_warehouse, '')), ''); p_client := nullif(trim(coalesce(p_client, '')), '');
  select id into v_id from public.coolerco_user_access
   where user_id = p_user and role_code = p_role and warehouse_code is not distinct from p_warehouse and client_code is not distinct from p_client
   order by active desc limit 1;
  if v_id is not null then
    update public.coolerco_user_access set active = true, updated_at = now(), updated_by = v_by where id = v_id and not active;
    if not found then return jsonb_build_object('ok', true, 'already', true); end if;
    insert into public.coolerco_access_events (user_id, user_email, action, role_code, warehouse_code, client_code, by_label)
    values (p_user, v_email, 'switched_on', p_role, p_warehouse, p_client, v_by);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  insert into public.coolerco_user_access (user_id, role_code, warehouse_code, client_code, active, created_by)
  values (p_user, p_role, p_warehouse, p_client, true, v_by) returning id into v_id;
  insert into public.coolerco_access_events (user_id, user_email, action, role_code, warehouse_code, client_code, by_label)
  values (p_user, v_email, 'added', p_role, p_warehouse, p_client, v_by);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ⏻ Switch a role off / on (never deleted, so history stays). You cannot switch off your own system_admin.
create or replace function public.coolerco_user_access_set(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text); a public.coolerco_user_access;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator']) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into a from public.coolerco_user_access where id = p_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if a.role_code in ('system_admin', 'administrator') and not public.coolerco_has_role(array['system_admin']) then return jsonb_build_object('error', 'only_system_admin'); end if;
  if a.user_id = auth.uid() and a.role_code = 'system_admin' and not p_active then return jsonb_build_object('error', 'not_yourself'); end if;
  if a.active = p_active then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.coolerco_user_access set active = p_active, updated_at = now(), updated_by = v_by where id = p_id;
  insert into public.coolerco_access_events (user_id, user_email, action, role_code, warehouse_code, client_code, by_label)
  values (a.user_id, (select email from auth.users where id = a.user_id), case when p_active then 'switched_on' else 'switched_off' end,
          a.role_code, a.warehouse_code, a.client_code, v_by);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.coolerco_can_override(text) from public, anon;
revoke all on function public.coolerco_users_admin() from public, anon;
revoke all on function public.coolerco_user_access_add(uuid, text, text, text) from public, anon;
revoke all on function public.coolerco_user_access_set(uuid, boolean) from public, anon;
grant execute on function public.coolerco_can_override(text) to authenticated;
grant execute on function public.coolerco_users_admin() to authenticated;
grant execute on function public.coolerco_user_access_add(uuid, text, text, text) to authenticated;
grant execute on function public.coolerco_user_access_set(uuid, boolean) to authenticated;
