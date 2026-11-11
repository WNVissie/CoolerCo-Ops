-- CoolerCo-Ops · 022 · Case actions: "Open in COM" link for any COM case, Cancel for CoolerCo's own cases
-- Additive only (coolerco_ objects + reason codes). COM cases are NEVER changed — they are cancelled in COM.
-- Needs 016 (roles) and 018 (coolerco_case_is_closed). Rollback: coolerco_022_rollback.sql

-- Where a COM case opens in Dynamics (the case's own id is added at the end). Change here if Magnum's link changes.
insert into public.coolerco_settings (key, value) values
  ('com_case_url', to_jsonb('https://unilevercrm.crm4.dynamics.com/main.aspx?appid=3d1acf15-491b-eb11-a813-000d3ab8dee2&forceUCI=1&pagetype=entityrecord&etn=incident&id='::text))
on conflict (key) do nothing;

insert into public.coolerco_reason_codes (code, status, label, active, sort_order) values
  ('CAN_DUPLICATE',  'Cancelled', 'Duplicate case',                    true, 10),
  ('CAN_NOT_NEEDED', 'Cancelled', 'No longer needed',                  true, 20),
  ('CAN_FIXED',      'Cancelled', 'Resolved without a visit',          true, 30),
  ('CAN_ERROR',      'Cancelled', 'Logged in error',                   true, 40),
  ('CAN_OTHER',      'Cancelled', 'Other (see note)',                  true, 90)
on conflict (code) do nothing;

-- What can be done with a case (COM or CoolerCo)
create or replace function public.coolerco_case_actions(p_case text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k public.coolerco_cases;
  c record;
  v_url text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into k from public.coolerco_cases where case_number = p_case;
  if found then
    return jsonb_build_object('source', 'CoolerCo', 'case_number', k.case_number, 'case_type', k.case_type, 'status', k.status_reason,
      'is_open', not public.coolerco_case_is_closed(k.status_reason), 'com_case_number', k.com_case_number,
      'can_cancel', not public.coolerco_case_is_closed(k.status_reason)
                    and public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));
  end if;
  select x.case_number, x.case_type, x.status_reason, x.raw_case ->> '(Do Not Modify) Case' as com_id into c
    from public.cases x where x.case_number = p_case;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select value #>> '{}' into v_url from public.coolerco_settings where key = 'com_case_url';
  return jsonb_build_object('source', 'COM', 'case_number', c.case_number, 'case_type', c.case_type, 'status', c.status_reason,
    'is_open', c.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold'),
    'com_url', case when c.com_id ~ '^[0-9a-fA-F-]{36}$' and v_url is not null then v_url || c.com_id end,
    'can_cancel', false);
end $$;

-- Cancel one of CoolerCo's own cases (staff roles only; logged in the case history). COM cases are refused.
create or replace function public.coolerco_case_cancel(p_case text, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k public.coolerco_cases;
  v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_label text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  select label into v_label from public.coolerco_reason_codes where code = p_reason and status = 'Cancelled' and active;
  if v_label is null then return jsonb_build_object('error', 'reason_required'); end if;
  if p_reason = 'CAN_OTHER' and nullif(trim(coalesce(p_note, '')), '') is null then return jsonb_build_object('error', 'note_required'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found then
    if exists (select 1 from public.cases where case_number = p_case) then return jsonb_build_object('error', 'com_case'); end if;
    return jsonb_build_object('error', 'not_found');
  end if;
  if public.coolerco_case_is_closed(k.status_reason) then return jsonb_build_object('error', 'already_closed'); end if;
  update public.coolerco_cases set status_reason = 'Cancelled', motive = p_reason, service_closure_date = coalesce(service_closure_date, now()), updated_at = now() where case_number = p_case;
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_user_id, actor_label)
  values (p_case, 'status', k.status_reason, 'Cancelled', p_reason,
          v_label || coalesce(' · ' || nullif(left(trim(coalesce(p_note, '')), 500), ''), ''), 'user', auth.uid(), v_by);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.coolerco_case_actions(text) from public, anon;
grant execute on function public.coolerco_case_actions(text) to authenticated;
revoke all on function public.coolerco_case_cancel(text, text, text) from public, anon;
grant execute on function public.coolerco_case_cancel(text, text, text) to authenticated;
