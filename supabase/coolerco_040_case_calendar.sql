-- ============================================================================
-- CoolerCo 040 — SLA follow-up calendar (Cases → 📅 Case calendar)
-- Run on: TEST first (🟢[TEST] RTMA_Ops). Production only when Wanda says so.
-- Needs:  028 (coolerco_all_cases), 016 (coolerco_has_role). Reads the routing tables
--         (routing_routes / _versions / _stops) when they exist — read only.
-- Adds:   2 small tables (public holidays, SLA rules) + 5 functions. Nothing existing
--         is changed; COM `cases` and the routing tables are only READ.
-- Rollback: coolerco_040_rollback.sql
--
-- How a case's due date is found (Wanda 2026-11-19):
--   • COM cases: COM's own SLA end date (`end_date`) — every COM case has one.
--   • CoolerCo / Tiger cases: their own end_date once approved; until then the SLA
--     rule below (default 2 working days from the logged date; weekends + SA public
--     holidays skipped). Rules can be changed per client / case type / warehouse.
-- What each colour means on the calendar:
--   late       still open (or needs action) and the due date has passed
--   open       still open, not due yet (today counts as not late)
--   closed_late / closed_ontime   closed; COM's own SLA result where it has one
--   cancelled  cancelled / rejected (not counted in the on-time %)
-- ============================================================================

-- ── 1. Public holidays (same table + rows as script 036 — whichever runs first creates it)
create table if not exists public.coolerco_public_holidays (
  holiday_date date primary key,
  name         text not null
);
insert into public.coolerco_public_holidays (holiday_date, name) values
  ('2026-01-01', 'New Year''s Day'), ('2026-03-21', 'Human Rights Day'), ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Family Day'), ('2026-04-27', 'Freedom Day'), ('2026-05-01', 'Workers'' Day'),
  ('2026-06-16', 'Youth Day'), ('2026-08-10', 'National Women''s Day (observed)'), ('2026-09-24', 'Heritage Day'),
  ('2026-12-16', 'Day of Reconciliation'), ('2026-12-25', 'Christmas Day'), ('2026-12-26', 'Day of Goodwill'),
  ('2027-01-01', 'New Year''s Day'), ('2027-03-22', 'Human Rights Day (observed)'), ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Family Day'), ('2027-04-27', 'Freedom Day'), ('2027-05-01', 'Workers'' Day'),
  ('2027-06-16', 'Youth Day'), ('2027-08-09', 'National Women''s Day'), ('2027-09-24', 'Heritage Day'),
  ('2027-12-16', 'Day of Reconciliation'), ('2027-12-25', 'Christmas Day'), ('2027-12-27', 'Day of Goodwill (observed)')
on conflict (holiday_date) do nothing;

alter table public.coolerco_public_holidays enable row level security;
revoke all on public.coolerco_public_holidays from anon, authenticated;
grant select on public.coolerco_public_holidays to authenticated;
drop policy if exists coolerco_public_holidays_read on public.coolerco_public_holidays;
create policy coolerco_public_holidays_read on public.coolerco_public_holidays for select to authenticated using (true);

-- ── 2. SLA rules (only used where a case has no end date of its own) ──────────
-- Empty client / case type / warehouse = "any". The most specific active rule wins.
create table if not exists public.coolerco_sla_rules (
  id                 bigint generated always as identity primary key,
  client_code        text,                         -- MAGNUM / TIGER / null = any
  case_type          text,                         -- e.g. 'Deliver an Asset' / null = any
  warehouse_workshop text,                         -- e.g. 'RTMA Gauteng' / null = any
  working_days       int  not null default 2 check (working_days between 0 and 90),
  clock_starts       text not null default 'logged' check (clock_starts in ('logged', 'approved')),
  active             boolean not null default true,
  note               text,
  updated_at         timestamptz not null default now(),
  updated_by         text default (auth.jwt() ->> 'email')
);
insert into public.coolerco_sla_rules (client_code, case_type, warehouse_workshop, working_days, clock_starts, note)
select null, null, null, 2, 'logged', 'Default: 2 working days from the logged date (Wanda 2026-11-19)'
where not exists (select 1 from public.coolerco_sla_rules);

alter table public.coolerco_sla_rules enable row level security;
revoke all on public.coolerco_sla_rules from anon, authenticated;
grant select, insert, update on public.coolerco_sla_rules to authenticated;
drop policy if exists coolerco_sla_rules_read on public.coolerco_sla_rules;
create policy coolerco_sla_rules_read on public.coolerco_sla_rules for select to authenticated using (true);
drop policy if exists coolerco_sla_rules_admin on public.coolerco_sla_rules;
create policy coolerco_sla_rules_admin on public.coolerco_sla_rules for all to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator']))
  with check (public.coolerco_has_role(array['system_admin', 'administrator']));

-- ── 3. Working days: start date + n working days (skips Sat, Sun, public holidays)
create or replace function public.coolerco_add_working_days(p_start date, p_days int)
returns date language plpgsql stable set search_path = public, pg_temp as $$
declare d date := p_start; n int := 0;
begin
  if p_start is null then return null; end if;
  while n < greatest(coalesce(p_days, 0), 0) loop
    d := d + 1;
    if extract(isodow from d) < 6
       and not exists (select 1 from public.coolerco_public_holidays h where h.holiday_date = d) then
      n := n + 1;
    end if;
  end loop;
  return d;
end $$;

-- Due date from the SLA rules (for cases without an end date)
create or replace function public.coolerco_sla_due_date(p_client text, p_case_type text, p_warehouse text,
                                                        p_created timestamptz, p_approved timestamptz)
returns date language sql stable set search_path = public, pg_temp as $$
  select public.coolerco_add_working_days(
           ((case when r.clock_starts = 'approved' and p_approved is not null then p_approved else p_created end)
             at time zone 'Africa/Johannesburg')::date,
           coalesce(r.working_days, 2))
  from (select 1) one
  left join lateral (
    select x.* from public.coolerco_sla_rules x
    where x.active
      and (x.client_code is null or x.client_code = p_client)
      and (x.case_type is null or x.case_type = p_case_type)
      and (x.warehouse_workshop is null or x.warehouse_workshop = p_warehouse)
    order by (x.client_code is not null)::int + (x.case_type is not null)::int + (x.warehouse_workshop is not null)::int desc, x.id desc
    limit 1) r on true
$$;

-- ── 4. One row per case with its due date, colour and routing info ────────────
-- p_since keeps old closed cases out (open / needs-action cases are always in, whatever their age).
-- (dropped first so a re-run can change its columns)
drop function if exists public.coolerco_case_calendar_rows(date, text, text, text);
create or replace function public.coolerco_case_calendar_rows(
  p_since date, p_warehouse text default null, p_client text default null, p_case_type text default null)
returns table (
  case_number text, source text, client_code text, case_type text, status_reason text, priority text,
  warehouse_workshop text, point_of_sale text, pos_local_code text, responsible_ordering_party text,
  asset text, created_on timestamptz, service_closure_date timestamptz, sla_status text,
  due_date date, due_from text, bucket text, needs_action boolean, follow_up boolean,
  route_id text, route_number text, route_date date, route_outcome text, app_done_com_open boolean)
language plpgsql stable set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  return query
  with base as (
    select a.*,
           lower(trim(coalesce(a.status_reason, ''))) as st
    from public.coolerco_all_cases a
    where a.counts_as_case
      and (p_warehouse is null or a.warehouse_workshop = p_warehouse)
      and (p_client    is null or a.client_code = p_client)
      and (p_case_type is null or a.case_type = p_case_type)
      and (a.is_open
           or lower(trim(coalesce(a.status_reason, ''))) in ('action required', 'approval required', 'error', 'error external')
           or a.created_on >= (p_since - 120)
           or a.service_closure_date >= (p_since - 1))
  ),
  rt as (   -- latest route a case is on (current route version only)
    select distinct on (s.case_number) s.case_number, r.id::text as route_id, r.route_number::text as route_number,
           r.route_date::date as route_date, s.outcome_status::text as outcome_status
    from public.routing_route_stops s
    join public.routing_route_versions v on v.id = s.route_version_id and v.is_current
    join public.routing_routes r on r.id = s.route_id
    where s.case_number in (select b.case_number from base b)
    order by s.case_number, r.route_date desc
  ),
  d as (
    select b.*,
           (b.is_open or b.st in ('action required', 'approval required', 'error', 'error external')) as fu,
           b.st in ('action required', 'approval required', 'error', 'error external') as na,
           coalesce((b.end_date at time zone 'Africa/Johannesburg')::date,
                    public.coolerco_sla_due_date(b.client_code, b.case_type, b.warehouse_workshop, b.created_on, b.begin_date)) as due,
           case when b.end_date is not null then 'case' else 'rule' end as due_src
    from base b
  )
  select d.case_number, d.source, d.client_code, d.case_type, d.status_reason, d.priority,
         d.warehouse_workshop, d.point_of_sale, d.pos_local_code, d.responsible_ordering_party,
         coalesce(d.asset_repaired, d.asset_delivered, d.asset_removed, d.mapped_asset),
         d.created_on, d.service_closure_date, d.sla_status,
         d.due, d.due_src,
         case
           when d.fu then case when d.due < v_today then 'late' else 'open' end
           when d.st in ('canceled', 'cancelled', 'rejected') or coalesce(d.sla_status, '') ilike 'cancel%' then 'cancelled'
           when d.sla_status in ('SLA Met', 'SLA Exceeded') then 'closed_ontime'
           when d.sla_status in ('SLA Not Met', 'Open Case SLA Not Met') then 'closed_late'
           when d.service_closure_date is not null and d.due is not null
                and (d.service_closure_date at time zone 'Africa/Johannesburg')::date > d.due then 'closed_late'
           else 'closed_ontime'
         end,
         d.na, d.fu,
         rt.route_id, rt.route_number, rt.route_date, rt.outcome_status,
         coalesce(d.source = 'COM' and d.fu and rt.outcome_status = 'solved', false)
  from d
  left join rt on rt.case_number = d.case_number;
end $$;

-- the date a case is placed on, for the chosen view
create or replace function public.coolerco_case_calendar_place(p_place_by text, p_due date, p_created timestamptz,
                                                               p_closed timestamptz, p_route date)
returns date language sql immutable as $$
  select case coalesce(p_place_by, 'due')
           when 'logged' then (p_created at time zone 'Africa/Johannesburg')::date
           when 'closed' then (p_closed  at time zone 'Africa/Johannesburg')::date
           when 'routed' then p_route
           else p_due end
$$;

-- ── 5. Month summary: one call fills the whole page ───────────────────────────
-- p_place_by: due (default) | logged | closed | routed
create or replace function public.coolerco_case_calendar(
  p_month date, p_place_by text default 'due', p_warehouse text default null,
  p_client text default null, p_case_type text default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from  date := date_trunc('month', coalesce(p_month, now()::date))::date;
  v_to    date := (date_trunc('month', coalesce(p_month, now()::date)) + interval '1 month - 1 day')::date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_next  date := public.coolerco_add_working_days((now() at time zone 'Africa/Johannesburg')::date, 1);
  v_res   jsonb;
begin
  with r as (
    select x.*, public.coolerco_case_calendar_place(p_place_by, x.due_date, x.created_on, x.service_closure_date, x.route_date) as place
    from public.coolerco_case_calendar_rows(v_from, p_warehouse, p_client, p_case_type) x
  ),
  days as (
    select g::date as d from generate_series(v_from, v_to, interval '1 day') g
  ),
  per_day as (
    select dd.d,
           count(r.*) filter (where r.bucket = 'late')          as late,
           count(r.*) filter (where r.bucket = 'open')          as open,
           count(r.*) filter (where r.bucket = 'closed_late')   as closed_late,
           count(r.*) filter (where r.bucket = 'closed_ontime') as closed_ontime,
           count(r.*) filter (where r.bucket = 'cancelled')     as cancelled,
           count(r.*) filter (where r.app_done_com_open)        as gap
    from days dd left join r on r.place = dd.d
    group by dd.d
  ),
  closed_in_month as (
    select * from r
    where r.bucket in ('closed_ontime', 'closed_late')
      and (r.service_closure_date at time zone 'Africa/Johannesburg')::date between v_from and v_to
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'today', v_today, 'next_working_day', v_next, 'place_by', coalesce(p_place_by, 'due'),
    'days', (select jsonb_agg(jsonb_build_object('d', d, 'late', late, 'open', open, 'closed_late', closed_late,
                                                 'closed_ontime', closed_ontime, 'cancelled', cancelled, 'gap', gap) order by d) from per_day),
    'kpi', jsonb_build_object(
      'overdue',      (select count(*) from r where r.follow_up and r.due_date < v_today),
      'due_today',    (select count(*) from r where r.follow_up and r.due_date = v_today),
      'due_next',     (select count(*) from r where r.follow_up and r.due_date = v_next),
      'needs_action', (select count(*) from r where r.needs_action),
      'open_total',   (select count(*) from r where r.follow_up),
      'carried',      (select count(*) from r where r.follow_up and r.place < v_from),
      'not_placed',   (select count(*) from r where r.follow_up and r.place is null),
      'gap',          (select count(*) from r where r.app_done_com_open),
      'closed',       (select count(*) from closed_in_month),
      'closed_ontime',(select count(*) from closed_in_month where bucket = 'closed_ontime'),
      'holidays',     (select coalesce(jsonb_object_agg(h.holiday_date, h.name), '{}'::jsonb)
                       from public.coolerco_public_holidays h where h.holiday_date between v_from and v_to)),
    'by_type', (select coalesce(jsonb_agg(t order by t ->> 'case_type'), '[]'::jsonb) from (
                  select jsonb_build_object('case_type', r.case_type,
                           'total', count(*), 'late', count(*) filter (where r.bucket = 'late'),
                           'open', count(*) filter (where r.bucket = 'open'),
                           'closed', count(*) filter (where r.bucket in ('closed_ontime', 'closed_late')),
                           'ontime', count(*) filter (where r.bucket = 'closed_ontime')) as t
                  from r where r.place between v_from and v_to group by r.case_type) q),
    'com_data_up_to', (select max(a.created_on) from public.coolerco_all_cases a where a.source = 'COM')
  ) into v_res;
  return v_res;
end $$;

-- ── 6. Case list for the follow-up panel ──────────────────────────────────────
-- p_view: day (cases placed on p_date) | carried (open, placed before the month) | overdue |
--         due_soon (today + next working day) | needs_action | gap (done on app, open in COM) | not_placed
create or replace function public.coolerco_case_calendar_list(
  p_view text, p_date date default null, p_month date default null, p_place_by text default 'due',
  p_warehouse text default null, p_client text default null, p_case_type text default null, p_limit int default 500)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from  date := date_trunc('month', coalesce(p_month, p_date, now()::date))::date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_next  date := public.coolerco_add_working_days((now() at time zone 'Africa/Johannesburg')::date, 1);
  v_res   jsonb;
begin
  with r as (
    select x.*, public.coolerco_case_calendar_place(p_place_by, x.due_date, x.created_on, x.service_closure_date, x.route_date) as place
    from public.coolerco_case_calendar_rows(least(v_from, coalesce(p_date, v_from)), p_warehouse, p_client, p_case_type) x
  ),
  pick as (
    select * from r
    where case coalesce(p_view, 'day')
            when 'day'          then r.place = p_date
            when 'carried'      then r.follow_up and r.place < v_from
            when 'overdue'      then r.follow_up and r.due_date < v_today
            when 'due_soon'     then r.follow_up and r.due_date in (v_today, v_next)
            when 'needs_action' then r.needs_action
            when 'gap'          then r.app_done_com_open
            when 'not_placed'   then r.follow_up and r.place is null
            else false end
  ),
  counted as (select count(*) as n from pick)
  select jsonb_build_object('total', (select n from counted), 'rows', coalesce((
    select jsonb_agg(to_jsonb(p) - 'place' || jsonb_build_object(
             'days_late', case when p.follow_up and p.due_date < v_today then v_today - p.due_date end) order by
             case p.bucket when 'late' then 0 when 'open' then 1 when 'closed_late' then 2 when 'closed_ontime' then 3 else 4 end,
             p.needs_action desc,
             case lower(coalesce(p.priority, '')) when 'high' then 0 when 'medium' then 1 else 2 end,
             p.due_date, p.case_number)
    from (select * from pick
          order by case bucket when 'late' then 0 when 'open' then 1 else 2 end, due_date
          limit greatest(least(coalesce(p_limit, 500), 2000), 1)) p), '[]'::jsonb)) into v_res;
  return v_res;
end $$;

-- ── 7. Who may call them: signed-in users only (never the public key) ─────────
-- All functions run with the caller's own rights (security invoker).
revoke all on function public.coolerco_add_working_days(date, int) from public, anon;
revoke all on function public.coolerco_sla_due_date(text, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.coolerco_case_calendar_rows(date, text, text, text) from public, anon;
revoke all on function public.coolerco_case_calendar_place(text, date, timestamptz, timestamptz, date) from public, anon;
revoke all on function public.coolerco_case_calendar(date, text, text, text, text) from public, anon;
revoke all on function public.coolerco_case_calendar_list(text, date, date, text, text, text, text, int) from public, anon;
grant execute on function public.coolerco_add_working_days(date, int) to authenticated;
grant execute on function public.coolerco_sla_due_date(text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.coolerco_case_calendar_rows(date, text, text, text) to authenticated;
grant execute on function public.coolerco_case_calendar_place(text, date, timestamptz, timestamptz, date) to authenticated;
grant execute on function public.coolerco_case_calendar(date, text, text, text, text) to authenticated;
grant execute on function public.coolerco_case_calendar_list(text, date, date, text, text, text, text, int) to authenticated;

comment on table public.coolerco_sla_rules is 'CoolerCo 040: SLA for cases without their own end date (CoolerCo / Tiger). Most specific active rule wins; empty = any.';
comment on function public.coolerco_case_calendar(date, text, text, text, text) is 'CoolerCo 040: month summary for the SLA follow-up calendar.';

-- ── 8. Checks after running (read only) ──────────────────────────────────────
-- select public.coolerco_add_working_days('2026-12-24', 2);            -- expect 2026-12-29 (25, 26, 27 skipped)
-- select public.coolerco_case_calendar(current_date) -> 'kpi';
-- select public.coolerco_case_calendar_list('overdue') -> 'total';
