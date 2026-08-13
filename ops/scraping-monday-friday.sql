-- Daily scraping schedule for the pricing platform.
-- Discovery and daily price monitoring are separate responsibilities; workers
-- stay active continuously while the centralized starters create one round per day.

do $block$
declare
  v_job_id bigint;
begin
  -- Supermarkets: service function enforces the 00:05-00:20 America/Santiago window.
  select jobid into v_job_id
  from cron.job
  where jobname = 'daily-catalog-crawl-starter'
  order by jobid desc
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'daily-catalog-crawl-starter',
      '*/5 * * * *',
      'select public.start_daily_catalog_crawl_if_due_service();'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '*/5 * * * *',
      active := true
    );
  end if;

  -- Department stores + pharmacies + Home Improvement: service function
  -- enforces the 00:20-01:20 America/Santiago start window.
  select jobid into v_job_id
  from cron.job
  where jobname = 'daily-non-supermarket-crawls'
  order by jobid desc
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'daily-non-supermarket-crawls',
      '*/10 * * * *',
      'select public.start_daily_non_supermarket_crawls_if_due_service();'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '*/10 * * * *',
      active := true
    );
  end if;

  -- Queue dispatcher remains active every minute so each daily round can drain.
  select jobid into v_job_id
  from cron.job
  where jobname = 'scraping-pro-dispatcher-every-minute'
  order by jobid desc
  limit 1;

  if v_job_id is not null then
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *',
      active := true
    );
  end if;

  -- Legacy launchers stay retired; centralized daily starters own scheduling.
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

do $verify$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'daily-catalog-crawl-starter'
      and active
      and schedule = '*/5 * * * *'
  ) then
    raise exception 'Daily supermarket starter was not configured';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'daily-non-supermarket-crawls'
      and active
      and schedule = '*/10 * * * *'
  ) then
    raise exception 'Daily non-supermarket starter was not configured';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'scraping-pro-dispatcher-every-minute'
      and active
      and schedule = '* * * * *'
  ) then
    raise exception 'Scraper dispatcher was not configured for one-minute cadence';
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