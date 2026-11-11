-- CoolerCo-Ops · 020c · RUN ON PRODUCTION (RTMA_Ops abgxjfeofgvimmimxvpa) — removes 020b, which was run here by mistake
-- 020b belongs on TEST. On production it created a copy job pointing at itself. Its two schedules were already
-- switched off on 2026-11-11 10:4x (it never ran: 0 runs logged). This removes the rest.
-- KEEPS 020a (the read-only login + coolerco_export views) — that one belongs on production.
select cron.unschedule(jobid) from cron.job where jobname in ('coolerco_sync_from_prod', 'coolerco_sync_from_prod_full');
drop function if exists public.coolerco_sync_from_prod(boolean);
drop schema if exists coolerco_prod cascade;
drop schema if exists coolerco_prod_check cascade;
drop server if exists coolerco_prod cascade;          -- also removes the stored password
drop table if exists public.coolerco_sync_runs;
drop table if exists public.coolerco_sync_tables;
delete from public.coolerco_settings where key = 'sync_role';

select (select count(*) from pg_foreign_server where srvname = 'coolerco_prod') as copy_link_left,
       (select count(*) from information_schema.views where table_schema = 'coolerco_export') as export_views_kept;
