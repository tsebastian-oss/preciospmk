do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'department-store-crawl-worker-every-20-seconds';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'department-store-crawl-worker-every-20-seconds',
    '20 seconds',
    $cron$
      select net.http_post(
        url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/department-store-crawl-worker',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 50000
      );
    $cron$
  );
end $$;
