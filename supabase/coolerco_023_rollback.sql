-- CoolerCo-Ops · 023 · ROLLBACK — removes the label functions and tables (label history is lost).
drop function if exists public.coolerco_label_summary();
drop function if exists public.coolerco_label_todo(text);
drop function if exists public.coolerco_label_mark(text[], text, text);
drop table if exists public.coolerco_label_corrections;
drop table if exists public.coolerco_asset_labels;
