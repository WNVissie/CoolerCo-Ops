-- CoolerCo-Ops · 023 · Asset labels (re-print the COM barcode as QR + text on Brother P-touch 24 mm tape)
-- Additive only (new coolerco_ tables + functions). COM / assets_live are only read.
-- Rule (Wanda): real barcode labels start with "11"; any other barcode was never physically labelled.
-- Rollback: coolerco_023_rollback.sql

-- One row per asset = its label state: needed → printed → confirmed (scanned after sticking it on)
create table if not exists public.coolerco_asset_labels (
  asset            text primary key,                -- assets_live.name (AST-…)
  bar_code         text not null,                   -- the COM barcode that is printed
  local_code       text,
  warehouse        text,                            -- assets_live.assign_account when flagged
  reason           text not null default 'lost' check (reason in ('never_labelled', 'lost', 'damaged', 'wrong_label')),
  status           text not null default 'needed' check (status in ('needed', 'printed', 'confirmed')),
  flagged_at       timestamptz not null default now(),
  flagged_by       text,
  printed_at       timestamptz,
  printed_by       text,
  print_count      int not null default 0,
  confirmed_at     timestamptz,
  confirmed_by     text,
  updated_at       timestamptz not null default now()
);
create index if not exists idx_coolerco_asset_labels_status on public.coolerco_asset_labels (status);
create index if not exists idx_coolerco_asset_labels_bar on public.coolerco_asset_labels (bar_code);

-- A label on a cooler that belongs to another asset (previous supplier's linking) → fix in COM
create table if not exists public.coolerco_label_corrections (
  id               uuid primary key default gen_random_uuid(),
  code_on_cooler   text not null,                   -- what the old label / plate says
  asset_of_code    text,                            -- the asset COM links that code to (if any)
  asset_true       text not null,                   -- the cooler it really is (found by local code / serial / SAP no.)
  true_bar_code    text,
  warehouse        text,
  notes            text,
  status           text not null default 'open' check (status in ('open', 'fixed')),
  found_at         timestamptz not null default now(),
  found_by         text,
  fixed_at         timestamptz,
  fixed_by         text
);
create index if not exists idx_coolerco_label_corrections_status on public.coolerco_label_corrections (status, found_at desc);

alter table public.coolerco_asset_labels enable row level security;
alter table public.coolerco_label_corrections enable row level security;
drop policy if exists coolerco_asset_labels_auth on public.coolerco_asset_labels;
create policy coolerco_asset_labels_auth on public.coolerco_asset_labels for all to authenticated using (true) with check (true);
drop policy if exists coolerco_label_corrections_auth on public.coolerco_label_corrections;
create policy coolerco_label_corrections_auth on public.coolerco_label_corrections for all to authenticated using (true) with check (true);
revoke all on public.coolerco_asset_labels, public.coolerco_label_corrections from anon;
grant select, insert, update on public.coolerco_asset_labels, public.coolerco_label_corrections to authenticated;

-- Change the label state of one or more assets. p_action: needed | printed | confirmed
-- Reason is worked out when not given: barcode not starting with 11 → never_labelled, else lost.
create or replace function public.coolerco_label_mark(p_assets text[], p_action text, p_reason text default null)
returns int language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  n int;
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  if p_action not in ('needed', 'printed', 'confirmed') then raise exception 'unknown action %', p_action; end if;
  insert into public.coolerco_asset_labels as l (asset, bar_code, local_code, warehouse, reason, status, flagged_by,
         printed_at, printed_by, print_count, confirmed_at, confirmed_by)
  select a.name, a.bar_code, a.local_code, a.assign_account,
         coalesce(p_reason, case when a.bar_code like '11%' then 'lost' else 'never_labelled' end),
         p_action, v_by,
         case when p_action = 'printed' then now() end, case when p_action = 'printed' then v_by end,
         case when p_action = 'printed' then 1 else 0 end,
         case when p_action = 'confirmed' then now() end, case when p_action = 'confirmed' then v_by end
    from public.assets_live a
   where a.name = any (p_assets) and nullif(trim(a.bar_code), '') is not null
  on conflict (asset) do update set
    reason       = coalesce(p_reason, l.reason),
    warehouse    = excluded.warehouse,
    -- a confirmed label only goes back to "needed" when someone says it is gone again
    status       = case when p_action = 'printed' and l.status = 'confirmed' then 'printed' else p_action end,
    flagged_at   = case when p_action = 'needed' and l.status = 'confirmed' then now() else l.flagged_at end,
    printed_at   = case when p_action = 'printed' then now() else l.printed_at end,
    printed_by   = case when p_action = 'printed' then v_by else l.printed_by end,
    print_count  = l.print_count + case when p_action = 'printed' then 1 else 0 end,
    confirmed_at = case when p_action = 'confirmed' then now() when p_action in ('needed', 'printed') then null else l.confirmed_at end,
    confirmed_by = case when p_action = 'confirmed' then v_by when p_action in ('needed', 'printed') then null else l.confirmed_by end,
    updated_at   = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- 🏷 To label: RTMA stock that needs a label (never labelled and not yet confirmed, or flagged / printed and waiting
-- for the confirming scan). Sorted for walking the warehouse: warehouse → WH/WS → last scanned area → bay → barcode.
create or replace function public.coolerco_label_todo(p_warehouse text default null)
returns table (asset text, bar_code text, local_code text, product_base text, product_variant text, condition text,
               asset_status text, bay text, warehouse text, ws boolean, reason text, status text,
               printed_at timestamptz, print_count int, last_area text, last_scan_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select a.* from public.assets_live a
     where a.asset_location in ('Warehouse', 'Workshop') and a.assign_account ~ '^RTMA .* (WH|WS)$'
       and nullif(trim(a.bar_code), '') is not null
       and (p_warehouse is null or a.assign_account ilike 'RTMA ' || p_warehouse || ' %')
  ), last_scan as (
    select distinct on (t.asset_name) t.asset_name, w.label as area, t.created_at
      from public.coolerco_asset_touch t left join public.coolerco_wh_locations w on w.id = t.location_id
     where t.asset_name in (select name from s)
     order by t.asset_name, t.created_at desc
  )
  select s.name, s.bar_code, s.local_code, s.product_base, s.product_variant, s.condition, s.asset_status,
         public.coolerco_bay_for_status(s.asset_status),
         regexp_replace(s.assign_account, '^RTMA (.*) (WH|WS)$', '\1'), s.assign_account ~ ' WS$',
         coalesce(l.reason, 'never_labelled'), coalesce(l.status, 'needed'), l.printed_at, coalesce(l.print_count, 0),
         ls.area, ls.created_at
    from s
    left join public.coolerco_asset_labels l on l.asset = s.name
    left join last_scan ls on ls.asset_name = s.name
   where (l.asset is null and s.bar_code not like '11%')
      or l.status in ('needed', 'printed')
   order by 9, 10, ls.area nulls last, 8, s.bar_code;
$$;

-- Progress per warehouse: stock, never labelled ("not 11"), still to label, printed (waiting for scan), confirmed
create or replace function public.coolerco_label_summary()
returns table (warehouse text, stock bigint, not_11 bigint, to_label bigint, printed bigint, confirmed bigint, corrections_open bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select a.name, a.bar_code, regexp_replace(a.assign_account, '^RTMA (.*) (WH|WS)$', '\1') as wh
      from public.assets_live a
     where a.asset_location in ('Warehouse', 'Workshop') and a.assign_account ~ '^RTMA .* (WH|WS)$'
       and nullif(trim(a.bar_code), '') is not null
  )
  select s.wh, count(*),
         count(*) filter (where s.bar_code not like '11%'),
         count(*) filter (where (l.asset is null and s.bar_code not like '11%') or l.status = 'needed'),
         count(*) filter (where l.status = 'printed'),
         count(*) filter (where l.status = 'confirmed'),
         (select count(*) from public.coolerco_label_corrections c where c.status = 'open' and c.warehouse ilike 'RTMA ' || s.wh || ' %')
    from s left join public.coolerco_asset_labels l on l.asset = s.name
   group by s.wh order by 2 desc;
$$;

revoke all on function public.coolerco_label_mark(text[], text, text) from public, anon;
revoke all on function public.coolerco_label_todo(text) from public, anon;
revoke all on function public.coolerco_label_summary() from public, anon;
grant execute on function public.coolerco_label_mark(text[], text, text) to authenticated;
grant execute on function public.coolerco_label_todo(text) to authenticated;
grant execute on function public.coolerco_label_summary() to authenticated;
