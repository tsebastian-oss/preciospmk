-- Keep daily price refreshes bounded, idempotent and independent from Vercel.
-- Long-running crawling belongs in Supabase workers; Vercel only serves the app.

-- Scheduled runs are unique per vertical, not globally. The former run_date-only
-- index prevented a home-improvement run and a supermarket run on the same day.
drop index if exists public.catalog_crawl_runs_one_scheduled_per_day_idx;
create unique index catalog_crawl_runs_one_scheduled_per_day_idx
  on public.catalog_crawl_runs(run_date,vertical)
  where trigger_type='scheduled';

create or replace function public.start_daily_department_store_refresh_service(
  p_retailers text[] default array['Paris','Falabella']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_allowed constant text[] := array['Paris','Falabella']::text[];
  v_retailers text[];
  v_run bigint;
  v_tasks integer := 0;
begin
  perform pg_advisory_xact_lock(824631986);

  select array_agg(distinct requested.retailer order by requested.retailer)
  into v_retailers
  from unnest(coalesce(p_retailers,v_allowed)) as requested(retailer)
  where requested.retailer=any(v_allowed);

  if coalesce(cardinality(v_retailers),0)=0 then
    raise exception 'No supported department-store retailer requested' using errcode='22023';
  end if;

  select id into v_run
  from public.catalog_crawl_runs
  where vertical='department_store'
    and status='running'
    and run_date=v_local_date
    and trigger_type='scheduled'
    and coalesce(configuration->>'strategy','')='daily_known_catalog_refresh'
  order by id desc
  limit 1;
  if v_run is not null then
    return jsonb_build_object('runId',v_run,'existing',true,'runDate',v_local_date);
  end if;

  -- Discovery runs are allowed to run during the day, but must never block the
  -- next daily snapshot. Preserve their data and close only unfinished tasks.
  with stale_runs as (
    select id
    from public.catalog_crawl_runs
    where vertical='department_store'
      and status='running'
      and (started_at<now()-interval '20 hours' or run_date<v_local_date)
    for update
  )
  update public.catalog_crawl_tasks task
  set status='failed',
      finished_at=coalesce(task.finished_at,now()),
      claimed_at=null,
      error=left(concat_ws('; ',nullif(task.error,''),'Superseded by the next daily department-store refresh'),4000)
  where task.run_id in(select id from stale_runs)
    and task.status in('queued','running');

  update public.catalog_crawl_runs
  set status='completed_with_errors',
      finished_at=coalesce(finished_at,now()),
      completion_reason='superseded_by_daily_refresh'
  where vertical='department_store'
    and status='running'
    and (started_at<now()-interval '20 hours' or run_date<v_local_date);

  insert into public.catalog_crawl_runs(
    status,vertical,trigger_type,run_date,window_end_at,configuration,
    tasks_total,tasks_completed,tasks_failed,products_found
  ) values (
    'running','department_store','scheduled',v_local_date,now()+interval '20 hours',
    jsonb_build_object(
      'mode','daily_refresh',
      'strategy','daily_known_catalog_refresh',
      'retailers',to_jsonb(v_retailers)
    ),0,0,0,0
  ) returning id into v_run;

  if 'Paris'=any(v_retailers) then
    with urls as (
      select url,row_number() over(order by url) as row_number
      from (
        select distinct regexp_replace(url,'[?#].*$','','g') as url
        from public.products
        where supermarket='Paris' and nullif(btrim(url),'') is not null
      ) unique_urls
    ), groups as (
      select ((row_number-1)/20)::integer as batch_number,
             jsonb_agg(url order by url) as urls
      from urls
      group by ((row_number-1)/20)::integer
    )
    insert into public.catalog_crawl_tasks(
      run_id,task_key,supermarket,vertical,kind,payload,status,available_at
    )
    select v_run,
           format('paris-daily:%s:%s',to_char(v_local_date,'YYYY-MM-DD'),batch_number),
           'Paris','department_store','retail_product_batch',
           jsonb_build_object('urls',urls,'crawl_delay_ms',300,'mode','daily_refresh'),
           'queued',now()
    from groups
    on conflict(run_id,task_key) do nothing;
  end if;

  if 'Falabella'=any(v_retailers) then
    insert into public.catalog_crawl_tasks(
      run_id,task_key,supermarket,vertical,kind,payload,status,available_at
    ) values (
      v_run,
      format('falabella-listing-seed:%s',to_char(v_local_date,'YYYY-MM-DD')),
      'Falabella','department_store','falabella_listing_seed',
      jsonb_build_object(
        'url','https://www.falabella.com/falabella-cl/collection/ofertas',
        'page',1,'depth',0,'mode','full','category_name','Catálogo Falabella'
      ),
      'queued',now()
    ) on conflict(run_id,task_key) do nothing;
  end if;

  select count(*)::integer into v_tasks
  from public.catalog_crawl_tasks
  where run_id=v_run;

  update public.catalog_crawl_runs
  set tasks_total=v_tasks
  where id=v_run;

  if v_tasks=0 then
    update public.catalog_crawl_runs
    set status='failed',finished_at=now(),completion_reason='no_daily_refresh_tasks'
    where id=v_run;
    raise exception 'No department-store refresh tasks were created';
  end if;

  return jsonb_build_object(
    'runId',v_run,'existing',false,'runDate',v_local_date,
    'retailers',to_jsonb(v_retailers),'tasks',v_tasks
  );
end;
$function$;

revoke all on function public.start_daily_department_store_refresh_service(text[]) from public,anon,authenticated;
grant execute on function public.start_daily_department_store_refresh_service(text[]) to service_role;

create or replace function public.start_daily_non_supermarket_crawls_if_due_service()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_local_timestamp timestamp := now() at time zone 'America/Santiago';
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_result jsonb := jsonb_build_object('runDate',v_local_date,'localTime',v_local_timestamp);
  v_value jsonb;
begin
  if v_local_timestamp::time<time '00:20' or v_local_timestamp::time>=time '01:20' then
    return v_result||jsonb_build_object('started',false,'reason','outside_start_window');
  end if;

  begin
    v_value:=public.start_daily_department_store_refresh_service(array['Paris','Falabella']);
    v_result:=v_result||jsonb_build_object('departmentStores',v_value);
  exception when others then
    v_result:=v_result||jsonb_build_object('departmentStores',jsonb_build_object('error',sqlerrm));
  end;

  begin
    v_value:=public.start_home_improvement_crawl_service(null);
    v_result:=v_result||jsonb_build_object('homeImprovement',v_value);
  exception when others then
    v_result:=v_result||jsonb_build_object('homeImprovement',jsonb_build_object('error',sqlerrm));
  end;

  begin
    v_value:=public.start_pharmacy_crawls_service('full',null);
    update public.catalog_crawl_runs
    set trigger_type='daily_refresh',run_date=v_local_date
    where vertical='pharmacy'
      and status='running'
      and id in(
        select nullif(item->>'runId','')::bigint
        from jsonb_array_elements(coalesce(v_value->'runs','[]'::jsonb)) item
      );
    v_result:=v_result||jsonb_build_object('pharmacies',v_value);
  exception when others then
    v_result:=v_result||jsonb_build_object('pharmacies',jsonb_build_object('error',sqlerrm));
  end;

  return v_result||jsonb_build_object('started',true);
end;
$function$;

revoke all on function public.start_daily_non_supermarket_crawls_if_due_service() from public,anon,authenticated;
grant execute on function public.start_daily_non_supermarket_crawls_if_due_service() to service_role;

-- Route all worker calls through the Edge dispatcher. It signs downstream
-- calls with the service credential and prevents the JWT mismatch that left
-- Easy/Sodimac returning 401 on every dispatch.
do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='capacity-aware-scraper-dispatcher';
  if v_job_id is not null then
    perform cron.alter_job(job_id:=v_job_id,active:=false);
  end if;

  select jobid into v_job_id from cron.job where jobname='scraping-pro-dispatcher-every-minute';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'scraping-pro-dispatcher-every-minute',
    '30 seconds',
    $cron$
      select net.http_post(
        url:='https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/scraping-pro-dispatcher',
        headers:=jsonb_build_object('Content-Type','application/json'),
        body:='{}'::jsonb,
        timeout_milliseconds:=300000
      );
    $cron$
  );

  if exists(select 1 from cron.job where jobname='daily-pharmacy-crawl') then
    perform cron.unschedule('daily-pharmacy-crawl');
  end if;
  if exists(select 1 from cron.job where jobname='falabella-listing-daily-seed') then
    perform cron.unschedule('falabella-listing-daily-seed');
  end if;
  if exists(select 1 from cron.job where jobname='daily-non-supermarket-crawls') then
    perform cron.unschedule('daily-non-supermarket-crawls');
  end if;
  perform cron.schedule(
    'daily-non-supermarket-crawls',
    '*/10 * * * *',
    'select public.start_daily_non_supermarket_crawls_if_due_service();'
  );
end
$block$;

update public.scraper_worker_controls
set min_interval_seconds=case worker_key
      when 'paris' then 15
      when 'falabella' then 15
      when 'lider_discovery' then 20
      when 'lider_product' then 30
      when 'supermarket_catalog' then 20
      when 'pharmacy' then 30
      when 'home_improvement' then 30
      else min_interval_seconds
    end,
    max_pending_calls=case
      when worker_key in('paris','pharmacy','home_improvement') then 2
      else 1
    end,
    updated_at=now()
where worker_key in(
  'paris','falabella','lider_discovery','lider_product',
  'supermarket_catalog','pharmacy','home_improvement'
);

-- Close the five-day department-store queue and immediately replace it with
-- a bounded daily refresh. Existing products and observations are preserved.
select public.start_daily_department_store_refresh_service(array['Paris','Falabella']);
