-- CoolerCo-Ops · 038 · ROLLBACK (TEST). Removes the rules engine, COM updates and movement types; 024's ledger columns
-- added by 038 are dropped (024's own picking rows stay). Re-run 024 if you also want its original movement check back.
drop trigger if exists coolerco_job_card_rules on public.coolerco_field_job_cards;
drop trigger if exists coolerco_stop_event_rules on public.coolerco_field_stop_events;
drop trigger if exists coolerco_pick_rules on public.coolerco_asset_movements;
drop trigger if exists coolerco_case_cancel_rules on public.coolerco_cases;
drop function if exists public.coolerco_trg_job_card_rules();
drop function if exists public.coolerco_trg_stop_event_rules();
drop function if exists public.coolerco_trg_pick_rules();
drop function if exists public.coolerco_trg_case_cancel_rules();
drop function if exists public.coolerco_case_route_events(date);
drop function if exists public.coolerco_case_rule_save(uuid, text, text, boolean, text);
drop function if exists public.coolerco_com_updates_mark(uuid[], text, text);
drop function if exists public.coolerco_asset_movement_history(text);
drop view if exists public.coolerco_movement_com_check;
drop function if exists public.coolerco_case_apply_event(text, text, text, uuid, jsonb, timestamptz, text, double precision, double precision, boolean);
drop function if exists public.coolerco_reverse_case_movements(text, boolean, text, uuid);
drop function if exists public.coolerco_post_movement(text, text, jsonb, text, text, uuid, boolean, text, uuid);
drop function if exists public.coolerco_asset_now(text);
delete from public.coolerco_asset_movements where movement_code is not null;
drop index if exists public.coolerco_moves_source_uq;
drop index if exists public.idx_cc_moves_case;
alter table public.coolerco_asset_movements drop column if exists client_code, drop column if exists case_type, drop column if exists movement_code,
  drop column if exists asset_role, drop column if exists from_kind, drop column if exists from_code, drop column if exists to_kind,
  drop column if exists to_code, drop column if exists status_before, drop column if exists status_after, drop column if exists source,
  drop column if exists source_id, drop column if exists reverses, drop column if exists reversed;
drop table if exists public.coolerco_com_updates;
drop table if exists public.coolerco_engine_log;
drop table if exists public.coolerco_event_codes;
drop table if exists public.coolerco_case_rules;
drop table if exists public.coolerco_movement_types;
alter table public.coolerco_cases drop column if exists related_case;
