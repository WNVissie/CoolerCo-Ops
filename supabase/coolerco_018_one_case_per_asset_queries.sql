-- CoolerCo-Ops · 018 · One open case per asset · customer queries on an existing case · repeat-repair flag
-- Additive only (coolerco_ objects). Existing functions of other apps and coolerco_portal_submit are NOT changed.
-- Replaces three of our own functions from 016/017 (coolerco_asset_has_open_case, coolerco_portal_options,
-- coolerco_portal_submit_v2). Needs 016 + 017. Rollback: coolerco_018_rollback.sql (re-run 017 afterwards).

-- ---------------------------------------------------------------------
-- 1. Settings, columns, query reasons
-- ---------------------------------------------------------------------
insert into public.coolerco_settings (key, value) values
  ('repeat_repair_days',       '30'::jsonb),   -- a repair on the same asset within this many days of the last one = repeat repair
  ('portal_daily_query_limit', '3'::jsonb)     -- customer queries per case per day
on conflict (key) do nothing;

alter table public.coolerco_cases
  add column if not exists repeat_of_case text,   -- the earlier repair this one follows
  add column if not exists repeat_days    int;    -- days since that repair was closed

create table if not exists public.coolerco_query_reasons (
  code            text primary key,
  label           text not null,
  raises_priority text check (raises_priority in ('High', 'Medium')),  -- null = priority unchanged
  needs_note      boolean not null default false,
  active          boolean not null default true,
  sort_order      int not null default 100
);

insert into public.coolerco_query_reasons (code, label, raises_priority, needs_note, sort_order) values
  ('WHEN',     'When will someone come?',               null,   false, 10),
  ('WORSE',    'The problem has got worse',             null,   false, 20),
  ('SPOILING', 'My product is now spoiling',            'High', false, 30),
  ('FIXED',    'It is working again — please cancel',   null,   false, 40),
  ('OTHER',    'Something else',                        null,   true,  50)
on conflict (code) do nothing;

alter table public.coolerco_query_reasons enable row level security;
revoke all on public.coolerco_query_reasons from anon;
grant select, insert, update, delete on public.coolerco_query_reasons to authenticated;
drop policy if exists coolerco_query_reasons_read on public.coolerco_query_reasons;
create policy coolerco_query_reasons_read on public.coolerco_query_reasons for select to authenticated using (true);
drop policy if exists coolerco_query_reasons_admin on public.coolerco_query_reasons;
create policy coolerco_query_reasons_admin on public.coolerco_query_reasons for all to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator']))
  with check (public.coolerco_has_role(array['system_admin', 'administrator']));

insert into public.coolerco_notification_rules (event_type, recipient_type, channel) values
  ('case_query', 'supervisor',     'inapp'),
  ('case_query', 'supervisor',     'push'),
  ('case_query', 'concessionaire', 'inapp')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. What counts as closed, and the open case (if any) for an asset — COM and CoolerCo
-- ---------------------------------------------------------------------
create or replace function public.coolerco_case_is_closed(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, '') in ('Rejected', 'Cancelled', 'Canceled', 'Completed', 'Closed', 'Solved', 'Resolved', 'Linked to COM');
$$;

create or replace function public.coolerco_asset_open_case(p_asset text, p_except_case text default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select o from (
    select jsonb_build_object('source', 'CoolerCo', 'case_number', k.case_number, 'case_type', k.case_type,
                              'status', k.status_reason, 'created_on', k.created_on) o, k.created_on
      from public.coolerco_cases k
     where p_asset in (k.mapped_asset, k.asset_repaired, k.asset_removed, k.asset_delivered)
       and not public.coolerco_case_is_closed(k.status_reason)
       and k.case_number is distinct from p_except_case
    union all
    select jsonb_build_object('source', 'COM', 'case_number', c.case_number, 'case_type', c.case_type,
                              'status', c.status_reason, 'created_on', c.created_on), c.created_on
      from public.cases c
     where p_asset in (c.mapped_asset, c.asset_repaired, c.asset_removed, c.asset_delivered)
       and lower(trim(c.status_reason)) in ('open', 'in progress', 'waiting', 'in service', 'on hold')
       and c.case_number is distinct from p_except_case
  ) x
  where p_asset is not null
  order by created_on limit 1;
$$;

-- keep the 016 helper in step with the same rule
create or replace function public.coolerco_asset_has_open_case(p_asset text, p_except_case text default null)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_asset_open_case(p_asset, p_except_case) ->> 'case_number';
$$;

-- ---------------------------------------------------------------------
-- 3. Portal lists now include the query reasons and the store's saved contact details
-- ---------------------------------------------------------------------
create or replace function public.coolerco_portal_options(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l public.coolerco_portal_links;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  return jsonb_build_object(
    -- the store's saved contact details, so the customer can confirm them in one glance
    'contact', jsonb_build_object('name', l.contact_name, 'phone', coalesce(l.mobile_number, l.contact_number), 'email', l.email,
                 'notify_email', l.notify_email,
                 'update_pending', exists (select 1 from public.coolerco_contact_update_requests r where r.portal_link_id = l.id and r.status = 'Pending')),
    'symptoms', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label, 'ask_product', s.ask_product) order by s.sort_order, s.label)
                            from public.coolerco_symptoms s where s.active and s.show_in_portal), '[]'::jsonb),
    'impacts',  coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label) order by i.sort_order, i.label)
                            from public.coolerco_product_impacts i where i.active), '[]'::jsonb),
    'query_reasons', coalesce((select jsonb_agg(jsonb_build_object('code', q.code, 'label', q.label, 'needs_note', q.needs_note) order by q.sort_order, q.label)
                            from public.coolerco_query_reasons q where q.active), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 4. Submit: refuse a second case for an asset that already has an open one; flag repeat repairs
-- ---------------------------------------------------------------------
create or replace function public.coolerco_portal_submit_v2(p_token text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l        public.coolerco_portal_links;
  s        public.coolerco_symptoms;
  kind     text := p_request ->> 'kind';
  v_asset  text := nullif(p_request ->> 'asset', '');
  v_sym    text := nullif(p_request ->> 'symptom', '');
  v_imp    text := nullif(p_request ->> 'product_impact', '');
  v_open   jsonb;
  v_res    jsonb;
  v_no     text;
  v_pri    text;
  v_client text;
  v_needs  boolean;
  v_days   int;
  v_prev   text;
  v_prev_at timestamptz;
  v_status text := 'Waiting for Approval';
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;

  if kind = 'repair' then
    select * into s from public.coolerco_symptoms where code = v_sym and active;
    if not found then return jsonb_build_object('error', 'symptom_required'); end if;
    if s.ask_product then
      if v_imp is null or not exists (select 1 from public.coolerco_product_impacts where code = v_imp and active) then
        return jsonb_build_object('error', 'impact_required');
      end if;
    else
      v_imp := null;
    end if;
  else
    v_sym := null; v_imp := null;
  end if;

  -- One open case per asset, whatever the request type. The lock stops two people logging the same asset at the same moment.
  if kind in ('repair', 'collection') and v_asset is not null then
    perform pg_advisory_xact_lock(hashtext('coolerco_asset:' || v_asset));
    v_open := public.coolerco_asset_open_case(v_asset);
    if v_open is not null then return jsonb_build_object('error', 'already_open') || v_open; end if;
  end if;

  -- the existing function does all the other checks and creates the case
  v_res := public.coolerco_portal_submit(p_token, p_request - 'priority');
  if v_res ? 'error' then return v_res; end if;
  v_no := v_res ->> 'case_number';

  v_client := coalesce(l.client_code, 'MAGNUM');
  update public.coolerco_cases set client_code = v_client where case_number = v_no;

  if kind = 'repair' then
    v_pri := public.coolerco_priority_for(v_sym, v_imp);

    -- repeat repair: the last repair on this asset was closed within the window (COM or CoolerCo)
    select coalesce((value #>> '{}')::int, 30) into v_days from public.coolerco_settings where key = 'repeat_repair_days';
    select x.case_number, x.closed_at into v_prev, v_prev_at from (
      select k.case_number, coalesce(k.service_closure_date, k.updated_at) as closed_at
        from public.coolerco_cases k
       where k.asset_repaired = v_asset and k.case_number <> v_no and k.status_reason in ('Completed', 'Closed', 'Solved', 'Resolved')
      union all
      select c.case_number, c.service_closure_date
        from public.cases c
       where c.asset_repaired = v_asset and c.case_type ilike 'Repair%' and c.service_closure_date is not null
         and lower(coalesce(c.status_reason, '')) not like 'cancel%'
    ) x
    where x.closed_at > now() - make_interval(days => coalesce(v_days, 30))
    order by x.closed_at desc limit 1;

    update public.coolerco_cases
       set symptom_code = v_sym, product_impact = v_imp, priority = v_pri,
           priority_source = 'auto', priority_set_by = 'system', priority_set_at = now(),
           repeat_of_case = v_prev,
           repeat_days = case when v_prev_at is not null then greatest(0, floor(extract(epoch from now() - v_prev_at) / 86400))::int end,
           updated_at = now()
     where case_number = v_no;

    update public.coolerco_notifications
       set priority = v_pri, client_code = v_client,
           payload = payload || jsonb_build_object('priority', v_pri, 'symptom', s.label, 'repeat_of', v_prev,
                       'product_impact', (select label from public.coolerco_product_impacts where code = v_imp))
     where case_number = v_no and event_type = 'case_logged';

    select coalesce(c.repair_needs_approval, false) into v_needs from public.coolerco_clients c where c.code = v_client;
    if not coalesce(v_needs, false) then
      update public.coolerco_cases
         set status_reason = 'Open', approved_by = 'Auto (repair)', approved_at = now(),
             begin_date = coalesce(begin_date, now()),
             end_date = coalesce(end_date, now() + make_interval(days => coalesce(sla_days, 2))),
             updated_at = now()
       where case_number = v_no;
      insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_label)
      values (v_no, 'status', 'Waiting for Approval', 'Open', 'AUTO_REPAIR',
              'Repair opened without approval · priority ' || v_pri || ' (' || s.label || ')'
                || case when v_prev is not null then ' · repeat of ' || v_prev else '' end, 'system', 'system');
      v_status := 'Open';
    end if;
  end if;

  return v_res || jsonb_build_object('status', v_status, 'priority', v_pri, 'repeat_of', v_prev);
end $$;

-- ---------------------------------------------------------------------
-- 5. One case for the customer: details + the messages the customer may see
-- ---------------------------------------------------------------------
create or replace function public.coolerco_portal_case(p_token text, p_case text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  l public.coolerco_portal_links;
  k public.coolerco_cases;
  c record;
  v jsonb;
  v_lim int;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;

  select * into k from public.coolerco_cases where case_number = p_case and pos_local_code = l.pos_local_code;
  if found then
    v := jsonb_build_object('source', 'CoolerCo', 'case_number', k.case_number, 'case_type', k.case_type, 'status', k.status_reason,
           'created_on', k.created_on, 'due', k.end_date, 'open', not public.coolerco_case_is_closed(k.status_reason),
           'asset', coalesce(k.asset_repaired, k.asset_removed, k.mapped_asset), 'priority', k.priority,
           'symptom', (select label from public.coolerco_symptoms where code = k.symptom_code),
           'product_impact', (select label from public.coolerco_product_impacts where code = k.product_impact),
           'description', k.description);
  else
    select case_number, case_type, status_reason, created_on, end_date, coalesce(asset_repaired, asset_removed, asset_delivered, mapped_asset) as asset
      into c from public.cases where case_number = p_case and pos_local_code = l.pos_local_code;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    v := jsonb_build_object('source', 'COM', 'case_number', c.case_number, 'case_type', c.case_type, 'status', c.status_reason,
           'created_on', c.created_on, 'due', c.end_date, 'asset', c.asset,
           'open', lower(trim(c.status_reason)) in ('open', 'in progress', 'waiting', 'in service', 'on hold'));
  end if;

  select coalesce((value #>> '{}')::int, 3) into v_lim from public.coolerco_settings where key = 'portal_daily_query_limit';
  return v || jsonb_build_object(
    'barcode', (select bar_code from public.assets_live where name = v ->> 'asset' limit 1),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'mine', m.author_type = 'customer',
                                   'from', case when m.author_type = 'customer' then 'You' else 'CoolerCo' end, 'body', m.body) order by m.created_at)
                            from public.coolerco_case_comments m where m.case_number = p_case and m.visibility = 'customer'), '[]'::jsonb),
    'queries_left', greatest(0, coalesce(v_lim, 3) - (select count(*) from public.coolerco_case_comments m
                                where m.case_number = p_case and m.author_type = 'customer' and m.created_at > now() - interval '1 day'))::int);
end $$;

-- ---------------------------------------------------------------------
-- 6. Customer query on an existing open case (no new case). Stored as a comment the customer can see.
--    A reason that raises the priority does so straight away (CoolerCo cases; COM cases only alert).
-- ---------------------------------------------------------------------
create or replace function public.coolerco_portal_case_query(p_token text, p_case text, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l  public.coolerco_portal_links;
  pw public.coolerco_pos_warehouse;
  q  public.coolerco_query_reasons;
  k  public.coolerco_cases;
  v_src text; v_type text; v_status text; v_pri text; v_client text; v_wh text;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  v_lim int; v_raised boolean := false;
  v_who text;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  select * into q from public.coolerco_query_reasons where code = p_reason and active;
  if not found then return jsonb_build_object('error', 'reason_required'); end if;
  if q.needs_note and v_note is null then return jsonb_build_object('error', 'note_required'); end if;
  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;

  select * into k from public.coolerco_cases where case_number = p_case and pos_local_code = l.pos_local_code for update;
  if found then
    v_src := 'CoolerCo'; v_type := k.case_type; v_status := k.status_reason; v_pri := k.priority;
    v_client := coalesce(k.client_code, l.client_code, 'MAGNUM'); v_wh := k.warehouse_code;
    if public.coolerco_case_is_closed(k.status_reason) then return jsonb_build_object('error', 'case_closed'); end if;
  else
    select case_type, status_reason into v_type, v_status from public.cases where case_number = p_case and pos_local_code = l.pos_local_code;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    if lower(trim(v_status)) not in ('open', 'in progress', 'waiting', 'in service', 'on hold') then return jsonb_build_object('error', 'case_closed'); end if;
    v_src := 'COM'; v_client := coalesce(l.client_code, 'MAGNUM'); v_wh := pw.warehouse_code;
  end if;

  select coalesce((value #>> '{}')::int, 3) into v_lim from public.coolerco_settings where key = 'portal_daily_query_limit';
  if (select count(*) from public.coolerco_case_comments m where m.case_number = p_case and m.author_type = 'customer'
        and m.created_at > now() - interval '1 day') >= coalesce(v_lim, 3) then
    return jsonb_build_object('error', 'query_limit');
  end if;

  v_who := coalesce(l.contact_name, 'customer');
  insert into public.coolerco_case_comments (case_number, case_source, author_type, author_label, body, visibility)
  values (p_case, v_src, 'customer', 'Customer: ' || v_who, q.label || coalesce(E'\n' || v_note, ''), 'customer');

  if q.raises_priority is not null then
    if v_src = 'CoolerCo' and k.priority is distinct from q.raises_priority and not (k.priority = 'High') then
      update public.coolerco_cases
         set priority = q.raises_priority, priority_source = 'customer_query', priority_set_by = 'customer', priority_set_at = now(), updated_at = now()
       where case_number = p_case;
      insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_label)
      values (p_case, 'edit', k.status_reason, k.status_reason, 'PRIORITY_RAISED',
              'Priority ' || coalesce(k.priority, 'not set') || ' → ' || q.raises_priority || ' · customer: ' || q.label, 'customer', v_who);
      v_raised := true;
    end if;
    v_pri := q.raises_priority;
  end if;

  perform public.coolerco_notify('case_query', p_case, v_client, v_wh, l.pos_local_code,
    'Customer query · ' || q.label || ' · ' || coalesce(l.point_of_sale, l.pos_local_code),
    jsonb_build_object('case_number', p_case, 'source', v_src, 'case_type', v_type, 'status', v_status, 'reason', q.code,
                       'reason_label', q.label, 'note', v_note, 'priority', v_pri, 'priority_raised', v_raised,
                       'point_of_sale', l.point_of_sale),
    v_pri);

  return jsonb_build_object('ok', true, 'priority_raised', v_raised, 'priority', v_pri);
end $$;

-- ---------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------
revoke all on function public.coolerco_case_is_closed(text) from public;
grant execute on function public.coolerco_case_is_closed(text) to anon, authenticated;
revoke all on function public.coolerco_asset_open_case(text, text) from public, anon;
grant execute on function public.coolerco_asset_open_case(text, text) to authenticated;
revoke all on function public.coolerco_asset_has_open_case(text, text) from public, anon;
grant execute on function public.coolerco_asset_has_open_case(text, text) to authenticated;
revoke all on function public.coolerco_portal_options(text) from public;
grant execute on function public.coolerco_portal_options(text) to anon, authenticated;
revoke all on function public.coolerco_portal_submit_v2(text, jsonb) from public;
grant execute on function public.coolerco_portal_submit_v2(text, jsonb) to anon, authenticated;
revoke all on function public.coolerco_portal_case(text, text) from public;
grant execute on function public.coolerco_portal_case(text, text) to anon, authenticated;
revoke all on function public.coolerco_portal_case_query(text, text, text, text) from public;
grant execute on function public.coolerco_portal_case_query(text, text, text, text) to anon, authenticated;
