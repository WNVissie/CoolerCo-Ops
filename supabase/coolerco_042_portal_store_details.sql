-- ============================================================================
-- CoolerCo 042 — Customer portal: "My store" details at any time
-- Run on: TEST first (🟢[TEST] RTMA_Ops). Production only when Wanda says so.
-- Needs:  016 (portal link columns, contact update requests).
-- Adds:   one read function for the public portal. Nothing existing is changed.
-- Rollback: coolerco_042_rollback.sql
--
-- The portal's "🏪 My store" tab shows the store's saved details (contact, numbers,
-- email, trading hours, delivery notes, how to be notified) and any change still
-- waiting for a supervisor. Saving uses the existing coolerco_portal_update_details,
-- which sends the change to the Inbox for approval (nothing changes until approved).
-- ============================================================================

create or replace function public.coolerco_portal_store_details(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l public.coolerco_portal_links; q public.coolerco_contact_update_requests;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  select * into q from public.coolerco_contact_update_requests
   where portal_link_id = l.id and status = 'Pending' order by created_at desc limit 1;
  return jsonb_build_object(
    'pos_local_code',  l.pos_local_code,
    'point_of_sale',   l.point_of_sale,
    'contact_name',    l.contact_name,
    'contact_number',  l.contact_number,
    'mobile_number',   l.mobile_number,
    'email',           l.email,
    'trading_hours',   l.trading_hours,
    'delivery_notes',  l.delivery_notes,
    'notify_email',    coalesce(l.notify_email, false),
    'notify_whatsapp', coalesce(l.notify_whatsapp, false),
    'pending',         case when q.id is null then null else q.proposed_values end,
    'pending_since',   q.created_at);
end $$;

revoke all on function public.coolerco_portal_store_details(text) from public;
grant execute on function public.coolerco_portal_store_details(text) to anon, authenticated;
