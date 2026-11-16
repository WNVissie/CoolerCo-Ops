-- CoolerCo-Ops · 030b · ROLLBACK — RUN ON TEST. Takes the routing tables off the copy job. Copied rows stay.
-- (The function keeps the small user-column change; with no user_cols set it behaves exactly as before.)
delete from public.coolerco_sync_tables where table_name like 'routing\_%';
