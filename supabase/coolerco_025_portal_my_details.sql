-- CoolerCo-Ops · 025 · Customer portal "👤 My details": the customer can update contact details at any time
-- (Wanda 12 Nov: "not only when he logs a call"). Additive; reuses 016's approval flow (supervisor approves in the Inbox).
-- Needs 016. Rollback: coolerco_025_rollback.sql

-- What is saved now + a change still waiting for approval (public portal, by token)
create or replace function public.coolerco_portal_contact(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l public.coolerco_portal_links; q public.coolerco_contact_update_requests;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  select * into q from public.coolerco_contact_update_requests where portal_link_id = l.id and status = 'Pending' order by created_at desc limit 1;
  return jsonb_build_object(
    'saved', jsonb_build_object('contact_name', l.contact_name, 'contact_number', l.contact_number, 'mobile_number', l.mobile_number,
      'email', l.email, 'notify_email', coalesce(l.notify_email, false), 'notify_whatsapp', coalesce(l.notify_whatsapp, false),
      'trading_hours', l.trading_hours, 'delivery_notes', l.delivery_notes),
    'pending', case when q.id is not null then jsonb_build_object('proposed', q.proposed_values, 'at', q.created_at) end,
    'last_decision', (select jsonb_build_object('status', r.status, 'at', r.decided_at, 'note', r.decision_note)
                        from public.coolerco_contact_update_requests r where r.portal_link_id = l.id and r.status <> 'Pending'
                       order by r.decided_at desc nulls last limit 1));
end $$;

-- Save "My details": a new change request, or — if one is still waiting — update that one (no "already pending" dead end)
create or replace function public.coolerco_portal_update_details(p_token text, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.coolerco_portal_links; q public.coolerco_contact_update_requests; v jsonb;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  -- only these fields; at most 300 characters each; only real changes against what is saved
  select coalesce(jsonb_object_agg(key, case when jsonb_typeof(value) = 'boolean' then value else to_jsonb(left(trim(value #>> '{}'), 300)) end), '{}'::jsonb) into v
    from jsonb_each(coalesce(p_values, '{}'::jsonb))
   where key in ('contact_name', 'contact_number', 'mobile_number', 'email', 'trading_hours', 'delivery_notes', 'notify_email', 'notify_whatsapp')
     and (case key when 'contact_name' then l.contact_name when 'contact_number' then l.contact_number when 'mobile_number' then l.mobile_number
                   when 'email' then l.email when 'trading_hours' then l.trading_hours when 'delivery_notes' then l.delivery_notes
                   when 'notify_email' then coalesce(l.notify_email, false)::text when 'notify_whatsapp' then coalesce(l.notify_whatsapp, false)::text end)
         is distinct from (value #>> '{}');
  if v = '{}'::jsonb then return jsonb_build_object('error', 'nothing_to_change'); end if;
  if (v ->> 'email') is not null and (v ->> 'email') <> '' and (v ->> 'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error', 'bad_email'); end if;
  select * into q from public.coolerco_contact_update_requests where portal_link_id = l.id and status = 'Pending' order by created_at desc limit 1 for update;
  if found then
    update public.coolerco_contact_update_requests set proposed_values = q.proposed_values || v where id = q.id;
    return jsonb_build_object('ok', true, 'request_id', q.id, 'updated', true);
  end if;
  return public.coolerco_portal_propose_contact(p_token, v);
end $$;

grant execute on function public.coolerco_portal_contact(text) to anon, authenticated;
grant execute on function public.coolerco_portal_update_details(text, jsonb) to anon, authenticated;
