create or replace function public.start_pharmacy_retailer_crawl_service(
  p_mode text default 'full',
  p_retailer text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_mode text:=lower(coalesce(p_mode,'full'));
  v_retailer text:=nullif(btrim(p_retailer),'');
  v_source public.pharmacy_sources%rowtype;
  v_active bigint;
  v_run bigint;
  v_seed text;
begin
  if v_mode not in ('pilot','full') then
    raise exception 'Invalid pharmacy crawl mode: %',p_mode using errcode='22023';
  end if;
  if v_retailer is null then
    raise exception 'Pharmacy retailer is required' using errcode='22023';
  end if;

  select * into v_source
  from public.pharmacy_sources
  where retailer=v_retailer and enabled;
  if not found then
    raise exception 'Unsupported or disabled pharmacy retailer: %',v_retailer using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(936421706,hashtext(lower(v_retailer)));

  update public.catalog_crawl_runs r
  set status='failed',
      finished_at=now(),
      completion_reason='safety_timeout',
      errors=coalesce(r.errors,'[]'::jsonb)||jsonb_build_array(format('%s pharmacy run exceeded its safety window',v_retailer))
  where r.vertical='pharmacy'
    and r.status='running'
    and r.started_at<now()-interval '3 days'
    and exists(
      select 1 from public.catalog_crawl_tasks t
      where t.run_id=r.id and t.vertical='pharmacy' and t.supermarket=v_retailer
    );

  select r.id into v_active
  from public.catalog_crawl_runs r
  where r.vertical='pharmacy'
    and r.status='running'
    and exists(
      select 1 from public.catalog_crawl_tasks t
      where t.run_id=r.id and t.vertical='pharmacy' and t.supermarket=v_retailer
    )
  order by r.started_at desc
  limit 1;
  if v_active is not null then return v_active; end if;

  insert into public.catalog_crawl_runs(status,vertical,trigger_type,run_date,configuration)
  values(
    'running','pharmacy','manual',(now() at time zone 'America/Santiago')::date,
    jsonb_build_object('mode',v_mode,'retailer',v_retailer,'retailers',jsonb_build_array(v_retailer),'parallel',true)
  ) returning id into v_run;

  insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload)
  values(
    v_run,
    format('pharmacy-sitemap:%s:%s',lower(v_retailer),md5(v_source.sitemap_url)),
    v_retailer,'pharmacy','pharmacy_sitemap',
    jsonb_build_object(
      'url',v_source.sitemap_url,
      'root_url',v_source.sitemap_url,
      'mode',v_mode,
      'depth',0,
      'max_depth',4,
      'max_product_urls',case when v_mode='pilot' then 250 else null end,
      'crawl_delay_ms',v_source.crawl_delay_ms
    )
  ) on conflict(run_id,task_key) do nothing;

  for v_seed in
    select jsonb_array_elements_text(coalesce(v_source.metadata->'seed_urls','[]'::jsonb))
  loop
    insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload)
    values(
      v_run,
      format('pharmacy-listing:%s:%s',lower(v_retailer),md5(v_seed)),
      v_retailer,'pharmacy','pharmacy_listing_page',
      jsonb_build_object(
        'url',v_seed,
        'mode',v_mode,
        'page',1,
        'max_pages',case when v_mode='pilot' then 3 else 50 end,
        'crawl_delay_ms',v_source.crawl_delay_ms
      )
    ) on conflict(run_id,task_key) do nothing;
  end loop;

  update public.catalog_crawl_runs
  set tasks_total=(select count(*)::integer from public.catalog_crawl_tasks where run_id=v_run)
  where id=v_run;

  if not exists(select 1 from public.catalog_crawl_tasks where run_id=v_run) then
    update public.catalog_crawl_runs
    set status='failed',finished_at=now(),completion_reason='no_sources'
    where id=v_run;
    raise exception 'No crawl tasks were created for %',v_retailer;
  end if;

  return v_run;
end;
$function$;

create or replace function public.start_pharmacy_crawls_service(
  p_mode text default 'full',
  p_retailers text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_source record;
  v_run bigint;
  v_runs jsonb:='[]'::jsonb;
  v_selected integer:=0;
begin
  for v_source in
    select s.retailer
    from public.pharmacy_sources s
    where s.enabled and (p_retailers is null or s.retailer=any(p_retailers))
    order by s.retailer
  loop
    v_selected:=v_selected+1;
    v_run:=public.start_pharmacy_retailer_crawl_service(p_mode,v_source.retailer);
    v_runs:=v_runs||jsonb_build_array(jsonb_build_object(
      'retailer',v_source.retailer,
      'runId',v_run,
      'status',(select status from public.catalog_crawl_runs where id=v_run)
    ));
  end loop;

  if v_selected=0 then
    raise exception 'No enabled pharmacy sources selected' using errcode='22023';
  end if;

  return jsonb_build_object('mode',lower(coalesce(p_mode,'full')),'parallel',true,'runs',v_runs);
end;
$function$;

create or replace function public.start_pharmacy_crawl_service(
  p_mode text default 'pilot',
  p_retailers text[] default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_result jsonb;
  v_first bigint;
begin
  v_result:=public.start_pharmacy_crawls_service(p_mode,p_retailers);
  v_first:=nullif(v_result->'runs'->0->>'runId','')::bigint;
  if v_first is null then raise exception 'No pharmacy crawl run was created'; end if;
  return v_first;
end;
$function$;

create or replace function public.pharmacy_retailer_crawl_coverage_service(
  p_retailer text,
  p_run_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_retailer text:=nullif(btrim(p_retailer),'');
  v_run public.catalog_crawl_runs%rowtype;
  v_discovered integer:=0;
  v_captured integer:=0;
  v_matched integer:=0;
  v_missing_sample jsonb:='[]'::jsonb;
  v_discovery_pending integer:=0;
  v_queued integer:=0;
  v_running integer:=0;
  v_completed integer:=0;
  v_failed integer:=0;
  v_coverage numeric;
  v_progress numeric;
begin
  if v_retailer is null then raise exception 'Retailer is required' using errcode='22023'; end if;

  if p_run_id is null then
    select r.* into v_run
    from public.catalog_crawl_runs r
    where r.vertical='pharmacy'
      and exists(
        select 1 from public.catalog_crawl_tasks t
        where t.run_id=r.id and t.vertical='pharmacy' and t.supermarket=v_retailer
      )
    order by (r.status='running') desc,r.started_at desc,r.id desc
    limit 1;
  else
    select r.* into v_run
    from public.catalog_crawl_runs r
    where r.id=p_run_id and r.vertical='pharmacy'
      and exists(
        select 1 from public.catalog_crawl_tasks t
        where t.run_id=r.id and t.vertical='pharmacy' and t.supermarket=v_retailer
      );
  end if;

  if not found then
    return jsonb_build_object(
      'retailer',v_retailer,'runId',null,'runStatus','not_started',
      'discoveredUrls',0,'capturedUrls',0,'capturedProducts',0,'missingUrls',0,
      'coveragePct',null,'taskProgressPct',null,'discoveryComplete',false,
      'status','not_started','missingSample','[]'::jsonb
    );
  end if;

  with discovered as (
    select distinct regexp_replace(split_part(x.url,'?',1),'/$','') as canonical_url
    from public.catalog_crawl_tasks t
    cross join lateral (
      select value as url
      from jsonb_array_elements_text(
        case when jsonb_typeof(t.payload->'urls')='array' then t.payload->'urls' else '[]'::jsonb end
      )
      union all
      select t.payload->>'url'
      where t.kind='pharmacy_product_page' and nullif(t.payload->>'url','') is not null
    ) x
    where t.run_id=v_run.id
      and t.vertical='pharmacy'
      and t.supermarket=v_retailer
      and t.kind in ('pharmacy_product_batch','pharmacy_product_page')
      and nullif(x.url,'') is not null
  ), captured as (
    select distinct regexp_replace(split_part(p.url,'?',1),'/$','') as canonical_url
    from public.price_observations po
    join public.products p on p.id=po.product_id
    where po.crawl_run_id=v_run.id
      and p.retailer_type='pharmacy'
      and p.supermarket=v_retailer
      and nullif(p.url,'') is not null
  ), missing as (
    select d.canonical_url
    from discovered d
    left join captured c using(canonical_url)
    where c.canonical_url is null
    order by d.canonical_url
    limit 20
  )
  select
    (select count(*)::integer from discovered),
    (select count(*)::integer from captured),
    (select count(*)::integer from discovered d join captured c using(canonical_url)),
    (select coalesce(jsonb_agg(canonical_url order by canonical_url),'[]'::jsonb) from missing)
  into v_discovered,v_captured,v_matched,v_missing_sample;

  select
    count(*) filter(where status='queued')::integer,
    count(*) filter(where status='running')::integer,
    count(*) filter(where status='completed')::integer,
    count(*) filter(where status='failed')::integer,
    count(*) filter(where kind in ('pharmacy_sitemap','pharmacy_listing_page') and status in ('queued','running'))::integer
  into v_queued,v_running,v_completed,v_failed,v_discovery_pending
  from public.catalog_crawl_tasks
  where run_id=v_run.id and vertical='pharmacy' and supermarket=v_retailer;

  v_coverage:=case when v_discovered>0 then round(least(100::numeric,100::numeric*v_matched/v_discovered),2) else null end;
  v_progress:=case when coalesce(v_queued,0)+coalesce(v_running,0)+coalesce(v_completed,0)+coalesce(v_failed,0)>0
    then round(100::numeric*(coalesce(v_completed,0)+coalesce(v_failed,0))/(v_queued+v_running+v_completed+v_failed),1)
    else null end;

  return jsonb_build_object(
    'retailer',v_retailer,
    'runId',v_run.id,
    'runStatus',v_run.status,
    'startedAt',v_run.started_at,
    'finishedAt',v_run.finished_at,
    'discoveredUrls',v_discovered,
    'capturedUrls',v_matched,
    'capturedProducts',v_captured,
    'missingUrls',greatest(v_discovered-v_matched,0),
    'coveragePct',v_coverage,
    'taskProgressPct',v_progress,
    'discoveryComplete',coalesce(v_discovery_pending,0)=0,
    'queuedTasks',coalesce(v_queued,0),
    'runningTasks',coalesce(v_running,0),
    'completedTasks',coalesce(v_completed,0),
    'failedTasks',coalesce(v_failed,0),
    'status',case
      when v_run.status='running' and coalesce(v_discovery_pending,0)>0 then 'discovering'
      when v_discovered=0 then 'measuring'
      when v_matched>=v_discovered then 'complete'
      when v_run.status='running' then 'capturing'
      else 'gap'
    end,
    'missingSample',coalesce(v_missing_sample,'[]'::jsonb)
  );
end;
$function$;

create or replace function public.enterprise_pharmacy_crawl_coverage(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_access jsonb;
  v_retailers text[];
  v_is_admin boolean;
  v_rows jsonb;
begin
  v_access:=public.enterprise_access_context(p_organization_id,'overview');
  v_is_admin:=coalesce((v_access->>'isSaasAdmin')::boolean,false);
  select coalesce(array_agg(value),array[]::text[])
  into v_retailers
  from jsonb_array_elements_text(coalesce(v_access->'retailers','[]'::jsonb));

  select coalesce(jsonb_agg(public.pharmacy_retailer_crawl_coverage_service(s.retailer,null) order by s.retailer),'[]'::jsonb)
  into v_rows
  from public.pharmacy_sources s
  where s.enabled
    and (v_is_admin or cardinality(v_retailers)=0 or s.retailer=any(v_retailers));

  return jsonb_build_object(
    'checkedAt',now(),
    'parallel',true,
    'retailers',coalesce(v_rows,'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.start_pharmacy_retailer_crawl_service(text,text) from public,anon,authenticated;
revoke all on function public.start_pharmacy_crawls_service(text,text[]) from public,anon,authenticated;
revoke all on function public.start_pharmacy_crawl_service(text,text[]) from public,anon,authenticated;
revoke all on function public.pharmacy_retailer_crawl_coverage_service(text,bigint) from public,anon,authenticated;
revoke all on function public.enterprise_pharmacy_crawl_coverage(uuid) from public,anon;

grant execute on function public.start_pharmacy_retailer_crawl_service(text,text) to service_role;
grant execute on function public.start_pharmacy_crawls_service(text,text[]) to service_role;
grant execute on function public.start_pharmacy_crawl_service(text,text[]) to service_role;
grant execute on function public.pharmacy_retailer_crawl_coverage_service(text,bigint) to service_role;
grant execute on function public.enterprise_pharmacy_crawl_coverage(uuid) to authenticated,service_role;

update public.scraper_worker_controls
set min_interval_seconds=60,
    max_pending_calls=2,
    timeout_ms=150000,
    updated_at=now()
where worker_key='pharmacy';

do $block$
begin
  if exists(select 1 from cron.job where jobname='daily-pharmacy-crawl') then
    perform cron.unschedule('daily-pharmacy-crawl');
  end if;
  perform cron.schedule(
    'daily-pharmacy-crawl',
    '30 9 * * *',
    'select public.start_pharmacy_crawls_service(''full'',null);'
  );
end
$block$;
