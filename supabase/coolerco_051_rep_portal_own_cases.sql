-- ============================================================================
-- CoolerCo 051 - rep / concessionaire portal: the Cases tab also shows the cases
-- CoolerCo runs end to end (Tiger, Demo ...), next to the COM cases as before.
-- TEST first. New version of coolerco_conc_cases (same inputs and output shape;
-- rows get an extra source and sla_class). Rollback: coolerco_051_rollback.sql
-- Plain ASCII, no apostrophes in comments.
-- ============================================================================
create or replace function public.coolerco_conc_cases(p_session text, p_search text default null, p_status text default 'open',
                                                      p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; q text := nullif(trim(p_search), ''); v_assets text[];
  v_open text[] := array['open','in progress','waiting','in service','on hold','waiting for approval'];
  v_att  text[] := array['action required','approval required','error','error external'];
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  if q is not null then
    select array_agg(name) into v_assets from public.assets_live where name = q or bar_code = q or local_code = q;
    v_assets := coalesce(v_assets, array[q]);
  end if;
  return (
    with both_sources as (
      select 'COM'::text as source, c.case_number, c.case_type, c.status_reason, c.sla_status, null::text as sla_class,
             c.created_on, c.end_date, c.service_closure_date, c.point_of_sale, c.pos_local_code, c.warehouse_workshop,
             c.mapped_asset, c.asset_repaired, c.asset_removed, c.asset_delivered, c.motive, c.responsible_ordering_party
        from public.cases c
      union all
      select 'CoolerCo', k.case_number, k.case_type, k.status_reason,
             case when k.end_date is null then null
                  when public.coolerco_case_is_closed(k.status_reason) then case when coalesce(k.service_closure_date, now()) <= k.end_date then 'SLA Met' else 'SLA Not Met' end
                  when now() > k.end_date then 'Open Case SLA Not Met' else null end,
             k.sla_class,
             k.created_on, k.end_date, k.service_closure_date, k.point_of_sale, k.pos_local_code, k.warehouse_workshop,
             k.mapped_asset, k.asset_repaired, k.asset_removed, k.asset_delivered, k.motive, k.responsible_ordering_party
        from public.coolerco_cases k
       where public.coolerco_is_self_managed(k.client_code)
    ),
    mine as (
      select c.* from both_sources c
      join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party and n.concessionaire_id = s.concessionaire_id
      where public.coolerco_conc_case_type_ok(c.case_type)
        and (q is null or c.case_number ilike '%' || q || '%' or c.pos_local_code = q or c.point_of_sale ilike '%' || q || '%'
             or c.mapped_asset = any(v_assets) or c.asset_repaired = any(v_assets)
             or c.asset_removed = any(v_assets) or c.asset_delivered = any(v_assets))
        and (q is not null or lower(trim(coalesce(c.status_reason, ''))) = any(v_open || v_att) or c.created_on > now() - interval '2 months')
    ),
    hits as (
      select * from mine m
      where p_status = 'all'
         or (p_status = 'open'      and lower(trim(m.status_reason)) = any(v_open))
         or (p_status = 'attention' and lower(trim(m.status_reason)) = any(v_att))
         or (p_status = 'closed'    and not (lower(trim(coalesce(m.status_reason, ''))) = any(v_open || v_att)))
         or m.status_reason = p_status
    )
    select jsonb_build_object(
      'total', (select count(*) from hits),
      'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', st, 'n', n,
                     'group', case when lower(st) = any(v_open) then 'open' when lower(st) = any(v_att) then 'attention' else 'closed' end) order by n desc)
                   from (select coalesce(status_reason, '-') st, count(*) n from mine group by 1) x), '[]'::jsonb),
      'by_type', coalesce((select jsonb_object_agg(case_type, n) from (select case_type, count(*) n from hits group by 1) y), '{}'::jsonb),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'case_number', h.case_number, 'case_type', h.case_type, 'status', h.status_reason, 'sla', h.sla_status,
          'sla_class', h.sla_class, 'source', h.source,
          'created_on', h.created_on, 'end_date', h.end_date, 'closed', h.service_closure_date,
          'point_of_sale', h.point_of_sale, 'pos_local_code', h.pos_local_code, 'warehouse', h.warehouse_workshop,
          'asset', case when h.case_type = 'Repair at Shopper POS' then coalesce(h.asset_repaired, h.mapped_asset)
                        when h.case_type = 'Removal of Asset' then coalesce(h.asset_removed, h.mapped_asset)
                        else coalesce(h.asset_delivered, h.mapped_asset) end,
          'asset_removed', case when h.case_type = 'Replacement of Asset' then h.asset_removed end,
          'motive', h.motive,
          'comments', (select count(*) from public.coolerco_case_comments m where m.case_number = h.case_number and m.visibility <> 'internal'))
          order by h.created_on desc)
        from (select * from hits order by created_on desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) h), '[]'::jsonb))
  );
end $$;
