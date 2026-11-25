-- 059 · Action Required desk + follow-up rules for self-managed clients (Tiger, Demo …) — Wanda 2026-11-25 14:03
-- Every "not done" outcome → Action Required; the case waits on the desk with its reason. Ways out per case type:
--   Removal / Replacement / Deliver / Repair at POS (not failed) / Decal  → 🔁 Reschedule (new case of the same type, parent linked) · 🚫 Cancel
--   Repair at Shopper POS, repair failed → 🔁 new Repair at POS · 🔄 Replacement · ↩️ Removal · 🚫 Cancel
--   Repair at Workshop, repair failed    → 🔁 relog the repair · 🗑 Scrap (Scrap an Asset case, cooler "To be scrapped") — no cancel
--   Decal @WH, lack of material (new)    → cooler "To be branded" → Action Required
--   Replacement, only one half done      → Solved (partial) straight away; done half follows its own rule; the missing half
--                                           gets an automatic follow-up (Deliver an Asset, or Removal of Asset)
--   Location unavailable / No contact person → 🚨 alert to the region (ROP portal "Needs action" tab) + office Inbox:
--                                           region fixes the store (location / contact) and requests the reschedule (follow-up case)
-- Rescheduled parent case → Resolved (motive RESCHEDULED → new case). Every follow-up gets its own SLA clock (050 trigger).
-- Rules for Magnum (COM master) keep their COM notifications; case status / follow-ups only apply to CoolerCo-master cases.
-- Needs 038/039, 050, 057, 058. Add-only (function replacements saved in coolerco_fn_backup '059'). Rollback: coolerco_059_rollback.sql.

-- ── 1. movement types + register statuses ───────────────────────────────────────────────────
insert into public.coolerco_movement_types (code, name, from_kind, to_kind, status_after, physical, source, active) values
  ('CC-TO-BRAND', 'Status: to be branded (decal not done)', 'Warehouse', 'Warehouse', 'To be Branded', false, 'CoolerCo', true),
  ('CC-TO-SCRAP', 'Status: to be scrapped', 'Warehouse', 'Warehouse', 'To be Scrapped', false, 'CoolerCo', true)
on conflict (code) do nothing;

create or replace function public.coolerco_register_status(p_status text, p_old text)
returns text language sql immutable as $$
  select case p_status when 'Assigned' then 'At outlet' when 'To be Repaired' then 'In warehouse, awaiting repair'
                       when 'In Transit' then 'In transit to warehouse' when 'Ready to Work' then 'In warehouse, ready to work'
                       when 'To be Branded' then 'In warehouse, to be branded' when 'To be Scrapped' then 'In warehouse, to be scrapped'
                       else coalesce(p_status, p_old) end
$$;

-- ── 2. rules (data) ─────────────────────────────────────────────────────────────────────────
create table if not exists public.coolerco_rule_backup (script text, rule jsonb not null, saved_at timestamptz not null default now());
alter table public.coolerco_rule_backup enable row level security;
revoke all on public.coolerco_rule_backup from anon, authenticated;
insert into public.coolerco_rule_backup (script, rule)
select '059', to_jsonb(r) from public.coolerco_case_rules r
 where not exists (select 1 from public.coolerco_rule_backup b where b.script = '059')
   and ((r.client_code = '*' and (r.case_type, r.event) in (('Repair at Shopper POS', 'repair_failed'), ('Repair at Workshop', 'repair_failed')))
        or (r.client_code = 'TIGER' and r.case_type = 'Replacement of Asset' and r.event = 'partial'));

update public.coolerco_case_rules set case_status = 'Action Required', follow_up_case_type = null, follow_up_asset_role = null, follow_up_asset_status = null,
       note = 'Changed 059: Action Required → desk (new repair / replacement / removal)', updated_at = now()
 where client_code = '*' and case_type = 'Repair at Shopper POS' and event = 'repair_failed';
update public.coolerco_case_rules set case_status = 'Action Required', note = 'Changed 059: Action Required → desk (relog repair / scrap)', updated_at = now()
 where client_code = '*' and case_type = 'Repair at Workshop' and event = 'repair_failed';
update public.coolerco_case_rules set active = false, note = 'Off since 059: replaced by delivered_only / collected_only', updated_at = now()
 where client_code = 'TIGER' and case_type = 'Replacement of Asset' and event = 'partial';

insert into public.coolerco_case_rules (client_code, case_type, event, notification, case_status, movements, follow_up_case_type, follow_up_asset_role, com_asset_roles, note) values
  ('*', 'Decal @WH', 'lack_material', 'LACK OF MATERIAL', 'Action Required', '[{"code": "CC-TO-BRAND", "role": "repaired"}]', null, null, null, 'Added 059'),
  ('*', 'Replacement of Asset', 'delivered_only', null, 'Solved', '[{"code": "003", "role": "delivered"}]', null, null, null, 'Added 059: new cooler delivered, old not collected → follow-up Removal'),
  ('*', 'Replacement of Asset', 'collected_only', null, 'Solved', '[{"code": "004", "role": "removed"}]', 'Repair at Workshop', 'removed', null, 'Added 059: old cooler collected, new not delivered → follow-up Deliver')
on conflict (client_code, case_type, event) do nothing;

-- "Lack of material" as a job-card / office reason (repairs and Decal @WH)
insert into public.coolerco_field_reasons (code, label, needs_note, active, sort_order)
select 'LACK_MATERIAL', 'Lack of material', false, true, 82 where not exists (select 1 from public.coolerco_field_reasons where code = 'LACK_MATERIAL');
insert into public.coolerco_event_codes (code, event) select 'LACK_MATERIAL', 'lack_material' where not exists (select 1 from public.coolerco_event_codes where code = 'LACK_MATERIAL');

-- "No contact person" gets its own event so it can raise the client / region alert
update public.coolerco_event_codes set event = 'no_contact' where code = 'NO_CONTACT';
insert into public.coolerco_case_rules (client_code, case_type, event, notification, case_status, note)
select '*', t, 'no_contact', null, 'Action Required', 'Added 059'
  from (values ('Deliver an Asset'), ('Removal of Asset'), ('Replacement of Asset'), ('Repair at Shopper POS'), ('Repair at Workshop'), ('Decal @WH')) a(t)
on conflict (client_code, case_type, event) do nothing;

-- ── 3. region alerts (location unavailable / customer cannot be contacted) ──────────────────
create table if not exists public.coolerco_region_alerts (
  id uuid primary key default gen_random_uuid(),
  case_number text not null, client_code text, warehouse_code text, pos_local_code text,
  kind text not null check (kind in ('location', 'contact')),
  reason text, status text not null default 'open' check (status in ('open', 'done', 'closed')),
  created_at timestamptz not null default now(), done_at timestamptz, done_by text, note text, follow_up_case text);
create unique index if not exists ux_coolerco_region_alerts_open on public.coolerco_region_alerts (case_number, kind) where status = 'open';
alter table public.coolerco_region_alerts enable row level security;
revoke all on public.coolerco_region_alerts from anon, authenticated;
grant select on public.coolerco_region_alerts to authenticated;
drop policy if exists coolerco_region_alerts_read on public.coolerco_region_alerts;
create policy coolerco_region_alerts_read on public.coolerco_region_alerts for select to authenticated using (public.coolerco_can_see(client_code, warehouse_code));

insert into public.coolerco_notification_rules (event_type, recipient_type, channel, client_code, active)
select e, r, c, null, true from (values ('region_action', 'supervisor', 'inapp'), ('region_action', 'concessionaire', 'inapp'), ('region_action', 'concessionaire', 'email')) v(e, r, c)
 where not exists (select 1 from public.coolerco_notification_rules x where x.event_type = v.e and x.recipient_type = v.r and x.channel = v.c);

create or replace function public.coolerco_trg_region_alert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; v_kind text;
begin
  v_kind := case new.event_type when 'rule:location_unavailable' then 'location' when 'rule:no_contact' then 'contact' end;
  if v_kind is null then return null; end if;
  select * into k from public.coolerco_cases where case_number = new.case_number;
  if not found or not public.coolerco_is_self_managed(k.client_code) then return null; end if;
  insert into public.coolerco_region_alerts (case_number, client_code, warehouse_code, pos_local_code, kind, reason)
  values (k.case_number, k.client_code, k.warehouse_code, k.pos_local_code, v_kind, left(coalesce(new.notes, new.reason_code), 500))
  on conflict (case_number, kind) where status = 'open' do nothing;
  perform public.coolerco_notify('region_action', k.case_number, k.client_code, k.warehouse_code, k.pos_local_code,
          case v_kind when 'location' then '📍 Check the store location: ' else '📞 Customer could not be contacted: ' end || coalesce(k.point_of_sale, k.pos_local_code),
          jsonb_build_object('kind', v_kind, 'case_type', k.case_type), 'high');
  return null;
exception when others then
  begin insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, 'region_alert', 'trigger', jsonb_build_object('error', sqlerrm)); exception when others then null; end;
  return null;
end $$;
drop trigger if exists coolerco_region_alert on public.coolerco_case_events;
create trigger coolerco_region_alert after insert on public.coolerco_case_events for each row
  when (new.event_type in ('rule:location_unavailable', 'rule:no_contact')) execute function public.coolerco_trg_region_alert();

-- ── 4. follow-up case from a parent (store, priority and the right cooler copied) ───────────
create or replace function public.coolerco_case_spawn(p_parent text, p_type text, p_note text, p_actor text, p_asset text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; v_no text; v_a text;
begin
  select * into k from public.coolerco_cases where case_number = p_parent;
  if not found then return null; end if;
  v_a := coalesce(p_asset, case when p_type in ('Removal of Asset', 'Replacement of Asset') then coalesce(k.asset_removed, k.mapped_asset)
                                when p_type = 'Deliver an Asset' then null
                                else coalesce(k.asset_repaired, k.mapped_asset, k.asset_removed) end);
  v_no := public.coolerco_next_case_number(k.warehouse_code);
  insert into public.coolerco_cases (case_number, case_type, status_reason, originator, origin, priority, warehouse_code, warehouse_workshop,
         responsible_ordering_party, point_of_sale, pos_local_code, address, latitude, longitude, mapped_asset, asset_removed, asset_repaired,
         requested_product_base, requested_asset_condition, description, begin_date, created_on, created_by_label, client_code, related_case, updated_at)
  values (v_no, p_type, 'Open', 'CoolerCo', 'Follow-up', k.priority, k.warehouse_code, k.warehouse_workshop,
          k.responsible_ordering_party, k.point_of_sale, k.pos_local_code, k.address, k.latitude, k.longitude, v_a,
          case when p_type in ('Removal of Asset', 'Replacement of Asset') then v_a end,
          case when p_type in ('Repair at Shopper POS', 'Repair at Workshop', 'Decal @WH', 'Scrap an Asset') then v_a end,
          case when p_type in ('Deliver an Asset', 'Replacement of Asset') then k.requested_product_base end,
          case when p_type in ('Deliver an Asset', 'Replacement of Asset') then k.requested_asset_condition end,
          'Follow-up of ' || p_parent || coalesce(' · ' || nullif(trim(p_note), ''), ''), now(), now(), p_actor, k.client_code, p_parent, now());
  insert into public.coolerco_case_events (case_number, event_type, to_status, notes, actor_type, actor_label)
  values (v_no, 'created', 'Open', 'Follow-up of ' || p_parent || coalesce(' · ' || nullif(trim(p_note), ''), ''), 'user', p_actor);
  return v_no;
end $$;

-- ── 5. the desk ─────────────────────────────────────────────────────────────────────────────
-- last outcome that sent the case to Action Required
create or replace function public.coolerco_ar_last(p_case text)
returns table (event text, notes text, at timestamptz, by_label text)
language sql stable security definer set search_path = public, pg_temp as $$
  select substr(e.event_type, 6), coalesce((select o.notes from public.coolerco_case_events o where o.case_number = e.case_number and o.event_type = 'office_close'
                                              and o.created_at between e.created_at - interval '1 minute' and e.created_at order by o.created_at desc limit 1), e.notes),
         e.created_at, e.actor_label
    from public.coolerco_case_events e
   where e.case_number = p_case and e.event_type like 'rule:%' and e.to_status = 'Action Required'
   order by e.created_at desc limit 1
$$;

create or replace function public.coolerco_ar_ways(p_type text, p_event text)
returns text[] language sql immutable as $$
  select case
    when p_type = 'Repair at Shopper POS' and p_event = 'repair_failed' then array['Repair at Shopper POS', 'Replacement of Asset', 'Removal of Asset']
    when p_type = 'Repair at Workshop' and p_event = 'repair_failed' then array['Repair at Workshop', 'Scrap an Asset']
    else array[p_type] end
$$;

create or replace function public.coolerco_ar_options(p_case text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; l record; v_ways text[];
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into k from public.coolerco_cases where case_number = p_case;
  if not found or not public.coolerco_is_self_managed(k.client_code) or not public.coolerco_can_see(k.client_code, k.warehouse_code) then return jsonb_build_object('error', 'not_found'); end if;
  if k.status_reason <> 'Action Required' then return jsonb_build_object('error', 'not_action_required', 'status', k.status_reason); end if;
  select * into l from public.coolerco_ar_last(p_case);
  v_ways := public.coolerco_ar_ways(k.case_type, l.event);
  return jsonb_build_object('case', k.case_number, 'case_type', k.case_type, 'event', l.event, 'reason', l.notes, 'since', l.at, 'by', l.by_label,
    'ways', to_jsonb(v_ways), 'can_cancel', not (k.case_type = 'Repair at Workshop' and l.event = 'repair_failed'),
    'can_decide', public.coolerco_can_office_close() or public.coolerco_has_role(array['client']),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'at', a.created_at, 'done_by', a.done_by, 'note', a.note) order by a.created_at)
                          from public.coolerco_region_alerts a where a.case_number = p_case), '[]'),
    'on_route', (select jsonb_build_object('route', route_number, 'date', route_date) from public.coolerco_case_on_route(p_case)),
    'cancel_reasons', (select jsonb_agg(jsonb_build_object('code', code, 'label', label) order by code) from public.coolerco_reason_codes where status = 'Cancelled' and active));
end $$;

-- shared by the desk and the region portal: reschedule = follow-up case + parent Resolved
create or replace function public.coolerco_ar_reschedule_do(p_case text, p_type text, p_note text, p_actor text, p_actor_type text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; l record; v_new text; v_asset text;
begin
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if k.status_reason <> 'Action Required' then return jsonb_build_object('error', 'not_action_required', 'status', k.status_reason); end if;
  select * into l from public.coolerco_ar_last(p_case);
  if not p_type = any (public.coolerco_ar_ways(k.case_type, l.event)) then return jsonb_build_object('error', 'way_not_allowed'); end if;
  v_new := public.coolerco_case_spawn(p_case, p_type, p_note, p_actor);
  if p_type = 'Scrap an Asset' then
    v_asset := coalesce(k.asset_repaired, k.mapped_asset);
    if v_asset is not null then
      perform public.coolerco_post_movement(v_asset, 'CC-TO-SCRAP', to_jsonb(k), 'repaired', 'desk', null, false);
    end if;
  end if;
  update public.coolerco_cases set status_reason = 'Resolved', motive = 'RESCHEDULED → ' || v_new, service_closure_date = now(), updated_at = now() where case_number = p_case;
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_label)
  values (p_case, 'rescheduled', k.status_reason, 'Resolved', 'RESCHEDULED', 'New ' || p_type || ' case ' || v_new || coalesce(' · ' || nullif(trim(p_note), ''), ''), p_actor_type, p_actor);
  update public.coolerco_region_alerts set status = case when status = 'open' then 'closed' else status end, follow_up_case = coalesce(follow_up_case, v_new),
         done_at = coalesce(done_at, now()), done_by = coalesce(done_by, p_actor) where case_number = p_case and status = 'open';
  return jsonb_build_object('ok', true, 'new_case', v_new, 'type', p_type);
end $$;

-- office / warehouse / client decide on the desk: reschedule (type) or cancel (reason)
create or replace function public.coolerco_ar_resolve(p_case text, p_action text, p_type text default null, p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; l record; v_by text := coalesce(auth.jwt() ->> 'email', 'user');
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not (public.coolerco_can_office_close() or public.coolerco_has_role(array['client'])) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into k from public.coolerco_cases where case_number = p_case;
  if not found or not public.coolerco_is_self_managed(k.client_code) or not public.coolerco_can_see(k.client_code, k.warehouse_code) then return jsonb_build_object('error', 'not_found'); end if;
  if k.status_reason <> 'Action Required' then return jsonb_build_object('error', 'not_action_required', 'status', k.status_reason); end if;
  if p_action = 'reschedule' then
    return public.coolerco_ar_reschedule_do(p_case, p_type, p_note, v_by, case when public.coolerco_can_office_close() then 'user' else 'client' end);
  elsif p_action = 'cancel' then
    select * into l from public.coolerco_ar_last(p_case);
    if k.case_type = 'Repair at Workshop' and l.event = 'repair_failed' then return jsonb_build_object('error', 'cancel_not_allowed'); end if;
    update public.coolerco_region_alerts set status = 'closed', done_at = now(), done_by = v_by, note = coalesce(note, 'Case cancelled') where case_number = p_case and status = 'open';
    return public.coolerco_case_cancel(p_case, p_reason, p_note);
  end if;
  return jsonb_build_object('error', 'bad_action');
end $$;

-- the desk list
create or replace function public.coolerco_ar_list(p_client text default null, p_warehouse text default null)
returns table (case_number text, client_code text, case_type text, warehouse_code text, point_of_sale text, pos_local_code text,
               event text, reason text, since timestamptz, by_label text, ways text[], open_alerts text[], alerts_done text[], priority text, created_on timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select k.case_number, k.client_code, k.case_type, k.warehouse_code, k.point_of_sale, k.pos_local_code,
         l.event, l.notes, coalesce(l.at, k.updated_at), l.by_label, public.coolerco_ar_ways(k.case_type, l.event),
         array(select a.kind from public.coolerco_region_alerts a where a.case_number = k.case_number and a.status = 'open'),
         array(select a.kind from public.coolerco_region_alerts a where a.case_number = k.case_number and a.status = 'done'),
         k.priority, k.created_on
    from public.coolerco_cases k
    left join lateral public.coolerco_ar_last(k.case_number) l on true
   where auth.uid() is not null and k.status_reason = 'Action Required' and public.coolerco_is_self_managed(k.client_code)
     and public.coolerco_can_see(k.client_code, k.warehouse_code)
     and (p_client is null or k.client_code = p_client) and (p_warehouse is null or k.warehouse_code = p_warehouse)
   order by coalesce(l.at, k.updated_at)
$$;

-- ── 6. region portal (ROP link, no login): see alerts, fix the store, request the reschedule ──
create or replace function public.coolerco_conc_alerts(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  return jsonb_build_object('alerts', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'reason', a.reason, 'at', a.created_at, 'done_by', a.done_by, 'follow_up', a.follow_up_case,
             'case_number', k.case_number, 'case_type', k.case_type, 'case_status', k.status_reason,
             'outlet', jsonb_build_object('code', o.outlet_code, 'name', coalesce(o.name, k.point_of_sale), 'contact_person', o.contact_person, 'mobile_number', o.mobile_number,
                                          'email', o.email, 'street_address', o.street_address, 'suburb', o.suburb, 'town', o.town, 'latitude', o.latitude, 'longitude', o.longitude))
           order by (a.status = 'open') desc, a.created_at desc)
      from public.coolerco_region_alerts a
      join public.coolerco_cases k on k.case_number = a.case_number
      left join public.coolerco_outlets o on o.client_code = k.client_code and o.outlet_code = k.pos_local_code
     where public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code)
       and (a.status = 'open' or a.created_at > now() - interval '14 days')), '[]'));
end $$;

-- fix the store from the portal (logged in coolerco_outlet_changes with the portal user's name)
create or replace function public.coolerco_conc_alert_fix(p_session text, p_alert uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; a public.coolerco_region_alerts; k public.coolerco_cases; o public.coolerco_outlets;
        f text; v_old text; v_new text; v_n int := 0; v_lat double precision; v_lng double precision;
        v_fields text[] := array['contact_person', 'mobile_number', 'email', 'street_address', 'suburb', 'town', 'notes'];
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into a from public.coolerco_region_alerts where id = p_alert;
  select * into k from public.coolerco_cases where case_number = a.case_number;
  if a.id is null or not public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code) then return jsonb_build_object('error', 'not_found'); end if;
  select * into o from public.coolerco_outlets where client_code = k.client_code and outlet_code = k.pos_local_code for update;
  if not found then return jsonb_build_object('error', 'no_outlet'); end if;
  foreach f in array v_fields loop
    if p ? f then
      execute format('select ($1).%I::text', f) using o into v_old;
      v_new := nullif(trim(p ->> f), '');
      if v_new is distinct from v_old then
        execute format('update public.coolerco_outlets set %I = $1, updated_at = now(), updated_by = $3 where id = $2', f) using v_new, o.id, s.actor_label;
        insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value, changed_by)
        values (k.client_code, o.outlet_code, k.case_number, f, v_old, v_new, 'portal: ' || s.actor_label);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  if nullif(p ->> 'latitude', '') is not null or nullif(p ->> 'longitude', '') is not null then
    v_lat := (p ->> 'latitude')::double precision; v_lng := (p ->> 'longitude')::double precision;
    if v_lat is null or v_lng is null or v_lat not between -35.5 and -21.5 or v_lng not between 16 and 33.5 then return jsonb_build_object('error', 'bad_gps'); end if;
    if v_lat is distinct from o.latitude or v_lng is distinct from o.longitude then
      update public.coolerco_outlets set latitude = v_lat, longitude = v_lng, gps_source = 'region_portal', gps_set_by = s.actor_label, gps_set_at = now(), updated_at = now() where id = o.id;
      insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value, changed_by)
      values (k.client_code, o.outlet_code, k.case_number, 'gps', o.latitude || ',' || o.longitude, v_lat || ',' || v_lng, 'portal: ' || s.actor_label);
      update public.coolerco_cases set latitude = v_lat, longitude = v_lng, updated_at = now()
       where client_code = k.client_code and pos_local_code = o.outlet_code and not public.coolerco_case_is_closed(status_reason);
      v_n := v_n + 1;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'changed', v_n);
end $$;

-- the region confirms the store is checked and asks for the reschedule → follow-up case
create or replace function public.coolerco_conc_reschedule(p_session text, p_alert uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; a public.coolerco_region_alerts; k public.coolerco_cases; v jsonb;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into a from public.coolerco_region_alerts where id = p_alert for update;
  select * into k from public.coolerco_cases where case_number = a.case_number;
  if a.id is null or not public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code) then return jsonb_build_object('error', 'not_found'); end if;
  if a.status <> 'open' then return jsonb_build_object('error', 'already_done', 'follow_up', a.follow_up_case); end if;
  update public.coolerco_region_alerts set status = 'done', done_at = now(), done_by = 'portal: ' || s.actor_label, note = nullif(trim(coalesce(p_note, '')), '') where id = a.id;
  if k.status_reason = 'Action Required' then
    v := public.coolerco_ar_reschedule_do(k.case_number, k.case_type, 'Requested by ' || s.actor_label || ' after ' ||
           case a.kind when 'location' then 'checking the location' else 'checking the contact details' end || coalesce(' · ' || nullif(trim(p_note), ''), ''),
           'portal: ' || s.actor_label, 'concessionaire');
    update public.coolerco_region_alerts set follow_up_case = v ->> 'new_case' where id = a.id;
    return v;
  end if;
  return jsonb_build_object('ok', true, 'note', 'case is no longer waiting (' || k.status_reason || ')');
end $$;

-- ── 7. office close: Replacement half done (delivered only / collected only) ────────────────
insert into public.coolerco_fn_backup (script, fn, def)
select '059', p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
 where p.proname in ('coolerco_case_office_close', 'coolerco_case_close_options', 'coolerco_register_status')
on conflict (script, fn) do nothing;

create or replace function public.coolerco_case_close_options(p_case text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; v_open boolean; rt record; v_out jsonb := '[]'; r public.coolerco_case_rules; f record;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into k from public.coolerco_cases where case_number = p_case;
  if not found or not public.coolerco_is_self_managed(k.client_code) or not public.coolerco_can_see(k.client_code, k.warehouse_code) then
    return jsonb_build_object('error', 'not_found'); end if;
  v_open := not public.coolerco_case_is_closed(k.status_reason);
  select * into rt from public.coolerco_case_on_route(p_case);
  for r in select * from public.coolerco_case_rules x where x.active and x.allowed and x.case_type = k.case_type
             and x.event in ('completed', 'delivered_only', 'collected_only') and x.client_code in (k.client_code, '*')
           order by array_position(array['completed', 'delivered_only', 'collected_only'], x.event), (x.client_code = '*') loop
    if v_out @> jsonb_build_array(jsonb_build_object('key', r.event)) then continue; end if;
    v_out := v_out || jsonb_build_object('key', r.event, 'kind', 'done',
      'label', case r.event when 'completed' then coalesce(initcap(lower(r.notification)), 'Service complete')
                            when 'delivered_only' then 'Only new cooler delivered' else 'Only old cooler collected' end,
      'status', r.case_status,
      'follow_up', case r.event when 'delivered_only' then 'Removal of Asset' when 'collected_only' then 'Deliver an Asset + Repair at Workshop' else r.follow_up_case_type end,
      'needs_approval', r.needs_approval);
  end loop;
  for f in select fr.code, fr.label, fr.needs_note, coalesce(ec.event, 'other') ev
             from public.coolerco_field_reasons fr left join public.coolerco_event_codes ec on ec.code = fr.code
            where fr.active order by fr.sort_order loop
    select * into r from public.coolerco_case_rules x where x.active and x.case_type = k.case_type and x.event = f.ev
       and x.client_code in (k.client_code, '*') order by (x.client_code = '*') limit 1;
    if r.id is null and f.ev <> 'no_time' then continue; end if; -- reason does not apply to this case type (e.g. lack of material on a delivery)
    v_out := v_out || jsonb_build_object('key', f.code, 'kind', 'not_done', 'label', f.label, 'needs_note', f.needs_note, 'event', f.ev,
      'status', case when r.id is null then null else r.case_status end, 'follow_up', r.follow_up_case_type,
      'alert', case f.ev when 'location_unavailable' then 'location' when 'no_contact' then 'contact' end);
  end loop;
  return jsonb_build_object(
    'case', k.case_number, 'case_type', k.case_type, 'status', k.status_reason, 'open', v_open,
    'can_close', v_open and k.status_reason not in ('Waiting for Approval', 'Action Required') and public.coolerco_can_office_close(),
    'can_cancel', v_open and k.status_reason <> 'Action Required' and (public.coolerco_can_office_close() or public.coolerco_has_role(array['client'])),
    'on_route', case when rt.route_id is null then null else jsonb_build_object('route', rt.route_number, 'date', rt.route_date) end,
    'asset_delivered', k.asset_delivered, 'asset_removed', k.asset_removed, 'asset_repaired', coalesce(k.asset_repaired, k.mapped_asset),
    'requested_model', k.requested_product_base,
    'needs_delivered', k.case_type in ('Deliver an Asset', 'Replacement of Asset'),
    'needs_removed', k.case_type in ('Removal of Asset', 'Replacement of Asset'),
    'outcomes', v_out,
    'cancel_reasons', (select jsonb_agg(jsonb_build_object('code', code, 'label', label) order by code) from public.coolerco_reason_codes where status = 'Cancelled' and active));
end $$;

create or replace function public.coolerco_case_office_close(p_case text, p_result text, p_why text, p_note text default null,
                                                             p_delivered text default null, p_removed text default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; v_event text; v_res jsonb; v_pick jsonb; v_notes text; v_by text := coalesce(auth.jwt() ->> 'email', 'user');
        v_rem text := nullif(upper(trim(coalesce(p_removed, ''))), ''); v_label text; v_need boolean; v_follow text;
        v_needs_deliv boolean; v_needs_rem boolean;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_can_office_close() then return jsonb_build_object('error', 'not_allowed'); end if;
  if nullif(trim(coalesce(p_why, '')), '') is null then return jsonb_build_object('error', 'why_required'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found or not public.coolerco_is_self_managed(k.client_code) then return jsonb_build_object('error', 'not_found'); end if;
  if not public.coolerco_can_see(k.client_code, k.warehouse_code) then return jsonb_build_object('error', 'not_allowed'); end if;
  if public.coolerco_case_is_closed(k.status_reason) then return jsonb_build_object('error', 'already_closed', 'status', k.status_reason); end if;
  if k.status_reason = 'Waiting for Approval' then return jsonb_build_object('error', 'not_approved'); end if;
  if k.status_reason = 'Action Required' then return jsonb_build_object('error', 'on_desk'); end if;
  if p_at is not null and p_at > now() + interval '5 minutes' then return jsonb_build_object('error', 'future_time'); end if;

  if p_result in ('completed', 'delivered_only', 'collected_only') then
    if p_result <> 'completed' and k.case_type <> 'Replacement of Asset' then return jsonb_build_object('error', 'bad_result'); end if;
    v_event := p_result;
    v_needs_deliv := k.case_type in ('Deliver an Asset', 'Replacement of Asset') and p_result in ('completed', 'delivered_only');
    v_needs_rem := k.case_type in ('Removal of Asset', 'Replacement of Asset') and p_result in ('completed', 'collected_only');
    if v_needs_deliv and k.asset_delivered is null then
      if nullif(trim(coalesce(p_delivered, '')), '') is null then return jsonb_build_object('error', 'delivered_required'); end if;
      v_pick := public.coolerco_client_pick_select(p_case, p_delivered, null, 'typed', 'Office close: ' || trim(p_why));
      if v_pick ? 'error' then return v_pick || jsonb_build_object('step', 'pick'); end if;
      select * into k from public.coolerco_cases where case_number = p_case;
    end if;
    -- old cooler collected only: a picked new cooler stays in the warehouse (back to Ready to Work)
    if p_result = 'collected_only' and exists (select 1 from public.coolerco_client_picks where case_number = p_case and released_at is null) then
      perform public.coolerco_client_pick_undo(p_case, 'New cooler not delivered');
    end if;
    if v_needs_rem then
      if coalesce(v_rem, k.asset_removed) is null then return jsonb_build_object('error', 'removed_required'); end if;
      if v_rem is not null and v_rem is distinct from k.asset_removed then
        if not exists (select 1 from public.coolerco_assets where client_code = k.client_code and asset_number = v_rem) then
          return jsonb_build_object('error', 'removed_not_found', 'asset', v_rem); end if;
        update public.coolerco_cases set asset_removed = v_rem, updated_at = now() where case_number = p_case;
      end if;
    end if;
    v_label := case p_result when 'completed' then 'Completed' when 'delivered_only' then 'Only new cooler delivered' else 'Only old cooler collected' end;
  else
    select fr.label, fr.needs_note, coalesce(ec.event, 'other') into v_label, v_need, v_event
      from public.coolerco_field_reasons fr left join public.coolerco_event_codes ec on ec.code = fr.code where fr.code = p_result and fr.active;
    if v_label is null then return jsonb_build_object('error', 'bad_result'); end if;
    if v_need and nullif(trim(coalesce(p_note, '')), '') is null then return jsonb_build_object('error', 'note_required'); end if;
  end if;

  v_notes := 'Closed by the office (' || v_by || '): ' || v_label || ' · why: ' || trim(p_why) || coalesce(' · ' || nullif(left(trim(coalesce(p_note, '')), 500), ''), '');
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_user_id, actor_label)
  values (p_case, 'office_close', k.status_reason, k.status_reason, p_result, v_notes, 'user', auth.uid(), v_by);

  v_res := public.coolerco_case_apply_event(p_case, v_event, 'office', null,
             jsonb_strip_nulls(jsonb_build_object('removed', v_rem)), coalesce(p_at, now()), v_notes, null, null, public.coolerco_is_planner());
  if v_res ? 'needs_approval' then return jsonb_build_object('error', 'needs_supervisor') || v_res; end if;
  if v_res ? 'refused' then return jsonb_build_object('error', 'refused') || v_res; end if;

  -- Replacement half done: the missing half becomes its own case (Wanda: Solved (partial) straight away)
  if v_event = 'delivered_only' then v_follow := public.coolerco_case_spawn(p_case, 'Removal of Asset', 'Old cooler not collected', v_by);
  elsif v_event = 'collected_only' then v_follow := public.coolerco_case_spawn(p_case, 'Deliver an Asset', 'New cooler not delivered', v_by);
  end if;
  if v_follow is not null then
    update public.coolerco_cases set motive = 'PARTIAL → ' || v_follow, updated_at = now() where case_number = p_case;
  end if;
  if v_event in ('completed', 'delivered_only') then
    update public.coolerco_client_picks set released_at = now(), released_by = v_by, release_reason = 'Delivered (office close)'
     where case_number = p_case and released_at is null;
  end if;
  return jsonb_build_object('ok', true, 'event', v_event, 'engine', v_res, 'missing_half', v_follow,
                            'status', (select status_reason from public.coolerco_cases where case_number = p_case));
end $$;

-- ── 8. grants ───────────────────────────────────────────────────────────────────────────────
revoke all on function public.coolerco_case_spawn(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.coolerco_ar_reschedule_do(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.coolerco_ar_last(text) from public, anon;
revoke all on function public.coolerco_ar_options(text) from public, anon;
revoke all on function public.coolerco_ar_resolve(text, text, text, text, text) from public, anon;
revoke all on function public.coolerco_ar_list(text, text) from public, anon;
grant execute on function public.coolerco_ar_options(text) to authenticated;
grant execute on function public.coolerco_ar_resolve(text, text, text, text, text) to authenticated;
grant execute on function public.coolerco_ar_list(text, text) to authenticated;
-- region portal: no login (anon) — the session token is the key, as for the other coolerco_conc_* functions
grant execute on function public.coolerco_conc_alerts(text) to anon, authenticated;
grant execute on function public.coolerco_conc_alert_fix(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.coolerco_conc_reschedule(text, uuid, text) to anon, authenticated;
