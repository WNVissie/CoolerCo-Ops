-- CoolerCo 040 rollback — removes the case calendar functions and the SLA rules table.
-- The public holidays table is kept if script 036 (store hours) uses it; drop it by hand only if 036 is not installed.
drop function if exists public.coolerco_case_calendar_list(text, date, date, text, text, text, text, int);
drop function if exists public.coolerco_case_calendar(date, text, text, text, text);
drop function if exists public.coolerco_case_calendar_place(text, date, timestamptz, timestamptz, date);
drop function if exists public.coolerco_case_calendar_rows(date, text, text, text);
drop function if exists public.coolerco_sla_due_date(text, text, text, timestamptz, timestamptz);
drop function if exists public.coolerco_add_working_days(date, int);
drop table if exists public.coolerco_sla_rules;
-- drop table if exists public.coolerco_public_holidays;   -- only when 036 is not installed
