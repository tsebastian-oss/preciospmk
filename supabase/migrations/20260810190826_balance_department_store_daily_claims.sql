-- Process Paris and Falabella through the same known-catalog worker, alternating
-- priority every dispatcher interval so neither retailer can starve the other.

create or replace function public.claim_department_store_tasks_service(p_limit integer default 3)
returns table(id bigint,run_id bigint,supermarket text,kind text,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  update public.catalog_crawl_tasks task
  set status='queued',
      claimed_at=null,
      available_at=now(),
      error=coalesce(task.error,'Recovered after stale department-store worker claim')
  where task.vertical='department_store'
    and task.supermarket in('Paris','Falabella')
    and task.status='running'
    and task.kind in('retail_sitemap','retail_product_batch','retail_product_page')
    and task.claimed_at<now()-interval '15 minutes';

  return query
  with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id=task.run_id
    where run.vertical='department_store'
      and run.status='running'
      and task.vertical='department_store'
      and task.supermarket in('Paris','Falabella')
      and task.kind in('retail_sitemap','retail_product_batch','retail_product_page')
      and task.status='queued'
      and task.available_at<=now()
    order by
      case
        when mod(floor(extract(epoch from clock_timestamp())/30)::bigint,2)=0
          then case task.supermarket when 'Falabella' then 0 else 1 end
        else case task.supermarket when 'Paris' then 0 else 1 end
      end,
      case task.kind when 'retail_sitemap' then 0 when 'retail_product_batch' then 1 else 2 end,
      task.attempts,
      task.id
    limit greatest(1,least(coalesce(p_limit,3),8))
    for update of task skip locked
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status='running',attempts=task.attempts+1,claimed_at=now(),error=null
    from selected
    where task.id=selected.id
    returning task.id,task.run_id,task.supermarket,task.kind,task.payload,task.attempts
  )
  select claimed.id,claimed.run_id,claimed.supermarket,claimed.kind,claimed.payload,claimed.attempts
  from claimed
  order by claimed.id;
end;
$function$;

revoke all on function public.claim_department_store_tasks_service(integer) from public,anon,authenticated;
grant execute on function public.claim_department_store_tasks_service(integer) to service_role;
