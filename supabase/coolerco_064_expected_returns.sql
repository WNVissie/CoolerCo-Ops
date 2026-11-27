-- CoolerCo-Ops 064 - Coolers expected back at the warehouse (TEST first). Needs 038, 057-059. Rollback: coolerco_064_rollback.sql
-- Wanda 27 Nov 2026: a not-done Delivery / Replacement (service denied, location closed / unavailable, no contact, ...) always
-- happens at the store, so the driver loaded the cooler. COM puts the case in Further Action Required (Magnum reschedules or
-- cancels to release the asset). In CoolerCo the loaded cooler must come back to the warehouse and be SCANNED at receiving -
-- the same cooler - before it counts as back in stock. Until then it is on the "Expected back" list; late = overdue;
-- a different cooler scanned for the case = wrong cooler back.
-- Before 064 the rules engine booked the cooler back straight away (CC-RETURN) on the driver's tap, and Replacement +
-- location closed / unavailable did not return it at all.
-- Plain ASCII. Add-only except: coolerco_reverse_case_movements gets a new version (old one saved in coolerco_fn_backup '064')
-- and the '*' Deliver / Replacement not-done rules get return_loaded = true (old rows saved in coolerco_rule_backup '064').

insert into public.coolerco_settings (key, value)
select 'return_scan_hours', '8'::jsonb where not exists (select 1 from public.coolerco_settings where key = 'return_scan_hours');

create table if not exists public.coolerco_expected_returns (
  id uuid primary key default gen_random_uuid(),
  case_number text not null,
  case_type text,
  client_code text,
  warehouse_code text,
  warehouse text,
  asset text not null,
  bar_code text,
  route_id uuid,
  reason text,
  status text not null default 'open' check (status in ('open', 'received', 'wrong_asset', 'cancelled')),
  expected_by timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  received_at timestamptz,
  received_by text,
  received_scan text,
  received_source text,
  note text
);
create unique index if not exists coolerco_expected_returns_open on public.coolerco_expected_returns (case_number, asset) where status in ('open', 'wrong_asset');
create index if not exists idx_cc_expected_returns_wh on public.coolerco_expected_returns (warehouse_code, status);
alter table public.coolerco_expected_returns enable row level security;
revoke all on public.coolerco_expected_returns from anon, authenticated;
grant select on public.coolerco_expected_returns to authenticated;
drop policy if exists coolerco_expected_returns_read on public.coolerco_expected_returns;
create policy coolerco_expected_returns_read on public.coolerco_expected_returns for select to authenticated
  using (public.coolerco_can_see(client_code, warehouse_code) or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()));

-- warehouse code from whatever a movement / case carries (JHB, "RTMA Gauteng", "RTMA Gauteng WH", WH-DM-JHB)
create or replace function public.coolerco_wh_code_of(p text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select w.warehouse_code from public.coolerco_warehouse_settings w
                    where w.warehouse_code = p or w.com_name = p or w.com_name = regexp_replace(coalesce(p, ''), ' (WH|WS)$', '') limit 1), p)
$$;

-- 1. the rules: every not-done Delivery / Replacement returns the loaded cooler -----------------------------------------
insert into public.coolerco_rule_backup (script, rule)
select '064', to_jsonb(r) from public.coolerco_case_rules r
 where r.client_code = '*' and r.case_type in ('Deliver an Asset', 'Replacement of Asset')
   and r.event in ('denied', 'location_closed', 'location_unavailable', 'no_contact', 'other', 'asset_missing')
   and not exists (select 1 from public.coolerco_rule_backup b where b.script = '064' and b.rule ->> 'id' = r.id::text);
update public.coolerco_case_rules set return_loaded = true, updated_at = now()
 where client_code = '*' and case_type in ('Deliver an Asset', 'Replacement of Asset')
   and event in ('denied', 'location_closed', 'location_unavailable', 'no_contact', 'other', 'asset_missing')
   and not return_loaded;

-- 2. return-now (the old behaviour) for one case + cooler, used when the cooler is scanned back -----------------------
create or replace function public.coolerco_return_loaded_now(p_case text, p_asset text, p_source text, p_wh text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; v_n int := 0; k record;
begin
  for m in select * from public.coolerco_asset_movements
            where case_number = p_case and not reversed and movement in ('pick', 'load', 'reserve')
              and (p_asset is null or asset = p_asset or bar_code = p_asset)
            order by at desc
  loop
    insert into public.coolerco_asset_movements (asset, bar_code, movement, movement_code, warehouse, case_number, case_type, client_code, asset_role,
           from_kind, from_code, to_kind, to_code, status_before, status_after, how, expected, source, reverses, by_label, at)
    values (m.asset, m.bar_code, 'return', 'CC-RETURN', m.warehouse, p_case, m.case_type, m.client_code, m.asset_role,
            m.to_kind, m.to_code, m.from_kind, m.from_code, m.status_after, m.status_before, 'scan', m.expected, p_source, m.id, 'Receiving scan', clock_timestamp());
    update public.coolerco_asset_movements set reversed = true where id = m.id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 and p_asset is not null then   -- nothing booked out in CoolerCo (picked in RouteIQ / COM): record the return itself
    select case_type, client_code, warehouse_workshop into k from public.coolerco_all_cases where case_number = p_case order by (source = 'CoolerCo') desc limit 1;
    insert into public.coolerco_asset_movements (asset, movement, movement_code, warehouse, case_number, case_type, client_code, asset_role,
           from_kind, to_kind, to_code, status_after, how, expected, source, by_label, at)
    values (p_asset, 'return', 'CC-RETURN', coalesce(p_wh, k.warehouse_workshop), p_case, k.case_type, k.client_code, 'delivered',
            'Vehicle', 'Warehouse', coalesce(p_wh, k.warehouse_workshop), 'Ready to Work', 'scan', coalesce(k.client_code, 'MAGNUM') = 'MAGNUM',
            p_source, 'Receiving scan', clock_timestamp());
    v_n := 1;
  end if;
  -- a picked register cooler (057) is no longer promised to the case
  begin
    update public.coolerco_client_picks set released_at = now(), released_by = 'Receiving scan', release_reason = 'Returned to the warehouse - case not done'
     where case_number = p_case and released_at is null and (p_asset is null or asset_number = p_asset);
  exception when undefined_table then null;
  end;
  return v_n;
end $$;
revoke all on function public.coolerco_return_loaded_now(text, text, text, text) from public, anon;

-- the loaded cooler(s) of a case go on the Expected back list
create or replace function public.coolerco_expect_return(p_case text, p_source text default 'engine')
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare k record; m record; v_n int := 0; v_reason text; v_by timestamptz;
        v_hours numeric := coalesce((select (value #>> '{}')::numeric from public.coolerco_settings where key = 'return_scan_hours'), 8);
begin
  select * into k from public.coolerco_all_cases where case_number = p_case order by (source = 'CoolerCo') desc limit 1;
  if k.case_number is null then return 0; end if;
  select coalesce(j.service_result, j.reason_code, j.outcome) into v_reason from public.coolerco_field_job_cards j
   where j.case_number = p_case order by j.created_at desc limit 1;
  v_by := public.coolerco_add_working_hours(now(), v_hours);
  for m in select distinct on (asset) asset, bar_code, warehouse, route_id from public.coolerco_asset_movements
            where case_number = p_case and not reversed and movement in ('pick', 'load', 'reserve') order by asset, at desc
  loop
    insert into public.coolerco_expected_returns (case_number, case_type, client_code, warehouse_code, warehouse, asset, bar_code, route_id, reason, expected_by)
    values (p_case, k.case_type, coalesce(k.client_code, 'MAGNUM'), public.coolerco_wh_code_of(coalesce(m.warehouse, k.warehouse_workshop)),
            coalesce(m.warehouse, k.warehouse_workshop), m.asset, m.bar_code, m.route_id, coalesce(v_reason, p_source), v_by)
    on conflict (case_number, asset) where status in ('open', 'wrong_asset') do nothing;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 and k.asset_delivered is not null then   -- picked outside CoolerCo: the case's Asset Delivered
    insert into public.coolerco_expected_returns (case_number, case_type, client_code, warehouse_code, warehouse, asset, bar_code, reason, expected_by)
    values (p_case, k.case_type, coalesce(k.client_code, 'MAGNUM'), public.coolerco_wh_code_of(k.warehouse_workshop), k.warehouse_workshop,
            k.asset_delivered, (select bar_code from public.assets_live where name = k.asset_delivered limit 1), coalesce(v_reason, p_source), v_by)
    on conflict (case_number, asset) where status in ('open', 'wrong_asset') do nothing;
    v_n := 1;
  end if;
  return v_n;
end $$;
revoke all on function public.coolerco_expect_return(text, text) from public, anon;

-- 3. the engine's "return loaded" now waits for the scan (cancel = full reverse, unchanged) -------------------------
insert into public.coolerco_fn_backup (script, fn, def)
select '064', 'coolerco_reverse_case_movements', pg_get_functiondef('public.coolerco_reverse_case_movements(text, boolean, text, uuid)'::regprocedure)
 where not exists (select 1 from public.coolerco_fn_backup where script = '064' and fn = 'coolerco_reverse_case_movements');

create or replace function public.coolerco_reverse_case_movements(p_case text, p_only_loaded boolean, p_source text, p_source_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; v_n int := 0;
begin
  if p_only_loaded then
    return public.coolerco_expect_return(p_case, p_source);   -- 064: booked back only by the receiving scan
  end if;
  for m in select * from public.coolerco_asset_movements
            where case_number = p_case and not reversed and movement not in ('reverse', 'unreserve', 'unpick', 'audit', 'return') order by at desc
  loop
    insert into public.coolerco_asset_movements (asset, bar_code, movement, movement_code, warehouse, case_number, case_type, client_code, asset_role,
           from_kind, from_code, to_kind, to_code, status_before, status_after, how, expected, source, source_id, reverses, by_label, at)
    values (m.asset, m.bar_code, 'reverse', 'CC-REVERSE', m.warehouse, p_case, m.case_type, m.client_code, m.asset_role,
            m.to_kind, m.to_code, m.from_kind, m.from_code, m.status_after, m.status_before, 'system', m.expected, p_source, null, m.id, 'CoolerCo rules', clock_timestamp());
    update public.coolerco_asset_movements set reversed = true where id = m.id;
    v_n := v_n + 1;
  end loop;
  -- a cancelled case no longer expects its cooler (it was put back by the reverse above)
  update public.coolerco_expected_returns set status = 'cancelled', note = coalesce(note || ' · ', '') || 'case cancelled' where case_number = p_case and status = 'open';
  return v_n;
end $$;

-- 4. receiving: scan / type a cooler -> the matching expected return is received and the cooler booked back -----------
create or replace function public.coolerco_expected_return_receive(p_code text, p_warehouse text default null, p_id uuid default null, p_source text default 'receiving')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(trim(coalesce(p_code, ''))); v_names text[]; r public.coolerco_expected_returns; v_by text; v_wh text := public.coolerco_wh_code_of(nullif(p_warehouse, ''));
begin
  if v_code = '' then return jsonb_build_object('matched', false, 'reason', 'no code'); end if;
  v_by := coalesce((select email from auth.users where id = auth.uid()), p_source);
  v_names := array(select name from public.assets_live where upper(v_code) in (upper(name), upper(bar_code), upper(local_code), upper(serial_number), upper(sap_number))
                   union select asset_number from public.coolerco_assets where upper(v_code) in (upper(asset_number), upper(serial_number))
                   union select v_code);
  if p_id is not null then select * into r from public.coolerco_expected_returns where id = p_id and status in ('open', 'wrong_asset');
  else
    select * into r from public.coolerco_expected_returns
     where status in ('open', 'wrong_asset') and (asset = any (v_names) or upper(bar_code) = v_code)
       and (v_wh is null or warehouse_code = v_wh)
     order by created_at limit 1;
  end if;
  if r.id is null then return jsonb_build_object('matched', false, 'code', v_code); end if;
  if not (r.asset = any (v_names) or upper(coalesce(r.bar_code, '')) = v_code) then
    -- a cooler came back for this case, but not the one that was loaded
    update public.coolerco_expected_returns set status = 'wrong_asset', received_scan = v_code, received_at = now(), received_by = v_by,
           note = coalesce(note || ' · ', '') || 'wrong cooler scanned: ' || v_code where id = r.id;
    return jsonb_build_object('matched', false, 'wrong_asset', true, 'case', r.case_number, 'expected', r.asset, 'scanned', v_code);
  end if;
  update public.coolerco_expected_returns set status = 'received', received_at = now(), received_by = v_by, received_scan = v_code, received_source = p_source
   where id = r.id;
  perform public.coolerco_return_loaded_now(r.case_number, r.asset, p_source, r.warehouse);
  return jsonb_build_object('matched', true, 'case', r.case_number, 'case_type', r.case_type, 'asset', r.asset,
                            'late', r.expected_by < now(), 'was_wrong', r.status = 'wrong_asset');
end $$;
revoke all on function public.coolerco_expected_return_receive(text, text, uuid, text) from public, anon;
grant execute on function public.coolerco_expected_return_receive(text, text, uuid, text) to authenticated;

-- office: close an entry by hand (found later, written off, case cancelled in COM ...)
create or replace function public.coolerco_expected_return_close(p_id uuid, p_status text, p_note text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  if p_status not in ('cancelled', 'open') then raise exception 'Use the scan to receive a cooler'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why'; end if;
  update public.coolerco_expected_returns set status = p_status, note = coalesce(note || ' · ', '') || p_note || ' (' || coalesce((select email from auth.users where id = auth.uid()), 'office') || ')'
   where id = p_id;
  return found;
end $$;
revoke all on function public.coolerco_expected_return_close(uuid, text, text) from public, anon;
grant execute on function public.coolerco_expected_return_close(uuid, text, text) to authenticated;

create or replace function public.coolerco_expected_returns_list(p_warehouse text default null, p_status text default 'open')
returns table (id uuid, case_number text, case_type text, client_code text, warehouse_code text, asset text, bar_code text, model text,
               route_number text, driver text, reason text, status text, expected_by timestamptz, overdue boolean, created_at timestamptz,
               received_at timestamptz, received_by text, received_scan text, note text)
language sql stable security invoker set search_path = public, pg_temp as $$
  select e.id, e.case_number, e.case_type, e.client_code, e.warehouse_code, e.asset, coalesce(e.bar_code, l.bar_code, a.asset_number),
         coalesce(l.product_base, a.model_code), r.route_number, coalesce(r.resource_display_name, r.resource_username), e.reason, e.status,
         e.expected_by, e.status = 'open' and e.expected_by < now(), e.created_at, e.received_at, e.received_by, e.received_scan, e.note
    from public.coolerco_expected_returns e
    left join public.assets_live l on l.name = e.asset
    left join public.coolerco_assets a on a.asset_number = e.asset
    left join public.routing_routes r on r.id = e.route_id
   where (p_warehouse is null or p_warehouse = '' or e.warehouse_code = public.coolerco_wh_code_of(p_warehouse))
     and (p_status = 'all' or (p_status = 'open' and e.status in ('open', 'wrong_asset')) or e.status = p_status
          or (p_status = 'today' and e.received_at >= date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'))
   order by (e.status = 'wrong_asset') desc, e.expected_by nulls last, e.created_at
   limit 1000
$$;
revoke all on function public.coolerco_expected_returns_list(text, text) from public, anon;
grant execute on function public.coolerco_expected_returns_list(text, text) to authenticated;

-- 5. a Magnum receiving / bay scan in the Scan app ticks a matching expected return off by itself -----------------------
create or replace function public.coolerco_touch_expected_return()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if exists (select 1 from public.coolerco_expected_returns where status in ('open', 'wrong_asset')
                and (asset = new.asset_name or upper(bar_code) = upper(coalesce(new.bar_code, '')))) then
      perform public.coolerco_expected_return_receive(coalesce(new.asset_name, new.bar_code), null, null, 'scan:' || coalesce(new.scan_type, 'scan'));
    end if;
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result)
    values (null, 'expected_return', 'asset_touch', jsonb_build_object('touch', new.id, 'error', sqlerrm));
  end;
  return null;
end $$;
drop trigger if exists coolerco_touch_expected_return on public.coolerco_asset_touch;
create trigger coolerco_touch_expected_return after insert on public.coolerco_asset_touch
  for each row execute function public.coolerco_touch_expected_return();

select (select count(*) from public.coolerco_case_rules where client_code = '*' and return_loaded
          and case_type in ('Deliver an Asset', 'Replacement of Asset')) rules_returning_the_loaded_cooler;
