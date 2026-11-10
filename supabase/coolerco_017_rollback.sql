-- CoolerCo-Ops · 017 · ROLLBACK — removes the two functions 017 added. Nothing else is touched.
-- The portal falls back to the old request screen by itself when these functions are not there.
drop function if exists public.coolerco_portal_submit_v2(text, jsonb);
drop function if exists public.coolerco_portal_options(text);
