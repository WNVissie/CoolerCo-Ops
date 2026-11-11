-- CoolerCo-Ops · 020a · ROLLBACK — RUN ON PRODUCTION. Removes only the read-only window. Nothing else is touched.
drop schema if exists coolerco_export cascade;
drop role if exists coolerco_test_reader;
