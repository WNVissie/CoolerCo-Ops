-- CoolerCo-Ops · 036 · ROLLBACK — puts the 034 slot list back and removes the extra columns (their values are lost).
drop function if exists public.coolerco_field_slot_details(uuid, text, text, text, text);
drop function if exists public.coolerco_field_slot_list(text);
create function public.coolerco_field_slot_list(p_warehouse text default null)
returns table (id uuid, warehouse_code text, worker_type text, slot_no int, routeiq_username text, person_name text, phone text,
               user_id uuid, login_email text, active boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can see the slots'; end if;
  return query select s.id, s.warehouse_code, s.worker_type, s.slot_no, s.routeiq_username, s.person_name, s.phone,
                      s.user_id, u.email::text, s.active, s.updated_at
    from public.coolerco_field_slots s left join auth.users u on u.id = s.user_id
   where p_warehouse is null or s.warehouse_code = upper(p_warehouse)
   order by s.warehouse_code, s.worker_type, s.slot_no;
end $$;
revoke all on function public.coolerco_field_slot_list(text) from public, anon;
grant execute on function public.coolerco_field_slot_list(text) to authenticated;
drop index if exists public.coolerco_field_slots_employee_no_uq;
alter table public.coolerco_field_slots drop column if exists employee_no, drop column if exists vehicle,
  drop column if exists vehicle_reg, drop column if exists start_date, drop column if exists notes;
