-- CoolerCo-Ops · 036 · RUN ON TEST FIRST — extra details on the field slots (Wanda 2026-11-17, staff sheet)
-- Adds: employee number (= the person's login username when they have no email), vehicle, vehicle registration,
--       start date, notes. Slot list returns them; new function to save them. Additive, coolerco_ only.
-- Rollback: coolerco_036_rollback.sql
alter table public.coolerco_field_slots add column if not exists employee_no text;
alter table public.coolerco_field_slots add column if not exists vehicle     text;
alter table public.coolerco_field_slots add column if not exists vehicle_reg text;
alter table public.coolerco_field_slots add column if not exists start_date  date;
alter table public.coolerco_field_slots add column if not exists notes       text;
create unique index if not exists coolerco_field_slots_employee_no_uq on public.coolerco_field_slots (employee_no) where employee_no is not null;

drop function if exists public.coolerco_field_slot_list(text);
create function public.coolerco_field_slot_list(p_warehouse text default null)
returns table (id uuid, warehouse_code text, worker_type text, slot_no int, routeiq_username text, person_name text, phone text,
               user_id uuid, login_email text, active boolean, updated_at timestamptz,
               employee_no text, vehicle text, vehicle_reg text, start_date date, notes text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can see the slots'; end if;
  return query select s.id, s.warehouse_code, s.worker_type, s.slot_no, s.routeiq_username, s.person_name, s.phone,
                      s.user_id, u.email::text, s.active, s.updated_at, s.employee_no, s.vehicle, s.vehicle_reg, s.start_date, s.notes
    from public.coolerco_field_slots s left join auth.users u on u.id = s.user_id
   where p_warehouse is null or s.warehouse_code = upper(p_warehouse)
   order by s.warehouse_code, s.worker_type, s.slot_no;
end $$;
revoke all on function public.coolerco_field_slot_list(text) from public, anon;
grant execute on function public.coolerco_field_slot_list(text) to authenticated;

create or replace function public.coolerco_field_slot_details(p_slot uuid, p_employee_no text, p_vehicle text, p_vehicle_reg text, p_notes text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can change slots'; end if;
  if nullif(trim(p_employee_no), '') is not null and exists (select 1 from public.coolerco_field_slots where employee_no = trim(p_employee_no) and id <> p_slot) then
    raise exception 'Employee no. % is already on another slot', p_employee_no; end if;
  update public.coolerco_field_slots set employee_no = nullif(trim(p_employee_no), ''), vehicle = nullif(trim(p_vehicle), ''),
         vehicle_reg = nullif(upper(trim(p_vehicle_reg)), ''), notes = nullif(trim(p_notes), ''), updated_at = now(), updated_by = auth.uid()
   where id = p_slot;
  if not found then raise exception 'Slot not found'; end if;
end $$;
revoke all on function public.coolerco_field_slot_details(uuid, text, text, text, text) from public, anon;
grant execute on function public.coolerco_field_slot_details(uuid, text, text, text, text) to authenticated;
