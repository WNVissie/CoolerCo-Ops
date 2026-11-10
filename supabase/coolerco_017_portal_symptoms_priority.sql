-- CoolerCo-Ops · 017 · Customer portal: symptoms + product impact → automatic priority; repairs open without approval
-- Additive only: two NEW functions. The existing coolerco_portal_submit is NOT changed — the new one calls it,
-- so every existing check (link, daily limit, asset at store, case number) stays exactly as it is.
-- Needs 016 (symptoms, product impacts, clients, new columns). Rollback: coolerco_017_rollback.sql

-- 1. Lists for the portal's repair screen (public, link token checked)
create or replace function public.coolerco_portal_options(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.coolerco_portal_links where token = p_token and active) then
    return jsonb_build_object('error', 'invalid_link');
  end if;
  return jsonb_build_object(
    'symptoms', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label, 'ask_product', s.ask_product) order by s.sort_order, s.label)
                            from public.coolerco_symptoms s where s.active and s.show_in_portal), '[]'::jsonb),
    'impacts',  coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label) order by i.sort_order, i.label)
                            from public.coolerco_product_impacts i where i.active), '[]'::jsonb));
end $$;

-- 2. Submit with symptom + product impact.
--    · The customer never sets the priority: anything sent as "priority" is ignored; it is worked out here.
--    · Repair: symptom is required; product impact is required when the symptom asks for it.
--    · Repair opens straight away (no approval) unless the client has repair_needs_approval switched on.
create or replace function public.coolerco_portal_submit_v2(p_token text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l        public.coolerco_portal_links;
  s        public.coolerco_symptoms;
  kind     text := p_request ->> 'kind';
  v_sym    text := nullif(p_request ->> 'symptom', '');
  v_imp    text := nullif(p_request ->> 'product_impact', '');
  v_res    jsonb;
  v_no     text;
  v_pri    text;
  v_client text;
  v_needs  boolean;
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

  -- the existing function does all the checks and creates the case
  v_res := public.coolerco_portal_submit(p_token, p_request - 'priority');
  if v_res ? 'error' then return v_res; end if;
  v_no := v_res ->> 'case_number';

  v_client := coalesce(l.client_code, 'MAGNUM');
  update public.coolerco_cases set client_code = v_client where case_number = v_no;

  if kind = 'repair' then
    v_pri := public.coolerco_priority_for(v_sym, v_imp);
    update public.coolerco_cases
       set symptom_code = v_sym, product_impact = v_imp, priority = v_pri,
           priority_source = 'auto', priority_set_by = 'system', priority_set_at = now(), updated_at = now()
     where case_number = v_no;

    -- the "new request" notifications were queued a moment ago, before the priority was known
    update public.coolerco_notifications
       set priority = v_pri, client_code = v_client,
           payload = payload || jsonb_build_object('priority', v_pri, 'symptom', s.label,
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
              'Repair opened without approval · priority ' || v_pri || ' (' || s.label || ')', 'system', 'system');
      v_status := 'Open';
    end if;
  end if;

  return v_res || jsonb_build_object('status', v_status, 'priority', v_pri);
end $$;

revoke all on function public.coolerco_portal_options(text) from public;
grant execute on function public.coolerco_portal_options(text) to anon, authenticated;
revoke all on function public.coolerco_portal_submit_v2(text, jsonb) from public;
grant execute on function public.coolerco_portal_submit_v2(text, jsonb) to anon, authenticated;
