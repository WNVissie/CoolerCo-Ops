-- TEST only (🟢[TEST] RTMA_Ops) — fix the copy of COM cases from production.
-- Why: the copy only fetched cases with a newer upload time (imported_at), but a COM upload that closes a case
-- changes its status WITHOUT changing imported_at, so closures never reached TEST ("Closed in COM 0" on the Field board).
-- Fix: copy the whole cases table every run (about 24,000 rows, twice a day).
-- Safe: this function refuses to run on production.

update public.coolerco_sync_tables set mode = 'all' where table_name = 'cases';

-- run the copy now instead of waiting for 19:30 (takes about a minute)
select public.coolerco_sync_from_prod();

-- check: should now show Solved cases for this week (production had 98 in Gauteng on 25 Nov)
select status_reason, count(*) from public.cases
 where service_closure_date >= date_trunc('week', now()) group by 1 order by 2 desc;
