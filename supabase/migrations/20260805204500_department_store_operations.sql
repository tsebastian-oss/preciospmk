update public.department_store_sources
set enabled = false,
    access_status = 'blocked',
    last_error = case retailer
      when 'Falabella' then 'Public PDP URLs return HTTP 403 from the crawler infrastructure. Authorized feed or API credentials required.'
      when 'Ripley' then 'Public sitemap returns HTTP 403 from the crawler infrastructure. Authorized feed or access required.'
      else last_error
    end,
    updated_at = now()
where retailer in ('Falabella', 'Ripley');

update public.department_store_sources
set enabled = true,
    access_status = 'available',
    last_error = null,
    last_error_at = null,
    updated_at = now()
where retailer = 'Paris';

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'department-store-crawl-worker-every-20-seconds';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule(
    'department-store-crawl-worker-every-20-seconds',
    '20 seconds',
    $cron$
      select net.http_post(
        url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/department-store-crawl-worker',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cron$
  );

  select jobid into v_job_id
  from cron.job
  where jobname = 'department-store-full-crawl-weekly';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule(
    'department-store-full-crawl-weekly',
    '0 6 * * 0',
    $cron$
      select public.start_department_store_crawl_service('full', array['Paris']);
    $cron$
  );
end $$;
