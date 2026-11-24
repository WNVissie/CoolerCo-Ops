-- CoolerCo 046 rollback (TEST): removes the demo logins and their access rows.
-- Needs delete rights on auth (run in the SQL editor).
delete from public.coolerco_user_access where created_by = 'demo 046';
delete from auth.identities where user_id in (select id from auth.users where raw_user_meta_data->>'demo' = 'true');
delete from auth.users where raw_user_meta_data->>'demo' = 'true';
