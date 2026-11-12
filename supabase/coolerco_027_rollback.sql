-- CoolerCo-Ops · 027 · ROLLBACK — removes the override/condition functions and table, then re-run coolerco_024_picking.sql
-- (section "functions" only) to restore 024's pick_select / pick_scan / pick_board (any signed-in user may give a reason again).
drop function if exists public.coolerco_override_decide(uuid, boolean, text);
drop function if exists public.coolerco_override_request(uuid, text, text, text, text);
drop function if exists public.coolerco_pick_condition_fix(uuid, text, text, text, boolean, text, uuid);
drop function if exists public.coolerco_pick_can_override(uuid);
drop function if exists public.coolerco_wh_code_for_group(text);
drop table if exists public.coolerco_override_requests;
delete from public.coolerco_notification_rules where event_type = 'pick_override';
