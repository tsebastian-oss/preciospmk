alter function private.finalize_pending_catalog_run_assortments() set statement_timeout='10min';
alter function public.finalize_catalog_run_assortment_service(bigint) set statement_timeout='10min';

do $block$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='catalog-assortment-finalizer';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule => '*/10 * * * *');
  end if;
end
$block$;
