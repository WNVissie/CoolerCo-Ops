-- CoolerCo-Ops · 025 · ROLLBACK — the portal falls back to changing details only while logging a request.
drop function if exists public.coolerco_portal_update_details(text, jsonb);
drop function if exists public.coolerco_portal_contact(text);
