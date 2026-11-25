-- Rollback 062: removes the stock drill-down function (nothing else was changed).
drop function if exists public.coolerco_stock_detail(text, text);
