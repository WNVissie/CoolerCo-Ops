-- ════════════════════════════════════════════════════════════════════════════
-- CoolerCo 036 — Store (POS) opening hours + receiving hours            TEST first
-- Wanda 2026-11-18: "a POS can be open from 8 – 9 but it only receives from 9 – 3".
--
--   • Per store (POS L-code) and per day: Mon … Sun + "public holiday" (day 8).
--   • Opening hours  = when the store is open (repairs at the store, visits).
--   • Receiving hours = when the store accepts deliveries / collections
--                        (Deliver, Replacement, Removal). Optional 2nd window (e.g. lunch break).
--                        Empty = same as the opening hours. May lie outside opening hours
--                        (back-door receiving before the store opens).
--   • Closed days, notes, who changed what (log). Public holidays table (SA 2026–2027).
--   • Read: any signed-in user. Change: only through coolerco_pos_hours_set
--     (system_admin, administrator, manager, supervisor, supplier).
-- All objects are new (coolerco_ prefix). Nothing existing is changed.
-- Rollback: coolerco_036_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.coolerco_pos_hours (
  pos_local_code text     not null,
  day            smallint not null check (day between 1 and 8),      -- 1 Mon … 7 Sun, 8 public holiday
  closed         boolean  not null default false,
  open_from      time, open_to      time,
  receive_from   time, receive_to   time,
  receive2_from  time, receive2_to  time,
  note           text,
  source         text not null default 'staff' check (source in ('staff', 'customer', 'driver', 'import')),
  updated_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  primary key (pos_local_code, day),
  constraint coolerco_pos_hours_open_ok check (closed or (open_from is not null and open_to is not null and open_from < open_to)),
  constraint coolerco_pos_hours_recv_ok check ((receive_from is null) = (receive_to is null) and (receive_from is null or receive_from < receive_to)),
  constraint coolerco_pos_hours_recv2_ok check ((receive2_from is null) = (receive2_to is null) and (receive2_from is null or receive2_from < receive2_to)),
  constraint coolerco_pos_hours_recv2_after check (receive2_from is null or (receive_to is not null and receive2_from >= receive_to))
);
comment on table public.coolerco_pos_hours is 'CoolerCo 036: store opening + receiving hours per POS L-code and day (1 Mon … 7 Sun, 8 public holiday). Change via coolerco_pos_hours_set.';

create table if not exists public.coolerco_pos_hours_log (
  id             bigint generated always as identity primary key,
  pos_local_code text not null,
  day            smallint not null,
  action         text not null check (action in ('set', 'clear')),
  old_row        jsonb,
  new_row        jsonb,
  source         text,
  note           text,
  changed_by     uuid default auth.uid(),
  changed_at     timestamptz not null default now()
);
create index if not exists coolerco_pos_hours_log_pos on public.coolerco_pos_hours_log (pos_local_code, changed_at desc);

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

-- ── security: read for signed-in users, no direct writes ──────────────────────
alter table public.coolerco_pos_hours       enable row level security;
alter table public.coolerco_pos_hours_log   enable row level security;
alter table public.coolerco_public_holidays enable row level security;
revoke all on public.coolerco_pos_hours, public.coolerco_pos_hours_log, public.coolerco_public_holidays from anon, authenticated;
grant select on public.coolerco_pos_hours, public.coolerco_public_holidays to authenticated;
drop policy if exists coolerco_pos_hours_read on public.coolerco_pos_hours;
create policy coolerco_pos_hours_read on public.coolerco_pos_hours for select to authenticated using (true);
drop policy if exists coolerco_public_holidays_read on public.coolerco_public_holidays;
create policy coolerco_public_holidays_read on public.coolerco_public_holidays for select to authenticated using (true);
-- the log is read through coolerco_pos_hours_history (staff only)

-- ── who may change hours ──────────────────────────────────────────────────────
create or replace function public.coolerco_can_edit_pos_hours()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier'])
$$;

-- ── set / clear hours for one or many stores ─────────────────────────────────
-- p_pos  : L-codes (max 2,000 per call) — the same days are written to each store (copy hours to a chain).
-- p_days : [{ "day": 1, "closed": false, "open_from": "08:00", "open_to": "21:00",
--             "receive_from": "09:00", "receive_to": "15:00", "receive2_from": null, "receive2_to": null }, …]
--          { "day": 3, "clear": true } removes that day. Days not listed are left as they are.
-- Returns the number of store-days written.
create or replace function public.coolerco_pos_hours_set(p_pos text[], p_days jsonb, p_note text default null, p_source text default 'staff')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pos text; v_d jsonb; v_day int; v_old public.coolerco_pos_hours; v_new public.coolerco_pos_hours; v_n int := 0;
  t time;
  fld text;
  v_c text;
begin
  if not public.coolerco_can_edit_pos_hours() then
    raise exception 'Only supervisors, managers, administrators or the supplier can change store hours' using errcode = '42501';
  end if;
  if p_source not in ('staff', 'customer', 'driver', 'import') then raise exception 'Unknown source %', p_source; end if;
  if p_pos is null or cardinality(p_pos) = 0 then raise exception 'No store given'; end if;
  if cardinality(p_pos) > 2000 then raise exception 'At most 2,000 stores at a time'; end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) = 0 then raise exception 'No days given'; end if;

  foreach v_pos in array (select array_agg(distinct upper(btrim(x))) from unnest(p_pos) x where btrim(coalesce(x, '')) <> '') loop
    for v_d in select * from jsonb_array_elements(p_days) loop
      v_day := (v_d->>'day')::int;
      if v_day is null or v_day not between 1 and 8 then raise exception 'Day must be 1 (Mon) … 7 (Sun) or 8 (public holiday)'; end if;
      select * into v_old from public.coolerco_pos_hours where pos_local_code = v_pos and day = v_day;

      if coalesce((v_d->>'clear')::boolean, false) then
        if found then
          delete from public.coolerco_pos_hours where pos_local_code = v_pos and day = v_day;
          insert into public.coolerco_pos_hours_log (pos_local_code, day, action, old_row, source, note)
          values (v_pos, v_day, 'clear', to_jsonb(v_old), p_source, p_note);
          v_n := v_n + 1;
        end if;
        continue;
      end if;

      -- times as "HH:MM" (or "24:00" for midnight closing); empty string = no time
      foreach fld in array array['open_from', 'open_to', 'receive_from', 'receive_to', 'receive2_from', 'receive2_to'] loop
        if nullif(v_d->>fld, '') is not null then
          begin t := (v_d->>fld)::time; exception when others then raise exception 'Day %: "%" is not a time (use HH:MM)', v_day, v_d->>fld; end;
        end if;
      end loop;

      insert into public.coolerco_pos_hours as h (pos_local_code, day, closed, open_from, open_to, receive_from, receive_to, receive2_from, receive2_to, note, source, updated_by, updated_at)
      values (v_pos, v_day, coalesce((v_d->>'closed')::boolean, false),
              nullif(v_d->>'open_from', '')::time, nullif(v_d->>'open_to', '')::time,
              nullif(v_d->>'receive_from', '')::time, nullif(v_d->>'receive_to', '')::time,
              nullif(v_d->>'receive2_from', '')::time, nullif(v_d->>'receive2_to', '')::time,
              nullif(btrim(coalesce(v_d->>'note', '')), ''), p_source, auth.uid(), now())
      on conflict (pos_local_code, day) do update set
        closed = excluded.closed, open_from = excluded.open_from, open_to = excluded.open_to,
        receive_from = excluded.receive_from, receive_to = excluded.receive_to,
        receive2_from = excluded.receive2_from, receive2_to = excluded.receive2_to,
        note = excluded.note, source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      returning * into v_new;

      if v_old is null or (to_jsonb(v_old) - 'updated_at' - 'updated_by' - 'source') is distinct from (to_jsonb(v_new) - 'updated_at' - 'updated_by' - 'source') then
        insert into public.coolerco_pos_hours_log (pos_local_code, day, action, old_row, new_row, source, note)
        values (v_pos, v_day, 'set', to_jsonb(v_old), to_jsonb(v_new), p_source, p_note);
      end if;
      v_n := v_n + 1;
      v_old := null;
    end loop;
  end loop;
  return v_n;
exception
  when check_violation then
    get stacked diagnostics v_c = constraint_name;
    raise exception 'Day %: %', v_day, case v_c
      when 'coolerco_pos_hours_open_ok'    then 'opening hours need a "from" before the "to" — or tick Closed'
      when 'coolerco_pos_hours_recv_ok'    then 'receiving hours need both times, "from" before "to" (leave both empty = same as opening hours)'
      when 'coolerco_pos_hours_recv2_ok'   then 'the 2nd receiving window needs both times, "from" before "to"'
      when 'coolerco_pos_hours_recv2_after' then 'the 2nd receiving window must start after the 1st one ends'
      else sqlerrm end;
end $$;

-- ── hours that apply to one store on one date (public holiday row wins on a holiday) ──
-- Returns null when the store has no hours captured.
-- { pos, date, day, holiday, closed, open_from, open_to, receive_from, receive_to, receive2_from, receive2_to,
--   receive_same_as_open, note, source, updated_at }
create or replace function public.coolerco_pos_hours_for(p_pos text, p_date date)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with hol as (select name from public.coolerco_public_holidays where holiday_date = p_date),
  pick as (
    select h.*, (select name from hol) as holiday
    from public.coolerco_pos_hours h
    where h.pos_local_code = upper(btrim(p_pos))
      and h.day = case when exists (select 1 from hol)
                        and exists (select 1 from public.coolerco_pos_hours x where x.pos_local_code = upper(btrim(p_pos)) and x.day = 8)
                       then 8 else extract(isodow from p_date)::int end
  )
  select jsonb_build_object(
    'pos', pos_local_code, 'date', p_date, 'day', day, 'holiday', holiday, 'closed', closed,
    'open_from', to_char(open_from, 'HH24:MI'), 'open_to', to_char(open_to, 'HH24:MI'),
    'receive_from', to_char(coalesce(receive_from, open_from), 'HH24:MI'), 'receive_to', to_char(coalesce(receive_to, open_to), 'HH24:MI'),
    'receive2_from', to_char(receive2_from, 'HH24:MI'), 'receive2_to', to_char(receive2_to, 'HH24:MI'),
    'receive_same_as_open', receive_from is null, 'note', note, 'source', source, 'updated_at', updated_at)
  from pick
$$;

-- ── change history for one store (staff) ─────────────────────────────────────
create or replace function public.coolerco_pos_hours_history(p_pos text, p_limit int default 50)
returns table (day smallint, action text, old_row jsonb, new_row jsonb, source text, note text, changed_by_email text, changed_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.day, l.action, l.old_row, l.new_row, l.source, l.note, u.email::text, l.changed_at
  from public.coolerco_pos_hours_log l
  left join auth.users u on u.id = l.changed_by
  where l.pos_local_code = upper(btrim(p_pos))
    and public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier', 'viewer'])
  order by l.changed_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

revoke all on function public.coolerco_can_edit_pos_hours(), public.coolerco_pos_hours_set(text[], jsonb, text, text),
  public.coolerco_pos_hours_for(text, date), public.coolerco_pos_hours_history(text, int) from public, anon;
grant execute on function public.coolerco_can_edit_pos_hours(), public.coolerco_pos_hours_set(text[], jsonb, text, text),
  public.coolerco_pos_hours_for(text, date), public.coolerco_pos_hours_history(text, int) to authenticated;
