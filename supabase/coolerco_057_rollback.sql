-- Rollback 057 · picking for self-managed clients
-- First puts any cooler that is still "Picked" back to its status before the pick and clears it from the case,
-- then removes the functions and the picks table. Movements already written stay in the ledger (history).
update public.coolerco_assets a set status = coalesce(p.status_before, 'In warehouse, ready to work'), updated_at = now()
  from public.coolerco_client_picks p
 where p.released_at is null and a.client_code = p.client_code and a.asset_number = p.asset_number and a.status = 'Picked';
update public.coolerco_cases k set asset_delivered = null, updated_at = now()
  from public.coolerco_client_picks p
 where p.released_at is null and k.case_number = p.case_number and k.asset_delivered = p.asset_number;

drop function if exists public.coolerco_client_picks_for_routes(uuid[]);
drop function if exists public.coolerco_client_pick_select(text, text, uuid, text, text);
drop function if exists public.coolerco_client_pick_undo(text, text);
drop function if exists public.coolerco_client_pick_candidates(text, int);
drop function if exists public.coolerco_client_pick_board(date, text);
drop function if exists public.coolerco_model_matches(text, text, text);
drop function if exists public.coolerco_can_pick();
drop table if exists public.coolerco_client_picks;
