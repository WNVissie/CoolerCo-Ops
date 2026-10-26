-- CoolerCo-Ops · 009 · Concessionaire portal shows only POS-facing cases (no warehouse cases) + status counts
-- Shown:  Repair at Shopper POS · Deliver an Asset · Replacement of Asset · Removal of Asset
-- Hidden: Repair at Workshop · Decal @WH · Receive Asset · Scrap an Asset · Prepare Asset
-- Status views: open (Open, In Progress, Waiting, In Service, On Hold) · attention (Action Required, Approval Required,
-- Error, Error External) · closed (last 2 months) · all · or one exact status. Replaces our own functions only.

create or replace function public.coolerco_conc_case_type_ok(p_type text)
returns boolean language sql immutable as $$
  select p_type in ('Repair at Shopper POS', 'Deliver an Asset', 'Replacement of Asset', 'Removal of Asset')
$$;

create or replace function public.coolerco_conc_cases(p_session text, p_search text default null, p_status text default 'open', p_limit int default 50, p_offset int default 0)
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
        -- without a search: only live work + the last 2 months
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
                   from (select coalesce(status_reason, '—') st, count(*) n from mine group by 1) x), '[]'::jsonb),
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

-- Header counts: same case types
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
                 where n.concessionaire_id = c.id and public.coolerco_conc_case_type_ok(x.case_type)
                   and lower(trim(x.status_reason)) in ('open','in progress','waiting','in service','on hold')),
    'attention_com', (select count(*) from public.cases x join public.coolerco_concessionaire_names n on n.rop_name = x.responsible_ordering_party
                 where n.concessionaire_id = c.id and public.coolerco_conc_case_type_ok(x.case_type)
                   and lower(trim(x.status_reason)) in ('action required','approval required','error','error external')),
    'stores', (select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire where n.concessionaire_id = c.id),
    'assets_at_pos', (select count(*) from public.assets_live a join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
                      where n.concessionaire_id = c.id and a.asset_location = 'Location'),
    'assets_in_workshop', (select count(*) from public.assets_live a join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
                      where n.concessionaire_id = c.id and a.asset_location = 'Workshop')
  );
end $$;

-- Comments: COM cases only if they are a shown case type
create or replace function public.coolerco_conc_comments(p_session text, p_case text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; ok boolean;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select exists (select 1 from public.cases c join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party
                 where c.case_number = p_case and n.concessionaire_id = s.concessionaire_id and public.coolerco_conc_case_type_ok(c.case_type))
      or exists (select 1 from public.coolerco_cases k where k.case_number = p_case and public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code))
    into ok;
  if not ok then return jsonb_build_object('error', 'not_found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('who', m.author_label, 'type', m.author_type, 'body', m.body, 'at', m.created_at) order by m.created_at)
    from public.coolerco_case_comments m where m.case_number = p_case and m.visibility <> 'internal'), '[]'::jsonb);
end $$;

create or replace function public.coolerco_conc_add_comment(p_session text, p_case text, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; v_src text;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  if nullif(trim(p_body), '') is null then return jsonb_build_object('error', 'empty'); end if;
  if exists (select 1 from public.coolerco_cases k where k.case_number = p_case and public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code)) then v_src := 'CoolerCo';
  elsif exists (select 1 from public.cases c join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party
                where c.case_number = p_case and n.concessionaire_id = s.concessionaire_id and public.coolerco_conc_case_type_ok(c.case_type)) then v_src := 'COM';
  else return jsonb_build_object('error', 'not_found'); end if;
  insert into public.coolerco_case_comments (case_number, case_source, author_type, author_label, concessionaire_id, body)
  values (p_case, v_src, s.actor_type, s.actor_label, s.concessionaire_id, left(trim(p_body), 2000));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.coolerco_conc_case_type_ok(text) from public, anon;
grant execute on function public.coolerco_conc_case_type_ok(text) to authenticated;
