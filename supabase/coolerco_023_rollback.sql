-- Rollback for CoolerCo 023: removes the two views. No data is touched.
drop view if exists public.coolerco_all_cases;
drop view if exists public.coolerco_com_case_extra;
