-- Centralize scraping fan-out to avoid connection storms while preserving all captured data.
update public.catalog_crawl_tasks task
set status='queued',
    claimed_at=null,
    available_at=now(),
    error=coalesce(task.error,'Requeued after worker consolidation')
from public.catalog_crawl_runs run
where run.id=task.run_id
  and run.status='running'
  and task.status='running'
  and coalesce(task.claimed_at,task.available_at)<now()-interval '10 minutes';

create or replace function public.mark_latest_run_as_scheduled_service()
returns bigint
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_run_id bigint;
  v_local_date date:=(now() at time zone 'America/Santiago')::date;
begin
  select id into v_run_id
  from public.catalog_crawl_runs
  where status='running' and vertical='supermarket'
  order by id desc
  limit 1;

  if v_run_id is null then return null; end if;

  update public.catalog_crawl_runs
  set run_date=v_local_date,
      trigger_type='scheduled',
      window_end_at=((v_local_date+time '08:00') at time zone 'America/Santiago'),
      completion_reason=null
  where id=v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.start_daily_catalog_crawl_if_due_service()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_local_ts timestamp:=now() at time zone 'America/Santiago';
  v_local_date date:=(now() at time zone 'America/Santiago')::date;
  v_existing bigint;
  v_active bigint;
  v_baseline_status text;
  v_baseline_id bigint;
  v_request_id bigint;
begin
  if v_local_ts::time<time '00:05' or v_local_ts::time>=time '00:15' then
    return jsonb_build_object('started',false,'reason','outside_start_window','local_time',v_local_ts);
  end if;

  select id,status into v_baseline_id,v_baseline_status
  from public.catalog_crawl_runs
  where is_baseline=true and vertical='supermarket'
  order by id desc
  limit 1;

  if v_baseline_id is null then
    return jsonb_build_object('started',false,'reason','baseline_not_defined');
  end if;
  if v_baseline_status<>'completed' then
    return jsonb_build_object(
      'started',false,
      'reason','baseline_not_completed',
      'baseline_run_id',v_baseline_id,
      'baseline_status',v_baseline_status
    );
  end if;

  select id into v_active
  from public.catalog_crawl_runs
  where status='running' and vertical='supermarket'
  order by started_at desc
  limit 1;

  if v_active is not null then
    return jsonb_build_object('started',false,'reason','supermarket_run_active','run_id',v_active);
  end if;

  select id into v_existing
  from public.catalog_crawl_runs
  where vertical='supermarket'
    and run_date=v_local_date
    and trigger_type='scheduled'
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('started',false,'reason','already_scheduled','run_id',v_existing);
  end if;

  select net.http_post(
    url:='https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/catalog-crawl-start',
    headers:=jsonb_build_object('Content-Type','application/json'),
    body:='{}'::jsonb,
    timeout_milliseconds:=50000
  ) into v_request_id;

  perform pg_sleep(2);
  perform public.mark_latest_run_as_scheduled_service();
  return jsonb_build_object('started',true,'request_id',v_request_id,'run_date',v_local_date);
end;
$$;

create or replace function public.close_catalog_crawls_after_window_service()
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_count integer;
begin
  with expired as (
    update public.catalog_crawl_runs
    set status='cancelled',
        finished_at=now(),
        completion_reason='nightly_window_closed_at_08_00'
    where vertical='supermarket'
      and status='running'
      and trigger_type='scheduled'
      and is_baseline=false
      and window_end_at is not null
      and now()>=window_end_at
    returning id
  ), cancelled_tasks as (
    update public.catalog_crawl_tasks task
    set status='cancelled',
        finished_at=now(),
        error=coalesce(task.error,'Cancelled because nightly supermarket crawl window closed at 08:00 America/Santiago')
    where task.status in ('queued','running')
      and task.run_id in(select id from expired)
    returning task.id
  )
  select count(*) into v_count from expired;
  return coalesce(v_count,0);
end;
$$;

do $$
declare v_job_id bigint;
begin
  -- Keep legacy jobs defined for rollback, but inactive.
  for v_job_id in
    select jobid from cron.job
    where jobname like 'catalog-crawl-worker%'
       or jobname like 'lider-crawl-worker%'
       or jobname like 'lider-discovery-worker%'
       or jobname like 'department-store-paris-worker-%'
       or jobname like 'falabella-listing-worker-%'
       or jobname='jumbo-price-refresh-worker'
       or jobname='scraping-pro-dispatcher-every-minute'
  loop
    perform cron.alter_job(job_id:=v_job_id,active:=false);
  end loop;

  select jobid into v_job_id
  from cron.job where jobname='scraping-pro-dispatcher-every-minute';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  perform cron.schedule(
    'scraping-pro-dispatcher-every-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url:='https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/scraping-pro-dispatcher',
        headers:=jsonb_build_object('Content-Type','application/json'),
        body:='{}'::jsonb,
        timeout_milliseconds:=300000
      );
    $cron$
  );

  select jobid into v_job_id from cron.job where jobname='daily-catalog-crawl-starter';
  if v_job_id is not null then
    perform cron.alter_job(job_id:=v_job_id,schedule:='*/5 * * * *',active:=true);
  end if;

  select jobid into v_job_id from cron.job where jobname='daily-catalog-crawl-window-closer';
  if v_job_id is not null then
    perform cron.alter_job(job_id:=v_job_id,schedule:='*/5 * * * *',active:=true);
  end if;

  select jobid into v_job_id from cron.job where jobname='department-store-full-crawl-weekly';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('department-store-full-crawl-weekly','0 10 * * 0',$cron$
    select public.start_department_store_crawl_service('full',array['Paris']);
    select public.start_falabella_listing_crawl_service('full');
  $cron$);

  select jobid into v_job_id from cron.job where jobname='falabella-listing-daily-seed';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('falabella-listing-daily-seed','15 10 * * *',$cron$
    select public.start_falabella_listing_crawl_service('full');
  $cron$);

  select jobid into v_job_id from cron.job where jobname='classify-new-products-every-10-minutes';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('classify-new-products-every-10-minutes','*/10 * * * *',$cron$
    select public.classify_unscoped_products_service(10000);
  $cron$);
end $$;
