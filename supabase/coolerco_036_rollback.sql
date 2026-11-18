-- Rollback of 036 (store opening + receiving hours). Removes ONLY the 036 objects (hours entered are lost).
drop function if exists public.coolerco_pos_hours_history(text, int);
drop function if exists public.coolerco_pos_hours_for(text, date);
drop function if exists public.coolerco_pos_hours_set(text[], jsonb, text, text);
drop function if exists public.coolerco_can_edit_pos_hours();
drop table if exists public.coolerco_pos_hours_log;
drop table if exists public.coolerco_pos_hours;
drop table if exists public.coolerco_public_holidays;
