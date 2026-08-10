-- Refresh both department stores from their known product URLs. Falabella's
-- offers landing is not a stable priced catalog endpoint.

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
  v_existing boolean := false;
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
  v_existing:=v_run is not null;

  if not v_existing then
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
        'retailers',to_jsonb(v_retailers),
        'batch_size',50
      ),0,0,0,0
    ) returning id into v_run;
  end if;

  with urls as (
    select supermarket,url,
           row_number() over(partition by supermarket order by url) as row_number
    from (
      select distinct supermarket,regexp_replace(url,'[?#].*$','','g') as url
      from public.products
      where supermarket=any(v_retailers)
        and nullif(btrim(url),'') is not null
    ) unique_urls
  ), groups as (
    select supermarket,
           ((row_number-1)/50)::integer as batch_number,
           jsonb_agg(url order by url) as urls
    from urls
    group by supermarket,((row_number-1)/50)::integer
  )
  insert into public.catalog_crawl_tasks(
    run_id,task_key,supermarket,vertical,kind,payload,status,available_at
  )
  select v_run,
         format('%s-daily:%s:%s',lower(supermarket),to_char(v_local_date,'YYYY-MM-DD'),batch_number),
         supermarket,'department_store','retail_product_batch',
         jsonb_build_object('urls',urls,'crawl_delay_ms',300,'mode','daily_refresh'),
         'queued',now()
  from groups
  on conflict(run_id,task_key) do nothing;

  select count(*)::integer into v_tasks
  from public.catalog_crawl_tasks
  where run_id=v_run;

  update public.catalog_crawl_runs
  set tasks_total=v_tasks,
      configuration=configuration||jsonb_build_object('batch_size',50,'retailers',to_jsonb(v_retailers))
  where id=v_run;

  if v_tasks=0 then
    update public.catalog_crawl_runs
    set status='failed',finished_at=now(),completion_reason='no_daily_refresh_tasks'
    where id=v_run;
    raise exception 'No department-store refresh tasks were created';
  end if;

  return jsonb_build_object(
    'runId',v_run,'existing',v_existing,'runDate',v_local_date,
    'retailers',to_jsonb(v_retailers),'tasks',v_tasks,'batchSize',50
  );
end;
$function$;

revoke all on function public.start_daily_department_store_refresh_service(text[]) from public,anon,authenticated;
grant execute on function public.start_daily_department_store_refresh_service(text[]) to service_role;

update public.scraper_worker_controls
set url='https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/department-store-crawl-worker-v4',
    min_interval_seconds=15,
    max_pending_calls=2,
    timeout_ms=120000,
    updated_at=now()
where worker_key='falabella';

select public.start_daily_department_store_refresh_service(array['Paris','Falabella']);
