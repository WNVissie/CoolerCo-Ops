-- CoolerCo 051 rollback: the rep portal Cases tab shows COM cases only again (version from 009).
create or replace function public.coolerco_conc_cases(p_session text, p_search text default null, p_status text default 'open',
                                                      p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; q text := nullif(trim(p_search), ''); v_assets text[];
  v_open text[] := array['open','in progress','waiting','in service','on hold'];
  v_att  text[] := array['action required','approval required','error','error external'];
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  if q is not null then
    select array_agg(name) into v_assets from public.assets_live where name = q or bar_code = q or local_code = q;
    v_assets := coalesce(v_assets, array[q]);
  end if;
  return (
    with mine as (
      select c.* from public.cases c
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
