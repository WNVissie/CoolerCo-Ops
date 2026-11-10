-- CoolerCo-Ops · 019 · Staff inbox (alerts, customer queries incl. COM cases, contact updates) · new-asset duplicate rule
-- Additive only (coolerco_ objects). Replaces our own coolerco_portal_submit_v2 (018) with one extra check.
-- Needs 016, 017, 018. Rollback: coolerco_019_rollback.sql (then re-run 018 to restore its submit function).

-- ---------------------------------------------------------------------
-- 1. New asset: is there already an open request for this catalogue item at this store?
-- ---------------------------------------------------------------------
create or replace function public.coolerco_store_open_new_request(p_pos text, p_family uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select o from (
    select jsonb_build_object('source', 'CoolerCo', 'case_number', k.case_number, 'case_type', k.case_type,
                              'status', k.status_reason, 'created_on', k.created_on) o, k.created_on
      from public.coolerco_cases k
     where k.pos_local_code = p_pos and k.requested_family_id = p_family
       and not public.coolerco_case_is_closed(k.status_reason)
    union all
    select jsonb_build_object('source', 'COM', 'case_number', c.case_number, 'case_type', c.case_type,
                              'status', c.status_reason, 'created_on', c.created_on), c.created_on
      from public.cases c
      join public.coolerco_product_base_family bf on bf.product_base = c.requested_product_base
     where c.pos_local_code = p_pos and bf.family_id = p_family
       and (c.case_type ilike 'Deliver%' or c.case_type ilike 'Replacement%')
       and lower(trim(c.status_reason)) in ('open', 'in progress', 'waiting', 'in service', 'on hold')
  ) x
  where p_pos is not null and p_family is not null
  order by created_on limit 1;
$$;

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

  -- New asset: one open request per store for the same catalogue item (COM delivery / replacement or CoolerCo request)
  if kind = 'new' and nullif(p_request ->> 'family_id', '') is not null then
    perform pg_advisory_xact_lock(hashtext('coolerco_new:' || l.pos_local_code || ':' || (p_request ->> 'family_id')));
    v_open := public.coolerco_store_open_new_request(l.pos_local_code, (p_request ->> 'family_id')::uuid);
    if v_open is not null then return jsonb_build_object('error', 'already_requested') || v_open; end if;
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
-- 2. Customer queries for staff: one row per case that has a customer message (CoolerCo and COM cases)
-- ---------------------------------------------------------------------
create or replace function public.coolerco_query_inbox(p_waiting_only boolean default true, p_limit int default 200)
returns table (case_number text, source text, case_type text, status text, point_of_sale text, pos_local_code text,
               warehouse text, priority text, is_open boolean, messages int, last_at timestamptz, last_from text,
               last_body text, waiting boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  with t as (
    select m.case_number, max(m.case_source) as case_source, count(*)::int as messages,
           (array_agg(m.author_type order by m.created_at desc))[1] as last_type,
           (array_agg(m.author_label order by m.created_at desc))[1] as last_label,
           (array_agg(m.body order by m.created_at desc))[1] as last_body,
           max(m.created_at) as last_at
      from public.coolerco_case_comments m
     where m.visibility = 'customer'
     group by m.case_number
    having bool_or(m.author_type = 'customer')
  )
  select t.case_number, case when k.case_number is not null then 'CoolerCo' else 'COM' end,
         coalesce(k.case_type, c.case_type), coalesce(k.status_reason, c.status_reason),
         coalesce(k.point_of_sale, c.point_of_sale), coalesce(k.pos_local_code, c.pos_local_code),
         coalesce(k.warehouse_workshop, c.warehouse_workshop), k.priority,
         case when k.case_number is not null then not public.coolerco_case_is_closed(k.status_reason)
              else lower(trim(coalesce(c.status_reason, ''))) in ('open', 'in progress', 'waiting', 'in service', 'on hold') end,
         t.messages, t.last_at, t.last_label, left(t.last_body, 300), t.last_type = 'customer'
    from t
    left join public.coolerco_cases k on k.case_number = t.case_number
    left join public.cases c on c.case_number = t.case_number and k.case_number is null
   where (not p_waiting_only or t.last_type = 'customer')
   order by (t.last_type = 'customer') desc, t.last_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- ---------------------------------------------------------------------
-- 3. One small call for the alarm: how much is waiting, and the newest unread alert
-- ---------------------------------------------------------------------
create or replace function public.coolerco_inbox_counts()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'alerts', (select count(*) from public.coolerco_notifications n where n.channel = 'inapp' and n.recipient_type = 'supervisor' and n.status = 'queued'),
    'urgent', (select count(*) from public.coolerco_notifications n where n.channel = 'inapp' and n.recipient_type = 'supervisor' and n.status = 'queued' and n.priority = 'High'),
    'queries', (select count(*) from public.coolerco_query_inbox(true, 500)),
    'contacts', (select count(*) from public.coolerco_contact_update_requests r where r.status = 'Pending'),
    'latest', (select jsonb_build_object('id', n.id, 'title', n.title, 'priority', n.priority, 'event', n.event_type, 'at', n.created_at)
                 from public.coolerco_notifications n
                where n.channel = 'inapp' and n.recipient_type = 'supervisor' and n.status = 'queued'
                order by n.created_at desc limit 1));
$$;

-- ---------------------------------------------------------------------
-- 4. Contact updates approved for an external client (COM): mark as captured there
-- ---------------------------------------------------------------------
create or replace function public.coolerco_contact_update_captured(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.coolerco_contact_update_requests
     set captured_at = now(), captured_by = coalesce(auth.jwt() ->> 'email', auth.uid()::text)
   where id = p_id and status = 'Approved' and capture_in_source and captured_at is null;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 5. Who may call what
-- ---------------------------------------------------------------------
revoke all on function public.coolerco_store_open_new_request(text, uuid) from public, anon;
grant execute on function public.coolerco_store_open_new_request(text, uuid) to authenticated;
revoke all on function public.coolerco_portal_submit_v2(text, jsonb) from public;
grant execute on function public.coolerco_portal_submit_v2(text, jsonb) to anon, authenticated;
revoke all on function public.coolerco_query_inbox(boolean, int) from public, anon;
grant execute on function public.coolerco_query_inbox(boolean, int) to authenticated;
revoke all on function public.coolerco_inbox_counts() from public, anon;
grant execute on function public.coolerco_inbox_counts() to authenticated;
revoke all on function public.coolerco_contact_update_captured(uuid) from public, anon;
grant execute on function public.coolerco_contact_update_captured(uuid) to authenticated;

select public.coolerco_inbox_counts() as inbox_counts;
