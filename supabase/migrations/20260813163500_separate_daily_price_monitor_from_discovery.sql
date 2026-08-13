-- Separate catalog discovery from recurring price monitoring.
-- Falabella monitors known listing pages; Paris monitors known product URLs.
-- The central supermarket and non-supermarket starters run every day.

create or replace function public.claim_falabella_listing_tasks_service(p_limit integer default 6)
returns table(id bigint, run_id bigint, supermarket text, kind text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  update public.catalog_crawl_tasks t
  set status='queued',claimed_at=null,available_at=now(),
      error=coalesce(t.error,'Recovered after stale Falabella listing claim')
  where t.vertical='department_store'
    and t.supermarket='Falabella'
    and t.status='running'
    and t.claimed_at<now()-interval '15 minutes';

  return query
  with selected as (
    select t.id
    from public.catalog_crawl_tasks t
    join public.catalog_crawl_runs r on r.id=t.run_id
    where r.vertical='department_store'
      and r.status='running'
      and t.vertical='department_store'
      and t.supermarket='Falabella'
      and t.kind in ('falabella_listing_seed','falabella_listing_page')
      and t.status='queued'
      and t.available_at<=now()
    order by
      case when coalesce((t.payload->>'monitor_only')::boolean,false) then 0 else 1 end,
      case t.kind when 'falabella_listing_seed' then 0 else 1 end,
      t.attempts,t.id
    limit greatest(1,least(coalesce(p_limit,6),6))
    for update of t skip locked
  ), claimed as (
    update public.catalog_crawl_tasks t
    set status='running',attempts=t.attempts+1,claimed_at=now(),error=null
    from selected
    where t.id=selected.id
    returning t.id,t.run_id,t.supermarket,t.kind,t.payload,t.attempts
  )
  select claimed.id,claimed.run_id,claimed.supermarket,claimed.kind,claimed.payload,claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.start_daily_department_store_refresh_service(
  p_retailers text[] default array['Paris','Falabella']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_allowed constant text[] := array['Paris','Falabella']::text[];
  v_retailers text[];
  v_run bigint;
  v_tasks integer := 0;
  v_existing boolean := false;
  v_paris_tasks integer := 0;
  v_falabella_tasks integer := 0;
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
    and coalesce(configuration->>'strategy','')='daily_price_monitor_v2'
  order by id desc limit 1;
  v_existing:=v_run is not null;

  if not v_existing then
    with superseded as (
      select id
      from public.catalog_crawl_runs
      where vertical='department_store'
        and status='running'
        and (
          trigger_type='scheduled'
          or coalesce(configuration->>'mode','') in ('daily_refresh','daily_price_monitor')
          or run_date<v_local_date
          or started_at<now()-interval '20 hours'
        )
      for update
    )
    update public.catalog_crawl_tasks task
    set status='failed',
        finished_at=coalesce(task.finished_at,now()),
        claimed_at=null,
        error=left(concat_ws('; ',nullif(task.error,''),'Superseded by daily price monitor v2'),4000)
    where task.run_id in(select id from superseded)
      and task.status in('queued','running');

    update public.catalog_crawl_runs
    set status='completed_with_errors',
        finished_at=coalesce(finished_at,now()),
        completion_reason='superseded_by_daily_price_monitor_v2'
    where vertical='department_store'
      and status='running'
      and (
        trigger_type='scheduled'
        or coalesce(configuration->>'mode','') in ('daily_refresh','daily_price_monitor')
        or run_date<v_local_date
        or started_at<now()-interval '20 hours'
      );

    insert into public.catalog_crawl_runs(
      status,vertical,trigger_type,run_date,window_end_at,configuration,
      tasks_total,tasks_completed,tasks_failed,products_found
    ) values (
      'running','department_store','scheduled',v_local_date,now()+interval '20 hours',
      jsonb_build_object(
        'mode','daily_price_monitor',
        'strategy','daily_price_monitor_v2',
        'retailers',to_jsonb(v_retailers),
        'discoverySeparated',true,
        'parisSource','known_product_urls',
        'parisBatchSize',50,
        'falabellaSource','known_listing_pages',
        'falabellaMonitorOnly',true
      ),
      0,0,0,0
    ) returning id into v_run;
  end if;

  if 'Paris'=any(v_retailers) then
    with urls as (
      select url,row_number() over(order by url) as row_number
      from (
        select distinct regexp_replace(url,'[?#].*$','','g') as url
        from public.products
        where supermarket='Paris'
          and nullif(btrim(url),'') is not null
      ) unique_urls
    ), groups as (
      select ((row_number-1)/50)::integer as batch_number,
             jsonb_agg(url order by url) as urls
      from urls
      group by ((row_number-1)/50)::integer
    )
    insert into public.catalog_crawl_tasks(
      run_id,task_key,supermarket,vertical,kind,payload,status,available_at
    )
    select v_run,
           format('paris-monitor:%s:%s',to_char(v_local_date,'YYYY-MM-DD'),batch_number),
           'Paris','department_store','retail_product_batch',
           jsonb_build_object('urls',urls,'crawl_delay_ms',300,'mode','daily_price_monitor'),
           'queued',now()
    from groups
    on conflict(run_id,task_key) do nothing;

    select count(*)::integer into v_paris_tasks
    from public.catalog_crawl_tasks
    where run_id=v_run and supermarket='Paris';
  end if;

  if 'Falabella'=any(v_retailers) then
    with raw_pages as (
      select
        source_metadata->>'sourceListing' as source_listing,
        coalesce(nullif(category,''),'Catálogo Falabella') as category_name
      from public.products
      where supermarket='Falabella'
        and nullif(source_metadata->>'sourceListing','') is not null
        and source_metadata->>'sourceListing' like 'https://www.falabella.com/falabella-cl/%'
    ), parsed_pages as (
      select
        regexp_replace(
          regexp_replace(source_listing,'([?&])page=[0-9]+','','g'),
          '[?&]$','','g'
        ) as base_url,
        coalesce(nullif(substring(source_listing from '[?&]page=([0-9]+)'), '')::integer,1) as page_number,
        max(category_name) as category_name
      from raw_pages
      group by source_listing
    ), known_pages as (
      select base_url,page_number,max(category_name) as category_name
      from parsed_pages
      where nullif(base_url,'') is not null
      group by base_url,page_number
    )
    insert into public.catalog_crawl_tasks(
      run_id,task_key,supermarket,vertical,kind,payload,status,available_at
    )
    select v_run,
           format('falabella-monitor:%s:%s:%s',to_char(v_local_date,'YYYY-MM-DD'),md5(base_url),page_number),
           'Falabella','department_store','falabella_listing_page',
           jsonb_build_object(
             'url',base_url,
             'page',page_number,
             'depth',0,
             'category_name',category_name,
             'discover_categories',false,
             'monitor_only',true,
             'mode','daily_price_monitor'
           ),
           'queued',now()
    from known_pages
    on conflict(run_id,task_key) do nothing;

    select count(*)::integer into v_falabella_tasks
    from public.catalog_crawl_tasks
    where run_id=v_run and supermarket='Falabella';
  end if;

  select count(*)::integer into v_tasks
  from public.catalog_crawl_tasks
  where run_id=v_run;

  update public.catalog_crawl_runs
  set tasks_total=v_tasks,
      configuration=configuration||jsonb_build_object(
        'retailers',to_jsonb(v_retailers),
        'parisTasks',v_paris_tasks,
        'falabellaTasks',v_falabella_tasks,
        'monitoringTasks',v_tasks
      )
  where id=v_run;

  if v_tasks=0 then
    update public.catalog_crawl_runs
    set status='failed',finished_at=now(),completion_reason='no_daily_monitor_tasks'
    where id=v_run;
    raise exception 'No department-store daily monitor tasks were created';
  end if;

  return jsonb_build_object(
    'runId',v_run,
    'existing',v_existing,
    'runDate',v_local_date,
    'strategy','daily_price_monitor_v2',
    'retailers',to_jsonb(v_retailers),
    'tasks',v_tasks,
    'parisTasks',v_paris_tasks,
    'falabellaTasks',v_falabella_tasks,
    'discoverySeparated',true
  );
end;
$$;

create or replace function public.daily_price_monitor_coverage_service(
  p_date date default null
)
returns table(
  retailer text,
  retailer_type text,
  known_products bigint,
  observed_products bigint,
  coverage_pct numeric,
  latest_observed_at timestamptz
)
language sql
security definer
set search_path to 'public','pg_temp'
as $$
  with target as (
    select coalesce(p_date,(now() at time zone 'America/Santiago')::date) as day
  ), known as (
    select p.supermarket as retailer,p.retailer_type,count(*)::bigint as known_products
    from public.products p
    where p.retailer_type in ('supermarket','department_store','pharmacy','home_improvement')
    group by p.supermarket,p.retailer_type
  ), observed as (
    select p.supermarket as retailer,
           count(distinct po.product_id)::bigint as observed_products,
           max(po.observed_at) as latest_observed_at
    from public.price_observations po
    join public.products p on p.id=po.product_id
    cross join target t
    where (po.observed_at at time zone 'America/Santiago')::date=t.day
    group by p.supermarket
  )
  select k.retailer,k.retailer_type,k.known_products,
         coalesce(o.observed_products,0)::bigint,
         round(coalesce(o.observed_products,0)::numeric/greatest(k.known_products,1)*100,1) as coverage_pct,
         o.latest_observed_at
  from known k
  left join observed o using(retailer)
  order by k.retailer_type,k.retailer;
$$;

grant execute on function public.daily_price_monitor_coverage_service(date) to authenticated;

DO $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname='daily-non-supermarket-crawls' loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule(
    'daily-non-supermarket-crawls',
    '*/10 * * * *',
    'select public.start_daily_non_supermarket_crawls_if_due_service();'
  );

  for v_jobid in select jobid from cron.job where jobname='daily-catalog-crawl-starter' loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule(
    'daily-catalog-crawl-starter',
    '*/5 * * * *',
    'select public.start_daily_catalog_crawl_if_due_service();'
  );
end
$$;