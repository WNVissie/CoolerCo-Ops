-- 058 · Office close + client cancel for self-managed clients (Tiger, Demo, Demo Foods …) — Wanda 2026-11-25
-- "A driver's phone can be down, broken or out of data: the warehouse must always be able to close, the client to cancel.
--  Closing uses the same reasons and rules as the job card / COM rules."
-- Decisions (25 Nov):
--   * Removal + Replacement: Location closed / Location unavailable → Action Required (as Deliver)
--   * job-card reasons without a rule (Asset missing, Incorrect asset details, No contact, No stock, Repair needs the workshop, Other)
--     → Action Required; "Ran out of time" → case stays open (carried over)
--   * office close: warehouse + office roles (system_admin, administrator, manager, supervisor, supplier, stock_controller, warehouse_assistant);
--     why the office closes is required; logged with who / when
--   * client may cancel any time while open; a case cancelled while on a route is marked "cancelled on route"
--     (route number kept) because on-route cancellations are charged differently
-- Also fixes: the rules engine looked coolers up only in COM's list, so Demo / Tiger coolers got no movements.
--   Now CoolerCo-master cases keep their register asset number, and every movement of a register cooler updates
--   coolerco_assets (where it is + status). Reversals (cancel) put it back.
-- Needs 038/039 (rules engine) and 057 (client picking). Add-only. Rollback: coolerco_058_rollback.sql.

-- ── 1. rules (data) ──────────────────────────────────────────────────────────────────────────
insert into public.coolerco_case_rules (client_code, case_type, event, notification, case_status, note)
select '*', t, e, n, 'Action Required', 'Added 058 (Wanda 25 Nov)'
  from (values ('Removal of Asset'), ('Replacement of Asset')) a(t),
       (values ('location_closed', 'LOCATION CLOSED'), ('location_unavailable', 'LOCATION UNAVAILABLE')) b(e, n)
on conflict (client_code, case_type, event) do nothing;

insert into public.coolerco_case_rules (client_code, case_type, event, notification, case_status, note)
select '*', t, e, null, 'Action Required', 'Added 058: reason without a COM notification - see the case notes'
  from (values ('Deliver an Asset'), ('Removal of Asset'), ('Replacement of Asset'), ('Repair at Shopper POS'), ('Repair at Workshop'), ('Decal @WH')) a(t),
       (values ('other'), ('asset_missing')) b(e)
on conflict (client_code, case_type, event) do nothing;

-- "Ran out of time" = carried over: its own event without a rule, so the case stays as it is
update public.coolerco_event_codes set event = 'no_time' where code = 'NO_TIME';

-- ── 2. cancel on route: columns ─────────────────────────────────────────────────────────────
alter table public.coolerco_cases add column if not exists cancelled_on_route boolean;
alter table public.coolerco_cases add column if not exists cancelled_route text;
alter table public.coolerco_cases add column if not exists cancelled_by_role text;

-- ── 3. engine: keep register asset numbers for CoolerCo-master cases (patched in place, old version saved) ──
create table if not exists public.coolerco_fn_backup (script text, fn text, def text not null, saved_at timestamptz not null default now(), primary key (script, fn));
alter table public.coolerco_fn_backup enable row level security;
revoke all on public.coolerco_fn_backup from anon, authenticated;
insert into public.coolerco_fn_backup (script, fn, def)
select '058', p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
 where p.proname in ('coolerco_case_apply_event', 'coolerco_case_cancel')
on conflict (script, fn) do nothing;

do $patch$
declare d text; n int;
begin
  select def into d from public.coolerco_fn_backup where script = '058' and fn = 'coolerco_case_apply_event';
  n := (length(d) - length(replace(d, 'v_asset is not null and v_asset !~ ''^AST''', ''))) / length('v_asset is not null and v_asset !~ ''^AST''');
  if n = 0 and position('not v_coolerco and v_asset' in d) > 0 then return; end if; -- already patched
  if n < 2 then raise exception '058: engine text not as expected (% matches) - nothing changed', n; end if;
  d := replace(d, 'v_asset is not null and v_asset !~ ''^AST''', 'v_asset is not null and not v_coolerco and v_asset !~ ''^AST''');
  execute d;
end $patch$;

-- ── 4. register follows the movement ledger (Demo / Tiger coolers) ──────────────────────────
create or replace function public.coolerco_register_status(p_status text, p_old text)
returns text language sql immutable as $$
  select case p_status when 'Assigned' then 'At outlet' when 'To be Repaired' then 'In warehouse, awaiting repair'
                       when 'In Transit' then 'In transit to warehouse' when 'Ready to Work' then 'In warehouse, ready to work'
                       else coalesce(p_status, p_old) end
$$;

-- before: a forward movement takes "from" + status_before from the register (the truth for these clients)
create or replace function public.coolerco_trg_register_move_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.coolerco_assets;
begin
  if new.source = 'client_picking' or new.movement in ('reverse', 'return', 'unpick') or new.client_code is null then return new; end if;
  select * into a from public.coolerco_assets where client_code = new.client_code and asset_number = new.asset;
  if found then
    new.from_kind := case a.location_type when 'Outlet' then 'Location' else 'Warehouse' end;
    new.from_code := a.location_code;
    new.status_before := a.status;
  end if;
  return new;
exception when others then return new; -- never block a movement
end $$;

-- after: the register cooler moves (outlet / warehouse) and gets its new status
create or replace function public.coolerco_trg_register_move_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.coolerco_assets; v_kind text := lower(coalesce(new.to_kind, '')); v_wh text; v_loc text; v_code text;
begin
  if new.source = 'client_picking' or new.client_code is null then return null; end if;
  select * into a from public.coolerco_assets where client_code = new.client_code and asset_number = new.asset;
  if not found then return null; end if;
  select warehouse_code into v_wh from public.coolerco_cases where case_number = new.case_number;
  if new.movement = 'status' then v_loc := a.location_type; v_code := a.location_code;
  elsif v_kind in ('location', 'outlet') then v_loc := 'Outlet'; v_code := coalesce(nullif(new.to_code, ''), a.location_code);
  elsif v_kind in ('warehouse', 'workshop', 'vehicle', 'picked') then
    v_loc := 'Warehouse';
    v_code := case when new.movement in ('reverse', 'return') and lower(coalesce(new.to_kind, '')) = 'warehouse' and new.to_code is not null
                        and exists (select 1 from public.warehouses w where w.code = new.to_code) then new.to_code
                   else coalesce(a.warehouse_code, v_wh, a.location_code) end;
  else v_loc := a.location_type; v_code := a.location_code; end if;
  update public.coolerco_assets
     set location_type = v_loc, location_code = v_code,
         status = public.coolerco_register_status(new.status_after, a.status),
         updated_at = now(), updated_by = coalesce(new.by_label, 'CoolerCo rules')
   where id = a.id;
  return null;
exception when others then
  begin insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, 'register_move', new.source, jsonb_build_object('error', sqlerrm, 'asset', new.asset)); exception when others then null; end;
  return null;
end $$;

drop trigger if exists coolerco_register_move_before on public.coolerco_asset_movements;
create trigger coolerco_register_move_before before insert on public.coolerco_asset_movements
  for each row execute function public.coolerco_trg_register_move_before();
drop trigger if exists coolerco_register_move_after on public.coolerco_asset_movements;
create trigger coolerco_register_move_after after insert on public.coolerco_asset_movements
  for each row execute function public.coolerco_trg_register_move_after();

-- ── 5. who may do what ──────────────────────────────────────────────────────────────────────
create or replace function public.coolerco_can_office_close()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_is_planner()
      or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier', 'stock_controller', 'warehouse_assistant'])
$$;

-- the route a case is on right now (finalised or further), if any
create or replace function public.coolerco_case_on_route(p_case text)
returns table (route_id uuid, route_number text, route_date date)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.route_number, r.route_date
    from public.routing_route_stops s
    join public.routing_route_versions v on v.id = s.route_version_id and v.is_current
    join public.routing_routes r on r.id = s.route_id
   where s.case_number = p_case and coalesce(s.outcome_status, '') <> 'removed'
     and coalesce(r.status, '') not in ('not_used', 'cancelled', 'suggested', 'saved_draft')
   order by r.route_date desc limit 1
$$;

-- ── 6. what the office can choose for one case (outcomes from the rules + job-card reasons) ──
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
  -- completed (+ partial where the client has it)
  for r in select * from public.coolerco_case_rules x where x.active and x.allowed and x.case_type = k.case_type and x.event in ('completed', 'partial')
             and x.client_code in (k.client_code, '*') order by x.event, (x.client_code = '*') loop
    if v_out @> jsonb_build_array(jsonb_build_object('key', r.event)) then continue; end if;
    v_out := v_out || jsonb_build_object('key', r.event, 'kind', 'done',
      'label', case r.event when 'completed' then coalesce(initcap(lower(r.notification)), 'Service complete') else 'Partly done (new delivered, old not collected)' end,
      'status', r.case_status, 'follow_up', r.follow_up_case_type, 'needs_approval', r.needs_approval);
  end loop;
  -- not done: every active job-card reason, with what it does to this case type
  for f in select fr.code, fr.label, fr.needs_note, coalesce(ec.event, 'other') ev
             from public.coolerco_field_reasons fr left join public.coolerco_event_codes ec on ec.code = fr.code
            where fr.active order by fr.sort_order loop
    select * into r from public.coolerco_case_rules x where x.active and x.case_type = k.case_type and x.event = f.ev
       and x.client_code in (k.client_code, '*') order by (x.client_code = '*') limit 1;
    v_out := v_out || jsonb_build_object('key', f.code, 'kind', 'not_done', 'label', f.label, 'needs_note', f.needs_note, 'event', f.ev,
      'status', case when r.id is null then null else r.case_status end, 'follow_up', r.follow_up_case_type);
  end loop;
  return jsonb_build_object(
    'case', k.case_number, 'case_type', k.case_type, 'status', k.status_reason, 'open', v_open,
    'can_close', v_open and k.status_reason <> 'Waiting for Approval' and public.coolerco_can_office_close(),
    'can_cancel', v_open and (public.coolerco_can_office_close() or public.coolerco_has_role(array['client'])),
    'on_route', case when rt.route_id is null then null else jsonb_build_object('route', rt.route_number, 'date', rt.route_date) end,
    'asset_delivered', k.asset_delivered, 'asset_removed', k.asset_removed, 'asset_repaired', coalesce(k.asset_repaired, k.mapped_asset),
    'requested_model', k.requested_product_base,
    'needs_delivered', k.case_type in ('Deliver an Asset', 'Replacement of Asset'),
    'needs_removed', k.case_type in ('Removal of Asset', 'Replacement of Asset'),
    'outcomes', v_out,
    'cancel_reasons', (select jsonb_agg(jsonb_build_object('code', code, 'label', label) order by code) from public.coolerco_reason_codes where status = 'Cancelled' and active));
end $$;

-- ── 7. office close: same outcome as a driver's job card ───────────────────────────────────
-- p_result = 'completed' | 'partial' | a job-card reason code (STORE_CLOSED, SERVICE_DENIED …)
create or replace function public.coolerco_case_office_close(p_case text, p_result text, p_why text, p_note text default null,
                                                             p_delivered text default null, p_removed text default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; v_event text; v_res jsonb; v_pick jsonb; v_notes text; v_by text := coalesce(auth.jwt() ->> 'email', 'user');
        v_rem text := nullif(upper(trim(coalesce(p_removed, ''))), ''); v_label text; v_need boolean;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_can_office_close() then return jsonb_build_object('error', 'not_allowed'); end if;
  if nullif(trim(coalesce(p_why, '')), '') is null then return jsonb_build_object('error', 'why_required'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found or not public.coolerco_is_self_managed(k.client_code) then return jsonb_build_object('error', 'not_found'); end if;
  if not public.coolerco_can_see(k.client_code, k.warehouse_code) then return jsonb_build_object('error', 'not_allowed'); end if;
  if public.coolerco_case_is_closed(k.status_reason) then return jsonb_build_object('error', 'already_closed', 'status', k.status_reason); end if;
  if k.status_reason = 'Waiting for Approval' then return jsonb_build_object('error', 'not_approved'); end if;
  if p_at is not null and p_at > now() + interval '5 minutes' then return jsonb_build_object('error', 'future_time'); end if;

  if p_result in ('completed', 'partial') then
    v_event := p_result;
    -- a delivery needs its cooler: the picked one, or the one typed here (picked now, with the office reason)
    if k.case_type in ('Deliver an Asset', 'Replacement of Asset') and k.asset_delivered is null then
      if nullif(trim(coalesce(p_delivered, '')), '') is null then return jsonb_build_object('error', 'delivered_required'); end if;
      v_pick := public.coolerco_client_pick_select(p_case, p_delivered, null, 'typed', 'Office close: ' || trim(p_why));
      if v_pick ? 'error' then return v_pick || jsonb_build_object('step', 'pick'); end if;
      select * into k from public.coolerco_cases where case_number = p_case;
    end if;
    if p_result = 'completed' and k.case_type in ('Removal of Asset', 'Replacement of Asset') then
      if coalesce(v_rem, k.asset_removed) is null then return jsonb_build_object('error', 'removed_required'); end if;
      if v_rem is not null and v_rem is distinct from k.asset_removed then
        if not exists (select 1 from public.coolerco_assets where client_code = k.client_code and asset_number = v_rem) then
          return jsonb_build_object('error', 'removed_not_found', 'asset', v_rem); end if;
        update public.coolerco_cases set asset_removed = v_rem, updated_at = now() where case_number = p_case;
      end if;
    end if;
    v_label := case p_result when 'completed' then 'Completed' else 'Partly done' end;
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

  -- delivered: the pick has done its job (the cooler is at the store now)
  if v_event in ('completed', 'partial') then
    update public.coolerco_client_picks set released_at = now(), released_by = v_by, release_reason = 'Delivered (office close)'
     where case_number = p_case and released_at is null;
  end if;
  return jsonb_build_object('ok', true, 'event', v_event, 'engine', v_res,
                            'status', (select status_reason from public.coolerco_cases where case_number = p_case));
end $$;

-- ── 8. cancel: + supervisor + client users; picked cooler released; "cancelled on route" kept ──
create or replace function public.coolerco_case_cancel(p_case text, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text); v_label text; rt record; v_role text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select label into v_label from public.coolerco_reason_codes where code = p_reason and status = 'Cancelled' and active;
  if v_label is null then return jsonb_build_object('error', 'reason_required'); end if;
  if p_reason = 'CAN_OTHER' and nullif(trim(coalesce(p_note, '')), '') is null then return jsonb_build_object('error', 'note_required'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found then
    if exists (select 1 from public.cases where case_number = p_case) then return jsonb_build_object('error', 'com_case'); end if;
    return jsonb_build_object('error', 'not_found');
  end if;
  v_role := case when public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']) then 'office'
                 when public.coolerco_can_office_close() then 'warehouse'
                 when public.coolerco_has_role(array['client']) then 'client' end;
  if v_role is null or not public.coolerco_can_see(k.client_code, k.warehouse_code) then return jsonb_build_object('error', 'not_allowed'); end if;
  if public.coolerco_case_is_closed(k.status_reason) then return jsonb_build_object('error', 'already_closed'); end if;
  select * into rt from public.coolerco_case_on_route(p_case);
  -- a picked cooler goes back to Ready to Work first (057)
  if exists (select 1 from public.coolerco_client_picks where case_number = p_case and released_at is null) then
    perform public.coolerco_client_pick_undo(p_case, 'Case cancelled');
  end if;
  update public.coolerco_cases set status_reason = 'Cancelled', motive = p_reason, service_closure_date = coalesce(service_closure_date, now()),
         cancelled_on_route = rt.route_id is not null, cancelled_route = rt.route_number, cancelled_by_role = v_role, updated_at = now()
   where case_number = p_case;
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_user_id, actor_label)
  values (p_case, 'status', k.status_reason, 'Cancelled', p_reason,
          v_label || case when rt.route_id is not null then ' · CANCELLED ON ROUTE ' || rt.route_number || ' (' || rt.route_date || ')' else '' end
                  || coalesce(' · ' || nullif(left(trim(coalesce(p_note, '')), 500), ''), ''), v_role, auth.uid(), v_by);
  return jsonb_build_object('ok', true, 'on_route', rt.route_number, 'by', v_role);
end $$;

revoke all on function public.coolerco_register_status(text, text) from public, anon;
revoke all on function public.coolerco_can_office_close() from public, anon;
revoke all on function public.coolerco_case_on_route(text) from public, anon;
revoke all on function public.coolerco_case_close_options(text) from public, anon;
revoke all on function public.coolerco_case_office_close(text, text, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.coolerco_case_cancel(text, text, text) from public, anon;
grant execute on function public.coolerco_can_office_close() to authenticated;
grant execute on function public.coolerco_case_on_route(text) to authenticated;
grant execute on function public.coolerco_case_close_options(text) to authenticated;
grant execute on function public.coolerco_case_office_close(text, text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.coolerco_case_cancel(text, text, text) to authenticated;
