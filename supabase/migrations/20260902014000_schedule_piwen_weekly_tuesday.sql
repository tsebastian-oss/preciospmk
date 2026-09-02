-- Piwén: weekly Tuesday cadence for client-specific sources.
-- pg_cron runs in UTC. Jobs are staggered to avoid contention.
-- 10:23 / 10:35 UTC = 06:23 / 06:35 Chile while UTC-4.

do $$
declare j record;
begin
  for j in
    select jobid
    from cron.job
    where jobname in (
      'piwen-official-daily',
      'piwen-mercadolibre-daily',
      'piwen-official-weekly-tuesday',
      'piwen-mercadolibre-weekly-tuesday'
    )
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'piwen-mercadolibre-weekly-tuesday',
  '23 10 * * 2',
  'select public.dispatch_piwen_mercadolibre_worker_sync();'
);

select cron.schedule(
  'piwen-official-weekly-tuesday',
  '35 10 * * 2',
  'select public.dispatch_piwen_official_shopify_worker_sync();'
);
