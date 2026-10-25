-- CoolerCo-Ops · 004 · Waiting for Action → SCRAP bay (usually follows a Scrap an Asset case)
-- Only CoolerCo objects created on 2026-10-25 are changed. Applied 2026-10-25.
create or replace function public.coolerco_bay_for_status(p_status text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case lower(trim(coalesce(p_status, '')))
    when 'to audit' then 'RED' when 'to be repaired' then 'ORANGE' when 'to be refurbished' then 'ORANGE'
    when 'broken' then 'ORANGE' when 'ready to work' then 'GREEN' when 'to be branded' then 'YELLOW'
    when 'to be scrapped' then 'SCRAP' when 'waiting for action' then 'SCRAP'
    when 'in transit' then 'PENDING' when 'missing' then 'MISSING' else 'OTHER' end
$$;
update public.coolerco_wh_location_rules set match_statuses = array_remove(match_statuses, 'Waiting for Action')
 where 'Waiting for Action' = any(match_statuses) and notes = 'Returned / repair / BAU decal';
update public.coolerco_wh_location_rules set match_statuses = array['To be Scrapped','To be Refurbished','Waiting for Action'],
       notes = 'Scrap / refurb (incl. Waiting for Action after a scrap case)' where notes = 'Scrap / refurb';
