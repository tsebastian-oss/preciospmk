create or replace function public.production_health()
returns jsonb
language sql
stable
security definer
set search_path = public, cron, pg_temp
as $$
  select jsonb_build_object(
    'status', 'ok',
    'databaseTime', now(),
    'database', current_database(),
    'dispatcherActive', coalesce((
      select active
      from cron.job
      where jobname = 'capacity-aware-scraper-dispatcher'
      order by jobid desc
      limit 1
    ), false)
  );
$$;

revoke all on function public.production_health() from public;
grant execute on function public.production_health() to anon, authenticated;

do $$
declare
  v_job record;
  v_dispatcher_id bigint;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'industry-product-backfill',
      'jumbo-price-refresh-fast-1',
      'jumbo-price-refresh-fast-2',
      'catalog-crawl-worker-every-10-seconds',
      'catalog-crawl-worker-fast-1',
      'catalog-crawl-worker-fast-2',
      'catalog-crawl-worker-fast-3',
      'lider-crawl-worker-every-10-seconds',
      'lider-crawl-worker-fast-1',
      'lider-crawl-worker-fast-2',
      'lider-discovery-worker-every-10-seconds',
      'lider-discovery-worker-fast-1',
      'department-store-paris-worker-1',
      'department-store-paris-worker-2',
      'department-store-paris-worker-3',
      'department-store-paris-worker-4',
      'falabella-listing-worker-1',
      'falabella-listing-worker-2',
      'falabella-listing-worker-3'
    )
  loop
    perform cron.alter_job(v_job.jobid, active => false);
  end loop;

  select jobid
    into v_dispatcher_id
  from cron.job
  where jobname = 'capacity-aware-scraper-dispatcher'
  order by jobid desc
  limit 1;

  if v_dispatcher_id is not null then
    perform cron.alter_job(
      v_dispatcher_id,
      schedule => '45 seconds',
      active => true
    );
  end if;
end;
$$;
