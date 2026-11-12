-- CoolerCo-Ops · 024 · ROLLBACK — removes the picking functions, the ledger and the two settings.
-- Selections / picks already written into routing prep on TEST stay as they are (routing app data).
drop function if exists public.coolerco_pick_undo(uuid, text, text, text);
drop function if exists public.coolerco_pick_scan(text, date, text, uuid, text, text, text, uuid);
drop function if exists public.coolerco_pick_autofill(date, text);
drop function if exists public.coolerco_pick_select(uuid, text, text, text);
drop function if exists public.coolerco_pick_write(uuid, text, jsonb, boolean, text, text, text, uuid, boolean);
drop function if exists public.coolerco_pick_problems(uuid, text, text);
drop function if exists public.coolerco_pick_candidates(uuid, text, int);
drop function if exists public.coolerco_pick_board(date, date, text);
drop function if exists public.coolerco_pick_lines(date, date, text, uuid);
drop function if exists public.coolerco_pick_writes_on();
drop table if exists public.coolerco_asset_movements;
delete from public.coolerco_settings where key in ('pick_writes_routing', 'pick_new_needs_reason');
