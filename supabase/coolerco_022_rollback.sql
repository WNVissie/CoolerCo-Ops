-- CoolerCo-Ops · 022 · ROLLBACK — removes the two functions, the COM link setting and the cancel reasons.
-- Cases already cancelled stay cancelled (their history entry stays too).
drop function if exists public.coolerco_case_cancel(text, text, text);
drop function if exists public.coolerco_case_actions(text);
delete from public.coolerco_settings where key = 'com_case_url';
delete from public.coolerco_reason_codes where code in ('CAN_DUPLICATE', 'CAN_NOT_NEEDED', 'CAN_FIXED', 'CAN_ERROR', 'CAN_OTHER')
  and not exists (select 1 from public.coolerco_cases where motive = coolerco_reason_codes.code);
