-- CoolerCo-Ops · 026 · ROLLBACK — removes the users & roles functions and the audit table.
-- Role rows given to people stay (switch them off on the screen first if needed); the three new roles are removed only if unused.
drop function if exists public.coolerco_user_access_set(uuid, boolean);
drop function if exists public.coolerco_user_access_add(uuid, text, text, text);
drop function if exists public.coolerco_users_admin();
drop function if exists public.coolerco_can_override(text);
drop table if exists public.coolerco_access_events;
delete from public.coolerco_settings where key = 'override_roles';
delete from public.coolerco_roles r where r.code in ('supervisor', 'stock_controller', 'warehouse_assistant')
  and not exists (select 1 from public.coolerco_user_access a where a.role_code = r.code);
