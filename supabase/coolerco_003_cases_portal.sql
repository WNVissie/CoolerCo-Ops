-- CoolerCo-Ops · 003 · CoolerCo cases, case numbers, POS→warehouse, catalogue, customer portal
-- Target: RTMA_Ops PRODUCTION (abgxjfeofgvimmimxvpa)
-- ADDITIVE ONLY: new coolerco_ tables/functions, new columns on CoolerCo's own
-- coolerco_product_families table, a new private storage bucket. Nothing existing changes.
-- POS key everywhere = account local code with the "L" (e.g. L18042450) — same as
-- cases.pos_local_code, latest_pos_records.pos_id and assets_live.assign_account_local_code.

-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.coolerco_settings (key, value) values
  ('portal_catalogue_mode', '"all"'::jsonb),       -- 'all' | 'available'
  ('portal_daily_request_limit', '10'::jsonb)
on conflict (key) do nothing;

-- Case-number code + default SLA per warehouse (app code → case code)
create table if not exists public.coolerco_warehouse_settings (
  warehouse_code   text primary key,            -- JHB, CPT … (app code)
  case_code        text not null unique,        -- GT, CTN … (used in case numbers)
  com_name         text not null,               -- 'RTMA Gauteng' (cases.warehouse_workshop)
  default_sla_days int  not null default 2,
  notes            text,
  updated_at       timestamptz not null default now(),
  updated_by       text
);
insert into public.coolerco_warehouse_settings (warehouse_code, case_code, com_name) values
  ('JHB','GT','RTMA Gauteng'), ('CPT','CTN','RTMA Cape Town'), ('DBN','DBN','RTMA Durban'),
  ('BFN','BLM','RTMA Bloemfontein'), ('GEO','GRG','RTMA George'), ('EL','EL','RTMA East London'),
  ('PE','PE','RTMA Port Elizabeth'), ('POL','POL','RTMA Polokwane'), ('NEL','NEL','RTMA Nelspruit')
on conflict (warehouse_code) do nothing;

-- Location notes agreed 2026-10-25 (CoolerCo's own table)
update public.coolerco_wh_locations set notes = 'Receives NCD returns only when undelivered (not removed from a POS); NCD picking + loading'
 where area = 'NCD' and warehouse_code in ('JHB','CPT','DBN');
update public.coolerco_wh_locations set notes = 'Receive, repair, pick, prepare and load (mixed)'
 where area in ('BAU','MAIN') and warehouse_code <> 'JHB';

-- ---------------------------------------------------------------------
-- 2. POS → warehouse (serves case numbers, SLA and routing)
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_pos_warehouse (
  pos_local_code  text primary key,             -- L-code
  point_of_sale   text,
  concessionaire  text,
  warehouse_code  text references public.coolerco_warehouse_settings(warehouse_code),
  source          text not null default 'pos_file',  -- pos_file | latest_case | manual
  needs_review    boolean not null default false,
  review_note     text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

insert into public.coolerco_pos_warehouse (pos_local_code, point_of_sale, concessionaire, warehouse_code, source, needs_review, review_note)
select p.pos_id, p.pos_name, p.rop,
       coalesce(ws.warehouse_code, wc.warehouse_code),
       case when ws.warehouse_code is not null then 'pos_file' else 'latest_case' end,
       (ws.warehouse_code is null and wc.warehouse_code is null)
         or (ws.warehouse_code is not null and wc.warehouse_code is not null and ws.warehouse_code <> wc.warehouse_code),
       case
         when ws.warehouse_code is null and wc.warehouse_code is null then 'No warehouse in POS file or cases'
         when ws.warehouse_code is not null and wc.warehouse_code is not null and ws.warehouse_code <> wc.warehouse_code
           then 'POS file says ' || ws.warehouse_code || ', latest case says ' || wc.warehouse_code
       end
from public.latest_pos_records p
left join public.coolerco_warehouse_settings ws
  on ws.com_name || ' WH' = p.warehouse
left join lateral (
  select s.warehouse_code
  from public.cases c
  join public.coolerco_warehouse_settings s on s.com_name = c.warehouse_workshop
  where c.pos_local_code = p.pos_id
  order by c.created_on desc nulls last
  limit 1
) wc on true
where p.pos_id is not null
on conflict (pos_local_code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Catalogue = product families (portal shows families only)
-- ---------------------------------------------------------------------
alter table public.coolerco_product_families add column if not exists display_name   text;
alter table public.coolerco_product_families add column if not exists description    text;
alter table public.coolerco_product_families add column if not exists asset_type     text;  -- Cabinet, Vending …
alter table public.coolerco_product_families add column if not exists photo_path     text;  -- path in coolerco-cases bucket (catalogue/…)
alter table public.coolerco_product_families add column if not exists show_in_portal boolean not null default false;
alter table public.coolerco_product_families add column if not exists sort_order     int not null default 100;

-- Demo start: show families of Magnum cabinets in the field (>= 20 assets at POS). Adjust in Setup.
update public.coolerco_product_families f set show_in_portal = true
 where not f.show_in_portal and f.id in (
   select bf.family_id from public.coolerco_product_base_family bf
   join public.assets_live a on a.product_base = bf.product_base
   where a.asset_location = 'Location' and a.asset_type = 'Cabinet'
   group by bf.family_id having count(*) >= 20);

-- ---------------------------------------------------------------------
-- 4. CoolerCo cases (COM-compatible column names) + audit trail
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_case_counters (
  case_code text not null,
  day       date not null,
  last_no   int  not null default 0,
  primary key (case_code, day)
);

create table if not exists public.coolerco_reason_codes (
  code       text primary key,
  status     text not null,     -- the status this reason is used with
  label      text not null,
  active     boolean not null default true,
  sort_order int not null default 100
);
insert into public.coolerco_reason_codes (code, status, label, sort_order) values
  ('PORTAL_REQUEST',  'Waiting for Approval', 'Logged on customer portal', 10),
  ('APPROVED',        'Open',                 'Approved', 10),
  ('REJ_DUPLICATE',   'Rejected',             'Duplicate request', 10),
  ('REJ_NOT_OUR_ASSET','Rejected',            'Asset not managed by CoolerCo', 20),
  ('REJ_MORE_INFO',   'Rejected',             'Not enough information', 30),
  ('REJ_NOT_APPROVED','Rejected',             'Not approved by Magnum / concessionaire', 40)
on conflict (code) do nothing;

create table if not exists public.coolerco_cases (
  case_number                 text primary key,           -- CAS-ddmmyy-GT000001
  case_type                   text not null,              -- COM names: Deliver an Asset, Removal of Asset, Repair at Shopper POS …
  status_reason               text not null,              -- Waiting for Approval, Open, In Progress, In Service, Planned …
  motive                      text,                        -- latest reason code
  originator                  text not null,               -- CoolerCo | Customer | Concessionaire | Magnum
  origin                      text,                        -- Portal | App
  priority                    text,
  warehouse_code              text references public.coolerco_warehouse_settings(warehouse_code),
  warehouse_workshop          text,                        -- 'RTMA Gauteng'
  responsible_ordering_party  text,
  point_of_sale               text,
  pos_local_code              text,
  address                     text,
  latitude                    double precision,
  longitude                   double precision,
  case_contact_name           text,
  case_contact_number         text,
  case_mobile_number          text,
  asset_type                  text,
  mapped_asset                text,
  asset_removed               text,
  asset_delivered             text,
  asset_repaired              text,
  asset_condition             text,
  requested_family_id         uuid references public.coolerco_product_families(id),
  requested_product_base      text,
  requested_asset_condition   text,
  requested_brand_hierarchy   text,
  description                 text,
  photo_paths                 text[],
  begin_date                  timestamptz,
  end_date                    timestamptz,
  service_closure_date        timestamptz,
  sla_days                    int,
  portal_link_id              uuid,
  created_by_user_id          uuid,
  created_by_label            text,
  approved_by                 text,
  approved_at                 timestamptz,
  created_on                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  tenant_id                   text not null default 'tenant_coolerco'
);
create index if not exists idx_coolerco_cases_status   on public.coolerco_cases (status_reason);
create index if not exists idx_coolerco_cases_pos      on public.coolerco_cases (pos_local_code);
create index if not exists idx_coolerco_cases_created  on public.coolerco_cases (created_on desc);

create table if not exists public.coolerco_case_events (
  id            uuid primary key default gen_random_uuid(),
  case_number   text not null references public.coolerco_cases(case_number) on delete cascade,
  event_type    text not null default 'status',   -- status | note | edit
  from_status   text,
  to_status     text,
  reason_code   text,
  notes         text,
  actor_type    text not null,                    -- user | customer | system
  actor_user_id uuid,
  actor_label   text,
  latitude      double precision,
  longitude     double precision,
  created_at    timestamptz not null default now()
);
create index if not exists idx_coolerco_case_events_case on public.coolerco_case_events (case_number, created_at);

-- Next case number: CAS-ddmmyy-<case code><6 digits>, restarts daily per warehouse.
-- Done on the server with a row lock so two people can never get the same number.
create or replace function public.coolerco_next_case_number(p_warehouse_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_day  date := (now() at time zone 'Africa/Johannesburg')::date;
  v_no   int;
begin
  select case_code into v_code from public.coolerco_warehouse_settings where warehouse_code = p_warehouse_code;
  if v_code is null then raise exception 'Unknown warehouse %', p_warehouse_code; end if;
  insert into public.coolerco_case_counters (case_code, day, last_no) values (v_code, v_day, 1)
  on conflict (case_code, day) do update set last_no = public.coolerco_case_counters.last_no + 1
  returning last_no into v_no;
  return 'CAS-' || to_char(v_day, 'DDMMYY') || '-' || v_code || lpad(v_no::text, 6, '0');
end $$;

-- Staff status change (approve / reject / any step) — writes the case + audit row together
create or replace function public.coolerco_case_set_status(
  p_case_number text, p_status text, p_reason_code text default null, p_notes text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old  text;
  v_user uuid := auth.uid();
  v_lbl  text := coalesce((auth.jwt() ->> 'email'), 'user');
begin
  select status_reason into v_old from public.coolerco_cases where case_number = p_case_number for update;
  if v_old is null then raise exception 'Case % not found', p_case_number; end if;
  update public.coolerco_cases
     set status_reason = p_status,
         motive        = coalesce(p_reason_code, motive),
         approved_by   = case when v_old = 'Waiting for Approval' and p_status = 'Open' then v_lbl else approved_by end,
         approved_at   = case when v_old = 'Waiting for Approval' and p_status = 'Open' then now() else approved_at end,
         begin_date    = case when p_status = 'Open' and begin_date is null then now() else begin_date end,
         end_date      = case when p_status = 'Open' and end_date is null
                              then now() + make_interval(days => coalesce(sla_days, 2)) else end_date end,
         updated_at    = now()
   where case_number = p_case_number;
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_user_id, actor_label)
  values (p_case_number, 'status', v_old, p_status, p_reason_code, p_notes, 'user', v_user, v_lbl);
end $$;

-- ---------------------------------------------------------------------
-- 5. Customer portal links (one per POS) + contact change history
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_portal_links (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique default replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), '=', ''),
  pos_local_code  text not null unique,
  point_of_sale   text,
  contact_name    text,
  contact_number  text,
  mobile_number   text,
  active          boolean not null default true,
  otp_required    boolean not null default false,   -- WhatsApp one-time code, switched on later
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create table if not exists public.coolerco_portal_link_history (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references public.coolerco_portal_links(id) on delete cascade,
  field      text not null,
  old_value  text,
  new_value  text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create or replace function public.coolerco_portal_link_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.contact_name   is distinct from old.contact_name   then insert into public.coolerco_portal_link_history (link_id, field, old_value, new_value, changed_by) values (new.id, 'contact_name',   old.contact_name,   new.contact_name,   new.updated_by); end if;
  if new.contact_number is distinct from old.contact_number then insert into public.coolerco_portal_link_history (link_id, field, old_value, new_value, changed_by) values (new.id, 'contact_number', old.contact_number, new.contact_number, new.updated_by); end if;
  if new.mobile_number  is distinct from old.mobile_number  then insert into public.coolerco_portal_link_history (link_id, field, old_value, new_value, changed_by) values (new.id, 'mobile_number',  old.mobile_number,  new.mobile_number,  new.updated_by); end if;
  if new.active         is distinct from old.active         then insert into public.coolerco_portal_link_history (link_id, field, old_value, new_value, changed_by) values (new.id, 'active',         old.active::text,   new.active::text,   new.updated_by); end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger trg_coolerco_portal_link_audit before update on public.coolerco_portal_links
for each row execute function public.coolerco_portal_link_audit();

-- Create (or return) the link for a POS, pre-filled with the latest COM case contact
create or replace function public.coolerco_portal_link_for_pos(p_pos_local_code text)
returns public.coolerco_portal_links
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.coolerco_portal_links;
begin
  select * into r from public.coolerco_portal_links where pos_local_code = p_pos_local_code;
  if found then return r; end if;
  insert into public.coolerco_portal_links (pos_local_code, point_of_sale, contact_name, contact_number, mobile_number, created_by)
  select p_pos_local_code,
         coalesce((select point_of_sale from public.coolerco_pos_warehouse where pos_local_code = p_pos_local_code),
                  (select point_of_sale from public.cases where pos_local_code = p_pos_local_code order by created_on desc limit 1)),
         c.case_contact_name, c.case_contact_number, c.case_mobile_number,
         coalesce(auth.jwt() ->> 'email', 'user')
  from (select 1) d
  left join lateral (
    select case_contact_name, case_contact_number, case_mobile_number
    from public.cases
    where pos_local_code = p_pos_local_code
      and coalesce(case_contact_name, case_contact_number, case_mobile_number) is not null
    order by created_on desc limit 1
  ) c on true
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 6. Portal functions (the ONLY things the public portal may call)
--    security definer: they check the link token and return only that store's data
-- ---------------------------------------------------------------------
create or replace function public.coolerco_portal_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l    public.coolerco_portal_links;
  pw   public.coolerco_pos_warehouse;
  mode text;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  update public.coolerco_portal_links set last_used_at = now() where id = l.id;
  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;
  select value #>> '{}' into mode from public.coolerco_settings where key = 'portal_catalogue_mode';

  return jsonb_build_object(
    'pos', jsonb_build_object('code', l.pos_local_code, 'name', coalesce(l.point_of_sale, pw.point_of_sale),
                              'concessionaire', pw.concessionaire, 'warehouse', pw.warehouse_code),
    'contact', jsonb_build_object('name', l.contact_name, 'phone', coalesce(l.mobile_number, l.contact_number)),
    'otp_required', l.otp_required,
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'asset', a.name, 'barcode', a.bar_code, 'local_code', a.local_code,
               'product', a.product_base, 'family', f.display_name, 'family_name', f.name, 'photo', f.photo_path,
               'type', a.asset_type, 'condition', a.condition) order by a.product_base)
      from public.assets_live a
      left join public.coolerco_product_base_family bf on bf.product_base = a.product_base
      left join public.coolerco_product_families f on f.id = bf.family_id
      where a.assign_account_local_code = l.pos_local_code and a.asset_location = 'Location'), '[]'::jsonb),
    'catalogue', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(f.display_name, f.name), 'description', f.description,
                                          'type', f.asset_type, 'photo', f.photo_path) order by f.sort_order, f.name)
      from public.coolerco_product_families f
      where f.active and f.show_in_portal
        and (mode is distinct from 'available' or exists (
              select 1 from public.coolerco_product_base_family bf
              join public.assets_live a on a.product_base = bf.product_base
              where bf.family_id = f.id and a.asset_status = 'Ready to Work'
                and a.asset_location = 'Warehouse'
                and a.assign_account = (select com_name || ' WH' from public.coolerco_warehouse_settings where warehouse_code = pw.warehouse_code)))
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('case_number', c.case_number, 'case_type', c.case_type, 'status', c.status_reason,
                                          'created_on', c.created_on, 'asset', coalesce(c.asset_repaired, c.asset_removed, c.mapped_asset))
                       order by c.created_on desc)
      from (select * from public.coolerco_cases where pos_local_code = l.pos_local_code order by created_on desc limit 20) c), '[]'::jsonb)
  );
end $$;

create or replace function public.coolerco_portal_submit(p_token text, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l      public.coolerco_portal_links;
  pw     public.coolerco_pos_warehouse;
  ws     public.coolerco_warehouse_settings;
  kind   text := p_request ->> 'kind';      -- repair | collection | new
  v_type text;
  v_asset public.assets_live;
  v_fam  uuid;
  v_no   text;
  v_lim  int;
  v_today int;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;

  select (value #>> '{}')::int into v_lim from public.coolerco_settings where key = 'portal_daily_request_limit';
  select count(*) into v_today from public.coolerco_cases
   where portal_link_id = l.id and created_on > now() - interval '1 day';
  if v_today >= coalesce(v_lim, 10) then return jsonb_build_object('error', 'daily_limit'); end if;

  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;
  if pw.warehouse_code is null then return jsonb_build_object('error', 'no_warehouse'); end if;
  select * into ws from public.coolerco_warehouse_settings where warehouse_code = pw.warehouse_code;

  v_type := case kind when 'repair' then 'Repair at Shopper POS'
                      when 'collection' then 'Removal of Asset'
                      when 'new' then 'Deliver an Asset' end;
  if v_type is null then return jsonb_build_object('error', 'bad_request_type'); end if;

  if kind in ('repair', 'collection') then
    select * into v_asset from public.assets_live
     where name = p_request ->> 'asset' and assign_account_local_code = l.pos_local_code and asset_location = 'Location';
    if not found then return jsonb_build_object('error', 'asset_not_at_store'); end if;
  else
    v_fam := nullif(p_request ->> 'family_id', '')::uuid;
    if v_fam is null or not exists (select 1 from public.coolerco_product_families where id = v_fam and active and show_in_portal) then
      return jsonb_build_object('error', 'bad_family');
    end if;
  end if;

  v_no := public.coolerco_next_case_number(pw.warehouse_code);

  insert into public.coolerco_cases (
    case_number, case_type, status_reason, motive, originator, origin, priority,
    warehouse_code, warehouse_workshop, responsible_ordering_party, point_of_sale, pos_local_code,
    case_contact_name, case_contact_number, case_mobile_number,
    asset_type, mapped_asset, asset_removed, asset_repaired, asset_condition,
    requested_family_id, description, photo_paths, sla_days, portal_link_id, created_by_label)
  values (
    v_no, v_type, 'Waiting for Approval', 'PORTAL_REQUEST', 'Customer', 'Portal', nullif(p_request ->> 'priority', ''),
    pw.warehouse_code, ws.com_name, pw.concessionaire, coalesce(l.point_of_sale, pw.point_of_sale), l.pos_local_code,
    coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name),
    coalesce(nullif(p_request ->> 'contact_phone', ''), l.contact_number),
    l.mobile_number,
    v_asset.asset_type, v_asset.name,
    case when kind = 'collection' then v_asset.name end,
    case when kind = 'repair' then v_asset.name end,
    v_asset.condition,
    v_fam, left(p_request ->> 'description', 2000),
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p_request -> 'photos', '[]'::jsonb)) x
      where x like 'portal/' || p_token || '/%'),
    ws.default_sla_days, l.id,
    'Portal: ' || coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name, 'customer'));

  insert into public.coolerco_case_events (case_number, from_status, to_status, reason_code, notes, actor_type, actor_label)
  values (v_no, null, 'Waiting for Approval', 'PORTAL_REQUEST', left(p_request ->> 'description', 500), 'customer',
          coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name, 'customer'));

  return jsonb_build_object('case_number', v_no);
end $$;

-- Is this a valid, active portal link? (used by the photo bucket policy)
create or replace function public.coolerco_portal_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.coolerco_portal_links where token = p_token and active) $$;

-- ---------------------------------------------------------------------
-- 7. Photo bucket (private). Portal may upload only into portal/<its token>/…
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coolerco-cases', 'coolerco-cases', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'coolerco_cases_portal_upload') then
    create policy coolerco_cases_portal_upload on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'coolerco-cases' and (storage.foldername(name))[1] = 'portal'
                  and public.coolerco_portal_token_ok((storage.foldername(name))[2]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'coolerco_cases_staff_all') then
    create policy coolerco_cases_staff_all on storage.objects for all to authenticated
      using (bucket_id = 'coolerco-cases') with check (bucket_id = 'coolerco-cases');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'coolerco_cases_catalogue_read') then
    create policy coolerco_cases_catalogue_read on storage.objects for select to anon
      using (bucket_id = 'coolerco-cases' and (storage.foldername(name))[1] = 'catalogue');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Access: staff (signed in) read/write; the public portal gets ONLY the functions
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['coolerco_settings','coolerco_warehouse_settings','coolerco_pos_warehouse','coolerco_case_counters',
                           'coolerco_reason_codes','coolerco_cases','coolerco_case_events','coolerco_portal_links','coolerco_portal_link_history'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_staff') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_staff', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on function public.coolerco_next_case_number(text) from public, anon;
grant execute on function public.coolerco_next_case_number(text) to authenticated;
revoke all on function public.coolerco_case_set_status(text,text,text,text) from public, anon;
grant execute on function public.coolerco_case_set_status(text,text,text,text) to authenticated;
revoke all on function public.coolerco_portal_link_for_pos(text) from public, anon;
grant execute on function public.coolerco_portal_link_for_pos(text) to authenticated;
revoke all on function public.coolerco_portal_context(text) from public;
revoke all on function public.coolerco_portal_submit(text, jsonb) from public;
revoke all on function public.coolerco_portal_token_ok(text) from public;
grant execute on function public.coolerco_portal_context(text) to anon, authenticated;
grant execute on function public.coolerco_portal_submit(text, jsonb) to anon, authenticated;
grant execute on function public.coolerco_portal_token_ok(text) to anon, authenticated;
