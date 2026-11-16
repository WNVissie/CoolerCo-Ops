-- CoolerCo-Ops · 033 · RUN ON TEST — Field app: warehouse departure / return, delays, POS detail reports
-- Same features as RouteIQ's mobile trip sheet, saved in our own tables (RouteIQ is not touched):
--   coolerco_field_route_events — 🏭 left warehouse · 🏠 returned to warehouse · ⏱ delay (late departure / running late /
--                                  delay at a POS) with reason + note. Append only; id made on the phone.
--   coolerco_field_pos_reports  — ⚠️ Incorrect POS detail: which details are wrong (address, POS name, GPS, contact),
--                                  a note per issue, the corrected values the driver knows, and the phone's GPS.
--                                  Goes to review — it never changes the saved POS details itself.
-- Rollback: coolerco_033_rollback.sql

create table if not exists public.coolerco_field_route_events (
  id              uuid primary key,
  route_id        uuid not null,
  stop_id         uuid,                                   -- only for a delay at a POS
  case_number     text,
  pos_local_code  text,
  event_type      text not null check (event_type in ('left_warehouse', 'returned_warehouse', 'delay')),
  delay_type      text check (delay_type in ('late_departure', 'running_late', 'pos_delay')),
  reason          text,
  note            text,
  occurred_at     timestamptz not null,
  latitude        double precision,
  longitude       double precision,
  accuracy_m      double precision,
  driver_username text,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  check (event_type <> 'delay' or (delay_type is not null and reason is not null))
);
create index if not exists idx_coolerco_fre_route on public.coolerco_field_route_events (route_id, occurred_at);

create table if not exists public.coolerco_field_pos_reports (
  id                uuid primary key,
  route_id          uuid,
  stop_id           uuid,
  pos_local_code    text,
  point_of_sale     text,
  issues            jsonb not null default '[]'::jsonb,  -- [{ "type": "incorrect_address", "note": "..." }]
  new_pos_name      text,
  new_address       text,
  new_contact_name  text,
  new_contact_phone text,
  latitude          double precision,                   -- phone's GPS when "Capture current GPS" was tapped
  longitude         double precision,
  accuracy_m        double precision,
  review_status     text not null default 'new' check (review_status in ('new', 'accepted', 'rejected')),
  driver_username   text,
  created_by        uuid not null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists idx_coolerco_fpr_pos on public.coolerco_field_pos_reports (pos_local_code, created_at desc);

alter table public.coolerco_field_route_events enable row level security;
alter table public.coolerco_field_pos_reports  enable row level security;
revoke all on public.coolerco_field_route_events, public.coolerco_field_pos_reports from public, anon, authenticated;
grant select, insert on public.coolerco_field_route_events, public.coolerco_field_pos_reports to authenticated;

drop policy if exists coolerco_fre_read on public.coolerco_field_route_events;
create policy coolerco_fre_read on public.coolerco_field_route_events for select to authenticated using (true);
drop policy if exists coolerco_fre_add on public.coolerco_field_route_events;
create policy coolerco_fre_add on public.coolerco_field_route_events for insert to authenticated with check (created_by = auth.uid());
drop policy if exists coolerco_fpr_read on public.coolerco_field_pos_reports;
create policy coolerco_fpr_read on public.coolerco_field_pos_reports for select to authenticated using (true);
drop policy if exists coolerco_fpr_add on public.coolerco_field_pos_reports;
create policy coolerco_fpr_add on public.coolerco_field_pos_reports for insert to authenticated with check (created_by = auth.uid());

select to_regclass('public.coolerco_field_route_events') is not null as route_events,
       to_regclass('public.coolerco_field_pos_reports') is not null as pos_reports;
