-- CoolerCo 049 rollback: removes the Magnum guard rules and the helper function.
do $$
declare r record;
begin
  for r in select tablename from pg_policies where schemaname = 'public' and policyname = 'coolerco_magnum_guard' loop
    execute format('drop policy coolerco_magnum_guard on public.%I', r.tablename);
  end loop;
end $$;
drop function if exists public.coolerco_magnum_blocked();
