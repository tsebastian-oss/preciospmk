create or replace function public.claim_pharmacy_tasks_service(p_limit integer default 3)
returns table(id bigint, run_id bigint, supermarket text, kind text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  update public.catalog_crawl_tasks as t
  set status='failed',finished_at=coalesce(t.finished_at,now()),claimed_at=null,
      error=coalesce(t.error,'Pharmacy task exhausted retry budget after stale worker claim')
  where t.vertical='pharmacy' and t.status='running'
    and t.claimed_at<now()-interval '15 minutes' and t.attempts>=6;

  update public.catalog_crawl_tasks as t
  set status='queued',claimed_at=null,available_at=now(),
      error=coalesce(t.error,'Recovered after stale pharmacy worker claim')
  where t.vertical='pharmacy' and t.status='running'
    and t.claimed_at<now()-interval '15 minutes' and t.attempts<6;

  update public.catalog_crawl_tasks as t
  set status='failed',finished_at=coalesce(t.finished_at,now()),
      error=coalesce(t.error,'Pharmacy task exhausted retry budget')
  where t.vertical='pharmacy' and t.status='queued' and t.attempts>=6;

  return query
  with candidates as (
    select task.id,
      row_number() over(
        partition by task.supermarket
        order by
          case task.kind
            when 'pharmacy_sitemap' then 0
            when 'pharmacy_product_page' then 1
            when 'pharmacy_product_batch' then 2
            else 3
          end,
          task.attempts,task.id
      ) retailer_rank
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id=task.run_id
    where run.vertical='pharmacy' and run.status='running'
      and task.vertical='pharmacy'
      and task.kind in ('pharmacy_sitemap','pharmacy_listing_page','pharmacy_product_batch','pharmacy_product_page')
      and task.status='queued' and task.attempts<6 and task.available_at<=now()
  ), selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join candidates c on c.id=task.id
    order by c.retailer_rank,
      case task.kind
        when 'pharmacy_sitemap' then 0
        when 'pharmacy_product_page' then 1
        when 'pharmacy_product_batch' then 2
        else 3
      end,
      task.supermarket,task.id
    limit greatest(3,least(coalesce(p_limit,3),6))
    for update of task skip locked
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status='running',attempts=task.attempts+1,claimed_at=now(),error=null
    from selected where task.id=selected.id
    returning task.id,task.run_id,task.supermarket,task.kind,task.payload,task.attempts
  )
  select claimed.id,claimed.run_id,claimed.supermarket,claimed.kind,claimed.payload,claimed.attempts
  from claimed order by claimed.supermarket,claimed.id;
end;
$function$;

revoke all on function public.claim_pharmacy_tasks_service(integer) from public,anon,authenticated;
grant execute on function public.claim_pharmacy_tasks_service(integer) to service_role;
