-- CoolerCo-Ops · 016 · Clients, roles + scope, symptoms + priority, notifications, contact updates, feedback
-- DRAFT for Wanda's review — NOT applied anywhere. Test on the UAT database first.
--
-- Rules followed:
--   · Additive only. Every new object is prefixed coolerco_.
--   · Existing objects of other apps (routing_*, magnum_*, inspector_*, user_warehouse_mapping,
--     client_dashboard_access, st_*, cases, assets_live …) are NOT touched.
--   · The only changes to existing objects are NEW COLUMNS on our own coolerco_ tables (section 9)
--     and ONE trigger on coolerco_cases (section 6) that can never block a save.
--   · This script does NOT switch on role checks for the existing pages. Today's behaviour stays
--     (any signed-in user). Enforcement comes in a later script, once users have been given roles.
--   · auth.users is only read (user ids), never changed.
-- Rollback: coolerco_016_rollback.sql

-- ---------------------------------------------------------------------
-- 1. Clients (Magnum, Tiger Brands). Called "client", not "tenant": tenant_id already
--    exists on some tables with another meaning (tenant_coolerco).
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_clients (
  code                   text primary key,                      -- MAGNUM, TIGER
  name                   text not null,
  system_of_record       text not null default 'coolerco' check (system_of_record in ('coolerco', 'external')),
  external_system        text,                                  -- COM today; Salesforce later
  can_close_cases        boolean not null default true,         -- false = cases are closed in the external system
  repair_needs_approval  boolean not null default false,        -- option kept open, off by default
  share_feedback         boolean not null default false,        -- supplier switches this on to show survey scores to the client
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text
);

insert into public.coolerco_clients (code, name, system_of_record, external_system, can_close_cases) values
  ('MAGNUM', 'Magnum Ice Cream', 'external', 'COM',  false),
  ('TIGER',  'Tiger Brands',     'coolerco', null,   true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Roles (what a user may do) — for signed-in users.
--    Customers and concessionaires / representatives keep their personal links (no login).
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_roles (
  code           text primary key,
  label          text not null,
  description    text,
  can_log        boolean not null default false,   -- log cases
  can_update     boolean not null default false,   -- post updates on a case (audited)
  can_approve    boolean not null default false,
  can_edit_data  boolean not null default false,   -- uploads, edit records
  can_delete     boolean not null default false,
  own_only       boolean not null default false,   -- sees only own cases / own company
  sort_order     int not null default 100
);

insert into public.coolerco_roles (code, label, description, can_log, can_update, can_approve, can_edit_data, can_delete, own_only, sort_order) values
  ('system_admin',     'System administrator', 'Everything',                                             true,  true,  true,  true,  true,  false, 10),
  ('administrator',    'Administrator',        'Adds data: uploads and edits records',                   true,  true,  true,  true,  false, false, 20),
  ('manager',          'Manager',              'Same as supplier, plus approvals',                       true,  true,  true,  false, false, false, 30),
  ('supplier',         'Supplier',             'Sees all, updates cases (audited), cannot delete',       true,  true,  false, false, false, false, 40),
  ('client',           'Client',               'Magnum / Tiger users: log, view, reports, approve D/R/R', true,  false, true,  false, false, false, 50),
  ('viewer',           'Viewer',               'Executives: sees reports, changes nothing',              false, false, false, false, false, false, 60),
  ('contractor_admin', 'Contractor admin',     'Own company''s cases, own technicians, tripsheets',      false, true,  false, false, false, true,  70),
  ('technician',       'Technician',           'Own cases only: update, job card, own stats',            false, true,  false, false, false, true,  80),
  ('driver',           'Driver',               'Own cases only: update, job card, own stats',            false, true,  false, false, false, true,  90)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Contractors (managed even when they do not use the app)
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_contractors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  contact_phone text,
  contact_email text,
  warehouse_code text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    text
);

create table if not exists public.coolerco_contractor_technicians (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.coolerco_contractors (id),
  name          text not null,
  phone         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists idx_coolerco_contr_tech_contractor on public.coolerco_contractor_technicians (contractor_id);

-- ---------------------------------------------------------------------
-- 4. User access = role + scope (which client / warehouse / contractor).
--    Empty scope column = all. One user can hold several rows.
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_user_access (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,                               -- auth.users id (SmartHub login); read only, no FK on purpose
  role_code         text not null references public.coolerco_roles (code),
  client_code       text references public.coolerco_clients (code),          -- null = all clients
  warehouse_code    text,                                                    -- null = all warehouses (JHB, DBN, CPT …)
  contractor_id     uuid references public.coolerco_contractors (id),        -- contractor_admin
  resource_username text,                                                    -- driver / technician: routing-app name → "own cases"
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  updated_by        text
);
create index if not exists idx_coolerco_user_access_user on public.coolerco_user_access (user_id) where active;
create unique index if not exists uq_coolerco_user_access on public.coolerco_user_access
  (user_id, role_code, coalesce(client_code, ''), coalesce(warehouse_code, ''), coalesce(contractor_id::text, ''));

-- Does the signed-in user hold one of these roles? (used by policies and functions)
create or replace function public.coolerco_has_role(p_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.coolerco_user_access a
                  where a.user_id = auth.uid() and a.active and a.role_code = any (p_roles));
$$;

-- The signed-in user's roles + scope, for the app (menu, home screen)
create or replace function public.coolerco_my_access()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'role', a.role_code, 'label', r.label, 'client', a.client_code, 'warehouse', a.warehouse_code,
           'contractor_id', a.contractor_id, 'resource_username', a.resource_username,
           'can_log', r.can_log, 'can_update', r.can_update, 'can_approve', r.can_approve,
           'can_edit_data', r.can_edit_data, 'can_delete', r.can_delete, 'own_only', r.own_only)
         order by r.sort_order), '[]'::jsonb)
    from public.coolerco_user_access a join public.coolerco_roles r on r.code = a.role_code
   where a.user_id = auth.uid() and a.active;
$$;

-- ---------------------------------------------------------------------
-- 5. Symptoms + product impact → priority (customer never picks High / Medium / Low)
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_symptoms (
  code             text primary key,
  label            text not null,
  default_priority text not null check (default_priority in ('High', 'Medium', 'Low')),
  ask_product      boolean not null default false,   -- ask "what is happening to your product?"
  show_in_portal   boolean not null default true,
  active           boolean not null default true,
  sort_order       int not null default 100
);

insert into public.coolerco_symptoms (code, label, default_priority, ask_product, sort_order) values
  ('NOT_COOLING',   'Not cooling / warm inside',      'High',   true,  10),
  ('NOT_SWITCHING', 'Not switching on',               'High',   true,  20),
  ('ICE_BUILDUP',   'Ice build-up',                   'Medium', true,  30),
  ('NOISY',         'Noisy',                          'Medium', true,  40),
  ('LEAKING',       'Leaking water',                  'Medium', true,  50),
  ('LIGHT',         'Light not working',              'Low',    false, 60),
  ('DOOR_SEAL',     'Door, lid or seal damaged',      'Low',    false, 70),
  ('BRANDING',      'Branding / decal damaged',       'Low',    false, 80),
  ('OTHER',         'Something else',                 'Medium', true,  90)
on conflict (code) do nothing;

create table if not exists public.coolerco_product_impacts (
  code       text primary key,
  label      text not null,
  priority   text check (priority in ('High', 'Medium', 'Low')),  -- null = keep the symptom's priority
  active     boolean not null default true,
  sort_order int not null default 100
);

insert into public.coolerco_product_impacts (code, label, priority, sort_order) values
  ('SPOILT',       'Product already spoilt / melted',        'High',   10),
  ('WILL_SPOIL',   'Product will spoil soon, no backup',     'High',   20),
  ('MOVED_BACKUP', 'Product moved to a backup freezer',      'Medium', 30),
  ('NO_PRODUCT',   'No product affected',                    null,     40)
on conflict (code) do nothing;

create or replace function public.coolerco_priority_for(p_symptom text, p_impact text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select i.priority from public.coolerco_product_impacts i where i.code = p_impact and i.active),
    (select s.default_priority from public.coolerco_symptoms s where s.code = p_symptom and s.active),
    'Medium');
$$;

-- ---------------------------------------------------------------------
-- 6. Notifications: rules (who hears about what, how) + outbox (queue).
--    The database only queues. Sending (email via Resend, WhatsApp later, phone push)
--    is done by a server function that reads the queue — built separately.
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_notification_rules (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,      -- case_logged, case_approved, case_rejected, case_closed, feedback_low, feedback_not_working, contact_update
  recipient_type text not null check (recipient_type in ('customer', 'concessionaire', 'supervisor', 'client', 'supplier')),
  channel        text not null check (channel in ('inapp', 'email', 'whatsapp', 'push')),
  client_code    text references public.coolerco_clients (code),   -- null = all clients
  active         boolean not null default true
);
-- one rule per event + recipient + channel (+ client); safe to re-run the script
create unique index if not exists uq_coolerco_notif_rules on public.coolerco_notification_rules
  (event_type, recipient_type, channel, coalesce(client_code, ''));

insert into public.coolerco_notification_rules (event_type, recipient_type, channel) values
  ('case_logged',          'concessionaire', 'email'),
  ('case_logged',          'concessionaire', 'inapp'),
  ('case_logged',          'supervisor',     'inapp'),
  ('case_logged',          'supervisor',     'push'),
  ('case_approved',        'customer',       'email'),
  ('case_approved',        'customer',       'whatsapp'),
  ('case_rejected',        'customer',       'email'),
  ('case_rejected',        'customer',       'whatsapp'),
  ('case_closed',          'customer',       'email'),
  ('case_closed',          'customer',       'whatsapp'),
  ('feedback_low',         'supervisor',     'inapp'),
  ('feedback_not_working', 'supervisor',     'inapp'),
  ('contact_update',       'supervisor',     'inapp')
on conflict do nothing;

create table if not exists public.coolerco_notifications (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,
  case_number    text,
  client_code    text,
  warehouse_code text,
  pos_local_code text,
  recipient_type text not null,
  channel        text not null,
  to_address     text,                      -- email / phone; null for in-app
  title          text,
  payload        jsonb not null default '{}'::jsonb,
  priority       text,
  status         text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped', 'read')),
  attempts       int not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  read_at        timestamptz,
  read_by        uuid
);
create index if not exists idx_coolerco_notif_queue on public.coolerco_notifications (status, channel, created_at);
create index if not exists idx_coolerco_notif_inapp on public.coolerco_notifications (warehouse_code, created_at desc) where channel = 'inapp';

-- Queue one notification per matching rule
create or replace function public.coolerco_notify(p_event text, p_case text, p_client text, p_warehouse text,
                                                  p_pos text, p_title text, p_payload jsonb, p_priority text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r    record;
  l    public.coolerco_portal_links;
  v_to text;
  n    int := 0;
begin
  select * into l from public.coolerco_portal_links where pos_local_code = p_pos and active limit 1;
  for r in select * from public.coolerco_notification_rules
            where event_type = p_event and active and (client_code is null or client_code = p_client)
  loop
    v_to := null;
    if r.recipient_type = 'customer' then
      -- customers only get what they opted in to and have an address for
      if r.channel = 'email' then
        if not coalesce(l.notify_email, false) or l.email is null then continue; end if;
        v_to := l.email;
      elsif r.channel = 'whatsapp' then
        if not coalesce(l.notify_whatsapp, true) or coalesce(l.mobile_number, l.contact_number) is null then continue; end if;
        v_to := coalesce(l.mobile_number, l.contact_number);
      else
        continue;
      end if;
    end if;
    insert into public.coolerco_notifications (event_type, case_number, client_code, warehouse_code, pos_local_code,
                                               recipient_type, channel, to_address, title, payload, priority)
    values (p_event, p_case, p_client, p_warehouse, p_pos, r.recipient_type, r.channel, v_to, p_title, coalesce(p_payload, '{}'::jsonb), p_priority);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Trigger on our own coolerco_cases: new case / status change → queue notifications.
-- Wrapped so a notification problem can NEVER stop a case from being saved.
create or replace function public.coolerco_cases_notify_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event text;
begin
  begin
    if tg_op = 'INSERT' then
      v_event := 'case_logged';
    elsif new.status_reason is distinct from old.status_reason then
      v_event := case
        when old.status_reason = 'Waiting for Approval' and new.status_reason = 'Open' then 'case_approved'
        when new.status_reason = 'Rejected' then 'case_rejected'
        when new.status_reason in ('Completed', 'Closed', 'Solved') then 'case_closed'
        else null end;
    end if;
    if v_event is not null then
      perform public.coolerco_notify(v_event, new.case_number, new.client_code, new.warehouse_code, new.pos_local_code,
        new.case_type || ' · ' || coalesce(new.point_of_sale, new.pos_local_code),
        jsonb_build_object('case_number', new.case_number, 'case_type', new.case_type, 'status', new.status_reason,
                           'point_of_sale', new.point_of_sale, 'priority', new.priority, 'symptom', new.symptom_code,
                           'end_date', new.end_date),
        new.priority);
    end if;
  exception when others then
    null; -- never block the case
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 7. Customer contact updates: customer proposes, supervisor approves, then the store's
--    portal record is updated (the existing history trigger logs the change).
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_contact_update_requests (
  id               uuid primary key default gen_random_uuid(),
  portal_link_id   uuid not null references public.coolerco_portal_links (id),
  pos_local_code   text not null,
  current_values   jsonb not null default '{}'::jsonb,
  proposed_values  jsonb not null,            -- contact_name, contact_number, mobile_number, email, trading_hours, delivery_notes, latitude, longitude, point_of_sale, address
  identity_change  boolean not null default false,   -- store name / address changed → look closer (possible new owner)
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  decided_by       text,
  decided_at       timestamptz,
  decision_note    text,
  capture_in_source boolean not null default false,  -- external client (COM): someone must capture it there
  captured_at      timestamptz,
  captured_by      text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_coolerco_contact_upd_status on public.coolerco_contact_update_requests (status, created_at desc);

-- Public (link token): propose a change. One pending request per store at a time.
create or replace function public.coolerco_portal_propose_contact(p_token text, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l  public.coolerco_portal_links;
  pw public.coolerco_pos_warehouse;
  v  jsonb;
  v_id uuid;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  if exists (select 1 from public.coolerco_contact_update_requests where portal_link_id = l.id and status = 'Pending') then
    return jsonb_build_object('error', 'already_pending');
  end if;
  -- only the fields a customer may propose; everything else is ignored
  select coalesce(jsonb_object_agg(key, left(value #>> '{}', 300)), '{}'::jsonb) into v
    from jsonb_each(coalesce(p_values, '{}'::jsonb))
   where key in ('contact_name', 'contact_number', 'mobile_number', 'email', 'trading_hours', 'delivery_notes',
                 'latitude', 'longitude', 'point_of_sale', 'address', 'notify_email', 'notify_whatsapp');
  if v = '{}'::jsonb then return jsonb_build_object('error', 'nothing_to_change'); end if;
  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;
  insert into public.coolerco_contact_update_requests (portal_link_id, pos_local_code, current_values, proposed_values, identity_change)
  values (l.id, l.pos_local_code,
          jsonb_build_object('contact_name', l.contact_name, 'contact_number', l.contact_number, 'mobile_number', l.mobile_number,
                             'email', l.email, 'point_of_sale', l.point_of_sale),
          v, (v ? 'point_of_sale') or (v ? 'address'))
  returning id into v_id;
  perform public.coolerco_notify('contact_update', null, null, pw.warehouse_code, l.pos_local_code,
                                 'Contact update · ' || coalesce(l.point_of_sale, l.pos_local_code), jsonb_build_object('request_id', v_id));
  return jsonb_build_object('ok', true, 'request_id', v_id);
end $$;

-- Staff: approve / reject. Approve copies the contact fields onto the store's portal link.
create or replace function public.coolerco_contact_update_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.coolerco_contact_update_requests;
  v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_external boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into q from public.coolerco_contact_update_requests where id = p_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if q.status <> 'Pending' then return jsonb_build_object('error', 'already_decided'); end if;
  if p_approve then
    update public.coolerco_portal_links set
      contact_name    = coalesce(q.proposed_values ->> 'contact_name', contact_name),
      contact_number  = coalesce(q.proposed_values ->> 'contact_number', contact_number),
      mobile_number   = coalesce(q.proposed_values ->> 'mobile_number', mobile_number),
      email           = coalesce(q.proposed_values ->> 'email', email),
      trading_hours   = coalesce(q.proposed_values ->> 'trading_hours', trading_hours),
      delivery_notes  = coalesce(q.proposed_values ->> 'delivery_notes', delivery_notes),
      notify_email    = coalesce((q.proposed_values ->> 'notify_email')::boolean, notify_email),
      notify_whatsapp = coalesce((q.proposed_values ->> 'notify_whatsapp')::boolean, notify_whatsapp),
      updated_at = now(), updated_by = v_by
    where id = q.portal_link_id;
    -- store name / address / GPS are NOT applied automatically: they stay on the request for a person to handle
  end if;
  select coalesce(c.system_of_record = 'external', true) into v_external
    from public.coolerco_portal_links l left join public.coolerco_clients c on c.code = l.client_code
   where l.id = q.portal_link_id;
  update public.coolerco_contact_update_requests
     set status = case when p_approve then 'Approved' else 'Rejected' end,
         decided_by = v_by, decided_at = now(), decision_note = p_note,
         capture_in_source = p_approve and coalesce(v_external, true)
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. Feedback survey (sent with the closure message; one-time link, 7 days)
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_case_feedback (
  id                 uuid primary key default gen_random_uuid(),
  token              text not null unique default replace(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), '=', ''),
  case_number        text not null,
  case_source        text not null default 'coolerco',   -- coolerco | com
  client_code        text,
  warehouse_code     text,
  pos_local_code     text,
  point_of_sale      text,
  case_type          text,
  resource_username  text,          -- driver / technician (routing name)
  contractor_id      uuid,
  rating             int check (rating between 1 and 5),
  working_ok         boolean,       -- is the freezer working properly now?
  on_time_professional boolean,     -- was the technician / driver on time and professional?
  comment            text,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '7 days',
  submitted_at       timestamptz,
  unique (case_number, case_source)
);
create index if not exists idx_coolerco_feedback_wh on public.coolerco_case_feedback (warehouse_code, submitted_at desc);

-- Public: what the survey page shows (nothing private)
create or replace function public.coolerco_feedback_context(p_token text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select case
      when f.submitted_at is not null then jsonb_build_object('error', 'already_done')
      when f.expires_at < now() then jsonb_build_object('error', 'expired')
      else jsonb_build_object('case_number', f.case_number, 'case_type', f.case_type, 'point_of_sale', f.point_of_sale) end
    from public.coolerco_case_feedback f where f.token = p_token), jsonb_build_object('error', 'invalid_link'));
$$;

-- Public: submit once
create or replace function public.coolerco_feedback_submit(p_token text, p_rating int, p_working_ok boolean,
                                                           p_on_time boolean, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f public.coolerco_case_feedback;
begin
  if p_rating is null or p_rating not between 1 and 5 then return jsonb_build_object('error', 'rating'); end if;
  update public.coolerco_case_feedback
     set rating = p_rating, working_ok = p_working_ok, on_time_professional = p_on_time,
         comment = nullif(left(coalesce(p_comment, ''), 1000), ''), submitted_at = now()
   where token = p_token and submitted_at is null and expires_at >= now()
  returning * into f;
  if not found then return jsonb_build_object('error', 'invalid_or_used'); end if;
  if f.working_ok is false then
    perform public.coolerco_notify('feedback_not_working', f.case_number, f.client_code, f.warehouse_code, f.pos_local_code,
      'Customer says still not working · ' || coalesce(f.point_of_sale, f.pos_local_code),
      jsonb_build_object('case_number', f.case_number, 'rating', f.rating, 'comment', f.comment), 'High');
  elsif f.rating <= 2 then
    perform public.coolerco_notify('feedback_low', f.case_number, f.client_code, f.warehouse_code, f.pos_local_code,
      'Low rating (' || f.rating || '★) · ' || coalesce(f.point_of_sale, f.pos_local_code),
      jsonb_build_object('case_number', f.case_number, 'rating', f.rating, 'comment', f.comment));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 9. New columns on our own coolerco_ tables (all nullable / defaulted → existing rows and code unaffected)
-- ---------------------------------------------------------------------
alter table public.coolerco_cases
  add column if not exists client_code      text,
  add column if not exists symptom_code     text,
  add column if not exists product_impact   text,
  add column if not exists priority_source  text,          -- auto | override
  add column if not exists priority_set_by  text,
  add column if not exists priority_set_at  timestamptz;

alter table public.coolerco_portal_links
  add column if not exists client_code      text,
  add column if not exists email            text,
  add column if not exists notify_email     boolean not null default false,
  add column if not exists notify_whatsapp  boolean not null default true,
  add column if not exists trading_hours    text,
  add column if not exists delivery_notes   text;

alter table public.coolerco_concessionaires
  add column if not exists client_code      text,
  add column if not exists kind             text not null default 'concessionaire';   -- concessionaire | representative

-- Everything that exists today belongs to Magnum
update public.coolerco_cases           set client_code = 'MAGNUM' where client_code is null;
update public.coolerco_portal_links    set client_code = 'MAGNUM' where client_code is null;
update public.coolerco_concessionaires set client_code = 'MAGNUM' where client_code is null;

-- One open CoolerCo case per asset — enforced only where CoolerCo is the master (Tiger).
-- For Magnum the app can only warn: COM is the master and is never written to.
create or replace function public.coolerco_asset_has_open_case(p_asset text, p_except_case text default null)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select c.case_number from public.coolerco_cases c
   where p_asset is not null and p_asset in (c.mapped_asset, c.asset_repaired, c.asset_removed, c.asset_delivered)
     and c.status_reason not in ('Completed', 'Closed', 'Solved', 'Cancelled', 'Canceled', 'Rejected', 'Linked to COM')
     and c.case_number is distinct from p_except_case
   order by c.created_on limit 1;
$$;

drop trigger if exists coolerco_cases_notify on public.coolerco_cases;
create trigger coolerco_cases_notify after insert or update of status_reason on public.coolerco_cases
  for each row execute function public.coolerco_cases_notify_trg();

-- ---------------------------------------------------------------------
-- 10. Lock-down of the NEW tables only
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['coolerco_clients', 'coolerco_roles', 'coolerco_contractors', 'coolerco_contractor_technicians',
                           'coolerco_user_access', 'coolerco_symptoms', 'coolerco_product_impacts',
                           'coolerco_notification_rules', 'coolerco_notifications', 'coolerco_contact_update_requests',
                           'coolerco_case_feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- Reference lists: every signed-in user reads; only administrators change
  foreach t in array array['coolerco_clients', 'coolerco_roles', 'coolerco_symptoms', 'coolerco_product_impacts',
                           'coolerco_notification_rules', 'coolerco_contractors', 'coolerco_contractor_technicians'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin') then
      execute format('create policy %I on public.%I for all to authenticated using (public.coolerco_has_role(array[''system_admin'', ''administrator''])) with check (public.coolerco_has_role(array[''system_admin'', ''administrator'']))', t || '_admin', t);
    end if;
  end loop;
end $$;

-- User access: a user reads their own rows; only the system administrator gives or changes roles
grant select, insert, update, delete on public.coolerco_user_access to authenticated;
drop policy if exists coolerco_user_access_own on public.coolerco_user_access;
create policy coolerco_user_access_own on public.coolerco_user_access for select to authenticated
  using (user_id = auth.uid() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager']));
drop policy if exists coolerco_user_access_admin on public.coolerco_user_access;
create policy coolerco_user_access_admin on public.coolerco_user_access for all to authenticated
  using (public.coolerco_has_role(array['system_admin'])) with check (public.coolerco_has_role(array['system_admin']));

-- Notifications: staff read and mark as read; rows are created only by the functions above
grant select, update on public.coolerco_notifications to authenticated;
drop policy if exists coolerco_notifications_staff on public.coolerco_notifications;
create policy coolerco_notifications_staff on public.coolerco_notifications for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));
drop policy if exists coolerco_notifications_read on public.coolerco_notifications;
create policy coolerco_notifications_read on public.coolerco_notifications for update to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']))
  with check (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));

-- Contact updates: supplier side reads; decisions go through coolerco_contact_update_decide
grant select on public.coolerco_contact_update_requests to authenticated;
drop policy if exists coolerco_contact_upd_staff on public.coolerco_contact_update_requests;
create policy coolerco_contact_upd_staff on public.coolerco_contact_update_requests for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));

-- Feedback: supplier side only; a client user only when the supplier switched sharing on for that client
grant select on public.coolerco_case_feedback to authenticated;
drop policy if exists coolerco_feedback_supplier on public.coolerco_case_feedback;
create policy coolerco_feedback_supplier on public.coolerco_case_feedback for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));
drop policy if exists coolerco_feedback_client on public.coolerco_case_feedback;
create policy coolerco_feedback_client on public.coolerco_case_feedback for select to authenticated
  using (exists (select 1 from public.coolerco_user_access a join public.coolerco_clients c on c.code = a.client_code
                  where a.user_id = auth.uid() and a.active and a.role_code = 'client'
                    and c.share_feedback and c.code = coolerco_case_feedback.client_code));

-- Functions: who may call what
revoke all on function public.coolerco_has_role(text[]) from public, anon;
grant execute on function public.coolerco_has_role(text[]) to authenticated;
revoke all on function public.coolerco_my_access() from public, anon;
grant execute on function public.coolerco_my_access() to authenticated;
revoke all on function public.coolerco_priority_for(text, text) from public;
grant execute on function public.coolerco_priority_for(text, text) to anon, authenticated;
revoke all on function public.coolerco_notify(text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.coolerco_cases_notify_trg() from public, anon, authenticated;
revoke all on function public.coolerco_portal_propose_contact(text, jsonb) from public;
grant execute on function public.coolerco_portal_propose_contact(text, jsonb) to anon, authenticated;
revoke all on function public.coolerco_contact_update_decide(uuid, boolean, text) from public, anon;
grant execute on function public.coolerco_contact_update_decide(uuid, boolean, text) to authenticated;
revoke all on function public.coolerco_feedback_context(text) from public;
grant execute on function public.coolerco_feedback_context(text) to anon, authenticated;
revoke all on function public.coolerco_feedback_submit(text, int, boolean, boolean, text) from public;
grant execute on function public.coolerco_feedback_submit(text, int, boolean, boolean, text) to anon, authenticated;
revoke all on function public.coolerco_asset_has_open_case(text, text) from public, anon;
grant execute on function public.coolerco_asset_has_open_case(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. First system administrator — FILL IN the SmartHub login email, then run this line by itself.
--     Until someone holds system_admin, nobody can hand out roles.
-- ---------------------------------------------------------------------
-- insert into public.coolerco_user_access (user_id, role_code, created_by)
-- select id, 'system_admin', 'setup' from auth.users where email = '<your SmartHub login email>';
