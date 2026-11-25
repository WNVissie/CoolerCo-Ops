-- Rollback 061: puts back the portal functions saved by 061 in coolerco_fn_backup.
do $r$
declare b record;
begin
  for b in select def from public.coolerco_fn_backup where script = '061' and fn in ('coolerco_conc_context', 'coolerco_conc_requests') loop
    execute b.def;
  end loop;
end $r$;
