-- Launch new scraping rounds only on Mondays and Fridays.
-- Worker/dispatcher jobs intentionally remain unchanged so an already-started
-- round can continue draining its queue on the days in between.
-- pg_cron day-of-week: 1 = Monday, 5 = Friday.

do $block$
declare
  v_job_id bigint;
begin
  -- Supermarkets: keep the existing local 00:05-00:15 America/Santiago
  -- start window enforced inside start_daily_catalog_crawl_if_due_service().
  select jobid into v_job_id
  from cron.job
  where jobname = 'daily-catalog-crawl-starter'
  order by jobid desc
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'daily-catalog-crawl-starter',
      '*/5 * * * 1,5',
      'select public.start_daily_catalog_crawl_if_due_service();'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '*/5 * * * 1,5',
      active := true
    );
  end if;

  -- Department stores + pharmacies + home improvement: keep the existing
  -- local 00:20-01:20 America/Santiago window enforced by the service function.
  select jobid into v_job_id
  from cron.job
  where jobname = 'daily-non-supermarket-crawls'
  order by jobid desc
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'daily-non-supermarket-crawls',
      '*/10 * * * 1,5',
      'select public.start_daily_non_supermarket_crawls_if_due_service();'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '*/10 * * * 1,5',
      active := true
    );
  end if;

  -- Retire legacy launchers so they cannot create an extra Tuesday/Sunday/etc.
  -- round outside the two centralized Monday/Friday starters.
  for v_job_id in
    select jobid
    from cron.job
    where jobname in (
      'department-store-full-crawl-weekly',
      'daily-pharmacy-crawl',
      'falabella-listing-daily-seed',
      'home-improvement-daily-start',
      'rebuild-paris-refresh-queue'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$block$;

-- Fail the deployment if the two central launchers did not end up exactly on
-- Monday/Friday or if a retired launcher is still active.
do $verify$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'daily-catalog-crawl-starter'
      and active
      and schedule = '*/5 * * * 1,5'
  ) then
    raise exception 'Monday/Friday supermarket starter was not configured';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'daily-non-supermarket-crawls'
      and active
      and schedule = '*/10 * * * 1,5'
  ) then
    raise exception 'Monday/Friday non-supermarket starter was not configured';
  end if;

  if exists (
    select 1 from cron.job
    where active
      and jobname in (
        'department-store-full-crawl-weekly',
        'daily-pharmacy-crawl',
        'falabella-listing-daily-seed',
        'home-improvement-daily-start',
        'rebuild-paris-refresh-queue'
      )
  ) then
    raise exception 'A legacy scraper launcher is still active';
  end if;
end
$verify$;

select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'daily-catalog-crawl-starter',
  'daily-non-supermarket-crawls',
  'daily-catalog-crawl-window-closer',
  'scraping-pro-dispatcher-every-minute',
  'capacity-aware-scraper-dispatcher'
)
order by jobname, jobid;