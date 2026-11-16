-- CoolerCo-Ops · 030b · RUN ON TEST (laljfgwngculogdzmqiu) — add the RouteIQ (routing) tables to the copy job
-- Why: the UAT Field app and the Routes / Picking pages read routing tables. On TEST they stopped on 10 Nov.
--      After this they follow production at 08:30 and 19:30 like the COM tables. RouteIQ itself is not touched.
-- Needs first: 030a on PRODUCTION (adds the routing views to the read-only window).
-- What changes here (additive, coolerco_ objects only):
--   1. coolerco_sync_tables gets a column user_cols (sign-in columns). A sign-in made in production after the
--      clone does not exist on TEST; those values are copied as empty instead of failing the whole table.
--   2. coolerco_sync_from_prod is replaced by the same function with that one change.
--   3. 11 routing tables are added to the list (all small: every row each run, events only the last days).
-- Rows deleted in production stay here (same rule as the other tables).
-- Rollback: coolerco_030_rollback_TEST.sql

alter table public.coolerco_sync_tables add column if not exists user_cols text[];

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
  v_cols   text; v_sel text; v_upd text; v_pk text; v_where text; v_sql text; v_max text; v_ids uuid[];
  v_rel    regclass; v_frel regclass; v_trg boolean;
begin
  if coalesce((select value #>> '{}' from public.coolerco_settings where key = 'sync_role'), '') <> 'TEST'
     or to_regnamespace('coolerco_export') is not null then
    raise exception 'coolerco_sync_from_prod only runs on the TEST database';
  end if;
  insert into public.coolerco_sync_runs (full_copy) values (p_full) returning id into v_run;

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
             -- user columns: keep the value only if that sign-in also exists here (TEST is missing users made after the clone)
             string_agg(case when a.attname = any(coalesce(t.user_cols, '{}'::text[]))
                             then format('(select u.id from auth.users u where u.id = s.%1$I)', a.attname)
                             else 's.' || quote_ident(a.attname) end, ', ' order by a.attnum),
             string_agg(case when not exists (select 1 from pg_index i where i.indrelid = v_rel and i.indisprimary and a.attnum = any(i.indkey))
                             then format('%1$I = excluded.%1$I', a.attname) end, ', ' order by a.attnum)
        into v_cols, v_sel, v_upd
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

      v_sql := format('insert into public.%I (%s) overriding system value select %s from coolerco_prod.%I s %s on conflict (%s) %s',
                      t.table_name, v_cols, v_sel, t.table_name, v_where, v_pk,
                      case when t.mode = 'newer_id' or v_upd is null then 'do nothing' else 'do update set ' || v_upd end);
      select exists (select 1 from pg_trigger g where g.tgrelid = v_rel and not g.tgisinternal and g.tgenabled <> 'D') into v_trg;
      if v_trg then execute format('alter table public.%I disable trigger user', t.table_name); end if;
      execute v_sql;
      get diagnostics v_rows = row_count;
      if v_trg then execute format('alter table public.%I enable trigger user', t.table_name); end if;

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

insert into public.coolerco_sync_tables (table_name, mode, since_col, user_cols, sort_order) values
  ('routing_optimization_runs',     'all',   null,         '{requested_by}',             60),
  ('routing_routes',                'all',   null,         '{created_by,finalised_by}',  61),
  ('routing_route_versions',        'all',   null,         '{created_by}',               62),
  ('routing_route_stops',           'all',   null,         '{outcome_recorded_by}',      63),
  ('routing_warehouse_preparation', 'all',   null,         null,                         64),
  ('routing_case_assignments',      'all',   null,         null,                         65),
  ('routing_pos_assignments',       'all',   null,         null,                         66),
  ('routing_portal_users',          'all',   null,         null,                         67),
  ('routing_pos_contacts',          'all',   null,         null,                         68),
  ('routing_job_cards',             'all',   null,         null,                         69),
  ('routing_route_events',          'since', 'created_at', '{actor_id}',                 70)
on conflict (table_name) do update
  set mode = excluded.mode, since_col = excluded.since_col, user_cols = excluded.user_cols,
      sort_order = excluded.sort_order, active = true;

-- first copy now (takes a few seconds); then check: every routing_ line should show a number, not ERROR
select public.coolerco_sync_from_prod(false);
select table_name, last_rows, last_error from public.coolerco_sync_tables where table_name like 'routing\_%' order by sort_order;
