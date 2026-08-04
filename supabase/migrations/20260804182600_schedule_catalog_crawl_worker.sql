create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'catalog-crawl-worker-every-minute'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'catalog-crawl-worker-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/catalog-crawl-worker',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $cron$
);
