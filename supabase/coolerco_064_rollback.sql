-- Rollback for coolerco_064_expected_returns.sql (TEST): the engine books a loaded cooler back straight away again (CC-RETURN).
drop trigger if exists coolerco_touch_expected_return on public.coolerco_asset_touch;
drop function if exists public.coolerco_touch_expected_return();
drop function if exists public.coolerco_expected_returns_list(text, text);
drop function if exists public.coolerco_expected_return_close(uuid, text, text);
drop function if exists public.coolerco_expected_return_receive(text, text, uuid, text);

-- the 038 version of coolerco_reverse_case_movements (saved by 064)
do $$
declare d text;
begin
  select def into d from public.coolerco_fn_backup where script = '064' and fn = 'coolerco_reverse_case_movements';
  if d is not null then execute d; end if;
end $$;

drop function if exists public.coolerco_expect_return(text, text);
drop function if exists public.coolerco_return_loaded_now(text, text, text, text);

-- rules back as they were before 064
update public.coolerco_case_rules r set return_loaded = (b.rule ->> 'return_loaded')::boolean
  from public.coolerco_rule_backup b where b.script = '064' and b.rule ->> 'id' = r.id::text;
delete from public.coolerco_rule_backup where script = '064';
delete from public.coolerco_fn_backup where script = '064';

drop table if exists public.coolerco_expected_returns;
drop function if exists public.coolerco_wh_code_of(text);
delete from public.coolerco_settings where key = 'return_scan_hours';
