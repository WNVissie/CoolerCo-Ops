-- CoolerCo-Ops · 020a · RUN ON PRODUCTION (RTMA_Ops abgxjfeofgvimmimxvpa) — read-only window for the TEST copy job
-- What it does (additive only — no existing table, view, policy or role is changed):
--   1. a login role that can ONLY read, and only through the views below
--   2. a separate schema "coolerco_export" with one plain view per COM table (select * — same columns, same data)
-- The views are owned by postgres (the table owner), so they return all rows to that role without touching
-- the tables' own security. The schema is not exposed by the Supabase API, and anon / authenticated get nothing.
--
-- BEFORE RUNNING: replace  CHOOSE-A-LONG-PASSWORD  with a long password you make up.
--   Use letters and numbers only (no quotes). Keep it: you type the same password in script 020b on TEST.
-- Rollback: coolerco_020_rollback_PRODUCTION.sql

create role coolerco_test_reader with login password 'CHOOSE-A-LONG-PASSWORD' connection limit 3;
alter role coolerco_test_reader set default_transaction_read_only = on;

create schema if not exists coolerco_export;
revoke all on schema coolerco_export from public;

create or replace view coolerco_export.cases                            as select * from public.cases;
create or replace view coolerco_export.assets_live                      as select * from public.assets_live;
create or replace view coolerco_export.asset_touch                      as select * from public.asset_touch;
create or replace view coolerco_export.asset_touch_imports              as select * from public.asset_touch_imports;
create or replace view coolerco_export.asset_touch_movements            as select * from public.asset_touch_movements;
create or replace view coolerco_export.asset_touch_periods              as select * from public.asset_touch_periods;
create or replace view coolerco_export.asset_touch_period_assets        as select * from public.asset_touch_period_assets;
create or replace view coolerco_export.case_repairs                     as select * from public.case_repairs;
create or replace view coolerco_export.upload_history                   as select * from public.upload_history;
create or replace view coolerco_export.pos_upload_versions              as select * from public.pos_upload_versions;
create or replace view coolerco_export.pos_records                      as select * from public.pos_records;
create or replace view coolerco_export.magnum_upload_batches            as select * from public.magnum_upload_batches;
create or replace view coolerco_export.magnum_assets_current            as select * from public.magnum_assets_current;
create or replace view coolerco_export.magnum_assets_history            as select * from public.magnum_assets_history;
create or replace view coolerco_export.magnum_logistics_current         as select * from public.magnum_logistics_current;
create or replace view coolerco_export.magnum_logistics_history         as select * from public.magnum_logistics_history;
create or replace view coolerco_export.magnum_manual_asset_current      as select * from public.magnum_manual_asset_current;
create or replace view coolerco_export.magnum_manual_concession_current as select * from public.magnum_manual_concession_current;
create or replace view coolerco_export.magnum_manual_week_current       as select * from public.magnum_manual_week_current;
create or replace view coolerco_export.magnum_manual_snapshot_rows      as select * from public.magnum_manual_snapshot_rows;

revoke all on all tables in schema coolerco_export from public, anon, authenticated;
grant usage on schema coolerco_export to coolerco_test_reader;
grant select on all tables in schema coolerco_export to coolerco_test_reader;

select count(*) as views_created from information_schema.views where table_schema = 'coolerco_export';
