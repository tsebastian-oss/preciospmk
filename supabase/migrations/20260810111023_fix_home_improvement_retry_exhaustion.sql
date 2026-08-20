create or replace function public.claim_home_improvement_tasks_service(p_limit integer default 10)
returns table(id bigint, run_id bigint, supermarket text, kind text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit integer:=greatest(2,least(coalesce(p_limit,10),30));
  v_sources integer;
  v_per_store integer;
begin
  -- A stale task that already exhausted its retry budget must become terminal.
  update public.catalog_crawl_tasks t
  set status='failed',
      finished_at=coalesce(t.finished_at,now()),
      claimed_at=null,
      error=left(concat_ws('; ',nullif(t.error,''),'home-improvement retry budget exhausted after stale claim'),1500)
  where t.vertical='home_improvement'
    and t.status='running'
    and t.claimed_at<now()-interval '12 minutes'
    and t.attempts>=4;

  -- Only recover stale tasks that still have retries available.
  update public.catalog_crawl_tasks t
  set status='queued',
      claimed_at=null,
      available_at=now(),
      error=left(concat_ws('; ',nullif(t.error,''),'stale claim reset'),1500)
  where t.vertical='home_improvement'
    and t.status='running'
    and t.claimed_at<now()-interval '12 minutes'
    and t.attempts<4
    and exists(
      select 1
      from public.catalog_crawl_runs r
      where r.id=t.run_id
        and r.status='running'
        and coalesce(r.window_end_at,now()+interval '1 hour')>now()
    );

  -- Clean up orphaned queued tasks that can never be claimed again.
  update public.catalog_crawl_tasks t
  set status='failed',
      finished_at=coalesce(t.finished_at,now()),
      claimed_at=null,
      error=left(concat_ws('; ',nullif(t.error,''),'home-improvement retry budget exhausted'),1500)
  where t.vertical='home_improvement'
    and t.status='queued'
    and t.attempts>=4;

  select greatest(1,count(*))::integer into v_sources
  from public.home_improvement_sources where enabled;
  v_per_store:=greatest(1,ceil(v_limit::numeric/v_sources)::integer);

  return query
  with picked as materialized (
    select q.id
    from public.home_improvement_sources s
    cross join lateral (
      select t.id
      from public.catalog_crawl_tasks t
      join public.catalog_crawl_runs r on r.id=t.run_id
      where s.enabled
        and t.vertical='home_improvement'
        and t.supermarket=s.retailer
        and t.status='queued'
        and t.available_at<=now()
        and t.attempts<4
        and r.vertical='home_improvement'
        and r.status='running'
        and coalesce(r.window_end_at,now()+interval '1 hour')>now()
      order by t.id
      limit v_per_store
      for update of t skip locked
    ) q
    order by q.id
    limit v_limit
  ), claimed as (
    update public.catalog_crawl_tasks t
       set status='running',claimed_at=now(),attempts=t.attempts+1
    from picked p where t.id=p.id
    returning t.id,t.run_id,t.supermarket,t.kind,t.payload,t.attempts
  )
  select * from claimed order by supermarket,id;
end;
$function$;
