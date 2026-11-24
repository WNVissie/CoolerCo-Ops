-- coolerco_053_model_catalogue.sql
-- Catalogue for clients CoolerCo manages end to end (Tiger, Demo, Demo Foods):
-- a photo, friendly name, short description, order and "show on portal" per model.
-- Used by the New case screen (staff) and the customer portal (same catalogue).
-- Add-only: new columns on coolerco_asset_models; new version of coolerco_portal_context
-- (same as 050, models now carry their photo and the portal tick). Magnum is unchanged.
-- Rollback: coolerco_053_rollback.sql

alter table public.coolerco_asset_models
  add column if not exists photo_path text,
  add column if not exists display_name text,
  add column if not exists portal_description text,
  add column if not exists show_in_portal boolean not null default true,
  add column if not exists sort_order int not null default 100;

create or replace function public.coolerco_portal_context(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.coolerco_portal_links; pw public.coolerco_pos_warehouse; mode text; r jsonb; v_self boolean;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  update public.coolerco_portal_links set last_used_at = now() where id = l.id;
  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;
  select value #>> '{}' into mode from public.coolerco_settings where key = 'portal_catalogue_mode';
  v_self := public.coolerco_is_self_managed(l.client_code);
  r := jsonb_build_object(
    'pos', jsonb_build_object('code', l.pos_local_code, 'name', coalesce(l.point_of_sale, pw.point_of_sale),
                              'concessionaire', pw.concessionaire, 'warehouse', pw.warehouse_code),
    'contact', jsonb_build_object('name', l.contact_name, 'phone', coalesce(l.mobile_number, l.contact_number)),
    'otp_required', l.otp_required,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('case_number', c.case_number, 'case_type', c.case_type, 'status', c.status_reason,
                                          'created_on', c.created_on, 'asset', coalesce(c.asset_repaired, c.asset_removed, c.mapped_asset))
                       order by c.created_on desc)
      from (select * from public.coolerco_cases where pos_local_code = l.pos_local_code order by created_on desc limit 20) c), '[]'::jsonb),
    'open_cases', coalesce((
      select jsonb_agg(o order by o->>'created_on' desc) from (
        select jsonb_build_object('source', 'COM', 'case_number', c.case_number, 'case_type', c.case_type,
                                  'status', c.status_reason, 'created_on', c.created_on,
                                  'assets', to_jsonb(array_remove(array[c.asset_repaired, c.asset_removed, c.asset_delivered, c.mapped_asset], null))) o
        from public.cases c
        where not v_self and c.pos_local_code = l.pos_local_code
          and lower(trim(c.status_reason)) in ('open','in progress','waiting','in service','on hold')
        union all
        select jsonb_build_object('source', 'CoolerCo', 'case_number', k.case_number, 'case_type', k.case_type,
                                  'status', k.status_reason, 'created_on', k.created_on,
                                  'assets', to_jsonb(array_remove(array[k.asset_repaired, k.asset_removed, k.asset_delivered, k.mapped_asset], null)))
        from public.coolerco_cases k
        where k.pos_local_code = l.pos_local_code
          and not public.coolerco_case_is_closed(k.status_reason)
      ) x(o)
    ), '[]'::jsonb));

  if v_self then
    r := r || jsonb_build_object(
      'assets', coalesce((
        select jsonb_agg(jsonb_build_object('asset', a.asset_number, 'barcode', a.asset_number, 'local_code', a.serial_number,
                 'product', coalesce(m.description, a.model_code), 'family', coalesce(m.product_family, m.description),
                 'family_name', m.product_family, 'photo', m.photo_path, 'type', m.asset_type, 'condition', a.condition) order by m.description, a.asset_number)
          from public.coolerco_assets a
          left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
         where a.client_code = l.client_code and a.location_type = 'Outlet' and a.location_code = l.pos_local_code), '[]'::jsonb),
      'catalogue', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.model_code, 'model_code', m.model_code, 'name', coalesce(m.display_name, m.description),
                 'description', coalesce(m.portal_description, concat_ws(' / ', m.product_family, m.capacity_litres || ' L')),
                 'type', m.asset_type, 'photo', m.photo_path)
                 order by m.sort_order, m.asset_type, m.description)
          from public.coolerco_asset_models m
         where m.client_code = l.client_code and m.active and m.show_in_portal
           and (mode is distinct from 'available' or exists (
                 select 1 from public.coolerco_assets s where s.client_code = m.client_code and s.model_code = m.model_code
                    and s.location_type = 'Warehouse' and s.status ilike '%ready%' and s.warehouse_code = pw.warehouse_code))), '[]'::jsonb));
  else
    r := r || jsonb_build_object(
      'assets', coalesce((
        select jsonb_agg(jsonb_build_object('asset', a.name, 'barcode', a.bar_code, 'local_code', a.local_code,
                 'product', a.product_base, 'family', f.display_name, 'family_name', f.name, 'photo', f.photo_path,
                 'type', a.asset_type, 'condition', a.condition) order by a.product_base)
        from public.assets_live a
        left join public.coolerco_product_base_family bf on bf.product_base = a.product_base
        left join public.coolerco_product_families f on f.id = bf.family_id
        where a.assign_account_local_code = l.pos_local_code and a.asset_location = 'Location'), '[]'::jsonb),
      'catalogue', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(f.display_name, f.name), 'description', f.description,
                                            'type', f.asset_type, 'photo', f.photo_path) order by f.sort_order, f.name)
        from public.coolerco_product_families f
        where f.active and f.show_in_portal
          and (mode is distinct from 'available' or exists (
                select 1 from public.coolerco_product_base_family bf
                join public.assets_live a on a.product_base = bf.product_base
                where bf.family_id = f.id and a.asset_status = 'Ready to Work' and a.asset_location = 'Warehouse'
                  and a.assign_account = (select com_name || ' WH' from public.coolerco_warehouse_settings where warehouse_code = pw.warehouse_code)))
      ), '[]'::jsonb));
  end if;
  return r;
end $$;
