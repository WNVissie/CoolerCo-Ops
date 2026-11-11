-- CoolerCo-Ops · 020b · RUN ON TEST ONLY (🟢[TEST] RTMA_Ops laljfgwngculogdzmqiu) — keep TEST's COM data current
-- Copies the COM tables (cases, assets, asset touch, repairs, POS, Magnum uploads) from PRODUCTION into TEST
-- after each upload time, so the UAT site shows current data. Production is only READ (role from 020a).
-- CoolerCo's own test data (coolerco_* tables: requests, scans, roles, messages…) is never touched.
--
-- BEFORE RUNNING, fill in TWO things in section 2:
--   POOLER-HOST  = PRODUCTION project → Connect → "Session pooler" → the host (looks like aws-0-eu-west-1.pooler.supabase.com)
--   SAME-PASSWORD-AS-020a = the password you chose in 020a
-- Rollback: coolerco_020_rollback_TEST.sql

-- ---------------------------------------------------------------------
-- 1. Safety: this database is the TEST copy (the copy job refuses to run anywhere else)
-- ---------------------------------------------------------------------
insert into public.coolerco_settings (key, value) values ('sync_role', '"TEST"'::jsonb)
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------
-- 2. Connection to production (read-only user from 020a)
-- ---------------------------------------------------------------------
create extension if not exists postgres_fdw with schema extensions;

drop server if exists coolerco_prod cascade;
create server coolerco_prod foreign data wrapper postgres_fdw
  options (host 'POOLER-HOST', port '5432', dbname 'postgres', fetch_size '5000');
create user mapping for postgres server coolerco_prod
  options (user 'coolerco_test_reader.abgxjfeofgvimmimxvpa', password 'SAME-PASSWORD-AS-020a');

-- ---------------------------------------------------------------------
-- 3. What is copied, and how
--    since     = rows changed since the last good copy (6-hour overlap), matched on the key → added or updated
--    all       = every row, matched on the key (small tables)
--    newer_id  = only rows with a key higher than the highest one already here (tables that only grow)
--    periods   = stock-take lines of open periods and periods closed in the last 30 days
--    Rows deleted in production are not deleted here (production hardly deletes these; the weekly full copy
--    does not delete either — re-clone TEST if that is ever needed).
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_sync_tables (
  table_name      text primary key,
  mode            text not null check (mode in ('since', 'all', 'newer_id', 'periods')),
  since_col       text,
  id_col          text,
  sort_order      int not null default 100,
  active          boolean not null default true,
  last_success_at timestamptz,
  last_rows       bigint,
  last_ms         int,
  last_error      text,
  last_try_at     timestamptz
);

insert into public.coolerco_sync_tables (table_name, mode, since_col, id_col, sort_order) values
  ('magnum_upload_batches',            'all',      null,             null,         10),
  ('pos_upload_versions',              'all',      null,             null,         11),
  ('upload_history',                   'all',      null,             null,         12),
  ('asset_touch_imports',              'all',      null,             null,         13),
  ('asset_touch_periods',              'all',      null,             null,         14),
  ('cases',                            'since',    'imported_at',    null,         20),
  ('assets_live',                      'since',    'last_synced_at', null,         21),
  ('asset_touch',                      'since',    'imported_at',    null,         22),
  ('case_repairs',                     'since',    'updated_at',     null,         23),
  ('magnum_assets_current',            'all',      null,             null,         30),
  ('magnum_logistics_current',         'all',      null,             null,         31),
  ('magnum_manual_asset_current',      'all',      null,             null,         32),
  ('magnum_manual_concession_current', 'all',      null,             null,         33),
  ('magnum_manual_week_current',       'all',      null,             null,         34),
  ('magnum_assets_history',            'newer_id', null,             'history_id', 40),
  ('magnum_logistics_history',         'newer_id', null,             'history_id', 41),
  ('magnum_manual_snapshot_rows',      'newer_id', null,             'id',         42),
  ('asset_touch_movements',            'newer_id', null,             'id',         43),
  ('pos_records',                      'newer_id', null,             'id',         44),
  ('asset_touch_period_assets',        'periods',  null,             null,         50)
on conflict (table_name) do nothing;

create table if not exists public.coolerco_sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  full_copy   boolean not null default false,
  ok          boolean,
  rows_total  bigint,
  details     jsonb
);

-- ---------------------------------------------------------------------
-- 4. The copy job. One table failing never stops the others; every run is logged.
--    Triggers on the TEST tables are switched off for the copy (session_replication_role = replica), so the
--    dashboard's audit triggers do not write a second history row — history is copied from production.
-- ---------------------------------------------------------------------
create or replace function public.coolerco_sync_from_prod(p_full boolean default false)
returns jsonb language plpgsql set search_path = public, extensions, pg_temp as $fn$
declare
  t        public.coolerco_sync_tables;
  v_run    bigint;
  v_start  timestamptz;
  v_rows   bigint;
  v_total  bigint := 0;
  v_ok     boolean := true;
  v_det    jsonb := '{}'::jsonb;
  v_cols   text; v_upd text; v_pk text; v_where text; v_sql text; v_max text; v_ids uuid[];
  v_rel    regclass; v_frel regclass;
begin
  if coalesce((select value #>> '{}' from public.coolerco_settings where key = 'sync_role'), '') <> 'TEST' then
    raise exception 'coolerco_sync_from_prod only runs on the TEST database';
  end if;
  insert into public.coolerco_sync_runs (full_copy) values (p_full) returning id into v_run;
  perform set_config('session_replication_role', 'replica', true);

  -- fresh column list from production every run (picks up columns added there)
  drop schema if exists coolerco_prod cascade;
  create schema coolerco_prod;
  revoke all on schema coolerco_prod from public, anon, authenticated;
  import foreign schema coolerco_export from server coolerco_prod into coolerco_prod;

  for t in select * from public.coolerco_sync_tables where active order by sort_order, table_name loop
    v_start := clock_timestamp(); v_rows := 0;
    begin
      v_rel  := to_regclass('public.' || quote_ident(t.table_name));
      v_frel := to_regclass('coolerco_prod.' || quote_ident(t.table_name));
      if v_rel is null or v_frel is null then raise exception 'table missing here or in production'; end if;

      -- columns present on both sides, never generated columns
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
             string_agg(case when not exists (select 1 from pg_index i where i.indrelid = v_rel and i.indisprimary and a.attnum = any(i.indkey))
                             then format('%1$I = excluded.%1$I', a.attname) end, ', ' order by a.attnum)
        into v_cols, v_upd
        from pg_attribute a
       where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
         and exists (select 1 from pg_attribute f where f.attrelid = v_frel and f.attname = a.attname and not f.attisdropped);
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_pk
        from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = v_rel and i.indisprimary;
      if v_pk is null then raise exception 'no primary key'; end if;

      v_where := '';
      if t.mode = 'since' and not p_full and t.last_success_at is not null then
        v_where := format('where %I >= %L::timestamptz', t.since_col, t.last_success_at - interval '6 hours');
      elsif t.mode = 'newer_id' and not p_full then
        execute format('select max(%I)::text from public.%I', t.id_col, t.table_name) into v_max;
        if v_max is not null then v_where := format('where %I > %L', t.id_col, v_max); end if;
      elsif t.mode = 'periods' then
        select array_agg(id) into v_ids from public.asset_touch_periods
         where closed_at is null or coalesce(reconcile_finalised_at, closed_at) > now() - interval '30 days';
        v_where := format('where period_id = any(%L::uuid[])', coalesce(v_ids, '{}'::uuid[]));
      end if;

      v_sql := format('insert into public.%I (%s) overriding system value select %s from coolerco_prod.%I %s on conflict (%s) %s',
                      t.table_name, v_cols, v_cols, t.table_name, v_where, v_pk,
                      case when t.mode = 'newer_id' or v_upd is null then 'do nothing' else 'do update set ' || v_upd end);
      execute v_sql;
      get diagnostics v_rows = row_count;

      update public.coolerco_sync_tables
         set last_success_at = v_start, last_rows = v_rows, last_error = null, last_try_at = v_start,
             last_ms = (extract(epoch from clock_timestamp() - v_start) * 1000)::int
       where table_name = t.table_name;
      v_det := v_det || jsonb_build_object(t.table_name, v_rows);
      v_total := v_total + v_rows;
    exception when others then
      v_ok := false;
      update public.coolerco_sync_tables set last_error = left(sqlerrm, 500), last_try_at = v_start where table_name = t.table_name;
      v_det := v_det || jsonb_build_object(t.table_name, 'ERROR: ' || left(sqlerrm, 200));
    end;
  end loop;

  begin
    refresh materialized view public.mv_supplier_view_cases;
  exception when others then
    v_det := v_det || jsonb_build_object('mv_supplier_view_cases', 'ERROR: ' || left(sqlerrm, 200));
  end;

  update public.coolerco_sync_runs set finished_at = clock_timestamp(), ok = v_ok, rows_total = v_total, details = v_det where id = v_run;
  -- keep 60 days of run history
  delete from public.coolerco_sync_runs where started_at < now() - interval '60 days';
  return jsonb_build_object('ok', v_ok, 'rows', v_total, 'tables', v_det);
end $fn$;

revoke all on function public.coolerco_sync_from_prod(boolean) from public, anon, authenticated;

-- status for the app (staff can see when TEST was last refreshed)
alter table public.coolerco_sync_tables enable row level security;
alter table public.coolerco_sync_runs enable row level security;
revoke all on public.coolerco_sync_tables, public.coolerco_sync_runs from anon;
grant select on public.coolerco_sync_tables, public.coolerco_sync_runs to authenticated;
drop policy if exists coolerco_sync_tables_read on public.coolerco_sync_tables;
create policy coolerco_sync_tables_read on public.coolerco_sync_tables for select to authenticated using (true);
drop policy if exists coolerco_sync_runs_read on public.coolerco_sync_runs;
create policy coolerco_sync_runs_read on public.coolerco_sync_runs for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 5. Schedule (pg_cron runs in UTC; South Africa = UTC+2)
--    07:30, 12:30, 15:30, 19:30 SA time → 05:30, 10:30, 13:30, 17:30 UTC
--    Sunday 01:00 SA time (Saturday 23:00 UTC): full copy as a safety net
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('coolerco_sync_from_prod', 'coolerco_sync_from_prod_full');
select cron.schedule('coolerco_sync_from_prod',      '30 5,10,13,17 * * *', 'select public.coolerco_sync_from_prod(false)');
select cron.schedule('coolerco_sync_from_prod_full', '0 23 * * 6',          'select public.coolerco_sync_from_prod(true)');

-- ---------------------------------------------------------------------
-- 6. Connection test: should show the number of cases in PRODUCTION (about 22,800), not an error
-- ---------------------------------------------------------------------
drop schema if exists coolerco_prod_check cascade;
create schema coolerco_prod_check;
import foreign schema coolerco_export limit to (cases) from server coolerco_prod into coolerco_prod_check;
select count(*) as production_cases_visible from coolerco_prod_check.cases;
drop schema coolerco_prod_check cascade;
