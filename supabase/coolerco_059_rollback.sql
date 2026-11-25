-- Rollback 059 · Action Required desk
-- Puts office close / close options / register status back to their 058 versions, restores the rules 059 changed,
-- removes the rules, reasons, alert table, desk and region-portal functions 059 added.
-- Cases already rescheduled / follow-up cases already made stay as they are (history).
do $rb$
declare d text; r jsonb;
begin
  for d in select def from public.coolerco_fn_backup where script = '059' loop execute d; end loop;
  for r in select rule from public.coolerco_rule_backup where script = '059' loop
    update public.coolerco_case_rules set case_status = r ->> 'case_status', follow_up_case_type = r ->> 'follow_up_case_type',
           follow_up_asset_role = r ->> 'follow_up_asset_role', follow_up_asset_status = r ->> 'follow_up_asset_status',
           active = (r ->> 'active')::boolean, note = r ->> 'note'
     where id = (r ->> 'id')::uuid;
  end loop;
end $rb$;
delete from public.coolerco_case_rules where note like 'Added 059%';
update public.coolerco_event_codes set event = 'other' where code = 'NO_CONTACT';
delete from public.coolerco_event_codes where code = 'LACK_MATERIAL';
delete from public.coolerco_field_reasons where code = 'LACK_MATERIAL';
delete from public.coolerco_notification_rules where event_type = 'region_action';
drop trigger if exists coolerco_region_alert on public.coolerco_case_events;
drop function if exists public.coolerco_trg_region_alert();
drop function if exists public.coolerco_conc_reschedule(text, uuid, text);
drop function if exists public.coolerco_conc_alert_fix(text, uuid, jsonb);
drop function if exists public.coolerco_conc_alerts(text);
drop function if exists public.coolerco_ar_list(text, text);
drop function if exists public.coolerco_ar_resolve(text, text, text, text, text);
drop function if exists public.coolerco_ar_reschedule_do(text, text, text, text, text);
drop function if exists public.coolerco_ar_options(text);
drop function if exists public.coolerco_ar_ways(text, text);
drop function if exists public.coolerco_ar_last(text);
drop function if exists public.coolerco_case_spawn(text, text, text, text, text);
drop table if exists public.coolerco_region_alerts;
delete from public.coolerco_fn_backup where script = '059';
delete from public.coolerco_rule_backup where script = '059';
-- movement types CC-TO-BRAND / CC-TO-SCRAP are kept (movements may refer to them)
