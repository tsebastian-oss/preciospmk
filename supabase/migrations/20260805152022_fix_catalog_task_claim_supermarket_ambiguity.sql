create or replace function public.claim_catalog_tasks_service(p_limit integer default 8)
returns table(id bigint,run_id bigint,supermarket text,kind text,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
begin
  perform pg_advisory_xact_lock(824631972);

  update public.catalog_crawl_tasks as stale_task
  set status='queued',
      claimed_at=null,
      available_at=now(),
      error=coalesce(stale_task.error,'Recovered after a stale worker claim')
  where stale_task.status='running'
    and stale_task.supermarket<>'Lider'
    and stale_task.claimed_at<now()-interval '12 minutes';

  return query
  with ranked as (
    select
      task.id,
      row_number() over(
        partition by task.supermarket
        order by
          case
            when task.kind='vtex_categories' then 0
            when lower(task.payload::text) ~ '(botiller|bebest|vino|cervez|licor|destil|espum|agua|jugo|bebida)' then 1
            else 2
          end,
          task.id
      ) as supermarket_rank,
      case
        when task.kind='vtex_categories' then 0
        when lower(task.payload::text) ~ '(botiller|bebest|vino|cervez|licor|destil|espum|agua|jugo|bebida)' then 1
        else 2
      end as category_priority
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id=task.run_id
    where run.status='running'
      and task.supermarket<>'Lider'
      and task.status='queued'
      and task.available_at<=now()
  ),selected as (
    select ranked.id
    from ranked
    order by ranked.category_priority,ranked.supermarket_rank,ranked.id
    limit greatest(1,least(coalesce(p_limit,8),24))
  ),claimed as (
    update public.catalog_crawl_tasks task
    set status='running',
        attempts=task.attempts+1,
        claimed_at=now(),
        error=null
    from selected
    where task.id=selected.id
      and task.status='queued'
    returning task.id,task.run_id,task.supermarket,task.kind,task.payload,task.attempts
  )
  select claimed.id,claimed.run_id,claimed.supermarket,claimed.kind,claimed.payload,claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;
