-- CoolerCo-Ops · 008 · Concessionaire asset base (assets at POS where responsible_ordering_party = concessionaire)
-- ADDITIVE: one new view + replaces our own coolerco_conc_context (adds assets_at_pos). COM tables only read.

-- Staff: asset base per concessionaire (server-side count, 1 row per concessionaire)
create or replace view public.coolerco_conc_asset_base as
select n.concessionaire_id,
       count(*) filter (where a.asset_location = 'Location') as assets_at_pos,
       count(*) filter (where a.asset_location = 'Workshop') as assets_in_workshop,
       count(distinct a.assign_account_local_code) filter (where a.asset_location = 'Location') as stores_with_assets
from public.assets_live a
join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
group by n.concessionaire_id;
alter view public.coolerco_conc_asset_base set (security_invoker = true);
revoke all on public.coolerco_conc_asset_base from anon;
grant select on public.coolerco_conc_asset_base to authenticated;

create or replace function public.coolerco_conc_context(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; c public.coolerco_concessionaires;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into c from public.coolerco_concessionaires where id = s.concessionaire_id;
  return jsonb_build_object(
    'concessionaire', c.display_name, 'actor', s.actor_label, 'actor_type', s.actor_type,
    'to_approve', (select count(*) from public.coolerco_cases k
                   where k.status_reason = 'Waiting for Approval' and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)),
    'to_log', (select count(*) from public.coolerco_cases k
                   where k.status_reason = 'Open' and k.com_case_number is null and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)),
    'open_com', (select count(*) from public.cases x join public.coolerco_concessionaire_names n on n.rop_name = x.responsible_ordering_party
                 where n.concessionaire_id = c.id and lower(trim(x.status_reason)) in ('open','in progress','waiting','in service','on hold')),
    'stores', (select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire where n.concessionaire_id = c.id),
    'assets_at_pos', (select count(*) from public.assets_live a join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
                      where n.concessionaire_id = c.id and a.asset_location = 'Location'),
    'assets_in_workshop', (select count(*) from public.assets_live a join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
                      where n.concessionaire_id = c.id and a.asset_location = 'Workshop')
  );
end $$;
