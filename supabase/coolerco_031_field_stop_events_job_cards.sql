-- CoolerCo-Ops · 031 · RUN ON TEST (laljfgwngculogdzmqiu) — Field app taps + job cards (UAT, RouteIQ untouched)
-- Why: drivers / technicians record Arrived · Completed · Not completed · Left POS and the job card inside the
--      CoolerCo Field app, also without signal (the phone queues them). Saved here, NOT in routing_* tables
--      (those are copied from production twice a day and belong to RouteIQ). Later the same rows are sent to RouteIQ.
-- What it adds (all new coolerco_ objects; nothing existing is changed):
--   coolerco_field_reasons      — "not completed" reasons (editable list)
--   coolerco_field_stop_events  — one row per tap (append only; the latest tap of a kind counts)
--   coolerco_field_job_cards    — one row per job card sent (append only; the latest per stop counts)
--   coolerco_field_stop_status  — view: latest state per stop (for My trip and staff screens)
-- Ids are made on the phone, so a tap sent twice is saved once.
-- Rollback: coolerco_031_rollback.sql

create table if not exists public.coolerco_field_reasons (
  code       text primary key,
  label      text not null,
  needs_note boolean not null default false,
  active     boolean not null default true,
  sort_order int not null default 100
);
insert into public.coolerco_field_reasons (code, label, needs_note, sort_order) values
  ('SERVICE_DENIED',    'Service denied / refused entry',   false, 10),
  ('STORE_CLOSED',      'Store closed',                     false, 20),
  ('LOCATION_NOT_FOUND','Location not found',               false, 30),
  ('ASSET_MISSING',     'Asset missing',                    false, 40),
  ('WRONG_ASSET',       'Incorrect asset details',          true,  50),
  ('NO_CONTACT',        'No contact person available',      false, 60),
  ('NO_STOCK',          'Asset not on the truck / no stock',false, 70),
  ('NEEDS_WORKSHOP',    'Repair needs the workshop',        true,  80),
  ('NO_TIME',           'Ran out of time',                  false, 90),
  ('OTHER',             'Other',                            true,  99)
on conflict (code) do nothing;

create table if not exists public.coolerco_field_stop_events (
  id              uuid primary key,                       -- made on the phone
  stop_id         uuid not null,                          -- routing_route_stops.id (no link: routing is copied)
  route_id        uuid,
  case_number     text,
  pos_local_code  text,
  event_type      text not null check (event_type in ('arrived', 'completed', 'not_completed', 'left')),
  reason_code     text references public.coolerco_field_reasons(code),
  note            text,
  occurred_at     timestamptz not null,                   -- time on the phone when tapped
  latitude        double precision,
  longitude       double precision,
  accuracy_m      double precision,
  driver_username text,                                   -- routing name picked on the phone
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_coolerco_fse_stop on public.coolerco_field_stop_events (stop_id, occurred_at desc);
create index if not exists idx_coolerco_fse_case on public.coolerco_field_stop_events (case_number);

create table if not exists public.coolerco_field_job_cards (
  id                uuid primary key,                     -- made on the phone
  stop_id           uuid not null,
  route_id          uuid,
  case_number       text,
  case_type         text,
  pos_local_code    text,
  outcome           text not null check (outcome in ('completed', 'not_completed')),
  reason_code       text references public.coolerco_field_reasons(code),
  work_done         text,
  received_by_name  text,
  received_by_phone text,
  received_by_other boolean not null default false,       -- someone other than the store contact signed
  delivered_barcode text,
  removed_barcode   text,
  repaired_barcode  text,
  planned_barcode   text,                                 -- the asset that was picked / planned
  swapped           boolean not null default false,       -- delivered asset differs from the planned one
  swap_family_ok    boolean,                              -- same product family (null = could not check)
  swap_note         text,
  photo_paths       text[] not null default '{}',
  signature_path    text,
  latitude          double precision,
  longitude         double precision,
  completed_at      timestamptz not null,                 -- time on the phone
  driver_username   text,
  created_by        uuid not null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists idx_coolerco_fjc_stop on public.coolerco_field_job_cards (stop_id, completed_at desc);
create index if not exists idx_coolerco_fjc_case on public.coolerco_field_job_cards (case_number);

-- latest state per stop
create or replace view public.coolerco_field_stop_status with (security_invoker = true) as
select s.stop_id,
       max(s.occurred_at) filter (where s.event_type = 'arrived') as arrived_at,
       max(s.occurred_at) filter (where s.event_type = 'left')    as left_at,
       (array_agg(s.event_type  order by s.occurred_at desc) filter (where s.event_type in ('completed', 'not_completed')))[1] as outcome,
       (array_agg(s.reason_code order by s.occurred_at desc) filter (where s.event_type in ('completed', 'not_completed')))[1] as reason_code,
       max(s.occurred_at) filter (where s.event_type in ('completed', 'not_completed')) as outcome_at,
       (array_agg(s.driver_username order by s.occurred_at desc))[1] as driver_username,
       (select j.id from public.coolerco_field_job_cards j where j.stop_id = s.stop_id order by j.completed_at desc limit 1) as job_card_id
  from public.coolerco_field_stop_events s
 group by s.stop_id;

-- permissions: signed-in users read all and add their own rows; nobody edits or deletes (append only)
alter table public.coolerco_field_reasons     enable row level security;
alter table public.coolerco_field_stop_events enable row level security;
alter table public.coolerco_field_job_cards   enable row level security;
revoke all on public.coolerco_field_reasons, public.coolerco_field_stop_events, public.coolerco_field_job_cards,
              public.coolerco_field_stop_status from public, anon, authenticated;
grant select on public.coolerco_field_reasons, public.coolerco_field_stop_status to authenticated;
grant select, insert on public.coolerco_field_stop_events, public.coolerco_field_job_cards to authenticated;

drop policy if exists coolerco_field_reasons_read on public.coolerco_field_reasons;
create policy coolerco_field_reasons_read on public.coolerco_field_reasons for select to authenticated using (true);
drop policy if exists coolerco_fse_read on public.coolerco_field_stop_events;
create policy coolerco_fse_read on public.coolerco_field_stop_events for select to authenticated using (true);
drop policy if exists coolerco_fse_add on public.coolerco_field_stop_events;
create policy coolerco_fse_add on public.coolerco_field_stop_events for insert to authenticated with check (created_by = auth.uid());
drop policy if exists coolerco_fjc_read on public.coolerco_field_job_cards;
create policy coolerco_fjc_read on public.coolerco_field_job_cards for select to authenticated using (true);
drop policy if exists coolerco_fjc_add on public.coolerco_field_job_cards;
create policy coolerco_fjc_add on public.coolerco_field_job_cards for insert to authenticated with check (created_by = auth.uid());

select (select count(*) from public.coolerco_field_reasons) as reasons,
       to_regclass('public.coolerco_field_stop_events') is not null as events_table,
       to_regclass('public.coolerco_field_job_cards') is not null as job_cards_table;
