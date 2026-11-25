-- Rollback 058 · office close + client cancel
-- Puts the rules engine and the cancel function back as they were before 058 (saved in coolerco_fn_backup),
-- removes the register triggers and the new functions, and takes out the rules 058 added.
-- Cooler places / statuses already changed by 058 stay as they are (see the movement history).
do $rb$
declare d text;
begin
  for d in select def from public.coolerco_fn_backup where script = '058' loop execute d; end loop;
end $rb$;
drop trigger if exists coolerco_register_move_before on public.coolerco_asset_movements;
drop trigger if exists coolerco_register_move_after on public.coolerco_asset_movements;
drop function if exists public.coolerco_trg_register_move_before();
drop function if exists public.coolerco_trg_register_move_after();
drop function if exists public.coolerco_register_status(text, text);
drop function if exists public.coolerco_case_office_close(text, text, text, text, text, text, timestamptz);
drop function if exists public.coolerco_case_close_options(text);
drop function if exists public.coolerco_case_on_route(text);
drop function if exists public.coolerco_can_office_close();
delete from public.coolerco_case_rules where note like 'Added 058%';
update public.coolerco_event_codes set event = 'other' where code = 'NO_TIME';
delete from public.coolerco_fn_backup where script = '058';
-- the columns cancelled_on_route / cancelled_route / cancelled_by_role on coolerco_cases are kept (history)
