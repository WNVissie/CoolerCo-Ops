-- 061 · Region / rep portal for self-managed clients (Demo, Demo Foods, Tiger) — Wanda 25 Nov:
-- "Log in COM" must not show for Demo customers. Their approved requests ARE the case (CoolerCo is the system of record).
-- • coolerco_conc_context: new key self_managed; to_log counts only COM-client cases; for self-managed clients the
--   cooler / open case / needs-action counts come from CoolerCo's own register (coolerco_assets / coolerco_cases).
-- • coolerco_conc_requests view 'to_log': COM-client cases only.
-- Replaces two portal functions only; no tables touched. Rollback: coolerco_061_rollback.sql.

-- keep the current versions so the rollback can put them back
insert into public.coolerco_fn_backup (script, fn, def, saved_at)
select '061', p.proname, pg_get_functiondef(p.oid), now()
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('coolerco_conc_context', 'coolerco_conc_requests')
   and not exists (select 1 from public.coolerco_fn_backup b where b.script = '061' and b.fn = p.proname);

create or replace function public.coolerco_conc_context(p_session text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare s public.coolerco_conc_sessions; c public.coolerco_concessionaires; v_self boolean;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into c from public.coolerco_concessionaires where id = s.concessionaire_id;
  v_self := coalesce(public.coolerco_is_self_managed(c.client_code), false);
  return jsonb_build_object(
    'concessionaire', c.display_name, 'actor', s.actor_label, 'actor_type', s.actor_type,
    'client_code', c.client_code, 'self_managed', v_self,
    'to_approve', (select count(*) from public.coolerco_cases k
                   where k.status_reason = 'Waiting for Approval' and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)),
    'to_log', (select count(*) from public.coolerco_cases k
                   where k.status_reason = 'Open' and k.com_case_number is null
                     and not coalesce(public.coolerco_is_self_managed(k.client_code), false)
                     and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)),
    'open_com', case when v_self then
                  (select count(*) from public.coolerco_cases k
                    where k.client_code = c.client_code and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)
                      and public.coolerco_conc_case_type_ok(k.case_type)
                      and lower(trim(k.status_reason)) in ('open','in progress','waiting','in service','on hold'))
                else
                  (select count(*) from public.cases x join public.coolerco_concessionaire_names n on n.rop_name = x.responsible_ordering_party
                    where n.concessionaire_id = c.id and public.coolerco_conc_case_type_ok(x.case_type)
                      and lower(trim(x.status_reason)) in ('open','in progress','waiting','in service','on hold')) end,
    'attention_com', case when v_self then
                  (select count(*) from public.coolerco_cases k
                    where k.client_code = c.client_code and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)
                      and public.coolerco_conc_case_type_ok(k.case_type)
                      and lower(trim(k.status_reason)) in ('action required','approval required','error','error external'))
                else
                  (select count(*) from public.cases x join public.coolerco_concessionaire_names n on n.rop_name = x.responsible_ordering_party
                    where n.concessionaire_id = c.id and public.coolerco_conc_case_type_ok(x.case_type)
                      and lower(trim(x.status_reason)) in ('action required','approval required','error','error external')) end,
    'stores', (select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire
                where n.concessionaire_id = coalesce(c.parent_id, c.id) and public.coolerco_conc_owns_pos(c.id, w.pos_local_code)),
    'assets_at_pos', case when v_self then
                  (select count(*) from public.coolerco_assets a
                    where a.client_code = c.client_code and a.location_type = 'Outlet' and public.coolerco_conc_owns_pos(c.id, a.location_code))
                else
                  (select count(*) from public.assets_live a join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
                    where n.concessionaire_id = c.id and a.asset_location = 'Location') end,
    'assets_in_workshop', case when v_self then 0 else
                  (select count(*) from public.assets_live a join public.coolerco_concessionaire_names n on n.rop_name = a.responsible_ordering_party
                    where n.concessionaire_id = c.id and a.asset_location = 'Workshop') end
  );
end $function$;

create or replace function public.coolerco_conc_requests(p_session text, p_view text default 'waiting'::text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare s public.coolerco_conc_sessions;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  return coalesce((
    select jsonb_agg(r order by (r->>'created_on') desc) from (
    select jsonb_build_object(
      'case_number', k.case_number, 'case_type', k.case_type, 'status', k.status_reason, 'created_on', k.created_on,
      'point_of_sale', k.point_of_sale, 'pos_local_code', k.pos_local_code, 'warehouse', k.warehouse_workshop,
      'contact', k.case_contact_name, 'phone', coalesce(k.case_mobile_number, k.case_contact_number),
      'description', k.description, 'photos', coalesce(array_length(k.photo_paths, 1), 0),
      'asset', k.mapped_asset, 'barcode', a.bar_code, 'local_code', a.local_code, 'product', a.product_base, 'condition', a.condition,
      'family', coalesce(f.display_name, f.name), 'com_case_number', k.com_case_number, 'approved_by', k.approved_by, 'approved_at', k.approved_at,
      'end_date', k.end_date, 'motive', k.motive, 'self_managed', coalesce(public.coolerco_is_self_managed(k.client_code), false),
      'comments', (select count(*) from public.coolerco_case_comments m where m.case_number = k.case_number and m.visibility <> 'internal')) r
    from public.coolerco_cases k
    left join lateral (select bar_code, local_code, product_base, condition from public.assets_live where name = k.mapped_asset limit 1) a on true
    left join public.coolerco_product_families f on f.id = k.requested_family_id
    where public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code)
      and (p_view = 'all'
           or (p_view = 'waiting' and k.status_reason = 'Waiting for Approval')
           or (p_view = 'to_log'  and k.status_reason = 'Open' and k.com_case_number is null
                                  and not coalesce(public.coolerco_is_self_managed(k.client_code), false))
           or (p_view = 'done'    and k.status_reason not in ('Waiting for Approval','Open')))
    order by k.created_on desc
    limit 300) t), '[]'::jsonb);
end $function$;
