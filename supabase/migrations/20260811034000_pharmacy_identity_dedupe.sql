-- Deduplicate pharmacy catalog discovery by stable product identity instead of URL aliases.
-- Cruz Verde and Farmacias Ahumada expose multiple URLs for the same SKU; using URL coverage
-- therefore understated real catalog coverage and caused redundant fetches.

create table if not exists private.pharmacy_crawl_product_keys (
  run_id bigint not null references public.catalog_crawl_runs(id) on delete cascade,
  supermarket text not null,
  product_key text not null,
  url text not null,
  created_at timestamptz not null default now(),
  primary key (run_id, supermarket, product_key)
);

create or replace function private.pharmacy_product_key(p_retailer text, p_url text)
returns text
language sql
immutable
strict
set search_path to 'pg_catalog','private'
as $function$
  select case
    when p_retailer='Cruz Verde' then
      coalesce(
        substring(regexp_replace(split_part(p_url,'?',1),'/$','') from '/([0-9]+)\.html$'),
        regexp_replace(split_part(p_url,'?',1),'/$','')
      )
    when p_retailer='Farmacias Ahumada'
      and split_part(p_url,'?',1) ~* '/temporada-solares-[0-9]{4}-[0-9]{4}\.html$'
      then null
    when p_retailer='Farmacias Ahumada' then
      coalesce(
        substring(regexp_replace(split_part(p_url,'?',1),'/$','') from '-([0-9]{4,})\.html$'),
        regexp_replace(split_part(p_url,'?',1),'/$','')
      )
    else regexp_replace(split_part(p_url,'?',1),'/$','')
  end
$function$;

create or replace function public.enqueue_pharmacy_tasks_service(p_run_id bigint, p_tasks jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_item jsonb;
  v_kind text;
  v_store text;
  v_payload jsonb;
  v_urls jsonb;
  v_task_key text;
  v_inserted integer:=0;
  v_rows integer:=0;
begin
  if not exists(
    select 1 from public.catalog_crawl_runs
    where id=p_run_id and vertical='pharmacy' and status='running'
  ) then return 0; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_tasks,'[]'::jsonb)) loop
    v_kind:=nullif(v_item->>'kind','');
    v_store:=nullif(v_item->>'supermarket','');
    if v_kind is null or v_store is null then continue; end if;

    if v_kind='pharmacy_product_batch' then
      with candidates as (
        select u.url,u.ord,private.pharmacy_product_key(v_store,u.url) as product_key
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(v_item->'payload'->'urls')='array' then v_item->'payload'->'urls'
            else '[]'::jsonb
          end
        ) with ordinality as u(url,ord)
        where nullif(u.url,'') is not null
      ), inserted as (
        insert into private.pharmacy_crawl_product_keys(run_id,supermarket,product_key,url)
        select p_run_id,v_store,c.product_key,c.url
        from candidates c
        where nullif(c.product_key,'') is not null
        on conflict(run_id,supermarket,product_key) do nothing
        returning product_key,url
      )
      select coalesce(jsonb_agg(to_jsonb(c.url) order by c.ord),'[]'::jsonb)
      into v_urls
      from candidates c
      join inserted i on i.product_key=c.product_key and i.url=c.url;

      if jsonb_array_length(v_urls)=0 then continue; end if;
      v_payload:=jsonb_set(coalesce(v_item->'payload','{}'::jsonb),'{urls}',v_urls,true);
      v_task_key:=format('pharmacy-batch:%s:%s',lower(v_store),md5(v_urls::text));
    else
      v_payload:=coalesce(v_item->'payload','{}'::jsonb);
      v_task_key:=nullif(v_item->>'task_key','');
      if v_task_key is null then continue; end if;
    end if;

    insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload)
    values(p_run_id,v_task_key,v_store,'pharmacy',v_kind,v_payload)
    on conflict(run_id,task_key) do nothing;
    get diagnostics v_rows=row_count;
    v_inserted:=v_inserted+v_rows;
  end loop;

  if v_inserted>0 then
    update public.catalog_crawl_runs set tasks_total=tasks_total+v_inserted where id=p_run_id;
  end if;
  return v_inserted;
end;
$function$;

revoke all on function public.enqueue_pharmacy_tasks_service(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_pharmacy_tasks_service(bigint,jsonb) to service_role;

create or replace function public.pharmacy_retailer_crawl_coverage_service(
  p_retailer text,
  p_run_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','pg_temp'
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
    select k.product_key,k.url
    from private.pharmacy_crawl_product_keys k
    where k.run_id=v_run.id and k.supermarket=v_retailer
  ), captured as (
    select distinct case
      when v_retailer in ('Cruz Verde','Farmacias Ahumada') then p.external_id
      else regexp_replace(split_part(p.url,'?',1),'/$','')
    end as product_key
    from public.price_observations po
    join public.products p on p.id=po.product_id
    where po.crawl_run_id=v_run.id
      and p.retailer_type='pharmacy'
      and p.supermarket=v_retailer
  ), missing as (
    select d.url
    from discovered d
    left join captured c using(product_key)
    where c.product_key is null
    order by d.url
    limit 20
  )
  select
    (select count(*)::integer from discovered),
    (select count(*)::integer from captured),
    (select count(*)::integer from discovered d join captured c using(product_key)),
    (select coalesce(jsonb_agg(url order by url),'[]'::jsonb) from missing)
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

  v_coverage:=case when v_discovered>0
    then round(least(100::numeric,100::numeric*v_matched/v_discovered),2)
    else null end;
  v_progress:=case when coalesce(v_queued,0)+coalesce(v_running,0)+coalesce(v_completed,0)+coalesce(v_failed,0)>0
    then round(100::numeric*(coalesce(v_completed,0)+coalesce(v_failed,0))/(v_queued+v_running+v_completed+v_failed),1)
    else null end;

  return jsonb_build_object(
    'retailer',v_retailer,'runId',v_run.id,'runStatus',v_run.status,
    'startedAt',v_run.started_at,'finishedAt',v_run.finished_at,
    'discoveredUrls',v_discovered,'capturedUrls',v_matched,'capturedProducts',v_captured,
    'missingUrls',greatest(v_discovered-v_matched,0),'coveragePct',v_coverage,
    'taskProgressPct',v_progress,'discoveryComplete',coalesce(v_discovery_pending,0)=0,
    'queuedTasks',coalesce(v_queued,0),'runningTasks',coalesce(v_running,0),
    'completedTasks',coalesce(v_completed,0),'failedTasks',coalesce(v_failed,0),
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
