-- Keep the automotive queue fair across dealer sources.
-- Vehicle/model pages still have priority, but one large dealer cannot starve
-- another dealer that already has model pages ready to parse.

create or replace function public.claim_automotive_tasks_service(p_limit integer default 4)
returns setof public.catalog_crawl_tasks
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  update public.catalog_crawl_tasks
  set status='queued',claimed_at=null,available_at=now()+interval '20 seconds',
      error=left(concat_ws('; ',nullif(error,''),'Requeued stale automotive task'),4000)
  where vertical='automotive' and status='running' and claimed_at < now()-interval '12 minutes';

  return query
  with ranked as (
    select
      id,
      supermarket,
      kind,
      available_at,
      row_number() over(
        partition by supermarket,kind
        order by available_at,id
      ) as source_rank
    from public.catalog_crawl_tasks
    where vertical='automotive'
      and status='queued'
      and available_at<=now()
  ), desired as (
    select id
    from ranked
    order by
      case when kind='automotive_model_page' then 0 else 1 end,
      source_rank,
      supermarket,
      available_at,
      id
    limit greatest(1,least(coalesce(p_limit,4),8))
  ), picked as (
    select t.id
    from public.catalog_crawl_tasks t
    join desired d on d.id=t.id
    where t.status='queued'
    for update of t skip locked
  )
  update public.catalog_crawl_tasks t
  set status='running',claimed_at=now(),attempts=t.attempts+1,error=null
  from picked
  where t.id=picked.id
  returning t.*;
end;
$function$;

revoke all on function public.claim_automotive_tasks_service(integer) from public,anon,authenticated;
grant execute on function public.claim_automotive_tasks_service(integer) to service_role;
