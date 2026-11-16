-- CoolerCo-Ops · 034 · RUN ON TEST — field slots (5 drivers + 5 technicians per warehouse), real names, logins,
-- and who is actually on each route today. RouteIQ is not changed.
--
-- How it works (Wanda 2026-11-17):
--   · A SLOT = one position in a warehouse ("Gauteng Driver 2"), with its RouteIQ / COM route name (RTMAGTD2) when it has
--     one, the PERSON's real name, phone, and the SmartHub login used on the phone. A new person in the slot → update the
--     name (old names are kept with dates in coolerco_field_slot_names, so reports know who it was on a given day).
--   · Routes planned on a RouteIQ slot go to that slot's login automatically ("usual").
--   · Supervisor / planner can set another crew for a route (driver + helpers) — swaps after routing. Logged.
--   · A driver can ask "this is my route today" / "this is not my route" → supervisor approves or rejects.
--   · The Field app greets the person by the slot name: "Welcome Sipho".
-- Supervisors / planners = roles system_admin, administrator, manager, supervisor (coolerco_user_access).
-- Contractors keep using RouteIQ's WhatsApp trip-sheet link (no slots here).
-- Rollback: coolerco_034_rollback.sql

create or replace function public.coolerco_is_planner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor'])
$$;

create or replace function public.coolerco_wh_group(p_code text) returns text
language sql immutable as $$
  select 'RTMA ' || case upper(p_code) when 'JHB' then 'Gauteng' when 'CPT' then 'Cape Town' when 'BFN' then 'Bloemfontein'
    when 'DBN' then 'Durban' when 'EL' then 'East London' when 'GEO' then 'George' when 'NEL' then 'Nelspruit'
    when 'POL' then 'Polokwane' when 'PE' then 'Port Elizabeth' end
$$;

-- ── slots ────────────────────────────────────────────────────────────
create table if not exists public.coolerco_field_slots (
  id               uuid primary key default gen_random_uuid(),
  warehouse_code   text not null,                                   -- JHB, CPT, DBN, BFN, EL, GEO, NEL, POL, PE
  worker_type      text not null check (worker_type in ('driver', 'technician')),
  slot_no          int  not null,
  routeiq_username text unique,                                     -- RouteIQ / COM route name, e.g. RTMAGTD2 (empty = not in RouteIQ yet)
  person_name      text,                                            -- the real person now in this slot
  phone            text,
  user_id          uuid unique references auth.users(id) on delete set null,  -- SmartHub login used on the phone
  active           boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid(),
  unique (warehouse_code, worker_type, slot_no)
);

create table if not exists public.coolerco_field_slot_names (
  id          bigint generated always as identity primary key,
  slot_id     uuid not null references public.coolerco_field_slots(id) on delete cascade,
  person_name text,
  from_at     timestamptz not null default now(),
  to_at       timestamptz,
  changed_by  uuid default auth.uid()
);

create or replace function public.coolerco_field_slot_name_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' and new.person_name is not null) or (tg_op = 'UPDATE' and new.person_name is distinct from old.person_name) then
    update public.coolerco_field_slot_names set to_at = now() where slot_id = new.id and to_at is null;
    insert into public.coolerco_field_slot_names (slot_id, person_name) values (new.id, new.person_name);
  end if;
  return new;
end $$;
drop trigger if exists coolerco_field_slot_name_log on public.coolerco_field_slots;
create trigger coolerco_field_slot_name_log after insert or update of person_name on public.coolerco_field_slots
  for each row execute function public.coolerco_field_slot_name_log();

-- seed: the RouteIQ slots that exist now (no contractors), then fill every warehouse up to 5 drivers + 5 technicians
insert into public.coolerco_field_slots (warehouse_code, worker_type, slot_no, routeiq_username, person_name)
select w.code, p.worker_type,
       row_number() over (partition by w.code, p.worker_type order by p.portal_username),
       p.portal_username, null
  from public.routing_portal_users p
  join (values ('JHB','RTMA Gauteng'),('CPT','RTMA Cape Town'),('DBN','RTMA Durban'),('BFN','RTMA Bloemfontein'),('EL','RTMA East London'),
               ('GEO','RTMA George'),('NEL','RTMA Nelspruit'),('POL','RTMA Polokwane'),('PE','RTMA Port Elizabeth')) w(code, grp)
    on w.grp = p.warehouse_group
 where p.is_active and p.worker_type in ('driver', 'technician')
   and p.portal_username like 'RTMA%' and p.display_name not ilike '%contractor%'
on conflict do nothing;

insert into public.coolerco_field_slots (warehouse_code, worker_type, slot_no)
select w.code, t.worker_type, n
  from (values ('JHB'),('CPT'),('DBN'),('BFN'),('EL'),('GEO'),('NEL'),('POL'),('PE')) w(code)
  cross join (values ('driver'),('technician')) t(worker_type)
  cross join generate_series(1, 5) n
 where (select count(*) from public.coolerco_field_slots s where s.warehouse_code = w.code and s.worker_type = t.worker_type) < 5
   and not exists (select 1 from public.coolerco_field_slots s where s.warehouse_code = w.code and s.worker_type = t.worker_type and s.slot_no = n)
   and n <= 5
on conflict do nothing;

-- ── crew of a route (only when set by a supervisor; otherwise the slot's login) ─────────
create table if not exists public.coolerco_route_crew (
  route_id    uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  crew_role   text not null check (crew_role in ('driver', 'helper')),
  assigned_by uuid default auth.uid(),
  assigned_at timestamptz not null default now(),
  note        text,
  primary key (route_id, user_id)
);
create unique index if not exists uq_coolerco_route_one_driver on public.coolerco_route_crew (route_id) where crew_role = 'driver';

create table if not exists public.coolerco_route_crew_log (
  id        bigint generated always as identity primary key,
  route_id  uuid not null,
  user_id   uuid,
  action    text not null,
  note      text,
  by_user   uuid default auth.uid(),
  at        timestamptz not null default now()
);

create table if not exists public.coolerco_crew_requests (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null,
  user_id     uuid not null default auth.uid(),
  kind        text not null check (kind in ('claim', 'not_mine')),
  note        text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by  uuid,
  decided_at  timestamptz,
  decide_note text,
  created_at  timestamptz not null default now()
);

alter table public.coolerco_field_slots enable row level security;
alter table public.coolerco_field_slot_names enable row level security;
alter table public.coolerco_route_crew enable row level security;
alter table public.coolerco_route_crew_log enable row level security;
alter table public.coolerco_crew_requests enable row level security;
revoke all on public.coolerco_field_slots, public.coolerco_field_slot_names, public.coolerco_route_crew,
              public.coolerco_route_crew_log, public.coolerco_crew_requests from public, anon, authenticated;
-- no direct access; everything goes through the functions below

-- name shown for a login: the slot's person name, else the account name
create or replace function public.coolerco_person_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(trim(s.person_name), '') from public.coolerco_field_slots s where s.user_id = p_user),
                  (select coalesce(nullif(trim(coalesce(u.raw_user_meta_data->>'first_name', '') || ' ' || coalesce(u.raw_user_meta_data->>'last_name', '')), ''),
                                   split_part(u.email, '@', 1)) from auth.users u where u.id = p_user))
$$;
revoke all on function public.coolerco_person_name(uuid) from public, anon, authenticated;

-- effective crew: set crew, else the login of the route's RouteIQ slot
create or replace function public.coolerco_route_crew_effective(p_routes uuid[])
returns table (route_id uuid, user_id uuid, crew_role text, source text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.route_id, c.user_id, c.crew_role, 'set'::text from public.coolerco_route_crew c where c.route_id = any (p_routes)
  union all
  select r.id, s.user_id, 'driver', 'usual'
    from public.routing_routes r join public.coolerco_field_slots s on s.active and s.routeiq_username = r.resource_username and s.user_id is not null
   where r.id = any (p_routes) and not exists (select 1 from public.coolerco_route_crew c where c.route_id = r.id)
$$;
revoke all on function public.coolerco_route_crew_effective(uuid[]) from public, anon, authenticated;

-- ── Field app ────────────────────────────────────────────────────────
create or replace function public.coolerco_my_field_profile()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', public.coolerco_person_name(auth.uid()),
    'slot', (select jsonb_build_object('id', s.id, 'warehouse', s.warehouse_code, 'type', s.worker_type, 'slot_no', s.slot_no,
                                       'routeiq', s.routeiq_username, 'person', s.person_name)
               from public.coolerco_field_slots s where s.user_id = auth.uid() and s.active),
    'planner', public.coolerco_is_planner())
$$;
revoke all on function public.coolerco_my_field_profile() from public, anon;
grant execute on function public.coolerco_my_field_profile() to authenticated;

create or replace function public.coolerco_my_routes(p_date date)
returns table (route_id uuid, crew_role text, source text)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.route_id, e.crew_role, e.source
    from public.coolerco_route_crew_effective(array(
           select r.id from public.routing_routes r
            where r.route_date = p_date and r.status in ('finalised', 'dispatched', 'partially_completed', 'completed'))) e
   where e.user_id = auth.uid()
$$;
revoke all on function public.coolerco_my_routes(date) from public, anon;
grant execute on function public.coolerco_my_routes(date) to authenticated;

create or replace function public.coolerco_claimable_routes(p_date date)
returns table (route_id uuid, route_number text, slot_name text, stops int, crew text)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select warehouse_code wh from public.coolerco_field_slots where user_id = auth.uid() and active)
  select r.id, r.route_number, r.resource_display_name, r.planned_stop_count,
         (select string_agg(public.coolerco_person_name(e.user_id), ', ') from public.coolerco_route_crew_effective(array[r.id]) e)
    from public.routing_routes r, me
   where r.route_date = p_date and r.warehouse_group = public.coolerco_wh_group(me.wh)
     and r.status in ('finalised', 'dispatched', 'partially_completed')
   order by r.route_number
$$;
revoke all on function public.coolerco_claimable_routes(date) from public, anon;
grant execute on function public.coolerco_claimable_routes(date) to authenticated;

create or replace function public.coolerco_crew_request(p_route uuid, p_kind text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('claim', 'not_mine') then raise exception 'Unknown request'; end if;
  select id into v from public.coolerco_crew_requests where route_id = p_route and user_id = auth.uid() and kind = p_kind and status = 'pending';
  if v is not null then return v; end if;
  insert into public.coolerco_crew_requests (route_id, kind, note) values (p_route, p_kind, p_note) returning id into v;
  return v;
end $$;
revoke all on function public.coolerco_crew_request(uuid, text, text) from public, anon;
grant execute on function public.coolerco_crew_request(uuid, text, text) to authenticated;

create or replace function public.coolerco_my_crew_requests(p_date date)
returns table (id uuid, route_id uuid, route_number text, kind text, status text, decide_note text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.route_id, r.route_number, q.kind, q.status, q.decide_note, q.created_at
    from public.coolerco_crew_requests q join public.routing_routes r on r.id = q.route_id
   where q.user_id = auth.uid() and r.route_date = p_date order by q.created_at desc
$$;
revoke all on function public.coolerco_my_crew_requests(date) from public, anon;
grant execute on function public.coolerco_my_crew_requests(date) to authenticated;

-- ── supervisor / planner ────────────────────────────────────────────
create or replace function public.coolerco_field_slot_list(p_warehouse text default null)
returns table (id uuid, warehouse_code text, worker_type text, slot_no int, routeiq_username text, person_name text, phone text,
               user_id uuid, login_email text, active boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can see the slots'; end if;
  return query select s.id, s.warehouse_code, s.worker_type, s.slot_no, s.routeiq_username, s.person_name, s.phone,
                      s.user_id, u.email::text, s.active, s.updated_at
    from public.coolerco_field_slots s left join auth.users u on u.id = s.user_id
   where p_warehouse is null or s.warehouse_code = upper(p_warehouse)
   order by s.warehouse_code, s.worker_type, s.slot_no;
end $$;
revoke all on function public.coolerco_field_slot_list(text) from public, anon;
grant execute on function public.coolerco_field_slot_list(text) to authenticated;

-- save a slot: real name, phone, RouteIQ name, login (by email), active
create or replace function public.coolerco_field_slot_save(p_slot uuid, p_person text, p_phone text, p_routeiq text, p_login_email text, p_active boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can change slots'; end if;
  if nullif(trim(p_login_email), '') is not null then
    select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_login_email));
    if v_user is null then raise exception 'No SmartHub login with email % — create the login first', p_login_email; end if;
    if exists (select 1 from public.coolerco_field_slots where user_id = v_user and id <> p_slot) then
      raise exception 'That login is already used by another slot'; end if;
  end if;
  if nullif(trim(p_routeiq), '') is not null and exists (select 1 from public.coolerco_field_slots where upper(routeiq_username) = upper(trim(p_routeiq)) and id <> p_slot) then
    raise exception 'RouteIQ name % is already on another slot', p_routeiq; end if;
  update public.coolerco_field_slots set person_name = nullif(trim(p_person), ''), phone = nullif(trim(p_phone), ''),
         routeiq_username = nullif(upper(trim(p_routeiq)), ''), user_id = v_user, active = coalesce(p_active, true),
         updated_at = now(), updated_by = auth.uid()
   where id = p_slot;
  if not found then raise exception 'Slot not found'; end if;
end $$;
revoke all on function public.coolerco_field_slot_save(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.coolerco_field_slot_save(uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.coolerco_field_slot_add(p_warehouse text, p_type text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can add slots'; end if;
  insert into public.coolerco_field_slots (warehouse_code, worker_type, slot_no)
  values (upper(p_warehouse), p_type, coalesce((select max(slot_no) from public.coolerco_field_slots where warehouse_code = upper(p_warehouse) and worker_type = p_type), 0) + 1)
  returning id into v;
  return v;
end $$;
revoke all on function public.coolerco_field_slot_add(text, text) from public, anon;
grant execute on function public.coolerco_field_slot_add(text, text) to authenticated;

create or replace function public.coolerco_crew_board(p_date date, p_warehouse text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ids uuid[]; v jsonb;
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can manage crews'; end if;
  select array_agg(id) into v_ids from public.routing_routes
   where route_date = p_date and warehouse_group = public.coolerco_wh_group(p_warehouse) and status <> 'not_used';
  v_ids := coalesce(v_ids, '{}');
  select jsonb_build_object(
    'routes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'route_number', r.route_number, 'status', r.status, 'slot', r.resource_username, 'slot_name', r.resource_display_name,
        'stops', r.planned_stop_count, 'start', r.planned_start_at,
        'crew', coalesce((select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'name', public.coolerco_person_name(e.user_id), 'role', e.crew_role, 'source', e.source)
                                           order by e.crew_role) from public.coolerco_route_crew_effective(array[r.id]) e), '[]'::jsonb))
        order by r.route_number) from public.routing_routes r where r.id = any (v_ids)), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', coalesce(s.person_name, s.routeiq_username, s.worker_type || ' ' || s.slot_no),
                                                             'type', s.worker_type, 'routeiq', s.routeiq_username) order by s.worker_type, s.slot_no)
                         from public.coolerco_field_slots s where s.active and s.user_id is not null and s.warehouse_code = upper(p_warehouse)), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'route_id', q.route_id, 'user_id', q.user_id, 'name', public.coolerco_person_name(q.user_id),
                                                               'kind', q.kind, 'note', q.note, 'at', q.created_at) order by q.created_at)
                          from public.coolerco_crew_requests q where q.status = 'pending' and q.route_id = any (v_ids)), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('route_id', l.route_id, 'action', l.action, 'name', public.coolerco_person_name(l.user_id),
                                                          'by', public.coolerco_person_name(l.by_user), 'note', l.note, 'at', l.at) order by l.at desc)
                     from (select * from public.coolerco_route_crew_log where route_id = any (v_ids) order by at desc limit 50) l), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.coolerco_crew_board(date, text) from public, anon;
grant execute on function public.coolerco_crew_board(date, text) to authenticated;

-- set a route's crew (driver + helpers). Null driver and no helpers = back to the slot's usual person.
create or replace function public.coolerco_crew_set(p_route uuid, p_driver uuid, p_helpers uuid[] default '{}', p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can change a crew'; end if;
  if not exists (select 1 from public.routing_routes where id = p_route) then raise exception 'Route not found'; end if;
  delete from public.coolerco_route_crew where route_id = p_route;
  if p_driver is not null then
    insert into public.coolerco_route_crew (route_id, user_id, crew_role, note) values (p_route, p_driver, 'driver', p_note);
  end if;
  insert into public.coolerco_route_crew (route_id, user_id, crew_role, note)
  select p_route, h, 'helper', p_note from unnest(coalesce(p_helpers, '{}')) h where h is distinct from p_driver
  on conflict do nothing;
  insert into public.coolerco_route_crew_log (route_id, user_id, action, note)
  values (p_route, p_driver, case when p_driver is null and coalesce(cardinality(p_helpers), 0) = 0 then 'back_to_usual' else 'crew_set' end, p_note);
end $$;
revoke all on function public.coolerco_crew_set(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.coolerco_crew_set(uuid, uuid, uuid[], text) to authenticated;

create or replace function public.coolerco_crew_decide(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.coolerco_crew_requests; v_helpers uuid[];
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can decide'; end if;
  select * into q from public.coolerco_crew_requests where id = p_request for update;
  if q.id is null or q.status <> 'pending' then raise exception 'Request not found or already decided'; end if;
  update public.coolerco_crew_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decide_note = p_note where id = q.id;
  if p_approve and q.kind = 'claim' then
    select array_agg(user_id) into v_helpers from public.coolerco_route_crew where route_id = q.route_id and crew_role = 'helper' and user_id <> q.user_id;
    perform public.coolerco_crew_set(q.route_id, q.user_id, coalesce(v_helpers, '{}'), coalesce(p_note, 'Driver claimed the route'));
  elsif p_approve and q.kind = 'not_mine' then
    delete from public.coolerco_route_crew where route_id = q.route_id and user_id = q.user_id;
  end if;
  insert into public.coolerco_route_crew_log (route_id, user_id, action, note)
  values (q.route_id, q.user_id, case when p_approve then 'request_approved' else 'request_rejected' end, q.kind || coalesce(' · ' || p_note, ''));
end $$;
revoke all on function public.coolerco_crew_decide(uuid, boolean, text) from public, anon;
grant execute on function public.coolerco_crew_decide(uuid, boolean, text) to authenticated;

select warehouse_code, worker_type, count(*) slots, count(routeiq_username) with_routeiq_name
  from public.coolerco_field_slots group by 1, 2 order by 1, 2;
