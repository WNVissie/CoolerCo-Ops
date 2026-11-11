-- CoolerCo-Ops · 020b · ROLLBACK — RUN ON TEST. Stops and removes the copy job. The copied data stays as it is.
select cron.unschedule(jobid) from cron.job where jobname in ('coolerco_sync_from_prod', 'coolerco_sync_from_prod_full');
drop function if exists public.coolerco_sync_from_prod(boolean);
drop schema if exists coolerco_prod cascade;
drop schema if exists coolerco_prod_check cascade;
drop server if exists coolerco_prod cascade;   -- also removes the stored password
drop table if exists public.coolerco_sync_runs;
drop table if exists public.coolerco_sync_tables;
delete from public.coolerco_settings where key = 'sync_role';
