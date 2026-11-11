-- CoolerCo-Ops · 021 · ROLLBACK — removes the two read-only report functions. Nothing else is touched.
drop function if exists public.coolerco_repeat_workshop_repairs(date, text);
drop function if exists public.coolerco_duplicate_open_cases(text);
