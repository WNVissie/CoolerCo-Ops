-- ============================================================================
-- coolerco_043_close_open_tables.sql (sent to Wanda as 01_close_open_tables.sql; applied on TEST 2026-11-24)
-- Closes the tables that anyone with the public (anon) key can read and write
-- without signing in.
--
-- Run on 🟢[TEST] RTMA_Ops first, test the apps, then run on production.
--
-- Effect:
--   * Nobody is logged out. Row-level security does not touch sessions.
--   * Signed-in users of every app keep exactly the access they have today
--     (read and write), so SmartDash, SmartSpares and the other apps work as before.
--   * Server scripts and Netlify functions using the secret key are not affected
--     (the secret key bypasses row-level security).
--   * Requests with no signed-in user get nothing back, which is the fix.
--   * The old AssetFlow tables (st_*) and the scratch table zz_cases_fn_compare
--     are closed completely; only the secret key can reach them.
-- ============================================================================

begin;

-- 1. Tables in use by signed-in users or server scripts: keep today's access
--    for signed-in users, close them to everyone not signed in.
do $$
declare
  t text;
  tables text[] := array[
    'brands',
    'cases',
    'decal_models',
    'decal_positions',
    'decal_skus',
    'routing_case_destination_overrides',
    'spare_item_photos',
    'spare_items',
    'staging_cases',
    'stock_categories',
    'stock_take_lines_basket',
    'stock_take_lines_decal',
    'stock_take_lines_spare',
    'stock_transfer_lines_basket',
    'stock_transfer_lines_decal',
    'stock_transfer_lines_spare',
    'stocktake_scan_history',
    'suppliers',
    'warehouses'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'Skipped %, table not found', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_signed_in', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_signed_in', t);
    raise notice 'Closed % to anyone not signed in', t;
  end loop;
end $$;

-- 2. Old AssetFlow tables and scratch tables: not used by any app.
--    Row-level security on with no policy = closed to the public and to
--    signed-in users; only the secret key can still read them.
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
      and (c.relname like 'st\_%' or c.relname = 'zz_cases_fn_compare')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'Locked %', r.relname;
  end loop;
end $$;

commit;

-- ============================================================================
-- Check afterwards: this should return no rows.
-- ============================================================================
select c.relname as still_open
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by 1;

-- ============================================================================
-- Undo, if an app breaks (per table):
--   alter table public.<table> disable row level security;
-- ============================================================================
